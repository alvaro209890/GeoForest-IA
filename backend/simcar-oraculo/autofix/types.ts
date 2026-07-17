import type { DbfFieldDef } from "../../shapefile-writer";
import type { CodedCrs } from "../../vertices-proximas";

export const AUTOFIX_ACTION_TYPES = [
  "remove_duplicate_vertices",
  "clean_degenerate_rings",
  "unkink_self_intersection",
  "remove_glued_holes",
  "clip_layer_to_cover",
  "split_complex_polygon",
] as const;

export const IMPORT_AUTOFIX_ACTION_TYPES = [
  "remove_duplicate_vertices",
  "clean_degenerate_rings",
  "unkink_self_intersection",
  "remove_glued_holes",
  "split_complex_polygon",
] as const;

export type AutofixActionType = (typeof AUTOFIX_ACTION_TYPES)[number];
export type ImportAutofixActionType =
  (typeof IMPORT_AUTOFIX_ACTION_TYPES)[number];

export type FixAction = {
  type: AutofixActionType;
  layers: string[];
  motivo: string;
};

export type NonFixableIssue = {
  erro: string;
  porque: string;
  orientacao: string;
};

export type FixPlan = {
  acoes: FixAction[];
  naoCorrigivel: NonFixableIssue[];
  explicacaoUsuario: string;
  confianca: "alta" | "media" | "baixa";
  fonte: "deepseek" | "fallback";
};

/** Registro de trabalho. `sourceFeature` sempre aponta para a linha DBF original. */
export type AutofixPolygonRecord = {
  sourceFeature: number;
  rings: number[][][];
  attributes: Record<string, string | number | null>;
};

export type LayerRewriteContext = {
  layerName: string;
  crs: CodedCrs;
  records: AutofixPolygonRecord[];
  dbfSchema: DbfFieldDef[];
};

export type LayerActionMetrics = {
  verticesRemoved?: number;
  ringsRemoved?: number;
  recordsDropped?: number;
  recordsCreated?: number;
  identifiersCreated?: number;
};

export type LayerActionResult = {
  records: AutofixPolygonRecord[];
  changed: boolean;
  affectedFeatures: number[];
  warnings?: string[];
  metrics?: LayerActionMetrics;
};

export type LayerAction = (
  context: LayerRewriteContext
) => LayerActionResult | Promise<LayerActionResult>;

export type FixDiffSummary = {
  camada: string;
  acao: ImportAutofixActionType;
  alterou: boolean;
  feicoesAfetadas: number[];
  registrosAntes: number;
  registrosDepois: number;
  verticesRemovidos: number;
  aneisRemovidos: number;
  registrosRemovidos: number;
  registrosCriados: number;
  identificadoresCriados: number;
  avisos: string[];
};

export type ApplyFixPlanResult = {
  novoZip: Buffer;
  diffResumo: FixDiffSummary[];
};
