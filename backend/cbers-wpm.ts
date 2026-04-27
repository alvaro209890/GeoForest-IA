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
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserFileFromPath,
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
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.CBERS_FETCH_TIMEOUT_MS || 120000));
const CBERS_BATCH_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CBERS_BATCH_CONCURRENCY || 2)));
const CBERS_DOWNLOAD_RETRIES = Math.max(1, Number(process.env.CBERS_DOWNLOAD_RETRIES || 3));
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
const GEOSERVER_DATA_DIR = process.env.GEOSERVER_DATA_DIR || "/home/server/geoserver_data";
const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE ||
    "https://wms.cursar.space/geoserver/cbers/wms",
).trim();

const eventSubscribers = new Map<string, Set<Response>>();
let geoserverLayerCache: { expiresAt: number; layers: string[] } | null = null;

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
  geometryHash?: string | null,
): CbersWmsAvailability | null {
  const cleanItemId = String(itemId || "").trim();
  const cleanGeometryHash = String(geometryHash || "").trim();
  if (!cleanItemId || !cleanGeometryHash) return null;
  const archive = listCbersArchiveRecords().find((record) => (
    record.itemId === cleanItemId &&
    record.geometryHash === cleanGeometryHash &&
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
  bbox: [number, number, number, number],
  options?: {
    dateStart?: string | null;
    dateEnd?: string | null;
    propertyGeometry?: Polygon | MultiPolygon;
    propertyGeometryHash?: string | null;
  },
): Promise<CbersScene[]> {
  const params = new URLSearchParams({
    bbox: bbox.join(","),
    limit: String(CBERS_SEARCH_LIMIT),
  });
  if (options?.dateStart || options?.dateEnd) {
    params.set("datetime", `${options.dateStart || ".."}/${options.dateEnd || ".."}`);
  }
  const url = `${STAC_ROOT}/collections/${encodeURIComponent(CBERS_COLLECTION)}/items?${params.toString()}`;
  const payload = await fetchJson<any>(url);
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return features
    .map((feature: any) => sceneFromStacFeature(feature, options?.propertyGeometry))
    .filter((scene: CbersScene | null): scene is CbersScene => Boolean(scene?.id))
    .map((scene: CbersScene) => attachArchiveAvailability(scene, options?.propertyGeometryHash))
    .sort((a: CbersScene, b: CbersScene) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
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
  const areaM2 = Math.max(1, areaHa * 10000);
  const panPixels = areaM2 / 4;
  const multispectralBytes = panPixels * 3 * 0.2;
  const panBytes = panPixels * 1;
  return Math.max(20_000_000, Math.round((multispectralBytes + panBytes) * 2.5));
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
  const areaM2 = Math.max(1, args.areaHa * 10000);
  const outputBytesEstimated = Math.max(1_000_000, Math.round((areaM2 / 4) * 3 * 0.75));
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

  report({
    stage: "download",
    percent: args.basePercent,
    message: `Baixando ${args.assetKey} com retomada automática.`,
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "-L",
        "-C", "-",
        "--fail",
        "--retry", String(CBERS_DOWNLOAD_RETRIES),
        "--retry-all-errors",
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
    const progressTimer = setInterval(() => {
      const downloaded = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
      const percent = expectedBytes
        ? args.basePercent + Math.min(1, downloaded / expectedBytes) * args.spanPercent
        : args.basePercent;
      report({
        stage: "download",
        percent,
        message: expectedBytes
          ? `Baixando ${args.assetKey}: ${(downloaded / 1024 / 1024).toFixed(1)} MB de ${(expectedBytes / 1024 / 1024).toFixed(1)} MB.`
          : `Baixando ${args.assetKey}: ${(downloaded / 1024 / 1024).toFixed(1)} MB.`,
      });
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
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`curl falhou ao baixar ${args.assetKey} (codigo ${code}): ${output.slice(-1200)}`));
    });
  });

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
    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      const matches = [...text.matchAll(/(\d{1,3})(?=\.\.\.)/g)];
      const latest = matches.at(-1);
      if (latest) {
        const inner = Math.max(0, Math.min(100, Number(latest[1])));
        report({
          stage: args.stage,
          percent: args.basePercent + (inner / 100) * args.spanPercent,
          message: args.message,
        });
      }
    };
    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);
    child.on("error", reject);
    const cancelTimer = setInterval(() => {
      if (!isCancelRequested(args.jobId)) return;
      child.kill("SIGTERM");
      reject(new CbersCancelError());
    }, 1000);
    child.on("close", (code) => {
      clearInterval(cancelTimer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${args.command} falhou com codigo ${code}: ${output.slice(-1200)}`));
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
  cutlinePath: string;
  propertyGeometry: Polygon | MultiPolygon;
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

  const clipped: Record<string, string> = {};
  const clipPlan = [
    { key: "BAND3", start: 50 },
    { key: "BAND4", start: 55 },
    { key: "BAND2", start: 60 },
    { key: "BAND0", start: 65 },
  ];
  for (const itemPlan of clipPlan) {
    const outputPath = path.join(sceneDir, `${itemPlan.key}_clip.tif`);
    await runCommand({
      uid,
      jobId,
      command: "gdalwarp",
      commandArgs: [
        "-overwrite",
        "-of", "GTiff",
        "-cutline", args.cutlinePath,
        "-crop_to_cutline",
        "-dstnodata", "0",
        "-multi",
        "-wo", "NUM_THREADS=ALL_CPUS",
        bandPaths[itemPlan.key],
        outputPath,
      ],
      basePercent: itemPlan.start,
      spanPercent: 5,
      stage: "clip",
      message: `Recortando ${itemPlan.key} pela área enviada.`,
      onProgress: report,
    });
    clipped[itemPlan.key] = outputPath;
    report({ stage: "clip", percent: itemPlan.start + 5, message: `${itemPlan.key} recortada.` });
  }

  const rawPansharpenPath = path.join(sceneDir, "cbers_342_pan_raw.tif");
  await runCommand({
    uid,
    jobId,
    command: "gdal_pansharpen.py",
    commandArgs: [
      clipped.BAND0,
      clipped.BAND3,
      clipped.BAND4,
      clipped.BAND2,
      rawPansharpenPath,
      "-of", "GTiff",
      "-r", "cubic",
      "-spat_adjust", "intersection",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
    ],
    basePercent: 72,
    spanPercent: 15,
    stage: "pansharpen",
    message: "Fusionando composição 3-4-2 com a pancromática.",
    onProgress: report,
  });
  report({ stage: "pansharpen", percent: 87, message: "Fusão pancromática concluída." });

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
    message: "Gerando GeoTIFF final para ArcMap.",
    onProgress: report,
  });
  report({ stage: "save", percent: 96, message: "Salvando GeoTIFF no banco do usuário." });

  const outputName = cbersOutputFilename(scene.id || args.itemId);
  const stored = saveUserFileFromPath({
    uid,
    area: "cbers/output",
    filename: outputName,
    sourcePath: finalTempPath,
  });
  report({ stage: "publish", percent: 98, message: "Publicando GeoTIFF no acervo WMS." });
  const archive = await publishCbersPanToArchive({
    uid,
    jobId,
    itemId: args.itemId,
    geometryHash: args.propertyGeometryHash,
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
    outputUrl: stored.publicUrl,
    outputRelativePath: stored.relativePath,
    outputFilename: outputName,
    outputBytes: stored.bytes,
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
    .filter((scene) => scene.status === "completed" && scene.outputRelativePath)
    .map((scene) => {
      const absolutePath = getAbsoluteStoragePath(String(scene.outputRelativePath));
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
  const stored = saveUserFileFromPath({
    uid: args.uid,
    area: "cbers/output",
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
  zipBuffer: Buffer;
  itemId: string;
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(CBERS_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, { stage: "geometry", percent: 2, message: "Lendo limite da área enviada." });
    const parsedArea = parseUserShapefile(input.zipBuffer);
    const propertyGeometryHash = hashPropertyGeometry(parsedArea.geometry);
    const cutlinePath = path.join(tmpDir, "cutline.geojson");
    fs.writeFileSync(
      cutlinePath,
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: parsedArea.geometry }],
      }),
      "utf8",
    );

    const result = await processCbersScene({
      uid,
      jobId,
      itemId: input.itemId,
      tmpDir,
      cutlinePath,
      propertyGeometry: parsedArea.geometry,
      propertyGeometryHash,
      areaHa: parsedArea.areaHa,
    });
    const scene = result.scene || null;

    progress(uid, jobId, { stage: "save", percent: 96, message: "Salvando GeoTIFF no banco do usuário." });
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
  zipBuffer: Buffer;
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
    progress(uid, jobId, { mode: "batch", stage: "geometry", percent: 2, message: "Lendo limite da área enviada." });
    const parsedArea = parseUserShapefile(input.zipBuffer);
    const propertyGeometryHash = hashPropertyGeometry(parsedArea.geometry);
    const cutlinePath = path.join(tmpDir, "cutline.geojson");
    fs.writeFileSync(
      cutlinePath,
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: parsedArea.geometry }],
      }),
      "utf8",
    );
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
            cutlinePath,
            propertyGeometry: parsedArea.geometry,
            propertyGeometryHash,
            areaHa: parsedArea.areaHa,
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
  app.post("/api/cbers-wpm/search", async (req: Request, res: Response) => {
    try {
      const zipBuffer = parseBase64Zip((req.body as any)?.propertyZip);
      const parsed = parseUserShapefile(zipBuffer);
      const propertyGeometryHash = hashPropertyGeometry(parsed.geometry);
      const bbox = featureBbox(parsed.polygon);
      const dateStart = normalizeDateParam((req.body as any)?.dateStart, false);
      const dateEnd = normalizeDateParam((req.body as any)?.dateEnd, true);
      const scenes = await searchCbersScenes(bbox, {
        dateStart,
        dateEnd,
        propertyGeometry: parsed.geometry,
        propertyGeometryHash,
      });
      res.json({
        ok: true,
        areaHa: parsed.areaHa,
        bbox,
        propertyGeometry: parsed.geometry,
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
      const zipBuffer = parseBase64Zip((req.body as any)?.propertyZip);
      const parsed = parseUserShapefile(zipBuffer);
      const propertyGeometryHash = hashPropertyGeometry(parsed.geometry);
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
          const rawScene = sceneFromStacFeature(item, parsed.geometry);
          const scene = rawScene ? attachArchiveAvailability(rawScene, propertyGeometryHash) : null;
          if (!scene) throw new Error(`Cena ${itemId} sem bandas obrigatórias.`);
          const estimate = await estimateSceneAssets({ itemId, areaHa: parsed.areaHa, scene });
          return { itemId, scene, estimate };
        }),
      );
      res.json({ ok: true, areaHa: parsed.areaHa, estimates });
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
      const zipBuffer = parseBase64Zip((req.body as any)?.propertyZip);
      const parsed = parseUserShapefile(zipBuffer);
      const propertyGeometryHash = hashPropertyGeometry(parsed.geometry);
      const archivedItem = itemIds.find((itemId) => Boolean(findExactArchiveAvailability(itemId, propertyGeometryHash)));
      if (archivedItem) {
        const archive = findExactArchiveAvailability(archivedItem, propertyGeometryHash);
        res.status(409).json({
          error: "Este recorte CBERS já está disponível no WMS. Use a imagem existente em vez de gerar novamente.",
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
      const filename = String((req.body as any)?.filename || "area.zip").trim();
      const processingJob = startJob({
        uid,
        endpoint: "/api/cbers-wpm/jobs",
        metadata: { itemId: itemIds[0], itemIds, filename },
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
        void runCbersBatchJob({ uid, jobId, filename, zipBuffer, itemIds });
      } else {
        void runCbersJob({ uid, jobId, filename, zipBuffer, itemId: itemIds[0] });
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
    removeStoragePath(String(data.outputRelativePath || data.outputUrl || ""));
    removeStoragePath(String(data.batchZipRelativePath || data.batchZipUrl || ""));
    if (Array.isArray(data.scenes)) {
      for (const scene of data.scenes) {
        removeStoragePath(String(scene?.outputRelativePath || scene?.outputUrl || ""));
      }
    }
    markCbersArchiveUserDeleted(uid, jobId);
    deleteDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    res.json({ ok: true });
  });
}
