#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const STORAGE_ROOT = process.env.LOCAL_DATA_ROOT || "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest";
const PUBLIC_API_BASE_URL = String(process.env.PUBLIC_API_BASE_URL || process.env.VITE_API_BASE || "https://geoforest-api.cursar.space").replace(/\/+$/, "");
const STAC_ROOT = String(process.env.CBERS_STAC_ROOT || "https://data.inpe.br/bdc/stac/v1").replace(/\/+$/, "");
const CBERS_COLLECTION = "CB4A-WPM-L4-DN-1";
const REQUIRED_ASSETS = ["BAND3", "BAND4", "BAND2", "BAND0"];
const CBERS_DOWNLOAD_RETRIES = Math.max(0, Number(process.env.CBERS_DOWNLOAD_RETRIES || 3));
const CBERS_DOWNLOAD_RETRY_DELAY_MS = Math.max(1000, Number(process.env.CBERS_DOWNLOAD_RETRY_DELAY_MS || 3000));

function arg(name, fallback = "") {
  const ix = process.argv.indexOf(`--${name}`);
  return ix >= 0 ? String(process.argv[ix + 1] || "") : fallback;
}

const uid = arg("uid");
const jobId = arg("job-id");
const itemId = arg("item-id");
const sceneDir = arg("scene-dir");

