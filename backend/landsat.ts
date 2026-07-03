import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  area as turfArea,
  bboxPolygon,
  featureCollection,
  intersect as turfIntersect,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { fetchCarBoundaryByNumber, parseUserShapefile } from "./simcar-clip";
import {
  deleteDocBySegments,
  readDocBySegments,
  removeStoragePath,
  STORAGE_ROOT,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";

type LandsatJobStatus = "processing" | "completed" | "failed" | "cancelled";
type LandsatComposition = "false_color" | "natural_color";
type LandsatSource = "local_wms" | "usgs_stac";
type PlainObject = Record<string, any>;

export type LandsatScene = {
  id: string;
  source: LandsatSource;
  collectionId?: string;
  platform?: string;
  sensor?: string;
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  datetime: string;
  cloudCover: number | null;
  composition: LandsatComposition;
  compositionLabel: string;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon | MultiPolygon;
  thumbnailUrl?: string;
  coveragePercent?: number;
  coversArea?: boolean;
  assetKeys?: string[];
  downloadBytes?: number | null;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  sourcePath?: string;
  outputFilename?: string;
};

type LandsatJobState = {
  sceneId: string;
  scene?: LandsatScene | null;
  status: LandsatJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
};

type LandsatAreaContext = {
  geometry?: Polygon | MultiPolygon;
  geometryHash?: string | null;
  areaHa: number;
};

type LandsatProgressPatch = Partial<LandsatJobState> & {
  filename?: string;
  completedAt?: string;
  mode?: "single";
};

type LandsatLocalRecord = {
  layerName: string;
  storeName: string;
  title: string;
  sourcePath: string;
  bytes: number;
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
  composition: LandsatComposition;
  compositionLabel: string;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon;
};

type LandsatWmsZipFile = {
  absolutePath: string;
  name: string;
};

const LANDSAT_STAC_ROOT = String(
  process.env.LANDSAT_STAC_ROOT || "https://landsatlook.usgs.gov/stac-server",
).replace(/\/+$/, "");
const LANDSAT_STAC_COLLECTION = process.env.LANDSAT_STAC_COLLECTION || "landsat-c2l2-sr";
const LANDSAT_PC_STAC_ROOT = String(
  process.env.LANDSAT_PC_STAC_ROOT || "https://planetarycomputer.microsoft.com/api/stac/v1",
).replace(/\/+$/, "");
const LANDSAT_PC_COLLECTION = process.env.LANDSAT_PC_COLLECTION || "landsat-c2-l2";
const LANDSAT_PC_SIGN_ROOT = String(
  process.env.LANDSAT_PC_SIGN_ROOT || "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
).replace(/\/+$/, "");
const LANDSAT_ARCHIVE_ROOT = path.resolve(
  process.env.LANDSAT_ARCHIVE_ROOT || "/media/server/HD Backup/RASTER/LANDSAT",
);
const LANDSAT_TMP_ROOT = process.env.LANDSAT_TMP_ROOT || "/tmp/geoforest-landsat";
const LANDSAT_SEARCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.LANDSAT_SEARCH_LIMIT || 50)));
const LANDSAT_DOWNLOAD_RETRIES = Math.max(0, Number(process.env.LANDSAT_DOWNLOAD_RETRIES || 3));
const LANDSAT_MIN_DOWNLOAD_BYTES = Math.max(0, Number(process.env.LANDSAT_MIN_DOWNLOAD_BYTES || 1024 * 1024));
const LANDSAT_SCALE_MIN = Number(process.env.LANDSAT_SCALE_MIN || 1);
const LANDSAT_SCALE_MAX = Number(process.env.LANDSAT_SCALE_MAX || 30000);
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.LANDSAT_FETCH_TIMEOUT_MS || 120000));
const GEOSERVER_DATA_DIR = process.env.GEOSERVER_DATA_DIR || "/home/server/geoserver_data";
const GEOSERVER_BASE_URL = String(
  process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
).replace(/\/+$/, "");
const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
const GEOSERVER_LANDSAT_STYLE = process.env.GEOSERVER_LANDSAT_STYLE || "landsat_rgb";
const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE || "https://wms.cursar.space/geoserver/cbers/wms",
).trim();
const ROOT_RASTER_GROUP = "RASTER";
const ROOT_LANDSAT_GROUP = "LANDSAT";

const eventSubscribers = new Map<string, Set<Response>>();

function safeName(value: unknown, fallback = "landsat"): string {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeOrbitPointParam(raw: unknown, label: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) throw new Error(`${label} deve conter até 3 dígitos.`);
  return value.padStart(3, "0");
}

function normalizeDateParam(raw: unknown, endOfDay = false): string | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = `${value}${endOfDay ? "T23:59:59Z" : "T00:00:00Z"}`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  if (!payload) throw new Error("ZIP da área é obrigatório.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP da área é inválido ou muito pequeno.");
  return buffer;
}

function parseOptionalAreaContext(raw: unknown): LandsatAreaContext {
  const value = String(raw || "").trim();
  if (!value) return { areaHa: 0 };
  const parsed = parseUserShapefile(parseBase64Zip(value));
  return {
    geometry: parsed.geometry,
    geometryHash: hashPropertyGeometry(parsed.geometry),
    areaHa: parsed.areaHa,
  };
}

