import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { STORAGE_ROOT } from "../local-storage";
import { asArray, xmlEscape } from "../lib/http";
import { ensureDir, readJsonSafe, writeJsonAtomic } from "../lib/fs-json";
import { sleep } from "../lib/job-utils";

type PlainObject = Record<string, any>;

export type CbersArchiveRecord = {
  imageId: string;
  uid: string;
  jobId: string;
  itemId: string;
  level?: "L4" | "L2";
  geometryHash?: string;
  orbit: string;
  year: string;
  sourceFilename: string;
  archiveFilename: string;
  hdRelativePath: string;
  hdPath: string;
  bytes: number;
  publicUrl: string;
  wmsLayerName: string;
  wmsStoreName: string;
  wmsPublicUrl: string;
  createdAt: string;
  updatedAt: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
  adminDeleteError?: string;
};

export const CBERS_ARCHIVE_ROOT = path.resolve(
  process.env.CBERS_ARCHIVE_ROOT || "/media/server/HD Backup/RASTER/CBERS_4A",
);
const CBERS_ARCHIVE_INDEX_DIR = path.join(STORAGE_ROOT, "cbers_archive", "images");
const GEOSERVER_BASE_URL = String(
  process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
).replace(/\/+$/, "");
const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
const GEOSERVER_STYLE = process.env.GEOSERVER_RASTER_STYLE || "raster";
const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE ||
    "https://wms.cursar.space/geoserver/cbers/wms",
).trim();
const GEOSERVER_EXTERNAL_CBRS_ROOT = path.resolve(
  process.env.GEOSERVER_EXTERNAL_CBRS_ROOT ||
    "/home/server/.local/geoserver-work/data_dir/external/cbers",
);
const ROOT_CBRS_GROUP = "CBERS-4A-Apos_2019";
const RESERVED_USER_STORAGE_NAMES = new Set([
  "attachments",
  "auas",
  "cbers",
  "cbers_wpm_jobs",
  "conversations",
  "processing_jobs",
  "settings",
  "simcar",
  "simcar_clips",
  "trash",
]);
const CBERS_OVERVIEW_LEVELS = String(
  process.env.CBERS_OVERVIEW_LEVELS || "2 4 8 16 32 64 128",
)
  .split(/\s+/)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 1);
// Resampling used to build the .ovr pyramids. "average" smooths the zoomed-out imagery far
// better than gdaladdo's default "nearest", which looks noisy/aliased at small scales.
const CBERS_OVERVIEW_RESAMPLING = String(
  process.env.CBERS_OVERVIEW_RESAMPLING || "average",
).trim() || "average";
// GeoServer can be briefly unavailable right after a deploy/restart while a scene finishes
// processing. Retry publish operations with a short backoff instead of dropping the scene.
const GEOSERVER_PUBLISH_RETRIES = Math.max(
  0,
  Number(process.env.GEOSERVER_PUBLISH_RETRIES || 4),
);
const GEOSERVER_PUBLISH_RETRY_DELAY_MS = Math.max(
  500,
  Number(process.env.GEOSERVER_PUBLISH_RETRY_DELAY_MS || 4000),
);
const GEOSERVER_READY_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.GEOSERVER_READY_TIMEOUT_MS || 60000),
);

function removeStaleTempCopies(dir: string, prefix: string): void {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue;
    const tempPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(tempPath);
      if (stat.mtimeMs < cutoff) fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function copyFileAtomic(sourcePath: string, destPath: string): number {
  ensureDir(path.dirname(destPath));
  const sourceStat = fs.statSync(sourcePath);
  const tempPrefix = `.${path.basename(destPath)}.`;
  removeStaleTempCopies(path.dirname(destPath), tempPrefix);
  const tempPath = path.join(path.dirname(destPath), `${tempPrefix}${crypto.randomUUID()}.tmp`);
  try {
    fs.copyFileSync(sourcePath, tempPath);
    const tempStat = fs.statSync(tempPath);
    if (tempStat.size !== sourceStat.size) {
      throw new Error(`COPY_SIZE_MISMATCH:${tempStat.size}:${sourceStat.size}`);
    }
    fs.renameSync(tempPath, destPath);
    return tempStat.size;
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Keep the original copy error.
    }
    throw error;
  }
}

export function cbersArchivePublicUrl(relativePath: string): string {
  return `/api/raster/${relativePath.split(path.sep).join("/")}`;
}

