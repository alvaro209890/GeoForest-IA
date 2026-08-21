/**
 * Tipos de histórico do Dashboard GeoForest.
 * Extraídos de Dashboard.tsx (plano 03) — fonte única para itens de histórico
 * e metadados de análise SIMCAR.
 */
import type { SimcarAuasMetaV2 } from '@/components/AuasPre2008Summary';
import type { ContainmentRow, ContainmentSummary } from '@/components/ContainmentAnalysis';
import type { GeometryErrorRow, GeometrySummary } from '@/components/GeometryErrorsAnalysis';

export type ChatMessage = {
  id: string;
  role: 'ai' | 'user';
  text: string;
  time?: string;
  meta?: {
    model?: string;
    imageUrl?: string;
    fileUrl?: string;
    fileDownloadUrl?: string;
    fileName?: string;
    uploadStatus?: 'uploading' | 'done' | 'error';
    fileType?: 'image' | 'pdf';
    thinkingText?: string;
    billing?: {
      chargedBrl: number;
      balanceAfterBrl: number;
      usage: Array<{
        provider: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        costBrl: number;
        estimated?: boolean;
      }>;
    };
  };
};

export type Conversation = {
  id: string;
  title: string;
  updatedAt?: any;
  lastMessagePreview?: string;
  lastAttachmentType?: 'image' | 'pdf';
  kind?: string;
  simcarJobId?: string;
  verticesJobId?: string;
  auasJobId?: string;
};

export type BillingUsageItem = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
  estimated?: boolean;
};

export type BillingResult = {
  chargedBrl: number;
  balanceAfterBrl: number;
  usage: BillingUsageItem[];
};

export type BillingMePayload = {
  wallet: {
    balanceBrl: number;
    totalTopupBrl: number;
    totalSpentBrl: number;
    updatedAt?: any;
    version?: number;
  };
  usageToday: {
    date: string;
    totalCostBrl: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    models?: Record<string, any>;
  };
  modelSnapshot: Array<{
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costBrl: number;
    requests: number;
  }>;
};

export type SimcarAnalysisMessage = {
  role: 'ai' | 'user';
  text: string;
  images?: string[];
  thinkingText?: string;
};

export type SimcarAnalysisImage = {
  url: string;
  caption: string;
  sourceLabel?: string;
};

export type SimcarAcAvnAnalysisMeta = {
  globalVerdict?: {
    acForaShape?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null;
    avnDentroShapeAntropizado?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null;
    avnParcialForaShapeMasEmAuas?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null;
    confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'INCONCLUSIVO' | null;
  };
  satelliteVerdicts?: Array<{
    key: string;
    label: string;
    year: number;
    status: 'used' | 'missing';
    acForaShape?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null;
    avnDentroShapeAntropizado?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null;
    confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'INCONCLUSIVO' | null;
  }>;
  coherence?: {
    isCoherent?: boolean;
    notes?: string[];
  };
  cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
  novoCar?: {
    classification?: {
      propertyAreaHa?: number;
      acAreaHa?: number;
      auasAreaHa?: number;
      avnAreaHa?: number;
      riverBufferHa?: number;
      acPct?: number;
      auasPct?: number;
      avnPct?: number;
      riverBufferPct?: number;
    };
    opening?: {
      year?: number;
      date?: string;
      source?: 'PRODES' | 'AI_FALLBACK';
    };
    flags?: string[];
  };
};

export type SimcarAuasMetaV1 = {
  schemaVersion?: undefined;
  yearVerdicts?: Array<{
    satelliteLabel: string;
    year: number;
    verdict: 'CONSOLIDADO' | 'VEGETACAO_NATIVA_PRESENTE' | 'DESMATAMENTO_RECENTE' | 'INCONCLUSIVO';
  }>;
  firstDeforestationYear?: number | null;
  finalStatus?: 'AUAS_VALIDA' | 'AUAS_INVALIDA' | 'AUAS_PARCIAL';
  confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'INCONCLUSIVO';
  passivoAmbiental?: boolean;
  qualityFlags?: string[];
  auasAvnCrossCheck?: {
    auasAreaHa: number;
    avnAreaHa: number;
    overlapAreaHa: number;
    overlapPctOfAuas: number;
    overlapPctOfAvn: number;
    hasAuasOverlapAvn: boolean;
  } | null;
  cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
  satellitesUsed?: string[];
  satellitesMissing?: string[];
  hasAuasVectorizedLayer?: boolean;
  inferredAuasNotVectorized?: boolean;
};

export type SimcarAuasMeta = SimcarAuasMetaV1 | SimcarAuasMetaV2;

/** Resultado da Fase 2 — datação 2009–2019 (tipo conservador, só o que o front lê). */
export type SimcarPos2008Meta = {
  schemaVersion?: number;
  rulesVersion?: string;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  catalog?: { version?: string; years?: number[]; missingYears?: number[] };
  summary?: {
    polygonCount?: number;
    confirmedYearCount?: number;
    intervalCount?: number;
    alreadyAnthropizedCount?: number;
    noChangeCount?: number;
    inconclusiveCount?: number;
    totalAuasAreaHa?: number;
    yearHistogram?: Record<string, { count?: number; areaHa?: number }>;
  };
  report?: { model?: string; markdown?: string; evidenceRefs?: string[] };
  limitations?: string[];
};

/** Resultado da Fase 3 — vegetação na AC. */
export type SimcarAcVegetacaoMeta = {
  schemaVersion?: number;
  rulesVersion?: string;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  summary?: {
    polygonCount?: number;
    totalAcAreaHa?: number;
    declaredVegetationCount?: number;
    declaredVegetationAreaHa?: number;
    apparentVegetationCount?: number;
    cleanCount?: number;
    inconclusiveCount?: number;
  };
  report?: { model?: string; markdown?: string; evidenceRefs?: string[] };
  limitations?: string[];
};

