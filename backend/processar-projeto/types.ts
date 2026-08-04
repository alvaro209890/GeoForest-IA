/**
 * Tipos das fases de importação e processamento do Projeto Geográfico.
 */
import type { GapPolygon, GeometryErrorRow, LayerFixResult, OverlapPairSummary, OverlapPolygon, RuleViolationPolygon } from "../geometry-errors";
import type { ShpRecord } from "../shapefile-writer";

export type ImportPhaseResult = {
  ok: boolean;
  rows: GeometryErrorRow[];
  camadasReconhecidas: Array<{ name: string; code: string | null; featureCount: number; crsLabel: string }>;
  relatorioTexto: string;
  warnings: string[];
};

/** Camada pronta para gravação em shapefile (processado / conferência). */
export type ProcessedLayerOut = {
  name: string;
  records: ShpRecord[];
  fixedFeatures: number;
  featureCount: number;
};

/** Cópia dos arquivos originais do ZIP de entrada (arquivo enviado). */
export type OriginalLayerOut = {
  name: string;
  shp: Buffer;
  dbf?: Buffer;
  prjText: string;
};

export type QuadroAreaRow = {
  camada: string;
  codigo: string;
  feicoes: number;
  erros: number;
  corrigidas: number;
  area_m2: number;
  area_ha: number;
};

export type ProcessPhaseResult = {
  rows: GeometryErrorRow[];
  warnings: string[];
  analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  fixedLayers: Array<{ name: string; fixedFeatures: number }>;
  overlapPolygons: OverlapPolygon[];
  gapPolygons: GapPolygon[];
  ruleViolations: RuleViolationPolygon[];
  /** PARES de sobreposição (semântica do relatório da SEMA: soma ≥ 0,01 ha). */
  overlapPairs: OverlapPairSummary[];
  /** Tabela "Geometrias encontradas" no formato oficial do relatório SEMA. */
  geometriasEncontradas: Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }>;
  fixes: LayerFixResult[];
  /** Sempre preenchido: camadas limpas (unkink + vértices) = base do arquivo processado. */
  processedLayers: ProcessedLayerOut[];
  /** Camadas originais do ZIP (arquivo enviado). */
  originalLayers: OriginalLayerOut[];
  quadroAreas: QuadroAreaRow[];
  prjText: string;
  relatorioTexto: string;
};
