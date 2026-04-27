import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { publishCbersPanToArchive } from "../backend/cbers-archive";
import {
  readDocBySegments,
  saveUserFileFromPath,
  writeDocBySegments,
} from "../backend/local-storage";

function arg(name: string, fallback = ""): string {
  const ix = process.argv.indexOf(`--${name}`);
  return ix >= 0 ? String(process.argv[ix + 1] || "") : fallback;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function safeSegment(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function outputFilename(itemId: string): string {
  const stem = safeSegment(itemId || "CBERS_4A_WPM")
    .replace(/\.(tif|tiff)$/i, "")
    .replace(/_C?342(?:_PAN)?$/i, "")
    .replace(/_PAN$/i, "");
  return `${stem || "CBERS_4A_WPM"}_C342_PAN.TIF`;
}

function validateGeoTiff(filePath: string): void {
  const result = spawnSync("gdalinfo", [filePath], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`GeoTIFF invalido: ${(result.stderr || result.stdout || "").slice(-1200)}`);
  }
}

async function main(): Promise<void> {
  const uid = arg("uid");
  const jobId = arg("job-id");
  const itemId = arg("item-id");
  const sourcePath = arg("source-path");
  const tmpDir = arg("tmp-dir");
  const filename = arg("filename", outputFilename(itemId));

  if (!uid || !jobId || !itemId || !sourcePath) {
    fail("Uso: tsx scripts/complete-cbers-job.ts --uid UID --job-id JOB --item-id ITEM --source-path TIF [--tmp-dir DIR]");
  }
  if (!fs.existsSync(sourcePath)) fail(`GeoTIFF fonte nao encontrado: ${sourcePath}`);

  validateGeoTiff(sourcePath);

  const previous = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]) || {};
  const scene = previous.scene || (Array.isArray(previous.scenes) ? previous.scenes[0]?.scene : undefined) || null;
  const estimate = previous.estimate || (Array.isArray(previous.scenes) ? previous.scenes[0]?.estimate : undefined) || null;

  const stored = saveUserFileFromPath({
    uid,
    area: "cbers/output",
    filename,
    sourcePath,
  });
  const archive = await publishCbersPanToArchive({
    uid,
    jobId,
    itemId,
    geometryHash: previous.geometryHash || undefined,
    outputFilename: filename,
    sourcePath,
  });

  const completedAt = new Date().toISOString();
  const sceneState = {
    itemId,
    scene,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "GeoTIFF concluido.",
    estimate,
    outputUrl: stored.publicUrl,
    outputRelativePath: stored.relativePath,
    outputFilename: filename,
    outputBytes: stored.bytes,
    archive,
    archiveImageId: archive.imageId,
    wmsLayerName: archive.wmsLayerName,
    wmsUrl: archive.wmsPublicUrl,
    wmsDownloadUrl: `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(archive.imageId)}`,
  };

  writeDocBySegments(
    ["users", uid, "cbers_wpm_jobs", jobId],
    {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "GeoTIFF CBERS-4A/WPM concluido.",
      error: null,
      completedAt,
      outputUrl: stored.publicUrl,
      outputRelativePath: stored.relativePath,
      outputFilename: filename,
      outputBytes: stored.bytes,
      archive,
      archiveImageId: archive.imageId,
      wmsLayerName: archive.wmsLayerName,
      wmsUrl: archive.wmsPublicUrl,
      wmsDownloadUrl: `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(archive.imageId)}`,
      scene,
      scenes: [sceneState],
    },
    { merge: true },
  );
  writeDocBySegments(
    ["users", uid, "processing_jobs", jobId],
    {
      status: "completed",
      cancelRequested: false,
      error: null,
      finishedAtMs: Date.now(),
    },
    { merge: true },
  );

  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    ok: true,
    jobId,
    outputRelativePath: stored.relativePath,
    outputBytes: stored.bytes,
    archiveImageId: archive.imageId,
    wmsLayerName: archive.wmsLayerName,
  }));
}

main().catch((error) => fail(String(error?.message || error)));
