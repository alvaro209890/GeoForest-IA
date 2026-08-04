/**
 * Detector: sobreposição entre feições da MESMA camada.
 */
import { featureCollection as turfFeatureCollection, intersect as turfIntersect, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../../vertices-proximas";
import { GeometryErrorRow, OverlapPairSummary, OverlapPolygon, RuleViolationPolygon } from "../types";
import { bboxesTouch, geometryBbox, metricProjForCrs, polygonMetricAreaDensifiedM2, recordToGeoJSON } from "../utils";

export function summarizeOverlapPairs(
  overlaps: OverlapPolygon[],
  violations: RuleViolationPolygon[],
): OverlapPairSummary[] {
  const map = new Map<string, OverlapPairSummary & { largestM2: number }>();
  const push = (
    camadaA: string,
    camadaB: string,
    feicaoA: number,
    feicaoB: number,
    areaM2: number,
    geometry: Polygon,
  ) => {
    const key = `${camadaA}\t${camadaB}\t${feicaoA}\t${feicaoB}`;
    const cur = map.get(key);
    if (cur) {
      cur.areaM2 += areaM2;
      if (areaM2 > cur.largestM2) {
        cur.largestM2 = areaM2;
        cur.geometry = geometry;
      }
    } else {
      map.set(key, { camadaA, camadaB, feicaoA, feicaoB, areaM2, geometry, largestM2: areaM2 });
    }
  };
  for (const o of overlaps) push(o.camada, o.camada, o.feicaoA, o.feicaoB, o.areaM2, o.geometry);
  for (const v of violations) {
    if (v.regra !== "sobreposicao") continue;
    push(v.camadaA, v.camadaB, v.feicaoA, v.feicaoB ?? -1, v.areaM2, v.geometry);
  }
  return [...map.values()].map(({ largestM2: _largest, ...rest }) => rest);
}

/**
 * Detecta pares de feições da MESMA camada cujos polígonos se sobrepõem
 * (interseção com área acima de `minOverlapM2`). Sobreposições de borda com
 * área ínfima são ruído numérico e ficam abaixo do limiar padrão de 1 m².
 */
export function detectOverlaps(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  minOverlapM2?: number;
  /**
   * Semântica do ProcessarGeo da SEMA: o par só conta se a SOMA das
   * interseções (sem filtro de parte) ≥ este valor. Quando ausente, mantém o
   * comportamento clássico (qualquer parte ≥ minOverlapM2 conta).
   */
  pairMinAreaM2?: number;
}): { rows: GeometryErrorRow[]; overlapPolygons: OverlapPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const overlapPolygons: OverlapPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minOverlapM2)) ? Math.max(0, Number(args.minOverlapM2)) : 1;
  const pairMin = Number.isFinite(Number(args.pairMinAreaM2)) ? Math.max(0, Number(args.pairMinAreaM2)) : null;
  const metricProjDef = metricProjForCrs(args.crs, args.records);

  const features = args.records
    .map((record) => {
      const geometry = recordToGeoJSON(record);
      if (!geometry) return null;
      return { feature: record.feature, geometry, bbox: geometryBbox(geometry) };
    })
    .filter((item): item is { feature: number; geometry: Polygon | MultiPolygon; bbox: [number, number, number, number] } => Boolean(item));

  for (let i = 0; i < features.length; i += 1) {
    for (let j = i + 1; j < features.length; j += 1) {
      const a = features[i];
      const b = features[j];
      if (!bboxesTouch(a.bbox, b.bbox)) continue;
      let intersection: Feature<Polygon | MultiPolygon> | null = null;
      try {
        intersection = turfIntersect(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: a.geometry } as Feature<Polygon | MultiPolygon>,
            { type: "Feature", properties: {}, geometry: b.geometry } as Feature<Polygon | MultiPolygon>,
          ]) as any,
        ) as Feature<Polygon | MultiPolygon> | null;
      } catch (error: any) {
        warnings.push(
          `${args.layerName}: não foi possível comparar as feições ${a.feature} e ${b.feature} (${error?.message || "geometria inválida"}); corrija a auto-interseção antes.`,
        );
        continue;
      }
      if (!intersection?.geometry) continue;
      const polygons =
        intersection.geometry.type === "Polygon"
          ? [intersection.geometry.coordinates]
          : intersection.geometry.coordinates;
      let pairAreaM2 = 0;
      let pairTotalM2 = 0;
      const pairPolygons: OverlapPolygon[] = [];
      for (const polygon of polygons) {
        const areaM2 = polygonMetricAreaDensifiedM2(polygon as number[][][], args.crs, metricProjDef);
        pairTotalM2 += areaM2;
        if (areaM2 < minArea) continue;
        pairAreaM2 += areaM2;
        pairPolygons.push({
          camada: args.layerName,
          feicaoA: a.feature,
          feicaoB: b.feature,
          areaM2,
          geometry: { type: "Polygon", coordinates: polygon as number[][][] },
        });
      }
      if (!pairPolygons.length) continue;
      if (pairMin !== null && pairTotalM2 < pairMin) continue; // par abaixo da resolução do ProcessarGeo
      overlapPolygons.push(...pairPolygons);
      let x = NaN;
      let y = NaN;
      try {
        const point = turfPointOnFeature({ type: "Feature", properties: {}, geometry: pairPolygons[0].geometry } as any);
        [x, y] = point.geometry.coordinates as [number, number];
      } catch {
        [x, y] = pairPolygons[0].geometry.coordinates[0][0] as [number, number];
      }
      rows.push({
        camada: args.layerName,
        tipo: "sobreposicao",
        feicao: a.feature,
        parte: 0,
        anel: 0,
        x: Number(x),
        y: Number(y),
        detalhe: `Sobrepõe a feição ${b.feature} da mesma camada em ${(pairAreaM2 / 10000).toFixed(4)} ha (${pairAreaM2.toFixed(2)} m²).`,
      });
    }
  }
  return { rows, overlapPolygons, warnings };
}

/* ────────── helpers compartilhados (regras SIMCAR + gaps/AIR×ATP) ────────── */
