import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import proj4 from "proj4";
import { extractZipEntries, detectUtmProj } from "./geo-utils";
import {
  buildDbfBuffer,
  buildPointShpAndShx,
  type DbfFieldDef,
  type PointShpRecord,
} from "./shapefile-writer";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";

proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SIRGAS_2000_PRJ =
  'GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
const WGS84_PRJ =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';

type ZipEntry = { name: string; data: Buffer };

export type VerticesLayerInfo = {
  id: string;
  name: string;
  path: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  missingCrs: boolean;
  ignoredReason?: string;
};

type VertexPoint = {
  original: [number, number];
  metric: [number, number];
  vertexIndex: number;
};

type VertexPair = {
  layerId: string;
  layerName: string;
  ranking: number;
  feature: number;
  part: number;
  ring: number;
  vertexA: number;
  vertexB: number;
  distM: number;
  aOriginal: [number, number];
  bOriginal: [number, number];
  midOriginal: [number, number];
};

type ParsedPolygonRecord = {
  feature: number;
  rings: number[][][];
};

type CodedCrs = {
  label: string;
  kind: "geographic" | "projected" | "unknown";
  projDef?: string;
  prjText?: string;
  missing: boolean;
};

type LayerSelection = {
  id: string;
  analyze?: boolean;
  pointCount?: number;
  toleranceMm?: number | null;
  crsOverride?: string;
};

type ProcessSettings = {
  defaultToleranceMm?: number;
  includeOriginalVertices?: boolean;
  includeTxtReport?: boolean;
  includeCsvSummary?: boolean;
  preserveOriginalCrs?: boolean;
  useMetricTemporaryCrs?: boolean;
};

const subscribers = new Map<string, Set<Response>>();

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function layerIdForPath(entryName: string): string {
  const digest = crypto.createHash("sha1").update(entryName).digest("hex").slice(0, 10);
  const base = safeSegment(path.basename(entryName, path.extname(entryName)).toUpperCase()) || "CAMADA";
  return `${base}_${digest}`;
}

