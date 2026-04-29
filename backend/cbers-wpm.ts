import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import archiver from "archiver";
import {
  area as turfArea,
  bboxPolygon,
  featureCollection,
  intersect as turfIntersect,
} from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { parseUserShapefile } from "./simcar-clip";
import {
  deleteDocBySegments,
  readDocBySegments,
  removeStoragePath,
  STORAGE_ROOT,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import {
  finishJob,
  isCancelRequested,
  requestCancel,
  startJob,
} from "./processing-jobs";
import {
  listCbersArchiveRecords,
  markCbersArchiveUserDeleted,
  publishCbersPanToArchive,
  saveCbersArchiveAsset,
  type CbersArchiveRecord,
} from "./cbers-archive";

type CbersJobStatus = "processing" | "completed" | "failed" | "cancelled";

type CbersScene = {
  id: string;
  datetime: string;
  cloudCover: number | null;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon | MultiPolygon;
  thumbnailUrl?: string;
  assetKeys: string[];
  coveragePercent?: number;
  coversArea?: boolean;
  estimate?: CbersEstimate;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  archiveImageId?: string;
  archiveFilename?: string;
};

type CbersEstimate = {
  downloadBytes: number;
  downloadMb: number;
  outputBytesEstimated: number;
  outputMbEstimated: number;
  timeSecondsEstimated: number;
  completeAssetSizes: boolean;
  assetSizes: Record<string, number | null>;
};

type CbersAreaContext = {
  geometry?: Polygon | MultiPolygon;
  geometryHash?: string | null;
  areaHa: number;
};

type CbersSceneJobState = {
  itemId: string;
  scene?: CbersScene | null;
  status: CbersJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  estimate?: CbersEstimate;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archive?: CbersArchiveRecord;
  archiveImageId?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
};

type CbersProgressPatch = {
  status?: CbersJobStatus;
  stage?: string;
  percent?: number;
  message?: string;
  error?: string | null;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archive?: CbersArchiveRecord;
  archiveImageId?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  batchZipUrl?: string;
  batchZipRelativePath?: string;
  batchZipFilename?: string;
  batchZipBytes?: number;
  completedAt?: string;
  scene?: CbersScene | null;
  estimate?: CbersEstimate | null;
  scenes?: CbersSceneJobState[];
  mode?: "single" | "batch";
};

class CbersCancelError extends Error {
  constructor(message = "Cancelamento solicitado pelo usuário.") {
    super(message);
    this.name = "CbersCancelError";
  }
}

const STAC_ROOT = String(
  process.env.CBERS_STAC_ROOT || "https://data.inpe.br/bdc/stac/v1",
).replace(/\/+$/, "");
const CBERS_COLLECTION = "CB4A-WPM-L4-DN-1";
const CBERS_REQUIRED_ASSETS = ["BAND3", "BAND4", "BAND2", "BAND0"] as const;
const CBERS_TMP_ROOT = process.env.CBERS_TMP_ROOT || "/tmp/geoforest-cbers-wpm";
const CBERS_SEARCH_LIMIT = Math.max(1, Number(process.env.CBERS_SEARCH_LIMIT || 50));
const CBERS_ORBIT_POINT_SEARCH_MAX_PAGES = Math.max(
  1,
  Number(process.env.CBERS_ORBIT_POINT_SEARCH_MAX_PAGES || 30),
);
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.CBERS_FETCH_TIMEOUT_MS || 120000));
const CBERS_BATCH_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CBERS_BATCH_CONCURRENCY || 2)));
const CBERS_DOWNLOAD_RETRIES = Math.max(0, Number(process.env.CBERS_DOWNLOAD_RETRIES || 3));
const CBERS_DOWNLOAD_RETRY_DELAY_MS = Math.max(1000, Number(process.env.CBERS_DOWNLOAD_RETRY_DELAY_MS || 3000));
const CBERS_DOWNLOAD_STALL_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.CBERS_DOWNLOAD_STALL_TIMEOUT_MS || 180000),
);
const CBERS_TMP_CLEANUP_MAX_AGE_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.CBERS_TMP_CLEANUP_MAX_AGE_MS || 2 * 60 * 60 * 1000),
);
const CBERS_PANSHARPEN_ESTIMATE_MS = Math.max(
  60000,
  Number(process.env.CBERS_PANSHARPEN_ESTIMATE_MS || 8 * 60 * 1000),
);
const CBERS_TRANSLATE_ESTIMATE_MS = Math.max(
  30000,
  Number(process.env.CBERS_TRANSLATE_ESTIMATE_MS || 3 * 60 * 1000),
);
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
const GEOSERVER_DATA_DIR = process.env.GEOSERVER_DATA_DIR || "/home/server/geoserver_data";
const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE ||
    "https://wms.cursar.space/geoserver/cbers/wms",
).trim();

const eventSubscribers = new Map<string, Set<Response>>();
let geoserverLayerCache: { expiresAt: number; layers: string[] } | null = null;
let cbersTmpCleanupStarted = false;

function gdalCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GDAL_DISABLE_READDIR_ON_OPEN: process.env.GDAL_DISABLE_READDIR_ON_OPEN || "EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS:
      process.env.CPL_VSIL_CURL_ALLOWED_EXTENSIONS || ".tif,.TIF,.tiff,.TIFF",
    GDAL_HTTP_MAX_RETRY: process.env.GDAL_HTTP_MAX_RETRY || "8",
    GDAL_HTTP_RETRY_DELAY: process.env.GDAL_HTTP_RETRY_DELAY || "2",
    GDAL_HTTP_CONNECTTIMEOUT: process.env.GDAL_HTTP_CONNECTTIMEOUT || "20",
    GDAL_HTTP_TIMEOUT: process.env.GDAL_HTTP_TIMEOUT || "300",
    VSI_CACHE: process.env.VSI_CACHE || "TRUE",
    VSI_CACHE_SIZE: process.env.VSI_CACHE_SIZE || "50000000",
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileSizeSafe(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function bytesToMb(bytes: number): string {
  return (Math.max(0, bytes) / 1024 / 1024).toFixed(1);
}

function newestMtimeMs(dir: string, depth = 0): number {
  let newest = 0;
  try {
    const stat = fs.statSync(dir);
    newest = stat.mtimeMs;
  } catch {
    return newest;
  }
  if (depth >= 3) return newest;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(child);
      newest = Math.max(newest, stat.mtimeMs);
      if (entry.isDirectory()) newest = Math.max(newest, newestMtimeMs(child, depth + 1));
    } catch {
      // Ignore entries that disappeared while cleaning.
    }
  }
  return newest;
}

