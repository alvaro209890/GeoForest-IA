/**
 * Helpers do pipeline CBERS: ambiente GDAL, arquivos, bbox/cobertura, fetch JSON e projeções.
 */
import "../proj-defs";
import crypto from "node:crypto";
import fs from "node:fs";
import proj4 from "proj4";
import { area as turfArea, bboxPolygon, featureCollection, intersect as turfIntersect } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { fetchCarBoundaryByNumber, parseUserShapefile } from "../simcar";
import { FETCH_TIMEOUT_MS } from "./constants";
import { CbersAreaContext, CbersScene } from "./types";

export function gdalCommandEnv(): NodeJS.ProcessEnv {
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

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fileSizeSafe(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

export function bytesToMb(bytes: number): string {
  return (Math.max(0, bytes) / 1024 / 1024).toFixed(1);
}


export function safeName(value: unknown, fallback = "cbers_4a_wpm.tif"): string {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
  return clean || fallback;
}


export function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  if (!payload) throw new Error("ZIP da área é obrigatório.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP da área é inválido ou muito pequeno.");
  return buffer;
}

export function parseOptionalAreaContext(raw: unknown): CbersAreaContext {
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

export async function resolveAreaContextFromRequest(body: any): Promise<CbersAreaContext> {
  const propertyZip = body?.propertyZip;
  const carNumber = String(body?.carNumber || "").trim();
  if (propertyZip && carNumber) {
    throw new Error("Informe ZIP/SHP ou Nº do CAR estadual, não os dois ao mesmo tempo.");
  }
  if (carNumber) {
    const feature = await fetchCarBoundaryByNumber(carNumber);
    const geometry = feature.geometry;
    return {
      geometry,
      geometryHash: hashPropertyGeometry(geometry),
      areaHa: turfArea(feature) / 10000,
    };
  }
  return parseOptionalAreaContext(propertyZip);
}

export function featureBbox(feature: Feature<Polygon | MultiPolygon>): [number, number, number, number] {
  const coords =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates.flat(2);
  const xs = coords.map((coord) => coord[0]).filter(Number.isFinite);
  const ys = coords.map((coord) => coord[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) throw new Error("Não foi possível calcular a bbox da área.");
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function normalizeStacGeometry(geometry: unknown, bbox: [number, number, number, number] | null): Polygon | MultiPolygon | undefined {
  if (geometry && typeof geometry === "object") {
    const candidate = geometry as Geometry;
    if (candidate.type === "Polygon" || candidate.type === "MultiPolygon") {
      return candidate as Polygon | MultiPolygon;
    }
  }
  if (!bbox) return undefined;
  return bboxPolygon(bbox).geometry as Polygon;
}

export function computeSceneCoverage(
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

export function normalizeGeometryValueForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeGeometryValueForHash(item));
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(7));
  return value;
}

export function hashPropertyGeometry(geometry?: Polygon | MultiPolygon | null): string | null {
  if (!geometry) return null;
  const normalized = {
    type: geometry.type,
    coordinates: normalizeGeometryValueForHash(geometry.coordinates),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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


export function outerRingCoordinates(geometry?: Polygon | MultiPolygon | null): number[][] {
  const ring = geometry?.type === "Polygon"
    ? geometry.coordinates[0]
    : geometry?.type === "MultiPolygon"
      ? geometry.coordinates[0]?.[0]
      : null;
  if (!Array.isArray(ring)) return [];
  const cleaned = ring
    .map((coord) => [Number(coord[0]), Number(coord[1])])
    .filter((coord) => coord.every(Number.isFinite));
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-10 && Math.abs(first[1] - last[1]) < 1e-10) cleaned.pop();
  }
  return cleaned;
}

export function utmProjForEpsg(epsg?: number | null): string | null {
  if (!epsg || !Number.isFinite(epsg)) return null;
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  return null;
}

export function utmProjForLonLat(lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}

// Projects the scene's STAC footprint (lon/lat) into the GeoTIFF's native UTM CRS and
// returns its axis-aligned bounds, so we can verify the processed raster sits where the
// INPE metadata says it should. This is a self-consistency check against a genuinely
// co-spatial reference (the scene's own footprint), not a comparison against a different
// acquisition.
export function projectFootprintBounds(
  scene: CbersScene,
  proj: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let coords = outerRingCoordinates(scene.geometry);
  if (coords.length < 3 && scene.bbox) {
    const [minLon, minLat, maxLon, maxLat] = scene.bbox;
    coords = [
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
    ];
  }
  if (coords.length < 3) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const coord of coords) {
    try {
      const [x, y] = proj4("EPSG:4326", proj, [coord[0], coord[1]]) as [number, number];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    } catch {
      // Skip vertices that fail to project.
    }
  }
  if (xs.length < 3) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// CBERS-4A/WPM L4 scenes arrive from INPE already orthorectified and projected to UTM.
// We publish the native georeferencing and only refuse a scene whose georeferencing is
// grossly broken relative to its OWN STAC footprint.