async function resolveAreaContextFromRequest(body: any): Promise<LandsatAreaContext> {
  const propertyZip = body?.propertyZip;
  const carNumber = String(body?.carNumber || "").trim();
  if (propertyZip && carNumber) throw new Error("Informe ZIP/SHP ou Nº do CAR estadual, não os dois ao mesmo tempo.");
  if (carNumber) {
    const feature = await fetchCarBoundaryByNumber(carNumber);
    return {
      geometry: feature.geometry,
      geometryHash: hashPropertyGeometry(feature.geometry),
      areaHa: turfArea(feature) / 10000,
    };
  }
  return parseOptionalAreaContext(propertyZip);
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

function computeSceneCoverage(
  propertyGeometry: Polygon | MultiPolygon,
  sceneGeometry?: Polygon | MultiPolygon,
): { coveragePercent: number; coversArea: boolean } {
  if (!sceneGeometry) return { coveragePercent: 0, coversArea: false };
  const propertyFeature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: propertyGeometry };
  const sceneFeature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: sceneGeometry };
  try {
    const totalArea = turfArea(propertyFeature);
    if (!Number.isFinite(totalArea) || totalArea <= 0) return { coveragePercent: 0, coversArea: false };
    const intersection = turfIntersect(featureCollection([propertyFeature, sceneFeature]) as any);
    const intersectionArea = intersection ? turfArea(intersection as any) : 0;
    const coveragePercent = Math.max(0, Math.min(100, Number(((intersectionArea / totalArea) * 100).toFixed(2))));
    return { coveragePercent, coversArea: coveragePercent >= 99.5 };
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
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ type: geometry.type, coordinates: normalizeGeometryValueForHash(geometry.coordinates) }))
    .digest("hex");
}

function bboxGeometry(bbox: [number, number, number, number] | null): Polygon | undefined {
  return bbox ? bboxPolygon(bbox).geometry as Polygon : undefined;
}