export function saveCbersArchiveAsset(args: {
  subdir?: string;
  filename: string;
  sourcePath: string;
}): { relativePath: string; absolutePath: string; publicUrl: string; bytes: number } {
  const subdirParts = String(args.subdir || "")
    .split(/[\\/]+/)
    .map((part) => safeSegment(part))
    .filter(Boolean);
  const cleanName = safeSegment(args.filename) || crypto.randomUUID();
  const absoluteDir = path.join(CBERS_ARCHIVE_ROOT, ...subdirParts);
  const absolutePath = path.join(absoluteDir, cleanName);
  const bytes = copyFileAtomic(args.sourcePath, absolutePath);
  const relativePath = path.relative(CBERS_ARCHIVE_ROOT, absolutePath).split(path.sep).join("/");
  return {
    relativePath,
    absolutePath,
    publicUrl: cbersArchivePublicUrl(relativePath),
    bytes,
  };
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keepOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 6000) output = output.slice(-6000);
    };
    child.stdout.on("data", keepOutput);
    child.stderr.on("data", keepOutput);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} falhou com codigo ${code}: ${output.slice(-1200)}`));
    });
  });
}

async function ensureExternalOverviews(tifPath: string): Promise<string | null> {
  if (!CBERS_OVERVIEW_LEVELS.length) return null;
  const overviewPath = `${tifPath}.ovr`;
  const tifStat = fs.statSync(tifPath);
  if (fs.existsSync(overviewPath)) {
    const overviewStat = fs.statSync(overviewPath);
    if (overviewStat.size > 0 && overviewStat.mtimeMs >= tifStat.mtimeMs) return overviewPath;
  }
  await runCommand("gdaladdo", [
    "-ro",
    "-r", CBERS_OVERVIEW_RESAMPLING,
    "--config", "COMPRESS_OVERVIEW", "LZW",
    "--config", "INTERLEAVE_OVERVIEW", "PIXEL",
    "--config", "BIGTIFF_OVERVIEW", "IF_SAFER",
    tifPath,
    ...CBERS_OVERVIEW_LEVELS.map(String),
  ]);
  return fs.existsSync(overviewPath) ? overviewPath : null;
}

async function ensureRgbColorInterpretation(tifPath: string): Promise<void> {
  await runCommand("gdal_edit.py", [
    "-colorinterp_1", "red",
    "-colorinterp_2", "green",
    "-colorinterp_3", "blue",
    tifPath,
  ]);
}

function safeSegment(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanLayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCbersItemId(itemId: string): { orbit: string; year: string } {
  const match = String(itemId || "").match(/(20\d{2})\d{4}[_-](\d{3})[_-](\d{3})/);
  if (!match) throw new Error(`Item CBERS sem data/orbita valida: ${itemId}`);
  return { year: match[1], orbit: `${match[2]}_${match[3]}` };
}

function parseCbersItemLevel(itemId: string): "L4" | "L2" | null {
  const match = String(itemId || "").match(/[_-](L[24])(?:$|[_-])/i);
  const level = match?.[1]?.toUpperCase();
  return level === "L4" || level === "L2" ? level : null;
}

function ensureCbersLevelInFilename(filename: string, level?: string | null): string {
  const cleanLevel = String(level || "").toUpperCase();
  if (cleanLevel !== "L4" && cleanLevel !== "L2") return filename;
  const ext = path.extname(filename) || ".TIF";
  let stem = filename.slice(0, filename.length - ext.length);
  stem = /[_-]L[24](?=$|[_-])/i.test(stem)
    ? stem.replace(/([_-])L[24](?=$|[_-])/i, `$1${cleanLevel}`)
    : `${stem}_${cleanLevel}`;
  return `${stem}${ext}`;
}

function withJobSuffix(filename: string, jobId: string): string {
  const ext = path.extname(filename) || ".TIF";
  const stem = filename.slice(0, filename.length - ext.length);
  return `${stem}_J${safeSegment(jobId).slice(0, 8).toUpperCase()}${ext.toUpperCase()}`;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
}

// 5xx/connection failures here are almost always GeoServer mid-restart (e.g. right after a
// deploy) rather than a bad request, so they are worth retrying.
function isTransientStatus(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

async function geoserverFetch(
  restPath: string,
  options: RequestInit = {},
): Promise<globalThis.Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= GEOSERVER_PUBLISH_RETRIES; attempt += 1) {
    try {
      const response = (await fetch(`${GEOSERVER_BASE_URL}${restPath}`, {
        ...options,
        headers: {
          Authorization: authHeader(),
          ...(options.headers || {}),
        },
      })) as globalThis.Response;
      if (isTransientStatus(response.status) && attempt < GEOSERVER_PUBLISH_RETRIES) {
        await sleep(GEOSERVER_PUBLISH_RETRY_DELAY_MS);
        continue;
      }
      return response;
    } catch (error) {
      // Network-level failure (connection refused/reset while GeoServer restarts).
      lastError = error;
      if (attempt >= GEOSERVER_PUBLISH_RETRIES) break;
      await sleep(GEOSERVER_PUBLISH_RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`GeoServer indisponível em ${GEOSERVER_BASE_URL}${restPath}`);
}

// Polls GeoServer until it answers, so a scene that finishes processing while GeoServer is
// still coming up after a restart waits for it instead of failing to publish.
async function waitForGeoserverReady(): Promise<void> {
  if (GEOSERVER_READY_TIMEOUT_MS <= 0) return;
  const deadline = Date.now() + GEOSERVER_READY_TIMEOUT_MS;
  let lastError: unknown = null;
  for (;;) {
    try {
      const response = (await fetch(`${GEOSERVER_BASE_URL}/rest/about/version.json`, {
        headers: { Authorization: authHeader() },
      })) as globalThis.Response;
      if (response.ok || response.status === 401 || response.status === 403) return;
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `GeoServer não respondeu em ${GEOSERVER_BASE_URL} após ${Math.round(
          GEOSERVER_READY_TIMEOUT_MS / 1000,
        )}s: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    await sleep(GEOSERVER_PUBLISH_RETRY_DELAY_MS);
  }
}

