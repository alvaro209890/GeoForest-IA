/**
 * Evidência geométrica da Fase 3 (vegetação na Área Consolidada) — F3.1.
 *
 * Determinística, sem rede, sem IA: cruza cada polígono `AREA_CONSOLIDADA` com
 * AVN, TIPOLOGIA_VEGETAL, ARL/ARLREM e AUAS usando turf. Fragmentos abaixo do
 * limiar de sliver (default 500 m²) são descartados e contabilizados à parte.
 * Esta evidência tem PRECEDÊNCIA sobre a visual (doc 06 §2.1).
 */
import {
  area as turfArea,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  union as turfUnion,
} from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

const SQ_METERS_PER_HECTARE = 10_000;
const SLIVER_THRESHOLD_M2 = 500;

export type GeometricEvidence = {
  avnAreaHa: number;
  avnFraction: number;
  avnParts: number;
  tipologiaAreaHa: number;
  tipologiaFraction: number;
  tipologias: string[];
  arlAreaHa: number;
  auasAreaHa: number;
  sliversDiscardedM2: number;
  /** Fração declarada combinada (AVN ∪ TIPOLOGIA_VEGETAL), a que dispara alerta ALTO. */
  declaredVegetationFraction: number;
  declaredVegetationAreaHa: number;
};

export type GeometryEvidenceDeps = {
  sliverThresholdM2?: number;
};

function asFeature(geometry: Geometry): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: geometry as Polygon | MultiPolygon };
}

function isPolygonal(geom: Geometry): geom is Polygon | MultiPolygon {
  return geom.type === "Polygon" || geom.type === "MultiPolygon";
}

/** União das geometrias de uma camada recortada (vazia → null). */
export function unionLayerGeometries(geometries: Geometry[] | undefined): Feature<Polygon | MultiPolygon> | null {
  if (!geometries || geometries.length === 0) return null;
  const polys: Array<Feature<Polygon | MultiPolygon>> = [];
  for (const geom of geometries) {
    if (!isPolygonal(geom)) continue;
    polys.push(asFeature(geom));
  }
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  try {
    const result = turfUnion(turfFeatureCollection(polys)) as Feature<Polygon | MultiPolygon> | null;
    return result;
  } catch {
    return polys[0];
  }
}

export type LayerGeometries = {
  AREA_CONSOLIDADA?: Geometry[];
  AVN?: Geometry[];
  TIPOLOGIA_VEGETAL?: Geometry[];
  ARL?: Geometry[];
  ARLREM?: Geometry[];
  AUAS?: Geometry[];
};

/** Área em ha de uma geometria (Feature). */
export function areaHaOf(feature: Feature<Polygon | MultiPolygon>): number {
  return turfArea(feature) / SQ_METERS_PER_HECTARE;
}

export type AcGeometryInput = {
  acGeometry: Geometry;
  layers: LayerGeometries;
};

export type AcGeometryResult = {
  polygonId: string;
  geometryHash: string;
  areaHa: number;
  geometric: GeometricEvidence;
};

/**
 * Calcula as interseções de um polígono AC com as camadas declaradas.
 * Retorna frações sobre a área total do AC (após descarte de slivers).
 */
