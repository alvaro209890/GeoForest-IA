import area from "@turf/area";
import { featureCollection, intersect, union } from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon } from "geojson";

/**
 * Checagens geométricas determinísticas da Fase 1 (AUAS pré-2008).
 *
 * Medem a sobreposição de cada polígono AUAS com as camadas DECLARADAS do
 * recorte (AREA_CONSOLIDADA e AVN), independente de qualquer IA — mesma
 * filosofia do `geometryCrossCheck` da análise AC/AVN: verdade geométrica
 * primeiro. O SIMCAR trata AUAS/ÁREA INUNDADA sobrepondo AC/AVN como
 * validação impeditiva (Anexo 01 do Manual do Projeto Geográfico), então
 * essa sobreposição é uma inconsistência objetiva de declaração.
 */

type PolyFeature = Feature<Polygon | MultiPolygon>;

function mergeLayerAsUnion(geometries: Map<string, Geometry[]> | undefined, layerName: string): PolyFeature | null {
  const geoms = geometries?.get(layerName);
  if (!geoms || geoms.length === 0) return null;
  let acc: PolyFeature | null = null;
  for (const geom of geoms) {
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const feature = { type: "Feature", properties: {}, geometry: geom } as unknown as PolyFeature;
    try {
      acc = acc ? (union(featureCollection([acc, feature]) as never) as unknown as PolyFeature) : feature;
    } catch {
      // geometria inválida individual não derruba o lote
    }
  }
  return acc;
}

function intersectionAreaHa(a: PolyFeature, b: PolyFeature): number {
  try {
    const inter = intersect(featureCollection([a, b]) as never) as Feature | null;
    if (!inter) return 0;
    return area(inter) / 10_000; // m² → ha
  } catch {
    return 0;
  }
}

export type AuasGeometryChecks = {
  overlapAcHa: number;
  overlapAvnHa: number;
  hasAcLayer: boolean;
  hasAvnLayer: boolean;
};

/**
 * Calcula as interseções de UM polígono AUAS contra os unions de AC e AVN.
 * Retorna undefined quando nenhuma das duas camadas existe no recorte.
 */
export function computeAuasGeometryChecks(
  clippedGeometries: Map<string, Geometry[]> | undefined,
  polygonGeometry: Geometry
): AuasGeometryChecks | undefined {
  const acUnion = mergeLayerAsUnion(clippedGeometries, "AREA_CONSOLIDADA");
  const avnUnion = mergeLayerAsUnion(clippedGeometries, "AVN");
  if (!acUnion && !avnUnion) return undefined;

  const polyFeature = { type: "Feature", properties: {}, geometry: polygonGeometry } as unknown as PolyFeature;
  return {
    overlapAcHa: acUnion ? intersectionAreaHa(polyFeature, acUnion) : 0,
    overlapAvnHa: avnUnion ? intersectionAreaHa(polyFeature, avnUnion) : 0,
    hasAcLayer: !!acUnion,
    hasAvnLayer: !!avnUnion,
  };
}
