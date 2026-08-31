
import type { Confidence } from "../types";

export type { Confidence } from "../types";

export type Pos2008Sensor =
  | "LANDSAT_5"
  | "LANDSAT_7"
  | "LANDSAT_8"
  | "RESOURCESAT"
  | "SENTINEL_2"
  | "SPOT"
  /** Camada forçada por env cujo nome não casa com nenhum padrão conhecido. */
  | "UNKNOWN";

/**
 * Id de janela no formato `W<anoInicial>_<anoFinal>` (ex.: `W2009_2011`), gerado
 * por `buildPos2008Windows` a partir da série efetiva — por isso é template
 * literal e não enum: a série é configurável (`SIMCAR_AUAS_POS2008_SERIES_END`).
 */
export type Pos2008WindowId = `W${number}_${number}` | "WBRIDGE";

/** Fronteiras de sensor conhecidas entre anos consecutivos da série 2009–2019. */
export const POS2008_SENSOR_BOUNDARIES: Array<{ fromYear: number; toYear: number }> = [
  { fromYear: 2011, toYear: 2012 },
  { fromYear: 2012, toYear: 2013 },
  { fromYear: 2018, toYear: 2019 },
];

export type Pos2008Scene = {
  sceneId: string;
  polygonId: string;
  geometryHash: string;
  year: number;
  sensor: Pos2008Sensor;
  layer: string;
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
  bridge?: boolean;
  imageBuffer?: Buffer;
};

export type Pos2008WindowObservation = {
  schemaVersion: 1;
  polygonId: string;
  windowId: Pos2008WindowId;
  inspectedSceneIds: string[];
  observations: Array<{
    sceneId: string;
    year: number;
    state: "NATIVE_VEGETATION" | "ANTHROPIZED" | "MIXED" | "NOT_OBSERVABLE";
    observableFraction: number | null;
    confidence: Confidence;
    evidence: string[];
    limitations: string[];
  }>;
  transitions: Array<{
    fromSceneId: string;
    toSceneId: string;
    fromYear: number;
    toYear: number;
    transition: "NONE" | "NATIVE_TO_ANTHROPIZED" | "ANTHROPIZED_TO_NATIVE" | "UNCLEAR";
    confidence: Confidence;
    evidence: string[];
  }>;
  conflicts: string[];
};

export type Pos2008WindowRunStatus = "COMPLETED" | "FAILED" | "SKIPPED";

export type Pos2008WindowRun = {
  polygonId: string;
  windowId: Pos2008WindowId;
  status: Pos2008WindowRunStatus;
  model: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  observation?: Pos2008WindowObservation;
  errorCode?: string;
};

export type AuasPos2008Status =
  | "CONFIRMADO_ANO"
  | "CONFIRMADO_INTERVALO"
  | "JA_ANTROPIZADO_NO_INICIO_DA_SERIE"
  | "SEM_MUDANCA_OBSERVADA"
  | "INCONCLUSIVO";

export type AuasPos2008PolygonResult = {
  polygonId: string;
  geometryHash: string;
  areaHa: number;
  status: AuasPos2008Status;
  firstDetectedYear: number | null;
  observedInterval: { fromYear: number; toYear: number } | null;
  confidence: Confidence;
  crossedSensorBoundary: boolean;
  bridgeWindowUsed: string | null;
  pre2008: { status: string; pre2008Alert: boolean };
  sceneIds: string[];
  windowIds: string[];
  evidence: string[];
  limitations: string[];
};

export type AuasPos2008Analysis = {
  schemaVersion: 1;
  rulesVersion: "auas-pos2008-v1";
  phase: "POS_2008";
  jobId: string;
  pre2008JobRef: { rulesVersion: string; completedAt: string } | null;
  catalog: {
    version: string;
    years: number[];
    layerByYear: Record<number, string>;
    missingYears: number[];
    alternativesAvailable: Record<number, string[]>;
  };
  summary: {
    polygonCount: number;
    confirmedYearCount: number;
    intervalCount: number;
    alreadyAnthropizedCount: number;
    noChangeCount: number;
    inconclusiveCount: number;
    totalAuasAreaHa: number;
    areaByStatusHa: Record<AuasPos2008Status, number>;
    yearHistogram: Record<number, { count: number; areaHa: number }>;
  };
  polygons: AuasPos2008PolygonResult[];
  scenes: Array<Omit<Pos2008Scene, "imageBuffer">>;
  windows: Pos2008WindowRun[];
  report: { model: "deepseek-v4-pro" | "deterministic-fallback"; markdown: string; evidenceRefs: string[] };
  limitations: string[];
  startedAt: string;
  completedAt: string;
};