function publicWmsCapabilitiesUrl(): string {
  return `${GEOSERVER_PUBLIC_WMS_BASE.replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

function wmsDownloadPathForLayer(layerName: string): string {
  return `/api/landsat/wms-download?layerName=${encodeURIComponent(layerName)}`;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
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
      throw new Error(`STAC Landsat ${response.status}: ${text.slice(0, 300)}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function decodeGeoserverFileUrl(rawUrl: string): string {
  const raw = String(rawUrl || "").trim().replace(/^file:/i, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw.replace(/%20/g, " ");
  }
}

function xmlValue(xml: string, tag: string): string {
  return String(xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .trim();
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function parseBboxFromCoverageXml(xml: string): [number, number, number, number] | null {
  const block = String(xml.match(/<latLonBoundingBox>([\s\S]*?)<\/latLonBoundingBox>/i)?.[1] || "");
  const minx = firstFiniteNumber(xmlValue(block, "minx"));
  const miny = firstFiniteNumber(xmlValue(block, "miny"));
  const maxx = firstFiniteNumber(xmlValue(block, "maxx"));
  const maxy = firstFiniteNumber(xmlValue(block, "maxy"));
  if ([minx, miny, maxx, maxy].some((item) => item === null)) return null;
  if (!(Number(maxx) > Number(minx)) || !(Number(maxy) > Number(miny))) return null;
  return [Number(minx), Number(miny), Number(maxx), Number(maxy)];
}

function parseDateCompact(value: string): string {
  const clean = String(value || "");
  const compact = clean.match(/(20\d{2}|19\d{2})(\d{2})(\d{2})/)?.[0];
  if (compact) return compact;
  const separated = clean.match(/(20\d{2}|19\d{2})[_-](\d{2})[_-](\d{2})/);
  return separated ? `${separated[1]}${separated[2]}${separated[3]}` : "";
}

function isoFromDateCompact(dateCompact: string): string {
  if (!/^\d{8}$/.test(dateCompact)) return "";
  const iso = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}T00:00:00Z`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : "";
}

function platformFromText(value: string): string | undefined {
  const text = String(value || "").toLowerCase();
  if (/lc09|landsat[_\s-]*9|\bl9\b/.test(text)) return "landsat-9";
  if (/lc08|landsat[_\s-]*8|\bl8\b|lo8/.test(text)) return "landsat-8";
  if (/le07|landsat[_\s-]*7|\bl7\b/.test(text)) return "landsat-7";
  if (/lt05|landsat[_\s-]*5|\bl5\b|lt5/.test(text)) return "landsat-5";
  return undefined;
}

function compositionFromText(value: string, fallback: LandsatComposition = "false_color"): LandsatComposition {
  const text = String(value || "").toLowerCase();
  if (/c(?:omp)?(?:432|321)|band3_2_1|b4_3_2/.test(text)) return "natural_color";
  if (/c(?:omp)?(?:654|543)|band5_4_3|b6_5_4/.test(text)) return "false_color";
  return fallback;
}

function compositionLabel(platform: string | undefined, composition: LandsatComposition): string {
  const isOli = platform === "landsat-8" || platform === "landsat-9";
  if (composition === "natural_color") return isOli ? "C432" : "C321";
  return isOli ? "C654" : "C543";
}

export function parseLandsatLayerName(layerName: string): {
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
  composition: LandsatComposition;
  compositionLabel: string;
} | null {
  const name = safeName(layerName).toLowerCase();
  const match = name.match(/^landsat_(\d{3})_(\d{3})_(\d{4})_(.+)$/);
  if (!match) return null;
  const platform = platformFromText(name);
  const composition = compositionFromText(name);
  return {
    path: match[1],
    row: match[2],
    orbit: `${match[1]}_${match[2]}`,
    year: match[3],
    date: parseDateCompact(name),
    platform,
    composition,
    compositionLabel: compositionLabel(platform, composition),
  };
}

export function parseLandsatStacId(itemId: string): {
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
} | null {
  const id = String(itemId || "").trim();
  const match = id.match(/_(\d{3})(\d{3})_(\d{8})_/);
  if (!match) return null;
  return {
    path: match[1],
    row: match[2],
    orbit: `${match[1]}_${match[2]}`,
    year: match[3].slice(0, 4),
    date: match[3],
    platform: platformFromText(id),
  };
}

export function landsatAssetKeysForComposition(composition: LandsatComposition): [string, string, string] {
  return composition === "natural_color"
    ? ["red", "green", "blue"]
    : ["swir16", "nir08", "red"];
}

export function buildLandsatOutputFilename(itemId: string, composition: LandsatComposition): string {
  const parsed = parseLandsatStacId(itemId);
  const label = compositionLabel(parsed?.platform, composition);
  return `${safeName(itemId.replace(/_SR$/i, ""), "LANDSAT")}_${label}.TIF`;
}

export function planetaryComputerItemIdFromLandsatId(itemId: string): string {
  const id = String(itemId || "").trim();
  const match = id.match(/^([A-Z0-9]+_L2SP_\d{6}_\d{8})_\d{8}_(\d{2}_T[12])(?:_(?:SR|ST))?$/i);
  if (match) return `${match[1]}_${match[2]}`;
  return id.replace(/_(?:SR|ST)$/i, "");
}

function geoserverWorkspaceDir(): string {
  return path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE);
}

function readLocalLandsatRecords(): LandsatLocalRecord[] {
  const root = geoserverWorkspaceDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^landsat_/i.test(entry.name))
    .map((entry): LandsatLocalRecord | null => {
      try {
        const storeName = entry.name;
        const storeXmlPath = path.join(root, storeName, "coveragestore.xml");
        const coverageXmlPath = path.join(root, storeName, storeName, "coverage.xml");
        if (!fs.existsSync(storeXmlPath) || !fs.existsSync(coverageXmlPath)) return null;
        const storeXml = fs.readFileSync(storeXmlPath, "utf8");
        const coverageXml = fs.readFileSync(coverageXmlPath, "utf8");
        const sourcePath = decodeGeoserverFileUrl(xmlValue(storeXml, "url"));
        if (!sourcePath || !fs.existsSync(sourcePath)) return null;
        const parsed = parseLandsatLayerName(storeName);
        if (!parsed) return null;
        const title = xmlValue(coverageXml, "title") || path.basename(sourcePath, path.extname(sourcePath));
        const bbox = parseBboxFromCoverageXml(coverageXml);
        return {
          layerName: storeName,
          storeName,
          title,
          sourcePath,
          bytes: fs.statSync(sourcePath).size,
          ...parsed,
          bbox,
          geometry: bboxGeometry(bbox),
        } satisfies LandsatLocalRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is LandsatLocalRecord => Boolean(record));
}

function localRecordToScene(record: LandsatLocalRecord, propertyGeometry?: Polygon | MultiPolygon): LandsatScene {
  const coverage = propertyGeometry && record.geometry
    ? computeSceneCoverage(propertyGeometry, record.geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  return {
    id: record.layerName,
    source: "local_wms",
    platform: record.platform,
    path: record.path,
    row: record.row,
    orbit: record.orbit,
    year: record.year,
    date: record.date,
    datetime: isoFromDateCompact(record.date),
    cloudCover: null,
    composition: record.composition,
    compositionLabel: record.compositionLabel,
    bbox: record.bbox,
    geometry: record.geometry,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
    downloadBytes: record.bytes,
    wmsAvailable: true,
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${record.layerName}`,
    wmsStoreName: record.storeName,
    wmsUrl: publicWmsCapabilitiesUrl(),
    wmsDownloadUrl: wmsDownloadPathForLayer(record.layerName),
    sourcePath: record.sourcePath,
    outputFilename: path.basename(record.sourcePath),
  };
}

function findLocalRecordByLayerName(layerName: string): LandsatLocalRecord | null {
  const clean = safeName(String(layerName || "").replace(/^cbers:/i, ""));
  if (!/^landsat_/i.test(clean)) return null;
  return readLocalLandsatRecords().find((record) => record.layerName === clean) || null;
}

function findLocalRecordForExternal(scene: LandsatScene): LandsatLocalRecord | null {
  return readLocalLandsatRecords().find((record) => (
    record.path === scene.path &&
    record.row === scene.row &&
    record.date === scene.date &&
    record.composition === scene.composition
  )) || null;
}

function sceneFromStacFeature(feature: any, composition: LandsatComposition, propertyGeometry?: Polygon | MultiPolygon): LandsatScene | null {
  const id = String(feature?.id || "").trim();
  const parsed = parseLandsatStacId(id);
  if (!parsed) return null;
  const assets = feature?.assets && typeof feature.assets === "object" ? feature.assets : {};
  const assetKeys = landsatAssetKeysForComposition(composition);
  if (!assetKeys.every((key) => Boolean(assets[key]?.href))) return null;
  const bbox = Array.isArray(feature?.bbox) && feature.bbox.length >= 4
    ? [Number(feature.bbox[0]), Number(feature.bbox[1]), Number(feature.bbox[2]), Number(feature.bbox[3])] as [number, number, number, number]
    : null;
  const geometry = feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon"
    ? feature.geometry as Polygon | MultiPolygon
    : bboxGeometry(bbox);
  const coverage = propertyGeometry && geometry
    ? computeSceneCoverage(propertyGeometry, geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  const platform = String(feature?.properties?.platform || parsed.platform || "").trim() || parsed.platform;
  const scene: LandsatScene = {
    id,
    source: "usgs_stac",
    collectionId: String(feature?.collection || LANDSAT_STAC_COLLECTION),
    platform,
    sensor: Array.isArray(feature?.properties?.instruments) ? feature.properties.instruments.join(", ") : undefined,
    path: parsed.path,
    row: parsed.row,
    orbit: parsed.orbit,
    year: parsed.year,
    date: parsed.date,
    datetime: String(feature?.properties?.datetime || isoFromDateCompact(parsed.date)),
    cloudCover: Number.isFinite(Number(feature?.properties?.["eo:cloud_cover"]))
      ? Number(feature.properties["eo:cloud_cover"])
      : null,
    composition,
    compositionLabel: compositionLabel(platform, composition),
    bbox,
    geometry,
    thumbnailUrl: assets.thumbnail?.href || assets.reduced_resolution_browse?.href,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
    assetKeys,
  };
  const local = findLocalRecordForExternal(scene);
  return local ? localRecordToScene(local, propertyGeometry) : scene;
}

async function searchExternalLandsatScenes(args: {
  bbox: [number, number, number, number] | null;
  propertyGeometry?: Polygon | MultiPolygon;
  dateStart?: string | null;
  dateEnd?: string | null;
  orbit?: string | null;
  row?: string | null;
  maxCloud?: number | null;
  composition: LandsatComposition;
}): Promise<LandsatScene[]> {
  const body: PlainObject = {
    collections: [LANDSAT_STAC_COLLECTION],
    limit: LANDSAT_SEARCH_LIMIT,
  };
  if (args.bbox) body.bbox = args.bbox;
  if (args.dateStart || args.dateEnd) body.datetime = `${args.dateStart || ".."}/${args.dateEnd || ".."}`;
  if (args.orbit && args.row) {
    body.query = {
      "landsat:wrs_path": { eq: args.orbit },
      "landsat:wrs_row": { eq: args.row },
    };
  }
  const payload = await fetchJson<any>(`${LANDSAT_STAC_ROOT}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const byId = new Map<string, LandsatScene>();
  for (const feature of features) {
    const scene = sceneFromStacFeature(feature, args.composition, args.propertyGeometry);
    if (!scene) continue;
    if (args.orbit && scene.path !== args.orbit) continue;
    if (args.row && scene.row !== args.row) continue;
    if (args.maxCloud !== null && args.maxCloud !== undefined && scene.cloudCover !== null && scene.cloudCover > args.maxCloud) continue;
    byId.set(scene.id, scene);
  }
  return [...byId.values()];
}

function searchLocalLandsatScenes(args: {
  propertyGeometry?: Polygon | MultiPolygon;
  dateStart?: string | null;
  dateEnd?: string | null;
  orbit?: string | null;
  row?: string | null;
  composition?: LandsatComposition | "any";
}): LandsatScene[] {
  const startMs = args.dateStart ? new Date(args.dateStart).getTime() : null;
  const endMs = args.dateEnd ? new Date(args.dateEnd).getTime() : null;
  return readLocalLandsatRecords()
    .filter((record) => {
      if (args.orbit && record.path !== args.orbit) return false;
      if (args.row && record.row !== args.row) return false;
      if (args.composition && args.composition !== "any" && record.composition !== args.composition) return false;
      const recordMs = record.date ? new Date(isoFromDateCompact(record.date)).getTime() : NaN;
      if (Number.isFinite(recordMs)) {
        if (startMs !== null && Number.isFinite(startMs) && recordMs < startMs) return false;
        if (endMs !== null && Number.isFinite(endMs) && recordMs > endMs) return false;
      }
      return true;
    })
    .map((record) => localRecordToScene(record, args.propertyGeometry))
    .filter((scene) => scene.coversArea !== false);
}

async function getStacItem(itemId: string): Promise<any> {
  return fetchJson<any>(
    `${LANDSAT_STAC_ROOT}/collections/${encodeURIComponent(LANDSAT_STAC_COLLECTION)}/items/${encodeURIComponent(itemId)}`,
  );
}

async function getPlanetaryComputerStacItem(itemId: string): Promise<any> {
  const pcItemId = planetaryComputerItemIdFromLandsatId(itemId);
  return fetchJson<any>(
    `${LANDSAT_PC_STAC_ROOT}/collections/${encodeURIComponent(LANDSAT_PC_COLLECTION)}/items/${encodeURIComponent(pcItemId)}`,
  );
}

function isAzureBlobHref(href: string): boolean {
  return /^https:\/\/[^/]+\.blob\.core\.windows\.net\//i.test(String(href || ""));
}

async function signPlanetaryComputerHref(href: string): Promise<string> {
  if (!isAzureBlobHref(href)) return href;
  const signed = await fetchJson<{ href?: string }>(
    `${LANDSAT_PC_SIGN_ROOT}?href=${encodeURIComponent(href)}`,
  );
  return signed.href || href;
}

async function prepareDownloadableLandsatItem(item: any): Promise<any> {
  try {
    const pcItem = await getPlanetaryComputerStacItem(String(item?.id || ""));
    const assets = pcItem?.assets && typeof pcItem.assets === "object" ? pcItem.assets : {};
    const signedAssets: PlainObject = {};
    await Promise.all(Object.entries(assets).map(async ([key, asset]: [string, any]) => {
      const href = String(asset?.href || "");
      signedAssets[key] = href
        ? { ...asset, href: await signPlanetaryComputerHref(href) }
        : asset;
    }));
    return { ...pcItem, assets: signedAssets };
  } catch {
    return item;
  }
}

async function estimateScene(scene: LandsatScene): Promise<LandsatScene> {
  if (scene.source === "local_wms") return scene;
  const item = await prepareDownloadableLandsatItem(await getStacItem(scene.id));
  const keys = landsatAssetKeysForComposition(scene.composition);
  let total = 0;
  let complete = true;
  for (const key of keys) {
    const href = item?.assets?.[key]?.href;
    if (!href) {
      complete = false;
      continue;
    }
    const size = await headContentLength(href);
    if (size === null) complete = false;
    else total += size;
  }
  return { ...scene, downloadBytes: complete ? total : null };
}

async function headContentLength(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || "");
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function gdalEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GDAL_DISABLE_READDIR_ON_OPEN: process.env.GDAL_DISABLE_READDIR_ON_OPEN || "EMPTY_DIR",
    GDAL_HTTP_MAX_RETRY: process.env.GDAL_HTTP_MAX_RETRY || "8",
    GDAL_HTTP_RETRY_DELAY: process.env.GDAL_HTTP_RETRY_DELAY || "2",
    GDAL_HTTP_CONNECTTIMEOUT: process.env.GDAL_HTTP_CONNECTTIMEOUT || "20",
    GDAL_HTTP_TIMEOUT: process.env.GDAL_HTTP_TIMEOUT || "300",
  };
}

async function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
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

async function downloadFile(url: string, destPath: string): Promise<number> {
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

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileAtomic(sourcePath: string, destPath: string): number {
  ensureDir(path.dirname(destPath));
  const tmp = path.join(path.dirname(destPath), `.${path.basename(destPath)}.${crypto.randomUUID()}.tmp`);
  fs.copyFileSync(sourcePath, tmp);
  const bytes = fs.statSync(tmp).size;
  fs.renameSync(tmp, destPath);
  return bytes;
}

async function createLandsatComposite(args: {
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

function landsatArchivePath(scene: LandsatScene, filename: string): string {
  return path.join(LANDSAT_ARCHIVE_ROOT, scene.orbit, scene.year, safeName(filename));
}

function cleanLayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildStoreName(scene: LandsatScene, filename: string): string {
  return cleanLayerName(`landsat_${scene.orbit}_${scene.year}_${path.basename(filename, path.extname(filename))}`);
}

type LayerGroupUpsert = {
  name: string;
  title: string;
  publishable: PlainObject;
  style: PlainObject | string;
};

export function landsatLayerGroupNames(orbit: string, year: string): {
  rasterGroup: string;
  rootGroup: string;
  orbitGroup: string;
  yearGroup: string;
} {
  return {
    rasterGroup: ROOT_RASTER_GROUP,
    rootGroup: ROOT_LANDSAT_GROUP,
    orbitGroup: `landsat_orbit_${safeName(orbit, "000_000")}`,
    yearGroup: `landsat_orbit_${safeName(orbit, "000_000")}_y${safeName(year, "0000")}`,
  };
}

export function buildLandsatLayerGroupHierarchy(args: {
  storeName: string;
  orbit: string;
  year: string;
}): LayerGroupUpsert[] {
  const names = landsatLayerGroupNames(args.orbit, args.year);
  return [
    {
      name: names.yearGroup,
      title: args.year,
      publishable: {
        "@type": "layer",
        name: `${GEOSERVER_WORKSPACE}:${args.storeName}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layers/${args.storeName}.json`,
      },
      style: { name: GEOSERVER_LANDSAT_STYLE, href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_LANDSAT_STYLE}.json` },
    },
    {
      name: names.orbitGroup,
      title: args.orbit,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.yearGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.yearGroup}.json`,
      },
      style: "",
    },
    {
      name: names.rootGroup,
      title: names.rootGroup,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.orbitGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.orbitGroup}.json`,
      },
      style: "",
    },
    {
      name: names.rasterGroup,
      title: names.rasterGroup,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.rootGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.rootGroup}.json`,
      },
      style: "",
    },
  ];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function geoserverFetch(restPath: string, options: RequestInit = {}): Promise<globalThis.Response> {
  return await fetch(`${GEOSERVER_BASE_URL}${restPath}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.headers || {}),
    },
  }) as globalThis.Response;
}