function isPersistedCbersJobActive(jobId: string): boolean {
  const usersDir = path.join(STORAGE_ROOT, "users");
  if (!fs.existsSync(usersDir)) return false;
  try {
    for (const uid of fs.readdirSync(usersDir)) {
      const filePath = path.join(usersDir, uid, "processing_jobs", `${safeName(jobId)}.json`);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (String(data.endpoint || "") !== "/api/cbers-wpm/jobs") continue;
      const status = String(data.status || "").toLowerCase();
      if (status === "running" || status === "cancel_requested") return true;
    }
  } catch {
    return true;
  }
  return false;
}

function cleanupCbersTmpRoot(reason: string): number {
  if (!fs.existsSync(CBERS_TMP_ROOT)) return 0;
  const now = Date.now();
  let removed = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(CBERS_TMP_ROOT, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name;
    if (isPersistedCbersJobActive(jobId)) continue;
    const dir = path.join(CBERS_TMP_ROOT, jobId);
    const newest = newestMtimeMs(dir);
    if (newest && now - newest < CBERS_TMP_CLEANUP_MAX_AGE_MS) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "cbers_tmp_cleanup_failed",
        jobId,
        reason,
        message: String((error as Error)?.message || error),
      }));
    }
  }
  if (removed > 0) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "cbers_tmp_cleanup",
      reason,
      removed,
    }));
  }
  return removed;
}

function startCbersTmpCleanup(): void {
  if (cbersTmpCleanupStarted) return;
  cbersTmpCleanupStarted = true;
  cleanupCbersTmpRoot("startup");
  setInterval(() => cleanupCbersTmpRoot("interval"), 30 * 60 * 1000).unref();
}

function safeName(value: unknown, fallback = "cbers_4a_wpm.tif"): string {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
  return clean || fallback;
}

function cbersOutputFilename(itemId: string): string {
  const stem = safeName(itemId, "CBERS_4A_WPM")
    .replace(/\.(tif|tiff)$/i, "")
    .replace(/_C?342(?:_PAN)?$/i, "")
    .replace(/_PAN$/i, "");
  return `${stem}_C342_PAN.TIF`;
}

function cbersBatchZipFilename(jobId: string): string {
  return safeName(`CBERS_4A_WPM_LOTE_${jobId.slice(0, 8)}_C342_PAN.zip`, "CBERS_4A_WPM_LOTE_C342_PAN.zip");
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  if (!payload) throw new Error("ZIP da área é obrigatório.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP da área é inválido ou muito pequeno.");
  return buffer;
}

function parseOptionalAreaContext(raw: unknown): CbersAreaContext {
  const value = String(raw || "").trim();
  if (!value) return { areaHa: 0 };
  const zipBuffer = parseBase64Zip(value);
  const parsed = parseUserShapefile(zipBuffer);
  return {
    geometry: parsed.geometry,
    geometryHash: hashPropertyGeometry(parsed.geometry),
    areaHa: parsed.areaHa,
  };
}

function featureBbox(feature: Feature<Polygon | MultiPolygon>): [number, number, number, number] {
  const coords =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates.flat(2);
  const xs = coords.map((coord) => coord[0]).filter(Number.isFinite);
  const ys = coords.map((coord) => coord[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) throw new Error("Não foi possível calcular a bbox da área.");
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normalizeStacGeometry(geometry: unknown, bbox: [number, number, number, number] | null): Polygon | MultiPolygon | undefined {
  if (geometry && typeof geometry === "object") {
    const candidate = geometry as Geometry;
    if (candidate.type === "Polygon" || candidate.type === "MultiPolygon") {
      return candidate as Polygon | MultiPolygon;
    }
  }
  if (!bbox) return undefined;
  return bboxPolygon(bbox).geometry as Polygon;
}

function computeSceneCoverage(
  propertyGeometry: Polygon | MultiPolygon,
  sceneGeometry?: Polygon | MultiPolygon,
): { coveragePercent: number; coversArea: boolean } {
  if (!sceneGeometry) return { coveragePercent: 0, coversArea: false };
  const propertyFeature: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: propertyGeometry,
  };
  const sceneFeature: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: sceneGeometry,
  };
  try {
    const totalArea = turfArea(propertyFeature);
    if (!Number.isFinite(totalArea) || totalArea <= 0) return { coveragePercent: 0, coversArea: false };
    const intersection = turfIntersect(featureCollection([propertyFeature, sceneFeature]) as any);
    const intersectionArea = intersection ? turfArea(intersection as any) : 0;
    const coveragePercent = Math.max(0, Math.min(100, Number(((intersectionArea / totalArea) * 100).toFixed(2))));
    return {
      coveragePercent,
      coversArea: coveragePercent >= 99.5,
    };
  } catch {
    return { coveragePercent: 0, coversArea: false };
  }
}

function normalizeGeometryValueForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeGeometryValueForHash(item));
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(7));
  return value;
}

