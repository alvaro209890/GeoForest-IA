import { assertSimcarCredentials, assertTestCarId, getSimcarOraculoConfig } from "./config";
import {
  getSimcarToken,
  simcarBuscarStatusProcessamento,
  simcarDownload,
  simcarPost,
  simcarUploadZip,
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
}): Promise<SimcarImportOutcome> {
  return enqueueSimcar(() => importZipOnTestProjectUnlocked(args));
}

async function importZipOnTestProjectUnlocked(args: {
  carId?: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (ev: OraculoProgress) => void;
}): Promise<SimcarImportOutcome> {
  const cfg = assertSimcarCredentials();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  const timeline: OraculoProgress[] = [];
  const push = (ev: OraculoProgress) => {
    timeline.push(ev);
    args.onProgress?.(ev);
  };

  push({ step: "login", message: "Autenticando no SIMCAR técnico…", percent: 5 });
  const token = await getSimcarToken();

  push({ step: "upload_zip", message: `Enviando ${args.fileName} ao SIMCAR…`, percent: 15 });
  const arquivo = await simcarUploadZip(token, args.zip, args.fileName);

  push({ step: "importar", message: "Disparando ImportarArquivoShape…", percent: 25 });
  await simcarPost(token, "Requerimento/ImportarArquivoShape", {
    RequerimentoId: Number(carId),
    Arquivo: arquivo,
  });

  push({ step: "import_poll", message: "Aguardando importação no SEMA…", percent: 35 });
  const started = Date.now();
  let raw: Record<string, unknown> = {};
  while (Date.now() - started < cfg.importTimeoutMs) {
    raw = await simcarBuscarStatusProcessamento(token, carId);
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
    push({ step: "error", message: `Timeout na importação SIMCAR (${cfg.importTimeoutMs}ms)`, percent: 100 });
    return { ok: false, resultado, status, detalhes, raw, timeline };
  }

  let pdfBuffer: Buffer | undefined;
  try {
    push({ step: "download_artifacts", message: "Baixando PDF de importação…", percent: 90 });
    const dl = await simcarDownload(token, `Requerimento/DownloadPdfImportacaoShapefile/${carId}`);
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
    step: "import_done",
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
