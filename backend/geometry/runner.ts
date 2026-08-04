/**
 * Orquestrador por camada: roda os detectores habilitados e devolve as linhas de erro.
 */
import type { ParsedPolygonRecord } from "../vertices-proximas";
import { detectDuplicateVertices } from "./detectors/duplicate-points";
import { detectSelfIntersections } from "./detectors/self-intersection";
import { GeometryChecks, GeometryErrorRow, TopologyDetectOptions } from "./types";

export function analyzeLayerGeometry(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  checks: GeometryChecks;
  topology?: TopologyDetectOptions;
}): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  if (args.checks.selfIntersection !== false) {
    rows.push(...detectSelfIntersections(args.layerName, args.records, args.topology));
  }
  if (args.checks.duplicateVertices !== false) {
    rows.push(...detectDuplicateVertices(args.layerName, args.records, args.topology));
  }
  return rows;
}
