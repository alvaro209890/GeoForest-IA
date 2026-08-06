/**
 * Fase 1 (AUAS pré-2008): identidade dos polígonos AUAS.
 *
 * A implementação genérica vive em `polygons.ts` (tarefa F0.3 do plano). Este
 * arquivo mantém a API histórica da Fase 1 — mesmo `polygonId` (`AUAS-0001…`),
 * mesmo `geometryHash` — para não mexer em quem já a consome.
 */
import type { Geometry } from "geojson";

import { extractPolygonsFromLayer } from "./polygons";
import type { AuasPolygonIdentity } from "./types";

export { computeGeometryHash } from "./polygons";

/**
 * Extrai cada geometria da camada AUAS individualmente, sem unir polígonos.
 * Preserva Polygon/MultiPolygon, buracos e partes disjuntas tal como recortadas.
 */
export function extractAuasPolygons(
  clippedGeometries: Map<string, Geometry[]> | undefined
): AuasPolygonIdentity[] {
  return extractPolygonsFromLayer(clippedGeometries, "AUAS", "AUAS");
}
