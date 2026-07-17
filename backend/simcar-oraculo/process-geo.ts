import { assertSimcarCredentials, assertTestCarId, getSimcarOraculoConfig } from "./config";
import {
  getSimcarToken,
  simcarBuscarStatusProcessamento,
  simcarDownload,
  simcarPost,
  withSimcarAuthRetry,
  withSimcarPollRetry,
} from "./client";
import { enqueueSimcar } from "./queue";
import type { OraculoProgress, SimcarProcessOutcome } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Dispara ProcessarGeo no projeto-teste e aguarda conclusão.
 */
export async function processGeoOnTestProject(args: {
  carId?: string;
  onProgress?: (ev: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}): Promise<SimcarProcessOutcome> {
  return enqueueSimcar(() => processGeoOnTestProjectUnlocked(args));
}

/** Executa com a fila global já adquirida pelo pipeline. Não chamar diretamente fora dele. */
export async function processGeoOnTestProjectUnlocked(args: {
  carId?: string;
  onProgress?: (ev: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}): Promise<SimcarProcessOutcome> {
  const cfg = assertSimcarCredentials();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  const timeline: OraculoProgress[] = [];
  const push = (ev: OraculoProgress) => {
    timeline.push(ev);
    args.onProgress?.(ev);
  };

  await args.checkCancelled?.();
  push({ step: "login", message: "Autenticando no SIMCAR…", percent: 5 });
  await getSimcarToken();
  const authenticated = <T>(operation: (token: string) => Promise<T>) =>
    withSimcarAuthRetry(operation, {
      onRetry: () =>
        push({
          step: "login",
          message: "Sessão do SIMCAR expirou; autenticando novamente…",
          percent: 5,
        }),
    });

  // Residual de ProcessarGeo em AGUARDANDO/EXECUTANDO bloqueia novo POST com 400 genérico.
  try {
    const pre = await authenticated((token) => simcarBuscarStatusProcessamento(token, carId));
    const preSt = String(
      pre.ProcessamentoStatus || pre.ProcessamentoGeoStatus || "",
    );
    if (/AGUARDANDO|EXECUTANDO|EM_ANDAMENTO|PROCESSANDO/i.test(preSt)) {
      push({
        step: "processar",
        message: `Processamento residual no SEMA (${preSt}); cancelando…`,
        percent: 12,
      });
      try {
        await authenticated((token) =>
          simcarPost(token, `Requerimento/CancelarProcessamentoGeo/${carId}`, undefined, 120_000),
        );
        await sleep(Math.min(cfg.pollMs, 5000));
      } catch (cancelErr: any) {
        push({
          step: "processar",
          message: `Aviso ao cancelar residual: ${cancelErr?.message || cancelErr}`,
          percent: 13,
        });
      }
    }
  } catch {
    /* best-effort */
  }

  await args.checkCancelled?.();
  push({ step: "processar", message: "Disparando ProcessarGeo…", percent: 15 });
  // ProcessarGeo também pode demorar a responder o POST além do default HTTP 60s.
  await authenticated((token) =>
    simcarPost(token, `Requerimento/ProcessarGeo/${carId}`, undefined, cfg.processTimeoutMs),
  );

  push({ step: "process_poll", message: "Aguardando processamento no SEMA…", percent: 25 });
  const started = Date.now();
  let raw: Record<string, unknown> = {};
  let lastDet = "";
  while (Date.now() - started < cfg.processTimeoutMs) {
    await args.checkCancelled?.();
    raw = await withSimcarPollRetry(
      () => authenticated((token) => simcarBuscarStatusProcessamento(token, carId)),
      {
        onRetry: ({ attempt, delayMs }) =>
          push({
            step: "process_poll",
            message: `SEMA indisponível no poll de processamento; nova tentativa ${attempt + 1}/3 em ${delayMs}ms…`,
            percent: 25,
          }),
      },
    );
    const st = String(raw.ProcessamentoStatus || "");
    const res = String(raw.ProcessamentoResultado || "");
    const det = String(raw.ProcessamentoDetalhes || "");
    push({
      step: "process_poll",
      message: `Processamento: ${st} ${res} ${det}`.trim(),
      percent: Math.min(85, 25 + Math.floor((Date.now() - started) / 2000)),
      data: { ProcessamentoStatus: st, ProcessamentoResultado: res },
    });
    // precisa CONCLUIDO com detalhes novos (evita pegar run antigo)
    if (st.includes("CONCLUIDO") && det && det !== "1") {
      // se ainda EM_ABERTO com CONCLUIDO de run antigo sem hora, espera um pouco
      if (res.includes("EM_ABERTO") && !/\d{2}:\d{2}/.test(det) && Date.now() - started < 60_000) {
        lastDet = det;
        await sleep(cfg.pollMs);
        continue;
      }
      break;
    }
    lastDet = det;
    await sleep(cfg.pollMs);
  }

  const status = String(raw.ProcessamentoStatus || "");
  const resultado = String(raw.ProcessamentoResultado || "");
  const detalhes = String(raw.ProcessamentoDetalhes || lastDet || "");
  if (!status.includes("CONCLUIDO")) {
    const message = `Timeout no ProcessarGeo (${cfg.processTimeoutMs}ms)`;
    push({ step: "failed", message, percent: 100 });
    throw new Error(message);
  }

  let pdfBuffer: Buffer | undefined;
  let errosZipBuffer: Buffer | null = null;
  try {
    await args.checkCancelled?.();
    push({ step: "download_artifacts", message: "Baixando PDF de processamento…", percent: 90 });
    const dl = await authenticated((token) =>
      simcarDownload(token, `Requerimento/DownloadPdfRelatorioProcessamento/${carId}`),
    );
    pdfBuffer = dl.buffer;
  } catch (e: any) {
    push({ step: "download_artifacts", message: `PDF process: ${e?.message || "falha"}`, percent: 91 });
  }
  try {
    await args.checkCancelled?.();
    const dl = await authenticated((token) =>
      simcarDownload(token, `Requerimento/DownloadArquivoErrosProcessamento/${carId}`),
    );
    errosZipBuffer = dl.buffer;
  } catch {
    errosZipBuffer = null;
  }

  const reallyOk = /FINALIZADO/.test(resultado) && !/COM_PENDENCIA|REPROV/.test(resultado);
  push({
    step: reallyOk ? "process_ok" : "process_fail",
    message: reallyOk ? "Processamento FINALIZADO." : `Processamento: ${resultado}`,
    percent: 100,
  });

  return {
    ok: reallyOk,
    resultado,
    status,
    detalhes,
    raw,
    pdfBuffer,
    errosZipBuffer,
    timeline,
  };
}
