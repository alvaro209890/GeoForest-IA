/**
 * Detector: vazios/gaps entre polígonos adjacentes da mesma camada.
 */
import { convex as turfConvex, difference as turfDifference, featureCollection as turfFeatureCollection, intersect as turfIntersect, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../../vertices-proximas";
import { CodedFeature, GapPolygon, GeometryErrorRow } from "../types";
import proj4 from "proj4";
import { bboxesTouch, convexHull, geometryBbox, metricProjForCrs, minWidth, polygonMetricAreaM2, recordToGeoJSON, unionFeatures } from "../utils";

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
 * Detecta vazios (gaps) entre polígonos da MESMA camada: os **anéis interiores
 * da união** das feições — buracos de fato cercados por geometria.
 *
 * Fonte: topologia de shapefile/CAR (SEMA) — "Vazios (Gaps): não deve haver
 * buracos não intencionais entre polígonos adjacentes".
 *
 * ⚠️ Até 2026-08-08 usava `envelope convexo − união`, o que é outra coisa: o
 * fecho convexo de feições **espalhadas** cobre todo o vão entre elas, e cada
 * concavidade virava "vazio". Medido no CAR 6816, aprovado pela SEMA: AVN com
 * 2 manchas distantes (1,53 ha somados) gerava um "vazio" de 7,62 ha — cinco
 * vezes a própria camada —, AUAS gerava 4,68 ha e ARL 0,11 ha, com **zero**
 * buracos reais. Camadas do CAR não particionam o imóvel: AUAS são clareiras
 * separadas, AVN são remanescentes separados. Distância entre feições não é
 * erro topológico.
 */
/**
 * Piso de área para reportar um vazio. O discriminador principal é a LARGURA
 * (`MAX_GAP_WIDTH_M`); a área só descarta lascas de arredondamento — no CAR
 * 6816, aprovado pela SEMA, havia frestas de 1,65 m² e 3,04 m² entre feições
 * vizinhas de ARL, abaixo da tolerância da própria SEMA.
 */
export const MIN_GAP_M2 = 10;

/**
 * Largura máxima de uma "fresta" para ela contar como vazio. Duas feições que
 * deveriam encostar e ficaram a 2 m uma da outra são erro de vetorização; duas
 * manchas de AVN a 300 m uma da outra são simplesmente duas manchas.
 */
export const MAX_GAP_WIDTH_M = 5;

/**
 * Menor largura do polígono, em metros — fecho convexo + calipers.
 *
 * A conversão para métrico segue a mesma regra de `polygonMetricAreaM2`: quem
 * decide é o `crs` da camada, nunca a aparência das coordenadas. (Um CRS
 * projetado com coordenadas pequenas, como no teste em EPSG:31981, seria
 * confundido com lon/lat por um detector heurístico.)
 */
function candidateWidthM(ring: number[][], crs: CodedCrs, metricProjDef: string): number {
  const points = ring.map((pt) => {
    if (crs.kind === "geographic") {
      const src = crs.projDef || "EPSG:4326";
      const out = proj4(src, metricProjDef, [pt[0], pt[1]]) as [number, number];
      return (Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : [pt[0], pt[1]]) as [number, number];
    }
    return [pt[0], pt[1]] as [number, number];
  });
  if (points.length < 3) return Number.POSITIVE_INFINITY;
  const hull = convexHull(points);
  if (hull.length < 3) return Number.POSITIVE_INFINITY;
  return minWidth(hull);
}

export function detectGaps(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  minGapM2?: number;
}): { rows: GeometryErrorRow[]; gapPolygons: GapPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const gapPolygons: GapPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minGapM2)) ? Math.max(0, Number(args.minGapM2)) : MIN_GAP_M2;
  const metricProjDef = metricProjForCrs(args.crs, args.records);

  const features = args.records
    .map((record) => {
      const geometry = recordToGeoJSON(record);
      if (!geometry) return null;
      return { feature: record.feature, geometry, bbox: geometryBbox(geometry) };
    })
    .filter((item): item is { feature: number; geometry: Polygon | MultiPolygon; bbox: [number, number, number, number] } => Boolean(item));

  if (features.length < 2) return { rows, gapPolygons, warnings };

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

  // (a) Anéis interiores da união = buracos cercados por geometria. O anel 0 de
  //     cada parte é o contorno externo e nunca é vazio.
  const unionParts =
    unioned.geometry.type === "Polygon"
      ? [unioned.geometry.coordinates]
      : unioned.geometry.coordinates;
  const candidates: number[][][][] = [];
  for (const part of unionParts) {
    for (let ringIndex = 1; ringIndex < part.length; ringIndex += 1) {
      candidates.push([part[ringIndex] as number[][]]);
    }
  }

  // (b) Frestas: sobras do fecho convexo que são ESTREITAS. O fecho sozinho
  //     acusaria todo vão entre feições distantes (era o falso positivo); com o
  //     filtro de largura sobra só o que parece erro de vetorização.
  const turfFeatures = features.map(
    (item) =>
      ({ type: "Feature", properties: { feicao: item.feature }, geometry: item.geometry }) as Feature<
        Polygon | MultiPolygon
      >,
  );
  try {
    const hull = turfConvex(turfFeatureCollection(turfFeatures) as any) as Feature<Polygon | MultiPolygon> | null;
    if (hull?.geometry) {
      const diff = turfDifference(turfFeatureCollection([hull, unioned]) as any) as Feature<
        Polygon | MultiPolygon
      > | null;
      if (diff?.geometry) {
        const parts = diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
        for (const part of parts) {
          const outer = (part as number[][][])[0];
          if (!outer) continue;
          if (candidateWidthM(outer, args.crs, metricProjDef) > MAX_GAP_WIDTH_M) continue;
          candidates.push(part as number[][][]);
        }
      }
    }
  } catch (error: any) {
    warnings.push(`${args.layerName}: falha ao procurar frestas entre feições (${error?.message || "erro"}).`);
  }

  for (const polygon of candidates) {
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