async function geoserverJson(restPath: string): Promise<PlainObject | null> {
  const response = await geoserverFetch(restPath, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GeoServer GET ${restPath} falhou: ${response.status}`);
  return await response.json() as PlainObject;
}

async function geoserverWrite(restPath: string, method: "POST" | "PUT", body?: string, contentType?: string): Promise<void> {
  const response = await geoserverFetch(restPath, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if ([200, 201, 202, 204, 409].includes(response.status)) return;
  const text = await response.text().catch(() => "");
  throw new Error(`GeoServer ${method} ${restPath} falhou: ${response.status} ${text.slice(0, 300)}`);
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function groupPublished(payload: PlainObject | null): PlainObject[] {
  return asArray(payload?.layerGroup?.publishables?.published);
}

function groupStyles(payload: PlainObject | null): any[] {
  return asArray(payload?.layerGroup?.styles?.style);
}

async function upsertLayerGroup(args: LayerGroupUpsert): Promise<void> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}.json`,
  );
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const alreadyAt = currentPublished.findIndex((item) => String(item?.name || "") === args.publishable.name);
  const published = alreadyAt >= 0 ? currentPublished : [...currentPublished, args.publishable];
  const styles = alreadyAt >= 0 ? currentStyles : [...currentStyles, args.style];
  const body = JSON.stringify({
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
  });
  if (existing) {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}`,
      "PUT",
      body,
      "application/json",
    );
  } else {
    await geoserverWrite(`/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups`, "POST", body, "application/json");
  }
}

async function removeDirectLayersFromLayerGroup(groupName: string): Promise<number> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}.json`,
  );
  if (!existing?.layerGroup) return 0;
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const published: PlainObject[] = [];
  const styles: any[] = [];
  let removed = 0;
  currentPublished.forEach((item, index) => {
    if (String(item?.["@type"] || "").toLowerCase() === "layer") {
      removed += 1;
      return;
    }
    published.push(item);
    styles.push(currentStyles[index] ?? "");
  });
  if (!removed) return 0;
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
  return removed;
}

