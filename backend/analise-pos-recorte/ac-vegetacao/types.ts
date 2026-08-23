import type { Geometry } from "geojson";

import type { Confidence } from "../types";

export type AcVegetacaoStatus =
  | "VEGETACAO_DECLARADA_DENTRO_DA_AC"
  | "VEGETACAO_APARENTE_DENTRO_DA_AC"
  | "SEM_VEGETACAO_APARENTE"
  | "INCONCLUSIVO";

export type AcVegetacaoAlertLevel = "ALTO" | "MEDIO" | "NENHUM" | "INDETERMINADO";

export type AcVegetacaoScene = {
  sceneId: string;
  polygonId: string;
  geometryHash: string;
  year: number;
  sensor: string;
  layer: string;
  style?: string;
  imageSha256: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  usability: "USABLE" | "CLOUD_OR_OCCLUSION" | "LOW_RESOLUTION" | "BELOW_MIN_RESOLUTION" | "MISSING" | "INVALID";
  qualityScore: number | null;
  qualityFlags: string[];
  fetchedAt: string;
  storedImageUrl?: string;
  /** URL pública (storage local) da cena com overlay, para o anexo fotográfico do laudo. */
  publicImageUrl?: string;
  imageBuffer?: Buffer;
};

export const AC_VEGETATION_WINDOW_ID = "WAVAC_ATUAL" as const;

export const AC_VEGETATION_RULES_VERSION = "ac-vegetacao-v1" as const;

export type AcVegetacaoWindowObservation = {
  schemaVersion: 1;
  polygonId: string;
  windowId: typeof AC_VEGETATION_WINDOW_ID;
  inspectedSceneIds: string[];
  observations: Array<{
    sceneId: string;
    year: number;
    vegetationInside: "NONE" | "SPARSE" | "PATCHES" | "LARGE_BLOCK" | "NOT_OBSERVABLE";
    estimatedFraction: number | null;
    distribution: "EDGE" | "INTERIOR" | "RIPARIAN" | "SCATTERED" | null;
    confidence: Confidence;
    evidence: string[];
    limitations: string[];
  }>;
  conflicts: string[];
};

export type AcVegetacaoWindowRun = {
  polygonId: string;
  windowId: typeof AC_VEGETATION_WINDOW_ID;
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  model: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  observation?: AcVegetacaoWindowObservation;
  errorCode?: string;
};

export type AcPolygonResult = {
  polygonId: string;
  geometryHash: string;
  areaHa: number;
  status: AcVegetacaoStatus;
  alertLevel: AcVegetacaoAlertLevel;
  geometric: {
    avnAreaHa: number;
    avnFraction: number;
    avnParts: number;
    tipologiaAreaHa: number;
    tipologiaFraction: number;
    tipologias: string[];
    arlAreaHa: number;
    auasAreaHa: number;
    sliversDiscardedM2: number;
    declaredVegetationAreaHa: number;
    declaredVegetationFraction: number;
    /** Camadas somadas na área declarada (default: só AVN). */
    declaredSources: string[];
    /** TIPOLOGIA_VEGETAL cobre ~toda a AC (camada de cobertura, não declaração). */
    tipologiaCoversWholeAc: boolean;
  };
  visual: {
    verdict: "NONE" | "SPARSE" | "PATCHES" | "LARGE_BLOCK" | "NOT_OBSERVABLE";
    estimatedFractionBand: "<0.5ha" | "0.5-2ha" | "2-10ha" | ">10ha" | null;
    distribution: string | null;
    sceneIds: string[];
  };
  flags: string[];
  confidence: Confidence;
  evidence: string[];
  limitations: string[];
};

export type AcVegetacaoAnalysis = {
  schemaVersion: 1;
  rulesVersion: typeof AC_VEGETATION_RULES_VERSION;
  phase: "AC_VEG";
  jobId: string;
  pos2008JobRef: { rulesVersion: string; completedAt: string } | null;
  summary: {
    polygonCount: number;
    totalAcAreaHa: number;
    declaredVegetationCount: number;
    declaredVegetationAreaHa: number;
    apparentVegetationCount: number;
    cleanCount: number;
    inconclusiveCount: number;
  };
  polygons: AcPolygonResult[];
  scenes: Array<Omit<AcVegetacaoScene, "imageBuffer">>;
  windows: AcVegetacaoWindowRun[];
  report: { model: "deepseek-v4-pro" | "deterministic-fallback"; markdown: string; evidenceRefs: string[] };
  limitations: string[];
  startedAt: string;
  completedAt: string;
};

export type AcLayerInput = {
  /** Nome da camada recortada como está em `clippedGeometries`. */
  layerName: string;
  geometries: Geometry[];
};

export type AcPotentialPolygon = {
  polygonId: string;
  geometryHash: string;
  sourceIndex: number;
  areaHa: number;
  bbox: [number, number, number, number];
  centroid: [number, number];
  geometry: Geometry;
};