function hashPropertyGeometry(geometry?: Polygon | MultiPolygon | null): string | null {
  if (!geometry) return null;
  const normalized = {
    type: geometry.type,
    coordinates: normalizeGeometryValueForHash(geometry.coordinates),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`INPE STAC ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function sceneFromStacFeature(feature: any, propertyGeometry?: Polygon | MultiPolygon): CbersScene | null {
  const assets = feature?.assets && typeof feature.assets === "object" ? feature.assets : {};
  const assetKeys = Object.keys(assets);
  if (!CBERS_REQUIRED_ASSETS.every((key) => Boolean(assets[key]?.href))) return null;
  const bbox = Array.isArray(feature?.bbox) && feature.bbox.length >= 4
    ? [
      Number(feature.bbox[0]),
      Number(feature.bbox[1]),
      Number(feature.bbox[2]),
      Number(feature.bbox[3]),
    ] as [number, number, number, number]
    : null;
  const geometry = normalizeStacGeometry(feature?.geometry, bbox);
  const coverage = propertyGeometry
    ? computeSceneCoverage(propertyGeometry, geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  return {
    id: String(feature?.id || "").trim(),
    datetime: String(feature?.properties?.datetime || feature?.properties?.start_datetime || "").trim(),
    cloudCover: Number.isFinite(Number(feature?.properties?.["eo:cloud_cover"]))
      ? Number(feature.properties["eo:cloud_cover"])
      : null,
    bbox,
    geometry,
    thumbnailUrl: assets.thumbnail?.href ? String(assets.thumbnail.href) : undefined,
    assetKeys,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
  };
}

type CbersWmsAvailability = {
  wmsLayerName: string;
  wmsUrl: string;
  wmsDownloadUrl: string;
  sourcePath?: string;
  archiveImageId?: string;
  archiveFilename?: string;
};

type CbersWmsZipFile = {
  absolutePath: string;
  name: string;
};

function publicWmsCapabilitiesUrl(): string {
  return `${GEOSERVER_PUBLIC_WMS_BASE.replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

function wmsDownloadPathForArchiveImage(imageId: string): string {
  return `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(imageId)}`;
}

function wmsDownloadPathForItem(itemId: string): string {
  return `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(itemId)}`;
}

function normalizeLayerName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCbersItemIdForWms(itemId: string): {
  dateCompact: string;
  dateUnderscore: string;
  orbit: string;
  row: string;
  level?: string;
} | null {
  const match = String(itemId || "").match(/CBERS[_-]?4A[_-]WPM[_-](\d{8})[_-](\d{3})[_-](\d{3})(?:[_-](L\d+))?/i);
  if (!match) return null;
  const dateCompact = match[1];
  return {
    dateCompact,
    dateUnderscore: `${dateCompact.slice(0, 4)}_${dateCompact.slice(4, 6)}_${dateCompact.slice(6, 8)}`,
    orbit: match[2],
    row: match[3],
    level: match[4]?.toLowerCase(),
  };
}

function normalizeOrbitPointParam(raw: unknown, label: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  if (!/^\d{1,3}$/.test(digits)) {
    throw new Error(`${label} deve conter 1 a 3 dígitos.`);
  }
  return digits.padStart(3, "0");
}

function listLocalGeoserverLayerNames(): string[] {
  const now = Date.now();
  if (geoserverLayerCache && geoserverLayerCache.expiresAt > now) return geoserverLayerCache.layers;
  const workspaceDir = path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE);
  let layers: string[] = [];
  try {
    layers = fs
      .readdirSync(workspaceDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(workspaceDir, name, name, "layer.xml")));
  } catch {
    layers = [];
  }
  geoserverLayerCache = { expiresAt: now + 60_000, layers };
  return layers;
}

function stripWorkspaceFromLayer(layerName: string): string {
  const clean = String(layerName || "").trim();
  return clean.includes(":") ? clean.split(":").pop() || "" : clean;
}

function decodeFileUrl(value: string): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  try {
    if (clean.startsWith("file:")) return decodeURIComponent(new URL(clean).pathname);
  } catch {
    // Fall through to the simple file: prefix handling below.
  }
  return decodeURIComponent(clean.replace(/^file:/i, ""));
}

function resolveLocalGeoserverLayerFile(layerName: string): string | null {
  const name = stripWorkspaceFromLayer(layerName);
  if (!name || !listLocalGeoserverLayerNames().includes(name)) return null;
  const storePath = path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE, name, "coveragestore.xml");
  let xml = "";
  try {
    xml = fs.readFileSync(storePath, "utf8");
  } catch {
    return null;
  }
  const match = xml.match(/<url>([\s\S]*?)<\/url>/i);
  const resolved = decodeFileUrl(match?.[1] || "");
  return resolved && fs.existsSync(resolved) ? resolved : null;
}

function layerMatchesCbersItem(layerName: string, itemId: string): boolean {
  const parsed = parseCbersItemIdForWms(itemId);
  if (!parsed) return false;
  const normalized = normalizeLayerName(layerName);
  const tokens = normalized.split("_").filter(Boolean);
  if ((!tokens.includes("cbers") && !tokens.includes("cbers4a")) || !tokens.includes("wpm")) return false;
  if (!normalized.includes(parsed.dateCompact) && !normalized.includes(parsed.dateUnderscore)) return false;
  const hasOrbitRow = tokens.some((token, idx) => token === parsed.orbit && tokens[idx + 1] === parsed.row);
  if (!hasOrbitRow) return false;
  const layerLevels = tokens.filter((token) => /^l\d+$/.test(token));
  if (parsed.level && layerLevels.length > 0 && !layerLevels.includes(parsed.level)) return false;
  return true;
}

