import type { FixDiffSummary, FixPlan } from "./autofix/types";

export type OraculoStep =
  | "queued"
  | "login"
  | "buscar_projeto"
  | "municipio_check"
  | "municipio_saving"
  | "municipio_ok"
  | "abrangencia_check"
  | "abrangencia_saving"
  | "baseref_wait"
  | "abrangencia_ok"
  | "upload_zip"
  | "importar"
  | "import_poll"
  | "import_ok"
  | "import_fail"
  | "import_done"
  | "processar"
  | "process_poll"
  | "process_ok"
  | "process_fail"
  | "process_done"
  | "download_artifacts"
  | "autofix_plan"
  | "autofix_apply"
  | "autofix_skip"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "done"
  | "error";

export type OraculoProgress = {
  step: OraculoStep;
  message: string;
  percent?: number;
  data?: Record<string, unknown>;
};

export type OraculoEvent = OraculoProgress & {
  ts: string;
  round: number;
};

export type OraculoArtifact = {
  key: string;
  round: number;
  filename: string;
  relativePath: string;
  url: string;
  contentType: string;
  bytes: number;
  source: "upload" | "sema" | "autofix";
};

export type OraculoRoundResult = {
  n: number;
  zipArtifact: string;
  import: null | {
    ok: boolean;
    resultado: string;
    status: string;
    detalhes: string;
    pdf: string | null;
    errosResumo: Array<{ camada: string; erro: string; qtd: number }>;
    parseWarnings: string[];
  };
  process: null | {
    ok: boolean;
    resultado: string;
    status: string;
    detalhes: string;
    pdf: string | null;
    errosZip: string | null;
    errosResumo: Array<{ camada: string; erro: string; qtd: number }>;
    parseWarnings: string[];
  };
  artifactWarnings?: string[];
  fixplan?: string | null;
  fixPlan?: FixPlan | null;
  diffResumo?: FixDiffSummary[];
  autofixPhase?: "import" | "process" | null;
};

export type AutofixStopReason =
  | "autofix_disabled"
  | "max_rounds"
  | "no_mechanical_action"
  | "no_improvement"
  | "no_changes"
  | "apply_failed";

export type MunicipioDetectado = {
  nome: string | null;
  ibge: string | null;
  fonte: "malha-ibge" | "wfs-sema" | "manual" | "nao-detectado";
  chaveSimcar?: string | number;
};

export type SimcarImportOutcome = {
  ok: boolean;
  /** Ex.: [FINALIZADO] | [COM_PENDENCIA] */
  resultado: string;
  status: string;
  detalhes: string;
  raw: Record<string, unknown>;
  pdfBuffer?: Buffer;
  timeline: OraculoProgress[];
};

export type SimcarProcessOutcome = {
  ok: boolean;
  resultado: string;
  status: string;
  detalhes: string;
  raw: Record<string, unknown>;
  pdfBuffer?: Buffer;
  errosZipBuffer?: Buffer | null;
  timeline: OraculoProgress[];
};

export type ShapeContext = {
  bbox: [number, number, number, number];
  centroid: [number, number];
  areaHaApprox?: number;
  layers: string[];
  propertyLayer?: string;
  /** Hint textual se existir no DBF; lookup IBGE fica para P2 */
  municipioHint?: string;
  municipioDetectado: MunicipioDetectado;
  warnings: string[];
  crs?: string;
};

export type SimcarArquivoUpload = {
  Id?: number;
  Nome?: string;
  Situacao?: string;
  [key: string]: unknown;
};