function basenameKey(entryName: string): string {
  const dir = path.dirname(entryName).replace(/\\/g, "/");
  const base = path.basename(entryName, path.extname(entryName)).toLowerCase();
  return `${dir === "." ? "" : `${dir}/`}${base}`;
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function shapeTypeName(shapeType: number): string {
  if (shapeType === 0) return "Vazio";
  if ([1, 11, 21].includes(shapeType)) return "Point";
  if ([3, 13, 23].includes(shapeType)) return "Polyline";
  if ([5, 15, 25].includes(shapeType)) return "Polygon";
  if ([8, 18, 28].includes(shapeType)) return "MultiPoint";
  return `Tipo ${shapeType}`;
}

function readMainShapeType(shp: Buffer): number {
  if (shp.length < 36) return 0;
  return shp.readInt32LE(32);
}

function parsePolygonRecords(shpBuffer: Buffer): ParsedPolygonRecord[] {
  const records: ParsedPolygonRecord[] = [];
  if (shpBuffer.length < 100) return records;

  let offset = 100;
  let recordNumber = 0;
  while (offset + 12 <= shpBuffer.length) {
    recordNumber += 1;
    const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
    const contentLengthBytes = contentLengthWords * 2;
    const recStart = offset + 8;
    const recEnd = recStart + contentLengthBytes;
    if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

    const shapeType = shpBuffer.readInt32LE(recStart);
    if ([5, 15, 25].includes(shapeType) && contentLengthBytes >= 44) {
      const numParts = shpBuffer.readInt32LE(recStart + 36);
      const numPoints = shpBuffer.readInt32LE(recStart + 40);
      const partsOffset = recStart + 44;
      const pointsOffset = partsOffset + numParts * 4;
      if (numParts > 0 && numPoints > 2 && pointsOffset + numPoints * 16 <= recEnd) {
        const partStarts: number[] = [];
        for (let p = 0; p < numParts; p += 1) {
          const start = shpBuffer.readInt32LE(partsOffset + p * 4);
          if (start >= 0 && start < numPoints) partStarts.push(start);
        }
        partStarts.push(numPoints);
        const rings: number[][][] = [];
        for (let p = 0; p < partStarts.length - 1; p += 1) {
          const ring: number[][] = [];
          for (let i = partStarts[p]; i < partStarts[p + 1]; i += 1) {
            const pOff = pointsOffset + i * 16;
            const x = shpBuffer.readDoubleLE(pOff);
            const y = shpBuffer.readDoubleLE(pOff + 8);
            if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
          }
          if (ring.length >= 3) rings.push(ring);
        }
        if (rings.length > 0) records.push({ feature: recordNumber, rings });
      }
    }

    offset = recEnd;
  }
  return records;
}

function getZipLayerGroups(zipBuffer: Buffer): Array<{
  id: string;
  name: string;
  key: string;
  shp?: ZipEntry;
  prj?: ZipEntry;
}> {
  const entries = extractZipEntries(zipBuffer).filter((entry) => !entry.name.endsWith("/"));
  const groups = new Map<string, { id: string; name: string; key: string; shp?: ZipEntry; prj?: ZipEntry }>();
  for (const entry of entries) {
    const ext = path.extname(entry.name).toLowerCase();
    if (![".shp", ".prj"].includes(ext)) continue;
    const key = basenameKey(entry.name);
    const current = groups.get(key) || {
      id: layerIdForPath(entry.name),
      name: path.basename(entry.name, path.extname(entry.name)).toUpperCase(),
      key,
    };
    if (ext === ".shp") current.shp = entry;
    if (ext === ".prj") current.prj = entry;
    groups.set(key, current);
  }
  return [...groups.values()];
}

function parseEpsgOverride(raw: string): CodedCrs | null {
  const value = String(raw || "").trim().toUpperCase();
  const match = value.match(/^EPSG:(\d{4,5})$/);
  if (!match) return null;
  const epsg = Number(match[1]);
  if (epsg === 4674) {
    return { label: "EPSG:4674", kind: "geographic", projDef: "EPSG:4674", prjText: SIRGAS_2000_PRJ, missing: false };
  }
  if (epsg === 4326) {
    return { label: "EPSG:4326", kind: "geographic", projDef: "EPSG:4326", prjText: WGS84_PRJ, missing: false };
  }
  if (epsg >= 32601 && epsg <= 32660) {
    const zone = epsg - 32600;
    const projDef = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
    return { label: `EPSG:${epsg}`, kind: "projected", projDef, missing: false };
  }
  if (epsg >= 32701 && epsg <= 32760) {
    const zone = epsg - 32700;
    const projDef = `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`;
    return { label: `EPSG:${epsg}`, kind: "projected", projDef, missing: false };
  }
  if (epsg >= 31961 && epsg <= 31985) {
    const zone = epsg - 31960;
    const projDef = `+proj=utm +zone=${zone} +south +ellps=GRS80 +units=m +no_defs`;
    return { label: `EPSG:${epsg}`, kind: "projected", projDef, missing: false };
  }
  return { label: `EPSG:${epsg}`, kind: "unknown", missing: false };
}

function detectCrs(prjTextRaw?: string, override?: string): CodedCrs {
  const overridden = parseEpsgOverride(String(override || ""));
  if (overridden) return overridden;

  const prjText = String(prjTextRaw || "").trim();
  if (!prjText) return { label: "CRS ausente", kind: "unknown", missing: true };

  const utm = detectUtmProj(prjText);
  if (utm) return { label: "UTM detectado no .prj", kind: "projected", projDef: utm, prjText, missing: false };

  const upper = prjText.toUpperCase();
  if (upper.includes("SIRGAS") || upper.includes("4674")) {
    return { label: "EPSG:4674", kind: "geographic", projDef: "EPSG:4674", prjText, missing: false };
  }
  if ((upper.includes("WGS") && upper.includes("84")) || upper.includes("4326")) {
    return { label: "EPSG:4326", kind: "geographic", projDef: "EPSG:4326", prjText, missing: false };
  }
  if (upper.includes("GEOGCS") || upper.includes("GEODCRS")) {
    return { label: "Geográfico detectado", kind: "geographic", projDef: "EPSG:4326", prjText, missing: false };
  }
  if (upper.includes("PROJCS") || upper.includes("PROJCRS")) {
    return { label: "Projetado detectado", kind: "projected", prjText, missing: false };
  }
  return { label: "CRS desconhecido", kind: "unknown", prjText, missing: false };
}

export function listPolygonLayersFromZip(zipBuffer: Buffer): VerticesLayerInfo[] {
  const groups = getZipLayerGroups(zipBuffer);
  return groups.map((group) => {
    if (!group.shp) {
      return {
        id: group.id,
        name: group.name,
        path: group.key,
        geometryType: "Ausente",
        featureCount: 0,
        crsLabel: "CRS ausente",
        missingCrs: true,
        ignoredReason: "Camada sem .shp.",
      };
    }
    const shapeType = readMainShapeType(group.shp.data);
    const geometryType = shapeTypeName(shapeType);
    const crs = detectCrs(group.prj?.data.toString("utf8"));
    if (!["Polygon"].includes(geometryType)) {
      return {
        id: group.id,
        name: group.name,
        path: group.key,
        geometryType,
        featureCount: 0,
        crsLabel: crs.label,
        missingCrs: crs.missing,
        ignoredReason: "Camada não poligonal ignorada.",
      };
    }
    const featureCount = parsePolygonRecords(group.shp.data).length;
    return {
      id: group.id,
      name: group.name,
      path: group.key,
      geometryType,
      featureCount,
      crsLabel: crs.label,
      missingCrs: crs.missing,
      ignoredReason: featureCount <= 0 ? "Camada vazia ignorada." : undefined,
    };
  });
}

export function visibleVerticesLayers(layers: VerticesLayerInfo[]): VerticesLayerInfo[] {
  return layers.filter((layer) => layer.geometryType === "Polygon" && layer.featureCount > 0 && !layer.ignoredReason);
}

function sameCoordinate(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
}

function removeNaturalClosure(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return sameCoordinate(first, last) ? ring.slice(0, -1) : ring;
}

function ringAreaAbs(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function pointInRing(point: number[], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y);
    if (intersects) {
      const atX = xi + ((y - yi) * (xj - xi)) / (yj - yi);
      if (x < atX) inside = !inside;
    }
  }
  return inside;
}

