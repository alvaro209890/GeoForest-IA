import type { Geometry } from "geojson";

export type SceneUsability =
  | "USABLE"
  | "CLOUD_OR_OCCLUSION"
  | "LOW_RESOLUTION"
  /** Polígono menor que a resolução do sensor — cena não gerada, sem custo de IA. */
  | "BELOW_MIN_RESOLUTION"
  | "MISSING"
  | "INVALID";

export type VisualLandState =
  | "NATIVE_VEGETATION"
  | "ANTHROPIZED"
  | "MIXED"
  | "NOT_OBSERVABLE";

export type PolygonPre2008Status =
  | "ALERTA_PRE_2008"
  | "SINAL_DE_DUVIDA"
  | "SEM_EVIDENCIA_PRE_2008"
  | "INCONCLUSIVO_NO_MARCO_2008"
  | "INCONCLUSIVO";

export type PropertyPre2008Status =
  | "ALERTA_PRE_2008"
  | "SINAL_DE_DUVIDA"
  | "SEM_EVIDENCIA_PRE_2008"
  | "INCONCLUSIVO";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";

export type AuasWindowId = "W2003_2005" | "W2005_2007" | "W2007_2008";

export type AuasYear = 2003 | 2004 | 2005 | 2006 | 2007 | 2008;

/** Um polígono AUAS individual identificado após o recorte SIMCAR. */
export type AuasPolygonIdentity = {
  polygonId: string;
  geometryHash: string;
  sourceIndex: number;
  areaHa: number;
  bbox: [number, number, number, number];
  centroid: [number, number];
  geometry: Geometry;
};

export type AuasScene = {
  sceneId: string;
  polygonId: string;
  geometryHash: string;
  year: AuasYear;
  sensor: "LANDSAT_5" | "SPOT";
  layer: string;
  imageSha256: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  usability: SceneUsability;
  qualityScore: number | null;
  qualityFlags: string[];
  fetchedAt: string;
  storedImageUrl?: string;
  /** URL pública (storage local) da cena com overlay, para anexo no DOCX/laudo. */
  publicImageUrl?: string;
  /** Buffer da imagem já com overlay, usado somente em memória (nunca persistido bruto). */
  imageBuffer?: Buffer;
};

export type GroqWindowObservation = {
  schemaVersion: 1;
  polygonId: string;
  windowId: AuasWindowId;
  inspectedSceneIds: string[];
  observations: Array<{
    sceneId: string;
    year: number;
    state: VisualLandState;
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
    change:
      | "ANTHROPIZATION_APPEARED"
      | "NO_RELEVANT_CHANGE"
      | "POSSIBLE_CHANGE"
      | "NOT_OBSERVABLE";
    confidence: Confidence;
    evidence: string[];
  }>;
  conflicts: string[];
};

export type AuasEvidenceKind =
  | "ANTHROPIZED_BY_2003"
  | "TRANSITION_BEFORE_2008"
  | "MIXED_STATE_OBSERVED"
  | "POSSIBLE_CHANGE_PRE_2008"
  | "FRACTION_TREND_SUSPICIOUS"
  | "DECLARATION_INCONSISTENCY"
  | "NO_PRE2008_CHANGE_OBSERVED"
  | "ONLY_2007_TO_2008_CHANGE"
  | "INSUFFICIENT_EVIDENCE";

export type AuasPolygonResult = {
  polygonId: string;
  geometryHash: string;
  sourceIndex: number;
  areaHa: number;
  bbox: [number, number, number, number];
  status: PolygonPre2008Status;
  pre2008Alert: boolean;
  evidenceKind: AuasEvidenceKind;
  observedInterval: {
    fromYear: number | null;
    toYear: number | null;
    wording: string;
  } | null;
  confidence: Confidence;
  sceneIds: string[];
  windowIds: AuasWindowId[];
  evidence: string[];
  limitations: string[];
  /**
   * Fração observável do polígono com sinal de uso/solo exposto por ano
   * (do campo `observableFraction` da visão, consolidado por ano). Alimenta a
   * tendência de progressão que caracteriza desmate raso gradual.
   */
  anthropizedFractionByYear?: Partial<Record<AuasYear, number>>;
  /** Sinais de dúvida que motivaram o status SINAL_DE_DUVIDA (texto do laudo). */
  doubtSignals?: string[];
  /**
   * Interseções geométricas determinísticas (turf) contra camadas declaradas —
   * independem da visão. AUAS sobrepondo AC/AVN indica inconsistência de
   * declaração no CAR (o SIMCAR trata como validação impeditiva).
   */
  geometryChecks?: {
    overlapAcHa: number;
    overlapAvnHa: number;
    hasAcLayer: boolean;
    hasAvnLayer: boolean;
  };
};

export type AuasWindowRunStatus = "COMPLETED" | "FAILED" | "SKIPPED";

export type AuasWindowRun = {
  polygonId: string;
  windowId: AuasWindowId;
  status: AuasWindowRunStatus;
  model: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  observation?: GroqWindowObservation;
  errorCode?: string;
};

export type AuasPre2008AnalysisV2 = {
  schemaVersion: 2;
  rulesVersion: "auas-pre2008-v2";
  jobId: string;
  status: PropertyPre2008Status;
  pre2008Alert: boolean;
  confidence: Confidence;
  summary: {
    polygonCount: number;
    alertCount: number;
    /** Polígonos com sinal de dúvida (MIXED/POSSIBLE_CHANGE/tendência de fração). */
    doubtCount: number;
    doubtAreaHa: number;
    inconclusiveCount: number;
    noEvidenceCount: number;
    totalAuasAreaHa: number;
    alertAreaHa: number;
  };
  sources: {
    required: string[];
    used: string[];
    missing: string[];
  };
  polygons: AuasPolygonResult[];
  scenes: Array<Omit<AuasScene, "imageBuffer">>;
  windows: AuasWindowRun[];
  report: {
    model: "deepseek-v4-pro" | "deterministic-fallback";
    markdown: string;
    evidenceRefs: string[];
  };
  limitations: string[];
  startedAt: string;
  completedAt: string;
};

export type AuasV2JobState =
  | "QUEUED"
  | "PREPARING_SCENES"
  | "ANALYZING_POLYGONS"
  | "REDUCING_EVIDENCE"
  | "WRITING_REPORT"
  | "GENERATING_PDF"
  | "COMPLETED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "FAILED";

export type AuasV2Progress = {
  step: string;
  percent: number;
  message: string;
  polygonIndex?: number;
  polygonTotal?: number;
  windowIndex?: number;
  windowTotal?: number;
  etaSeconds?: number;
};

export type DeepseekAuasReportInput = {
  rulesVersion: string;
  aggregateStatus: PropertyPre2008Status;
  pre2008Alert: boolean;
  summary: AuasPre2008AnalysisV2["summary"];
  sources: AuasPre2008AnalysisV2["sources"];
  polygons: Array<{
    polygonId: string;
    areaHa: number;
    status: PolygonPre2008Status;
    evidenceKind: AuasPolygonResult["evidenceKind"];
    observedInterval: AuasPolygonResult["observedInterval"];
    confidence: AuasPolygonResult["confidence"];
    evidence: string[];
    /** Sinais de desmate parcial/gradual ou inconsistência de declaração. */
    doubtSignals?: string[];
    limitations: string[];
  }>;
  limitations: string[];
  acAvnContext?: {
    source: string;
    summary: string;
  };
};