export async function repairLandsatWmsTree(): Promise<{ records: number; directLayersRemoved: number }> {
  const records = readLocalLandsatRecords();
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.storeName}:${record.orbit}:${record.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const group of buildLandsatLayerGroupHierarchy({
      storeName: record.storeName,
      orbit: record.orbit,
      year: record.year,
    })) {
      await upsertLayerGroup(group);
    }
  }
  const directLayersRemoved = await removeDirectLayersFromLayerGroup(ROOT_LANDSAT_GROUP);
  return { records: seen.size, directLayersRemoved };
}

async function publishLandsatGeoTiff(args: {
  storeName: string;
  title: string;
  hdPath: string;
  orbit: string;
  year: string;
}): Promise<void> {
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores`,
    "POST",
    `<coverageStore><name>${xmlEscape(args.storeName)}</name><type>GeoTIFF</type><enabled>true</enabled><workspace><name>${xmlEscape(GEOSERVER_WORKSPACE)}</name></workspace></coverageStore>`,
    "application/xml",
  );
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/external.geotiff` +
      `?configure=first&coverageName=${encodeURIComponent(args.storeName)}&recalculate=nativebbox,latlonbbox`,
    "PUT",
    args.hdPath,
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
          name: GEOSERVER_LANDSAT_STYLE,
          href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_LANDSAT_STYLE}.json`,
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
  for (const group of buildLandsatLayerGroupHierarchy(args)) {
    await upsertLayerGroup(group);
  }
  await removeDirectLayersFromLayerGroup(ROOT_LANDSAT_GROUP);
  await verifyLandsatWmsPublication(args.storeName);
}

async function verifyLandsatWmsPublication(storeName: string): Promise<void> {
  const layer = await geoserverJson(`/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(storeName)}.json`);
  if (!layer?.layer) throw new Error(`GeoServer não retornou a layer Landsat ${GEOSERVER_WORKSPACE}:${storeName}.`);
  const coverage = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(storeName)}/coverages/${encodeURIComponent(storeName)}.json`,
  );
  const bbox = coverage?.coverage?.latLonBoundingBox || coverage?.coverage?.nativeBoundingBox || {};
  const minx = firstFiniteNumber(bbox.minx, bbox.minX);
  const miny = firstFiniteNumber(bbox.miny, bbox.minY);
  const maxx = firstFiniteNumber(bbox.maxx, bbox.maxX);
  const maxy = firstFiniteNumber(bbox.maxy, bbox.maxY);
  if ([minx, miny, maxx, maxy].some((value) => value === null)) throw new Error(`GeoServer não retornou bbox para ${storeName}.`);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: `${GEOSERVER_WORKSPACE}:${storeName}`,
    styles: "",
    srs: "EPSG:4326",
    bbox: `${minx},${miny},${maxx},${maxy}`,
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
    throw new Error(`WMS GetMap Landsat não validou ${storeName}: ${response.status} ${contentType} ${bytes}`);
  }
}

