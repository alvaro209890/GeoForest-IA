/**
 * Tipos da análise de vértices próximos e da leitura de shapefiles.
 */
import path from "node:path";

export type ZipEntry = { name: string; data: Buffer };

export type VerticesLayerInfo = {
  id: string;
  name: string;
  path: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  missingCrs: boolean;
  ignoredReason?: string;
};

export type VertexPoint = {
  original: [number, number];
  metric: [number, number];
  vertexIndex: number;
};

export type VertexPair = {
  layerId: string;
  layerName: string;
  ranking: number;
  feature: number;
  part: number;
  ring: number;
  vertexA: number;
  vertexB: number;
  distM: number;
  aOriginal: [number, number];
  bOriginal: [number, number];
  midOriginal: [number, number];
};

export type ParsedPolygonRecord = {
  feature: number;
  rings: number[][][];
};

export type CodedCrs = {
  label: string;
  kind: "geographic" | "projected" | "unknown";
  projDef?: string;
  prjText?: string;
  missing: boolean;
};

export type LayerSelection = {
  id: string;
  analyze?: boolean;
  pointCount?: number;
  toleranceMm?: number | null;
  crsOverride?: string;
};

export type ProcessSettings = {
  defaultToleranceMm?: number;
  includeOriginalVertices?: boolean;
  includeTxtReport?: boolean;
  includeCsvSummary?: boolean;
  preserveOriginalCrs?: boolean;
  useMetricTemporaryCrs?: boolean;
};