async function geoserverJson(restPath: string): Promise<PlainObject | null> {
  const response = await geoserverFetch(restPath, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GeoServer GET ${restPath} falhou: ${response.status}`);
  return (await response.json()) as PlainObject;
}

async function geoserverWrite(
  restPath: string,
  method: "POST" | "PUT" | "DELETE",
  body?: string,
  contentType?: string,
): Promise<void> {
  const response = await geoserverFetch(restPath, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if ([200, 201, 202, 204, 409, 404].includes(response.status)) return;
  const text = await response.text().catch(() => "");
  throw new Error(`GeoServer ${method} ${restPath} falhou: ${response.status} ${text.slice(0, 300)}`);
}

function groupPublished(payload: PlainObject | null): PlainObject[] {
  return asArray(payload?.layerGroup?.publishables?.published);
}

function groupStyles(payload: PlainObject | null): any[] {
  return asArray(payload?.layerGroup?.styles?.style);
}

async function upsertLayerGroup(args: {
  name: string;
  title: string;
  publishable: PlainObject;
  style: PlainObject | string;
}): Promise<void> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}.json`,
  );
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const alreadyAt = currentPublished.findIndex((item) => String(item?.name || "") === args.publishable.name);
  const published =
    alreadyAt >= 0
      ? currentPublished
      : [...currentPublished, args.publishable];
  const styles =
    alreadyAt >= 0
      ? currentStyles
      : [...currentStyles, args.style];

  const payload = {
    layerGroup: {
      name: args.name,
      mode: "NAMED",
      title: args.title,
      enabled: true,
      advertised: true,
      workspace: { name: GEOSERVER_WORKSPACE },
      publishables: { published },
      styles: { style: styles },
    },
  };
  const body = JSON.stringify(payload);
  if (existing) {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}`,
      "PUT",
      body,
      "application/json",
    );
  } else {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups`,
      "POST",
      body,
      "application/json",
    );
  }
}

async function deleteLayerGroup(name: string): Promise<void> {
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(name)}`,
    "DELETE",
  );
}

async function removePublishableFromGroup(groupName: string, publishableName: string): Promise<boolean> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}.json`,
  );
  if (!existing?.layerGroup) return false;
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const published: PlainObject[] = [];
  const styles: any[] = [];
  currentPublished.forEach((item, index) => {
    if (String(item?.name || "") === publishableName) return;
    published.push(item);
    styles.push(currentStyles[index] ?? "");
  });
  if (published.length === currentPublished.length) return published.length === 0;
  if (published.length === 0 && groupName !== "RASTER" && groupName !== ROOT_CBRS_GROUP) {
    await deleteLayerGroup(groupName);
    return true;
  }
  const previous = existing.layerGroup;
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}`,
    "PUT",
    JSON.stringify({
      layerGroup: {
        name: groupName,
        mode: previous.mode || "NAMED",
        title: previous.title || groupName,
        enabled: previous.enabled !== false,
        advertised: previous.advertised !== false,
        workspace: { name: GEOSERVER_WORKSPACE },
        publishables: { published },
        styles: { style: styles },
      },
    }),
    "application/json",
  );
  return false;
}

async function createCoverageStore(storeName: string): Promise<void> {
  const body =
    `<coverageStore>` +
    `<name>${xmlEscape(storeName)}</name>` +
    `<type>GeoTIFF</type>` +
    `<enabled>true</enabled>` +
    `<workspace><name>${xmlEscape(GEOSERVER_WORKSPACE)}</name></workspace>` +
    `</coverageStore>`;
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores`,
    "POST",
    body,
    "application/xml",
  );
}

