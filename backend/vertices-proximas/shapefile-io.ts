/**
 * Leitura do ZIP: registros de polígono, camadas, CRS e anéis por parte.
 */
import "../proj-defs";
import crypto from "node:crypto";
import path from "node:path";
import { detectUtmProj, extractZipEntries } from "../geo-utils";
import { SIRGAS_2000_PRJ, WGS84_PRJ } from "./constants";
import { CodedCrs, ParsedPolygonRecord, VerticesLayerInfo, ZipEntry } from "./types";
import { safeSegment } from "../lib/job-utils";

export { parseBase64Zip, safeSegment } from "../lib/job-utils";

export function layerIdForPath(entryName: string): string {
  const digest = crypto.createHash("sha1").update(entryName).digest("hex").slice(0, 10);
  const base = safeSegment(path.basename(entryName, path.extname(entryName)).toUpperCase()) || "CAMADA";
  return `${base}_${digest}`;
}

export function basenameKey(entryName: string): string {
  const dir = path.dirname(entryName).replace(/\\/g, "/");
  const base = path.basename(entryName, path.extname(entryName)).toLowerCase();
  return `${dir === "." ? "" : `${dir}/`}${base}`;
}

export function shapeTypeName(shapeType: number): string {
  if (shapeType === 0) return "Vazio";
  if ([1, 11, 21].includes(shapeType)) return "Point";
  if ([3, 13, 23].includes(shapeType)) return "Polyline";
  if ([5, 15, 25].includes(shapeType)) return "Polygon";
  if ([8, 18, 28].includes(shapeType)) return "MultiPoint";
  return `Tipo ${shapeType}`;
}

export function readMainShapeType(shp: Buffer): number {
  if (shp.length < 36) return 0;
  return shp.readInt32LE(32);
}


export function parsePolygonRecords(shpBuffer: Buffer): ParsedPolygonRecord[] {
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

export function getZipLayerGroups(zipBuffer: Buffer): Array<{
  id: string;
  name: string;
  key: string;
  shp?: ZipEntry;
  prj?: ZipEntry;
  dbf?: ZipEntry;
}> {
  const entries = extractZipEntries(zipBuffer).filter((entry) => !entry.name.endsWith("/"));
  const groups = new Map<string, { id: string; name: string; key: string; shp?: ZipEntry; prj?: ZipEntry; dbf?: ZipEntry }>();
  for (const entry of entries) {
    const ext = path.extname(entry.name).toLowerCase();
    if (![".shp", ".prj", ".dbf"].includes(ext)) continue;
    const key = basenameKey(entry.name);
    const current = groups.get(key) || {
      id: layerIdForPath(entry.name),
      name: path.basename(entry.name, path.extname(entry.name)).toUpperCase(),
      key,
    };
    if (ext === ".shp") current.shp = entry;
    if (ext === ".prj") current.prj = entry;
    if (ext === ".dbf") current.dbf = entry;
    groups.set(key, current);
  }
  return [...groups.values()].filter((group) => group.shp || group.prj);
}

export function parseEpsgOverride(raw: string): CodedCrs | null {
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

export function detectCrs(prjTextRaw?: string, override?: string): CodedCrs {
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


export function sameCoordinate(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
}

export function removeNaturalClosure(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return sameCoordinate(first, last) ? ring.slice(0, -1) : ring;
}

export function ringAreaAbs(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

export function pointInRing(point: number[], ring: number[][]): boolean {
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

export function representativePoint(ring: number[][]): number[] | null {
  return ring.find((point) => point.every(Number.isFinite)) || null;
}

export function ringDepth(ring: number[][], index: number, rings: number[][][]): number {
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

export function ringGroupsForRecord(record: ParsedPolygonRecord): Array<{ part: number; ring: number; coords: number[][] }> {
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

export function layerBbox(records: ParsedPolygonRecord[]): [number, number, number, number] | null {
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
