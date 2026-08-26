export type FiscalizacaoSource = 'ibama' | 'sema' | 'siga';

export type FiscalizacaoJobStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uploaded'
  | 'deleted';

/** Contagem por fonte devolvida pelo backend ao concluir o job. */
export type FiscalizacaoResumoItem = {
  source: FiscalizacaoSource;
  label: string;
  total: number;
  incidentes: number;
  error?: string;
};

export type FiscalizacaoHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: FiscalizacaoJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  files?: string[];
  atpNome?: string;
  atpAreaHa?: number;
  totalIncidentes?: number;
  resumo?: FiscalizacaoResumoItem[];
  downloadUrl?: string;
  outputUrl?: string;
  warnings?: string[];
};

export const FISCALIZACAO_SOURCE_LABELS: Record<FiscalizacaoSource, string> = {
  ibama: 'IBAMA — Embargos (PAMGIA)',
  sema: 'SEMA-MT — Fiscalização',
  siga: 'SIGA — Fiscalização',
};