export type SimcarConversationEntry = {
  role: 'ai' | 'user';
  text: string;
  meta?: Partial<NonNullable<ChatMessage['meta']>>;
};

export type SimcarLayerSummary = {
  name: string;
  source: 'property' | 'wfs';
  features: number;
  areaHa?: number;
  warning?: string;
  partial?: boolean;
};

export type SimcarClipSummary = {
  propertyAreaHa: number;
  crs: string;
  layersProcessed: number;
  layersWithData: number;
  totalFeaturesClipped: number;
  processingTimeMs: number;
  layers: SimcarLayerSummary[];
  warnings?: string[];
};

export type SimcarClipHistoryItem = {
  id: string;
  timestamp: string;
  filename: string;
  downloadUrl: string;
  totalFeatures: number;
  propertyAreaHa: number;
  layersWithData: number;
  totalLayers: number;
  jobId: string;
  conversationId?: string;
  inputZipUrl?: string;
  outputZipUrl?: string;
  contextUrl?: string;
  sourceMode?: 'auto-clip' | 'vectorized-analysis';
  processingStage?: 'importing' | 'acavn' | 'auas' | 'done' | 'error';
  analysisImages?: Array<{ url: string; caption: string }>;
  analysisMessages?: SimcarAnalysisMessage[];
  analysisMeta?: SimcarAcAvnAnalysisMeta;
  auasAnalysisImages?: Array<{ url: string; caption: string }>;
  auasAnalysisMessages?: SimcarAnalysisMessage[];
  auasMeta?: SimcarAuasMeta;
  /** Fase 2 — datação 2009–2019 (`/api/simcar/clip/analyze-auas-pos2008`). */
  auasPos2008Meta?: SimcarPos2008Meta;
  /** Fase 3 — vegetação na Área Consolidada (`/api/simcar/clip/analyze-ac-vegetacao`). */
  acVegetacaoMeta?: SimcarAcVegetacaoMeta;
  reportPdfUrl?: string;
  reportPdfDownloadUrl?: string;
  reportPdfFilename?: string;
  reportPdfGeneratedAt?: string;
  reportPdfVersion?: string;
  reportPdfStatus?: 'generating' | 'ready' | 'failed';
  reportPdfError?: string;
  // DOCX editavel do mesmo laudo. Opcional: se o DOCX falhar, o PDF continua
  // valido, entao o card so esconde o botao de Word.
  reportDocxUrl?: string;
  reportDocxDownloadUrl?: string;
  reportDocxFilename?: string;
  reportDocxVersion?: string;
  summary?: SimcarClipSummary;
  status?: 'processing' | 'completed' | 'failed' | 'cancelled';
  error?: string;
};

export type SimcarServerRuntimeState = {
  latestStatus: string;
  latestEndpoint: string;
  hasRunningJob: boolean;
  hasCompletedImport: boolean;
  hasCompletedAnalyze: boolean;
  hasCompletedAuas: boolean;
};

export type VerticesLayer = {
  id: string;
  name: string;
  path?: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  missingCrs: boolean;
  ignoredReason?: string;
  analyze: boolean;
  pointCount: number;
  toleranceMm: string;
  crsOverride: string;
  status?: string;
};

export type VerticesResultRow = {
  camada: string;
  ranking: number;
  feicao: number;
  parte: number;
  anel: number;
  vertice_a: number;
  vertice_b: number;
  dist_m: number;
  dist_cm: number;
  dist_mm: number;
  x_medio: number;
  y_medio: number;
  [key: string]: any;
};

export type VerticesProgress = {
  stage: string;
  percent: number;
  message: string;
  layer?: string;
};

export type VerticesHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted' | 'queued';
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  downloadUrl?: string;
  outputUrl?: string;
  outputBytes?: number;
  resultRows?: VerticesResultRow[];
  warnings?: string[];
  analyzedLayers?: Array<{ name: string; requested: number; found: number; crsLabel?: string; metricCrsLabel?: string }>;
  conversationId?: string;
};

export type ContainmentHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted' | 'queued';
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  downloadUrl?: string;
  outputUrl?: string;
  outputBytes?: number;
  resultRows?: ContainmentRow[];
  summary?: ContainmentSummary;
  warnings?: string[];
  targetLayerName?: string;
  containerCount?: number;
};

/** Uma linha do relatório da aba "Lotes SIMCAR" (um recibo enviado). */
export type LotesRelatorioRow = {
  filename: string;
  car: string | null;
  propriedade: string | null;
  municipio: string | null;
  pasta: string | null;
  baixados: string[];
  faltantes: string[];
  erro: string | null;
};

export type LotesHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'deleted' | 'queued';
  fase?: string;
  percent: number;
  message?: string;
  error?: string;
  downloadUrl?: string;
  outputFilename?: string;
  outputBytes?: number;
  /** Lotes efetivamente incluídos no ZIP. */
  lotesConcluidos?: number;
  totalLotes?: number;
  relatorio?: LotesRelatorioRow[];
  cancelado?: boolean;
};

export type GeometryHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted' | 'queued';
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  downloadUrl?: string;
  resultRows?: GeometryErrorRow[];
  warnings?: string[];
  summary?: GeometrySummary;
};

export type ReceiptHistoryItem = {
  id: string;
  receiptId: string;
  type: 'simcar' | 'apf';
  filename: string;
  timestamp: string;
  status: 'completed' | 'failed';
  downloadUrl?: string;
  error?: string;
  cpf?: string;
  car?: string;
  sizeBytes?: number;
};