export function computeAcGeometricEvidence(
  input: AcGeometryInput,
  deps: GeometryEvidenceDeps = {}
): AcGeometryResult {
  const sliverThresholdM2 = deps.sliverThresholdM2 ?? SLIVER_THRESHOLD_M2;
  const acFeature = asFeature(input.acGeometry);
  const acAreaM2 = turfArea(acFeature);
  const acAreaHa = acAreaM2 / SQ_METERS_PER_HECTARE;

  const avnUnion = unionLayerGeometries(input.layers.AVN);
  const tipologiaUnion = unionLayerGeometries(input.layers.TIPOLOGIA_VEGETAL);
  const arlUnion = unionLayerGeometries([...(input.layers.ARL || []), ...(input.layers.ARLREM || [])]);
  const auasUnion = unionLayerGeometries(input.layers.AUAS);

  const avn = intersectWithSliverFilter(acFeature, avnUnion, sliverThresholdM2);
  const tipologia = intersectWithSliverFilter(acFeature, tipologiaUnion, sliverThresholdM2);
  const arl = intersectWithSliverFilter(acFeature, arlUnion, sliverThresholdM2);
  const auas = intersectWithSliverFilter(acFeature, auasUnion, sliverThresholdM2);

  // Área declarada combinada (AVN ∪ TIPOLOGIA_VEGETAL), com slivers descartados por união.
  const declaredUnion = unionLayerGeometries([
    ...(avn.feature ? [avn.feature.geometry] : []),
    ...(tipologia.feature ? [tipologia.feature.geometry] : []),
  ]);

  const sliversDiscardedM2 =
    avn.sliversDiscardedM2 + tipologia.sliversDiscardedM2 + arl.sliversDiscardedM2 + auas.sliversDiscardedM2;

  const declaredAreaHa = declaredUnion ? areaHaOf(declaredUnion) : 0;
  const declaredFraction = acAreaM2 > 0 ? (declaredAreaHa * SQ_METERS_PER_HECTARE) / acAreaM2 : 0;

  return {
    polygonId: "",
    geometryHash: "",
    areaHa: acAreaHa,
    geometric: {
      avnAreaHa: avn.areaHa,
      avnFraction: acAreaM2 > 0 ? avn.areaM2 / acAreaM2 : 0,
      avnParts: avn.parts,
      tipologiaAreaHa: tipologia.areaHa,
      tipologiaFraction: acAreaM2 > 0 ? tipologia.areaM2 / acAreaM2 : 0,
      tipologias: input.layers.TIPOLOGIA_VEGETAL ? ["camada TIPOLOGIA_VEGETAL presente"] : [],
      arlAreaHa: arl.areaHa,
      auasAreaHa: auas.areaHa,
      sliversDiscardedM2,
      declaredVegetationFraction: declaredFraction,
      declaredVegetationAreaHa: declaredAreaHa,
    },
  };
}

type IntersectOutcome = {
  feature: Feature<Polygon | MultiPolygon> | null;
  areaM2: number;
  areaHa: number;
  parts: number;
  sliversDiscardedM2: number;
};

/** Interseção com descarte de fragmentos menores que o limiar de sliver. */
function intersectWithSliverFilter(
  acFeature: Feature<Polygon | MultiPolygon>,
  target: Feature<Polygon | MultiPolygon> | null,
  sliverThresholdM2: number
): IntersectOutcome {
  if (!target) return { feature: null, areaM2: 0, areaHa: 0, parts: 0, sliversDiscardedM2: 0 };

  let inter: Feature<Polygon | MultiPolygon> | null;
  try {
    inter = turfIntersect(turfFeatureCollection([acFeature, target])) as Feature<Polygon | MultiPolygon> | null;
  } catch {
    return { feature: null, areaM2: 0, areaHa: 0, parts: 0, sliversDiscardedM2: 0 };
  }
  if (!inter) return { feature: null, areaM2: 0, areaHa: 0, parts: 0, sliversDiscardedM2: 0 };

  const rings = collectRings(inter.geometry);
  const keptRings: number[][][] = [];
  let sliversDiscardedM2 = 0;

  for (const ring of rings) {
    const ringFeature: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };
    const ringArea = turfArea(ringFeature);
    if (ringArea < sliverThresholdM2) {
      sliversDiscardedM2 += ringArea;
    } else {
      keptRings.push(ring);
    }
  }

  if (keptRings.length === 0) {
    return { feature: null, areaM2: 0, areaHa: 0, parts: 0, sliversDiscardedM2 };
  }

  const filtered: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: keptRings.length === 1
      ? { type: "Polygon", coordinates: [keptRings[0]] }
      : { type: "MultiPolygon", coordinates: keptRings.map((r) => [r]) },
  };

  const areaM2 = turfArea(filtered);
  return {
    feature: filtered,
    areaM2,
    areaHa: areaM2 / SQ_METERS_PER_HECTARE,
    parts: keptRings.length,
    sliversDiscardedM2,
  };
}

/** Coleta anéis externos (sem buracos) de Polygon/MultiPolygon. */
function collectRings(geom: Polygon | MultiPolygon): number[][][] {
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  return geom.coordinates.map((poly) => poly[0]);
}