if (!uid || !jobId || !itemId || !sceneDir) {
  console.error("Uso: resume-cbers-job.mjs --uid UID --job-id JOB --item-id ITEM --scene-dir DIR");
  process.exit(2);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSegment(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}

function fileSizeSafe(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function bytesToMb(bytes) {
  return (Math.max(0, Number(bytes) || 0) / 1024 / 1024).toFixed(1);
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const userDir = path.join(STORAGE_ROOT, "users", safeSegment(uid));
const cbersJobPath = path.join(userDir, "cbers_wpm_jobs", `${safeSegment(jobId)}.json`);
const processingJobPath = path.join(userDir, "processing_jobs", `${safeSegment(jobId)}.json`);

function patchDoc(filePath, patch) {
  const now = new Date().toISOString();
  const previous = readJson(filePath, {});
  writeJsonAtomic(filePath, {
    ...previous,
    ...patch,
    updatedAt: now,
    updatedAtMs: Date.now(),
  });
}

function patchJob(patch) {
  const scenePatch = patch.scenePatch;
  const jobPatch = { ...patch };
  delete jobPatch.scenePatch;
  const previous = readJson(cbersJobPath, {});
  const scenes = Array.isArray(previous.scenes) && previous.scenes.length
    ? previous.scenes
    : [{ itemId, status: "processing", percent: 1 }];
  const nextScenes = scenes.map((scene) => {
    if (String(scene.itemId || "") !== itemId) return scene;
    return {
      ...scene,
      status: "processing",
      ...(scenePatch || {}),
      itemId,
    };
  });
  patchDoc(cbersJobPath, {
    status: "processing",
    itemId,
    itemIds: [itemId],
    mode: "single",
    scenes: nextScenes,
    error: null,
    ...jobPatch,
  });
  patchDoc(processingJobPath, {
    uid,
    jobId,
    endpoint: "/api/cbers-wpm/jobs",
    status: "running",
    cancelRequested: false,
    clientDisconnected: false,
    error: null,
    finishedAtMs: null,
    metadata: { itemId, itemIds: [itemId], filename: previous.filename || "AIR.zip" },
  });
}

function gdalEnv() {
  return {
    ...process.env,
    GDAL_DISABLE_READDIR_ON_OPEN: process.env.GDAL_DISABLE_READDIR_ON_OPEN || "EMPTY_DIR",
    GDAL_HTTP_MAX_RETRY: process.env.GDAL_HTTP_MAX_RETRY || "8",
    GDAL_HTTP_RETRY_DELAY: process.env.GDAL_HTTP_RETRY_DELAY || "2",
    GDAL_HTTP_CONNECTTIMEOUT: process.env.GDAL_HTTP_CONNECTTIMEOUT || "20",
    GDAL_HTTP_TIMEOUT: process.env.GDAL_HTTP_TIMEOUT || "300",
  };
}

function run(command, args, opts) {
  const { stage, basePercent, spanPercent, message } = opts;
  patchJob({ stage, percent: basePercent, message, scenePatch: { stage, percent: basePercent, message } });
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: gdalEnv() });
    let output = "";
    const onChunk = (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
      if (output.length > 6000) output = output.slice(-6000);
      const matches = [...text.matchAll(/(\d{1,3})(?=\.\.\.)/g)];
      const latest = matches.at(-1);
      if (latest) {
        const inner = Math.max(0, Math.min(100, Number(latest[1])));
        const pct = basePercent + (inner / 100) * spanPercent;
        patchJob({ stage, percent: pct, message, scenePatch: { stage, percent: Math.round(pct), message } });
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} falhou com codigo ${code}: ${output.slice(-1200)}`));
    });
  }).then(() => {
    patchJob({ stage, percent: basePercent + spanPercent, message, scenePatch: { stage, percent: Math.round(basePercent + spanPercent), message } });
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`STAC ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function headLength(url) {
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-length") || 0);
  return Number.isFinite(size) && size > 0 ? size : null;
}

async function downloadAsset(key, url, targetPath, expectedBytes, basePercent, spanPercent) {
  const partPath = `${targetPath}.part`;
  const totalAttempts = CBERS_DOWNLOAD_RETRIES + 1;
  let maxObservedBytes = Math.max(fileSizeSafe(targetPath), fileSizeSafe(partPath));
  if (fs.existsSync(targetPath) && expectedBytes && fs.statSync(targetPath).size === expectedBytes) {
    patchJob({ stage: "download", percent: basePercent + spanPercent, message: `${key} já estava baixada.`, scenePatch: { stage: "download", percent: Math.round(basePercent + spanPercent), message: `${key} já estava baixada.` } });
    return;
  }
  if (fs.existsSync(targetPath) && expectedBytes) {
    const currentSize = fs.statSync(targetPath).size;
    const partSize = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    if (currentSize > 0 && currentSize < expectedBytes && currentSize > partSize) {
      fs.renameSync(targetPath, partPath);
    }
  }
  if (expectedBytes && fs.existsSync(partPath) && fs.statSync(partPath).size > expectedBytes) {
    fs.rmSync(partPath, { force: true });
  }
  maxObservedBytes = Math.max(maxObservedBytes, fileSizeSafe(partPath));

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    patchJob({
      stage: "download",
      percent: basePercent,
      message: attempt === 1
        ? `Baixando ${key} com retomada automática.`
        : `Retomando ${key} de ${bytesToMb(maxObservedBytes)} MB. Tentativa ${attempt}/${totalAttempts}.`,
      scenePatch: { stage: "download", percent: basePercent, message: `Baixando ${key}.` },
    });
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "cbers_resume_download_attempt_started",
      jobId,
      assetKey: key,
      attempt,
      totalAttempts,
      partialBytes: maxObservedBytes,
      expectedBytes,
    }));
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("curl", [
          "-L", "-C", "-", "--fail",
          "--connect-timeout", "20",
          "--speed-time", "120", "--speed-limit", "1024",
          "-sS", "-o", partPath, url,
        ], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        let lastObservedThisAttempt = maxObservedBytes;
        const timer = setInterval(() => {
          const actualBytes = fileSizeSafe(partPath);
          if (actualBytes > maxObservedBytes) maxObservedBytes = actualBytes;
          if (actualBytes < lastObservedThisAttempt) {
            console.warn(JSON.stringify({
              ts: new Date().toISOString(),
              level: "warn",
              event: "cbers_resume_download_progress_regressed",
              jobId,
              assetKey: key,
              attempt,
              previousBytes: lastObservedThisAttempt,
              actualBytes,
              keptBytes: maxObservedBytes,
            }));
          }
          lastObservedThisAttempt = actualBytes;
          const progressBytes = Math.max(actualBytes, maxObservedBytes);
          const pct = expectedBytes ? basePercent + Math.min(1, progressBytes / expectedBytes) * spanPercent : basePercent;
          patchJob({
            stage: "download",
            percent: pct,
            message: expectedBytes
              ? `Baixando ${key}: ${bytesToMb(progressBytes)} MB de ${bytesToMb(expectedBytes)} MB.`
              : `Baixando ${key}: ${bytesToMb(progressBytes)} MB.`,
            scenePatch: { stage: "download", percent: Math.round(pct), message: `Baixando ${key}.` },
          });
        }, 3000);
        child.stderr.on("data", (chunk) => { err += chunk.toString("utf8"); if (err.length > 4000) err = err.slice(-4000); });
        child.on("error", (error) => { clearInterval(timer); reject(error); });
        child.on("close", (code) => {
          clearInterval(timer);
          if (code === 0) return resolve();
          reject(new Error(`curl ${key} falhou (${code}): ${err.slice(-1000)}`));
        });
      });
      break;
    } catch (error) {
      maxObservedBytes = Math.max(maxObservedBytes, fileSizeSafe(partPath));
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "cbers_resume_download_attempt_failed",
        jobId,
        assetKey: key,
        attempt,
        totalAttempts,
        partialBytes: maxObservedBytes,
        message: String(error?.message || error),
      }));
      if (attempt >= totalAttempts) throw error;
      patchJob({
        stage: "download",
        percent: expectedBytes ? basePercent + Math.min(1, maxObservedBytes / expectedBytes) * spanPercent : basePercent,
        message: `Conexão interrompida em ${key}. Retomando de ${bytesToMb(maxObservedBytes)} MB.`,
        scenePatch: { stage: "download", percent: Math.round(basePercent), message: `Retomando ${key}.` },
      });
      await sleep(CBERS_DOWNLOAD_RETRY_DELAY_MS);
    }
  }
  const saved = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  if (expectedBytes && saved !== expectedBytes) {
    throw new Error(`Download incompleto de ${key}: ${saved} de ${expectedBytes} bytes.`);
  }
  fs.renameSync(partPath, targetPath);
  await run("gdalinfo", [targetPath], {
    stage: "download",
    basePercent: basePercent + spanPercent,
    spanPercent: 0,
    message: `Validando ${key}.`,
  });
}

