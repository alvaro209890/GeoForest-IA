/**
 * Composição RGB: download das bandas, gdalbuildvrt e gdal_translate -scale.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LANDSAT_DOWNLOAD_RETRIES, LANDSAT_MIN_DOWNLOAD_BYTES, LANDSAT_SCALE_MAX, LANDSAT_SCALE_MIN } from "./constants";
import { buildLandsatOutputFilename, landsatAssetKeysForComposition } from "./naming";
import { LandsatProgressPatch, LandsatScene } from "./types";

export function gdalEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GDAL_DISABLE_READDIR_ON_OPEN: process.env.GDAL_DISABLE_READDIR_ON_OPEN || "EMPTY_DIR",
    GDAL_HTTP_MAX_RETRY: process.env.GDAL_HTTP_MAX_RETRY || "8",
    GDAL_HTTP_RETRY_DELAY: process.env.GDAL_HTTP_RETRY_DELAY || "2",
    GDAL_HTTP_CONNECTTIMEOUT: process.env.GDAL_HTTP_CONNECTTIMEOUT || "20",
    GDAL_HTTP_TIMEOUT: process.env.GDAL_HTTP_TIMEOUT || "300",
  };
}

export async function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: gdalEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 8000) output = output.slice(-8000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} falhou com codigo ${code}: ${output.slice(-1500)}`));
    });
  });
}

export async function downloadFile(url: string, destPath: string): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= LANDSAT_DOWNLOAD_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`Download ${response.status}: ${url}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (/text\/html|application\/json|application\/xml|text\/xml/i.test(contentType)) {
        throw new Error(`Download Landsat retornou ${contentType || "conteudo invalido"} em vez de GeoTIFF.`);
      }
      await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(destPath));
      const size = fs.statSync(destPath).size;
      if (LANDSAT_MIN_DOWNLOAD_BYTES > 0 && size < LANDSAT_MIN_DOWNLOAD_BYTES) {
        throw new Error(`Download Landsat muito pequeno (${size} bytes); arquivo remoto nao parece ser uma banda GeoTIFF.`);
      }
      return size;
    } catch (error) {
      lastError = error;
      try { fs.rmSync(destPath, { force: true }); } catch {}
      if (attempt >= LANDSAT_DOWNLOAD_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Falha ao baixar ${url}`);
}


export async function createLandsatComposite(args: {
  item: any;
  scene: LandsatScene;
  tmpDir: string;
  onProgress: (patch: LandsatProgressPatch) => void;
}): Promise<{ outputPath: string; outputFilename: string; bytes: number }> {
  const keys = landsatAssetKeysForComposition(args.scene.composition);
  const bandPaths: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const href = args.item?.assets?.[key]?.href;
    if (!href) throw new Error(`Asset Landsat ausente: ${key}.`);
    const bandPath = path.join(args.tmpDir, `${i + 1}_${key}.TIF`);
    args.onProgress({
      stage: "download",
      percent: 12 + i * 12,
      message: `Baixando banda ${key.toUpperCase()} do Landsat.`,
    });
    await downloadFile(href, bandPath);
    bandPaths.push(bandPath);
  }

  const vrtPath = path.join(args.tmpDir, "landsat_rgb.vrt");
  const tmpTifPath = path.join(args.tmpDir, buildLandsatOutputFilename(args.scene.id, args.scene.composition));
  args.onProgress({ stage: "compose", percent: 55, message: "Montando composição RGB Landsat." });
  await runCommand("gdalbuildvrt", ["-separate", vrtPath, ...bandPaths], args.tmpDir);
  await runCommand("gdal_translate", [
    "-of", "GTiff",
    "-ot", "Byte",
    "-scale", String(LANDSAT_SCALE_MIN), String(LANDSAT_SCALE_MAX), "1", "255",
    "-a_nodata", "0",
    "-co", "TILED=YES",
    "-co", "COMPRESS=LZW",
    "-co", "BIGTIFF=IF_SAFER",
    vrtPath,
    tmpTifPath,
  ], args.tmpDir);
  await runCommand("gdal_edit.py", [
    "-colorinterp_1", "red",
    "-colorinterp_2", "green",
    "-colorinterp_3", "blue",
    tmpTifPath,
  ], args.tmpDir);
  args.onProgress({ stage: "overviews", percent: 72, message: "Criando pirâmides de visualização Landsat." });
  await runCommand("gdaladdo", [
    "-ro",
    "-r", "average",
    "--config", "COMPRESS_OVERVIEW", "LZW",
    tmpTifPath,
    "2", "4", "8", "16", "32", "64", "128",
  ], args.tmpDir);
  return { outputPath: tmpTifPath, outputFilename: path.basename(tmpTifPath), bytes: fs.statSync(tmpTifPath).size };
}
