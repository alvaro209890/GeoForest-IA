import { assertSimcarCredentials, assertTestCarId, getSimcarOraculoConfig } from "./config";
import {
  getSimcarToken,
  simcarBuscarStatusProcessamento,
  simcarDownload,
  simcarPost,
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
}): Promise<SimcarProcessOutcome> {
  return enqueueSimcar(() => processGeoOnTestProjectUnlocked(args));
}

async function processGeoOnTestProjectUnlocked(args: {
  carId?: string;
  onProgress?: (ev: OraculoProgress) => void;
}): Promise<SimcarProcessOutcome> {
  const cfg = assertSimcarCredentials();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  const timeline: OraculoProgress[] = [];
  const push = (ev: OraculoProgress) => {
    timeline.push(ev);
    args.onProgress?.(ev);
  };

  push({ step: "login", message: "Autenticando no SIMCAR…", percent: 5 });
  const token = await getSimcarToken();

  push({ step: "processar", message: "Disparando ProcessarGeo…", percent: 15 });
  await simcarPost(token, `Requerimento/ProcessarGeo/${carId}`);

  push({ step: "process_poll", message: "Aguardando processamento no SEMA…", percent: 25 });
  const started = Date.now();
  let raw: Record<string, unknown> = {};
  let lastDet = "";
  while (Date.now() - started < cfg.processTimeoutMs) {
    raw = await simcarBuscarStatusProcessamento(token, carId);
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
    push({ step: "error", message: `Timeout no ProcessarGeo (${cfg.processTimeoutMs}ms)`, percent: 100 });
    return { ok: false, resultado, status, detalhes, raw, timeline };
  }

  let pdfBuffer: Buffer | undefined;
  let errosZipBuffer: Buffer | null = null;
  try {
    push({ step: "download_artifacts", message: "Baixando PDF de processamento…", percent: 90 });
    const dl = await simcarDownload(token, `Requerimento/DownloadPdfRelatorioProcessamento/${carId}`);
    pdfBuffer = dl.buffer;
  } catch (e: any) {
    push({ step: "download_artifacts", message: `PDF process: ${e?.message || "falha"}`, percent: 91 });
  }
  try {
    const dl = await simcarDownload(token, `Requerimento/DownloadArquivoErrosProcessamento/${carId}`);
    errosZipBuffer = dl.buffer;
  } catch {
    errosZipBuffer = null;
  }

  const reallyOk = /FINALIZADO/.test(resultado) && !/COM_PENDENCIA|REPROV/.test(resultado);
  push({
    step: "process_done",
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
