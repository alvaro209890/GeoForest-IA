/**
 * Execução de comandos GDAL e leitura de bounds do raster.
 */
import { spawn } from "node:child_process";
import { isCancelRequested } from "../processing-jobs";
import { CBERS_PANSHARPEN_ESTIMATE_MS, CBERS_TRANSLATE_ESTIMATE_MS } from "./constants";
import { progress, throwIfCancelled } from "./sse";
import { CbersCancelError, CbersProgressPatch } from "./types";
import { gdalCommandEnv } from "./utils";

/** Preserva a causa (início) e o contexto final sem persistir megabytes de progresso. */
export function formatCommandFailure(
  command: string,
  code: number | null,
  output: string
): string {
  const clean = String(output || "").trim();
  const excerpt =
    clean.length <= 4000
      ? clean
      : `${clean.slice(0, 2000)}\n... saída intermediária omitida ...\n${clean.slice(-2000)}`;
  return `${command} falhou com codigo ${code}: ${excerpt}`;
}

export async function runCommand(args: {
  uid: string;
  jobId: string;
  command: string;
  commandArgs: string[];
  basePercent: number;
  spanPercent: number;
  stage: string;
  message: string;
  onProgress?: (patch: CbersProgressPatch) => void;
}): Promise<void> {
  throwIfCancelled(args.jobId);
  const report = (patch: CbersProgressPatch) => {
    if (args.onProgress) {
      args.onProgress(patch);
    } else {
      progress(args.uid, args.jobId, patch);
    }
  };

  report({
    stage: args.stage,
    percent: args.basePercent,
    message: args.message,
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(args.command, args.commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: gdalCommandEnv(),
    });
    let output = "";
    let maxReportedPercent = args.basePercent;
    let lastInnerProgress = 0;
    let settled = false;
    const startedAt = Date.now();
    let cancelTimer: ReturnType<typeof setInterval> | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const estimatedDurationMs =
      args.command === "gdal_pansharpen.py"
        ? CBERS_PANSHARPEN_ESTIMATE_MS
        : args.command === "gdal_translate"
          ? CBERS_TRANSLATE_ESTIMATE_MS
          : 0;
    const reportCommandProgress = (innerProgress: number, message = args.message) => {
      const boundedInner = Math.max(0, Math.min(100, innerProgress));
      const nextPercent = Math.max(
        maxReportedPercent,
        args.basePercent + (boundedInner / 100) * args.spanPercent,
      );
      maxReportedPercent = nextPercent;
      report({
        stage: args.stage,
        percent: nextPercent,
        message,
      });
    };
    const cleanup = () => {
      if (cancelTimer) clearInterval(cancelTimer);
      if (progressTimer) clearInterval(progressTimer);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      const matches = [...text.matchAll(/(\d{1,3})(?=\.\.\.)/g)];
      const latest = matches.at(-1);
      if (latest) {
        const inner = Math.max(0, Math.min(100, Number(latest[1])));
        lastInnerProgress = Math.max(lastInnerProgress, inner);
        reportCommandProgress(lastInnerProgress);
      }
    };
    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);
    child.on("error", (error) => finish(() => reject(error)));
    cancelTimer = setInterval(() => {
      if (!isCancelRequested(args.jobId)) return;
      child.kill("SIGTERM");
      finish(() => reject(new CbersCancelError()));
    }, 1000);
    progressTimer =
      args.spanPercent > 0 && estimatedDurationMs > 0
        ? setInterval(() => {
            if (settled) return;
            const elapsedMs = Date.now() - startedAt;
            const estimatedInner = Math.min(92, (elapsedMs / estimatedDurationMs) * 100);
            if (estimatedInner <= lastInnerProgress) return;
            lastInnerProgress = estimatedInner;
            reportCommandProgress(
              estimatedInner,
              `${args.message} Progresso estimado enquanto o GDAL processa a folha completa.`,
            );
          }, 5000)
        : null;
    child.on("close", (code) => {
      if (code === 0) {
        finish(() => resolve());
        return;
      }
      finish(() => reject(new Error(formatCommandFailure(args.command, code, output))));
    });
  });

  throwIfCancelled(args.jobId);
  report({
    stage: args.stage,
    percent: args.basePercent + args.spanPercent,
    message: args.message,
  });
}

export async function runCommandCapture(command: string, commandArgs: string[], jobId: string): Promise<string> {
  throwIfCancelled(jobId);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: gdalCommandEnv(),
    });
    let output = "";
    let errorOutput = "";
    const keepOutput = (chunk: Buffer, target: "out" | "err") => {
      if (target === "out") output += chunk.toString("utf8");
      else errorOutput += chunk.toString("utf8");
      if (output.length > 2_000_000) output = output.slice(-2_000_000);
      if (errorOutput.length > 8000) errorOutput = errorOutput.slice(-8000);
    };
    const cancelTimer = setInterval(() => {
      if (!isCancelRequested(jobId)) return;
      child.kill("SIGTERM");
      reject(new CbersCancelError());
    }, 1000);
    child.stdout.on("data", (chunk) => keepOutput(chunk, "out"));
    child.stderr.on("data", (chunk) => keepOutput(chunk, "err"));
    child.on("error", (error) => {
      clearInterval(cancelTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearInterval(cancelTimer);
      if (code === 0) resolve(output);
      else reject(new Error(formatCommandFailure(command, code, errorOutput)));
    });
  });
}

export type RasterBoundsInfo = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  pixelSizeX: number;
  pixelSizeY: number;
  epsg?: number;
  projection?: string;
};

export function boundsFromGdalInfoJson(info: any): RasterBoundsInfo | null {
  const size = Array.isArray(info?.size) ? info.size : [];
  const width = Number(size[0]);
  const height = Number(size[1]);
  const corners = info?.cornerCoordinates || {};
  const ul = Array.isArray(corners.upperLeft) ? corners.upperLeft : null;
  const lr = Array.isArray(corners.lowerRight) ? corners.lowerRight : null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !ul || !lr) return null;
  const minX = Math.min(Number(ul[0]), Number(lr[0]));
  const maxX = Math.max(Number(ul[0]), Number(lr[0]));
  const minY = Math.min(Number(ul[1]), Number(lr[1]));
  const maxY = Math.max(Number(ul[1]), Number(lr[1]));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const geoTransform = Array.isArray(info?.geoTransform) ? info.geoTransform.map((value: unknown) => Number(value)) : [];
  const pixelSizeX = Number.isFinite(geoTransform[1]) && geoTransform[1] !== 0
    ? Math.abs(geoTransform[1])
    : Math.abs((maxX - minX) / width);
  const pixelSizeY = Number.isFinite(geoTransform[5]) && geoTransform[5] !== 0
    ? Math.abs(geoTransform[5])
    : Math.abs((maxY - minY) / height);
  if (![pixelSizeX, pixelSizeY].every(Number.isFinite)) return null;
  const epsg = Number(info?.stac?.["proj:epsg"]);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    pixelSizeX,
    pixelSizeY,
    epsg: Number.isFinite(epsg) ? epsg : undefined,
    projection: String(info?.coordinateSystem?.wkt || ""),
  };
}

export async function readRasterBoundsInfo(rasterPath: string, jobId: string): Promise<RasterBoundsInfo | null> {
  const output = await runCommandCapture("gdalinfo", ["-json", rasterPath], jobId);
  try {
    return boundsFromGdalInfoJson(JSON.parse(output));
  } catch {
    return null;
  }
}