function linkForGeoserver(hdPath: string, orbit: string, year: string, storeName: string): string {
  const mirrorDir = path.join(GEOSERVER_EXTERNAL_CBRS_ROOT, orbit, year, storeName);
  ensureDir(mirrorDir);
  const target = path.join(mirrorDir, path.basename(hdPath));
  try {
    if (fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
  } catch {
    // Missing symlink is fine.
  }
  fs.symlinkSync(hdPath, target);
  const overviewPath = `${hdPath}.ovr`;
  const overviewTarget = `${target}.ovr`;
  try {
    if (fs.existsSync(overviewTarget) || fs.lstatSync(overviewTarget).isSymbolicLink()) fs.unlinkSync(overviewTarget);
  } catch {
    // Missing symlink is fine.
  }
  if (fs.existsSync(overviewPath)) {
    fs.symlinkSync(overviewPath, overviewTarget);
  }
  return target;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function coverageBounds(payload: PlainObject | null): { minx: number; miny: number; maxx: number; maxy: number } | null {
  const coverage = payload?.coverage || {};
  const bbox = coverage.latLonBoundingBox || coverage.nativeBoundingBox || {};
  const minx = firstFiniteNumber(bbox.minx, bbox.minX);
  const miny = firstFiniteNumber(bbox.miny, bbox.minY);
  const maxx = firstFiniteNumber(bbox.maxx, bbox.maxX);
  const maxy = firstFiniteNumber(bbox.maxy, bbox.maxY);
  if ([minx, miny, maxx, maxy].some((value) => value === null)) return null;
  if (!(Number(maxx) > Number(minx)) || !(Number(maxy) > Number(miny))) return null;
  return { minx: Number(minx), miny: Number(miny), maxx: Number(maxx), maxy: Number(maxy) };
}

async function verifyGeoTiffWmsPublication(storeName: string): Promise<void> {
  const layer = await geoserverJson(`/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(storeName)}.json`);
  if (!layer?.layer) throw new Error(`GeoServer não retornou a layer publicada ${GEOSERVER_WORKSPACE}:${storeName}.`);

  const coverage = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(storeName)}/coverages/${encodeURIComponent(storeName)}.json`,
  );
  const bbox = coverageBounds(coverage);
  if (!bbox) throw new Error(`GeoServer não retornou bbox válida para ${GEOSERVER_WORKSPACE}:${storeName}.`);

  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: `${GEOSERVER_WORKSPACE}:${storeName}`,
    styles: "",
    srs: "EPSG:4326",
    bbox: `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`,
    width: "64",
    height: "64",
    format: "image/png",
    transparent: "true",
  });
  const response = await fetch(`${GEOSERVER_BASE_URL}/${GEOSERVER_WORKSPACE}/wms?${params.toString()}`, {
    headers: { Authorization: authHeader() },
  }) as globalThis.Response;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer()).length;
  if (!response.ok || !contentType.startsWith("image/") || bytes < 100) {
    throw new Error(
      `WMS GetMap não validou ${GEOSERVER_WORKSPACE}:${storeName}: status=${response.status}, contentType=${contentType}, bytes=${bytes}.`,
    );
  }
}

async function publishGeoTiff(args: {
  storeName: string;
  hdPath: string;
  orbit: string;
  year: string;
  title: string;
}): Promise<void> {
  await waitForGeoserverReady();
  await createCoverageStore(args.storeName);
  const linkedFile = linkForGeoserver(args.hdPath, args.orbit, args.year, args.storeName);
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/external.geotiff` +
      `?configure=first&coverageName=${encodeURIComponent(args.storeName)}&recalculate=nativebbox,latlonbbox`,
    "PUT",
    linkedFile,
    "text/plain",
  );

  await geoserverWrite(
    `/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({
      layer: {
        enabled: true,
        advertised: true,
        defaultStyle: {
          name: GEOSERVER_STYLE,
          href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_STYLE}.json`,
        },
      },
    }),
    "application/json",
  );
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/coverages/${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({ coverage: { title: args.title, enabled: true } }),
    "application/json",
  );

  const yearGroup = `orbit_${args.orbit}_y${args.year}`;
  const orbitGroup = `orbit_${args.orbit}`;
  await upsertLayerGroup({
    name: yearGroup,
    title: args.year,
    publishable: {
      "@type": "layer",
      name: `${GEOSERVER_WORKSPACE}:${args.storeName}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layers/${args.storeName}.json`,
    },
    style: { name: GEOSERVER_STYLE, href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_STYLE}.json` },
  });
  await upsertLayerGroup({
    name: orbitGroup,
    title: args.orbit,
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${yearGroup}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${yearGroup}.json`,
    },
    style: "",
  });
  await upsertLayerGroup({
    name: ROOT_CBRS_GROUP,
    title: ROOT_CBRS_GROUP,
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${orbitGroup}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${orbitGroup}.json`,
    },
    style: "",
  });
  await upsertLayerGroup({
    name: "RASTER",
    title: "RASTER",
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${ROOT_CBRS_GROUP}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${ROOT_CBRS_GROUP}.json`,
    },
    style: "",
  });

  await verifyGeoTiffWmsPublication(args.storeName);
}

