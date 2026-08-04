/**
 * Download das bandas (BAND3/4/2 + BAND0 PAN) com retry e detecção de stall.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { isCancelRequested } from "../processing-jobs";
import { CBERS_DOWNLOAD_RETRIES, CBERS_DOWNLOAD_RETRY_DELAY_MS, CBERS_DOWNLOAD_STALL_TIMEOUT_MS } from "./constants";
import { runCommand } from "./gdal";
import { progress, throwIfCancelled } from "./sse";
import { CbersCancelError, CbersProgressPatch } from "./types";
import { bytesToMb, fileSizeSafe, sleep } from "./utils";

export async function downloadAsset(args: {
  uid: string;
  jobId: string;
  assetKey: string;
  url: string;
  filePath: string;
  basePercent: number;
  spanPercent: number;
  expectedBytes?: number | null;
  onProgress?: (patch: CbersProgressPatch) => void;
}): Promise<void> {
  const expectedBytes = Number.isFinite(Number(args.expectedBytes)) ? Number(args.expectedBytes) : null;
  const completeExistingFile =
    expectedBytes !== null &&
    fs.existsSync(args.filePath) &&
    fs.statSync(args.filePath).size === expectedBytes;

  const report = (patch: CbersProgressPatch) => {
    if (args.onProgress) {
      args.onProgress(patch);
    } else {
      progress(args.uid, args.jobId, patch);
    }
  };

  if (completeExistingFile) {
    report({
      stage: "download",
      percent: args.basePercent + args.spanPercent,
      message: `${args.assetKey} já estava baixada; reutilizando arquivo existente.`,
    });
    return;
  }

  const tempPath = `${args.filePath}.part`;
  const totalAttempts = CBERS_DOWNLOAD_RETRIES + 1;
  let maxObservedBytes = Math.max(fileSizeSafe(args.filePath), fileSizeSafe(tempPath));
  let maxReportedPercent = args.basePercent;
  const percentForBytes = (bytes: number): number =>
    expectedBytes
      ? args.basePercent + Math.min(1, Math.max(0, bytes) / expectedBytes) * args.spanPercent
      : args.basePercent;
  const reportDownload = (patch: CbersProgressPatch) => {
    const nextPercent = typeof patch.percent === "number" ? patch.percent : maxReportedPercent;
    maxReportedPercent = Math.max(maxReportedPercent, nextPercent);
    report({ ...patch, percent: maxReportedPercent });
  };

  if (fs.existsSync(args.filePath) && expectedBytes !== null) {
    const currentSize = fs.statSync(args.filePath).size;
    if (currentSize > 0 && currentSize < expectedBytes) {
      const tempSize = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
      if (currentSize > tempSize) fs.renameSync(args.filePath, tempPath);
    }
  }
  if (expectedBytes !== null && fs.existsSync(tempPath) && fs.statSync(tempPath).size > expectedBytes) {
    fs.rmSync(tempPath, { force: true });
  }
  maxObservedBytes = Math.max(maxObservedBytes, fileSizeSafe(tempPath));

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    throwIfCancelled(args.jobId);
    reportDownload({
      stage: "download",
      percent: percentForBytes(maxObservedBytes),
      message:
        attempt === 1
          ? `Baixando ${args.assetKey} com retomada automática.`
          : `Retomando ${args.assetKey} de ${bytesToMb(maxObservedBytes)} MB. Tentativa ${attempt}/${totalAttempts}.`,
    });
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "cbers_download_attempt_started",
      jobId: args.jobId,
      assetKey: args.assetKey,
      attempt,
      totalAttempts,
      partialBytes: maxObservedBytes,
      expectedBytes,
    }));

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "curl",
          [
            "-L",
            "-C", "-",
            "--fail",
            "--connect-timeout", "20",
            "--speed-time", "120",
            "--speed-limit", "1024",
            "-sS",
            "-o", tempPath,
            args.url,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        let output = "";
        let lastObservedThisAttempt = maxObservedBytes;
        let lastGrowthAtMs = Date.now();
        let stalledMessage = "";
        const progressTimer = setInterval(() => {
          const actualBytes = fileSizeSafe(tempPath);
          if (actualBytes > maxObservedBytes) {
            maxObservedBytes = actualBytes;
            lastGrowthAtMs = Date.now();
          }
          if (actualBytes < lastObservedThisAttempt) {
            console.warn(JSON.stringify({
              ts: new Date().toISOString(),
              level: "warn",
              event: "cbers_download_progress_regressed",
              jobId: args.jobId,
              assetKey: args.assetKey,
              attempt,
              previousBytes: lastObservedThisAttempt,
              actualBytes,
              keptBytes: maxObservedBytes,
            }));
          }
          lastObservedThisAttempt = actualBytes;
          const progressBytes = Math.max(actualBytes, maxObservedBytes);
          const stalledMs = Date.now() - lastGrowthAtMs;
          reportDownload({
            stage: "download",
            percent: percentForBytes(progressBytes),
            message: expectedBytes
              ? `Baixando ${args.assetKey}: ${bytesToMb(progressBytes)} MB de ${bytesToMb(expectedBytes)} MB.`
              : `Baixando ${args.assetKey}: ${bytesToMb(progressBytes)} MB.`,
          });
          if (!stalledMessage && stalledMs >= CBERS_DOWNLOAD_STALL_TIMEOUT_MS) {
            stalledMessage = `Download de ${args.assetKey} sem avanço por ${Math.round(stalledMs / 1000)}s; reiniciando tentativa.`;
            child.kill("SIGTERM");
          }
        }, 2000);
        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (output.length > 4000) output = output.slice(-4000);
        });
        child.on("error", (error) => {
          clearInterval(progressTimer);
          reject(error);
        });
        const cancelTimer = setInterval(() => {
          if (!isCancelRequested(args.jobId)) return;
          child.kill("SIGTERM");
          reject(new CbersCancelError());
        }, 1000);
        child.on("close", (code) => {
          clearInterval(progressTimer);
          clearInterval(cancelTimer);
          if (stalledMessage) {
            reject(new Error(stalledMessage));
            return;
          }
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`curl falhou ao baixar ${args.assetKey} (codigo ${code}): ${output.slice(-1200)}`));
        });
      });
      break;
    } catch (error) {
      maxObservedBytes = Math.max(maxObservedBytes, fileSizeSafe(tempPath));
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "cbers_download_attempt_failed",
        jobId: args.jobId,
        assetKey: args.assetKey,
        attempt,
        totalAttempts,
        partialBytes: maxObservedBytes,
        message: String((error as Error)?.message || error),
      }));
      if (error instanceof CbersCancelError || attempt >= totalAttempts) throw error;
      reportDownload({
        stage: "download",
        percent: percentForBytes(maxObservedBytes),
        message: `Conexao interrompida em ${args.assetKey}. Retomando de ${bytesToMb(maxObservedBytes)} MB.`,
      });
      await sleep(CBERS_DOWNLOAD_RETRY_DELAY_MS);
    }
  }

  const savedBytes = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
  if (expectedBytes !== null && savedBytes !== expectedBytes) {
    throw new Error(`Download incompleto de ${args.assetKey}: ${savedBytes} de ${expectedBytes} bytes.`);
  }
  fs.renameSync(tempPath, args.filePath);

  try {
    await runCommand({
      uid: args.uid,
      jobId: args.jobId,
      command: "gdalinfo",
      commandArgs: [args.filePath],
      basePercent: args.basePercent + args.spanPercent,
      spanPercent: 0,
      stage: "download",
      message: `Validando ${args.assetKey}.`,
      onProgress: args.onProgress,
    });
  } catch (error) {
    const corruptPath = `${args.filePath}.corrupt`;
    try {
      fs.renameSync(args.filePath, corruptPath);
    } catch {
      // Keep original validation error.
    }
    throw error;
  }
}