function representativePoint(ring: number[][]): number[] | null {
  return ring.find((point) => point.every(Number.isFinite)) || null;
}

function ringDepth(ring: number[][], index: number, rings: number[][][]): number {
  const rep = representativePoint(ring);
  if (!rep) return 0;
  const area = ringAreaAbs(ring);
  let depth = 0;
  for (let i = 0; i < rings.length; i += 1) {
    if (i === index) continue;
    if (ringAreaAbs(rings[i]) <= area + 1e-18) continue;
    if (pointInRing(rep, rings[i])) depth += 1;
  }
  return depth;
}

function ringGroupsForRecord(record: ParsedPolygonRecord): Array<{ part: number; ring: number; coords: number[][] }> {
  const rings = record.rings.map(removeNaturalClosure).filter((ring) => ring.length >= 2);
  if (!rings.length) return [];

  const depths = rings.map((ring, index) => ringDepth(ring, index, rings));
  const shellIndexes = depths
    .map((depth, index) => ({ depth, index }))
    .filter((item) => item.depth % 2 === 0)
    .map((item) => item.index);
  if (!shellIndexes.length) {
    return rings.map((coords, index) => ({ part: index + 1, ring: 1, coords }));
  }

  const partByShell = new Map<number, number>();
  shellIndexes.forEach((ringIndex, order) => partByShell.set(ringIndex, order + 1));
  const groups: Array<{ part: number; ring: number; coords: number[][] }> = [];
  const nextRingByPart = new Map<number, number>();

  for (let index = 0; index < rings.length; index += 1) {
    let part = partByShell.get(index);
    if (!part) {
      const rep = representativePoint(rings[index]);
      let bestShell = shellIndexes[0];
      let bestArea = Infinity;
      if (rep) {
        for (const shellIndex of shellIndexes) {
          const area = ringAreaAbs(rings[shellIndex]);
          if (area < bestArea && area > ringAreaAbs(rings[index]) && pointInRing(rep, rings[shellIndex])) {
            bestShell = shellIndex;
            bestArea = area;
          }
        }
      }
      part = partByShell.get(bestShell) || 1;
    }
    const nextRing = nextRingByPart.get(part) || 1;
    groups.push({ part, ring: nextRing, coords: rings[index] });
    nextRingByPart.set(part, nextRing + 1);
  }
  return groups;
}

