/**
 * Helpers geométricos compartilhados pelos detectores (projeção métrica, áreas, hull, amostragem).
 */
import "../proj-defs";
import proj4 from "proj4";
import { featureCollection as turfFeatureCollection, union as turfUnion } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../vertices-proximas";
import { estimateUtmProjFromLonLat, layerBbox, ringGroupsForRecord } from "../vertices-proximas";
import type { SimcarLayerCode } from "../simcar-rules";
import { recognizeSimcarLayer } from "../simcar-rules";
import { CodedFeature, SimcarRuleLayer } from "./types";

export function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

export function ensureClosed(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, [first[0], first[1]]];
  return ring;
}

/** Agrupa anéis por parte (casca + buracos) e devolve GeoJSON Polygon/MultiPolygon. */
export function recordToGeoJSON(record: ParsedPolygonRecord): Polygon | MultiPolygon | null {
  const groups = ringGroupsForRecord(record);
  if (!groups.length) return null;

  const partsMap = new Map<number, { shell?: number[][]; holes: number[][][] }>();
  for (const group of groups) {
    const coords = ensureClosed(group.coords);
    if (coords.length < 4) continue;
    const entry = partsMap.get(group.part) || { holes: [] };
    if (group.ring === 1 && !entry.shell) entry.shell = coords;
    else entry.holes.push(coords);
    partsMap.set(group.part, entry);
  }

  const polygons: number[][][][] = [];
  for (const entry of partsMap.values()) {
    if (!entry.shell) continue;
    polygons.push([entry.shell, ...entry.holes]);
  }
  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
  return { type: "MultiPolygon", coordinates: polygons };
}

/* ─────────── check: vértices duplicados / anel degenerado ─────────── */

export function sameCoordinate(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
}


export function sampleLooksGeographic(records: ParsedPolygonRecord[]): boolean {
  let n = 0;
  for (const rec of records) {
    for (const ring of rec.rings) {
      for (const p of ring) {
        n += 1;
        if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return false;
        if (n >= 40) return true;
      }
    }
  }
  return n > 0;
}

export function ringCentroid(coords: number[][]): [number, number] {
  let sx = 0;
  let sy = 0;
  const n = Math.max(1, coords.length);
  for (const p of coords) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / n, sy / n];
}

export type MetricBridge = {
  toMetric: (p: number[]) => [number, number];
  fromMetric: (p: number[]) => [number, number];
};

export function buildMetricBridge(records: ParsedPolygonRecord[]): MetricBridge {
  const identity: MetricBridge = {
    toMetric: (p) => [Number(p[0]), Number(p[1])],
    fromMetric: (p) => [Number(p[0]), Number(p[1])],
  };
  if (!records.length || !sampleLooksGeographic(records)) return identity;

  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const rec of records) {
    for (const ring of rec.rings) {
      if (!ring.length) continue;
      const c = ringCentroid(ring);
      lon += c[0];
      lat += c[1];
      n += 1;
      if (n >= 20) break;
    }
    if (n >= 20) break;
  }
  if (!n) return identity;
  lon /= n;
  lat /= n;
  const { projDef } = estimateUtmProjFromLonLat(lon, lat);
  try {
    return {
      toMetric: (p) => {
        const out = proj4("EPSG:4326", projDef, [Number(p[0]), Number(p[1])]) as [number, number];
        return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : [Number(p[0]), Number(p[1])];
      },
      fromMetric: (p) => {
        const out = proj4(projDef, "EPSG:4326", [Number(p[0]), Number(p[1])]) as [number, number];
        return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : [Number(p[0]), Number(p[1])];
      },
    };
  } catch {
    return identity;
  }
}

export function metricDistance(a: number[], b: number[], bridge: MetricBridge): number {
  const ma = bridge.toMetric(a);
  const mb = bridge.toMetric(b);
  return Math.hypot(ma[0] - mb[0], ma[1] - mb[1]);
}


/** Convex hull (monotone chain) de pontos métricos. */
export function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Largura mínima do conjunto (rotating calipers sobre o hull), em metros. */
export function minWidth(points: Array<[number, number]>): number {
  const hull = convexHull(points);
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len <= 0) continue;
    let maxDist = 0;
    for (const p of hull) {
      const d = Math.abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / len;
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < best) best = maxDist;
  }
  return Number.isFinite(best) ? best : 0;
}


export function geometryBbox(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < xMin) xMin = x;
        if (y < yMin) yMin = y;
        if (x > xMax) xMax = x;
        if (y > yMax) yMax = y;
      }
    }
  }
  return [xMin, yMin, xMax, yMax];
}