function findLocalGeoserverLayerForItem(itemId: string): CbersWmsAvailability | null {
  const layerName = listLocalGeoserverLayerNames()
    .filter((name) => layerMatchesCbersItem(name, itemId))
    .sort((a, b) => {
      const score = (name: string) => {
        const normalized = normalizeLayerName(name);
        return (normalized.includes("_pan") ? 2 : 0) + (normalized.includes("_c342") ? 1 : 0);
      };
      return score(b) - score(a) || a.localeCompare(b);
    })[0];
  if (!layerName) return null;
  return {
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${layerName}`,
    wmsUrl: publicWmsCapabilitiesUrl(),
    wmsDownloadUrl: wmsDownloadPathForItem(itemId),
    sourcePath: resolveLocalGeoserverLayerFile(layerName) || undefined,
  };
}

function isActiveArchiveRecord(record: CbersArchiveRecord | null | undefined): record is CbersArchiveRecord {
  return Boolean(
    record &&
    !record.adminDeletedAt &&
    record.wmsPublicUrl &&
    (record.wmsLayerName || record.wmsStoreName),
  );
}

function archiveAvailabilityFromRecord(record: CbersArchiveRecord): CbersWmsAvailability {
  return {
    wmsLayerName: record.wmsLayerName || record.wmsStoreName,
    wmsUrl: record.wmsPublicUrl,
    wmsDownloadUrl: wmsDownloadPathForArchiveImage(record.imageId),
    sourcePath: record.hdPath,
    archiveImageId: record.imageId,
    archiveFilename: record.archiveFilename,
  };
}

function findArchiveRecordByImageId(imageId: string): CbersArchiveRecord | null {
  const cleanImageId = String(imageId || "").trim();
  if (!cleanImageId) return null;
  return listCbersArchiveRecords().find((record) => (
    record.imageId === cleanImageId &&
    isActiveArchiveRecord(record)
  )) || null;
}

function findAnyActiveArchiveForItem(itemId: string): CbersWmsAvailability | null {
  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) return null;
  const archive = listCbersArchiveRecords().find((record) => (
    record.itemId === cleanItemId &&
    isActiveArchiveRecord(record)
  )) || null;
  if (archive) return archiveAvailabilityFromRecord(archive);
  return findLocalGeoserverLayerForItem(cleanItemId);
}

function findExactArchiveAvailability(
  itemId: string,
  _geometryHash?: string | null,
): CbersWmsAvailability | null {
  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) return null;
  const archive = listCbersArchiveRecords().find((record) => (
    record.itemId === cleanItemId &&
    isActiveArchiveRecord(record)
  )) || null;
  return archive ? archiveAvailabilityFromRecord(archive) : null;
}

function attachArchiveAvailability(scene: CbersScene, geometryHash?: string | null): CbersScene {
  const archive = findExactArchiveAvailability(scene.id, geometryHash);
  if (!archive) return scene;
  return {
    ...scene,
    wmsAvailable: true,
    wmsLayerName: archive.wmsLayerName,
    wmsUrl: archive.wmsUrl,
    wmsDownloadUrl: archive.wmsDownloadUrl,
    archiveImageId: archive.archiveImageId,
    archiveFilename: archive.archiveFilename,
  };
}

function collectWmsImageFiles(availability: CbersWmsAvailability): CbersWmsZipFile[] {
  const sourcePath = availability.sourcePath || resolveLocalGeoserverLayerFile(availability.wmsLayerName);
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const wanted = new Set<string>([
    base,
    `${base}.aux.xml`,
    `${base}.ovr`,
    `${base}.xml`,
    `${stem}.tfw`,
    `${stem}.tifw`,
    `${stem}.prj`,
    `${stem}.xml`,
  ]);
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => wanted.has(entry))
      .map((entry) => ({
        absolutePath: path.join(dir, entry),
        name: entry,
      }))
      .filter((entry) => fs.existsSync(entry.absolutePath) && fs.statSync(entry.absolutePath).isFile())
      .sort((a, b) => {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return fs.existsSync(sourcePath) ? [{ absolutePath: sourcePath, name: base }] : [];
  }
}

function zipFilenameForWmsImage(files: CbersWmsZipFile[], itemId: string): string {
  const primary = files[0]?.name || cbersOutputFilename(itemId);
  const ext = path.extname(primary);
  const stem = (ext ? primary.slice(0, -ext.length) : primary)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${stem || safeName(itemId, "CBERS_4A_WPM")}.zip`;
}

async function streamWmsZip(res: Response, filename: string, files: CbersWmsZipFile[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 0 } });
    let finished = false;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (error) reject(error);
      else resolve();
    };
    archive.on("error", done);
    res.on("close", () => done());
    setWmsZipHeaders(res, filename, files);
    archive.pipe(res);
    for (const file of files) archive.file(file.absolutePath, { name: file.name });
    void archive.finalize().then(() => done()).catch(done);
  });
}

function setWmsZipHeaders(res: Response, filename: string, files: CbersWmsZipFile[]): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-CBERS-WMS-File-Count", String(files.length));
}

function resolveWmsZipRequest(args: {
  imageId?: string | null;
  itemId?: string | null;
}): { availability: CbersWmsAvailability; files: CbersWmsZipFile[]; filename: string } | null {
  const cleanImageId = String(args.imageId || "").trim();
  const cleanItemId = String(args.itemId || "").trim();
  const availability =
    (cleanImageId ? (() => {
      const archive = findArchiveRecordByImageId(cleanImageId);
      return archive ? archiveAvailabilityFromRecord(archive) : null;
    })() : null) ||
    (cleanItemId ? findAnyActiveArchiveForItem(cleanItemId) : null);
  if (!availability) return null;
  const files = collectWmsImageFiles(availability);
  if (!files.length) return null;
  return { availability, files, filename: zipFilenameForWmsImage(files, cleanImageId || cleanItemId) };
}

function normalizeDateParam(raw: unknown, endOfDay = false): string | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  const iso = `${value}${suffix}`;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? iso : null;
}

async function searchCbersScenes(
  bbox: [number, number, number, number] | null,
  options?: {
    dateStart?: string | null;
    dateEnd?: string | null;
    propertyGeometry?: Polygon | MultiPolygon;
    propertyGeometryHash?: string | null;
    orbit?: string | null;
    point?: string | null;
  },
): Promise<CbersScene[]> {
  const params = new URLSearchParams({ limit: String(CBERS_SEARCH_LIMIT) });
  if (bbox) params.set("bbox", bbox.join(","));
  if (options?.dateStart || options?.dateEnd) {
    params.set("datetime", `${options.dateStart || ".."}/${options.dateEnd || ".."}`);
  }
  const requestedOrbit = options?.orbit || null;
  const requestedPoint = options?.point || null;
  const maxPages = bbox ? 1 : CBERS_ORBIT_POINT_SEARCH_MAX_PAGES;
  let url: string | null = `${STAC_ROOT}/collections/${encodeURIComponent(CBERS_COLLECTION)}/items?${params.toString()}`;
  const scenes: CbersScene[] = [];
  const seen = new Set<string>();

  for (let page = 0; url && page < maxPages && scenes.length < CBERS_SEARCH_LIMIT; page += 1) {
    const payload: any = await fetchJson<any>(url);
    const features: any[] = Array.isArray(payload?.features) ? payload.features : [];
    for (const feature of features) {
      const scene = sceneFromStacFeature(feature, options?.propertyGeometry);
      if (!scene?.id || seen.has(scene.id)) continue;
      const parsed = parseCbersItemIdForWms(scene.id);
      if (requestedOrbit && parsed?.orbit !== requestedOrbit) continue;
      if (requestedPoint && parsed?.row !== requestedPoint) continue;
      seen.add(scene.id);
      scenes.push(attachArchiveAvailability(scene, options?.propertyGeometryHash));
      if (scenes.length >= CBERS_SEARCH_LIMIT) break;
    }
    const nextHref: string = Array.isArray(payload?.links)
      ? String(payload.links.find((link: any) => String(link?.rel || "").toLowerCase() === "next")?.href || "")
      : "";
    url = nextHref ? new URL(nextHref, STAC_ROOT).toString() : null;
  }

  return scenes.sort((a: CbersScene, b: CbersScene) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
}

async function getStacItem(itemId: string): Promise<any> {
  const url = `${STAC_ROOT}/collections/${encodeURIComponent(CBERS_COLLECTION)}/items/${encodeURIComponent(itemId)}`;
  return fetchJson<any>(url);
}

async function headContentLength(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!response.ok) return null;
    const value = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function estimateFallbackDownloadBytes(areaHa: number): number {
  void areaHa;
  return 3_000_000_000;
}

async function estimateSceneAssets(args: {
  itemId: string;
  areaHa: number;
  scene?: CbersScene | null;
}): Promise<CbersEstimate> {
  const item = await getStacItem(args.itemId);
  const assets = item.assets || {};
  const assetSizes: Record<string, number | null> = {};
  for (const key of CBERS_REQUIRED_ASSETS) {
    const href = String(assets[key]?.href || "");
    assetSizes[key] = href ? await headContentLength(href) : null;
  }
  const completeAssetSizes = CBERS_REQUIRED_ASSETS.every((key) => Number.isFinite(assetSizes[key] || NaN));
  const knownBytes = Object.values(assetSizes).reduce<number>((acc, value) => acc + Number(value || 0), 0);
  const downloadBytes: number = completeAssetSizes
    ? knownBytes
    : Math.max(knownBytes, estimateFallbackDownloadBytes(args.areaHa));
  const panBytes = Number(assetSizes.BAND0 || 0);
  const outputBytesEstimated = Math.max(100_000_000, Math.round((panBytes || knownBytes || downloadBytes) * 0.75));
  const downloadMb = Number((downloadBytes / 1024 / 1024).toFixed(2));
  const outputMbEstimated = Number((outputBytesEstimated / 1024 / 1024).toFixed(2));
  return {
    downloadBytes,
    downloadMb,
    outputBytesEstimated,
    outputMbEstimated,
    timeSecondsEstimated: Math.max(30, Math.round(downloadMb / 8 + outputMbEstimated / 4 + 45)),
    completeAssetSizes,
    assetSizes,
  };
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // Connection is gone.
  }
}

