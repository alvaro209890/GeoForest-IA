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
  reportPdfUrl?: string;
  reportPdfDownloadUrl?: string;
  reportPdfFilename?: string;
  reportPdfGeneratedAt?: string;
  reportPdfVersion?: string;
  reportPdfStatus?: 'generating' | 'ready' | 'failed';
  reportPdfError?: string;
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