function recordPath(imageId: string): string {
  return path.join(CBERS_ARCHIVE_INDEX_DIR, `${safeSegment(imageId)}.json`);
}

function saveRecord(record: CbersArchiveRecord): void {
  writeJsonAtomic(recordPath(record.imageId), record);
}

export function listCbersArchiveRecords(): CbersArchiveRecord[] {
  if (!fs.existsSync(CBERS_ARCHIVE_INDEX_DIR)) return [];
  return fs
    .readdirSync(CBERS_ARCHIVE_INDEX_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJsonSafe<CbersArchiveRecord | null>(path.join(CBERS_ARCHIVE_INDEX_DIR, entry), null))
    .filter((item): item is CbersArchiveRecord => Boolean(item))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function publishCbersPanToArchive(args: {
  uid: string;
  jobId: string;
  itemId: string;
  level?: "L4" | "L2" | string | null;
  geometryHash?: string | null;
  outputFilename: string;
  sourcePath: string;
}): Promise<CbersArchiveRecord> {
  const { orbit, year } = parseCbersItemId(args.itemId);
  const level = args.level === "L4" || args.level === "L2" ? args.level : parseCbersItemLevel(args.itemId);
  const outputFilename = ensureCbersLevelInFilename(args.outputFilename, level);
  const archiveFilename = withJobSuffix(outputFilename, args.jobId);
  const stored = saveCbersArchiveAsset({
    subdir: path.join(orbit, year),
    filename: archiveFilename,
    sourcePath: args.sourcePath,
  });
  await ensureRgbColorInterpretation(stored.absolutePath);
  await ensureExternalOverviews(stored.absolutePath);
  const storeName = cleanLayerName(`${orbit}_${year}_${path.basename(archiveFilename, path.extname(archiveFilename))}`);
  const imageId = storeName;

  await publishGeoTiff({
    storeName,
    hdPath: stored.absolutePath,
    orbit,
    year,
    title: path.basename(archiveFilename, path.extname(archiveFilename)),
  });

  const now = new Date().toISOString();
  const record: CbersArchiveRecord = {
    imageId,
    uid: safeSegment(args.uid),
    jobId: safeSegment(args.jobId),
    itemId: args.itemId,
    level: level || undefined,
    geometryHash: args.geometryHash || undefined,
    orbit,
    year,
    sourceFilename: outputFilename,
    archiveFilename,
    hdRelativePath: stored.relativePath,
    hdPath: stored.absolutePath,
    bytes: stored.bytes,
    publicUrl: stored.publicUrl,
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${storeName}`,
    wmsStoreName: storeName,
    wmsPublicUrl:
      `${GEOSERVER_PUBLIC_WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities`,
    createdAt: now,
    updatedAt: now,
  };
  saveRecord(record);
  return record;
}

export function markCbersArchiveUserDeleted(uid: string, jobId: string): void {
  const now = new Date().toISOString();
  for (const record of listCbersArchiveRecords()) {
    if (record.uid !== safeSegment(uid) || record.jobId !== safeSegment(jobId) || record.userDeletedAt) continue;
    saveRecord({ ...record, userDeletedAt: now, updatedAt: now });
  }
}

