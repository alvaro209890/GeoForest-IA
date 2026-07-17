export type ProcessarMode = "LOCAL" | "ORACULO" | "HYBRID";

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
  | "import_done"
  | "processar"
  | "process_poll"
  | "process_done"
  | "download_artifacts"
  | "done"
  | "error";

export type OraculoProgress = {
  step: OraculoStep;
  message: string;
  percent?: number;
  data?: Record<string, unknown>;
};

export type MunicipioDetectado = {
  nome: string | null;
  ibge: string | null;
  fonte: "malha-ibge" | "wfs-sema" | "nao-detectado";
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
