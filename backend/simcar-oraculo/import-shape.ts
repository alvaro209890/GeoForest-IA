import { assertSimcarCredentials, assertTestCarId, getSimcarOraculoConfig } from "./config";
import {
  getSimcarToken,
  simcarBuscarStatusProcessamento,
  simcarDownload,
  simcarPost,
  simcarUploadZip,
  withSimcarAuthRetry,
  withSimcarPollRetry,
} from "./client";
import { enqueueSimcar } from "./queue";
import type { OraculoProgress, SimcarImportOutcome } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Importa ZIP no projeto-teste SIMCAR (upload + ImportarArquivoShape + poll).
 * Sempre enfileirado serialmente.
 */
export async function importZipOnTestProject(args: {
  carId?: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (ev: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}): Promise<SimcarImportOutcome> {
  return enqueueSimcar(() => importZipOnTestProjectUnlocked(args));
}

/** Executa com a fila global já adquirida pelo pipeline. Não chamar diretamente fora dele. */
export async function importZipOnTestProjectUnlocked(args: {
  carId?: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (ev: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}): Promise<SimcarImportOutcome> {
  const cfg = assertSimcarCredentials();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  const timeline: OraculoProgress[] = [];
  const push = (ev: OraculoProgress) => {
    timeline.push(ev);
    args.onProgress?.(ev);
  };

  await args.checkCancelled?.();
  push({ step: "login", message: "Autenticando no SIMCAR técnico…", percent: 5 });
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

  // Se já há importação AGUARDANDO/EXECUTANDO (ex.: job anterior abortado no cliente
  // depois de o SEMA ter enfileirado), um novo ImportarArquivoShape devolve 400 genérico.
  // Cancela residual e só então sobe o ZIP novo.
  try {
    const pre = await authenticated((token) => simcarBuscarStatusProcessamento(token, carId));
    const preSt = String(pre.ImportacaoShapeStatus || "");
    if (/AGUARDANDO|EXECUTANDO|EM_ANDAMENTO|PROCESSANDO/i.test(preSt)) {
      push({
        step: "importar",
        message: `Importação residual no SEMA (${preSt}); cancelando antes de reenviar…`,
        percent: 12,
      });
      try {
        await authenticated((token) =>
          simcarPost(token, `Requerimento/CancelarImportacaoShape/${carId}`, undefined, 120_000),
        );
        push({
          step: "importar",
          message: "Importação residual cancelada; seguindo com o ZIP atual.",
          percent: 14,
        });
        await sleep(Math.min(cfg.pollMs, 5000));
      } catch (cancelErr: any) {
        push({
          step: "importar",
          message: `Aviso ao cancelar residual: ${cancelErr?.message || cancelErr}`,
          percent: 14,
        });
      }
    }
  } catch (preErr: any) {
    push({
      step: "importar",
      message: `Aviso ao consultar status pré-import: ${preErr?.message || preErr}`,
      percent: 12,
    });
  }

  await args.checkCancelled?.();
  push({ step: "upload_zip", message: `Enviando ${args.fileName} ao SIMCAR…`, percent: 15 });
  const arquivo = await authenticated((token) => simcarUploadZip(token, args.zip, args.fileName));

  await args.checkCancelled?.();
  push({ step: "importar", message: "Disparando ImportarArquivoShape…", percent: 25 });
  // O POST ImportarArquivoShape no SEMA pode demorar bem mais que o default HTTP (60s):
  // a API só responde depois de enfileirar/aceitar o job. Usamos o mesmo teto do poll.
  try {
    await authenticated((token) =>
      simcarPost(
        token,
        "Requerimento/ImportarArquivoShape",
        {
          RequerimentoId: Number(carId),
          Arquivo: arquivo,
        },
        cfg.importTimeoutMs,
      ),
    );
  } catch (importPostErr: any) {
    // Se o SEMA já enfileirou (AGUARDANDO/EXECUTANDO) e devolve 400, seguimos para o poll.
    const msg = String(importPostErr?.message || importPostErr || "");
    let stNow = "";
    try {
      const cur = await authenticated((token) => simcarBuscarStatusProcessamento(token, carId));
      stNow = String(cur.ImportacaoShapeStatus || "");
    } catch {
      /* ignore */
    }
    if (/AGUARDANDO|EXECUTANDO|EM_ANDAMENTO|PROCESSANDO|CONCLUIDO/i.test(stNow)) {
      push({
        step: "importar",
        message: `POST Importar retornou erro, mas o SEMA já tem status ${stNow}; aguardando poll…`,
        percent: 30,
        data: { postError: msg.slice(0, 300), ImportacaoShapeStatus: stNow },
      });
    } else {
      throw importPostErr;
    }
  }

  push({ step: "import_poll", message: "Aguardando importação no SEMA…", percent: 35 });
  const started = Date.now();
  let raw: Record<string, unknown> = {};
  while (Date.now() - started < cfg.importTimeoutMs) {
    await args.checkCancelled?.();
    raw = await withSimcarPollRetry(
      () => authenticated((token) => simcarBuscarStatusProcessamento(token, carId)),
      {
        onRetry: ({ attempt, delayMs }) =>
          push({
            step: "import_poll",
            message: `SEMA indisponível no poll de importação; nova tentativa ${attempt + 1}/3 em ${delayMs}ms…`,
            percent: 35,
          }),
      },
    );
    const st = String(raw.ImportacaoShapeStatus || "");
    const res = String(raw.ImportacaoResultado || "");
    const det = String(raw.ImportacaoShapeDetalhes || "");
    push({
      step: "import_poll",
      message: `Importação: ${st} ${res} ${det}`.trim(),
      percent: Math.min(85, 35 + Math.floor((Date.now() - started) / 1000)),
      data: { ImportacaoShapeStatus: st, ImportacaoResultado: res },
    });
    if (st.includes("CONCLUIDO")) break;
    await sleep(cfg.pollMs);
  }

  const status = String(raw.ImportacaoShapeStatus || "");
  const resultado = String(raw.ImportacaoResultado || "");
  const detalhes = String(raw.ImportacaoShapeDetalhes || "");
  if (!status.includes("CONCLUIDO")) {
    const message = `Timeout na importação SIMCAR (${cfg.importTimeoutMs}ms)`;
    push({ step: "failed", message, percent: 100 });
    throw new Error(message);
  }

  let pdfBuffer: Buffer | undefined;
  try {
    await args.checkCancelled?.();
    push({ step: "download_artifacts", message: "Baixando PDF de importação…", percent: 90 });
    const dl = await authenticated((token) =>
      simcarDownload(token, `Requerimento/DownloadPdfImportacaoShapefile/${carId}`),
    );
    pdfBuffer = dl.buffer;
  } catch (e: any) {
    push({
      step: "download_artifacts",
      message: `PDF import: ${e?.message || "falha"}`,
      percent: 92,
    });
  }

  const ok = resultado.includes("FINALIZADO") && !resultado.includes("COM_PENDENCIA");
  // FINALIZADO sozinho = sucesso; COM_PENDENCIA = reprovado na prática
  const reallyOk = /FINALIZADO/.test(resultado) && !/COM_PENDENCIA|REPROV/.test(resultado);
  push({
    step: reallyOk ? "import_ok" : "import_fail",
    message: reallyOk
      ? "Importação FINALIZADA no SIMCAR."
      : `Importação concluída com pendência: ${resultado}`,
    percent: 100,
  });

  return {
    ok: reallyOk || ok,
    resultado,
    status,
    detalhes,
    raw,
    pdfBuffer,
    timeline,
  };
}
