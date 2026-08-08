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
  /** Fração declarada que dispara o alerta ALTO (ver `declaredSources`). */
  declaredVegetationFraction: number;
  declaredVegetationAreaHa: number;
  /** Camadas que compuseram a área declarada nesta execução. */
  declaredSources: DeclaredSource[];
  /**
   * `TIPOLOGIA_VEGETAL` cobre praticamente toda a AC — comportamento de camada de
   * cobertura, não de mancha declarada. Vira limitação no laudo.
   */
  tipologiaCoversWholeAc: boolean;
};

/** Camadas admissíveis como "vegetação declarada" pelo projeto. */
export type DeclaredSource = "AVN" | "TIPOLOGIA_VEGETAL";

/**
 * Só a `AVN` por padrão.
 *
 * Medido em 2026-08-07 sobre o recorte real da Santa Clara (33 ACs): a
 * `TIPOLOGIA_VEGETAL` da SEMA cobre ~100% de **toda** AC — é o mapa de tipologia
 * do imóvel inteiro, incluindo classes antrópicas, não uma declaração de
 * vegetação nativa. Somá-la à área declarada fazia 100% das ACs baterem o limiar
 * e saírem como alerta ALTO, o que zera o poder de discriminação da fase. A `AVN`
 * é a camada que o próprio plano define como "vegetação nativa declarada pelo
 * projeto" (doc 06 §2.1) e no mesmo recorte deu 0 ha dentro das ACs — o esperado.
 * Quem quiser o comportamento antigo liga `SIMCAR_AC_VEG_DECLARED_SOURCES`.
 */
export const DEFAULT_DECLARED_SOURCES: DeclaredSource[] = ["AVN"];

/** Acima disso a tipologia é cobertura do imóvel, não mancha declarada. */
const TIPOLOGIA_TOTAL_COVERAGE_FRACTION = 0.95;

export type GeometryEvidenceDeps = {
  sliverThresholdM2?: number;
  declaredSources?: DeclaredSource[];
  /** Uniões já calculadas para o recorte inteiro (ver `prepareLayerUnions`). */
  prepared?: PreparedLayerUnions;
};

function asFeature(geometry: Geometry): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: geometry as Polygon | MultiPolygon };
}

function isPolygonal(geom: Geometry): geom is Polygon | MultiPolygon {
  return geom.type === "Polygon" || geom.type === "MultiPolygon";
}

/**
 * União das geometrias de uma camada recortada (vazia → null).
 *
 * Se o `union` do turf falhar (topologia suja é comum em shape de CAR), o
 * fallback junta TODAS as partes num MultiPolygon em vez de devolver só a
 * primeira: devolver `polys[0]` descartava silenciosamente o resto da camada e
 * subestimava a área declarada — erro que empurra o polígono para um alerta
 * menor sem deixar rastro. As camadas do SIMCAR não podem se auto-sobrepor
 * (é erro de validação), então somar as partes não conta área duas vezes.
 */
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
    if (result) return result;
  } catch {
    /* cai no MultiPolygon abaixo */
  }
  const coordinates: number[][][][] = [];
  for (const poly of polys) {
    if (poly.geometry.type === "Polygon") coordinates.push(poly.geometry.coordinates);
    else coordinates.push(...poly.geometry.coordinates);
  }
  return { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates } };
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

/** Feição de camada com bbox pré-calculada, para descarte barato por AC. */
type IndexedFeature = {
  feature: Feature<Polygon | MultiPolygon>;
  bbox: [number, number, number, number];
};

/** Camadas do recorte indexadas UMA vez, reutilizadas por todos os polígonos de AC. */
export type PreparedLayerUnions = {
  avn: IndexedFeature[];
  tipologia: IndexedFeature[];
  arl: IndexedFeature[];
  auas: IndexedFeature[];
};