function layerBbox(records: ParsedPolygonRecord[]): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const record of records) {
    for (const ring of record.rings) {
      for (const [x, y] of ring) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
    }
  }
  if (!xs.length || !ys.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function estimateUtmProjFromLonLat(lon: number, lat: number): { label: string; projDef: string } {
  const zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
  const south = lat < 0;
  return {
    label: `UTM ${zone}${south ? "S" : "N"} temporário`,
    projDef: `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`.trim(),
  };
}

function toMetricPoint(point: [number, number], crs: CodedCrs, metricProjDef: string): [number, number] {
  if (crs.kind === "geographic") {
    const source = crs.projDef || "EPSG:4326";
    const out = proj4(source, metricProjDef, point) as [number, number];
    return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : point;
  }
  return point;
}

function squaredDistance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function findClosestPairsWithinTolerance(points: VertexPoint[], maxCount: number, toleranceM?: number | null): Array<{
  a: VertexPoint;
  b: VertexPoint;
  distM: number;
}> {
  if (points.length < 2 || maxCount <= 0) return [];
  const hasToleranceLimit = toleranceM !== null && toleranceM !== undefined && Number.isFinite(Number(toleranceM)) && Number(toleranceM) >= 0;
  if (!hasToleranceLimit) {
    const candidates: Array<{ a: VertexPoint; b: VertexPoint; distM: number }> = [];
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        candidates.push({ a: points[i], b: points[j], distM: Math.sqrt(squaredDistance(points[i].metric, points[j].metric)) });
      }
    }
    candidates.sort((a, b) => a.distM - b.distM || a.a.vertexIndex - b.a.vertexIndex || a.b.vertexIndex - b.b.vertexIndex);
    return candidates.slice(0, maxCount);
  }
  const boundedToleranceM = Number(toleranceM);
  const cellSize = Math.max(boundedToleranceM, 1e-9);
  const toleranceSq = boundedToleranceM * boundedToleranceM;
  const cells = new Map<string, number[]>();
  const candidates: Array<{ a: VertexPoint; b: VertexPoint; distM: number }> = [];

  const keyFor = (point: [number, number]) => {
    const cx = Math.floor(point[0] / cellSize);
    const cy = Math.floor(point[1] / cellSize);
    return { cx, cy, key: `${cx}:${cy}` };
  };

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const { cx, cy, key } = keyFor(point.metric);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = cells.get(`${cx + dx}:${cy + dy}`) || [];
        for (const otherIndex of bucket) {
          const other = points[otherIndex];
          const distSq = squaredDistance(point.metric, other.metric);
          if (distSq <= toleranceSq + 1e-12) {
            candidates.push({ a: other, b: point, distM: Math.sqrt(distSq) });
          }
        }
      }
    }
    const bucket = cells.get(key) || [];
    bucket.push(i);
    cells.set(key, bucket);
  }

  candidates.sort((a, b) => a.distM - b.distM || a.a.vertexIndex - b.a.vertexIndex || a.b.vertexIndex - b.b.vertexIndex);
  return candidates.slice(0, maxCount);
}