function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const subscribers = eventSubscribers.get(jobId);
  if (!subscribers) return;
  for (const res of subscribers) writeSse(res, data);
}

function closeJobSubscribers(jobId: string): void {
  const subscribers = eventSubscribers.get(jobId);
  if (!subscribers) return;
  for (const res of subscribers) {
    if (!res.writableEnded) res.end();
  }
  eventSubscribers.delete(jobId);
}

function persistCbersJob(uid: string, jobId: string, patch: CbersProgressPatch & Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "cbers_wpm_jobs", jobId],
    stripUndefinedDeep({
      jobId,
      ...patch,
      updatedAtMs: Date.now(),
    }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: CbersProgressPatch): void {
  const next = {
    status: patch.status || "processing",
    percent: typeof patch.percent === "number" ? clampPercent(patch.percent) : undefined,
    ...patch,
  };
  persistCbersJob(uid, jobId, next);
  emitJobEvent(jobId, { type: "progress", jobId, ...next });
}

function throwIfCancelled(jobId: string): void {
  if (isCancelRequested(jobId)) throw new CbersCancelError();
}

async function downloadAsset(args: {
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

async function runCommand(args: {
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
      finish(() => reject(new Error(`${args.command} falhou com codigo ${code}: ${output.slice(-1200)}`)));
    });
  });

  throwIfCancelled(args.jobId);
  report({
    stage: args.stage,
    percent: args.basePercent + args.spanPercent,
    message: args.message,
  });
}

async function processCbersScene(args: {
  uid: string;
  jobId: string;
  itemId: string;
  tmpDir: string;
  propertyGeometry?: Polygon | MultiPolygon;
  propertyGeometryHash?: string | null;
  areaHa: number;
  onSceneProgress?: (patch: Partial<CbersSceneJobState>) => void;
}): Promise<CbersSceneJobState> {
  const { uid, jobId } = args;
  const sceneDir = path.join(args.tmpDir, safeName(args.itemId));
  fs.mkdirSync(sceneDir, { recursive: true });

  let currentScene: CbersScene | null = null;
  let currentEstimate: CbersEstimate | null = null;

  const report = (patch: CbersProgressPatch) => {
    args.onSceneProgress?.({
      itemId: args.itemId,
      status: "processing",
      ...patch,
      scene: currentScene,
      estimate: (patch.estimate ?? currentEstimate) ?? undefined,
      error: patch.error ?? undefined,
    });
    if (!args.onSceneProgress) {
      progress(uid, jobId, {
        ...patch,
        scene: currentScene,
        estimate: currentEstimate,
      });
    }
  };

  throwIfCancelled(jobId);
  report({ stage: "scene", percent: 5, message: "Carregando metadados da cena." });
  const item = await getStacItem(args.itemId);
  currentScene = sceneFromStacFeature(item, args.propertyGeometry);
  const scene = currentScene;
  if (!scene) throw new Error("Cena STAC sem as bandas obrigatórias BAND3, BAND4, BAND2 e BAND0.");
  if (scene.coversArea === false) {
    throw new Error(`Cena ${scene.id} cobre apenas ${scene.coveragePercent ?? 0}% da área.`);
  }
  currentEstimate = await estimateSceneAssets({ itemId: args.itemId, areaHa: args.areaHa, scene });
  const estimate = currentEstimate;
  report({ stage: "scene", percent: 7, message: `Cena selecionada: ${scene.id}.` });

  const assets = item.assets || {};
  const bandPaths: Record<string, string> = {};
  const downloadPlan = [
    { key: "BAND3", start: 8, span: 10 },
    { key: "BAND4", start: 18, span: 10 },
    { key: "BAND2", start: 28, span: 10 },
    { key: "BAND0", start: 38, span: 12 },
  ];
  for (const itemPlan of downloadPlan) {
    const href = String(assets[itemPlan.key]?.href || "");
    if (!href) throw new Error(`Asset ${itemPlan.key} ausente na cena ${scene.id}.`);
    const targetPath = path.join(sceneDir, `${itemPlan.key}.tif`);
    await downloadAsset({
      uid,
      jobId,
      assetKey: itemPlan.key,
      url: href,
      filePath: targetPath,
      basePercent: itemPlan.start,
      spanPercent: itemPlan.span,
      expectedBytes: estimate.assetSizes[itemPlan.key],
      onProgress: report,
    });
    bandPaths[itemPlan.key] = targetPath;
    report({ stage: "download", percent: itemPlan.start + itemPlan.span, message: `${itemPlan.key} baixada.` });
  }

  const rawPansharpenPath = path.join(sceneDir, "cbers_342_pan_raw.tif");
  await runCommand({
    uid,
    jobId,
    command: "gdal_pansharpen.py",
    commandArgs: [
      bandPaths.BAND0,
      bandPaths.BAND3,
      bandPaths.BAND4,
      bandPaths.BAND2,
      rawPansharpenPath,
      "-of", "GTiff",
      "-r", "cubic",
      "-spat_adjust", "intersection",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
    ],
    basePercent: 50,
    spanPercent: 37,
    stage: "pansharpen",
    message: "Fusionando a folha completa 3-4-2 com a pancromática.",
    onProgress: report,
  });
  report({ stage: "pansharpen", percent: 87, message: "Fusão pancromática da folha completa concluída." });

  const finalTempPath = path.join(sceneDir, "cbers_4a_wpm_342_pan.tif");
  await runCommand({
    uid,
    jobId,
    command: "gdal_translate",
    commandArgs: [
      "-of", "GTiff",
      "-ot", "Byte",
      "-scale",
      "-a_nodata", "0",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
      rawPansharpenPath,
      finalTempPath,
    ],
    basePercent: 87,
    spanPercent: 8,
    stage: "geotiff",
    message: "Gerando GeoTIFF final da órbita/ponto completa para ArcMap.",
    onProgress: report,
  });
  report({ stage: "save", percent: 96, message: "Salvando GeoTIFF no raster compartilhado." });

  const outputName = cbersOutputFilename(scene.id || args.itemId);
  report({ stage: "publish", percent: 98, message: "Publicando GeoTIFF no acervo WMS." });
  const archive = await publishCbersPanToArchive({
    uid,
    jobId,
    itemId: args.itemId,
    geometryHash: undefined,
    outputFilename: outputName,
    sourcePath: finalTempPath,
  });

  return {
    itemId: args.itemId,
    scene,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "GeoTIFF concluído.",
    estimate,
    outputUrl: archive.publicUrl,
    outputRelativePath: archive.publicUrl,
    outputFilename: outputName,
    outputBytes: archive.bytes,
    archive,
    archiveImageId: archive.imageId,
    wmsLayerName: archive.wmsLayerName,
    wmsUrl: archive.wmsPublicUrl,
    wmsDownloadUrl: wmsDownloadPathForArchiveImage(archive.imageId),
  };
}