function collectLandsatFiles(record: LandsatLocalRecord): LandsatWmsZipFile[] {
  const sourcePath = record.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const candidates = new Set([
    base,
    `${base}.aux.xml`,
    `${base}.ovr`,
    `${base}.xml`,
    `${base}.zip`,
    `${stem}.tfw`,
    `${stem}.tfwx`,
    `${stem}.TFwx`,
    `${stem}.tifw`,
    `${stem}.prj`,
    `${stem}.xml`,
  ]);
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => candidates.has(entry))
      .map((entry) => ({ absolutePath: path.join(dir, entry), name: entry }))
      .filter((entry) => fs.existsSync(entry.absolutePath) && fs.statSync(entry.absolutePath).isFile())
      .sort((a, b) => (a.name === base ? -1 : b.name === base ? 1 : a.name.localeCompare(b.name)));
  } catch {
    return [{ absolutePath: sourcePath, name: base }];
  }
}

function zipFilenameForRecord(record: LandsatLocalRecord): string {
  const stem = path.basename(record.sourcePath, path.extname(record.sourcePath));
  return `${safeName(stem, record.layerName)}.zip`;
}

function setZipHeaders(res: Response, filename: string, files: LandsatWmsZipFile[]): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Landsat-WMS-File-Count", String(files.length));
}

async function streamZip(res: Response, filename: string, files: LandsatWmsZipFile[]): Promise<void> {
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
    setZipHeaders(res, filename, files);
    archive.pipe(res);
    for (const file of files) archive.file(file.absolutePath, { name: file.name });
    void archive.finalize().then(() => done()).catch(done);
  });
}

function persistLandsatJob(uid: string, jobId: string, patch: LandsatProgressPatch & Record<string, unknown>): void {
  const now = new Date().toISOString();
  const current = readDocBySegments(["users", uid, "landsat_jobs", jobId]) || {};
  const next = stripUndefinedDeep({
    ...current,
    ...patch,
    jobId,
    updatedAt: now,
    updatedAtMs: Date.now(),
    timestamp: current.timestamp || current.createdAt || now,
  });
  writeDocBySegments(["users", uid, "landsat_jobs", jobId], next, { merge: true });
}