export function analyzeLayer(args: {
  layerId: string;
  layerName: string;
  shpBuffer: Buffer;
  prjText?: string;
  selection: LayerSelection;
  settings: ProcessSettings;
}): { pairs: VertexPair[]; warnings: string[]; crs: CodedCrs; metricCrsLabel: string } {
  const warnings: string[] = [];
  const records = parsePolygonRecords(args.shpBuffer);
  const crs = detectCrs(args.prjText, args.selection.crsOverride);
  if (crs.missing) throw new Error(`Camada ${args.layerName} sem CRS. Informe EPSG manualmente.`);
  if (!records.length) {
    warnings.push(`${args.layerName}: camada vazia ignorada.`);
    return { pairs: [], warnings, crs, metricCrsLabel: "n/d" };
  }

  const bbox = layerBbox(records);
  const center: [number, number] = bbox
    ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    : [0, 0];
  const metricCrs = crs.kind === "geographic"
    ? estimateUtmProjFromLonLat(center[0], center[1])
    : { label: crs.label, projDef: crs.projDef || "" };
  const explicitToleranceMm = Number(args.selection.toleranceMm);
  const defaultToleranceMm = Number(args.settings.defaultToleranceMm);
  const toleranceMm = Number.isFinite(explicitToleranceMm)
    ? Math.max(0, explicitToleranceMm)
    : Number.isFinite(defaultToleranceMm)
      ? Math.max(0, defaultToleranceMm)
      : null;
  const toleranceM = toleranceMm === null ? null : toleranceMm / 1000;
  const requested = Math.max(0, Math.floor(Number(args.selection.pointCount || 0)));
  const layerCandidates: VertexPair[] = [];

  for (const record of records) {
    const groups = ringGroupsForRecord(record);
    for (const group of groups) {
      const points: VertexPoint[] = group.coords.map((coord, index) => {
        const original: [number, number] = [Number(coord[0]), Number(coord[1])];
        return {
          original,
          metric: toMetricPoint(original, crs, metricCrs.projDef),
          vertexIndex: index + 1,
        };
      });
      const pairs = findClosestPairsWithinTolerance(points, requested, toleranceM);
      for (const pair of pairs) {
        layerCandidates.push({
          layerId: args.layerId,
          layerName: args.layerName,
          ranking: 0,
          feature: record.feature,
          part: group.part,
          ring: group.ring,
          vertexA: pair.a.vertexIndex,
          vertexB: pair.b.vertexIndex,
          distM: pair.distM,
          aOriginal: pair.a.original,
          bOriginal: pair.b.original,
          midOriginal: [
            (pair.a.original[0] + pair.b.original[0]) / 2,
            (pair.a.original[1] + pair.b.original[1]) / 2,
          ],
        });
      }
    }
  }

  layerCandidates.sort((a, b) => a.distM - b.distM || a.feature - b.feature || a.part - b.part || a.ring - b.ring);
  const selected = layerCandidates.slice(0, requested).map((pair, index) => ({ ...pair, ranking: index + 1 }));
  if (requested > selected.length) {
    warnings.push(`${args.layerName}: solicitados ${requested} ponto(s), encontrados ${selected.length} par(es) dentro da tolerância.`);
  }
  return { pairs: selected, warnings, crs, metricCrsLabel: metricCrs.label };
}

const midpointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "ranking", type: "N", length: 8, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "vertice_a", type: "N", length: 10, decimals: 0 },
  { name: "vertice_b", type: "N", length: 10, decimals: 0 },
  { name: "dist_m", type: "F", length: 16, decimals: 6 },
  { name: "dist_cm", type: "F", length: 16, decimals: 3 },
  { name: "dist_mm", type: "F", length: 16, decimals: 3 },
  { name: "x_a", type: "F", length: 18, decimals: 8 },
  { name: "y_a", type: "F", length: 18, decimals: 8 },
  { name: "x_b", type: "F", length: 18, decimals: 8 },
  { name: "y_b", type: "F", length: 18, decimals: 8 },
  { name: "x_medio", type: "F", length: 18, decimals: 8 },
  { name: "y_medio", type: "F", length: 18, decimals: 8 },
];

const vertexFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "ranking", type: "N", length: 8, decimals: 0 },
  { name: "ponto_tipo", type: "C", length: 1, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "vertice", type: "N", length: 10, decimals: 0 },
  { name: "dist_m", type: "F", length: 16, decimals: 6 },
  { name: "dist_mm", type: "F", length: 16, decimals: 3 },
];

function pairToMidpointRecord(pair: VertexPair): PointShpRecord {
  return {
    coordinates: pair.midOriginal,
    attributes: {
      camada: pair.layerName,
      ranking: pair.ranking,
      feicao: pair.feature,
      parte: pair.part,
      anel: pair.ring,
      vertice_a: pair.vertexA,
      vertice_b: pair.vertexB,
      dist_m: pair.distM,
      dist_cm: pair.distM * 100,
      dist_mm: pair.distM * 1000,
      x_a: pair.aOriginal[0],
      y_a: pair.aOriginal[1],
      x_b: pair.bOriginal[0],
      y_b: pair.bOriginal[1],
      x_medio: pair.midOriginal[0],
      y_medio: pair.midOriginal[1],
    },
  };
}