async function createCbersBatchZip(args: {
  uid: string;
  jobId: string;
  tmpDir: string;
  scenes: CbersSceneJobState[];
}): Promise<{
  url: string;
  relativePath: string;
  filename: string;
  bytes: number;
  fileCount: number;
} | null> {
  const entries = args.scenes
    .filter((scene) => scene.status === "completed" && scene.archive?.hdPath)
    .map((scene) => {
      const absolutePath = String(scene.archive?.hdPath || "");
      return {
        absolutePath,
        name: scene.outputFilename || cbersOutputFilename(scene.scene?.id || scene.itemId),
      };
    })
    .filter((entry) => fs.existsSync(entry.absolutePath));
  if (!entries.length) return null;

  const filename = cbersBatchZipFilename(args.jobId);
  const tempZipPath = path.join(args.tmpDir, filename);
  const output = fs.createWriteStream(tempZipPath);
  const archive = archiver("zip", { zlib: { level: 0 } });

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const entry of entries) archive.file(entry.absolutePath, { name: entry.name });
    void archive.finalize().catch(reject);
  });

  if (!fs.existsSync(tempZipPath)) return null;
  const stored = saveCbersArchiveAsset({
    subdir: path.join("jobs", args.jobId),
    filename,
    sourcePath: tempZipPath,
  });
  return {
    url: stored.publicUrl,
    relativePath: stored.relativePath,
    filename,
    bytes: stored.bytes,
    fileCount: entries.length,
  };
}

