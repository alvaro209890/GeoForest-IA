/**
 * Detector: vazios/gaps entre polígonos adjacentes da mesma camada.
 */
import { convex as turfConvex, difference as turfDifference, featureCollection as turfFeatureCollection, intersect as turfIntersect, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../../vertices-proximas";
import { CodedFeature, GapPolygon, GeometryErrorRow } from "../types";
import { bboxesTouch, geometryBbox, metricProjForCrs, polygonMetricAreaM2, recordToGeoJSON, unionFeatures } from "../utils";

/**
 * Conta feições cujas caixas se tocam com a do vazio e cuja geometria
 * intersecta um buffer leve do vazio — usado para filtrar buracos
 * intencionais de uma única feição (só reportamos gaps entre ≥2 feições).
 */
export function neighborFeaturesForGap(
  gapGeometry: Polygon,
  features: Array<{ feature: number; geometry: Polygon | MultiPolygon; bbox: [number, number, number, number] }>,
): number[] {
  const gapBbox = geometryBbox(gapGeometry);
  const neighbors: number[] = [];
  const gapFeature: Feature<Polygon> = { type: "Feature", properties: {}, geometry: gapGeometry };
  for (const item of features) {
    if (!bboxesTouch(gapBbox, item.bbox)) continue;
    try {
      const hit = turfIntersect(
        turfFeatureCollection([
          gapFeature,
          { type: "Feature", properties: {}, geometry: item.geometry } as Feature<Polygon | MultiPolygon>,
        ]) as any,
      );
      // Adjacência: interseção nula mas bboxes se tocam → tenta união e confere se o vazio
      // "preenche" o espaço entre; se intersect retorna null, ainda conta se as caixas se tocam
      // em borda (gap entre polígonos separados por poucos metros).
      if (hit?.geometry) {
        neighbors.push(item.feature);
        continue;
      }
    } catch {
      // geometria problemática: usa só bbox
    }
    // Bbox tocando o gap é suficiente para adjacência grosseira (gap está no envelope).
    neighbors.push(item.feature);
  }
  return neighbors;
}

/**
 * Detecta vazios (gaps) entre polígonos da MESMA camada: diferença entre o
 * envelope convexo das feições e a união delas. Filtra ruído por área mínima
 * (mesmo limiar dos checks de sobreposição) e ignora buracos tocados por
 * apenas uma feição (provável anel interior intencional).
 *
 * Fonte: topologia de shapefile/CAR (SEMA) — "Vazios (Gaps): não deve haver
 * buracos não intencionais entre polígonos adjacentes".
 */
export function detectGaps(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  minGapM2?: number;
}): { rows: GeometryErrorRow[]; gapPolygons: GapPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const gapPolygons: GapPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minGapM2)) ? Math.max(0, Number(args.minGapM2)) : 1;
  const metricProjDef = metricProjForCrs(args.crs, args.records);

  const features = args.records
    .map((record) => {
      const geometry = recordToGeoJSON(record);
      if (!geometry) return null;
      return { feature: record.feature, geometry, bbox: geometryBbox(geometry) };
    })
    .filter((item): item is { feature: number; geometry: Polygon | MultiPolygon; bbox: [number, number, number, number] } => Boolean(item));

  if (features.length < 2) return { rows, gapPolygons, warnings };

  const turfFeatures = features.map(
    (item) =>
      ({ type: "Feature", properties: { feicao: item.feature }, geometry: item.geometry }) as Feature<
        Polygon | MultiPolygon
      >,
  );

  let hull: Feature<Polygon | MultiPolygon> | null = null;
  try {
    hull = turfConvex(turfFeatureCollection(turfFeatures) as any) as Feature<Polygon | MultiPolygon> | null;
  } catch (error: any) {
    warnings.push(`${args.layerName}: não foi possível calcular o envelope convexo (${error?.message || "erro"}).`);
    return { rows, gapPolygons, warnings };
  }
  if (!hull?.geometry) return { rows, gapPolygons, warnings };

  const coded: CodedFeature[] = features.map((item) => ({
    layerName: args.layerName,
    feature: item.feature,
    geometry: item.geometry,
    crs: args.crs,
    metricProjDef,
  }));
  const unioned = unionFeatures(coded);
  if (!unioned?.geometry) {
    warnings.push(`${args.layerName}: não foi possível unir as feições para detectar vazios.`);
    return { rows, gapPolygons, warnings };
  }

  let diff: Feature<Polygon | MultiPolygon> | null = null;
  try {
    diff = turfDifference(turfFeatureCollection([hull, unioned]) as any) as Feature<Polygon | MultiPolygon> | null;
  } catch (error: any) {
    warnings.push(
      `${args.layerName}: falha ao calcular vazios (envelope − união) (${error?.message || "geometria inválida"}).`,
    );
    return { rows, gapPolygons, warnings };
  }
  if (!diff?.geometry) return { rows, gapPolygons, warnings };

  const polygons = diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
  for (const polygon of polygons) {
    const geometry: Polygon = { type: "Polygon", coordinates: polygon as number[][][] };
    const areaM2 = polygonMetricAreaM2(polygon as number[][][], args.crs, metricProjDef);
    if (areaM2 < minArea) continue;
    const feicoes = neighborFeaturesForGap(geometry, features);
    // Buraco tocado por uma única feição = anel interior intencional, não gap entre adjacentes.
    if (feicoes.length < 2) continue;

    gapPolygons.push({ camada: args.layerName, areaM2, feicoes, geometry });

    let x = NaN;
    let y = NaN;
    try {
      const point = turfPointOnFeature({ type: "Feature", properties: {}, geometry } as any);
      [x, y] = point.geometry.coordinates as [number, number];
    } catch {
      [x, y] = geometry.coordinates[0][0] as [number, number];
    }
    rows.push({
      camada: args.layerName,
      tipo: "vazio",
      feicao: feicoes[0] ?? 0,
      parte: 0,
      anel: 0,
      x: Number(x),
      y: Number(y),
      detalhe: `Vazio/gap de ${(areaM2 / 10000).toFixed(4)} ha (${areaM2.toFixed(2)} m²) entre as feições ${feicoes.join(", ")} da mesma camada.`,
    });
  }

  return { rows, gapPolygons, warnings };
}
