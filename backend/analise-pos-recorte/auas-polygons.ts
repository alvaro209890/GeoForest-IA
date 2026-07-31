import crypto from "crypto";
import { area as turfArea, bbox as turfBbox, centroid as turfCentroid } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

import type { AuasPolygonIdentity } from "./types";

const SQ_METERS_PER_HECTARE = 10_000;

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

/**
 * Extrai cada geometria da camada AUAS individualmente, sem unir polígonos.
 * Preserva Polygon/MultiPolygon, buracos e partes disjuntas tal como recortadas.
 */
export function extractAuasPolygons(
  clippedGeometries: Map<string, Geometry[]> | undefined
): AuasPolygonIdentity[] {
  const geometries = clippedGeometries?.get("AUAS");
  if (!geometries || geometries.length === 0) return [];

  const result: AuasPolygonIdentity[] = [];
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
    const areaM2 = turfArea(feature);
    const [minX, minY, maxX, maxY] = turfBbox(feature) as [number, number, number, number];
    const centroidFeature = turfCentroid(feature);
    const [cx, cy] = centroidFeature.geometry.coordinates as [number, number];

    result.push({
      polygonId: `AUAS-${String(result.length + 1).padStart(4, "0")}`,
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