function writeSse(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(stripUndefinedDeep(payload))}\n\n`);
}

function emitJobEvent(jobId: string, payload: unknown): void {
  const set = eventSubscribers.get(jobId);
  if (!set) return;
  for (const res of set) writeSse(res, payload);
}

function closeJobSubscribers(jobId: string): void {
  const set = eventSubscribers.get(jobId);
  if (!set) return;
  for (const res of set) res.end();
  eventSubscribers.delete(jobId);
}

function progress(uid: string, jobId: string, patch: LandsatProgressPatch): void {
  const current = readDocBySegments(["users", uid, "landsat_jobs", jobId]) || {};
  const next = { ...current, ...patch };
  persistLandsatJob(uid, jobId, next);
  emitJobEvent(jobId, { type: "progress", jobId, ...next });
}

function buildReuseState(record: LandsatLocalRecord): LandsatJobState {
  const scene = localRecordToScene(record);
  return {
    sceneId: record.layerName,
    scene,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "Imagem Landsat já publicada no WMS; acervo reaproveitado para este usuário.",
    outputUrl: scene.wmsDownloadUrl,
    outputFilename: path.basename(record.sourcePath),
    outputBytes: record.bytes,
    wmsLayerName: scene.wmsLayerName,
    wmsStoreName: scene.wmsStoreName,
    wmsUrl: scene.wmsUrl,
    wmsDownloadUrl: scene.wmsDownloadUrl,
  };
}

async function processLandsatJob(input: {
  uid: string;
  jobId: string;
  sceneId: string;
  filename: string;
  composition: LandsatComposition;
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(LANDSAT_TMP_ROOT, jobId);
  ensureDir(tmpDir);
  try {
    const local = findLocalRecordByLayerName(input.sceneId);
    if (local) {
      const state = buildReuseState(local);
      progress(uid, jobId, {
        ...state,
        filename: input.filename,
        completedAt: new Date().toISOString(),
      });
      finishJob({ jobId, status: "completed" });
      emitJobEvent(jobId, { type: "completed", jobId });
      return;
    }

    const item = await getStacItem(input.sceneId);
    let scene = sceneFromStacFeature(item, input.composition);
    if (!scene) throw new Error(`Cena Landsat ${input.sceneId} sem assets suficientes para ${input.composition}.`);
    const already = findLocalRecordForExternal(scene);
    if (already) {
      const state = buildReuseState(already);
      progress(uid, jobId, {
        ...state,
        filename: input.filename,
        completedAt: new Date().toISOString(),
      });
      finishJob({ jobId, status: "completed" });
      emitJobEvent(jobId, { type: "completed", jobId });
      return;
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "download",
      percent: 8,
      message: "Cena Landsat não encontrada no WMS; preparando download das bandas.",
      scene,
    });
    const downloadableItem = await prepareDownloadableLandsatItem(item);
    const composite = await createLandsatComposite({
      item: downloadableItem,
      scene,
      tmpDir,
      onProgress: (patch) => progress(uid, jobId, { status: "processing", ...patch }),
    });
    const archivePath = landsatArchivePath(scene, composite.outputFilename);
    progress(uid, jobId, { stage: "archive", percent: 78, message: "Salvando GeoTIFF Landsat no acervo permanente." });
    const bytes = copyFileAtomic(composite.outputPath, archivePath);
    const overviewTmp = `${composite.outputPath}.ovr`;
    if (fs.existsSync(overviewTmp)) {
      copyFileAtomic(overviewTmp, `${archivePath}.ovr`);
    }
    const storeName = buildStoreName(scene, composite.outputFilename);
    progress(uid, jobId, { stage: "publish_wms", percent: 88, message: "Publicando Landsat no GeoServer/WMS." });
    await publishLandsatGeoTiff({
      storeName,
      title: path.basename(composite.outputFilename, path.extname(composite.outputFilename)),
      hdPath: archivePath,
      orbit: scene.orbit,
      year: scene.year,
    });
    const record = findLocalRecordByLayerName(storeName);
    if (record) scene = localRecordToScene(record);
    else {
      scene = {
        ...scene,
        source: "local_wms",
        wmsAvailable: true,
        wmsLayerName: `${GEOSERVER_WORKSPACE}:${storeName}`,
        wmsStoreName: storeName,
        wmsUrl: publicWmsCapabilitiesUrl(),
        wmsDownloadUrl: wmsDownloadPathForLayer(storeName),
        sourcePath: archivePath,
        outputFilename: path.basename(archivePath),
      };
    }
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Imagem Landsat criada e publicada no WMS.",
      filename: input.filename,
      sceneId: input.sceneId,
      scene,
      outputUrl: scene.wmsDownloadUrl,
      outputFilename: path.basename(archivePath),
      outputBytes: bytes,
      wmsLayerName: scene.wmsLayerName,
      wmsStoreName: scene.wmsStoreName,
      wmsUrl: scene.wmsUrl,
      wmsDownloadUrl: scene.wmsDownloadUrl,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
    emitJobEvent(jobId, { type: "completed", jobId });
  } catch (error: any) {
    const status: LandsatJobStatus = isCancelRequested(jobId) ? "cancelled" : "failed";
    const message = status === "cancelled"
      ? "Processamento Landsat cancelado."
      : String(error?.message || "Falha ao processar Landsat.");
    progress(uid, jobId, {
      status,
      stage: status,
      percent: status === "cancelled" ? 0 : 100,
      message,
      error: status === "failed" ? message : undefined,
    });
    finishJob({ jobId, status, error: status === "failed" ? message : "cancel_requested" });
    emitJobEvent(jobId, { type: status, jobId, message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    closeJobSubscribers(jobId);
  }
}

function parseComposition(raw: unknown): LandsatComposition | "any" {
  const value = String(raw || "").trim();
  if (value === "natural_color" || value === "natural") return "natural_color";
  if (value === "any") return "any";
  return "false_color";
}

export function registerLandsatRoutes(app: Express): void {
  app.post("/api/landsat/search", async (req: Request, res: Response) => {
    try {
      const area = await resolveAreaContextFromRequest(req.body);
      const bbox = area.geometry ? featureBbox({ type: "Feature", properties: {}, geometry: area.geometry }) : null;
      const orbit = normalizeOrbitPointParam((req.body as any)?.orbit, "Órbita");
      const row = normalizeOrbitPointParam((req.body as any)?.row ?? (req.body as any)?.point, "Ponto");
      const dateStart = normalizeDateParam((req.body as any)?.dateStart, false);
      const dateEnd = normalizeDateParam((req.body as any)?.dateEnd, true);
      const maxCloud = Number.isFinite(Number((req.body as any)?.maxCloudCover))
        ? Math.max(0, Math.min(100, Number((req.body as any).maxCloudCover)))
        : null;
      const composition = parseComposition((req.body as any)?.composition);
      if (!bbox && (!orbit || !row)) {
        res.status(400).json({ error: "Envie ZIP/SHP, Nº do CAR ou informe órbita e ponto." });
        return;
      }
      const localScenes = searchLocalLandsatScenes({
        propertyGeometry: area.geometry,
        dateStart,
        dateEnd,
        orbit,
        row,
        composition,
      });
      const externalComposition = composition === "any" ? "false_color" : composition;
      const externalScenes = await searchExternalLandsatScenes({
        bbox,
        propertyGeometry: area.geometry,
        dateStart,
        dateEnd,
        orbit,
        row,
        maxCloud,
        composition: externalComposition,
      }).catch((error) => {
        console.warn("[LANDSAT] busca STAC externa falhou:", error);
        return [] as LandsatScene[];
      });
      const byId = new Map<string, LandsatScene>();
      for (const scene of [...localScenes, ...externalScenes]) {
        if (maxCloud !== null && scene.cloudCover !== null && scene.cloudCover > maxCloud) continue;
        byId.set(scene.id, scene);
      }
      const scenes = [...byId.values()].sort((a, b) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
      res.json({
        ok: true,
        areaHa: area.areaHa,
        bbox,
        propertyGeometry: area.geometry,
        orbit,
        row,
        dateStart,
        dateEnd,
        composition,
        localCount: localScenes.length,
        externalCount: externalScenes.length,
        scenes,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao buscar Landsat." });
    }
  });

  app.post("/api/landsat/estimate", async (req: Request, res: Response) => {
    try {
      const sceneId = String((req.body as any)?.sceneId || "").trim();
      if (!sceneId) {
        res.status(400).json({ error: "sceneId é obrigatório." });
        return;
      }
      const composition = parseComposition((req.body as any)?.composition);
      if (composition === "any") throw new Error("Escolha composição falsa-cor ou natural para estimar.");
      const local = findLocalRecordByLayerName(sceneId);
      const scene = local
        ? localRecordToScene(local)
        : sceneFromStacFeature(await getStacItem(sceneId), composition);
      if (!scene) throw new Error("Cena Landsat não encontrada.");
      res.json({ ok: true, scene: await estimateScene(scene) });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao estimar Landsat." });
    }
  });

  app.head("/api/landsat/wms-download", async (req: Request, res: Response) => {
    try {
      const record = findLocalRecordByLayerName(String(req.query.layerName || req.query.sceneId || ""));
      if (!record) {
        res.status(404).end();
        return;
      }
      const files = collectLandsatFiles(record);
      if (!files.length) {
        res.status(404).end();
        return;
      }
      setZipHeaders(res, zipFilenameForRecord(record), files);
      res.status(200).end();
    } catch {
      res.status(500).end();
    }
  });

  app.get("/api/landsat/wms-download", async (req: Request, res: Response) => {
    try {
      const record = findLocalRecordByLayerName(String(req.query.layerName || req.query.sceneId || ""));
      if (!record) {
        res.status(404).json({ error: "Imagem Landsat não encontrada no WMS." });
        return;
      }
      const files = collectLandsatFiles(record);
      if (!files.length) {
        res.status(404).json({ error: "Arquivos Landsat não encontrados no HD." });
        return;
      }
      await streamZip(res, zipFilenameForRecord(record), files);
    } catch (error: any) {
      if (!res.headersSent) res.status(500).json({ error: error?.message || "Falha ao baixar ZIP Landsat." });
      else res.destroy(error);
    }
  });

  app.post("/api/landsat/jobs", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const sceneId = String((req.body as any)?.sceneId || (req.body as any)?.itemId || "").trim();
      if (!sceneId) {
        res.status(400).json({ error: "sceneId é obrigatório." });
        return;
      }
      const composition = parseComposition((req.body as any)?.composition);
      if (composition === "any") throw new Error("Escolha composição falsa-cor ou natural para gerar.");
      const filename = String((req.body as any)?.filename || "LANDSAT").trim();
      const processingJob = startJob({
        uid,
        endpoint: "/api/landsat/jobs",
        metadata: { sceneId, filename, composition },
      });
      const jobId = processingJob.jobId;
      const local = findLocalRecordByLayerName(sceneId);
      if (local) {
        const state = buildReuseState(local);
        persistLandsatJob(uid, jobId, {
          ...state,
          filename,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        finishJob({ jobId, status: "completed" });
        res.status(200).json({ ok: true, jobId, reused: true });
        return;
      }
      persistLandsatJob(uid, jobId, {
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento Landsat enviado para o servidor.",
        filename,
        sceneId,
        composition,
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId, reused: false });
      void processLandsatJob({ uid, jobId, sceneId, filename, composition });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar job Landsat." });
    }
  });

  app.get("/api/landsat/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job Landsat não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/landsat/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job Landsat não encontrado." });
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

  app.delete("/api/landsat/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    requestCancel(jobId, uid);
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    removeStoragePath(String(data?.outputRelativePath || data?.outputUrl || ""));
    deleteDocBySegments(["users", uid, "landsat_jobs", jobId]);
    res.json({ ok: true });
  });
}
