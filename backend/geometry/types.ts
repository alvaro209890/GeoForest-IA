/**
 * Tipos públicos da análise de erros de geometria do SIMCAR.
 */
import type { MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../vertices-proximas";
import type { ShpRecord } from "../shapefile-writer";

export type GeometryChecks = {
  selfIntersection?: boolean;
  duplicateVertices?: boolean;
  overlaps?: boolean;
  /** Vazios/gaps entre polígonos adjacentes da mesma camada. */
  gaps?: boolean;
  simcarConformity?: boolean;
  simcarContainment?: boolean;
  simcarCrossOverlaps?: boolean;
  /** Soma das áreas AIR deve corresponder à área da ATP. */
  airAtpArea?: boolean;
};

export type RuleViolationPolygon = {
  camadaA: string;
  feicaoA: number;
  camadaB: string;
  /** Feição da camada B (quando a regra envolve um par de feições). */
  feicaoB?: number;
  regra: string;
  areaM2: number;
  geometry: Polygon;
};


export type GeometrySettings = {
  generateFixed?: boolean;
  minOverlapM2?: number;
  /** Tolerância relativa |soma(AIR)−ATP| / max(áreas). Padrão 0,01% (1e-4). */
  airAtpMaxDiffRatio?: number;
};

export type OverlapPolygon = {
  camada: string;
  feicaoA: number;
  feicaoB: number;
  areaM2: number;
  geometry: Polygon;
};

export type GapPolygon = {
  camada: string;
  areaM2: number;
  /** Feições da mesma camada adjacentes ao vazio (quando identificáveis). */
  feicoes: number[];
  geometry: Polygon;
};

export type GeometryErrorRow = {
  camada: string;
  tipo: string;
  feicao: number;
  parte: number;
  anel: number;
  x: number;
  y: number;
  detalhe: string;
};

export type LayerFixResult = {
  layerName: string;
  records: ShpRecord[];
  fixedFeatures: number;
  warnings: string[];
};

/* ─────────────────────────── util ─────────────────────────── */


export type TopologyDetectOptions = {
  /** Distância máxima (m) entre vértices consecutivos para "pontos repetidos". Default SIMCAR. */
  duplicateToleranceM?: number;
  /** Largura de colapso (m) p/ "borda se cruza". 0 desliga colapso/espiga. Default SIMCAR. */
  selfIntersectionSnapM?: number;
};


export type OverlapPairSummary = {
  camadaA: string;
  camadaB: string;
  feicaoA: number;
  feicaoB: number;
  areaM2: number;
  /** Maior parte da interseção do par (posiciona o ponto do erro). */
  geometry: Polygon;
};


export type SimcarRuleLayer = {
  name: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  /** .dbf da camada (opcional) — usado pelas regras que dependem de atributos. */
  dbf?: Buffer;
};

export type CodedFeature = {
  layerName: string;
  feature: number;
  geometry: Polygon | MultiPolygon;
  crs: CodedCrs;
  metricProjDef: string;
};