export function bboxesTouch(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function ringPlanarArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** Área (m²) de um Polygon reprojetado para CRS métrico (cascas − buracos). */
export function polygonMetricAreaM2(polygon: number[][][], crs: CodedCrs, metricProjDef: string): number {
  const toMetric = (pt: number[]): number[] => {
    if (crs.kind === "geographic") {
      const src = crs.projDef || "EPSG:4326";
      const out = proj4(src, metricProjDef, [pt[0], pt[1]]) as [number, number];
      return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : pt;
    }
    return pt;
  };
  let total = 0;
  polygon.forEach((ring, idx) => {
    const projected = ring.map(toMetric);
    const a = Math.abs(ringPlanarArea(projected));
    total += idx === 0 ? a : -a;
  });
  return Math.max(0, total);
}

export function metricProjForCrs(crs: CodedCrs, records: ParsedPolygonRecord[]): string {
  if (crs.kind === "projected" && crs.projDef) return crs.projDef;
  const bbox = layerBbox(records);
  const center: [number, number] = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : [0, 0];
  return estimateUtmProjFromLonLat(center[0], center[1]).projDef;
}

/** Projeção métrica usada nos cálculos (UTM estimado quando o CRS é geográfico). */
export function metricProjDefFor(crs: CodedCrs, records: ParsedPolygonRecord[]): string {
  return metricProjForCrs(crs, records);
}

/**
 * Como polygonMetricAreaM2, mas DENSIFICA arestas longas (em graus) antes de
 * projetar. Sem isso, lascas de interseção com uma aresta longa (corda) ganham
 * área falsa de arco-corda da projeção UTM — oráculo CAR 270069: os pares
 * ARL 62-64/67-69 (lascas de ~4,5 mm de largura) medem ~600/310 m² sem
 * densificar e <1 m² densificado, e a SEMA NÃO os conta. Já a tabela
 * "Geometrias encontradas" bate EXATA sem densificar (vértice-corda) — por
 * isso esta função é usada só na medição de pares de sobreposição.
 */
export function polygonMetricAreaDensifiedM2(
  polygon: number[][][],
  crs: CodedCrs,
  metricProjDef: string,
  stepDeg = 0.001,
): number {
  if (crs.kind !== "geographic") return polygonMetricAreaM2(polygon, crs, metricProjDef);
  const densified = polygon.map((ring) => {
    const out: number[][] = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      out.push([x1, y1]);
      const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      const extra = Math.min(64, Math.floor(span / stepDeg));
      for (let k = 1; k <= extra; k += 1) {
        out.push([x1 + ((x2 - x1) * k) / (extra + 1), y1 + ((y2 - y1) * k) / (extra + 1)]);
      }
    }
    out.push(ring[ring.length - 1]);
    return out;
  });
  return polygonMetricAreaM2(densified, crs, metricProjDef);
}

/**
 * Área planar (m²) em UTM — MESMO método de área do ProcessarGeo da SEMA
 * (oráculo CAR 270069: a tabela "Geometrias encontradas" bate a ≤0,0003 ha
 * com UTM planar SIRGAS; área elipsoidal/esférica NÃO bate).
 */
export function geometryPlanarAreaM2(
  geometry: Polygon | MultiPolygon,
  crs: CodedCrs,
  metricProjDef: string,
): number {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const poly of polys) total += polygonMetricAreaM2(poly as number[][][], crs, metricProjDef);
  return total;
}


export function groupLayersByCode(layers: SimcarRuleLayer[]): Map<SimcarLayerCode, CodedFeature[]> {
  const byCode = new Map<SimcarLayerCode, CodedFeature[]>();
  for (const layer of layers) {
    const code = recognizeSimcarLayer(layer.name);
    if (!code || !layer.records.length) continue;
    const metricProjDef = metricProjForCrs(layer.crs, layer.records);
    const list = byCode.get(code) || [];
    for (const record of layer.records) {
      const geometry = recordToGeoJSON(record);
      if (!geometry) continue;
      list.push({ layerName: layer.name, feature: record.feature, geometry, crs: layer.crs, metricProjDef });
    }
    if (list.length) byCode.set(code, list);
  }
  return byCode;
}

/** União robusta; feições problemáticas são ignoradas (com aviso do chamador). */
export function unionFeatures(features: CodedFeature[]): Feature<Polygon | MultiPolygon> | null {
  let acc: Feature<Polygon | MultiPolygon> | null = null;
  for (const item of features) {
    const feat: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: item.geometry };
    if (!acc) {
      acc = feat;
      continue;
    }
    try {
      const merged = turfUnion(turfFeatureCollection([acc, feat]) as any) as Feature<Polygon | MultiPolygon> | null;
      if (merged?.geometry) acc = merged;
    } catch {
      // mantém acumulado parcial
    }
  }
  return acc;
}

export function geometryMetricAreaM2(geometry: Polygon | MultiPolygon, crs: CodedCrs, metricProjDef: string): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const polygon of polygons) {
    total += polygonMetricAreaM2(polygon as number[][][], crs, metricProjDef);
  }
  return total;
}

/* ─────────── check: vazios/gaps entre feições da mesma camada ─────────── */


export function pointToSegmentDistanceM(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}


export function sampleRingEveryMeters(
  ring: number[][],
  metricProjDef: string,
  stepM: number,
): number[][] {
  if (ring.length < 2 || stepM <= 0) return ring.map((p) => [Number(p[0]), Number(p[1])]);
  const toM = proj4("WGS84", metricProjDef);
  const out: number[][] = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    const [ax, ay] = toM.forward([Number(a[0]), Number(a[1])]) as [number, number];
    const [bx, by] = toM.forward([Number(b[0]), Number(b[1])]) as [number, number];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      out.push([Number(a[0]) + t * (Number(b[0]) - Number(a[0])), Number(a[1]) + t * (Number(b[1]) - Number(a[1]))]);
    }
  }
  return out;
}


export function firstVertexLonLat(geometry: Polygon | MultiPolygon): [number, number] {
  const coords: any =
    geometry.type === "Polygon" ? geometry.coordinates[0]?.[0] : geometry.coordinates[0]?.[0]?.[0];
  return [Number(coords?.[0]) || 0, Number(coords?.[1]) || 0];
}