function outputFilename(id) {
  const stem = safeSegment(id, "CBERS_4A_WPM").replace(/\.(tif|tiff)$/i, "").replace(/_C?342(?:_PAN)?$/i, "").replace(/_PAN$/i, "");
  return `${stem}_C342_PAN.TIF`;
}

function saveUserFile(sourcePath, filename) {
  const cleanName = safeSegment(filename);
  const rel = path.posix.join("users", safeSegment(uid), "cbers/output", cleanName);
  const dest = path.join(userDir, "cbers/output", cleanName);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(sourcePath, dest);
  const bytes = fs.statSync(dest).size;
  return {
    relativePath: rel,
    absolutePath: dest,
    publicUrl: `${PUBLIC_API_BASE_URL}/api/storage/${rel}`,
    bytes,
  };
}

async function main() {
  ensureDir(sceneDir);
  patchJob({ stage: "scene", percent: 5, message: "Retomando processamento CBERS no servidor.", scenePatch: { stage: "scene", percent: 5, message: "Retomando processamento." } });

  const item = await fetchJson(`${STAC_ROOT}/collections/${encodeURIComponent(CBERS_COLLECTION)}/items/${encodeURIComponent(itemId)}`);
  const assets = item.assets || {};
  const bandPaths = {};
  const plan = [
    { key: "BAND3", start: 8, span: 10 },
    { key: "BAND4", start: 18, span: 10 },
    { key: "BAND2", start: 28, span: 10 },
    { key: "BAND0", start: 38, span: 12 },
  ];
  for (const step of plan) {
    const href = String(assets[step.key]?.href || "");
    if (!href) throw new Error(`Asset ${step.key} ausente.`);
    const target = path.join(sceneDir, `${step.key}.tif`);
    const expected = await headLength(href);
    await downloadAsset(step.key, href, target, expected, step.start, step.span);
    bandPaths[step.key] = target;
  }

  const rawPansharpen = path.join(sceneDir, "cbers_342_pan_raw.tif");
  await run("gdal_pansharpen.py", [
    bandPaths.BAND0, bandPaths.BAND3, bandPaths.BAND4, bandPaths.BAND2, rawPansharpen,
    "-of", "GTiff", "-r", "cubic", "-spat_adjust", "intersection",
    "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
  ], {
    stage: "pansharpen",
    basePercent: 50,
    spanPercent: 37,
    message: "Fusionando a folha completa 3-4-2 com a pancromática.",
  });

  const finalPath = path.join(sceneDir, "cbers_4a_wpm_342_pan.tif");
  await run("gdal_translate", [
    "-of", "GTiff", "-ot", "Byte", "-scale", "-a_nodata", "0",
    "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
    rawPansharpen, finalPath,
  ], {
    stage: "geotiff",
    basePercent: 87,
    spanPercent: 8,
    message: "Gerando GeoTIFF final da órbita/ponto completa para ArcMap.",
  });

  patchJob({ stage: "save", percent: 96, message: "Salvando GeoTIFF no banco do usuário.", scenePatch: { stage: "save", percent: 96, message: "Salvando GeoTIFF." } });
  const name = outputFilename(itemId);
  const stored = saveUserFile(finalPath, name);
  const now = new Date().toISOString();
  const sceneState = {
    itemId,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "GeoTIFF concluído.",
    outputUrl: stored.publicUrl,
    outputRelativePath: stored.relativePath,
    outputFilename: name,
    outputBytes: stored.bytes,
  };
  patchDoc(cbersJobPath, {
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "GeoTIFF CBERS-4A/WPM concluído.",
    error: null,
    completedAt: now,
    outputUrl: stored.publicUrl,
    outputRelativePath: stored.relativePath,
    outputFilename: name,
    outputBytes: stored.bytes,
    scenes: [sceneState],
  });
  patchDoc(processingJobPath, {
    status: "completed",
    cancelRequested: false,
    error: null,
    finishedAtMs: Date.now(),
  });
}

main().catch((error) => {
  const message = String(error?.message || error || "Falha ao retomar CBERS.");
  patchDoc(cbersJobPath, {
    status: "failed",
    stage: "failed",
    message,
    error: message,
  });
  patchDoc(processingJobPath, {
    status: "failed",
    error: message,
    finishedAtMs: Date.now(),
  });
  console.error(message);
  process.exit(1);
});
