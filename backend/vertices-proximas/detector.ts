/**
 * Detector: pares de vértices dentro da tolerância e análise por camada.
 */
import "../proj-defs";
import proj4 from "proj4";
import { detectCrs, layerBbox, parsePolygonRecords, ringGroupsForRecord } from "./shapefile-io";
import { CodedCrs, LayerSelection, ProcessSettings, VertexPair, VertexPoint } from "./types";

export function estimateUtmProjFromLonLat(lon: number, lat: number): { label: string; projDef: string } {
  const zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1));
  const south = lat < 0;
  return {
    label: `UTM ${zone}${south ? "S" : "N"} temporário`,
    projDef: `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`.trim(),
  };
}

export function toMetricPoint(point: [number, number], crs: CodedCrs, metricProjDef: string): [number, number] {
  if (crs.kind === "geographic") {
    const source = crs.projDef || "EPSG:4326";
    const out = proj4(source, metricProjDef, point) as [number, number];
    return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : point;
  }
  return point;
}

export function squaredDistance(a: [number, number], b: [number, number]): number {
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
  // Campo de tolerância vazio significa SEM limite de distância: retorna os N pares mais próximos.
  // Não herdar tolerância padrão aqui, para "Pontos = 6" sempre significar "os 6 mais próximos".
  const explicitToleranceMm = Number(args.selection.toleranceMm);
  const toleranceMm = Number.isFinite(explicitToleranceMm) ? Math.max(0, explicitToleranceMm) : null;
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
    const suffix = toleranceMm === null ? "disponíveis." : "dentro da tolerância.";
    warnings.push(`${args.layerName}: solicitados ${requested} ponto(s), encontrados ${selected.length} par(es) ${suffix}`);
  }
  return { pairs: selected, warnings, crs, metricCrsLabel: metricCrs.label };
}