function bboxOf(geom: Polygon | MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function indexLayer(geometries: Geometry[] | undefined): IndexedFeature[] {
  const indexed: IndexedFeature[] = [];
  for (const geom of geometries || []) {
    if (!isPolygonal(geom)) continue;
    indexed.push({ feature: asFeature(geom), bbox: bboxOf(geom) });
  }
  return indexed;
}

/**
 * Indexa as camadas do recorte uma única vez.
 *
 * Antes, `computeAcGeometricEvidence` reunia as 117 feições de AVN, 88 de
 * tipologia, 117 de ARL e 34 de AUAS **a cada AC**: ~1,5 s por polígono,
 * constante, independente do tamanho da AC (52 s nas 33 ACs da Santa Clara).
 * Agora cada AC só une e intersecta as feições cuja bbox realmente encosta nela
 * — o caso comum é nenhuma ou uma.
 */
export function prepareLayerUnions(layers: LayerGeometries): PreparedLayerUnions {
  return {
    avn: indexLayer(layers.AVN),
    tipologia: indexLayer(layers.TIPOLOGIA_VEGETAL),
    arl: indexLayer([...(layers.ARL || []), ...(layers.ARLREM || [])]),
    auas: indexLayer(layers.AUAS),
  };
}

/** União só das feições que encostam na bbox do alvo (vazio → null). */
function unionNear(
  indexed: IndexedFeature[],
  targetBbox: [number, number, number, number]
): Feature<Polygon | MultiPolygon> | null {
  const near = indexed.filter((entry) => bboxesOverlap(entry.bbox, targetBbox));
  if (near.length === 0) return null;
  return unionLayerGeometries(near.map((entry) => entry.feature.geometry));
}

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
  const declaredSources = deps.declaredSources ?? DEFAULT_DECLARED_SOURCES;
  const acFeature = asFeature(input.acGeometry);
  const acAreaM2 = turfArea(acFeature);
  const acAreaHa = acAreaM2 / SQ_METERS_PER_HECTARE;

  const indexed = deps.prepared ?? prepareLayerUnions(input.layers);
  const acBbox = bboxOf(acFeature.geometry);

  const avn = intersectWithSliverFilter(acFeature, unionNear(indexed.avn, acBbox), sliverThresholdM2);
  const tipologia = intersectWithSliverFilter(acFeature, unionNear(indexed.tipologia, acBbox), sliverThresholdM2);
  const arl = intersectWithSliverFilter(acFeature, unionNear(indexed.arl, acBbox), sliverThresholdM2);
  const auas = intersectWithSliverFilter(acFeature, unionNear(indexed.auas, acBbox), sliverThresholdM2);

  const tipologiaFraction = acAreaM2 > 0 ? tipologia.areaM2 / acAreaM2 : 0;
  const tipologiaCoversWholeAc = tipologiaFraction >= TIPOLOGIA_TOTAL_COVERAGE_FRACTION;

  // Área declarada: só as camadas escolhidas em `declaredSources` (default AVN).
  // A união evita contar duas vezes quando as duas camadas entram e se sobrepõem.
  const declaredParts: Geometry[] = [];
  if (declaredSources.includes("AVN") && avn.feature) declaredParts.push(avn.feature.geometry);
  if (declaredSources.includes("TIPOLOGIA_VEGETAL") && tipologia.feature) {
    declaredParts.push(tipologia.feature.geometry);
  }
  const declaredUnion = unionLayerGeometries(declaredParts);

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
      tipologiaFraction,
      // Sem os atributos do .dbf não dá para nomear as tipologias tocadas; só se
      // afirma o que foi medido. Antes saía "camada presente" mesmo com AC que
      // não encosta na tipologia (`[]` é truthy).
      tipologias: tipologia.areaM2 > 0 ? [`interseção com TIPOLOGIA_VEGETAL: ${tipologia.areaHa.toFixed(2)} ha`] : [],
      arlAreaHa: arl.areaHa,
      auasAreaHa: auas.areaHa,
      sliversDiscardedM2,
      declaredVegetationFraction: declaredFraction,
      declaredVegetationAreaHa: declaredAreaHa,
      declaredSources: [...declaredSources],
      tipologiaCoversWholeAc,
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

  const polygons = collectPolygons(inter.geometry);
  const keptPolygons: number[][][][] = [];
  let sliversDiscardedM2 = 0;

  for (const coordinates of polygons) {
    const polygonFeature: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates },
    };
    const polygonArea = turfArea(polygonFeature);
    if (polygonArea < sliverThresholdM2) {
      sliversDiscardedM2 += polygonArea;
    } else {
      // Keep the complete polygon coordinates, including interior rings. A
      // hole is not an independent positive fragment of vegetation.
      keptPolygons.push(coordinates);
    }
  }

  if (keptPolygons.length === 0) {
    return { feature: null, areaM2: 0, areaHa: 0, parts: 0, sliversDiscardedM2 };
  }

  const filtered: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: keptPolygons.length === 1
      ? { type: "Polygon", coordinates: keptPolygons[0] }
      : { type: "MultiPolygon", coordinates: keptPolygons },
  };

  const areaM2 = turfArea(filtered);
  return {
    feature: filtered,
    areaM2,
    areaHa: areaM2 / SQ_METERS_PER_HECTARE,
    parts: keptPolygons.length,
    sliversDiscardedM2,
  };
}

/** Coleta polígonos completos, preservando anéis internos (buracos). */
function collectPolygons(geom: Polygon | MultiPolygon): number[][][][] {
  if (geom.type === "Polygon") return [geom.coordinates];
  return geom.coordinates;
}
