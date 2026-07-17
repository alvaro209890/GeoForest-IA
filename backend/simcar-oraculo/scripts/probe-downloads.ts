/**
 * Probe LIVE somente-leitura dos downloads oficiais do CAR-teste.
 *
 * Uso (credenciais sempre via env gitignored):
 *   SIMCAR_LIVE=1 npx tsx backend/simcar-oraculo/scripts/probe-downloads.ts
 */
import crypto from "node:crypto";
import { assertTestCarId, getSimcarOraculoConfig } from "../config";
import { SimcarHttpError, simcarDownload, withSimcarAuthRetry } from "../client";

const DOWNLOADS = [
  ["pdfImportacao", "Requerimento/DownloadPdfImportacaoShapefile"],
  ["pdfProcessamento", "Requerimento/DownloadPdfRelatorioProcessamento"],
  ["errosProcessamento", "Requerimento/DownloadArquivoErrosProcessamento"],
  ["arquivoEnviado", "Requerimento/DownloadArquivoEnviado"],
  ["arquivoProcessado", "Requerimento/DownloadArquivoProcessado"],
  ["arquivoConferencia", "Requerimento/DownloadArquivoConferencia"],
  ["arquivoPendencias", "Requerimento/DownloadArquivoPendencias"],
] as const;

function requireLiveGuard(): string {
  if (process.env.SIMCAR_LIVE !== "1") {
    throw new Error("Probe bloqueado: defina SIMCAR_LIVE=1 conscientemente.");
  }
  const carId = assertTestCarId(getSimcarOraculoConfig().testCarId);
  if (carId !== "270069") {
    throw new Error(`Probe bloqueado: CAR-teste esperado 270069; configurado ${carId}.`);
  }
  return carId;
}

function magic(buffer: Buffer): "pdf" | "zip" | "outro" {
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (buffer.subarray(0, 2).toString("ascii") === "PK") return "zip";
  return "outro";
}

async function main(): Promise<void> {
  const carId = requireLiveGuard();
  const results: Array<Record<string, unknown>> = [];
  for (const [key, pathname] of DOWNLOADS) {
    try {
      const downloaded = await withSimcarAuthRetry((token) =>
        simcarDownload(token, `${pathname}/${carId}`),
      );
      results.push({
        key,
        available: true,
        bytes: downloaded.buffer.length,
        contentType: downloaded.contentType,
        magic: magic(downloaded.buffer),
        sha256: crypto.createHash("sha256").update(downloaded.buffer).digest("hex"),
      });
    } catch (error) {
      results.push({
        key,
        available: false,
        httpStatus: error instanceof SimcarHttpError ? error.status : null,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  console.log(JSON.stringify({ carId, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