async function runCbersJob(input: {
  uid: string;
  jobId: string;
  filename: string;
  area: CbersAreaContext;
  itemId: string;
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(CBERS_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, {
      stage: "geometry",
      percent: 2,
      message: input.area.geometry ? "Lendo limite da área enviada." : "Processando por órbita/ponto sem SHP.",
    });

    const result = await processCbersScene({
      uid,
      jobId,
      itemId: input.itemId,
      tmpDir,
      propertyGeometry: input.area.geometry,
      propertyGeometryHash: input.area.geometryHash,
      areaHa: input.area.areaHa,
    });
    const scene = result.scene || null;

    progress(uid, jobId, { stage: "save", percent: 96, message: "Salvando GeoTIFF no raster compartilhado." });
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "GeoTIFF CBERS-4A/WPM concluído.",
      outputUrl: result.outputUrl,
      outputRelativePath: result.outputRelativePath,
      outputFilename: result.outputFilename,
      outputBytes: result.outputBytes,
      archive: result.archive,
      archiveImageId: result.archiveImageId,
      wmsLayerName: result.wmsLayerName,
      wmsUrl: result.wmsUrl,
      wmsDownloadUrl: result.wmsDownloadUrl,
      completedAt: new Date().toISOString(),
      scene,
      scenes: [result],
    });
    finishJob({ jobId, status: "completed" });
    emitJobEvent(jobId, { type: "done", jobId, outputUrl: result.outputUrl });
  } catch (error: any) {
    if (error instanceof CbersCancelError || isCancelRequested(jobId)) {
      progress(uid, jobId, {
        status: "cancelled",
        stage: "cancelled",
        percent: 0,
        message: "Processamento CBERS cancelado.",
        error: "cancel_requested",
        scenes: [{
          itemId: input.itemId,
          status: "cancelled",
          stage: "cancelled",
          percent: 0,
          message: "Cancelado.",
        }],
      });
      finishJob({ jobId, status: "cancelled", error: "cancel_requested" });
      emitJobEvent(jobId, { type: "cancelled", jobId });
      return;
    }
    const message = String(error?.message || "Falha ao processar CBERS-4A/WPM.");
    progress(uid, jobId, {
      status: "failed",
      stage: "failed",
      message,
      error: message,
      scenes: [{
        itemId: input.itemId,
        status: "failed",
        stage: "failed",
        percent: 100,
        message: "Falha ao processar esta cena.",
        error: message,
      }],
    });
    finishJob({ jobId, status: "failed", error: message });
    emitJobEvent(jobId, { type: "error", jobId, message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    closeJobSubscribers(jobId);
  }
}

async function runCbersBatchJob(input: {
  uid: string;
  jobId: string;
  filename: string;
  area: CbersAreaContext;
  itemIds: string[];
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(CBERS_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });
  const sceneStates = new Map<string, CbersSceneJobState>();
  for (const itemId of input.itemIds) {
    sceneStates.set(itemId, {
      itemId,
      status: "processing",
      stage: "queued",
      percent: 1,
      message: "Aguardando processamento.",
    });
  }
  const persistBatch = (patch?: Partial<CbersProgressPatch>) => {
    const scenes = [...sceneStates.values()];
    const average = scenes.length
      ? scenes.reduce((acc, scene) => acc + Number(scene.percent || 0), 0) / scenes.length
      : 0;
    progress(uid, jobId, {
      mode: "batch",
      stage: patch?.stage || "batch",
      percent: patch?.percent ?? average,
      message: patch?.message || "Processando cenas CBERS selecionadas.",
      scenes,
      ...patch,
    });
  };

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, {
      mode: "batch",
      stage: "geometry",
      percent: 2,
      message: input.area.geometry ? "Lendo limite da área enviada." : "Processando por órbita/ponto sem SHP.",
    });
    persistBatch({ stage: "queued", message: `${input.itemIds.length} cena(s) na fila.` });

    let cursor = 0;
    const worker = async () => {
      while (cursor < input.itemIds.length) {
        const itemId = input.itemIds[cursor++];
        try {
          const result = await processCbersScene({
            uid,
            jobId,
            itemId,
            tmpDir,
            propertyGeometry: input.area.geometry,
            propertyGeometryHash: input.area.geometryHash,
            areaHa: input.area.areaHa,
            onSceneProgress: (patch) => {
              sceneStates.set(itemId, {
                ...(sceneStates.get(itemId) || { itemId, status: "processing", percent: 0 }),
                ...patch,
                itemId,
                status: patch.status || "processing",
                percent: clampPercent(Number(patch.percent ?? sceneStates.get(itemId)?.percent ?? 0)),
              });
              persistBatch();
            },
          });
          sceneStates.set(itemId, result);
          persistBatch({ message: `Cena ${itemId} concluída.` });
        } catch (error: any) {
          if (error instanceof CbersCancelError || isCancelRequested(jobId)) throw error;
          sceneStates.set(itemId, {
            ...(sceneStates.get(itemId) || { itemId }),
            itemId,
            status: "failed",
            stage: "failed",
            percent: 100,
            message: "Falha ao processar esta cena.",
            error: String(error?.message || "Falha ao processar cena."),
          });
          persistBatch({ message: `Cena ${itemId} falhou; demais cenas continuam.` });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CBERS_BATCH_CONCURRENCY, input.itemIds.length) }, () => worker()));

    const scenes = [...sceneStates.values()];
    const completed = scenes.filter((scene) => scene.status === "completed");
    const failed = scenes.filter((scene) => scene.status === "failed");
    const finalStatus: CbersJobStatus = completed.length > 0 ? "completed" : "failed";
    let batchZip: Awaited<ReturnType<typeof createCbersBatchZip>> = null;
    if (input.itemIds.length > 1 && completed.length > 0) {
      persistBatch({
        stage: "zip",
        percent: 99,
        message: `Compactando ${completed.length} GeoTIFF(s) do lote.`,
      });
      batchZip = await createCbersBatchZip({
        uid,
        jobId,
        tmpDir,
        scenes: completed,
      });
    }
    progress(uid, jobId, {
      status: finalStatus,
      mode: "batch",
      stage: finalStatus === "completed" ? "completed" : "failed",
      percent: 100,
      message:
        failed.length > 0
          ? `${completed.length} cena(s) concluída(s), ${failed.length} falharam.`
          : `${completed.length} cena(s) concluída(s).`,
      scenes,
      batchZipUrl: batchZip?.url,
      batchZipRelativePath: batchZip?.relativePath,
      batchZipFilename: batchZip?.filename,
      batchZipBytes: batchZip?.bytes,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: finalStatus, error: finalStatus === "failed" ? "all_scenes_failed" : undefined });
    emitJobEvent(jobId, { type: "done", jobId });
  } catch (error: any) {
    if (error instanceof CbersCancelError || isCancelRequested(jobId)) {
      for (const [itemId, current] of sceneStates.entries()) {
        if (current.status === "processing") {
          sceneStates.set(itemId, {
            ...current,
            status: "cancelled",
            stage: "cancelled",
            message: "Cancelado.",
          });
        }
      }
      progress(uid, jobId, {
        status: "cancelled",
        mode: "batch",
        stage: "cancelled",
        percent: 0,
        message: "Processamento CBERS cancelado.",
        error: "cancel_requested",
        scenes: [...sceneStates.values()],
      });
      finishJob({ jobId, status: "cancelled", error: "cancel_requested" });
      emitJobEvent(jobId, { type: "cancelled", jobId });
      return;
    }
    const message = String(error?.message || "Falha ao processar lote CBERS-4A/WPM.");
    progress(uid, jobId, {
      status: "failed",
      mode: "batch",
      stage: "failed",
      message,
      error: message,
      scenes: [...sceneStates.values()],
    });
    finishJob({ jobId, status: "failed", error: message });
    emitJobEvent(jobId, { type: "error", jobId, message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    closeJobSubscribers(jobId);
  }
}

export function registerCbersWpmRoutes(app: Express): void {
  startCbersTmpCleanup();

  app.post("/api/cbers-wpm/search", async (req: Request, res: Response) => {
    try {
      const area = parseOptionalAreaContext((req.body as any)?.propertyZip);
      const bbox = area.geometry ? featureBbox({ type: "Feature", properties: {}, geometry: area.geometry }) : null;
      const dateStart = normalizeDateParam((req.body as any)?.dateStart, false);
      const dateEnd = normalizeDateParam((req.body as any)?.dateEnd, true);
      const orbit = normalizeOrbitPointParam((req.body as any)?.orbit, "Órbita");
      const point = normalizeOrbitPointParam((req.body as any)?.point ?? (req.body as any)?.row, "Ponto");
      if (!bbox && (!orbit || !point)) {
        res.status(400).json({ error: "Envie um ZIP/SHP ou informe órbita e ponto para buscar sem SHP." });
        return;
      }
      const scenes = await searchCbersScenes(bbox, {
        dateStart,
        dateEnd,
        propertyGeometry: area.geometry,
        propertyGeometryHash: area.geometryHash,
        orbit,
        point,
      });
      res.json({
        ok: true,
        areaHa: area.areaHa,
        bbox,
        propertyGeometry: area.geometry,
        orbit,
        point,
        collection: CBERS_COLLECTION,
        dateStart,
        dateEnd,
        scenes,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao buscar cenas CBERS." });
    }
  });

  app.post("/api/cbers-wpm/estimate", async (req: Request, res: Response) => {
    try {
      const area = parseOptionalAreaContext((req.body as any)?.propertyZip);
      const rawIds = Array.isArray((req.body as any)?.itemIds)
        ? (req.body as any).itemIds
        : [(req.body as any)?.itemId];
      const itemIds: string[] = Array.from(
        new Set(rawIds.map((item: any) => String(item || "").trim()).filter(Boolean)),
      );
      if (!itemIds.length) {
        res.status(400).json({ error: "itemIds é obrigatório." });
        return;
      }
      const estimates = await Promise.all(
        itemIds.map(async (itemId) => {
          const item = await getStacItem(itemId);
          const rawScene = sceneFromStacFeature(item, area.geometry);
          const scene = rawScene ? attachArchiveAvailability(rawScene, area.geometryHash) : null;
          if (!scene) throw new Error(`Cena ${itemId} sem bandas obrigatórias.`);
          const estimate = await estimateSceneAssets({ itemId, areaHa: area.areaHa, scene });
          return { itemId, scene, estimate };
        }),
      );
      res.json({ ok: true, areaHa: area.areaHa, propertyGeometry: area.geometry, estimates });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao estimar cenas CBERS." });
    }
  });

  app.head("/api/cbers-wpm/wms-download", async (req: Request, res: Response) => {
    try {
      const itemId = String(req.query.itemId || "").trim();
      const imageId = String(req.query.imageId || "").trim();
      if (!itemId && !imageId) {
        res.status(400).end();
        return;
      }
      const resolved = resolveWmsZipRequest({ itemId, imageId });
      if (!resolved) {
        res.status(404).end();
        return;
      }
      setWmsZipHeaders(res, resolved.filename, resolved.files);
      res.status(200).end();
    } catch {
      res.status(500).end();
    }
  });

  app.get("/api/cbers-wpm/wms-download", async (req: Request, res: Response) => {
    try {
      const itemId = String(req.query.itemId || "").trim();
      const imageId = String(req.query.imageId || "").trim();
      if (!itemId && !imageId) {
        res.status(400).json({ error: "itemId ou imageId é obrigatório." });
        return;
      }
      const resolved = resolveWmsZipRequest({ itemId, imageId });
      if (!resolved) {
        res.status(404).json({ error: "Imagem CBERS não encontrada no WMS." });
        return;
      }
      await streamWmsZip(res, resolved.filename, resolved.files);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Falha ao baixar ZIP da imagem WMS." });
      } else {
        res.destroy(error);
      }
    }
  });

  app.post("/api/cbers-wpm/jobs", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const rawItemIds = Array.isArray((req.body as any)?.itemIds)
        ? (req.body as any).itemIds
        : [(req.body as any)?.itemId];
      const itemIds: string[] = Array.from(
        new Set(rawItemIds.map((item: any) => String(item || "").trim()).filter(Boolean)),
      );
      if (!itemIds.length) {
        res.status(400).json({ error: "itemId ou itemIds é obrigatório." });
        return;
      }
      const area = parseOptionalAreaContext((req.body as any)?.propertyZip);
      const archivedItem = itemIds.find((itemId) => Boolean(findExactArchiveAvailability(itemId, area.geometryHash)));
      if (archivedItem) {
        const archive = findExactArchiveAvailability(archivedItem, area.geometryHash);
        res.status(409).json({
          error: "Esta folha CBERS já está disponível no WMS. Use a imagem existente em vez de gerar novamente.",
          code: "CBERS_ALREADY_AVAILABLE_WMS",
          itemId: archivedItem,
          archiveImageId: archive?.archiveImageId,
          archiveFilename: archive?.archiveFilename,
          wmsLayerName: archive?.wmsLayerName,
          wmsUrl: archive?.wmsUrl,
          wmsDownloadUrl: archive?.wmsDownloadUrl,
        });
        return;
      }
      const filename = String((req.body as any)?.filename || "CBERS-4A/WPM").trim();
      const processingJob = startJob({
        uid,
        endpoint: "/api/cbers-wpm/jobs",
        metadata: { itemId: itemIds[0], itemIds, filename, hasPropertyGeometry: Boolean(area.geometry) },
      });
      const jobId = processingJob.jobId;
      persistCbersJob(uid, jobId, {
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento CBERS enviado para o servidor.",
        filename,
        itemId: itemIds[0],
        itemIds,
        mode: itemIds.length > 1 ? "batch" : "single",
        areaHa: area.areaHa || undefined,
        propertyGeometry: area.geometry,
        scenes: itemIds.map((itemId) => ({
          itemId,
          status: "processing",
          stage: "queued",
          percent: 1,
          message: "Aguardando processamento.",
        })),
        collection: CBERS_COLLECTION,
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId });
      if (itemIds.length > 1) {
        void runCbersBatchJob({ uid, jobId, filename, area, itemIds });
      } else {
        void runCbersJob({ uid, jobId, filename, area, itemId: itemIds[0] });
      }
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar job CBERS." });
    }
  });

  app.get("/api/cbers-wpm/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job CBERS não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/cbers-wpm/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job CBERS não encontrado." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });

    const status = String(data.status || "").toLowerCase();
    if (status === "completed" || status === "failed" || status === "cancelled") {
      res.end();
      return;
    }

    const set = eventSubscribers.get(jobId) || new Set<Response>();
    set.add(res);
    eventSubscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) eventSubscribers.delete(jobId);
    });
  });

  app.delete("/api/cbers-wpm/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.batchZipRelativePath || data.batchZipUrl || ""));
    if (Array.isArray(data.scenes)) {
      for (const scene of data.scenes) {
        removeStoragePath(String(scene?.batchZipRelativePath || scene?.batchZipUrl || ""));
      }
    }
    markCbersArchiveUserDeleted(uid, jobId);
    deleteDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    res.json({ ok: true });
  });
}
