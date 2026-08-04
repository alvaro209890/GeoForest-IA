/**
 * Helpers do pipeline Landsat: normalização de parâmetros, bbox/cobertura, XML e arquivos.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { area as turfArea, bboxPolygon, featureCollection, intersect as turfIntersect } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { fetchCarBoundaryByNumber, parseUserShapefile } from "../simcar";
import { LandsatAreaContext } from "./types";

export function safeName(value: unknown, fallback = "landsat"): string {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeOrbitPointParam(raw: unknown, label: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) throw new Error(`${label} deve conter até 3 dígitos.`);
  return value.padStart(3, "0");
}

export function normalizeDateParam(raw: unknown, endOfDay = false): string | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = `${value}${endOfDay ? "T23:59:59Z" : "T00:00:00Z"}`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
}

export function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  if (!payload) throw new Error("ZIP da área é obrigatório.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP da área é inválido ou muito pequeno.");
  return buffer;
}

export function parseOptionalAreaContext(raw: unknown): LandsatAreaContext {
  const value = String(raw || "").trim();
  if (!value) return { areaHa: 0 };
  const parsed = parseUserShapefile(parseBase64Zip(value));
  return {
    geometry: parsed.geometry,
    geometryHash: hashPropertyGeometry(parsed.geometry),
    areaHa: parsed.areaHa,
  };
}

export async function resolveAreaContextFromRequest(body: any): Promise<LandsatAreaContext> {
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

export function computeSceneCoverage(
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

export function normalizeGeometryValueForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeGeometryValueForHash(item));
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(7));
  return value;
}

export function hashPropertyGeometry(geometry?: Polygon | MultiPolygon | null): string | null {
  if (!geometry) return null;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ type: geometry.type, coordinates: normalizeGeometryValueForHash(geometry.coordinates) }))
    .digest("hex");
}

export function bboxGeometry(bbox: [number, number, number, number] | null): Polygon | undefined {
  return bbox ? bboxPolygon(bbox).geometry as Polygon : undefined;
}


export function xmlValue(xml: string, tag: string): string {
  return String(xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .trim();
}

export function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}


export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function copyFileAtomic(sourcePath: string, destPath: string): number {
  ensureDir(path.dirname(destPath));
  const tmp = path.join(path.dirname(destPath), `.${path.basename(destPath)}.${crypto.randomUUID()}.tmp`);
  fs.copyFileSync(sourcePath, tmp);
  const bytes = fs.statSync(tmp).size;
  fs.renameSync(tmp, destPath);
  return bytes;
}