function pairToVertexRecords(pair: VertexPair): PointShpRecord[] {
  return [
    {
      coordinates: pair.aOriginal,
      attributes: {
        camada: pair.layerName,
        ranking: pair.ranking,
        ponto_tipo: "A",
        feicao: pair.feature,
        parte: pair.part,
        anel: pair.ring,
        vertice: pair.vertexA,
        dist_m: pair.distM,
        dist_mm: pair.distM * 1000,
      },
    },
    {
      coordinates: pair.bOriginal,
      attributes: {
        camada: pair.layerName,
        ranking: pair.ranking,
        ponto_tipo: "B",
        feicao: pair.feature,
        parte: pair.part,
        anel: pair.ring,
        vertice: pair.vertexB,
        dist_m: pair.distM,
        dist_mm: pair.distM * 1000,
      },
    },
  ];
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(pairs: VertexPair[]): Buffer {
  const headers = midpointFields.map((field) => field.name);
  const rows = pairs.map((pair) => {
    const attrs = pairToMidpointRecord(pair).attributes;
    return headers.map((header) => csvEscape(attrs[header])).join(";");
  });
  return Buffer.from([headers.join(";"), ...rows].join("\n"), "utf8");
}

function buildReport(args: {
  filename: string;
  pairs: VertexPair[];
  analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }>;
  warnings: string[];
}): Buffer {
  const lines: string[] = [];
  lines.push("Relatorio de vertices proximas");
  lines.push(`Arquivo analisado: ${args.filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas analisadas:");
  for (const layer of args.analyzedLayers) {
    lines.push(`- ${layer.name}: solicitados=${layer.requested}; encontrados=${layer.found}; CRS original=${layer.crsLabel}; CRS metrico=${layer.metricCrsLabel}`);
  }
  lines.push("");
  lines.push("Pontos encontrados:");
  for (const pair of args.pairs) {
    lines.push(
      `${pair.layerName}; ranking=${pair.ranking}; feicao=${pair.feature}; parte=${pair.part}; anel=${pair.ring}; ` +
      `A=${pair.vertexA} (${pair.aOriginal[0]}, ${pair.aOriginal[1]}); ` +
      `B=${pair.vertexB} (${pair.bOriginal[0]}, ${pair.bOriginal[1]}); ` +
      `dist_m=${pair.distM.toFixed(6)}; medio=(${pair.midOriginal[0]}, ${pair.midOriginal[1]})`,
    );
  }
  if (args.warnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const warning of args.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return Buffer.from(lines.join("\n"), "utf8");
}

function buildResultZip(args: {
  pairs: VertexPair[];
  includeOriginalVertices: boolean;
  includeCsvSummary: boolean;
  includeTxtReport: boolean;
  prjText?: string;
  filename: string;
  analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }>;
  warnings: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const prjText = args.prjText || SIRGAS_2000_PRJ;

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const midpointRecords = args.pairs.map(pairToMidpointRecord);
    const mid = buildPointShpAndShx(midpointRecords, 1);
    archive.append(mid.shp, { name: "pontos_vertices_proximas.shp" });
    archive.append(mid.shx, { name: "pontos_vertices_proximas.shx" });
    archive.append(buildDbfBuffer(midpointRecords.map((item) => item.attributes), midpointFields), { name: "pontos_vertices_proximas.dbf" });
    archive.append(Buffer.from(prjText, "utf8"), { name: "pontos_vertices_proximas.prj" });

    if (args.includeOriginalVertices) {
      const vertexRecords = args.pairs.flatMap(pairToVertexRecords);
      const vertices = buildPointShpAndShx(vertexRecords, 1);
      archive.append(vertices.shp, { name: "vertices_pares.shp" });
      archive.append(vertices.shx, { name: "vertices_pares.shx" });
      archive.append(buildDbfBuffer(vertexRecords.map((item) => item.attributes), vertexFields), { name: "vertices_pares.dbf" });
      archive.append(Buffer.from(prjText, "utf8"), { name: "vertices_pares.prj" });
    }

    if (args.includeCsvSummary) archive.append(buildCsv(args.pairs), { name: "resumo_vertices.csv" });
    if (args.includeTxtReport) archive.append(buildReport(args), { name: "relatorio_vertices.txt" });
    archive.finalize().catch(reject);
  });
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
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) writeSse(res, data);
}

function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) {
    if (!res.writableEnded) res.end();
  }
  subscribers.delete(jobId);
}

function persistVerticesJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "vertices_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistVerticesJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function runVerticesJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  selections: LayerSelection[];
  settings: ProcessSettings;
}): Promise<void> {
  const { uid, jobId, upload, selections, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const groups = getZipLayerGroups(zipBuffer);
    const selectionById = new Map(selections.map((item) => [String(item.id), item]));
    const selectedGroups = groups.filter((group) => selectionById.get(group.id)?.analyze !== false && selectionById.has(group.id));
    if (!selectedGroups.length) throw new Error("Selecione ao menos uma camada poligonal para analisar.");

    const allPairs: VertexPair[] = [];
    const allWarnings: string[] = [];
    const analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }> = [];
    let outputPrjText = SIRGAS_2000_PRJ;
    let outputCrsLabel = "";

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 5,
      message: "Iniciando análise de vértices.",
    });

    for (let index = 0; index < selectedGroups.length; index += 1) {
      if (isCancelRequested(jobId)) throw new Error("cancel_requested");
      const group = selectedGroups[index];
      const selection = selectionById.get(group.id)!;
      const percent = 5 + Math.round((index / selectedGroups.length) * 80);
      progress(uid, jobId, {
        status: "processing",
        stage: "layer",
        layer: group.name,
        percent,
        message: `Processando ${group.name}.`,
      });

      try {
        if (!group.shp) throw new Error("Camada sem .shp.");
        const result = analyzeLayer({
          layerId: group.id,
          layerName: group.name,
          shpBuffer: group.shp.data,
          prjText: group.prj?.data.toString("utf8"),
          selection,
          settings,
        });
        if (!outputCrsLabel) {
          outputCrsLabel = result.crs.label;
          outputPrjText = result.crs.prjText || (result.crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
        } else if (outputCrsLabel !== result.crs.label) {
          allWarnings.push(`${group.name}: CRS diferente da primeira camada (${result.crs.label}); saída única usa ${outputCrsLabel}.`);
        }
        allPairs.push(...result.pairs);
        allWarnings.push(...result.warnings);
        analyzedLayers.push({
          name: group.name,
          requested: Math.max(0, Math.floor(Number(selection.pointCount || 0))),
          found: result.pairs.length,
          crsLabel: result.crs.label,
          metricCrsLabel: result.metricCrsLabel,
        });
      } catch (error: any) {
        allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
        analyzedLayers.push({
          name: group.name,
          requested: Math.max(0, Math.floor(Number(selection.pointCount || 0))),
          found: 0,
          crsLabel: "erro",
          metricCrsLabel: "erro",
        });
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 90,
      message: "Gerando ZIP final.",
    });
    const zip = await buildResultZip({
      pairs: allPairs,
      includeOriginalVertices: settings.includeOriginalVertices !== false,
      includeCsvSummary: settings.includeCsvSummary !== false,
      includeTxtReport: settings.includeTxtReport !== false,
      prjText: outputPrjText,
      filename: String(upload.filename || "vertices.zip"),
      analyzedLayers,
      warnings: allWarnings,
    });
    const stored = saveUserBuffer({
      uid,
      area: "vertices/output",
      filename: `vertices_proximas_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });
    const resultRows = allPairs.map((pair) => pairToMidpointRecord(pair).attributes);
    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Análise concluída.",
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/vertices/download/${jobId}`,
      outputBytes: zip.length,
      resultRows,
      warnings: allWarnings,
      analyzedLayers,
      completedAt: new Date().toISOString(),
    };
    progress(uid, jobId, payload);
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const cancelled = error?.message === "cancel_requested";
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      percent: cancelled ? undefined : 100,
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao processar vértices.",
      error: error?.message || "vertices_failed",
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: error?.message || "vertices_failed" });
  } finally {
    closeSubscribers(jobId);
  }
}

export function registerVerticesRoutes(app: Express): void {
  app.post("/api/vertices/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "vertices.zip")) || "vertices.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({ error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile." });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "vertices/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistVerticesJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        layers,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      res.json({
        ok: true,
        uploadId,
        filename,
        layers: visibleLayers,
        warnings: layers
          .filter((layer) => layer.ignoredReason && layer.featureCount > 0)
          .map((layer) => `${layer.name}: ${layer.ignoredReason}`),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ZIP." });
    }
  });

  app.post("/api/vertices/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "vertices_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload de vértices não encontrado." });
        return;
      }
      const selections = Array.isArray((req.body as any)?.layers) ? (req.body as any).layers as LayerSelection[] : [];
      const activeSelections = selections.filter((item) => item?.analyze !== false);
      if (!activeSelections.length) {
        res.status(400).json({ error: "Selecione ao menos uma camada para analisar." });
        return;
      }
      for (const selection of activeSelections) {
        const pointCount = Number(selection.pointCount || 0);
        if (!Number.isFinite(pointCount) || pointCount <= 0) {
          res.status(400).json({ error: "Quantidade de pontos deve ser maior que zero." });
          return;
        }
      }
      const job = startJob({
        uid,
        endpoint: "/api/vertices/process",
        metadata: { uploadId, filename: upload.filename, layers: activeSelections.length },
      });
      persistVerticesJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento de vértices enviado ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runVerticesJob({
        uid,
        jobId: job.jobId,
        upload,
        selections,
        settings: ((req.body as any)?.settings || {}) as ProcessSettings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/vertices/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de vértices não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/vertices/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de vértices não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });
    const status = String(data.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) {
      res.end();
      return;
    }
    const set = subscribers.get(jobId) || new Set<Response>();
    set.add(res);
    subscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/vertices/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado de vértices não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `vertices_proximas_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/vertices/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    persistVerticesJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
