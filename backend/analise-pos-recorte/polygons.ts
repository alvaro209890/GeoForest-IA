/**
 * Extração genérica de polígonos de uma camada recortada do SIMCAR.
 *
 * Base compartilhada pelas 3 fases da análise pós-recorte (plano
 * `docs/planos/analise-pos-recorte/`, tarefa F0.3): a Fase 1 lê `AUAS`, a Fase 3
 * lerá `AREA_CONSOLIDADA`. `auas-polygons.ts` passa a ser só um wrapper daqui —
 * o comportamento e o `polygonId` da Fase 1 continuam idênticos.
 */
import crypto from "crypto";
import { area as turfArea, bbox as turfBbox, centroid as turfCentroid } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

import type { AuasPolygonIdentity } from "./types";

const SQ_METERS_PER_HECTARE = 10_000;

/** Prefixo do `polygonId` por camada. Cada fase tem seu espaço de IDs. */
export const LAYER_ID_PREFIXES: Record<string, string> = {
  AUAS: "AUAS",
  AREA_CONSOLIDADA: "AC",
};

export type LayerPolygonIdentity = AuasPolygonIdentity;

function isPolygonal(geom: Geometry): geom is Polygon | MultiPolygon {
  return geom.type === "Polygon" || geom.type === "MultiPolygon";
}

/** Ordena recursivamente coordenadas/chaves para produzir um GeoJSON canônico e reprodutível. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeGeometryHash(geometry: Geometry): string {
  const canonical = canonicalize(geometry);
  const json = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(json).digest("hex");
}

/** Prefixo padrão da camada; camadas sem entrada no mapa usam o próprio nome. */
export function resolveLayerPrefix(layerName: string): string {
  return LAYER_ID_PREFIXES[layerName] || layerName;
}

/**
 * Extrai cada geometria da camada individualmente, sem unir polígonos.
 * Preserva Polygon/MultiPolygon, buracos e partes disjuntas tal como recortadas.
 *
 * `sourceIndex` é a posição na camada original (inclusive das geometrias
 * descartadas por não serem poligonais), para rastreabilidade com o shapefile.
 */
export function extractPolygonsFromLayer(
  clippedGeometries: Map<string, Geometry[]> | undefined,
  layerName: string,
  prefix: string = resolveLayerPrefix(layerName)
): LayerPolygonIdentity[] {
  const geometries = clippedGeometries?.get(layerName);
  if (!geometries || geometries.length === 0) return [];

  const result: LayerPolygonIdentity[] = [];
  let sourceIndex = 0;
  for (const geometry of geometries) {
    if (!geometry || !isPolygonal(geometry)) {
      sourceIndex += 1;
      continue;
    }
    const feature: Feature<Polygon | MultiPolygon> = {
      type: "Feature",
      properties: {},
      geometry,
    };
    const areaM2 = Math.abs(turfArea(feature));
    const [minX, minY, maxX, maxY] = turfBbox(feature) as [number, number, number, number];
    const centroidFeature = turfCentroid(feature);
    const [cx, cy] = centroidFeature.geometry.coordinates as [number, number];

    result.push({
      polygonId: `${prefix}-${String(result.length + 1).padStart(4, "0")}`,
      geometryHash: computeGeometryHash(geometry),
      sourceIndex,
      areaHa: areaM2 / SQ_METERS_PER_HECTARE,
      bbox: [minX, minY, maxX, maxY],
      centroid: [cx, cy],
      geometry,
    });
    sourceIndex += 1;
  }
  return result;
}

/** Contagem barata de polígonos de uma camada (usada pela rota de fases). */
export function countLayerPolygons(
  clippedGeometries: Map<string, Geometry[]> | undefined,
  layerName: string
): number {
  const geometries = clippedGeometries?.get(layerName);
  if (!geometries || geometries.length === 0) return 0;
  return geometries.filter((geom) => geom && isPolygonal(geom)).length;
}
