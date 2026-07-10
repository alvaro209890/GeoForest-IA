import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  Send,
  Paperclip,
  MessageSquare,
  Zap,
  Sparkles,
  Menu,
  User,
  ChevronDown,
  Settings,
  Shield,
  FileDown,
  Layers,
  LogOut,
  ImagePlus,
  FileText,
  Trash2,
  X,
  Scissors,
  Upload,
  Download,
  CheckSquare,
  Square,
  Loader2,
  Brain,
  SendHorizontal,
  Eye,
  BookOpen,
  Cpu,
  TreePine,
  Satellite,
  FileSearch,
  ShieldCheck,
  ArrowRight,
  HelpCircle,
  Lightbulb,
  AlertTriangle,
  Clock,
  MousePointerClick,
  CheckCircle2,
  Copy,
  Wallet,
  TrendingDown,
  TrendingUp,
  Activity,
  BarChart3,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Network,
  Database,
  CloudDownload,
  FolderTree,
  HardDrive,
  MapPinned,
  CalendarDays,
  Gauge,
  SlidersHorizontal,
  RefreshCw,
  FileArchive,
  Server,
  Radio,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { fetchSignInMethodsForEmail, onAuthStateChanged, sendPasswordResetEmail, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from '@/lib/localFirestore';
import { auth, db } from '@/lib/firebase';
import { handleLogout, UserProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapView } from '@/components/Map';
import TermsOfUseDialog from '@/components/TermsOfUseDialog';
import ReceiptsHub from '@/components/ReceiptsHub';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import VerticesProximasInfoDialog from '@/components/VerticesProximasInfoDialog';

const FeaturesManual = lazy(() => import('@/components/FeaturesManual'));

type DocumentReference = ReturnType<typeof doc>;

type ChatMessage = {
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


const SIMCAR_MANDATORY_LAYERS = new Set(['AIR', 'ATP']);
const SIMCAR_FIXED_AC_AVN_SATELLITES: Array<{ key: string; label: string; sensor: string; year: number }> = [
  { key: 'landsat5_2006', label: 'Landsat 2006', sensor: 'Landsat 5', year: 2006 },
  { key: 'landsat5_2007', label: 'Landsat 2007', sensor: 'Landsat 5', year: 2007 },
  { key: 'spot_2008', label: 'SPOT 2008', sensor: 'SPOT', year: 2008 },
  { key: 'landsat5_2008', label: 'Landsat 2008', sensor: 'Landsat 5', year: 2008 },
];


const REQUIRED_MODELS: Array<{ id: string; label: string; capabilities: string[]; description: string }> = [
  {
    id: 'meta-llama/llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    capabilities: ['text'],
    description: 'Equilíbrio geral para análise técnica e respostas longas em PT-BR.',
  },
  {
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    label: 'Llama 4 Maverick',
    capabilities: ['text', 'vision'],
    description: 'Melhor para imagem/satélite + interpretação contextual detalhada.',
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout',
    capabilities: ['text', 'vision'],
    description: 'Rápido para triagem visual e respostas curtas com boa precisão.',
  },
  {
    id: 'meta-llama/llama-guard-4-12b',
    label: 'Llama Guard 4 12B',
    capabilities: ['text'],
    description: 'Focado em moderação e segurança; não é o principal para análise.',
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen 3 32B',
    capabilities: ['text'],
    description: 'Bom para raciocínio estruturado, tabelas e extração de dados.',
  },
  {
    id: 'moonshotai/kimi-k2-instruct-0905',
    label: 'Kimi K2 Instruct (0905)',
    capabilities: ['text'],
    description: 'Ótimo para textos longos, síntese e revisão de documentos.',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT OSS 20B',
    capabilities: ['text'],
    description: 'Modelo alternativo rápido para tarefas gerais e QA técnico.',
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT OSS 120B',
    capabilities: ['text'],
    description: 'Modelo grande para análises profundas, correlação de múltiplos anexos e síntese técnica longa.',
  },
];

type Conversation = {
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

const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'seed',
  role: 'ai',
  text: 'Olá! Sou a GeoForest IA. Posso apoiar análises ambientais, processamento de imagens de satélite e interpretação de dados florestais. Como posso ajudar hoje?',
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  meta: { model: 'auto' },
};

type UserSettings = {
  theme: string;
  language: string;
  fontSize: string;
  coordSystem: string;
  unit: string;
  defaultLayer: string;
  exportFormat: string;
  includeMetadata: boolean;
  compressLarge: boolean;
  alertProcessing: boolean;
  alertNewFeatures: boolean;
  alertFires: boolean;
  twoFactorEnabled: boolean;
};

type BillingUsageItem = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
  estimated?: boolean;
};

type BillingResult = {
  chargedBrl: number;
  balanceAfterBrl: number;
  usage: BillingUsageItem[];
};

type BillingMePayload = {
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

type SimcarAnalysisMessage = {
  role: 'ai' | 'user';
  text: string;
  images?: string[];
  thinkingText?: string;
};

type SimcarAnalysisImage = {
  url: string;
  caption: string;
  sourceLabel?: string;
};

type SimcarAcAvnAnalysisMeta = {
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

type SimcarAuasMeta = {
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

type SimcarConversationEntry = {
  role: 'ai' | 'user';
  text: string;
  meta?: Partial<NonNullable<ChatMessage['meta']>>;
};

type SimcarLayerSummary = {
  name: string;
  source: 'property' | 'wfs';
  features: number;
  areaHa?: number;
  warning?: string;
  partial?: boolean;
};

type SimcarClipSummary = {
  propertyAreaHa: number;
  crs: string;
  layersProcessed: number;
  layersWithData: number;
  totalFeaturesClipped: number;
  processingTimeMs: number;
  layers: SimcarLayerSummary[];
  warnings?: string[];
};

type SimcarClipHistoryItem = {
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

type SimcarServerRuntimeState = {
  latestStatus: string;
  latestEndpoint: string;
  hasRunningJob: boolean;
  hasCompletedImport: boolean;
  hasCompletedAnalyze: boolean;
  hasCompletedAuas: boolean;
};

type CbersGeoJsonGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: any;
};

type CbersEstimate = {
  downloadBytes: number;
  downloadMb: number;
  outputBytesEstimated: number;
  outputMbEstimated: number;
  timeSecondsEstimated: number;
  completeAssetSizes: boolean;
  assetSizes: Record<string, number | null>;
};

type CbersScene = {
  id: string;
  collectionId?: string;
  level?: 'L4' | 'L2';
  datetime: string;
  cloudCover: number | null;
  bbox: [number, number, number, number] | null;
  geometry?: CbersGeoJsonGeometry;
  thumbnailUrl?: string;
  assetKeys: string[];
  coveragePercent?: number;
  coversArea?: boolean;
  estimate?: CbersEstimate;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  archiveImageId?: string;
  archiveFilename?: string;
  fallbackFromL2?: boolean;
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
};

type CbersJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

type CbersSceneJobState = {
  itemId: string;
  collectionId?: string;
  level?: 'L4' | 'L2';
  scene?: CbersScene | null;
  status: CbersJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  estimate?: CbersEstimate;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archiveImageId?: string;
  archiveFilename?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
};

type CbersHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: CbersJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  itemId?: string;
  itemIds?: string[];
  mode?: 'single' | 'batch';
  collection?: string;
  areaHa?: number;
  estimate?: CbersEstimate;
  scene?: CbersScene | null;
  scenes?: CbersSceneJobState[];
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archiveImageId?: string;
  archiveFilename?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
  batchZipUrl?: string;
  batchZipRelativePath?: string;
  batchZipFilename?: string;
  batchZipBytes?: number;
};

type LandsatComposition = 'false_color' | 'natural_color';
type LandsatJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

type LandsatScene = {
  id: string;
  source: 'local_wms' | 'usgs_stac';
  collectionId?: string;
  platform?: string;
  sensor?: string;
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  datetime: string;
  cloudCover: number | null;
  composition: LandsatComposition;
  compositionLabel: string;
  bbox: [number, number, number, number] | null;
  geometry?: CbersGeoJsonGeometry;
  thumbnailUrl?: string;
  coveragePercent?: number;
  coversArea?: boolean;
  assetKeys?: string[];
  downloadBytes?: number | null;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  sourcePath?: string;
  outputFilename?: string;
};

type LandsatHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: LandsatJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  sceneId?: string;
  composition?: LandsatComposition;
  scene?: LandsatScene | null;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
};

type VerticesLayer = {
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

type VerticesResultRow = {
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

type VerticesProgress = {
  stage: string;
  percent: number;
  message: string;
  layer?: string;
};

type VerticesHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted';
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

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'Escuro (Floresta)',
  language: 'Português (BR)',
  fontSize: 'Padrão',
  coordSystem: 'SIRGAS 2000 (Brasil)',
  unit: 'Hectares (ha)',
  defaultLayer: 'Satélite (Alta Res.)',
  exportFormat: 'KML / KMZ',
  includeMetadata: true,
  compressLarge: false,
  alertProcessing: true,
  alertNewFeatures: false,
  alertFires: true,
  twoFactorEnabled: true,
};

const SETTINGS_THEME_OPTIONS = ['Escuro (Floresta)', 'Claro (Dia)'] as const;
const SETTINGS_FONT_SIZE_OPTIONS = ['Pequeno', 'Padrão', 'Grande'] as const;

const DEFAULT_PRODUCTION_API_BASE = 'https://geoforest-api.cursar.space';
const CONFIGURED_API_BASE = String(
  import.meta.env.VITE_API_BASE ||
  (typeof window !== 'undefined' && /\.web\.app$/i.test(window.location.hostname) ? DEFAULT_PRODUCTION_API_BASE : '')
).trim().replace(/\/+$/, '');
const apiUrl = (path: string) => {
  if (!path) return CONFIGURED_API_BASE || '';
  if (!CONFIGURED_API_BASE) return path;
  return `${CONFIGURED_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
};
const resolveBackendUrl = (url?: string) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.startsWith('/api/') ? apiUrl(raw) : raw;
};

const sanitizeMessagesForFirestore = (msgs: ChatMessage[]) =>
  msgs.map((m) => {
    const meta = m.meta
      ? Object.fromEntries(Object.entries(m.meta).filter(([, v]) => v !== undefined))
      : undefined;
    const clean = {
      ...m,
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    };
    if (!clean.meta) delete (clean as any).meta;
    return clean;
  });

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const stripUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const clean = stripUndefinedDeep(item);
      if (clean !== undefined) out[key] = clean;
    });
    return out as T;
  }
  return (value === undefined ? undefined : value) as T;
};

const toCloudinaryDownloadUrl = (url?: string) => {
  if (!url) return '';
  if (url.includes('/upload/fl_attachment/')) return url;
  if (url.includes('/upload/')) return url.replace('/upload/', '/upload/fl_attachment/');
  return url;
};

const toFileProxyUrl = (url?: string, name?: string, mode: 'inline' | 'download' = 'inline') => {
  if (!url) return '';
  const safeName = (name || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return apiUrl(
    `/api/file-proxy?mode=${mode}&url=${encodeURIComponent(url)}&name=${encodeURIComponent(safeName)}`
  );
};

const resolveBackendDownloadUrl = (downloadUrl?: string, persistentUrl?: string) => {
  const persistent = resolveBackendUrl(persistentUrl);
  if (persistent) return persistent;
  return resolveBackendUrl(downloadUrl);
};





const renderInlineRichText = (text: string) => {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`b-${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={`c-${idx++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`i-${idx++}`}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(<span key={`u-${idx++}`}>{token}</span>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor)}</span>);
  }

  return parts;
};

const isMarkdownTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());

const splitMarkdownTableRow = (line: string) => {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|')) return [];
  const noEdgePipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = noEdgePipes.split('|').map((cell) => cell.trim());
  return parts.filter((cell, idx) => cell.length > 0 || idx < parts.length - 1);
};

const renderRichText = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      nodes.push(<div key={`chat-gap-${key++}`} className="chat-gap" />);
      i += 1;
      continue;
    }

    const tableHeader = splitMarkdownTableRow(rawLine);
    const nextLine = lines[i + 1] || '';
    if (tableHeader.length >= 2 && isMarkdownTableSeparator(nextLine)) {
      const bodyRows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) break;
        if (isMarkdownTableSeparator(rowLine)) {
          cursor += 1;
          continue;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) break;
        bodyRows.push(cells);
        cursor += 1;
      }
      const cols = Math.max(tableHeader.length, ...bodyRows.map((r) => r.length));
      const normalizedHeader = Array.from({ length: cols }, (_, idx) => tableHeader[idx] || '');
      const normalizedBody = bodyRows.map((row) => Array.from({ length: cols }, (_, idx) => row[idx] || ''));
      nodes.push(
        <div key={`chat-table-wrap-${key++}`} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {normalizedHeader.map((cell, idx) => (
                  <th key={`chat-th-${idx}`}>{renderInlineRichText(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedBody.map((row, rowIdx) => (
                <tr key={`chat-tr-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td key={`chat-td-${rowIdx}-${cellIdx}`}>{renderInlineRichText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = cursor;
      continue;
    }

    const title = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (title) {
      nodes.push(
        <p key={`chat-title-${key++}`} className="chat-p font-semibold text-slate-100">
          {renderInlineRichText(title[2])}
        </p>
      );
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div key={`chat-ol-${key++}`} className="pl-2">
          <span className="mr-2 text-emerald-300">{numbered[1]}.</span>
          {renderInlineRichText(numbered[2])}
        </div>
      );
      i += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      nodes.push(
        <div key={`chat-ul-${key++}`} className="pl-2">
          <span className="mr-2 text-emerald-300">•</span>
          {renderInlineRichText(bulletMatch[1])}
        </div>
      );
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      nodes.push(
        <div key={`chat-quote-${key++}`} className="border-l-2 border-emerald-500/40 pl-3 text-slate-300/95">
          {renderInlineRichText(quote[1])}
        </div>
      );
      i += 1;
      continue;
    }

    nodes.push(
      <p key={`chat-p-${key++}`} className="chat-p">
        {renderInlineRichText(rawLine)}
      </p>
    );
    i += 1;
  }

  return nodes;
};

const renderAnalysisRichText = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push(<div key={`analysis-gap-${key++}`} className="analysis-gap" />);
      i += 1;
      continue;
    }

    const tableHeader = splitMarkdownTableRow(line);
    const nextLine = lines[i + 1] || '';
    if (tableHeader.length >= 2 && isMarkdownTableSeparator(nextLine)) {
      const bodyRows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) break;
        if (isMarkdownTableSeparator(rowLine)) {
          cursor += 1;
          continue;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) break;
        bodyRows.push(cells);
        cursor += 1;
      }
      const cols = Math.max(tableHeader.length, ...bodyRows.map((r) => r.length));
      const normalizedHeader = Array.from({ length: cols }, (_, idx) => tableHeader[idx] || '');
      const normalizedBody = bodyRows.map((row) => Array.from({ length: cols }, (_, idx) => row[idx] || ''));
      nodes.push(
        <div key={`analysis-table-wrap-${key++}`} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {normalizedHeader.map((cell, idx) => (
                  <th key={`analysis-th-${idx}`}>{renderInlineRichText(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedBody.map((row, rowIdx) => (
                <tr key={`analysis-tr-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td key={`analysis-td-${rowIdx}-${cellIdx}`}>{renderInlineRichText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = cursor;
      continue;
    }

    const divider = trimmed.match(/^[-_*]{3,}$/);
    if (divider) {
      nodes.push(<div key={`analysis-divider-${key++}`} className="analysis-divider" />);
      i += 1;
      continue;
    }

    const title = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (title) {
      const level = title[1].length;
      const klass = level === 1 ? 'analysis-h1' : level === 2 ? 'analysis-h2' : 'analysis-h3';
      nodes.push(
        <div key={`analysis-title-${key++}`} className={klass}>
          {renderInlineRichText(title[2])}
        </div>
      );
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div key={`analysis-ol-${key++}`} className="analysis-item">
          <span className="analysis-marker">{numbered[1]}.</span>
          <span className="analysis-content">{renderInlineRichText(numbered[2])}</span>
        </div>
      );
      i += 1;
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <div key={`analysis-ul-${key++}`} className="analysis-item">
          <span className="analysis-marker">•</span>
          <span className="analysis-content">{renderInlineRichText(bullet[1])}</span>
        </div>
      );
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      nodes.push(
        <div key={`analysis-quote-${key++}`} className="analysis-quote">
          {renderInlineRichText(quote[1])}
        </div>
      );
      i += 1;
      continue;
    }

    nodes.push(
      <p key={`analysis-p-${key++}`} className="analysis-p">
        {renderInlineRichText(line)}
      </p>
    );
    i += 1;
  }

  return nodes;
};

const normalizeImageCaption = (rawCaption: string): string => {
  const input = String(rawCaption || '').trim();
  if (!input) return 'Imagem';
  const suspicious = /Ã|Â|â€”|â€“|â€˜|â€™|â€œ|â€|â€¦/.test(input);
  if (!suspicious) return input;
  try {
    const bytes = Uint8Array.from(Array.from(input).map((ch) => ch.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8').decode(bytes).trim();
    if (decoded && !/Ã|Â|â€”|â€“|â€˜|â€™|â€œ|â€|â€¦/.test(decoded)) {
      return decoded;
    }
  } catch {
    // fallback below
  }
  return input
    .replace(/â€”/g, '—')
    .replace(/â€“/g, '–')
    .replace(/â€˜/g, '‘')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€¦/g, '…')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã£/g, 'ã')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã‡/g, 'Ç')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeBackendText = (rawText: string): string => {
  const normalized = normalizeImageCaption(String(rawText || ''));
  return normalized || String(rawText || '');
};

const removeRoboticAuasLines = (rawText: string): string => {
  const text = String(rawText || '');
  return text
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^[-*•]?\s*STATUS_FINAL\s*=/i.test(l)) return false;
      if (/^[-*•]?\s*ANO_PROVAVEL_INICIO_DESMATE\s*=/i.test(l)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const buildIntegratedVectorizedReport = (acAvnText: string, auasText: string): string => {
  const acText = String(acAvnText || '').trim();
  const auasClean = removeRoboticAuasLines(auasText);
  return [
    '## Analise Integrada SIMCAR',
    '',
    '### Validacao AC e AVN',
    acText || 'Sem dados consolidados de AC/AVN.',
    '',
    '### Validacao AUAS',
    auasClean || 'Sem dados consolidados de AUAS.',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const formatSimcarAuasStatus = (status?: SimcarAuasMeta['finalStatus']) => {
  if (status === 'AUAS_VALIDA') return { label: 'AUAS válida', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' };
  if (status === 'AUAS_INVALIDA') return { label: 'AUAS inválida', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (status === 'AUAS_PARCIAL') return { label: 'Revisão parcial', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
  return { label: 'Sem status', className: 'border-white/10 bg-white/5 text-slate-300' };
};

const formatSimcarAcAvnVerdict = (verdict?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null) => {
  if (verdict === 'SIM') return { label: 'Sim', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (verdict === 'NAO') return { label: 'Não', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  return { label: 'Inconclusivo', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
};

const formatSimcarAcAvnConfidence = (confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'INCONCLUSIVO' | null) => {
  if (confidence === 'ALTA') return { label: 'Alta', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  if (confidence === 'MEDIA') return { label: 'Média', className: 'border-blue-500/20 bg-blue-500/10 text-blue-200' };
  if (confidence === 'BAIXA') return { label: 'Baixa', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
  return { label: 'Inconclusiva', className: 'border-slate-500/20 bg-slate-500/10 text-slate-300' };
};

const formatSimcarAuasVerdict = (verdict: NonNullable<SimcarAuasMeta['yearVerdicts']>[number]['verdict']) => {
  if (verdict === 'CONSOLIDADO') return 'Consolidado';
  if (verdict === 'VEGETACAO_NATIVA_PRESENTE') return 'Vegetação nativa';
  if (verdict === 'DESMATAMENTO_RECENTE') return 'Supressão pós-2008';
  return 'Inconclusivo';
};

const simcarAuasVerdictClass = (verdict: NonNullable<SimcarAuasMeta['yearVerdicts']>[number]['verdict']) => {
  if (verdict === 'CONSOLIDADO') return 'border-blue-500/20 bg-blue-500/10 text-blue-200';
  if (verdict === 'VEGETACAO_NATIVA_PRESENTE') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  if (verdict === 'DESMATAMENTO_RECENTE') return 'border-red-500/20 bg-red-500/10 text-red-200';
  return 'border-slate-500/20 bg-slate-500/10 text-slate-300';
};

const cbersGeometryCoordinates = (geometry?: CbersGeoJsonGeometry | null): Array<Array<[number, number]>> => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as Array<Array<[number, number]>>;
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as Array<Array<Array<[number, number]>>>).flat();
  }
  return [];
};

const cbersGeometryCenter = (geometry?: CbersGeoJsonGeometry | null): google.maps.LatLngLiteral => {
  const rings = cbersGeometryCoordinates(geometry);
  const points = rings.flat();
  if (!points.length) return { lat: -12.5, lng: -55.5 };
  const lng = points.reduce((acc, point) => acc + Number(point[0] || 0), 0) / points.length;
  const lat = points.reduce((acc, point) => acc + Number(point[1] || 0), 0) / points.length;
  return { lat, lng };
};

const cbersOutputFilename = (itemId?: string | null) => {
  const stem = String(itemId || 'CBERS_4A_WPM')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.(tif|tiff)$/i, '')
    .replace(/_C?342(?:_PAN)?$/i, '')
    .replace(/_PAN$/i, '') || 'CBERS_4A_WPM';
  return `${stem}_C342_PAN.TIF`;
};

const cbersDownloadFilename = (item?: Pick<CbersHistoryItem, 'outputFilename' | 'scene' | 'itemId' | 'jobId'> | CbersSceneJobState | null) => {
  if (!item) return cbersOutputFilename(null);
  const explicit = 'outputFilename' in item ? item.outputFilename : undefined;
  return explicit || cbersOutputFilename(item.scene?.id || item.itemId || ('jobId' in item ? item.jobId : null));
};

const cbersArchiveZipFilename = (item?: Pick<CbersHistoryItem, 'outputFilename' | 'archiveFilename' | 'scene' | 'itemId' | 'jobId'> | CbersSceneJobState | null) => {
  if (!item) return 'CBERS_4A_WPM.zip';
  const explicit = ('archiveFilename' in item ? item.archiveFilename : undefined) || item.scene?.archiveFilename || cbersDownloadFilename(item);
  const stem = String(explicit || cbersOutputFilename(item.scene?.id || item.itemId || ('jobId' in item ? item.jobId : null)))
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_') || 'CBERS_4A_WPM';
  return `${stem}.zip`;
};

const cbersArchiveZipUrl = (item?: Pick<CbersHistoryItem, 'archiveImageId' | 'scene' | 'itemId' | 'wmsDownloadUrl' | 'outputUrl' | 'alignmentStatus'> | CbersSceneJobState | null) => {
  if (!item) return '';
  if ('outputUrl' in item && item.outputUrl && item.alignmentStatus === 'failed_private') return item.outputUrl;
  if ('wmsDownloadUrl' in item && item.wmsDownloadUrl) return item.wmsDownloadUrl;
  if (item.scene?.wmsDownloadUrl) return item.scene.wmsDownloadUrl;
  if (item.scene?.alignmentStatus === 'failed_private') return '';
  const archiveImageId = ('archiveImageId' in item ? item.archiveImageId : undefined) || item.scene?.archiveImageId;
  if (archiveImageId) return `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(archiveImageId)}`;
  const itemId = item.scene?.id || item.itemId;
  if (itemId) return `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(itemId)}`;
  return '';
};

const cbersBatchZipFilename = (jobId?: string | null) => {
  const suffix = String(jobId || '').trim().slice(0, 8);
  return `CBERS_4A_WPM_LOTE${suffix ? `_${suffix}` : ''}_C342_PAN.zip`;
};

const landsatArchiveZipFilename = (item?: LandsatHistoryItem | LandsatScene | null) => {
  const anyItem = item as any;
  const scene = anyItem?.source ? anyItem as LandsatScene : anyItem?.scene as LandsatScene | undefined;
  const explicit = anyItem?.outputFilename || scene?.outputFilename || anyItem?.wmsStoreName || scene?.wmsStoreName || anyItem?.wmsLayerName || scene?.wmsLayerName || scene?.id || anyItem?.sceneId || anyItem?.jobId;
  const stem = String(explicit || 'LANDSAT')
    .replace(/^.*:/, '')
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_') || 'LANDSAT';
  return `${stem}.zip`;
};

const landsatArchiveZipUrl = (item?: LandsatHistoryItem | LandsatScene | null) => {
  if (!item) return '';
  const anyItem = item as any;
  const scene = anyItem?.source ? anyItem as LandsatScene : anyItem?.scene as LandsatScene | undefined;
  const direct = anyItem?.wmsDownloadUrl || scene?.wmsDownloadUrl;
  if (direct) return String(direct);
  const layerName = anyItem?.wmsLayerName || scene?.wmsLayerName || scene?.wmsStoreName || anyItem?.wmsStoreName;
  if (!layerName) return '';
  return `/api/landsat/wms-download?layerName=${encodeURIComponent(String(layerName))}`;
};

function CbersMapPreview({
  propertyGeometry,
  sceneGeometry,
}: {
  propertyGeometry?: CbersGeoJsonGeometry | null;
  sceneGeometry?: CbersGeoJsonGeometry | null;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const overlaysRef = useRef<google.maps.Polygon[]>([]);
  const draw = useCallback((map: google.maps.Map) => {
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    const addGeometry = (geometry: CbersGeoJsonGeometry | null | undefined, color: string, fillOpacity: number) => {
      for (const ring of cbersGeometryCoordinates(geometry)) {
        const path = ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
        if (path.length < 3) continue;
        path.forEach((point) => bounds.extend(point));
        const polygon = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity,
          map,
        });
        overlaysRef.current.push(polygon);
      }
    };
    addGeometry(sceneGeometry, '#f59e0b', 0.08);
    addGeometry(propertyGeometry, '#22d3ee', 0.22);
    if (!bounds.isEmpty()) map.fitBounds(bounds, 36);
  }, [propertyGeometry, sceneGeometry]);

  if (mapFailed) {
    const rings = [
      ...cbersGeometryCoordinates(sceneGeometry).map((ring) => ({ ring, color: '#f59e0b', fill: 'rgba(245,158,11,0.08)' })),
      ...cbersGeometryCoordinates(propertyGeometry).map((ring) => ({ ring, color: '#22d3ee', fill: 'rgba(34,211,238,0.22)' })),
    ];
    const points = rings.flatMap((item) => item.ring);
    if (!points.length) {
      return (
        <div className="flex h-[260px] items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-slate-500">
          Mapa indisponível para esta geometria.
        </div>
      );
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(0.000001, maxX - minX);
    const height = Math.max(0.000001, maxY - minY);
    return (
      <div className="h-[260px] overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {rings.map((item, idx) => {
            const pointsAttr = item.ring
              .map(([lng, lat]) => `${((lng - minX) / width) * 90 + 5},${95 - ((lat - minY) / height) * 90}`)
              .join(' ');
            return (
              <polygon
                key={`${item.color}-${idx}`}
                points={pointsAttr}
                fill={item.fill}
                stroke={item.color}
                strokeWidth="1.2"
              />
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <MapView
        className="h-[260px] w-full"
        initialCenter={cbersGeometryCenter(propertyGeometry || sceneGeometry)}
        initialZoom={10}
        onMapReady={draw}
        onLoadError={() => setMapFailed(true)}
      />
    </div>
  );
}

export default function Dashboard() {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<'simcar-clip' | 'simcar-receipts' | 'cbers-wpm' | 'landsat' | 'vertices-proximas' | 'features' | 'settings'>('simcar-clip');
  const [manualSection, setManualSection] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [, setLocation] = useLocation();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [models] = useState<Array<{ id: string; label: string; capabilities: string[]; description: string }>>(REQUIRED_MODELS);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  // ─── SIMCAR Clip State ───
  const [simcarClipFile, setSimcarClipFile] = useState<File | null>(null);
  const [simcarClipMode, setSimcarClipMode] = useState<'auto-clip' | 'vectorized-analysis'>('auto-clip');
  const [simcarClipLayers, setSimcarClipLayers] = useState<Array<{ name: string; category: string; selected: boolean }>>([]);
  const [simcarClipLayersLoading, setSimcarClipLayersLoading] = useState(false);
  const [simcarClipLayersError, setSimcarClipLayersError] = useState<string | null>(null);
  const [simcarClipProcessing, setSimcarClipProcessing] = useState(false);
  const [simcarClipCanceling, setSimcarClipCanceling] = useState(false);
  const [simcarVectorizedRunning, setSimcarVectorizedRunning] = useState(false);
  const [simcarVectorizedStatus, setSimcarVectorizedStatus] = useState<{
    stage: 'importing' | 'acavn' | 'auas' | 'done' | 'error';
    message: string;
  } | null>(null);
  const [simcarClipProgress, setSimcarClipProgress] = useState<{ current: number; total: number; layer: string; status: string } | null>(null);
  const [simcarClipDownloadUrl, setSimcarClipDownloadUrl] = useState<string | null>(null);
  const [simcarClipSummary, setSimcarClipSummary] = useState<SimcarClipSummary | null>(null);
  const [simcarClipError, setSimcarClipError] = useState<string | null>(null);
  const simcarClipAbortRef = useRef<AbortController | null>(null);
  const simcarClipProcessJobIdRef = useRef<string | null>(null);
  const simcarClipCancelRequestedRef = useRef(false);
  const simcarClipProgressFlushTimerRef = useRef<number | null>(null);
  const simcarFileInputRef = useRef<HTMLInputElement | null>(null);
  const simcarClipProgressPendingRef = useRef<{ current: number; total: number; layer: string; status: string } | null>(
    null
  );
  const [simcarAirId, setSimcarAirId] = useState('');
  const [simcarAirIdStripped, setSimcarAirIdStripped] = useState(false);
  const [simcarShowCancel, setSimcarShowCancel] = useState(false);
  const simcarCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [simcarCarNumber, setSimcarCarNumber] = useState('');
  const [simcarSigefParcelCode, setSimcarSigefParcelCode] = useState('');
  const [simcarClipJobId, setSimcarClipJobId] = useState<string | null>(null);

  // ─── SIMCAR AI Analysis State ───
  const [simcarAnalysisProcessing, setSimcarAnalysisProcessing] = useState(false);
  const [simcarAnalysisProgress, setSimcarAnalysisProgress] = useState<{ step: string; percent: number; message: string } | null>(null);
  const [simcarAgentLog, setSimcarAgentLog] = useState<Array<{ label: string; done: boolean; kind: 'step' | 'thinking' }>>([]);
  const [simcarAnalysisImages, setSimcarAnalysisImages] = useState<SimcarAnalysisImage[]>([]);
  const [simcarAnalysisMessages, setSimcarAnalysisMessages] = useState<SimcarAnalysisMessage[]>([]);
  const [simcarThinkingText, setSimcarThinkingText] = useState('');
  const [simcarThinkingHidden, setSimcarThinkingHidden] = useState(false);
  const [simcarAnalysisInput, setSimcarAnalysisInput] = useState('');
  const [simcarAnalysisSending, setSimcarAnalysisSending] = useState(false);
  const [simcarLiveThinkingText, setSimcarLiveThinkingText] = useState('');
  const [simcarLiveAnswerText, setSimcarLiveAnswerText] = useState('');
  const simcarAnalysisChatRef = useRef<HTMLDivElement | null>(null);
  const simcarThinkingPanelRef = useRef<HTMLDivElement | null>(null);
  const simcarLiveAnswerPanelRef = useRef<HTMLDivElement | null>(null);
  const simcarAgentLogEndRef = useRef<HTMLDivElement | null>(null);
  const simcarAnalysisAbortRef = useRef<AbortController | null>(null);
  const simcarAnalysisProcessJobIdRef = useRef<string | null>(null);
  const [simcarAnalysisStartTime, setSimcarAnalysisStartTime] = useState<number | null>(null);
  const [simcarElapsed, setSimcarElapsed] = useState(0);

  // ─── SIMCAR AUAS Analysis State ───
  const [simcarAuasProcessing, setSimcarAuasProcessing] = useState(false);
  const [simcarAuasProgress, setSimcarAuasProgress] = useState<{ step: string; percent: number; message: string } | null>(null);
  const [simcarAuasImages, setSimcarAuasImages] = useState<SimcarAnalysisImage[]>([]);
  const [simcarImagePreview, setSimcarImagePreview] = useState<SimcarAnalysisImage | null>(null);
  const [simcarAuasMessages, setSimcarAuasMessages] = useState<SimcarAnalysisMessage[]>([]);
  const [simcarAuasAgentLog, setSimcarAuasAgentLog] = useState<Array<{ label: string; done: boolean; kind: 'step' | 'thinking' }>>([]);
  const simcarAuasAbortRef = useRef<AbortController | null>(null);
  const simcarAuasProcessJobIdRef = useRef<string | null>(null);
  const [simcarResultImagePanelsOpen, setSimcarResultImagePanelsOpen] = useState<{ acAvn: boolean; auas: boolean }>({
    acAvn: false,
    auas: false,
  });

  // ─── CBERS-4A/WPM Tab State ───
  const [cbersFile, setCbersFile] = useState<File | null>(null);
  const [cbersPropertyZipB64, setCbersPropertyZipB64] = useState<string | null>(null);
  const [cbersSearching, setCbersSearching] = useState(false);
  const [cbersScenes, setCbersScenes] = useState<CbersScene[]>([]);
  const [cbersSelectedSceneId, setCbersSelectedSceneId] = useState<string | null>(null);
  const [cbersSelectedSceneIds, setCbersSelectedSceneIds] = useState<string[]>([]);
  const [cbersPreviewScene, setCbersPreviewScene] = useState<CbersScene | null>(null);
  const [cbersOrbit, setCbersOrbit] = useState('');
  const [cbersPoint, setCbersPoint] = useState('');
  const [cbersCarNumber, setCbersCarNumber] = useState('');
  const [cbersDateStart, setCbersDateStart] = useState('');
  const [cbersDateEnd, setCbersDateEnd] = useState('');
  const [cbersMaxCloudCover, setCbersMaxCloudCover] = useState('');
  const [, setCbersLevelFilter] = useState<'L4'>('L4');
  const [cbersSortOrder, setCbersSortOrder] = useState<'desc' | 'asc'>('desc');
  const [cbersAreaHa, setCbersAreaHa] = useState<number | null>(null);
  const [cbersPropertyGeometry, setCbersPropertyGeometry] = useState<CbersGeoJsonGeometry | null>(null);
  const [cbersEstimating, setCbersEstimating] = useState(false);
  const [cbersProcessing, setCbersProcessing] = useState(false);
  const [cbersHistory, setCbersHistory] = useState<CbersHistoryItem[]>([]);
  const [cbersJobId, setCbersJobId] = useState<string | null>(null);
  const [cbersProgress, setCbersProgress] = useState<{ stage: string; percent: number; message: string } | null>(null);
  const [cbersError, setCbersError] = useState<string | null>(null);
  const [cbersWmsDownloadingId, setCbersWmsDownloadingId] = useState<string | null>(null);
  const cbersFileInputRef = useRef<HTMLInputElement | null>(null);
  const cbersEventsAbortRef = useRef<AbortController | null>(null);

  // ─── Landsat Tab State ───
  const [landsatFile, setLandsatFile] = useState<File | null>(null);
  const [landsatPropertyZipB64, setLandsatPropertyZipB64] = useState<string | null>(null);
  const [landsatSearching, setLandsatSearching] = useState(false);
  const [landsatScenes, setLandsatScenes] = useState<LandsatScene[]>([]);
  const [landsatSelectedSceneId, setLandsatSelectedSceneId] = useState<string | null>(null);
  const [landsatPreviewScene, setLandsatPreviewScene] = useState<LandsatScene | null>(null);
  const [landsatOrbit, setLandsatOrbit] = useState('');
  const [landsatPoint, setLandsatPoint] = useState('');
  const [landsatCarNumber, setLandsatCarNumber] = useState('');
  const [landsatDateStart, setLandsatDateStart] = useState('');
  const [landsatDateEnd, setLandsatDateEnd] = useState('');
  const [landsatMaxCloudCover, setLandsatMaxCloudCover] = useState('30');
  const [landsatComposition, setLandsatComposition] = useState<LandsatComposition>('false_color');
  const [landsatAreaHa, setLandsatAreaHa] = useState<number | null>(null);
  const [landsatPropertyGeometry, setLandsatPropertyGeometry] = useState<CbersGeoJsonGeometry | null>(null);
  const [landsatProcessing, setLandsatProcessing] = useState(false);
  const [landsatHistory, setLandsatHistory] = useState<LandsatHistoryItem[]>([]);
  const [landsatJobId, setLandsatJobId] = useState<string | null>(null);
  const [landsatProgress, setLandsatProgress] = useState<{ stage: string; percent: number; message: string } | null>(null);
  const [landsatError, setLandsatError] = useState<string | null>(null);
  const [landsatWmsDownloadingId, setLandsatWmsDownloadingId] = useState<string | null>(null);
  const landsatFileInputRef = useRef<HTMLInputElement | null>(null);
  const landsatEventsAbortRef = useRef<AbortController | null>(null);

  // ─── Vértices Próximas State ───
  const [verticesFile, setVerticesFile] = useState<File | null>(null);
  const [verticesUploadId, setVerticesUploadId] = useState<string | null>(null);
  const [verticesLayers, setVerticesLayers] = useState<VerticesLayer[]>([]);
  const [verticesUploading, setVerticesUploading] = useState(false);
  const [verticesProcessing, setVerticesProcessing] = useState(false);
  const [verticesJobId, setVerticesJobId] = useState<string | null>(null);
  const [verticesProgress, setVerticesProgress] = useState<VerticesProgress | null>(null);
  const [verticesWarnings, setVerticesWarnings] = useState<string[]>([]);
  const [verticesError, setVerticesError] = useState<string | null>(null);
  const [verticesRows, setVerticesRows] = useState<VerticesResultRow[]>([]);
  const [verticesDownloadUrl, setVerticesDownloadUrl] = useState<string | null>(null);
  const [verticesHistory, setVerticesHistory] = useState<VerticesHistoryItem[]>([]);
  const [verticesIncludeOriginals, setVerticesIncludeOriginals] = useState(true);
  const [verticesIncludeReport, setVerticesIncludeReport] = useState(true);
  const [verticesIncludeCsv, setVerticesIncludeCsv] = useState(true);
  const [verticesPreserveCrs, setVerticesPreserveCrs] = useState(true);
  const [verticesMetricTemporary, setVerticesMetricTemporary] = useState(true);
  const verticesFileInputRef = useRef<HTMLInputElement | null>(null);
  const verticesEventsAbortRef = useRef<AbortController | null>(null);
  const verticesConversationSavedRef = useRef<Set<string>>(new Set());

  const resetVerticesDraft = useCallback(() => {
    verticesEventsAbortRef.current?.abort();
    verticesEventsAbortRef.current = null;
    setVerticesFile(null);
    setVerticesUploadId(null);
    setVerticesLayers([]);
    setVerticesUploading(false);
    setVerticesProcessing(false);
    setVerticesJobId(null);
    setVerticesProgress(null);
    setVerticesWarnings([]);
    setVerticesError(null);
    setVerticesRows([]);
    setVerticesDownloadUrl(null);
    setVerticesIncludeOriginals(true);
    setVerticesIncludeReport(true);
    setVerticesIncludeCsv(true);
    setVerticesPreserveCrs(true);
    setVerticesMetricTemporary(true);
    if (verticesFileInputRef.current) verticesFileInputRef.current.value = '';
  }, []);

  const resetCbersDraft = useCallback(() => {
    cbersEventsAbortRef.current?.abort();
    cbersEventsAbortRef.current = null;
    setCbersFile(null);
    setCbersPropertyZipB64(null);
    setCbersSearching(false);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    setCbersSelectedSceneIds([]);
    setCbersPreviewScene(null);
    setCbersOrbit('');
    setCbersPoint('');
    setCbersCarNumber('');
    setCbersDateStart('');
    setCbersDateEnd('');
    setCbersMaxCloudCover('');
    setCbersLevelFilter('L4');
    setCbersSortOrder('desc');
    setCbersAreaHa(null);
    setCbersPropertyGeometry(null);
    setCbersEstimating(false);
    setCbersProcessing(false);
    setCbersJobId(null);
    setCbersProgress(null);
    setCbersError(null);
    if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
  }, []);

  const resetLandsatDraft = useCallback(() => {
    landsatEventsAbortRef.current?.abort();
    landsatEventsAbortRef.current = null;
    setLandsatFile(null);
    setLandsatPropertyZipB64(null);
    setLandsatSearching(false);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    setLandsatPreviewScene(null);
    setLandsatOrbit('');
    setLandsatPoint('');
    setLandsatCarNumber('');
    setLandsatDateStart('');
    setLandsatDateEnd('');
    setLandsatMaxCloudCover('30');
    setLandsatComposition('false_color');
    setLandsatAreaHa(null);
    setLandsatPropertyGeometry(null);
    setLandsatProcessing(false);
    setLandsatJobId(null);
    setLandsatProgress(null);
    setLandsatError(null);
    setLandsatWmsDownloadingId(null);
    if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
  }, []);

  // ─── SIMCAR Agent Log: elapsed timer ───
  useEffect(() => {
    if (simcarAnalysisProcessing) {
      setSimcarAnalysisStartTime(Date.now());
      setSimcarElapsed(0);
      const iv = setInterval(() => setSimcarElapsed((prev) => prev + 1), 1000);
      return () => clearInterval(iv);
    }
    setSimcarAnalysisStartTime(null);
  }, [simcarAnalysisProcessing]);

  // ─── SIMCAR Agent Log: auto-scroll to active step ───
  useEffect(() => {
    simcarAgentLogEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [simcarAgentLog]);

  // ─── SIMCAR Agent Log: group steps into phases ───
  type AgentPhase = { id: string; label: string; icon: 'satellite' | 'upload' | 'brain' | 'zap'; steps: typeof simcarAgentLog; allDone: boolean };
  const simcarGroupedPhases = useMemo((): AgentPhase[] => {
    const classify = (label: string): AgentPhase['icon'] => {
      const l = label.toLowerCase();
      if (/baixando|imagem|renderizando|gerando|geração|indisponível/i.test(l)) return 'satellite';
      if (/upload|cloudinary|salvando/i.test(l)) return 'upload';
      if (/ia\s|preparando.*ia|sintetizando|analis|fallback|análise/i.test(l)) return 'brain';
      return 'zap';
    };
    const phaseOrder: AgentPhase['icon'][] = ['zap', 'satellite', 'upload', 'brain'];
    const phaseLabels: Record<AgentPhase['icon'], string> = {
      zap: 'Inicialização',
      satellite: 'Geração de Imagens',
      upload: 'Upload ao Servidor',
      brain: 'Análise por IA',
    };
    const map = new Map<AgentPhase['icon'], typeof simcarAgentLog>();
    for (const step of simcarAgentLog) {
      if (step.kind === 'thinking') continue; // thinking steps shown separately
      const phase = classify(step.label);
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase)!.push(step);
    }
    return phaseOrder
      .filter((id) => map.has(id))
      .map((id) => ({
        id,
        label: phaseLabels[id],
        icon: id,
        steps: map.get(id)!,
        allDone: map.get(id)!.every((s) => s.done),
      }));
  }, [simcarAgentLog]);

  // ─── SIMCAR Clip History (for sidebar cards) ───
  const [simcarClipHistory, setSimcarClipHistory] = useState<SimcarClipHistoryItem[]>([]);
  const [simcarServerRuntimeState, setSimcarServerRuntimeState] = useState<SimcarServerRuntimeState | null>(null);
  const simcarVectorizedResumeInFlightRef = useRef<string | null>(null);
  const activeSimcarClip = useMemo(
    () => (simcarClipJobId ? simcarClipHistory.find((clip) => clip.jobId === simcarClipJobId) : undefined),
    [simcarClipHistory, simcarClipJobId]
  );
  const simcarLockedMode = activeSimcarClip?.sourceMode;
  const isSimcarModeLocked = Boolean(simcarLockedMode);

  useEffect(() => {
    if (!simcarLockedMode) return;
    if (simcarClipMode !== simcarLockedMode) {
      setSimcarClipMode(simcarLockedMode);
    }
  }, [simcarClipMode, simcarLockedMode]);

  const loadSimcarClipLayers = useCallback(() => {
    setSimcarClipLayersLoading(true);
    setSimcarClipLayersError(null);
    fetch(apiUrl('/api/simcar/layers'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        if (!Array.isArray(data?.layers)) throw new Error('Resposta inválida do servidor');
        setSimcarClipLayers(data.layers.map((l: any) => ({ name: l.name, category: l.category, selected: true })));
      })
      .catch((err: any) => {
        setSimcarClipLayersError(err?.message || 'Falha ao carregar a lista de camadas do servidor.');
      })
      .finally(() => setSimcarClipLayersLoading(false));
  }, []);

  useEffect(() => {
    loadSimcarClipLayers();
  }, [loadSimcarClipLayers]);

  // ─── SIMCAR Satellite Selection ───
  const simcarFixedSatelliteKeys = useMemo(
    () => SIMCAR_FIXED_AC_AVN_SATELLITES.map((sat) => sat.key),
    []
  );
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatProcessJobIdRef = useRef<string | null>(null);
  const runningProcessingJobsCountRef = useRef(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastPromptText, setLastPromptText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const messagesRef = useRef<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState('');
  const typingTargetRef = useRef('');
  const typingDisplayedRef = useRef('');
  const typingAnimationFrameRef = useRef<number | null>(null);
  const [liveThinkingText, setLiveThinkingText] = useState('');
  const [liveThinkingTarget, setLiveThinkingTarget] = useState('');
  const thinkingTypingTimerRef = useRef<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [processingHintIndex, setProcessingHintIndex] = useState(0);
  const processingTimerRef = useRef<number | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsActionLoading, setSettingsActionLoading] = useState<string | null>(null);
  const [settingsHealthCheck, setSettingsHealthCheck] = useState<{
    ok: boolean;
    summary: string;
    checkedAtIso: string;
  } | null>(null);
  const [billingMe, setBillingMe] = useState<BillingMePayload | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingPricing, setBillingPricing] = useState<any | null>(null);
  const [billingLedger, setBillingLedger] = useState<any[]>([]);
  const [billingTopupOpen, setBillingTopupOpen] = useState(false);
  const [billingTopupAmount, setBillingTopupAmount] = useState('50');
  const [billingTopupLoading, setBillingTopupLoading] = useState(false);
  const [simcarUnifiedProgressDisplay, setSimcarUnifiedProgressDisplay] = useState(0);

  const [conversationsRef, setConversationsRef] = useState<{
    collection: ReturnType<typeof collection>;
  } | null>(null);
  const [simcarClipsRef, setSimcarClipsRef] = useState<ReturnType<typeof collection> | null>(null);
  const [verticesJobsRef, setVerticesJobsRef] = useState<ReturnType<typeof collection> | null>(null);
  const [activeConversationRef, setActiveConversationRef] = useState<DocumentReference | null>(null);
  const [settingsRef, setSettingsRef] = useState<DocumentReference | null>(null);
  const settingsImportInputRef = useRef<HTMLInputElement | null>(null);
  const selectedSimcarClipLayerNames = useMemo(
    () => simcarClipLayers.filter((layer) => layer.selected).map((layer) => layer.name),
    [simcarClipLayers]
  );
  const selectedSimcarClipLayerCount = selectedSimcarClipLayerNames.length;
  const simcarVectorizedServerZipReady = useMemo(() => {
    if (simcarClipMode !== 'vectorized-analysis') return false;
    if (simcarClipFile) return false;
    if (!activeSimcarClip || activeSimcarClip.jobId !== simcarClipJobId) return false;
    const hasPersistedZip = Boolean(
      activeSimcarClip.outputZipUrl ||
      activeSimcarClip.downloadUrl ||
      activeSimcarClip.contextUrl
    );
    return hasPersistedZip;
  }, [activeSimcarClip, simcarClipFile, simcarClipJobId, simcarClipMode]);
  const canRunVectorizedAnalysis = Boolean(simcarClipFile || simcarVectorizedServerZipReady);
  const simcarUnifiedVectorizedProgress = useMemo(() => {
    if (!simcarVectorizedStatus) return null;
    const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
    const acPercent = clamp(simcarAnalysisProgress?.percent ?? 0);
    const auasPercent = clamp(simcarAuasProgress?.percent ?? 0);

    if (simcarVectorizedStatus.stage === 'importing') {
      return {
        percent: 10,
        phaseLabel: '1/3 Importando',
        message: simcarVectorizedStatus.message,
      };
    }

    if (simcarVectorizedStatus.stage === 'acavn') {
      return {
        percent: clamp(12 + acPercent * 0.47),
        phaseLabel: '2/3 AC/AVN',
        message: simcarAnalysisProgress?.message || simcarVectorizedStatus.message,
      };
    }

    if (simcarVectorizedStatus.stage === 'auas') {
      return {
        percent: clamp(60 + auasPercent * 0.39),
        phaseLabel: '3/3 AUAS',
        message: simcarAuasProgress?.message || simcarVectorizedStatus.message,
      };
    }

    if (simcarVectorizedStatus.stage === 'done') {
      return {
        percent: 100,
        phaseLabel: 'Concluído',
        message: simcarVectorizedStatus.message,
      };
    }

    const fallback = simcarAuasProcessing
      ? clamp(60 + auasPercent * 0.39)
      : simcarAnalysisProcessing
        ? clamp(12 + acPercent * 0.47)
        : 0;
    return {
      percent: fallback,
      phaseLabel: 'Falha',
      message: simcarVectorizedStatus.message,
    };
  }, [
    simcarAnalysisProcessing,
    simcarAnalysisProgress,
    simcarAuasProcessing,
    simcarAuasProgress,
    simcarVectorizedStatus,
  ]);
  useEffect(() => {
    if (!simcarUnifiedVectorizedProgress) {
      setSimcarUnifiedProgressDisplay(0);
      return;
    }
    const target = Math.max(0, Math.min(100, Math.round(simcarUnifiedVectorizedProgress.percent)));
    const stage = simcarVectorizedStatus?.stage;
    if (stage === 'done') {
      setSimcarUnifiedProgressDisplay(100);
      return;
    }
    if (stage === 'error') {
      setSimcarUnifiedProgressDisplay((prev) => Math.max(prev, target));
      return;
    }

    const interval = window.setInterval(() => {
      setSimcarUnifiedProgressDisplay((prev) => {
        if (prev >= target) return prev;
        const step = Math.max(1, Math.ceil((target - prev) * 0.28));
        return Math.min(target, prev + step);
      });
    }, 120);

    return () => window.clearInterval(interval);
  }, [simcarUnifiedVectorizedProgress, simcarVectorizedStatus?.stage]);

  const resetSimcarDraft = useCallback((nextMode: 'auto-clip' | 'vectorized-analysis' = 'auto-clip') => {
    simcarClipAbortRef.current?.abort();
    simcarAnalysisAbortRef.current?.abort();
    simcarAuasAbortRef.current?.abort();
    simcarClipAbortRef.current = null;
    simcarAnalysisAbortRef.current = null;
    simcarAuasAbortRef.current = null;
    simcarClipProcessJobIdRef.current = null;
    simcarClipCancelRequestedRef.current = false;
    simcarAnalysisProcessJobIdRef.current = null;
    simcarAuasProcessJobIdRef.current = null;
    simcarVectorizedResumeInFlightRef.current = null;
    setSimcarServerRuntimeState(null);
    setSimcarClipMode(nextMode);
    setSimcarClipCanceling(false);
    setSimcarClipFile(null);
    setSimcarClipProcessing(false);
    setSimcarClipProgress(null);
    setSimcarClipDownloadUrl(null);
    setSimcarClipSummary(null);
    setSimcarClipError(null);
    setSimcarClipJobId(null);
    setSimcarAirId('');
    setSimcarCarNumber('');
    setSimcarSigefParcelCode('');
    setSimcarVectorizedRunning(false);
    setSimcarVectorizedStatus(null);
    setSimcarUnifiedProgressDisplay(0);
    setSimcarAnalysisProcessing(false);
    setSimcarAnalysisProgress(null);
    setSimcarAnalysisImages([]);
    setSimcarAnalysisMessages([]);
    setSimcarAgentLog([]);
    setSimcarThinkingText('');
    setSimcarThinkingHidden(false);
    setSimcarLiveThinkingText('');
    setSimcarLiveAnswerText('');
    setSimcarAuasProcessing(false);
    setSimcarAuasProgress(null);
    setSimcarAuasImages([]);
    setSimcarAuasMessages([]);
    setSimcarAuasAgentLog([]);
    setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
  }, []);

  const formatBrl = useCallback((value: number) => {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });
  }, []);

  const apiFetch = useCallback(
    async (
      path: string,
      init?: RequestInit,
      options?: { auth?: boolean },
    ): Promise<Response> => {
      const useAuth = options?.auth !== false;
      const headers = new Headers(init?.headers || {});
      const hasBody = typeof init?.body !== 'undefined' && init?.body !== null;
      if (hasBody && !(init?.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (useAuth) {
        const user = auth.currentUser;
        if (!user) {
          throw new Error('Usuário não autenticado.');
        }
        const token = await user.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(apiUrl(path), {
        ...init,
        headers,
      });
    },
    []
  );

  const readApiError = useCallback(async (response: Response) => {
    const fallback = { error: `Erro ${response.status}` };
    const text = await response.text();
    if (!text) return fallback;
    try {
      return JSON.parse(text);
    } catch {
      const isHtml = /^\s*</.test(text);
      return {
        error: isHtml
          ? `A API retornou HTML em vez de JSON (${response.status}). Recarregue a página e tente novamente.`
          : text.slice(0, 500),
      };
    }
  }, []);

  const requestProcessCancel = useCallback(
    async (jobId: string | null | undefined) => {
      const normalizedJobId = String(jobId || '').trim();
      if (!normalizedJobId) return false;
      try {
        const response = await apiFetch('/api/process/cancel', {
          method: 'POST',
          body: JSON.stringify({ jobId: normalizedJobId }),
        });
        if (!response.ok) return false;
        return true;
      } catch {
        return false;
      }
    },
    [apiFetch]
  );

  const cancelProcessingJobsForCard = useCallback(
    async (args: {
      cardJobId: string;
      flow: 'simcar';
      extraJobIds?: Array<string | null | undefined>;
    }) => {
      const cardJobId = String(args.cardJobId || '').trim();
      if (!cardJobId) return false;

      const idsToCancel = new Set<string>();
      idsToCancel.add(cardJobId);
      for (const extra of args.extraJobIds || []) {
        const normalized = String(extra || '').trim();
        if (normalized) idsToCancel.add(normalized);
      }

      try {
        const uid = String(auth.currentUser?.uid || userProfile?.uid || '').trim();
        if (uid) {
          const jobsRef = collection(db, 'users', uid, 'processing_jobs');
          const jobsSnap = await getDocs(query(jobsRef, orderBy('updatedAtMs', 'desc')));
          jobsSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const status = String(data?.status || '').trim().toLowerCase();
            if (status !== 'running' && status !== 'cancel_requested') return;

            const endpoint = String(data?.endpoint || '').trim().toLowerCase();
            const clipJobId = String(data?.metadata?.clipJobId || '').trim();
            const sameDoc = String(docSnap.id || '').trim() === cardJobId;

            if (args.flow === 'simcar') {
              const isSimcarEndpoint = endpoint.startsWith('/api/simcar/clip');
              if (!isSimcarEndpoint) return;
              if (sameDoc || clipJobId === cardJobId) idsToCancel.add(String(docSnap.id));
              return;
            }
          });
        }
      } catch (error) {
        console.warn('Falha ao mapear jobs para cancelamento por card:', error);
      }

      let cancelledAny = false;
      const orderedIds = [...idsToCancel.values()];
      for (const processJobId of orderedIds) {
        const ok = await requestProcessCancel(processJobId);
        if (ok) cancelledAny = true;
      }
      return cancelledAny;
    },
    [requestProcessCancel, userProfile?.uid]
  );

  const handleInsufficientCredits = useCallback((message?: string) => {
    const notice = message || 'Voce esta sem creditos. Adicione creditos para continuar.';
    toast.error(notice);
    setChatError(notice);
    setActiveView('settings');
    setBillingTopupOpen(true);
  }, []);

  const applyBillingToWallet = useCallback((billing?: BillingResult | null) => {
    if (!billing) return;
    setBillingMe((prev) => {
      const usageList = Array.isArray(billing.usage) ? billing.usage : [];
      const usageInputTokens = usageList.reduce((acc, item) => acc + Number(item.inputTokens || 0), 0);
      const usageOutputTokens = usageList.reduce((acc, item) => acc + Number(item.outputTokens || 0), 0);
      const mergeModelSnapshot = (
        currentSnapshot: BillingMePayload['modelSnapshot'] = [],
      ): BillingMePayload['modelSnapshot'] => {
        const byModel = new Map<string, BillingMePayload['modelSnapshot'][number]>();
        for (const item of currentSnapshot) {
          byModel.set(String(item.model || ''), {
            ...item,
            inputTokens: Number(item.inputTokens || 0),
            outputTokens: Number(item.outputTokens || 0),
            costBrl: Number(item.costBrl || 0),
            requests: Number(item.requests || 0),
          });
        }
        for (const usage of usageList) {
          const model = String(usage.model || '').trim();
          if (!model) continue;
          const existing = byModel.get(model) || {
            model,
            provider: String(usage.provider || 'unknown'),
            inputTokens: 0,
            outputTokens: 0,
            costBrl: 0,
            requests: 0,
          };
          existing.provider = String(usage.provider || existing.provider || 'unknown');
          existing.inputTokens += Number(usage.inputTokens || 0);
          existing.outputTokens += Number(usage.outputTokens || 0);
          existing.costBrl += Number(usage.costBrl || 0);
          existing.requests += 1;
          byModel.set(model, existing);
        }
        return [...byModel.values()].sort((a, b) => Number(b.costBrl || 0) - Number(a.costBrl || 0));
      };

      if (!prev) {
        return {
          wallet: {
            balanceBrl: Number(billing.balanceAfterBrl || 0),
            totalTopupBrl: 0,
            totalSpentBrl: Number(billing.chargedBrl || 0),
          },
          usageToday: {
            date: new Date().toISOString().slice(0, 10),
            totalCostBrl: Number(billing.chargedBrl || 0),
            totalInputTokens: usageInputTokens,
            totalOutputTokens: usageOutputTokens,
            totalRequests: 1,
            models: {},
          },
          modelSnapshot: mergeModelSnapshot([]),
        };
      }
      return {
        ...prev,
        wallet: {
          ...prev.wallet,
          balanceBrl: Number(billing.balanceAfterBrl || 0),
          totalSpentBrl: Number(prev.wallet.totalSpentBrl || 0) + Number(billing.chargedBrl || 0),
        },
        usageToday: {
          ...prev.usageToday,
          totalCostBrl: Number(prev.usageToday.totalCostBrl || 0) + Number(billing.chargedBrl || 0),
          totalInputTokens: Number(prev.usageToday.totalInputTokens || 0) + usageInputTokens,
          totalOutputTokens: Number(prev.usageToday.totalOutputTokens || 0) + usageOutputTokens,
          totalRequests: Number(prev.usageToday.totalRequests || 0) + 1,
        },
        modelSnapshot: mergeModelSnapshot(prev.modelSnapshot || []),
      };
    });
  }, []);

  const loadBillingMe = useCallback(async () => {
    if (!auth.currentUser) return;
    setBillingLoading(true);
    try {
      const response = await apiFetch('/api/billing/me');
      if (!response.ok) {
        const payload = await readApiError(response);
        throw new Error(payload?.error || 'Erro ao carregar carteira.');
      }
      const payload = (await response.json()) as BillingMePayload;
      setBillingMe(payload);
    } catch (error: any) {
      console.warn('Falha ao carregar billing/me:', error);
    } finally {
      setBillingLoading(false);
    }
  }, [apiFetch, readApiError]);

  const loadBillingPricing = useCallback(async () => {
    try {
      const response = await apiFetch('/api/billing/pricing', { method: 'GET' }, { auth: false });
      if (!response.ok) return;
      const payload = await response.json();
      setBillingPricing(payload);
    } catch (error) {
      console.warn('Falha ao carregar billing/pricing:', error);
    }
  }, [apiFetch]);

  const loadBillingLedger = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const response = await apiFetch('/api/billing/ledger?limit=15');
      if (!response.ok) return;
      const payload = await response.json();
      setBillingLedger(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (error) {
      console.warn('Falha ao carregar billing/ledger:', error);
    }
  }, [apiFetch]);

  const onManualTopup = useCallback(async () => {
    const amount = Number(String(billingTopupAmount || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Informe um valor válido em reais.');
      return;
    }
    setBillingTopupLoading(true);
    try {
      const response = await apiFetch('/api/billing/topups/manual', {
        method: 'POST',
        body: JSON.stringify({
          amountBrl: Number(amount.toFixed(2)),
          idempotencyKey: nanoid(18),
        }),
      });
      const payload = await readApiError(response);
      if (!response.ok) {
        if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
          handleInsufficientCredits(payload?.error);
          return;
        }
        throw new Error(payload?.error || 'Erro ao adicionar créditos.');
      }
      toast.success(`Créditos adicionados: ${formatBrl(amount)}.`);
      setBillingTopupOpen(false);
      await Promise.all([loadBillingMe(), loadBillingLedger()]);
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao adicionar créditos.');
    } finally {
      setBillingTopupLoading(false);
    }
  }, [apiFetch, billingTopupAmount, formatBrl, handleInsufficientCredits, loadBillingLedger, loadBillingMe, readApiError]);

  const flushQueuedSimcarClipProgress = useCallback(() => {
    const pending = simcarClipProgressPendingRef.current;
    simcarClipProgressPendingRef.current = null;
    simcarClipProgressFlushTimerRef.current = null;
    if (pending) setSimcarClipProgress(pending);
  }, []);

  const queueSimcarClipProgress = useCallback(
    (next: { current: number; total: number; layer: string; status: string }) => {
      simcarClipProgressPendingRef.current = next;
      if (simcarClipProgressFlushTimerRef.current !== null) return;
      simcarClipProgressFlushTimerRef.current = window.setTimeout(flushQueuedSimcarClipProgress, 120);
    },
    [flushQueuedSimcarClipProgress]
  );

  const clearSimcarClipProgressQueue = useCallback(() => {
    if (simcarClipProgressFlushTimerRef.current !== null) {
      window.clearTimeout(simcarClipProgressFlushTimerRef.current);
      simcarClipProgressFlushTimerRef.current = null;
    }
    simcarClipProgressPendingRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearSimcarClipProgressQueue();
    };
  }, [clearSimcarClipProgressQueue]);

  const systemPrompt = useMemo(
    () => ({
      role: 'system',
      content: [
        `Você é a GeoForest IA, assistente técnica de engenharia florestal e análise ambiental do estado de Mato Grosso.`,
        `Usuário atual: ${userProfile?.fullName || 'Usuário'}.`,
        '',
        '## REGRAS DE RESPOSTA',
        '- Responda em português do Brasil, com foco técnico, claro e orientado a ação.',
        '- Respostas curtas e objetivas. Só aprofunde se o usuário pedir análise completa.',
        '- Considere o contexto da conversa atual como prioridade.',
        '',
        '## REGRAS ANTI-ALUCINAÇÃO (OBRIGATÓRIAS)',
        '- NUNCA invente leis, normas, números de artigos, portarias, instruções normativas ou resoluções. Se não souber o número exato, diga "consulte a legislação vigente" ao invés de chutar.',
        '- NUNCA fabrique dados numéricos (áreas, percentuais, coordenadas, datas) que não foram fornecidos pelo usuário ou pela Base de Conhecimento.',
        '- NUNCA invente fontes, referências bibliográficas, links ou nomes de documentos que não existem.',
        '- Se a Base de Conhecimento foi fornecida, use APENAS ela como fonte. Cite a fonte no formato [nome_do_arquivo.md].',
        '- Se NÃO houver informação suficiente para responder, diga explicitamente: "Não tenho informação suficiente sobre isso. Dados necessários: [lista]."',
        '- Separe SEMPRE o que é fato observável do que é interpretação ou hipótese.',
        '- Classifique cada afirmação técnica com nível de confiança: [ALTA], [MÉDIA] ou [BAIXA].',
        '- Quando citar legislação, cite APENAS leis que você tem certeza absoluta (ex: Lei 12.651/2012 - Código Florestal, Lei 9.605/1998 - Crimes Ambientais, LC 38/1995 - Código Ambiental de MT). Para qualquer outra, diga "verificar na legislação vigente".',
        '',
        '## REGRAS ESPECÍFICAS PARA MAPAS E SATÉLITE',
        '- Para mapa/satélite, use BBOX/CRS/camada/ano informados para contextualizar a análise.',
        '- Se houver evidência clara de desmatamento anterior a 22/07/2008, trate como área consolidada e cite a base legal (Art. 68, Lei 12.651/2012).',
        '- Se faltarem dados para um diagnóstico, diga exatamente quais dados faltam ao invés de especular.',
        '- Quando o usuário pedir laudo ou relatório, inclua as ressalvas técnicas e limitações da análise.',
        '- CAMADAS DE OVERLAY: quando a imagem de mapa informar camadas de overlay ativas (ex: SIMCAR, CAR, áreas consolidadas, AUAs, APPs, reserva legal), considere estas camadas na sua análise. Elas são sobreposições vetoriais visíveis na imagem e representam informação geoespacial oficial. Mencione quais overlays estão presentes e como eles se relacionam com a área analisada.',
        '- Exemplos de overlays comuns: simcar_area_consolidada (áreas de uso consolidado no SIMCAR), simcar_aua (Áreas de Uso Alternativo), simcar_app (Áreas de Preservação Permanente), simcar_rl (Reserva Legal), car_* (limites de imóveis do CAR).',
      ].join('\n'),
    }),
    [userProfile?.fullName]
  );

  const shouldUseCrossChatContext = (text: string) =>
    /(como falei|conforme falamos|outro chat|conversa anterior|continue|continuar|retome|retomar|lembr|mesmo assunto|igual ao anterior)/i.test(
      text
    );

  const buildCrossChatContext = (activeId: string | null, text: string) => {
    if (!shouldUseCrossChatContext(text)) return '';
    const others = conversations
      .filter((c) => c.id !== activeId)
      .slice(0, 4)
      .map((c, i) => {
        const preview = (c.lastMessagePreview || '').trim();
        if (!preview) return '';
        return `${i + 1}. ${c.title}: ${preview}`;
      })
      .filter(Boolean);
    if (!others.length) return '';
    return `Contexto de conversas anteriores (use apenas se ajudar na resposta atual):\n${others.join('\n')}`;
  };

  const toIsoDateFromUnknown = (value: any) => {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch {
        return new Date().toISOString();
      }
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  };

  const fileToBase64Payload = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.split(',').pop() || '');
      };
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }, []);

  const mapVerticesDocToHistoryItem = useCallback((docId: string, data: any): VerticesHistoryItem => {
    const rawStatus = String(data?.status || '').trim().toLowerCase();
    const status: VerticesHistoryItem['status'] =
      rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
        ? rawStatus
        : 'processing';
    return {
      id: String(data?.id || docId),
      jobId: String(data?.jobId || docId),
      filename: String(data?.filename || 'Vértices Próximas'),
      timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
      status,
      stage: data?.stage ? String(data.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
      message: data?.message ? String(data.message) : undefined,
      error: data?.error ? String(data.error) : undefined,
      downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
      outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
      outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
      resultRows: Array.isArray(data?.resultRows) ? data.resultRows as VerticesResultRow[] : undefined,
      warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
      analyzedLayers: Array.isArray(data?.analyzedLayers) ? data.analyzedLayers.map((item: any) => ({
        name: String(item?.name || 'Camada'),
        requested: Number(item?.requested || 0),
        found: Number(item?.found || 0),
        crsLabel: item?.crsLabel ? String(item.crsLabel) : undefined,
        metricCrsLabel: item?.metricCrsLabel ? String(item.metricCrsLabel) : undefined,
      })) : undefined,
      conversationId: data?.conversationId ? String(data.conversationId) : undefined,
    };
  }, []);

  const appendVerticesJobToConversation = useCallback(async (job: VerticesHistoryItem) => {
    if (!conversationsRef || !verticesJobsRef || !job?.jobId || job.status !== 'completed') return null;
    if (job.conversationId || verticesConversationSavedRef.current.has(job.jobId)) return job.conversationId || null;
    verticesConversationSavedRef.current.add(job.jobId);

    const conversationId = nanoid();
    const convDocRef = doc(conversationsRef.collection, conversationId);
    const pairsCount = Array.isArray(job.resultRows) ? job.resultRows.length : 0;
    const analyzedCount = Array.isArray(job.analyzedLayers) ? job.analyzedLayers.length : 0;
    const warningCount = Array.isArray(job.warnings) ? job.warnings.length : 0;
    const title = `Vértices Próximas - ${job.filename}`;
    const summary = [
      'Análise de Vértices Próximas concluída.',
      `Arquivo: ${job.filename}`,
      `Camadas analisadas: ${analyzedCount}`,
      `Pares encontrados: ${pairsCount}`,
      warningCount > 0 ? `Avisos: ${warningCount}` : '',
      job.downloadUrl ? `Download: ${job.downloadUrl}` : '',
    ].filter(Boolean).join('\n');
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messages: ChatMessage[] = [
      DEFAULT_ASSISTANT_MESSAGE,
      {
        id: nanoid(),
        role: 'ai',
        text: summary,
        time: now,
        meta: { model: 'vertices-proximas' },
      },
    ];

    await setDoc(convDocRef, {
      title,
      kind: 'vertices_proximas',
      verticesJobId: job.jobId,
      messages: sanitizeMessagesForFirestore(messages),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessagePreview: summary.slice(0, 120),
      lastAttachmentType: null,
    }, { merge: true });

    await setDoc(doc(verticesJobsRef, job.jobId), { conversationId, updatedAtMs: Date.now() }, { merge: true });

    setConversations((prev) => [{
      id: conversationId,
      title,
      kind: 'vertices_proximas',
      verticesJobId: job.jobId,
      lastMessagePreview: summary.slice(0, 120),
    }, ...prev.filter((item) => item.id !== conversationId)]);
    setVerticesHistory((prev) => prev.map((item) => item.jobId === job.jobId ? { ...item, conversationId } : item));

    return conversationId;
  }, [conversationsRef, verticesJobsRef]);

  const deleteVerticesJob = useCallback(async (entry: VerticesHistoryItem) => {
    try {
      await apiFetch(`/api/vertices/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' }).catch(() => undefined);
      if (verticesJobsRef) void deleteDoc(doc(verticesJobsRef, entry.jobId)).catch(() => undefined);
      if (conversationsRef) {
        const linkedConversationIds = new Set<string>();
        if (entry.conversationId) linkedConversationIds.add(entry.conversationId);
        for (const conv of conversations) {
          if (String(conv.verticesJobId || '').trim() === String(entry.jobId)) linkedConversationIds.add(conv.id);
        }
        for (const convId of linkedConversationIds) void deleteDoc(doc(conversationsRef.collection, convId)).catch(() => undefined);
        if (linkedConversationIds.size > 0) setConversations((prev) => prev.filter((c) => !linkedConversationIds.has(c.id)));
      }
      setVerticesHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
      if (verticesJobId === entry.jobId) resetVerticesDraft();
      toast.success('Análise de vértices removida.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao excluir análise de vértices.');
    }
  }, [apiFetch, conversations, conversationsRef, resetVerticesDraft, verticesJobId, verticesJobsRef]);

  const applyVerticesJobSnapshot = useCallback((job: any) => {
    const item = mapVerticesDocToHistoryItem(String(job?.jobId || verticesJobId || nanoid()), job);
    const status = item.status;
    setVerticesProgress({
      stage: item.stage || status || 'processing',
      percent: item.percent,
      message: item.message || '',
      layer: job?.layer ? String(job.layer) : undefined,
    });
    setVerticesProcessing(status === 'processing');
    if (item.warnings) setVerticesWarnings(item.warnings);
    if (item.resultRows) setVerticesRows(item.resultRows);
    if (item.downloadUrl) setVerticesDownloadUrl(item.downloadUrl);
    if (status === 'failed' || status === 'cancelled') {
      setVerticesError(item.error || item.message || 'Falha ao processar vértices.');
    } else {
      setVerticesError(null);
    }
    if (item.jobId) {
      setVerticesHistory((prev) => {
        const next = { ...item, filename: item.filename || verticesFile?.name || 'Vértices Próximas' };
        return [next, ...prev.filter((entry) => entry.jobId !== next.jobId)];
      });
      if (status === 'completed') {
        void appendVerticesJobToConversation(item).catch(() => {
          verticesConversationSavedRef.current.delete(item.jobId);
        });
      }
    }
  }, [appendVerticesJobToConversation, mapVerticesDocToHistoryItem, verticesFile?.name, verticesJobId]);

  const connectVerticesEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    verticesEventsAbortRef.current?.abort();
    const controller = new AbortController();
    verticesEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/vertices/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data:'));
          if (!line) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt?.type === 'snapshot' && evt?.job) {
              applyVerticesJobSnapshot({ ...evt.job, jobId: evt.jobId || evt.job?.jobId });
            } else if (evt?.type === 'progress') {
              applyVerticesJobSnapshot(evt);
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos de vértices:', error);
      }
    } finally {
      if (verticesEventsAbortRef.current === controller) verticesEventsAbortRef.current = null;
    }
  }, [apiFetch, applyVerticesJobSnapshot]);

  const selectVerticesHistoryEntry = useCallback((entry: VerticesHistoryItem) => {
    verticesEventsAbortRef.current?.abort();
    setActiveView('vertices-proximas');
    setVerticesFile(null);
    setVerticesUploadId(null);
    setVerticesLayers([]);
    setVerticesUploading(false);
    setVerticesProcessing(entry.status === 'processing');
    setVerticesJobId(entry.jobId);
    setVerticesProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || (entry.status === 'completed' ? 'Análise concluída.' : ''),
    });
    setVerticesWarnings(entry.warnings || []);
    setVerticesRows(entry.resultRows || []);
    setVerticesDownloadUrl(entry.downloadUrl || null);
    setVerticesError(entry.status === 'failed' ? entry.error || entry.message || 'Falha ao processar vértices.' : null);
    if (verticesFileInputRef.current) verticesFileInputRef.current.value = '';
    if (entry.status === 'processing') void connectVerticesEvents(entry.jobId);
  }, [connectVerticesEvents]);

  const applyVerticesZipFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um arquivo .zip contendo shapefiles.');
      return;
    }
    setVerticesFile(file);
    setVerticesUploadId(null);
    setVerticesLayers([]);
    setVerticesRows([]);
    setVerticesDownloadUrl(null);
    setVerticesWarnings([]);
    setVerticesError(null);
    setVerticesUploading(true);
    try {
      const zipBase64 = await fileToBase64Payload(file);
      const response = await apiFetch('/api/vertices/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, zipBase64 }),
      });
      const payload = await readApiError(response);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao importar ZIP.');
      const layers = Array.isArray(payload?.layers) ? payload.layers : [];
      const visibleLayers = layers.filter((layer: any) => String(layer?.geometryType) === 'Polygon' && Number(layer?.featureCount || 0) > 0 && !layer?.ignoredReason);
      setVerticesUploadId(String(payload?.uploadId || ''));
      setVerticesLayers(visibleLayers.map((layer: any) => {
        const ignored = false;
        return {
          id: String(layer?.id || layer?.name || ''),
          name: String(layer?.name || 'CAMADA'),
          path: layer?.path ? String(layer.path) : undefined,
          geometryType: String(layer?.geometryType || ''),
          featureCount: Number(layer?.featureCount || 0),
          crsLabel: String(layer?.crsLabel || 'CRS ausente'),
          missingCrs: Boolean(layer?.missingCrs),
          ignoredReason: layer?.ignoredReason ? String(layer.ignoredReason) : undefined,
          analyze: !ignored,
          pointCount: 1,
          toleranceMm: '',
          crsOverride: Boolean(layer?.missingCrs) ? 'EPSG:4674' : '',
          status: ignored ? String(layer?.ignoredReason || 'Ignorada') : 'Pronta',
        } satisfies VerticesLayer;
      }));
      const warnings = Array.isArray(payload?.warnings) ? payload.warnings.map((item: any) => String(item)) : [];
      setVerticesWarnings(warnings);
      if (!visibleLayers.length) {
        toast.error('Nenhuma camada poligonal com feições foi encontrada.');
      } else {
        toast.success('ZIP importado e camadas poligonais listadas.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao importar ZIP.';
      setVerticesError(message);
      toast.error(message);
    } finally {
      setVerticesUploading(false);
    }
  }, [apiFetch, fileToBase64Payload, readApiError]);

  const updateVerticesLayer = useCallback((layerId: string, patch: Partial<VerticesLayer>) => {
    setVerticesLayers((prev) => prev.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer));
  }, []);

  const startVerticesProcessing = useCallback(async () => {
    if (!verticesUploadId) {
      toast.error('Envie um ZIP antes de processar.');
      return;
    }
    const selectedLayers = verticesLayers.filter((layer) => layer.analyze && !layer.ignoredReason && layer.featureCount > 0);
    if (!selectedLayers.length) {
      toast.error('Selecione ao menos uma camada poligonal para analisar.');
      return;
    }
    const missingCrs = selectedLayers.find((layer) => layer.missingCrs && !layer.crsOverride.trim());
    if (missingCrs) {
      toast.error(`Informe o CRS da camada ${missingCrs.name}.`);
      return;
    }
    setVerticesProcessing(true);
    setVerticesError(null);
    setVerticesRows([]);
    setVerticesDownloadUrl(null);
    setVerticesProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento ao servidor.' });
    try {
      const body = {
        uploadId: verticesUploadId,
        layers: verticesLayers.map((layer) => ({
          id: layer.id,
          analyze: Boolean(layer.analyze && !layer.ignoredReason && layer.featureCount > 0),
          pointCount: Math.max(1, Math.floor(Number(layer.pointCount || 1))),
          toleranceMm: layer.toleranceMm.trim() ? Number(layer.toleranceMm) : undefined,
          crsOverride: layer.crsOverride.trim() || undefined,
        })),
        settings: {
          includeOriginalVertices: verticesIncludeOriginals,
          includeTxtReport: verticesIncludeReport,
          includeCsvSummary: verticesIncludeCsv,
          preserveOriginalCrs: verticesPreserveCrs,
          useMetricTemporaryCrs: verticesMetricTemporary,
        },
      };
      const response = await apiFetch('/api/vertices/process', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await readApiError(response);
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId.');
      setVerticesJobId(jobId);
      setVerticesHistory((prev) => [{
        id: jobId,
        jobId,
        filename: verticesFile?.name || 'Vértices Próximas',
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Processamento de vértices enviado ao servidor.',
      }, ...prev.filter((entry) => entry.jobId !== jobId)]);
      void connectVerticesEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao processar vértices.';
      setVerticesProcessing(false);
      setVerticesError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    connectVerticesEvents,
    readApiError,
    verticesIncludeCsv,
    verticesIncludeOriginals,
    verticesIncludeReport,
    verticesLayers,
    verticesMetricTemporary,
    verticesPreserveCrs,
    verticesUploadId,
  ]);

  const mapCbersDocToHistoryItem = useCallback((docId: string, data: any): CbersHistoryItem => {
    const rawStatus = String(data?.status || '').trim().toLowerCase();
    const status: CbersJobStatus =
      rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
        ? rawStatus
        : 'processing';
    const scene = isPlainObject(data?.scene)
      ? {
        id: String(data.scene.id || ''),
        collectionId: data.scene.collectionId ? String(data.scene.collectionId) : undefined,
        level: data.scene.level === 'L2' || data.scene.level === 'L4' ? data.scene.level : undefined,
        datetime: String(data.scene.datetime || ''),
        cloudCover: Number.isFinite(Number(data.scene.cloudCover)) ? Number(data.scene.cloudCover) : null,
        bbox: Array.isArray(data.scene.bbox) && data.scene.bbox.length >= 4
          ? [Number(data.scene.bbox[0]), Number(data.scene.bbox[1]), Number(data.scene.bbox[2]), Number(data.scene.bbox[3])] as [number, number, number, number]
          : null,
        geometry: data.scene.geometry as CbersGeoJsonGeometry | undefined,
        thumbnailUrl: data.scene.thumbnailUrl ? String(data.scene.thumbnailUrl) : undefined,
        assetKeys: Array.isArray(data.scene.assetKeys) ? data.scene.assetKeys.map((item: any) => String(item)) : [],
        coveragePercent: Number.isFinite(Number(data.scene.coveragePercent)) ? Number(data.scene.coveragePercent) : undefined,
        coversArea: typeof data.scene.coversArea === 'boolean' ? data.scene.coversArea : undefined,
        estimate: isPlainObject(data.scene.estimate) ? data.scene.estimate as CbersEstimate : undefined,
        wmsAvailable: Boolean(data.scene.wmsAvailable),
        wmsLayerName: data.scene.wmsLayerName ? String(data.scene.wmsLayerName) : undefined,
        wmsUrl: data.scene.wmsUrl ? String(data.scene.wmsUrl) : undefined,
        wmsDownloadUrl: data.scene.wmsDownloadUrl ? String(data.scene.wmsDownloadUrl) : undefined,
        archiveImageId: data.scene.archiveImageId ? String(data.scene.archiveImageId) : undefined,
        archiveFilename: data.scene.archiveFilename ? String(data.scene.archiveFilename) : undefined,
        fallbackFromL2: Boolean(data.scene.fallbackFromL2),
        alignmentStatus: data.scene.alignmentStatus ? String(data.scene.alignmentStatus) as CbersScene['alignmentStatus'] : undefined,
        alignmentWarning: data.scene.alignmentWarning ? String(data.scene.alignmentWarning) : undefined,
      }
      : null;
    const scenes = Array.isArray(data?.scenes)
      ? data.scenes.map((item: any) => ({
        itemId: String(item?.itemId || ''),
        collectionId: item?.collectionId ? String(item.collectionId) : undefined,
        level: item?.level === 'L2' || item?.level === 'L4' ? item.level : undefined,
        scene: isPlainObject(item?.scene) ? mapCbersDocToHistoryItem(`${docId}-${item.itemId || 'scene'}`, { scene: item.scene }).scene : null,
        status: item?.status === 'completed' || item?.status === 'failed' || item?.status === 'cancelled' ? item.status : 'processing',
        stage: item?.stage ? String(item.stage) : undefined,
        percent: Math.max(0, Math.min(100, Math.round(Number(item?.percent || 0)))),
        message: item?.message ? String(item.message) : undefined,
        error: item?.error ? String(item.error) : undefined,
        estimate: isPlainObject(item?.estimate) ? item.estimate as CbersEstimate : undefined,
        outputUrl: item?.outputUrl ? resolveBackendUrl(String(item.outputUrl)) : undefined,
        outputRelativePath: item?.outputRelativePath ? String(item.outputRelativePath) : undefined,
        outputFilename: item?.outputFilename ? String(item.outputFilename) : undefined,
        outputBytes: Number.isFinite(Number(item?.outputBytes)) ? Number(item.outputBytes) : undefined,
        archiveImageId: item?.archiveImageId ? String(item.archiveImageId) : undefined,
        archiveFilename: item?.archive?.archiveFilename ? String(item.archive.archiveFilename) : item?.archiveFilename ? String(item.archiveFilename) : undefined,
        wmsLayerName: item?.wmsLayerName ? String(item.wmsLayerName) : undefined,
        wmsUrl: item?.wmsUrl ? String(item.wmsUrl) : undefined,
        wmsDownloadUrl: item?.wmsDownloadUrl ? String(item.wmsDownloadUrl) : undefined,
        alignmentStatus: item?.alignmentStatus ? String(item.alignmentStatus) as CbersSceneJobState['alignmentStatus'] : undefined,
        alignmentWarning: item?.alignmentWarning ? String(item.alignmentWarning) : undefined,
      })).filter((item: CbersSceneJobState) => Boolean(item.itemId))
      : undefined;
    return {
      id: String(data?.id || docId),
      jobId: String(data?.jobId || docId),
      filename: String(data?.filename || 'CBERS-4A/WPM'),
      timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
      createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
      updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
      status,
      stage: data?.stage ? String(data.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
      message: data?.message ? String(data.message) : undefined,
      error: data?.error ? String(data.error) : undefined,
      itemId: data?.itemId ? String(data.itemId) : undefined,
      itemIds: Array.isArray(data?.itemIds) ? data.itemIds.map((item: any) => String(item)) : undefined,
      mode: data?.mode === 'batch' ? 'batch' : data?.mode === 'single' ? 'single' : undefined,
      collection: data?.collection ? String(data.collection) : undefined,
      areaHa: Number.isFinite(Number(data?.areaHa)) ? Number(data.areaHa) : undefined,
      scene,
      scenes,
      outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
      outputRelativePath: data?.outputRelativePath ? String(data.outputRelativePath) : undefined,
      outputFilename: data?.outputFilename ? String(data.outputFilename) : undefined,
      outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
      archiveImageId: data?.archiveImageId ? String(data.archiveImageId) : undefined,
      archiveFilename: data?.archive?.archiveFilename ? String(data.archive.archiveFilename) : data?.archiveFilename ? String(data.archiveFilename) : undefined,
      wmsLayerName: data?.wmsLayerName ? String(data.wmsLayerName) : undefined,
      wmsUrl: data?.wmsUrl ? String(data.wmsUrl) : undefined,
      wmsDownloadUrl: data?.wmsDownloadUrl ? String(data.wmsDownloadUrl) : undefined,
      alignmentStatus: data?.alignmentStatus ? String(data.alignmentStatus) as CbersHistoryItem['alignmentStatus'] : undefined,
      alignmentWarning: data?.alignmentWarning ? String(data.alignmentWarning) : undefined,
      batchZipUrl: data?.batchZipUrl ? resolveBackendUrl(String(data.batchZipUrl)) : undefined,
      batchZipRelativePath: data?.batchZipRelativePath ? String(data.batchZipRelativePath) : undefined,
      batchZipFilename: data?.batchZipFilename ? String(data.batchZipFilename) : undefined,
      batchZipBytes: Number.isFinite(Number(data?.batchZipBytes)) ? Number(data.batchZipBytes) : undefined,
    };
  }, []);

  const applyCbersJobPatch = useCallback((job: CbersHistoryItem) => {
    setCbersHistory((prev) => {
      const exists = prev.some((item) => item.jobId === job.jobId);
      const next = exists
        ? prev.map((item) => (item.jobId === job.jobId ? {
          ...item,
          ...job,
          filename: job.filename === 'CBERS-4A/WPM' ? item.filename : job.filename,
          timestamp: item.timestamp || job.timestamp,
          createdAt: job.createdAt || item.createdAt,
          updatedAt: job.updatedAt || item.updatedAt,
          itemId: job.itemId || item.itemId,
          collection: job.collection || item.collection,
          areaHa: job.areaHa ?? item.areaHa,
          scene: job.scene || item.scene,
          scenes: job.scenes || item.scenes,
          itemIds: job.itemIds || item.itemIds,
          mode: job.mode || item.mode,
          outputUrl: job.outputUrl || item.outputUrl,
          outputRelativePath: job.outputRelativePath || item.outputRelativePath,
          outputBytes: job.outputBytes ?? item.outputBytes,
          archiveImageId: job.archiveImageId || item.archiveImageId,
          archiveFilename: job.archiveFilename || item.archiveFilename,
          wmsLayerName: job.wmsLayerName || item.wmsLayerName,
          wmsUrl: job.wmsUrl || item.wmsUrl,
          wmsDownloadUrl: job.wmsDownloadUrl || item.wmsDownloadUrl,
        } : item))
        : [job, ...prev];
      return next.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    });
    setCbersJobId(job.jobId);
    setCbersProcessing(job.status === 'processing');
    setCbersProgress({
      stage: job.stage || job.status,
      percent: job.percent,
      message: job.message || '',
    });
    setCbersError(job.status === 'failed' || job.status === 'cancelled' ? job.error || job.message || null : null);
  }, []);

  const connectCbersEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    cbersEventsAbortRef.current?.abort();
    const controller = new AbortController();
    cbersEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data:'));
          if (!line) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt?.type === 'snapshot' && evt?.job) {
              applyCbersJobPatch(mapCbersDocToHistoryItem(normalizedJobId, evt.job));
            } else if (evt?.type === 'progress') {
              applyCbersJobPatch(mapCbersDocToHistoryItem(normalizedJobId, evt));
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos CBERS:', error);
      }
    } finally {
      if (cbersEventsAbortRef.current === controller) cbersEventsAbortRef.current = null;
    }
  }, [apiFetch, applyCbersJobPatch, mapCbersDocToHistoryItem]);

  const selectCbersHistoryEntry = useCallback((entry: CbersHistoryItem) => {
    setCbersJobId(entry.jobId);
    setCbersProcessing(entry.status === 'processing');
    setCbersProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || '',
    });
    setCbersError(entry.status === 'failed' || entry.status === 'cancelled' ? entry.error || entry.message || null : null);
    setCbersSelectedSceneId(entry.itemId || entry.scene?.id || null);
    if (entry.status === 'processing') void connectCbersEvents(entry.jobId);
  }, [connectCbersEvents]);

  const sortCbersScenes = useCallback(
    (scenes: CbersScene[]) => {
      return [...scenes].sort((a, b) => {
        const cmp = String(b.datetime || '').localeCompare(String(a.datetime || ''));
        return cbersSortOrder === 'desc' ? cmp : -cmp;
      });
    },
    [cbersSortOrder]
  );

  const cbersVisibleScenes = useMemo(() => {
    const startMs = cbersDateStart ? new Date(`${cbersDateStart}T00:00:00`).getTime() : null;
    const endMs = cbersDateEnd ? new Date(`${cbersDateEnd}T23:59:59`).getTime() : null;
    const maxCloud = cbersMaxCloudCover.trim() ? Number(cbersMaxCloudCover) : null;
    return sortCbersScenes(
      cbersScenes.filter((scene) => {
        if (scene.level && scene.level !== 'L4') return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          if (scene.cloudCover === null) return false;
          if (scene.cloudCover > maxCloud) return false;
        }
        if (scene.datetime) {
          const sceneMs = new Date(scene.datetime).getTime();
          if (Number.isFinite(sceneMs)) {
            if (startMs !== null && Number.isFinite(startMs) && sceneMs < startMs) return false;
            if (endMs !== null && Number.isFinite(endMs) && sceneMs > endMs) return false;
          }
        }
        return true;
      })
    );
  }, [cbersDateEnd, cbersDateStart, cbersMaxCloudCover, cbersScenes, sortCbersScenes]);

  useEffect(() => {
    if (cbersScenes.length === 0) return;
    const visibleIds = new Set(cbersVisibleScenes.map((scene) => scene.id));
    setCbersSelectedSceneIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    if (cbersSelectedSceneId && !visibleIds.has(cbersSelectedSceneId)) {
      setCbersSelectedSceneId(cbersVisibleScenes[0]?.id || null);
    }
  }, [cbersScenes.length, cbersSelectedSceneId, cbersVisibleScenes]);

  const cbersSelectedScenes = useMemo(
    () => cbersSelectedSceneIds
      .map((id) => cbersScenes.find((scene) => scene.id === id))
      .filter((scene): scene is CbersScene => Boolean(scene)),
    [cbersScenes, cbersSelectedSceneIds]
  );

  const toggleCbersSceneSelection = useCallback((scene: CbersScene) => {
    if (scene.level && scene.level !== 'L4') {
      toast.error('A geração CBERS está restrita a cenas L4.');
      return;
    }
    if (scene.wmsAvailable) {
      toast.info('Esta folha já está disponível no WMS. Use a imagem publicada em vez de gerar novamente.');
      return;
    }
    if (scene.coversArea === false) {
      toast.error(`Cena cobre apenas ${(scene.coveragePercent ?? 0).toFixed(2)}% da área.`);
      return;
    }
    setCbersSelectedSceneId(scene.id);
    setCbersSelectedSceneIds((prev) => {
      if (prev.includes(scene.id)) return prev.filter((id) => id !== scene.id);
      return [...prev, scene.id];
    });
  }, []);

  const estimateCbersScenes = useCallback(async (itemIds: string[]) => {
    if (itemIds.length === 0) return;
    setCbersEstimating(true);
    try {
      const body: Record<string, unknown> = { itemIds };
      const carNumber = cbersCarNumber.trim();
      if (cbersFile) {
        const propertyZip = cbersPropertyZipB64 || await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/cbers-wpm/estimate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao estimar cenas CBERS.');
      const estimates = Array.isArray(payload?.estimates) ? payload.estimates : [];
      setCbersScenes((prev) => prev.map((scene) => {
        const found = estimates.find((item: any) => String(item?.itemId || '') === scene.id);
        if (!found) return scene;
        return {
          ...scene,
          ...(isPlainObject(found.scene) ? found.scene : {}),
          estimate: isPlainObject(found.estimate) ? found.estimate as CbersEstimate : scene.estimate,
        } as CbersScene;
      }));
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao estimar cenas CBERS.');
    } finally {
      setCbersEstimating(false);
    }
  }, [apiFetch, cbersCarNumber, cbersFile, cbersPropertyZipB64, fileToBase64Payload]);

  useEffect(() => {
    const missing = cbersSelectedScenes
      .filter((scene) => scene.coversArea !== false && !scene.estimate)
      .map((scene) => scene.id);
    if (missing.length > 0) void estimateCbersScenes(missing);
  }, [cbersSelectedScenes, estimateCbersScenes]);

  const applyCbersZipFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um shapefile compactado em .zip.');
      return;
    }
    setCbersFile(file);
    setCbersPropertyZipB64(null);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    setCbersSelectedSceneIds([]);
    setCbersPreviewScene(null);
    setCbersPropertyGeometry(null);
    setCbersAreaHa(null);
    setCbersError(null);
    setCbersCarNumber('');
  }, []);

  const searchCbersScenes = useCallback(async () => {
    const orbit = cbersOrbit.trim();
    const point = cbersPoint.trim();
    const carNumber = cbersCarNumber.trim();
    const hasDirectFilter = orbit.length > 0 && point.length > 0;
    if (!cbersFile && !carNumber && !hasDirectFilter) {
      toast.error('Selecione um ZIP/SHP, informe Nº do CAR estadual ou informe órbita e ponto.');
      return;
    }
    if (cbersDateStart && cbersDateEnd && cbersDateStart > cbersDateEnd) {
      toast.error('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    setCbersSearching(true);
    setCbersError(null);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    try {
      const body: Record<string, unknown> = {
        dateStart: cbersDateStart || undefined,
        dateEnd: cbersDateEnd || undefined,
        orbit: orbit || undefined,
        point: point || undefined,
      };
      if (cbersFile) {
        const propertyZip = await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
        body.filename = cbersFile.name;
      } else if (carNumber) {
        setCbersPropertyZipB64(null);
        body.carNumber = carNumber;
        body.filename = `CAR_${carNumber}.zip`;
      } else {
        setCbersPropertyZipB64(null);
      }
      const response = await apiFetch('/api/cbers-wpm/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao buscar cenas CBERS.');
      const scenes = sortCbersScenes(Array.isArray(payload?.scenes) ? payload.scenes as CbersScene[] : []);
      const nextAreaHa = Number(payload?.areaHa);
      setCbersAreaHa(Number.isFinite(nextAreaHa) && nextAreaHa > 0 ? nextAreaHa : null);
      setCbersPropertyGeometry(isPlainObject(payload?.propertyGeometry) ? payload.propertyGeometry as CbersGeoJsonGeometry : null);
      setCbersScenes(scenes);
      const maxCloud = cbersMaxCloudCover.trim() ? Number(cbersMaxCloudCover) : null;
      const firstCovered = scenes.find((scene) => {
        if (scene.level && scene.level !== 'L4') return false;
        if (scene.coversArea === false || scene.wmsAvailable) return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          return scene.cloudCover !== null && scene.cloudCover <= maxCloud;
        }
        return true;
      });
      setCbersSelectedSceneId(firstCovered?.id || scenes[0]?.id || null);
      setCbersSelectedSceneIds(firstCovered ? [firstCovered.id] : []);
      setCbersPreviewScene(null);
      if (!scenes.length) {
        toast.info(hasDirectFilter && !carNumber ? 'Nenhuma cena CBERS-4A/WPM encontrada para essa órbita/ponto.' : 'Nenhuma cena CBERS-4A/WPM encontrada para essa área.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao buscar cenas CBERS.';
      setCbersError(message);
      toast.error(message);
    } finally {
      setCbersSearching(false);
    }
  }, [apiFetch, cbersCarNumber, cbersDateEnd, cbersDateStart, cbersFile, cbersMaxCloudCover, cbersOrbit, cbersPoint, fileToBase64Payload, sortCbersScenes]);

  const startCbersProcessing = useCallback(async (sceneIdOverride?: string) => {
    const targetSceneIds = sceneIdOverride
      ? [String(sceneIdOverride).trim()].filter(Boolean)
      : cbersSelectedSceneIds.length > 0
        ? cbersSelectedSceneIds
        : [String(cbersSelectedSceneId || '').trim()].filter(Boolean);
    if (targetSceneIds.length === 0) {
      toast.error('Selecione ao menos uma cena CBERS.');
      return;
    }
    const blocked = targetSceneIds
      .map((id) => cbersScenes.find((scene) => scene.id === id))
      .find((scene) => scene?.coversArea === false || scene?.wmsAvailable || (scene?.level && scene.level !== 'L4'));
    if (blocked) {
      toast.error(
        blocked.wmsAvailable
          ? `A folha da cena ${blocked.id} já está disponível no WMS. Use a imagem existente.`
          : blocked.level && blocked.level !== 'L4'
            ? `A cena ${blocked.id} é ${blocked.level}; a geração aceita somente L4.`
            : `Cena ${blocked.id} não cobre 100% da área.`
      );
      return;
    }
    setCbersError(null);
    setCbersProcessing(true);
    setCbersProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento CBERS ao servidor.' });
    try {
      const carNumber = cbersCarNumber.trim();
      const filename = cbersFile?.name || (carNumber ? `CAR_${carNumber}.zip` : `CBERS_${targetSceneIds[0] || 'ORBITA_PONTO'}`);
      const body: Record<string, unknown> = {
        filename,
        itemId: targetSceneIds[0],
        itemIds: targetSceneIds,
      };
      if (cbersFile) {
        const propertyZip = cbersPropertyZipB64 || await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/cbers-wpm/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento CBERS.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId CBERS.');
      const scene = cbersScenes.find((item) => item.id === targetSceneIds[0]) || null;
      const optimisticScenes: CbersSceneJobState[] = targetSceneIds.map((itemId) => ({
        itemId,
        scene: cbersScenes.find((item) => item.id === itemId) || null,
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Aguardando processamento.',
        estimate: cbersScenes.find((item) => item.id === itemId)?.estimate,
      }));
      const optimistic: CbersHistoryItem = {
        id: jobId,
        jobId,
        filename,
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Processamento CBERS enviado para o servidor.',
        itemId: targetSceneIds[0],
        itemIds: targetSceneIds,
        mode: targetSceneIds.length > 1 ? 'batch' : 'single',
        collection: 'CB4A-WPM-L4-DN-1',
        areaHa: cbersAreaHa || undefined,
        scene,
        scenes: optimisticScenes,
      };
      applyCbersJobPatch(optimistic);
      void connectCbersEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao iniciar processamento CBERS.';
      setCbersProcessing(false);
      setCbersError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyCbersJobPatch,
    cbersAreaHa,
    cbersCarNumber,
    cbersFile,
    cbersPropertyZipB64,
    cbersScenes,
    cbersSelectedSceneId,
    cbersSelectedSceneIds,
    connectCbersEvents,
    fileToBase64Payload,
  ]);

  const deleteCbersJob = useCallback(async (entry: CbersHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      if (entry.status === 'processing') {
        await requestProcessCancel(entry.jobId);
      }
      await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Keep local cleanup responsive even if backend already removed it.
    }
    setCbersHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
    if (cbersJobId === entry.jobId) {
      setCbersJobId(null);
      setCbersProcessing(false);
      setCbersProgress(null);
      setCbersError(null);
    }
  }, [apiFetch, cbersJobId, requestProcessCancel]);

  useEffect(() => {
    if (!cbersProcessing || !cbersJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(cbersJobId)}/status`, {
          method: 'GET',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active || !payload?.job) return;
        applyCbersJobPatch(mapCbersDocToHistoryItem(cbersJobId, payload.job));
      } catch {
        // SSE remains the primary live channel; polling is only a fallback.
      }
    };
    void pollStatus();
    const interval = window.setInterval(() => {
      void pollStatus();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, applyCbersJobPatch, cbersJobId, cbersProcessing, mapCbersDocToHistoryItem]);

  const normalizeLandsatScene = useCallback((raw: any): LandsatScene | null => {
    if (!isPlainObject(raw)) return null;
    const composition: LandsatComposition = String(raw?.composition || '') === 'natural_color' ? 'natural_color' : 'false_color';
    return {
      id: String(raw?.id || raw?.wmsStoreName || raw?.wmsLayerName || ''),
      source: raw?.source === 'local_wms' ? 'local_wms' : 'usgs_stac',
      collectionId: raw?.collectionId ? String(raw.collectionId) : undefined,
      platform: raw?.platform ? String(raw.platform) : undefined,
      sensor: raw?.sensor ? String(raw.sensor) : undefined,
      path: String(raw?.path || raw?.orbit || ''),
      row: String(raw?.row || ''),
      orbit: String(raw?.orbit || [raw?.path, raw?.row].filter(Boolean).join('_')),
      year: String(raw?.year || ''),
      date: String(raw?.date || ''),
      datetime: String(raw?.datetime || ''),
      cloudCover: Number.isFinite(Number(raw?.cloudCover)) ? Number(raw.cloudCover) : null,
      composition,
      compositionLabel: String(raw?.compositionLabel || (composition === 'natural_color' ? 'Natural' : 'Falsa-cor')),
      bbox: Array.isArray(raw?.bbox) && raw.bbox.length >= 4
        ? [Number(raw.bbox[0]), Number(raw.bbox[1]), Number(raw.bbox[2]), Number(raw.bbox[3])] as [number, number, number, number]
        : null,
      geometry: raw?.geometry as CbersGeoJsonGeometry | undefined,
      thumbnailUrl: raw?.thumbnailUrl ? String(raw.thumbnailUrl) : undefined,
      coveragePercent: Number.isFinite(Number(raw?.coveragePercent)) ? Number(raw.coveragePercent) : undefined,
      coversArea: typeof raw?.coversArea === 'boolean' ? raw.coversArea : undefined,
      assetKeys: Array.isArray(raw?.assetKeys) ? raw.assetKeys.map((item: any) => String(item)) : undefined,
      downloadBytes: Number.isFinite(Number(raw?.downloadBytes)) ? Number(raw.downloadBytes) : null,
      wmsAvailable: Boolean(raw?.wmsAvailable),
      wmsLayerName: raw?.wmsLayerName ? String(raw.wmsLayerName) : undefined,
      wmsStoreName: raw?.wmsStoreName ? String(raw.wmsStoreName) : undefined,
      wmsUrl: raw?.wmsUrl ? String(raw.wmsUrl) : undefined,
      wmsDownloadUrl: raw?.wmsDownloadUrl ? String(raw.wmsDownloadUrl) : undefined,
      sourcePath: raw?.sourcePath ? String(raw.sourcePath) : undefined,
      outputFilename: raw?.outputFilename ? String(raw.outputFilename) : undefined,
    };
  }, []);

  const mapLandsatDocToHistoryItem = useCallback((docId: string, data: any): LandsatHistoryItem => {
    const rawStatus = String(data?.status || '').trim().toLowerCase();
    const status: LandsatJobStatus =
      rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
        ? rawStatus
        : 'processing';
    const scene = normalizeLandsatScene(data?.scene);
    const composition = String(data?.composition || scene?.composition || '') === 'natural_color' ? 'natural_color' : 'false_color';
    return {
      id: String(data?.id || docId),
      jobId: String(data?.jobId || docId),
      filename: String(data?.filename || 'LANDSAT'),
      timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
      createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
      updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
      status,
      stage: data?.stage ? String(data.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
      message: data?.message ? String(data.message) : undefined,
      error: data?.error ? String(data.error) : undefined,
      sceneId: data?.sceneId ? String(data.sceneId) : scene?.id,
      composition,
      scene,
      outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
      outputRelativePath: data?.outputRelativePath ? String(data.outputRelativePath) : undefined,
      outputFilename: data?.outputFilename ? String(data.outputFilename) : undefined,
      outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
      wmsLayerName: data?.wmsLayerName ? String(data.wmsLayerName) : scene?.wmsLayerName,
      wmsStoreName: data?.wmsStoreName ? String(data.wmsStoreName) : scene?.wmsStoreName,
      wmsUrl: data?.wmsUrl ? String(data.wmsUrl) : scene?.wmsUrl,
      wmsDownloadUrl: data?.wmsDownloadUrl ? String(data.wmsDownloadUrl) : scene?.wmsDownloadUrl,
    };
  }, [normalizeLandsatScene]);

  const applyLandsatJobPatch = useCallback((job: LandsatHistoryItem) => {
    setLandsatHistory((prev) => {
      const exists = prev.some((item) => item.jobId === job.jobId);
      const next = exists
        ? prev.map((item) => (item.jobId === job.jobId ? {
          ...item,
          ...job,
          filename: job.filename === 'LANDSAT' ? item.filename : job.filename,
          timestamp: item.timestamp || job.timestamp,
          createdAt: job.createdAt || item.createdAt,
          updatedAt: job.updatedAt || item.updatedAt,
          sceneId: job.sceneId || item.sceneId,
          composition: job.composition || item.composition,
          scene: job.scene || item.scene,
          outputUrl: job.outputUrl || item.outputUrl,
          outputRelativePath: job.outputRelativePath || item.outputRelativePath,
          outputFilename: job.outputFilename || item.outputFilename,
          outputBytes: job.outputBytes ?? item.outputBytes,
          wmsLayerName: job.wmsLayerName || item.wmsLayerName,
          wmsStoreName: job.wmsStoreName || item.wmsStoreName,
          wmsUrl: job.wmsUrl || item.wmsUrl,
          wmsDownloadUrl: job.wmsDownloadUrl || item.wmsDownloadUrl,
        } : item))
        : [job, ...prev];
      return next.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    });
    setLandsatJobId(job.jobId);
    setLandsatProcessing(job.status === 'processing');
    setLandsatProgress({
      stage: job.stage || job.status,
      percent: job.percent,
      message: job.message || '',
    });
    setLandsatError(job.status === 'failed' || job.status === 'cancelled' ? job.error || job.message || null : null);
    if (job.sceneId) setLandsatSelectedSceneId(job.sceneId);
  }, []);

  const connectLandsatEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    landsatEventsAbortRef.current?.abort();
    const controller = new AbortController();
    landsatEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/landsat/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data:'));
          if (!line) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt?.type === 'snapshot' && evt?.job) {
              applyLandsatJobPatch(mapLandsatDocToHistoryItem(normalizedJobId, evt.job));
            } else if (evt?.type === 'progress') {
              applyLandsatJobPatch(mapLandsatDocToHistoryItem(normalizedJobId, evt));
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos Landsat:', error);
      }
    } finally {
      if (landsatEventsAbortRef.current === controller) landsatEventsAbortRef.current = null;
    }
  }, [apiFetch, applyLandsatJobPatch, mapLandsatDocToHistoryItem]);

  const selectLandsatHistoryEntry = useCallback((entry: LandsatHistoryItem) => {
    setLandsatJobId(entry.jobId);
    setLandsatProcessing(entry.status === 'processing');
    setLandsatProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || '',
    });
    setLandsatError(entry.status === 'failed' || entry.status === 'cancelled' ? entry.error || entry.message || null : null);
    setLandsatSelectedSceneId(entry.sceneId || entry.scene?.id || null);
    if (entry.status === 'processing') void connectLandsatEvents(entry.jobId);
  }, [connectLandsatEvents]);

  const sortLandsatScenes = useCallback((scenes: LandsatScene[]) => {
    return [...scenes].sort((a, b) => String(b.datetime || '').localeCompare(String(a.datetime || '')));
  }, []);

  const landsatVisibleScenes = useMemo(() => {
    const startMs = landsatDateStart ? new Date(`${landsatDateStart}T00:00:00`).getTime() : null;
    const endMs = landsatDateEnd ? new Date(`${landsatDateEnd}T23:59:59`).getTime() : null;
    const maxCloud = landsatMaxCloudCover.trim() ? Number(landsatMaxCloudCover) : null;
    return sortLandsatScenes(
      landsatScenes.filter((scene) => {
        if (scene.composition !== landsatComposition) return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          if (scene.cloudCover !== null && scene.cloudCover > maxCloud) return false;
        }
        if (scene.datetime) {
          const sceneMs = new Date(scene.datetime).getTime();
          if (Number.isFinite(sceneMs)) {
            if (startMs !== null && Number.isFinite(startMs) && sceneMs < startMs) return false;
            if (endMs !== null && Number.isFinite(endMs) && sceneMs > endMs) return false;
          }
        }
        return true;
      })
    );
  }, [landsatComposition, landsatDateEnd, landsatDateStart, landsatMaxCloudCover, landsatScenes, sortLandsatScenes]);

  useEffect(() => {
    if (landsatScenes.length === 0) return;
    const visibleIds = new Set(landsatVisibleScenes.map((scene) => scene.id));
    if (landsatSelectedSceneId && !visibleIds.has(landsatSelectedSceneId)) {
      setLandsatSelectedSceneId(landsatVisibleScenes[0]?.id || null);
    }
  }, [landsatScenes.length, landsatSelectedSceneId, landsatVisibleScenes]);

  const landsatSelectedScene = useMemo(
    () => landsatScenes.find((scene) => scene.id === landsatSelectedSceneId) || null,
    [landsatScenes, landsatSelectedSceneId]
  );
  const activeLandsatHistory = useMemo(
    () => landsatJobId ? landsatHistory.find((item) => item.jobId === landsatJobId) || null : null,
    [landsatHistory, landsatJobId]
  );
  const landsatSearchStats = useMemo(() => {
    const local = landsatScenes.filter((scene) => scene.wmsAvailable || scene.source === 'local_wms').length;
    const external = landsatScenes.filter((scene) => !scene.wmsAvailable && scene.source !== 'local_wms').length;
    const visibleLocal = landsatVisibleScenes.filter((scene) => scene.wmsAvailable || scene.source === 'local_wms').length;
    const coverages = landsatVisibleScenes
      .map((scene) => Number(scene.coveragePercent))
      .filter((value) => Number.isFinite(value));
    const bestCoverage = coverages.length ? Math.max(...coverages) : null;
    const dates = landsatVisibleScenes
      .map((scene) => scene.datetime || (scene.date && scene.date.length === 8 ? `${scene.date.slice(0, 4)}-${scene.date.slice(4, 6)}-${scene.date.slice(6, 8)}T00:00:00Z` : ''))
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const firstDate = dates.length ? new Date(dates[0]).toLocaleDateString('pt-BR') : 'n/d';
    const lastDate = dates.length ? new Date(dates[dates.length - 1]).toLocaleDateString('pt-BR') : 'n/d';
    return {
      total: landsatScenes.length,
      visible: landsatVisibleScenes.length,
      local,
      external,
      visibleLocal,
      bestCoverage,
      periodLabel: firstDate === lastDate ? firstDate : `${firstDate} - ${lastDate}`,
    };
  }, [landsatScenes, landsatVisibleScenes]);

  const applyLandsatZipFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um shapefile compactado em .zip.');
      return;
    }
    setLandsatFile(file);
    setLandsatPropertyZipB64(null);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    setLandsatPreviewScene(null);
    setLandsatPropertyGeometry(null);
    setLandsatAreaHa(null);
    setLandsatError(null);
    setLandsatCarNumber('');
  }, []);

  const searchLandsatScenes = useCallback(async () => {
    const orbit = landsatOrbit.trim();
    const point = landsatPoint.trim();
    const carNumber = landsatCarNumber.trim();
    const hasDirectFilter = orbit.length > 0 && point.length > 0;
    if (!landsatFile && !carNumber && !hasDirectFilter) {
      toast.error('Selecione um ZIP/SHP, informe Nº do CAR estadual ou informe órbita e ponto.');
      return;
    }
    if (landsatDateStart && landsatDateEnd && landsatDateStart > landsatDateEnd) {
      toast.error('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    const maxCloud = landsatMaxCloudCover.trim() ? Number(landsatMaxCloudCover) : undefined;
    setLandsatSearching(true);
    setLandsatError(null);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    try {
      const body: Record<string, unknown> = {
        dateStart: landsatDateStart || undefined,
        dateEnd: landsatDateEnd || undefined,
        orbit: orbit || undefined,
        row: point || undefined,
        point: point || undefined,
        maxCloudCover: Number.isFinite(maxCloud) ? maxCloud : undefined,
        composition: landsatComposition,
      };
      if (landsatFile) {
        const propertyZip = await fileToBase64Payload(landsatFile);
        setLandsatPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
        body.filename = landsatFile.name;
      } else if (carNumber) {
        setLandsatPropertyZipB64(null);
        body.carNumber = carNumber;
        body.filename = `CAR_${carNumber}.zip`;
      } else {
        setLandsatPropertyZipB64(null);
      }
      const response = await apiFetch('/api/landsat/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao buscar cenas Landsat.');
      const scenes = sortLandsatScenes(
        (Array.isArray(payload?.scenes) ? payload.scenes : [])
          .map((item: any) => normalizeLandsatScene(item))
          .filter((item: LandsatScene | null): item is LandsatScene => Boolean(item))
      );
      const nextAreaHa = Number(payload?.areaHa);
      setLandsatAreaHa(Number.isFinite(nextAreaHa) && nextAreaHa > 0 ? nextAreaHa : null);
      setLandsatPropertyGeometry(isPlainObject(payload?.propertyGeometry) ? payload.propertyGeometry as CbersGeoJsonGeometry : null);
      setLandsatScenes(scenes);
      const firstCovered = scenes.find((scene) => scene.coversArea !== false) || scenes[0] || null;
      setLandsatSelectedSceneId(firstCovered?.id || null);
      setLandsatPreviewScene(null);
      if (!scenes.length) {
        toast.info(hasDirectFilter && !carNumber ? 'Nenhuma cena Landsat encontrada para essa órbita/ponto.' : 'Nenhuma cena Landsat encontrada para essa área.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao buscar cenas Landsat.';
      setLandsatError(message);
      toast.error(message);
    } finally {
      setLandsatSearching(false);
    }
  }, [
    apiFetch,
    fileToBase64Payload,
    landsatCarNumber,
    landsatComposition,
    landsatDateEnd,
    landsatDateStart,
    landsatFile,
    landsatMaxCloudCover,
    landsatOrbit,
    landsatPoint,
    normalizeLandsatScene,
    sortLandsatScenes,
  ]);

  const startLandsatProcessing = useCallback(async (sceneIdOverride?: string) => {
    const targetSceneId = String(sceneIdOverride || landsatSelectedSceneId || '').trim();
    if (!targetSceneId) {
      toast.error('Selecione uma cena Landsat.');
      return;
    }
    const scene = landsatScenes.find((item) => item.id === targetSceneId) || landsatSelectedScene;
    if (scene?.coversArea === false) {
      toast.error(`Cena cobre apenas ${(scene.coveragePercent ?? 0).toFixed(2)}% da área.`);
      return;
    }
    setLandsatError(null);
    setLandsatProcessing(true);
    setLandsatProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento Landsat ao servidor.' });
    try {
      const carNumber = landsatCarNumber.trim();
      const filename = landsatFile?.name || (carNumber ? `CAR_${carNumber}.zip` : `LANDSAT_${scene?.orbit || targetSceneId}`);
      const body: Record<string, unknown> = {
        filename,
        sceneId: targetSceneId,
        composition: scene?.composition || landsatComposition,
      };
      if (landsatFile) {
        const propertyZip = landsatPropertyZipB64 || await fileToBase64Payload(landsatFile);
        setLandsatPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/landsat/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento Landsat.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId Landsat.');
      const optimistic: LandsatHistoryItem = {
        id: jobId,
        jobId,
        filename,
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: scene?.wmsAvailable ? 'Imagem Landsat encontrada no WMS; registrando reuso.' : 'Processamento Landsat enviado para o servidor.',
        sceneId: targetSceneId,
        composition: scene?.composition || landsatComposition,
        scene: scene || null,
      };
      applyLandsatJobPatch(optimistic);
      void connectLandsatEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao iniciar processamento Landsat.';
      setLandsatProcessing(false);
      setLandsatError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyLandsatJobPatch,
    connectLandsatEvents,
    fileToBase64Payload,
    landsatCarNumber,
    landsatComposition,
    landsatFile,
    landsatPropertyZipB64,
    landsatScenes,
    landsatSelectedScene,
    landsatSelectedSceneId,
  ]);

  const deleteLandsatJob = useCallback(async (entry: LandsatHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      await apiFetch(`/api/landsat/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Keep local cleanup responsive even if backend already removed it.
    }
    setLandsatHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
    if (landsatJobId === entry.jobId) {
      setLandsatJobId(null);
      setLandsatProcessing(false);
      setLandsatProgress(null);
      setLandsatError(null);
    }
  }, [apiFetch, landsatJobId]);

  useEffect(() => {
    if (!landsatProcessing || !landsatJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/landsat/jobs/${encodeURIComponent(landsatJobId)}/status`, {
          method: 'GET',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active || !payload?.job) return;
        applyLandsatJobPatch(mapLandsatDocToHistoryItem(landsatJobId, payload.job));
      } catch {
        // SSE remains the primary live channel; polling is only a fallback.
      }
    };
    void pollStatus();
    const interval = window.setInterval(() => {
      void pollStatus();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, applyLandsatJobPatch, landsatJobId, landsatProcessing, mapLandsatDocToHistoryItem]);

  const normalizeSimcarClipSummary = useCallback((raw: any): SimcarClipSummary | null => {
    if (!raw || typeof raw !== 'object') return null;
    const toNumber = (value: any) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const layers = Array.isArray(raw?.layers)
      ? raw.layers
        .map((layer: any) => ({
          name: String(layer?.name || '').trim(),
          source: layer?.source === 'property' ? 'property' : 'wfs',
          features: toNumber(layer?.features),
          areaHa: layer?.areaHa === undefined || layer?.areaHa === null ? undefined : toNumber(layer.areaHa),
          warning: layer?.warning ? String(layer.warning) : undefined,
          partial: layer?.partial === true,
        }))
        .filter((layer: SimcarLayerSummary) => Boolean(layer.name))
      : [];
    return {
      propertyAreaHa: toNumber(raw?.propertyAreaHa),
      crs: String(raw?.crs || 'EPSG:4674'),
      layersProcessed: toNumber(raw?.layersProcessed ?? layers.length),
      layersWithData: toNumber(raw?.layersWithData ?? layers.filter((layer: SimcarLayerSummary) => layer.features > 0).length),
      totalFeaturesClipped: toNumber(raw?.totalFeaturesClipped),
      processingTimeMs: toNumber(raw?.processingTimeMs),
      layers,
      warnings: Array.isArray(raw?.warnings)
        ? raw.warnings.map((item: any) => String(item || '').trim()).filter(Boolean)
        : undefined,
    };
  }, []);

  const normalizeSimcarReportPatch = useCallback((raw: any): Partial<SimcarClipHistoryItem> => {
    if (!raw || typeof raw !== 'object') return {};
    const status = String(raw?.reportPdfStatus || '').trim();
    const patch: Partial<SimcarClipHistoryItem> = {};
    const reportPdfUrl = String(raw?.reportPdfUrl || raw?.files?.reportPdfUrl || '').trim();
    const reportPdfDownloadUrl = String(raw?.reportPdfDownloadUrl || raw?.files?.reportPdfDownloadUrl || reportPdfUrl).trim();
    if (reportPdfUrl) patch.reportPdfUrl = reportPdfUrl;
    if (reportPdfDownloadUrl) patch.reportPdfDownloadUrl = reportPdfDownloadUrl;
    if (raw?.reportPdfFilename) patch.reportPdfFilename = String(raw.reportPdfFilename);
    if (raw?.reportPdfGeneratedAt) patch.reportPdfGeneratedAt = String(raw.reportPdfGeneratedAt);
    if (raw?.reportPdfVersion) patch.reportPdfVersion = String(raw.reportPdfVersion);
    if (status === 'generating' || status === 'ready' || status === 'failed') {
      patch.reportPdfStatus = status;
    }
    if (raw?.reportPdfError) patch.reportPdfError = String(raw.reportPdfError);
    return patch;
  }, []);

  const persistSimcarClipHistoryEntry = useCallback(
    async (clip: SimcarClipHistoryItem) => {
      if (!simcarClipsRef) return;
      const clipDocRef = doc(simcarClipsRef, clip.jobId);
      const cleanClip = stripUndefinedDeep(clip);
      const lastMessage = cleanClip.analysisMessages?.[cleanClip.analysisMessages.length - 1];
      const payload = stripUndefinedDeep({
        ...cleanClip,
        kind: 'simcar_recorte',
        title: cleanClip.filename,
        files: {
          inputZipUrl: cleanClip.inputZipUrl,
          outputZipUrl: cleanClip.outputZipUrl,
          contextUrl: cleanClip.contextUrl,
          reportPdfUrl: cleanClip.reportPdfUrl,
          reportPdfDownloadUrl: cleanClip.reportPdfDownloadUrl,
        },
        analysisMessageCount: cleanClip.analysisMessages?.length ?? 0,
        analysisImageCount: cleanClip.analysisImages?.length ?? 0,
        lastMessagePreview: lastMessage?.text ? String(lastMessage.text).slice(0, 280) : '',
      });
      await setDoc(
        clipDocRef,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [simcarClipsRef]
  );

  const markSimcarClipStatus = useCallback(
    (jobId: string, status: NonNullable<SimcarClipHistoryItem['status']>, error?: string) => {
      const safeJobId = String(jobId || '').trim();
      if (!safeJobId) return;
      let patchedClip: SimcarClipHistoryItem | null = null;
      setSimcarClipHistory((prev) =>
        prev.map((clip) => {
          if (clip.jobId !== safeJobId) return clip;
          patchedClip = {
            ...clip,
            status,
            error: error ? String(error) : undefined,
          };
          return patchedClip;
        })
      );
      if (patchedClip) {
        void persistSimcarClipHistoryEntry(patchedClip).catch((persistErr) => {
          console.warn('Falha ao atualizar status do card SIMCAR:', persistErr);
        });
      }
    },
    [persistSimcarClipHistoryEntry]
  );

  const inferSimcarStageFromEndpoint = useCallback(
    (
      endpoint: string,
      sourceMode?: SimcarClipHistoryItem['sourceMode'],
    ): { stage?: SimcarClipHistoryItem['processingStage']; message?: string } => {
      const normalizedEndpoint = String(endpoint || '').trim().toLowerCase();
      const isVectorized = sourceMode === 'vectorized-analysis';
      if (normalizedEndpoint === '/api/simcar/clip') {
        return {
          stage: 'importing',
          message: 'Recorte base em processamento no servidor...',
        };
      }
      if (normalizedEndpoint === '/api/simcar/clip/analyze') {
        return {
          stage: isVectorized ? 'acavn' : undefined,
          message: 'Análise AC/AVN em processamento no servidor...',
        };
      }
      if (normalizedEndpoint === '/api/simcar/clip/analyze-auas') {
        return {
          stage: isVectorized ? 'auas' : undefined,
          message: 'Análise AUAS em processamento no servidor...',
        };
      }
      if (normalizedEndpoint === '/api/simcar/clip/analyze/chat') {
        return {
          stage: undefined,
          message: 'Chat de análise em processamento...',
        };
      }
      return {};
    },
    []
  );

  const selectSimcarClipEntry = useCallback(
    (
      clip: SimcarClipHistoryItem,
      runtime?: { serverStatus?: string; serverEndpoint?: string }
    ) => {
      const isVectorized = clip.sourceMode === 'vectorized-analysis';
      const hasVectorizedFinalReport =
        Array.isArray(clip.auasAnalysisMessages) && clip.auasAnalysisMessages.length > 0;
      const runtimeStageInfo = runtime?.serverEndpoint
        ? inferSimcarStageFromEndpoint(runtime.serverEndpoint, clip.sourceMode)
        : {};
      const runtimeStatus = String(runtime?.serverStatus || '').trim().toLowerCase();
      const serverRunning = runtimeStatus === 'running' || runtimeStatus === 'cancel_requested';
      const inferredStage: NonNullable<SimcarClipHistoryItem['processingStage']> =
        clip.processingStage === 'done' || clip.processingStage === 'error' || clip.processingStage === 'auas' || clip.processingStage === 'acavn' || clip.processingStage === 'importing'
          ? clip.processingStage
          : isVectorized
            ? hasVectorizedFinalReport
              ? 'done'
              : 'acavn'
            : 'importing';
      const effectiveStage: NonNullable<SimcarClipHistoryItem['processingStage']> =
        runtimeStageInfo.stage && (runtimeStageInfo.stage === 'importing' || runtimeStageInfo.stage === 'acavn' || runtimeStageInfo.stage === 'auas' || runtimeStageInfo.stage === 'done' || runtimeStageInfo.stage === 'error')
          ? runtimeStageInfo.stage
          : inferredStage;
      const shouldResumeProcessing =
        clip.status === 'processing' ||
        (isVectorized && clip.status === 'completed' && !hasVectorizedFinalReport);

      setSimcarClipDownloadUrl(resolveBackendDownloadUrl(clip.downloadUrl, clip.outputZipUrl));
      setSimcarClipJobId(clip.jobId);
      if (clip.sourceMode === 'auto-clip' || clip.sourceMode === 'vectorized-analysis') {
        setSimcarClipMode(clip.sourceMode);
      }
      setSimcarClipSummary(
        clip.summary || {
          totalFeaturesClipped: clip.totalFeatures,
          propertyAreaHa: clip.propertyAreaHa,
          layersProcessed: clip.totalLayers,
          layersWithData: clip.layersWithData,
          layers: [],
          processingTimeMs: 0,
          crs: 'EPSG:4674',
        }
      );

      setSimcarAnalysisImages(clip.analysisImages || []);
      const restoredMessages = clip.analysisMessages || [];
      setSimcarAnalysisMessages(restoredMessages);
      setSimcarThinkingText(
        restoredMessages
          .filter((msg) => msg.role === 'ai')
          .map((msg) => {
            const direct = String(msg.thinkingText || '').trim();
            if (direct) return direct;
            const text = String(msg.text || '');
            const matches = Array.from(text.matchAll(/<think>([\s\S]*?)<\/think>/gi))
              .map((item) => String(item?.[1] || '').trim())
              .filter(Boolean);
            return matches.join('\n\n');
          })
          .filter(Boolean)
          .join('\n\n---\n\n')
      );
      setSimcarThinkingHidden(false);
      setSimcarLiveThinkingText('');
      setSimcarLiveAnswerText('');
      setSimcarAuasImages(clip.auasAnalysisImages || []);
      setSimcarAuasMessages(clip.auasAnalysisMessages || []);
      setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
      setSimcarClipError(clip.error || null);

      if (shouldResumeProcessing) {
        if (isVectorized) {
          setSimcarVectorizedRunning(serverRunning);
          setSimcarClipProcessing(false);
          const nextStage = effectiveStage === 'done' ? 'acavn' : effectiveStage;
          setSimcarVectorizedStatus({
            stage: nextStage,
            message: serverRunning
              ? (
                nextStage === 'importing'
                  ? 'Importando ZIP vetorizado no servidor...'
                  : nextStage === 'acavn'
                    ? 'Análise AC/AVN em andamento no servidor...'
                    : 'Análise AUAS em andamento no servidor...'
              )
              : (
                runtimeStageInfo.message
                || (nextStage === 'auas'
                  ? 'Preparando etapa AUAS para concluir o laudo vetorizado...'
                  : 'Processamento vetorizado em recuperação automática no servidor...')
              ),
          });
          if (nextStage === 'acavn' && serverRunning) {
            setSimcarAnalysisProcessing(true);
            setSimcarAuasProcessing(false);
            setSimcarAnalysisProgress((prev) => ({
              step: 'analyzing',
              percent: Math.max(12, Math.round(Number(prev?.percent || 35))),
              message: 'Análise AC/AVN em andamento no servidor...',
            }));
            setSimcarAuasProgress(null);
          } else if (nextStage === 'auas' && serverRunning) {
            setSimcarAnalysisProcessing(false);
            setSimcarAuasProcessing(true);
            setSimcarAnalysisProgress(null);
            setSimcarAuasProgress((prev) => ({
              step: 'analyzing',
              percent: Math.max(60, Math.round(Number(prev?.percent || 72))),
              message: 'Análise AUAS em andamento no servidor...',
            }));
          } else {
            setSimcarAnalysisProcessing(false);
            setSimcarAuasProcessing(false);
            setSimcarAnalysisProgress(null);
            setSimcarAuasProgress(null);
          }
	        } else {
	          const normalizedRuntimeEndpoint = String(runtime?.serverEndpoint || '').trim().toLowerCase();
	          const runningAcAvn = serverRunning && normalizedRuntimeEndpoint === '/api/simcar/clip/analyze';
	          const runningAuas = serverRunning && normalizedRuntimeEndpoint === '/api/simcar/clip/analyze-auas';
	          const runningBaseClip = serverRunning && (
	            normalizedRuntimeEndpoint === '/api/simcar/clip' ||
	            (!normalizedRuntimeEndpoint && !runtimeStatus)
	          );
	          setSimcarClipProcessing(runningBaseClip);
	          setSimcarVectorizedRunning(false);
	          setSimcarVectorizedStatus(null);
	          setSimcarAnalysisProcessing(runningAcAvn);
	          setSimcarAuasProcessing(runningAuas);
	          setSimcarAnalysisProgress((prev) =>
	            runningAcAvn
	              ? {
	                step: 'analyzing',
	                percent: Math.max(12, Math.round(Number(prev?.percent || 35))),
	                message: runtimeStageInfo.message || 'Análise AC/AVN em andamento no servidor...',
	              }
	              : null
	          );
	          setSimcarAuasProgress((prev) =>
	            runningAuas
	              ? {
	                step: 'analyzing',
	                percent: Math.max(60, Math.round(Number(prev?.percent || 72))),
	                message: runtimeStageInfo.message || 'Análise AUAS em andamento no servidor...',
	              }
	              : null
	          );
	          setSimcarClipProgress((prev) => {
	            if (!runningBaseClip) return null;
	            return prev || {
	              current: 1,
	              total: Math.max(1, Number(clip.totalLayers || 1)),
	              layer: 'Processando',
	              status: 'fetching',
	            };
	          });
	        }
        return;
      }

      setSimcarAuasProcessing(false);
      setSimcarClipProcessing(false);
      setSimcarAnalysisProcessing(false);
      setSimcarAnalysisProgress(null);
      setSimcarAuasProgress(null);
      setSimcarClipProgress(null);

      if (isVectorized && hasVectorizedFinalReport) {
        setSimcarVectorizedRunning(false);
        setSimcarVectorizedStatus({
          stage: 'done',
          message: 'Análise completa finalizada com sucesso.',
        });
        setSimcarUnifiedProgressDisplay(100);
      } else if (clip.status === 'failed' || clip.status === 'cancelled') {
        setSimcarVectorizedRunning(false);
        setSimcarVectorizedStatus(
          isVectorized
            ? {
              stage: 'error',
              message:
                clip.error ||
                (clip.status === 'cancelled'
                  ? 'Processamento vetorizado cancelado.'
                  : 'Processamento vetorizado falhou.'),
            }
            : null
        );
      } else {
        setSimcarVectorizedRunning(false);
        setSimcarVectorizedStatus(null);
      }
    },
    [inferSimcarStageFromEndpoint]
  );

  const patchPersistedSimcarClip = useCallback(
    async (jobId: string, patch: Partial<SimcarClipHistoryItem>) => {
      if (!simcarClipsRef || !jobId) return;
      const clipDocRef = doc(simcarClipsRef, jobId);
      const cleanPatch = stripUndefinedDeep(patch);
      const lastMessage =
        Array.isArray(cleanPatch.analysisMessages) && cleanPatch.analysisMessages.length > 0
          ? cleanPatch.analysisMessages[cleanPatch.analysisMessages.length - 1]
          : undefined;
      const enrichedPatch = stripUndefinedDeep({
        ...cleanPatch,
        analysisMessageCount: Array.isArray(cleanPatch.analysisMessages)
          ? cleanPatch.analysisMessages.length
          : undefined,
        analysisImageCount: Array.isArray(cleanPatch.analysisImages) ? cleanPatch.analysisImages.length : undefined,
        lastMessagePreview: lastMessage?.text ? String(lastMessage.text).slice(0, 280) : undefined,
      });
      await setDoc(
        clipDocRef,
        {
          ...enrichedPatch,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [simcarClipsRef]
  );

  const appendSimcarEntriesToConversation = useCallback(
    async (
      _clip: SimcarClipHistoryItem,
      _entries: SimcarConversationEntry[],
      _options?: { title?: string },
    ) => {
      // Chat removido — escrita fantasma desativada para economizar Firestore/Cloudinary
      return null;
    },
    [] // sem dependências — função é no-op
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          setSimcarClipsRef(null);
          setVerticesJobsRef(null);
          setCbersHistory([]);
          setLandsatHistory([]);
          setVerticesHistory([]);
          setCbersJobId(null);
          setCbersProcessing(false);
          setLandsatJobId(null);
          setLandsatProcessing(false);
          setLocation('/');
          return;
        }

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (!userDocSnap.exists()) {
          await signOut(auth);
          toast.error('Conta sem cadastro no sistema. Entre em contato com o suporte.');
          setLocation('/');
          return;
        }
        setUserProfile(userDocSnap.data() as UserProfile);

        const collRef = collection(db, 'users', currentUser.uid, 'conversations');
        setConversationsRef({ collection: collRef });
        const simcarRef = collection(db, 'users', currentUser.uid, 'simcar_clips');
        setSimcarClipsRef(simcarRef);
        const verticesRef = collection(db, 'users', currentUser.uid, 'vertices_jobs');
        setVerticesJobsRef(verticesRef);
        const cbersRef = collection(db, 'users', currentUser.uid, 'cbers_wpm_jobs');
        const landsatRef = collection(db, 'users', currentUser.uid, 'landsat_jobs');

        const nextSettingsRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
        setSettingsRef(nextSettingsRef);
        const settingsSnap = await getDoc(nextSettingsRef);
        if (settingsSnap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(settingsSnap.data() as Partial<UserSettings>) });
        } else {
          await setDoc(nextSettingsRef, DEFAULT_SETTINGS, { merge: true });
        }

        const qs = query(collRef, orderBy('updatedAt', 'desc'));
        const snap = await getDocs(qs);
        const list: Conversation[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            title: data.title || 'Nova conversa',
            updatedAt: data.updatedAt,
            lastMessagePreview: data.lastMessagePreview,
            lastAttachmentType: (data as any).lastAttachmentType,
            kind: typeof data?.kind === 'string' ? data.kind : undefined,
            simcarJobId: typeof data?.simcarJobId === 'string' ? data.simcarJobId : undefined,
            verticesJobId: typeof data?.verticesJobId === 'string' ? data.verticesJobId : undefined,
            auasJobId: typeof data?.auasJobId === 'string' ? data.auasJobId : undefined,
          });
        });

        try {
          const simcarSnap = await getDocs(query(simcarRef, orderBy('updatedAt', 'desc')));
          const clips: SimcarClipHistoryItem[] = [];
          simcarSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const outputZipUrl = data?.outputZipUrl
              ? String(data.outputZipUrl)
              : data?.files?.outputZipUrl
                ? String(data.files.outputZipUrl)
                : undefined;
            const normalizedDownloadUrl = resolveBackendDownloadUrl(data?.downloadUrl, outputZipUrl);
            const summary = normalizeSimcarClipSummary(data?.summary);
            clips.push({
              id: String(data?.id || docSnap.id),
              timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
              filename: String(data?.filename || 'Recorte SIMCAR'),
              downloadUrl: normalizedDownloadUrl,
              totalFeatures: Number(data?.totalFeatures || 0),
              propertyAreaHa: Number(data?.propertyAreaHa || 0),
              layersWithData: Number(data?.layersWithData || 0),
              totalLayers: Number(data?.totalLayers || 0),
              jobId: String(data?.jobId || docSnap.id),
              conversationId: data?.conversationId ? String(data.conversationId) : undefined,
              inputZipUrl: data?.inputZipUrl
                ? String(data.inputZipUrl)
                : data?.files?.inputZipUrl
                  ? String(data.files.inputZipUrl)
                  : undefined,
              outputZipUrl,
              contextUrl: data?.contextUrl
                ? String(data.contextUrl)
                : data?.files?.contextUrl
                  ? String(data.files.contextUrl)
                  : undefined,
              sourceMode:
                data?.sourceMode === 'vectorized-analysis'
                  ? 'vectorized-analysis'
                  : data?.sourceMode === 'auto-clip'
                    ? 'auto-clip'
                    : undefined,
              processingStage:
                data?.processingStage === 'importing' ||
                  data?.processingStage === 'acavn' ||
                  data?.processingStage === 'auas' ||
                  data?.processingStage === 'done' ||
                  data?.processingStage === 'error'
                  ? data.processingStage
                  : undefined,
              analysisImages: Array.isArray(data?.analysisImages) ? data.analysisImages : [],
              analysisMessages: Array.isArray(data?.analysisMessages) ? data.analysisMessages : [],
              analysisMeta: isPlainObject(data?.analysisMeta)
                ? (data.analysisMeta as SimcarAcAvnAnalysisMeta)
                : undefined,
              auasAnalysisImages: Array.isArray(data?.auasAnalysisImages) ? data.auasAnalysisImages : [],
              auasAnalysisMessages: Array.isArray(data?.auasAnalysisMessages) ? data.auasAnalysisMessages : [],
              auasMeta: isPlainObject(data?.auasMeta) ? (data.auasMeta as SimcarAuasMeta) : undefined,
              ...normalizeSimcarReportPatch(data),
              summary:
                summary
                || {
                  propertyAreaHa: Number(data?.propertyAreaHa || 0),
                  crs: 'EPSG:4674',
                  layersProcessed: Number(data?.totalLayers || 0),
                  layersWithData: Number(data?.layersWithData || 0),
                  totalFeaturesClipped: Number(data?.totalFeatures || 0),
                  processingTimeMs: Number(data?.processingTimeMs || 0),
                  layers: [],
                },
              status: (() => {
                const parsed =
                  data?.status === 'processing' || data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled'
                    ? data.status
                    : undefined;
                const sourceMode = data?.sourceMode === 'vectorized-analysis' ? 'vectorized-analysis' : data?.sourceMode;
                const hasAcAvnResult = Array.isArray(data?.analysisMessages) && data.analysisMessages.length > 0;
                const hasAuasResult = Array.isArray(data?.auasAnalysisMessages) && data.auasAnalysisMessages.length > 0;
                const hasReportResult =
                  data?.reportPdfStatus === 'ready' ||
                  data?.reportPdfStatus === 'failed' ||
                  Boolean(data?.reportPdfUrl || data?.files?.reportPdfUrl);
                if (
                  parsed === 'processing' &&
                  sourceMode !== 'vectorized-analysis' &&
                  (hasAcAvnResult || hasAuasResult || hasReportResult)
                ) {
                  return 'completed';
                }
                if (
                  parsed === 'completed' &&
                  data?.sourceMode === 'vectorized-analysis' &&
                  (!Array.isArray(data?.auasAnalysisMessages) || data.auasAnalysisMessages.length === 0)
                ) {
                  return 'processing';
                }
                return parsed;
              })(),
              error: data?.error ? String(data.error) : undefined,
            });
          });
          setSimcarClipHistory(clips);
          if (clips.length > 0) {
            const processingFirst = clips.find((clip) => clip.status === 'processing');
            selectSimcarClipEntry(processingFirst || clips[0]);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico SIMCAR salvo:', error);
        }

        try {
          const verticesSnap = await getDocs(query(verticesRef, orderBy('updatedAtMs', 'desc')));
          const verticesEntries: VerticesHistoryItem[] = [];
          verticesSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const item = mapVerticesDocToHistoryItem(docSnap.id, data);
            if (item.status !== 'uploaded' && item.status !== 'deleted') verticesEntries.push(item);
          });
          setVerticesHistory(verticesEntries);
          const runningVertices = verticesEntries.find((entry) => entry.status === 'processing');
          if (runningVertices) {
            setActiveView('vertices-proximas');
            setVerticesProcessing(true);
            setVerticesJobId(runningVertices.jobId);
            setVerticesProgress({
              stage: runningVertices.stage || runningVertices.status,
              percent: runningVertices.percent,
              message: runningVertices.message || 'Processamento em andamento.',
            });
            setVerticesWarnings(runningVertices.warnings || []);
            setVerticesRows(runningVertices.resultRows || []);
            setVerticesDownloadUrl(runningVertices.downloadUrl || null);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico de vértices salvo:', error);
        }

        try {
          const cbersSnap = await getDocs(query(cbersRef, orderBy('updatedAtMs', 'desc')));
          const cbersEntries: CbersHistoryItem[] = [];
          cbersSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            cbersEntries.push(mapCbersDocToHistoryItem(docSnap.id, data));
          });
          setCbersHistory(cbersEntries);
          const runningCbers = cbersEntries.find((entry) => entry.status === 'processing');
          if (runningCbers) {
            selectCbersHistoryEntry(runningCbers);
          } else if (cbersEntries.length > 0) {
            selectCbersHistoryEntry(cbersEntries[0]);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico CBERS salvo:', error);
        }

        try {
          const landsatSnap = await getDocs(query(landsatRef, orderBy('updatedAtMs', 'desc')));
          const landsatEntries: LandsatHistoryItem[] = [];
          landsatSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            landsatEntries.push(mapLandsatDocToHistoryItem(docSnap.id, data));
          });
          setLandsatHistory(landsatEntries);
          const runningLandsat = landsatEntries.find((entry) => entry.status === 'processing');
          if (runningLandsat) {
            selectLandsatHistoryEntry(runningLandsat);
          } else if (landsatEntries.length > 0) {
            selectLandsatHistoryEntry(landsatEntries[0]);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico Landsat salvo:', error);
        }

        if (list.length === 0) {
          await createConversation(collRef);
        } else {
          setConversations(list);
          const preferred = list.find((item) => item.kind !== 'simcar_recorte' && item.kind !== 'novo_car') || list[0];
          await loadConversation(collRef, preferred.id);
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        toast.error('Erro ao carregar perfil do usuário');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [mapCbersDocToHistoryItem, mapLandsatDocToHistoryItem, mapVerticesDocToHistoryItem, normalizeSimcarClipSummary, normalizeSimcarReportPatch, selectCbersHistoryEntry, selectLandsatHistoryEntry, selectSimcarClipEntry, setLocation]);

  useEffect(() => {
    const uid = String(userProfile?.uid || '').trim();
    if (!uid) {
      runningProcessingJobsCountRef.current = 0;
      toast.dismiss('processing-running-jobs');
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const jobsRef = collection(db, 'users', uid, 'processing_jobs');
        const jobsSnap = await getDocs(query(jobsRef, orderBy('updatedAtMs', 'desc')));
        if (!active) return;
        const runningCount = jobsSnap.docs.filter((docSnap: any) => {
          const status = String((docSnap.data() as any)?.status || '').trim().toLowerCase();
          return status === 'running' || status === 'cancel_requested';
        }).length;
        const previousCount = runningProcessingJobsCountRef.current;
        runningProcessingJobsCountRef.current = runningCount;

        if (runningCount > 0) {
          toast.info(
            `${runningCount} processamento(s) em andamento no servidor.`,
            { id: 'processing-running-jobs' }
          );
          return;
        }
        toast.dismiss('processing-running-jobs');
        if (previousCount > 0 && runningCount === 0) {
          toast.success('Processamentos em andamento foram finalizados.');
        }
      } catch {
        // ignore polling failures
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [userProfile?.uid]);

  useEffect(() => {
    const uid = String(userProfile?.uid || '').trim();
    const activeClip = activeSimcarClip;
    const activeClipJobId = String(activeClip?.jobId || '').trim();
    if (!uid || !activeClip || !activeClipJobId) {
      setSimcarServerRuntimeState(null);
      return;
    }

    let alive = true;
    const pollClipServerState = async () => {
      try {
        const jobsRef = collection(db, 'users', uid, 'processing_jobs');
        const jobsSnap = await getDocs(query(jobsRef, orderBy('updatedAtMs', 'desc')));
        if (!alive) return;

        const related = jobsSnap.docs
          .map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((data: any) => {
            const endpoint = String(data?.endpoint || '').trim().toLowerCase();
            const clipJobId = String(data?.metadata?.clipJobId || '').trim();
            return clipJobId === activeClipJobId && endpoint.startsWith('/api/simcar/clip');
          })
          .sort((a: any, b: any) => Number(b?.updatedAtMs || 0) - Number(a?.updatedAtMs || 0));
        if (related.length === 0) {
          setSimcarServerRuntimeState(null);
          return;
        }

        const latest = related[0];
        const latestStatus = String(latest?.status || '').trim().toLowerCase();
        const endpoint = String(latest?.endpoint || '').trim();
        const normalizedLatestEndpoint = endpoint.toLowerCase();
        const hasRunningJob = related.some((item: any) => {
          const status = String(item?.status || '').trim().toLowerCase();
          return status === 'running' || status === 'cancel_requested';
        });
        const hasCompletedImport = related.some((item: any) => {
          const status = String(item?.status || '').trim().toLowerCase();
          const normalizedEndpoint = String(item?.endpoint || '').trim().toLowerCase();
          return status === 'completed' && normalizedEndpoint === '/api/simcar/clip/import-vectorized';
        });
        const hasCompletedAnalyze = related.some((item: any) => {
          const status = String(item?.status || '').trim().toLowerCase();
          const normalizedEndpoint = String(item?.endpoint || '').trim().toLowerCase();
          const imageOnly = item?.metadata?.imageOnly === true;
          return status === 'completed' && normalizedEndpoint === '/api/simcar/clip/analyze' && !imageOnly;
        });
        const hasCompletedAuas = related.some((item: any) => {
          const status = String(item?.status || '').trim().toLowerCase();
          const normalizedEndpoint = String(item?.endpoint || '').trim().toLowerCase();
          return status === 'completed' && normalizedEndpoint === '/api/simcar/clip/analyze-auas';
        });
        setSimcarServerRuntimeState({
          latestStatus,
          latestEndpoint: normalizedLatestEndpoint,
          hasRunningJob,
          hasCompletedImport,
          hasCompletedAnalyze,
          hasCompletedAuas,
        });

        const stageInfo = inferSimcarStageFromEndpoint(endpoint, activeClip.sourceMode);
        const hasFinalVectorizedReport =
          activeClip.sourceMode === 'vectorized-analysis' &&
          Array.isArray(activeClip.auasAnalysisMessages) &&
          activeClip.auasAnalysisMessages.length > 0;

        const patch: Partial<SimcarClipHistoryItem> = {};
        if (latestStatus === 'running' || latestStatus === 'cancel_requested') {
          patch.status = 'processing';
          if (stageInfo.stage) patch.processingStage = stageInfo.stage;
          patch.error = undefined;
        } else if (latestStatus === 'failed' || latestStatus === 'cancelled') {
          patch.status = latestStatus === 'failed' ? 'failed' : 'cancelled';
          if (activeClip.sourceMode === 'vectorized-analysis') patch.processingStage = 'error';
          patch.error = String(latest?.error || '').trim() || activeClip.error;
        } else if (latestStatus === 'completed') {
          if (normalizedLatestEndpoint === '/api/simcar/clip/analyze-auas') {
            if (activeClip.sourceMode === 'vectorized-analysis') {
              patch.status = hasFinalVectorizedReport ? 'completed' : activeClip.status || 'processing';
              if (hasFinalVectorizedReport) {
                patch.processingStage = 'done';
              }
            } else {
              patch.status = 'completed';
            }
            patch.error = undefined;
          } else if (normalizedLatestEndpoint === '/api/simcar/clip/analyze') {
            if (activeClip.sourceMode === 'vectorized-analysis' && !hasFinalVectorizedReport) {
              patch.status = 'processing';
              patch.processingStage = 'auas';
              patch.error = undefined;
            } else {
              patch.status = 'completed';
              patch.error = undefined;
            }
          } else if (
            normalizedLatestEndpoint === '/api/simcar/clip' ||
            normalizedLatestEndpoint === '/api/simcar/clip/import-vectorized'
          ) {
            patch.status = activeClip.sourceMode === 'vectorized-analysis' ? activeClip.status : 'completed';
            if (activeClip.sourceMode === 'vectorized-analysis' && !hasFinalVectorizedReport) {
              patch.processingStage = activeClip.processingStage || 'acavn';
            }
            patch.error = undefined;
          }
        }

        if (Object.keys(patch).length === 0) return;
        const changed =
          (patch.status && patch.status !== activeClip.status) ||
          (patch.processingStage && patch.processingStage !== activeClip.processingStage) ||
          (typeof patch.error !== 'undefined' && patch.error !== activeClip.error);
        if (!changed) return;

        const nextClip = { ...activeClip, ...patch };
        setSimcarClipHistory((prev) =>
          prev.map((clip) => (clip.jobId === activeClipJobId ? { ...clip, ...patch } : clip))
        );
        void persistSimcarClipHistoryEntry(nextClip).catch(() => undefined);
        selectSimcarClipEntry(nextClip, {
          serverStatus: latestStatus,
          serverEndpoint: endpoint,
        });
      } catch {
        // best-effort polling
      }
    };

    void pollClipServerState();
    const intervalId = window.setInterval(() => {
      void pollClipServerState();
    }, 8000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [
    activeSimcarClip,
    inferSimcarStageFromEndpoint,
    persistSimcarClipHistoryEntry,
    selectSimcarClipEntry,
    setSimcarServerRuntimeState,
    userProfile?.uid,
  ]);

  useEffect(() => {
    if (loading || !auth.currentUser) return;
    void loadBillingMe();
    void loadBillingPricing();
    void loadBillingLedger();
  }, [loading, loadBillingLedger, loadBillingMe, loadBillingPricing]);

  useEffect(() => {
    if (activeView !== 'settings' || !auth.currentUser) return;
    void loadBillingMe();
    void loadBillingLedger();
  }, [activeView, loadBillingLedger, loadBillingMe]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!modelMenuRef.current) return;
      if (!modelMenuRef.current.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    // Chat removido — scroll não é mais necessário aqui
    // mantido vazio pra não quebrar hooks
  }, [messages, activeView]);

  useEffect(() => {
    // Chat removido — sem animação de digitação
  }, [typingText, liveThinkingText, typingMessageId, aiThinking, activeView]);

  useEffect(() => {
    if (simcarThinkingHidden) return;
    const target = simcarThinkingPanelRef.current;
    if (!target) return;
    const raf = window.requestAnimationFrame(() => {
      target.scrollTop = target.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    simcarThinkingText,
    simcarLiveThinkingText,
    simcarAnalysisProcessing,
    simcarAnalysisSending,
    simcarThinkingHidden,
  ]);

  useEffect(() => {
    const target = simcarLiveAnswerPanelRef.current;
    if (!target) return;
    const raf = window.requestAnimationFrame(() => {
      target.scrollTop = target.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [simcarLiveAnswerText, simcarAnalysisSending]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty('--app-font-size', settings.fontSize === 'Pequeno' ? '14px' : settings.fontSize === 'Grande' ? '17px' : '15px');

    if (settings.theme === 'Claro (Dia)') {
      body.classList.add('theme-light');
    } else {
      body.classList.remove('theme-light');
    }
  }, [settings.theme, settings.fontSize]);

  useEffect(() => {
    if (thinkingTypingTimerRef.current) {
      window.clearInterval(thinkingTypingTimerRef.current);
      thinkingTypingTimerRef.current = null;
    }

    if (!liveThinkingTarget) {
      setLiveThinkingText('');
      return;
    }

    if (liveThinkingTarget.length < liveThinkingText.length) {
      setLiveThinkingText(liveThinkingTarget);
      return;
    }

    thinkingTypingTimerRef.current = window.setInterval(() => {
      setLiveThinkingText((prev) => {
        if (prev.length >= liveThinkingTarget.length) {
          if (thinkingTypingTimerRef.current) {
            window.clearInterval(thinkingTypingTimerRef.current);
            thinkingTypingTimerRef.current = null;
          }
          return prev;
        }
        return liveThinkingTarget.slice(0, prev.length + 1);
      });
    }, 24);

    return () => {
      if (thinkingTypingTimerRef.current) {
        window.clearInterval(thinkingTypingTimerRef.current);
        thinkingTypingTimerRef.current = null;
      }
    };
  }, [liveThinkingTarget, liveThinkingText.length]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);


  useEffect(() => {
    if (aiThinking || typingMessageId) {
      if (processingTimerRef.current) {
        window.clearInterval(processingTimerRef.current);
      }
      processingTimerRef.current = window.setInterval(() => {
        setProcessingHintIndex((prev) => (prev + 1) % 4);
      }, 1300);
    } else if (processingTimerRef.current) {
      window.clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
      setProcessingHintIndex(0);
    }

    return () => {
      if (processingTimerRef.current) {
        window.clearInterval(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    };
  }, [aiThinking, typingMessageId]);

  const createConversation = async (collRef?: ReturnType<typeof collection>) => {
    const ref = collRef || conversationsRef?.collection;
    if (!ref) return;

    const id = nanoid();
    const docRef = doc(ref, id);
    const initialMessages = [DEFAULT_ASSISTANT_MESSAGE];
    await setDoc(docRef, {
      title: 'Nova conversa',
      messages: sanitizeMessagesForFirestore(initialMessages),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessagePreview: '',
      lastAttachmentType: null,
    });

    const nextConv: Conversation = {
      id,
      title: 'Nova conversa',
      lastMessagePreview: '',
      lastAttachmentType: undefined,
    };
    setConversations((prev) => [nextConv, ...prev]);
    setActiveConversationId(id);
    setActiveConversationRef(docRef);
    setMessages(initialMessages);
    setActiveView('simcar-clip');
  };

  const loadConversation = async (collRef: ReturnType<typeof collection>, id: string) => {
    const docRef = doc(collRef, id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as { messages?: ChatMessage[]; title?: string };
      const rawMessages = data.messages?.length ? data.messages : [DEFAULT_ASSISTANT_MESSAGE];
      const normalizedMessages = rawMessages.map((msg) => {
        if (msg.meta?.fileType !== 'pdf') return msg;
        const downloadUrl = msg.meta.fileDownloadUrl || toCloudinaryDownloadUrl(msg.meta.fileUrl);
        if (downloadUrl === msg.meta.fileDownloadUrl) return msg;
        return {
          ...msg,
          meta: {
            ...(msg.meta || {}),
            fileDownloadUrl: downloadUrl,
          },
        };
      });
      setMessages(normalizedMessages);
      messagesRef.current = normalizedMessages;

      const hadLegacyPdfWithoutDownload = normalizedMessages.some(
        (msg, idx) => msg.meta?.fileType === 'pdf' && normalizedMessages[idx].meta?.fileDownloadUrl !== rawMessages[idx]?.meta?.fileDownloadUrl
      );
      if (hadLegacyPdfWithoutDownload) {
        await setDoc(
          docRef,
          { messages: sanitizeMessagesForFirestore(normalizedMessages), updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
    } else {
      setMessages([DEFAULT_ASSISTANT_MESSAGE]);
      messagesRef.current = [DEFAULT_ASSISTANT_MESSAGE];
    }
    setActiveConversationId(id);
    setActiveConversationRef(docRef);
    setActiveView('simcar-clip');
    setIsSidebarOpen(false);
  };

  const onSelectConversation = async (id: string) => {
    if (!conversationsRef) return;
    await loadConversation(conversationsRef.collection, id);
    // Close sidebar on mobile after selecting a conversation
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const onDeleteConversation = async (id: string) => {
    if (!conversationsRef) return;

    try {
      await deleteDoc(doc(conversationsRef.collection, id));
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);

      if (activeConversationId === id) {
        if (remaining.length > 0) {
          await loadConversation(conversationsRef.collection, remaining[0].id);
        } else {
          await createConversation(conversationsRef.collection);
        }
      }

      toast.success('Chat excluído');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao excluir chat');
    }
  };

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await handleLogout();
      toast.success('Logout realizado com sucesso');
      setLocation('/');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao fazer logout');
    } finally {
      setLoggingOut(false);
    }
  };

  const onEditProfileName = async () => {
    const current = userProfile?.fullName || '';
    const next = window.prompt('Digite seu nome:', current)?.trim();
    if (!next || next === current || !auth.currentUser) return;
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userDocRef, { fullName: next, updatedAt: serverTimestamp() }, { merge: true });
      setUserProfile((prev) => (prev ? { ...prev, fullName: next } : prev));
      toast.success('Nome atualizado');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar nome');
    }
  };

  const onResetPassword = async () => {
    if (resettingPassword) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast.error('Usuário não autenticado');
      return;
    }

    const email = (currentUser.email || userProfile?.email || '').trim();
    if (!email) {
      toast.error('E-mail não encontrado para redefinição de senha');
      return;
    }

    setResettingPassword(true);
    try {
      const signInMethods = await fetchSignInMethodsForEmail(auth, email);
      if (signInMethods.length > 0 && !signInMethods.includes('password')) {
        const providerName = signInMethods.includes('google.com') ? 'Google' : 'provedor externo';
        toast.error(`Sua conta usa login via ${providerName}. Altere a senha diretamente no provedor.`);
        return;
      }

      await sendPasswordResetEmail(auth, email);
      toast.success(`E-mail de redefinição enviado para ${email}`);
    } catch (error: any) {
      const code = String(error?.code || '');
      switch (code) {
        case 'auth/too-many-requests':
          toast.error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
          break;
        case 'auth/invalid-email':
          toast.error('E-mail inválido.');
          break;
        case 'auth/missing-email':
          toast.error('E-mail ausente para redefinição de senha.');
          break;
        case 'auth/operation-not-allowed':
          toast.error('Redefinição de senha não habilitada no Firebase Auth (Email/Senha).');
          break;
        default:
          toast.error(error?.message || 'Erro ao enviar e-mail de redefinição.');
          break;
      }
    } finally {
      setResettingPassword(false);
    }
  };

  const clearAttachments = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setQueuedFiles([]);
  };

  const stopTypingAnimation = useCallback((clearTarget = false) => {
    if (typingAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(typingAnimationFrameRef.current);
      typingAnimationFrameRef.current = null;
    }
    if (clearTarget) {
      typingTargetRef.current = '';
      typingDisplayedRef.current = '';
    }
  }, []);

  const flushTypingNow = useCallback(
    (text: string) => {
      stopTypingAnimation(false);
      const normalized = String(text || '');
      typingTargetRef.current = normalized;
      typingDisplayedRef.current = normalized;
      setTypingText(normalized);
    },
    [stopTypingAnimation]
  );

  const queueTypingAnimation = useCallback(
    (text: string) => {
      const normalized = String(text || '');
      typingTargetRef.current = normalized;

      if (!normalized) {
        flushTypingNow('');
        return;
      }

      if (typingAnimationFrameRef.current !== null) return;

      const nextStep = (remaining: number) => {
        if (remaining > 2000) return 120;
        if (remaining > 1200) return 80;
        if (remaining > 700) return 48;
        if (remaining > 350) return 28;
        if (remaining > 160) return 16;
        return 8;
      };

      const animate = () => {
        const target = typingTargetRef.current;
        const current = typingDisplayedRef.current;

        if (target === current) {
          typingAnimationFrameRef.current = null;
          return;
        }

        const next = !target.startsWith(current)
          ? target
          : target.slice(0, current.length + nextStep(target.length - current.length));

        typingDisplayedRef.current = next;
        setTypingText(next);

        if (next !== typingTargetRef.current || typingDisplayedRef.current !== typingTargetRef.current) {
          typingAnimationFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        typingAnimationFrameRef.current = null;
      };

      typingAnimationFrameRef.current = window.requestAnimationFrame(animate);
    },
    [flushTypingNow]
  );

  const resetChatGenerationUi = useCallback(() => {
    setAiThinking(false);
    setTypingMessageId(null);
    flushTypingNow('');
    stopTypingAnimation(true);
    setLiveThinkingText('');
    setLiveThinkingTarget('');
    setUploading(false);
  }, [flushTypingNow, stopTypingAnimation]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      stopTypingAnimation(true);
    };
  }, [stopTypingAnimation]);

  const onStopChatGeneration = useCallback(async () => {
    const processJobId = chatProcessJobIdRef.current;
    if (processJobId) {
      await requestProcessCancel(processJobId);
      chatProcessJobIdRef.current = null;
    }
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setSending(false);
    resetChatGenerationUi();
    setChatError('Cancelamento solicitado. Cobrança proporcional aplicada.');
    toast.info('Cancelamento solicitado.');
  }, [requestProcessCancel, resetChatGenerationUi]);

  const onRetryLastPrompt = useCallback(() => {
    if (!lastPromptText.trim()) return;
    setInput(lastPromptText);
    setChatError(null);
    window.requestAnimationFrame(() => chatTextareaRef.current?.focus());
  }, [lastPromptText]);

  const copyMessageToClipboard = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((prev) => (prev === messageId ? null : prev));
      }, 1800);
    } catch {
      toast.error('Nao foi possivel copiar a mensagem.');
    }
  }, []);

  const onPickAttachment = (files: File[]) => {
    if (!files.length) {
      clearAttachments();
      return;
    }
    const valid: File[] = [];
    let invalidCount = 0;
    for (const file of files) {
      const mime = (file.type || '').toLowerCase();
      const name = (file.name || '').toLowerCase();
      const isImage = mime.startsWith('image/');
      const isPdf = mime === 'application/pdf' || name.endsWith('.pdf') || mime.includes('pdf');
      if (isImage || isPdf) valid.push(file);
      else invalidCount += 1;
    }
    if (!valid.length) {
      toast.error('Selecione imagem(s) e/ou PDF(s)');
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setQueuedFiles(valid.slice(0, 10));
    if (invalidCount > 0) {
      toast.error(`${invalidCount} arquivo(s) ignorado(s): formato não suportado.`);
    }
  };

  const downloadAttachment = useCallback((meta?: ChatMessage['meta']) => {
    if (!meta) return;
    const isImage = meta.fileType === 'image';
    const fileName = meta.fileName || (isImage ? 'imagem-anexada.png' : 'documento.pdf');
    const sourceUrl = isImage ? meta.imageUrl || meta.fileDownloadUrl : meta.fileDownloadUrl || meta.fileUrl;
    if (!sourceUrl) return;

    if (sourceUrl.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = sourceUrl;
      a.download = fileName;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    window.open(toFileProxyUrl(sourceUrl, fileName, 'download'), '_blank', 'noopener,noreferrer');
  }, []);

  const downloadSimcarZip = useCallback(async (url?: string | null, filename = 'SIMCAR_Recorte.zip') => {
    const rawUrl = String(url || '').trim();
    const resolved = resolveBackendUrl(rawUrl);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'SIMCAR_Recorte.zip';
    if (!resolved) {
      toast.error('Link do ZIP indisponível. Processe o recorte novamente.');
      return;
    }

    const isBackendApiDownload = rawUrl.startsWith('/api/') || (() => {
      try {
        const parsed = new URL(resolved, window.location.origin);
        return parsed.pathname.startsWith('/api/') && parsed.origin === new URL(apiUrl('/api/health'), window.location.origin).origin;
      } catch {
        return false;
      }
    })();

    if (!isBackendApiDownload) {
      const a = document.createElement('a');
      a.href = resolved;
      a.download = safeFilename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado. Faça login novamente para baixar o ZIP.');
      const token = await user.getIdToken();
      const response = await fetch(resolved, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await readApiError(response);
        throw new Error(payload?.error || `Falha ao baixar ZIP (${response.status}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = safeFilename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success('Download do ZIP iniciado.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao baixar ZIP.');
    }
  }, [readApiError]);

  const downloadLandsatWmsZip = useCallback(async (item: LandsatHistoryItem | LandsatScene) => {
    const url = landsatArchiveZipUrl(item);
    const resolved = resolveBackendUrl(url);
    if (!resolved) {
      toast.error('Link do ZIP Landsat indisponível.');
      return;
    }
    const id = (item as any)?.jobId || (item as any)?.id || (item as any)?.sceneId || 'landsat';
    setLandsatWmsDownloadingId(String(id));
    try {
      await downloadSimcarZip(url, landsatArchiveZipFilename(item));
    } finally {
      window.setTimeout(() => setLandsatWmsDownloadingId(null), 1200);
    }
  }, [downloadSimcarZip]);

  const downloadCbersWmsZip = useCallback(async (scene: CbersScene) => {
    const endpoint = scene.wmsDownloadUrl || (
      scene.archiveImageId
        ? `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(scene.archiveImageId)}`
        : `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(scene.id)}`
    );
    const resolved = resolveBackendUrl(endpoint);
    if (!resolved) {
      toast.error('Link do ZIP da imagem WMS indisponível.');
      return;
    }
    setCbersWmsDownloadingId(scene.id);
    try {
      const a = document.createElement('a');
      a.href = resolved;
      a.download = `${scene.archiveFilename || cbersOutputFilename(scene.id).replace(/\.(tif|tiff)$/i, '')}.zip`
        .replace(/[^a-zA-Z0-9._-]/g, '_') || 'CBERS_4A_WPM.zip';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('Download da imagem WMS iniciado.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao baixar ZIP da imagem WMS.');
    } finally {
      window.setTimeout(() => setCbersWmsDownloadingId(null), 1200);
    }
  }, []);

  const openSimcarPdfInNewTab = useCallback((url?: string | null) => {
    const resolved = resolveBackendUrl(url || '');
    if (!resolved) {
      toast.error('Link do PDF indisponível. Gere o relatório novamente.');
      return;
    }
    window.open(resolved, '_blank', 'noopener,noreferrer');
  }, []);

  const downloadSimcarAnalysisImage = useCallback((image?: SimcarAnalysisImage | null) => {
    const resolved = resolveBackendUrl(image?.url || '');
    if (!resolved) {
      toast.error('Imagem indisponível para download.');
      return;
    }
    const baseName = normalizeImageCaption(image?.caption || 'imagem-simcar')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80) || 'imagem-simcar';
    window.open(toFileProxyUrl(resolved, `${baseName}.png`, 'download'), '_blank', 'noopener,noreferrer');
  }, []);

  const openSimcarAnalysisImage = useCallback((image: SimcarAnalysisImage, sourceLabel?: string) => {
    if (!image?.url) return;
    setSimcarImagePreview({
      ...image,
      sourceLabel,
    });
  }, []);

  const generateSimcarReportPdf = useCallback(
    async (clip?: SimcarClipHistoryItem) => {
      const target = clip || activeSimcarClip;
      const jobId = String(target?.jobId || simcarClipJobId || '').trim();
      if (!target || !jobId) {
        toast.error('Selecione um recorte SIMCAR para gerar o PDF.');
        return;
      }
      const hasAnalysis =
        (Array.isArray(target.analysisMessages) && target.analysisMessages.length > 0) ||
        (Array.isArray(target.auasAnalysisMessages) && target.auasAnalysisMessages.length > 0) ||
        simcarAnalysisMessages.length > 0 ||
        simcarAuasMessages.length > 0;
      if (!hasAnalysis) {
        toast.error('Execute a análise por IA antes de gerar o PDF técnico.');
        return;
      }
      const generatingPatch: Partial<SimcarClipHistoryItem> = {
        reportPdfStatus: 'generating',
        reportPdfError: undefined,
      };
      setSimcarClipHistory((prev) =>
        prev.map((item) => (item.jobId === jobId ? { ...item, ...generatingPatch } : item))
      );
      void patchPersistedSimcarClip(jobId, generatingPatch).catch(() => undefined);
      try {
        const response = await apiFetch('/api/simcar/clip/report', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            contextUrl: target.contextUrl,
            outputZipUrl: target.outputZipUrl,
            force: true,
          }),
        });
        const payload = await readApiError(response);
        if (!response.ok) {
          throw new Error(payload?.error || `Erro ${response.status}`);
        }
        const reportPatch = normalizeSimcarReportPatch(payload);
        setSimcarClipHistory((prev) =>
          prev.map((item) => (item.jobId === jobId ? { ...item, ...reportPatch } : item))
        );
        await patchPersistedSimcarClip(jobId, reportPatch);
        toast.success('PDF técnico gerado.');
      } catch (err: any) {
        const message = String(err?.message || 'Falha ao gerar PDF técnico.');
        const failedPatch: Partial<SimcarClipHistoryItem> = {
          reportPdfStatus: 'failed',
          reportPdfError: message,
        };
        setSimcarClipHistory((prev) =>
          prev.map((item) => (item.jobId === jobId ? { ...item, ...failedPatch } : item))
        );
        void patchPersistedSimcarClip(jobId, failedPatch).catch(() => undefined);
        toast.error(message);
      }
    },
    [
      activeSimcarClip,
      apiFetch,
      normalizeSimcarReportPatch,
      patchPersistedSimcarClip,
      readApiError,
      simcarAnalysisMessages.length,
      simcarAuasMessages.length,
      simcarClipJobId,
    ]
  );

  const uploadImageFile = async (file: File): Promise<string | null> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
      reader.readAsDataURL(file);
    });

    const res = await apiFetch('/api/upload-image', {
      method: 'POST',
      body: JSON.stringify({
        dataUrl,
        filename: file.name,
      }),
    });

    if (!res.ok) {
      const payload = await readApiError(res);
      if (payload?.code === 'INSUFFICIENT_CREDITS') {
        handleInsufficientCredits(payload?.error);
      }
      throw new Error(payload?.error || 'Falha ao enviar imagem');
    }

    const data = await res.json();
    if (data?.billing) {
      applyBillingToWallet(data.billing as BillingResult);
    }
    return data?.secure_url || null;
  };

  const uploadPdfFile = async (
    file: File
  ): Promise<{ url: string; extractedText: string; downloadUrl: string; pages: number } | null> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler o PDF.'));
      reader.readAsDataURL(file);
    });

    const res = await apiFetch('/api/upload-file', {
      method: 'POST',
      body: JSON.stringify({
        dataUrl,
        filename: file.name,
      }),
    });

    if (!res.ok) {
      const payload = await readApiError(res);
      if (payload?.code === 'INSUFFICIENT_CREDITS') {
        handleInsufficientCredits(payload?.error);
      }
      throw new Error(payload?.error || 'Falha ao enviar PDF');
    }

    const data = await res.json();
    if (data?.billing) {
      applyBillingToWallet(data.billing as BillingResult);
    }
    if (!data?.secure_url) return null;
    return {
      url: data.secure_url as string,
      extractedText: (data.extracted_text as string) || '',
      downloadUrl: (data.download_url as string) || (data.secure_url as string),
      pages: Number(data.pages || 0),
    };
  };
























  const updateConversationMeta = async (updatedMessages: ChatMessage[], lastUserText: string) => {
    if (!activeConversationRef) return;
    const title =
      conversations.find((c) => c.id === activeConversationId)?.title || 'Nova conversa';
    const shouldSetTitle = title === 'Nova conversa' && lastUserText.trim().length > 0;
    const nextTitle = shouldSetTitle
      ? lastUserText.trim().split(/\s+/).slice(0, 6).join(' ')
      : title;

    const lastUser = [...updatedMessages].reverse().find((m) => m.role === 'user');
    const lastAttachmentType = lastUser?.meta?.fileType;

    await setDoc(
      activeConversationRef,
      {
        title: nextTitle,
        messages: sanitizeMessagesForFirestore(updatedMessages),
        updatedAt: serverTimestamp(),
        lastMessagePreview: lastUserText.slice(0, 120),
        lastAttachmentType: lastAttachmentType || null,
      },
      { merge: true }
    );

    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === activeConversationId
            ? {
              ...c,
              title: nextTitle,
              lastMessagePreview: lastUserText.slice(0, 120),
              lastAttachmentType: lastAttachmentType,
            }
            : c
        )
        .sort((a, b) => (a.id === activeConversationId ? -1 : b.id === activeConversationId ? 1 : 0))
    );
  };

  const normalizeSettingsPayload = useCallback((raw: any): UserSettings => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const themeRaw = String(source.theme || '').trim();
    const fontRaw = String(source.fontSize || '').trim();
    const normalizeEnum = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => {
      return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
    };
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      theme: normalizeEnum(themeRaw, SETTINGS_THEME_OPTIONS, DEFAULT_SETTINGS.theme),
      fontSize: normalizeEnum(fontRaw, SETTINGS_FONT_SIZE_OPTIONS, DEFAULT_SETTINGS.fontSize),
      includeMetadata: typeof source.includeMetadata === 'boolean' ? source.includeMetadata : DEFAULT_SETTINGS.includeMetadata,
      compressLarge: typeof source.compressLarge === 'boolean' ? source.compressLarge : DEFAULT_SETTINGS.compressLarge,
      alertProcessing: typeof source.alertProcessing === 'boolean' ? source.alertProcessing : DEFAULT_SETTINGS.alertProcessing,
      alertNewFeatures: typeof source.alertNewFeatures === 'boolean' ? source.alertNewFeatures : DEFAULT_SETTINGS.alertNewFeatures,
      alertFires: typeof source.alertFires === 'boolean' ? source.alertFires : DEFAULT_SETTINGS.alertFires,
      twoFactorEnabled: typeof source.twoFactorEnabled === 'boolean' ? source.twoFactorEnabled : DEFAULT_SETTINGS.twoFactorEnabled,
    };
  }, []);

  const updateSettings = useCallback(
    async (next: Partial<UserSettings>) => {
      const previous = settings;
      const updated = normalizeSettingsPayload({ ...settings, ...next });
      setSettings(updated);
      if (!settingsRef) return true;
      try {
        await setDoc(settingsRef, updated, { merge: true });
        return true;
      } catch (error: any) {
        setSettings(previous);
        toast.error(error?.message || 'Erro ao salvar preferências.');
        return false;
      }
    },
    [normalizeSettingsPayload, settings, settingsRef]
  );

  const onCopyAccountUid = useCallback(async () => {
    const uid = auth.currentUser?.uid || '';
    if (!uid) {
      toast.error('UID não disponível.');
      return;
    }
    try {
      await navigator.clipboard.writeText(uid);
      toast.success('UID copiado para a área de transferência.');
    } catch {
      toast.error('Falha ao copiar UID.');
    }
  }, []);

  const onExportSettingsJson = useCallback(() => {
    try {
      const payload = {
        version: 1,
        exportedAtIso: new Date().toISOString(),
        settings,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `geoforest_settings_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Preferências exportadas.');
    } catch {
      toast.error('Não foi possível exportar as preferências.');
    }
  }, [settings]);

  const onImportSettingsJson = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      setSettingsActionLoading('import_settings');
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const candidate = parsed?.settings ?? parsed;
        const normalized = normalizeSettingsPayload(candidate);
        const saved = await updateSettings(normalized);
        if (saved) toast.success('Preferências importadas com sucesso.');
      } catch (error: any) {
        toast.error(error?.message || 'Arquivo de preferências inválido.');
      } finally {
        setSettingsActionLoading(null);
      }
    },
    [normalizeSettingsPayload, updateSettings]
  );

  const onResetSettingsDefaults = useCallback(async () => {
    setSettingsActionLoading('reset_defaults');
    try {
      const saved = await updateSettings(DEFAULT_SETTINGS);
      if (saved) toast.success('Preferências restauradas para o padrão.');
    } finally {
      setSettingsActionLoading(null);
    }
  }, [updateSettings]);

  const onClearLocalCaches = useCallback(() => {
    try {
      window.sessionStorage.removeItem('geoforest.map.capabilities.v1');
      const localKeys = Object.keys(window.localStorage).filter((k) => k.startsWith('geoforest.'));
      for (const key of localKeys) window.localStorage.removeItem(key);
    } catch {
      // noop
    }
    toast.success('Caches locais limpos.');
  }, []);

  const onReloadBillingData = useCallback(async () => {
    setSettingsActionLoading('reload_billing');
    try {
      await Promise.all([loadBillingMe(), loadBillingPricing(), loadBillingLedger()]);
      toast.success('Dados financeiros atualizados.');
    } catch {
      toast.error('Falha ao atualizar dados financeiros.');
    } finally {
      setSettingsActionLoading(null);
    }
  }, [loadBillingLedger, loadBillingMe, loadBillingPricing]);

  const onProbeBackendHealth = useCallback(async () => {
    setSettingsActionLoading('probe_backend');
    try {
      const checks = await Promise.all([
        apiFetch('/api/health', { method: 'GET' }, { auth: false }),
        apiFetch('/api/models', { method: 'GET' }, { auth: false }),
        apiFetch('/api/billing/pricing', { method: 'GET' }, { auth: false }),
      ]);
      const allOk = checks.every((res) => res.ok);
      const summary = allOk
        ? 'API online (health/models/pricing)'
        : `Falha em ${checks.filter((res) => !res.ok).length} endpoint(s)`;
      const next = { ok: allOk, summary, checkedAtIso: new Date().toISOString() };
      setSettingsHealthCheck(next);
      if (allOk) toast.success('Conectividade com backend validada.');
      else toast.error(summary);
    } catch (error: any) {
      const next = {
        ok: false,
        summary: error?.message || 'Backend indisponível.',
        checkedAtIso: new Date().toISOString(),
      };
      setSettingsHealthCheck(next);
      toast.error(next.summary);
    } finally {
      setSettingsActionLoading(null);
    }
  }, [apiFetch]);

  const onExportLedgerCsv = useCallback(() => {
    if (!billingLedger.length) {
      toast.error('Sem transações para exportar.');
      return;
    }
    const rows = [
      ['id', 'tipo', 'valor_brl', 'modelo', 'endpoint', 'created_at'].join(','),
      ...billingLedger.map((entry) => {
        const createdAt = entry.createdAt?.toDate
          ? entry.createdAt.toDate().toISOString()
          : entry.createdAt?._seconds
            ? new Date(entry.createdAt._seconds * 1000).toISOString()
            : '';
        const safe = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        return [
          safe(entry.id),
          safe(entry.type),
          safe(Number(entry.amountBrl || 0).toFixed(4)),
          safe(entry.model || ''),
          safe(entry.endpoint || ''),
          safe(createdAt),
        ].join(',');
      }),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `geoforest_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Extrato exportado em CSV.');
  }, [billingLedger]);

  const splitThinkContent = useCallback((raw: string) => {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
    const thinkParts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = thinkRegex.exec(raw)) !== null) {
      thinkParts.push((match[1] || '').trim());
    }
    const cleanText = raw.replace(thinkRegex, '').trim();
    return {
      cleanText: cleanText || 'Desculpe, não consegui formular uma resposta.',
      thinkingText: thinkParts.join('\n\n').trim(),
    };
  }, []);

  const extractSimcarThinkingText = useCallback(
    (messages: SimcarAnalysisMessage[]) => {
      const chunks = messages
        .filter((m) => m.role === 'ai')
        .map((m) => {
          const fromMeta = (m.thinkingText || '').trim();
          if (fromMeta) return fromMeta;
          return splitThinkContent(String(m.text || '')).thinkingText.trim();
        })
        .filter(Boolean);
      return chunks.join('\n\n---\n\n');
    },
    [splitThinkContent]
  );

  const appendSimcarThinking = useCallback((nextChunk: string) => {
    const normalized = String(nextChunk || '').trim();
    if (!normalized) return;
    setSimcarThinkingText((prev) => {
      const current = prev.trim();
      if (!current) return normalized;
      const lines = current.split('\n');
      const lastLine = (lines[lines.length - 1] || '').trim();
      if (lastLine === normalized) return current;
      if (current.includes(normalized)) return current;
      return `${current}\n${normalized}`;
    });
  }, []);

  const sendSimcarFollowUpMessage = useCallback(async (userMsg: string) => {
    const baseMessages = simcarAnalysisMessages;
    const activeClip = simcarClipJobId
      ? simcarClipHistory.find((clip) => clip.jobId === simcarClipJobId)
      : undefined;
    setSimcarAnalysisMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setSimcarAnalysisSending(true);
    setSimcarLiveThinkingText('');
    setSimcarLiveAnswerText('');
    setSimcarThinkingHidden(false);

    try {
      const chatMessages = baseMessages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }));
      chatMessages.push({ role: 'user', content: userMsg });

      const response = await apiFetch('/api/simcar/clip/analyze/chat?stream=1', {
        method: 'POST',
        body: JSON.stringify({ messages: chatMessages }),
      });

      if (!response.ok) {
        const payload = await readApiError(response);
        if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
          handleInsufficientCredits(payload?.error);
          return;
        }
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => ({}));
        if (data?.billing) {
          applyBillingToWallet(data.billing as BillingResult);
        }
        const parsed = splitThinkContent(String(data?.content || data?.error || 'Sem resposta.'));
        const aiMsg: SimcarAnalysisMessage = {
          role: 'ai',
          text: parsed.cleanText,
          thinkingText: parsed.thinkingText || undefined,
        };
        if (parsed.thinkingText) {
          setSimcarThinkingText(parsed.thinkingText);
        }
        setSimcarAnalysisMessages((prev) => [...prev, aiMsg]);
        if (simcarClipJobId) {
          const nextHistory = [...baseMessages, { role: 'user' as const, text: userMsg }, aiMsg];
          void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
          if (activeClip) {
            void appendSimcarEntriesToConversation(activeClip, [
              { role: 'user', text: userMsg },
              { role: 'ai', text: aiMsg.text },
            ]);
          }
        }
        return;
      }

      if (!response.body) {
        throw new Error('Resposta sem stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamAnswer = '';
      let streamThinking = '';
      let completedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          if (event.type === 'delta') {
            streamAnswer = String(event.answerText || streamAnswer || '');
            streamThinking = String(event.thinkingText || streamThinking || '');
            setSimcarLiveAnswerText(streamAnswer);
            setSimcarLiveThinkingText(streamThinking);
            if (streamThinking.trim()) {
              setSimcarThinkingText(streamThinking.trim());
            }
          } else if (event.type === 'complete') {
            completedContent = String(event.content || '');
            streamAnswer = String(event.answerText || streamAnswer || '');
            streamThinking = String(event.thinkingText || streamThinking || '');
            setSimcarLiveAnswerText(streamAnswer);
            setSimcarLiveThinkingText(streamThinking);
            if (streamThinking.trim()) {
              setSimcarThinkingText(streamThinking.trim());
            }
          } else if (event.type === 'billing' && event.billing) {
            applyBillingToWallet(event.billing as BillingResult);
          } else if (event.type === 'error') {
            throw new Error(String(event.message || 'Erro no stream de análise.'));
          }
        }
      }

      const rawContent = completedContent
        || (streamThinking.trim()
          ? `<think>\n${streamThinking.trim()}\n</think>\n\n${streamAnswer}`
          : streamAnswer || 'Sem resposta.');
      const parsed = splitThinkContent(String(rawContent));
      const aiMsg: SimcarAnalysisMessage = {
        role: 'ai',
        text: parsed.cleanText,
        thinkingText: parsed.thinkingText || undefined,
      };

      if (parsed.thinkingText) {
        setSimcarThinkingText(parsed.thinkingText);
      }
      setSimcarAnalysisMessages((prev) => [...prev, aiMsg]);

      if (simcarClipJobId) {
        const nextHistory = [...baseMessages, { role: 'user' as const, text: userMsg }, aiMsg];
        void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
        if (activeClip) {
          void appendSimcarEntriesToConversation(activeClip, [
            { role: 'user', text: userMsg },
            { role: 'ai', text: aiMsg.text },
          ]);
        }
      }
    } catch (err: any) {
      const aiText = `❌ ${err.message || 'Erro ao processar resposta.'}`;
      setSimcarAnalysisMessages((prev) => [...prev, { role: 'ai', text: aiText }]);
      if (simcarClipJobId) {
        const nextHistory = [
          ...baseMessages,
          { role: 'user' as const, text: userMsg },
          { role: 'ai' as const, text: aiText },
        ];
        void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
        if (activeClip) {
          void appendSimcarEntriesToConversation(activeClip, [
            { role: 'user', text: userMsg },
            { role: 'ai', text: aiText },
          ]);
        }
      }
    } finally {
      setSimcarAnalysisSending(false);
      setSimcarLiveThinkingText('');
      setSimcarLiveAnswerText('');
      setTimeout(() => {
        simcarAnalysisChatRef.current?.scrollTo({ top: simcarAnalysisChatRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [
    apiFetch,
    readApiError,
    handleInsufficientCredits,
    applyBillingToWallet,
    simcarAnalysisMessages,
    splitThinkContent,
    simcarClipJobId,
    simcarClipHistory,
    patchPersistedSimcarClip,
    appendSimcarEntriesToConversation,
    simcarAnalysisChatRef,
  ]);

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo anexado.'));
      reader.readAsDataURL(file);
    });

  const readFileAsBase64Payload = async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('Falha ao preparar arquivo ZIP para envio.');
    return dataUrl.slice(comma + 1);
  };

  const runAcAvnAnalysis = useCallback(
    async (params: {
      jobId: string;
      historyEntry?: SimcarClipHistoryItem;
      layers?: string[];
      imageOnly?: boolean;
      silentOutput?: boolean;
      skipConversation?: boolean;
    }): Promise<{
      ok: boolean;
      aiMessage?: SimcarAnalysisMessage;
      analysisMeta?: SimcarAcAvnAnalysisMeta;
      images: Array<{ url: string; caption: string }>;
      error?: string;
    }> => {
      const { jobId, imageOnly = false } = params;
      const silentOutput = Boolean(params.silentOutput);
      const skipConversation = Boolean(params.skipConversation);
      const layers = Array.isArray(params.layers) && params.layers.length > 0
        ? params.layers
        : simcarFixedSatelliteKeys;
      const historyEntry = params.historyEntry || simcarClipHistory.find((c) => c.jobId === jobId);
      const result: {
        ok: boolean;
        aiMessage?: SimcarAnalysisMessage;
        analysisMeta?: SimcarAcAvnAnalysisMeta;
        images: Array<{ url: string; caption: string }>;
        error?: string;
      } = { ok: false, images: [] };

      setSimcarAnalysisProcessing(true);
      setSimcarAnalysisProgress({
        step: 'starting',
        percent: 0,
        message: imageOnly ? 'Gerando imagens...' : 'Iniciando analise...',
      });
      if (!silentOutput) setSimcarAnalysisImages([]);
      if (!imageOnly && !silentOutput) {
        setSimcarAgentLog([{ label: 'Iniciando analise...', done: false, kind: 'step' }]);
        setSimcarAnalysisMessages([]);
        setSimcarThinkingText('');
        setSimcarThinkingHidden(false);
        setSimcarLiveThinkingText('');
        setSimcarLiveAnswerText('');
      }

      try {
        const controller = new AbortController();
        simcarAnalysisAbortRef.current = controller;
        simcarAnalysisProcessJobIdRef.current = null;
        const response = await apiFetch('/api/simcar/clip/analyze', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            selectedLayers: layers,
            imageOnly: imageOnly || undefined,
            contextUrl: historyEntry?.contextUrl,
            outputZipUrl: historyEntry?.outputZipUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await readApiError(response);
          if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
            handleInsufficientCredits(payload?.error);
            return { ...result, error: payload?.error || 'Saldo insuficiente.' };
          }
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let insufficientCredits = false;
        let streamError = '';

        if (reader) {
          readLoop: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'job_started') {
                  const streamJobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
                  if (streamJobId) simcarAnalysisProcessJobIdRef.current = streamJobId;
                } else if (event.type === 'progress') {
                  const msg = normalizeBackendText(String(event.message || ''));
                  setSimcarAnalysisProgress({ step: event.step, percent: event.percent, message: msg });
                  if (!imageOnly && !silentOutput) {
                    setSimcarAgentLog((prev) => {
                      const updated = prev.map((s) => (s.done ? s : { ...s, done: true }));
                      return [...updated, { label: msg, done: false, kind: 'step' as const }];
                    });
                  }
                } else if (event.type === 'model_thinking' && !imageOnly && !silentOutput) {
                  const source = event.source ? `[${event.source}]` : '';
                  const thought = String(event.thinkingText || '').trim();
                  if (thought) {
                    appendSimcarThinking(source ? `${source}\n${thought}` : thought);
                    setSimcarThinkingHidden(false);
                    const snippet = thought.replace(/\s+/g, ' ').slice(0, 120);
                    const label = source ? `${source}: ${snippet}…` : `${snippet}…`;
                    setSimcarAgentLog((prev) => [...prev, { label, done: true, kind: 'thinking' as const }]);
                  }
                } else if (event.type === 'complete') {
                  const images = (Array.isArray(event.images) ? event.images : [])
                    .map((img: any) => ({
                      url: String(img?.url || ''),
                      caption: String(img?.caption || ''),
                    }))
                    .filter((img: { url: string; caption: string }) => img.url.length > 0);
                  const analysisMeta = isPlainObject(event.analysisMeta)
                    ? (event.analysisMeta as SimcarAcAvnAnalysisMeta)
                    : undefined;
                  result.images = images;
                  result.analysisMeta = analysisMeta;

	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    analysisImages: images,
	                    analysisMeta,
	                    ...(historyEntry?.sourceMode === 'vectorized-analysis'
	                      ? {}
	                      : { status: 'completed' as const, error: undefined }),
	                    ...normalizeSimcarReportPatch(event),
	                  };
                  let aiMessage: SimcarAnalysisMessage | undefined;
                  if (!imageOnly) {
                    const parsed = splitThinkContent(String(event.analysis || ''));
                    if (parsed.thinkingText) {
                      appendSimcarThinking(parsed.thinkingText);
                    }
                    aiMessage = {
                      role: 'ai',
                      text: parsed.cleanText,
                      thinkingText: parsed.thinkingText || undefined,
                      images: images.map((img: { url: string; caption: string }) => img.url),
                    };
                    patch.analysisMessages = [aiMessage];
                    result.aiMessage = aiMessage;
                    if (!silentOutput) {
                      setSimcarAnalysisMessages([aiMessage]);
                      setSimcarAgentLog((prev) => prev.map((s) => ({ ...s, done: true })));
                    }
                  }

                  if (!silentOutput) {
                    setSimcarAnalysisImages(images);
                  }
                  setSimcarAnalysisProgress({
                    step: 'complete',
                    percent: 100,
                    message: imageOnly ? 'Imagens geradas. Finalizando...' : 'Análise concluída. Finalizando...',
                  });
                  setSimcarClipHistory((prev) =>
                    prev.map((c) =>
                      c.jobId === jobId
                        ? {
                          ...c,
                          ...patch,
                        }
                        : c
                    )
                  );
                  void patchPersistedSimcarClip(jobId, patch);

                  const clipBase: SimcarClipHistoryItem = historyEntry
                    ? historyEntry
                    : {
                      id: jobId,
                      timestamp: new Date().toISOString(),
                      filename: `Recorte ${jobId.slice(0, 8)}`,
                      downloadUrl: '',
                      totalFeatures: 0,
                      propertyAreaHa: 0,
                      layersWithData: 0,
                      totalLayers: 0,
                      jobId,
                    };
                  const clipForConversation: SimcarClipHistoryItem = {
                    ...clipBase,
                    ...patch,
                  };
                  const imageLinks = images.map((img: { url: string; caption: string }) => `- ${img.url}`);
                  if (!skipConversation && imageOnly) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei apenas a geração de imagens para o recorte ${jobId} com as camadas: ${layers.join(', ')}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Imagens geradas para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  } else if (!skipConversation && aiMessage) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei análise AC/AVN para o recorte ${jobId} com as imagens: ${layers.join(', ')}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Análise AC/AVN concluída para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                          aiMessage.text,
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  }

                  result.ok = true;
	                } else if (event.type === 'report_error') {
	                  const message = String(event.message || 'Falha ao gerar PDF técnico.');
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    reportPdfStatus: 'failed',
	                    reportPdfError: message,
	                  };
	                  setSimcarClipHistory((prev) =>
	                    prev.map((c) => (c.jobId === jobId ? { ...c, ...patch } : c))
	                  );
	                  void patchPersistedSimcarClip(jobId, patch);
	                } else if (event.type === 'billing' && event.billing) {
                  applyBillingToWallet(event.billing as BillingResult);
                } else if (event.type === 'error') {
                  if (event?.code === 'INSUFFICIENT_CREDITS') {
                    handleInsufficientCredits(String(event.message || 'Saldo insuficiente.'));
                    insufficientCredits = true;
                    break readLoop;
                  }
                  streamError = normalizeBackendText(String(event.message || 'Erro inesperado na analise.'));
                  break readLoop;
                }
              } catch {
                // ignore malformed SSE chunk
              }
            }
          }
        }

        if (insufficientCredits) {
          return { ...result, ok: false, error: 'Saldo insuficiente.' };
        }
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result.ok) {
          throw new Error(imageOnly ? 'Falha ao gerar imagens.' : 'Falha ao concluir analise AC/AVN.');
        }
        return result;
      } catch (err: any) {
        const message = String(err?.message || (imageOnly ? 'Erro ao gerar imagens.' : 'Erro inesperado.'));
        if (!imageOnly && !silentOutput) {
          setSimcarAnalysisMessages([{ role: 'ai', text: `❌ ${message}` }]);
          if (historyEntry && !skipConversation) {
            void appendSimcarEntriesToConversation(historyEntry, [
              {
                role: 'user',
                text: `Solicitei análise AC/AVN para o recorte ${jobId} com as imagens: ${layers.join(', ')}.`,
              },
              { role: 'ai', text: `❌ ${message}` },
            ]);
          }
        } else {
          setSimcarClipError(message);
          if (historyEntry && !skipConversation) {
            void appendSimcarEntriesToConversation(historyEntry, [
              {
                role: 'user',
                text: `Solicitei apenas a geração de imagens para o recorte ${jobId} com as camadas: ${layers.join(', ')}.`,
              },
              { role: 'ai', text: `❌ ${message}` },
            ]);
          }
        }
        return { ...result, ok: false, error: message };
      } finally {
        simcarAnalysisAbortRef.current = null;
        simcarAnalysisProcessJobIdRef.current = null;
        setSimcarAnalysisProcessing(false);
        setSimcarAnalysisProgress(null);
      }
    },
    [
      apiFetch,
      appendSimcarEntriesToConversation,
      appendSimcarThinking,
      applyBillingToWallet,
      handleInsufficientCredits,
      normalizeSimcarReportPatch,
      patchPersistedSimcarClip,
      readApiError,
      simcarClipHistory,
      simcarFixedSatelliteKeys,
      splitThinkContent,
    ]
  );

  const runAuasAnalysis = useCallback(
    async (params: {
      jobId: string;
      historyEntry?: SimcarClipHistoryItem;
      previousAnalysis?: string;
      acAvnMeta?: SimcarAcAvnAnalysisMeta;
      prependContextText?: string;
      skipConversation?: boolean;
    }): Promise<{
      ok: boolean;
      aiMessage?: SimcarAnalysisMessage;
      auasMeta?: SimcarAuasMeta;
      images: Array<{ url: string; caption: string }>;
      error?: string;
    }> => {
      const { jobId } = params;
      const historyEntry = params.historyEntry || simcarClipHistory.find((c) => c.jobId === jobId);
      const prependContextText = String(params.prependContextText || '').trim();
      const skipConversation = Boolean(params.skipConversation);
      const previousAnalysis = String(
        params.previousAnalysis
        || simcarAnalysisMessages
          .filter((m) => m.role === 'ai')
          .map((m) => m.text)
          .join('\n\n---\n\n')
      );
      const acAvnMeta = params.acAvnMeta || historyEntry?.analysisMeta;
      const result: {
        ok: boolean;
        aiMessage?: SimcarAnalysisMessage;
        auasMeta?: SimcarAuasMeta;
        images: Array<{ url: string; caption: string }>;
        error?: string;
      } = { ok: false, images: [] };

      setSimcarAuasProcessing(true);
      setSimcarAuasProgress({ step: 'starting', percent: 0, message: 'Iniciando análise de AUAS...' });
      setSimcarAuasAgentLog([{ label: 'Iniciando análise AUAS...', done: false, kind: 'step' }]);
      setSimcarAuasImages([]);
      setSimcarAuasMessages([]);

      try {
        const controller = new AbortController();
        simcarAuasAbortRef.current = controller;
        simcarAuasProcessJobIdRef.current = null;
        const response = await apiFetch('/api/simcar/clip/analyze-auas', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            previousAnalysis,
            acAvnMeta: acAvnMeta || undefined,
            contextUrl: historyEntry?.contextUrl,
            outputZipUrl: historyEntry?.outputZipUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await readApiError(response);
          if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
            handleInsufficientCredits(payload?.error);
            return { ...result, error: payload?.error || 'Saldo insuficiente.' };
          }
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let insufficientCredits = false;
        let streamError = '';

        if (reader) {
          readLoop: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'job_started') {
                  const streamJobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
                  if (streamJobId) simcarAuasProcessJobIdRef.current = streamJobId;
                } else if (event.type === 'progress') {
                  const msg = normalizeBackendText(String(event.message || ''));
                  setSimcarAuasProgress({ step: event.step, percent: event.percent, message: msg });
                  setSimcarAuasAgentLog((prev) => {
                    const updated = prev.map((s) => (s.done ? s : { ...s, done: true }));
                    return [...updated, { label: msg, done: false, kind: 'step' as const }];
                  });
                } else if (event.type === 'model_thinking') {
                  const source = event.source ? `[${event.source}]` : '';
                  const thought = String(event.thinkingText || '').trim();
                  if (thought) {
                    const snippet = thought.replace(/\s+/g, ' ').slice(0, 120);
                    const label = source ? `${source}: ${snippet}…` : `${snippet}…`;
                    setSimcarAuasAgentLog((prev) => [...prev, { label, done: true, kind: 'thinking' as const }]);
                  }
                } else if (event.type === 'complete') {
                  const images = (Array.isArray(event.images) ? event.images : [])
                    .map((img: any) => ({
                      url: String(img?.url || ''),
                      caption: String(img?.caption || ''),
                    }))
                    .filter((img: { url: string; caption: string }) => img.url.length > 0);
                  const auasMeta = isPlainObject(event.auasMeta)
                    ? (event.auasMeta as SimcarAuasMeta)
                    : undefined;
                  const parsed = splitThinkContent(String(event.analysis || ''));
                  const combinedText = prependContextText
                    ? [
                      '## Analise Integrada SIMCAR (AC/AVN + AUAS)',
                      '',
                      '## Achados AC e AVN',
                      prependContextText,
                      '',
                      '## Achados AUAS',
                      parsed.cleanText,
                    ].join('\n')
                    : parsed.cleanText;
                  const aiMessage: SimcarAnalysisMessage = {
                    role: 'ai',
                    text: combinedText,
                    thinkingText: parsed.thinkingText || undefined,
                    images: images.map((img: { url: string; caption: string }) => img.url),
                  };
                  result.images = images;
                  result.aiMessage = aiMessage;
                  result.auasMeta = auasMeta;
                  result.ok = true;

                  setSimcarAuasImages(images);
                  setSimcarAuasMessages([aiMessage]);
                  setSimcarAuasProgress({
                    step: 'complete',
                    percent: 100,
                    message: 'Análise AUAS concluída. Finalizando...',
                  });
                  setSimcarAuasAgentLog((prev) => prev.map((s) => ({ ...s, done: true })));
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    auasAnalysisImages: images,
	                    auasAnalysisMessages: [aiMessage],
	                    auasMeta,
	                    ...(historyEntry?.sourceMode === 'vectorized-analysis'
	                      ? {}
	                      : { status: 'completed' as const, error: undefined }),
	                    ...normalizeSimcarReportPatch(event),
	                  };
                  setSimcarClipHistory((prev) =>
                    prev.map((c) =>
                      c.jobId === jobId
                        ? {
                          ...c,
                          ...patch,
                        }
                        : c
                    )
                  );
                  void patchPersistedSimcarClip(jobId, patch);

                  const clipBase: SimcarClipHistoryItem = historyEntry
                    ? historyEntry
                    : {
                      id: jobId,
                      timestamp: new Date().toISOString(),
                      filename: `Recorte ${jobId.slice(0, 8)}`,
                      downloadUrl: '',
                      totalFeatures: 0,
                      propertyAreaHa: 0,
                      layersWithData: 0,
                      totalLayers: 0,
                      jobId,
                    };
                  const clipForConversation: SimcarClipHistoryItem = {
                    ...clipBase,
                    ...patch,
                  };
                  const imageLinks = images.map((img: { url: string; caption: string }) => `- ${img.url}`);
                  if (!skipConversation) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei analise de AUAS para o recorte ${jobId}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Analise de AUAS concluida para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                          aiMessage.text,
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  }
	                } else if (event.type === 'report_error') {
	                  const message = String(event.message || 'Falha ao gerar PDF técnico.');
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    reportPdfStatus: 'failed',
	                    reportPdfError: message,
	                  };
	                  setSimcarClipHistory((prev) =>
	                    prev.map((c) => (c.jobId === jobId ? { ...c, ...patch } : c))
	                  );
	                  void patchPersistedSimcarClip(jobId, patch);
	                } else if (event.type === 'billing' && event.billing) {
                  applyBillingToWallet(event.billing as BillingResult);
                } else if (event.type === 'error') {
                  if (event?.code === 'INSUFFICIENT_CREDITS') {
                    handleInsufficientCredits(String(event.message || 'Saldo insuficiente.'));
                    insufficientCredits = true;
                    break readLoop;
                  }
                  streamError = normalizeBackendText(String(event.message || 'Erro inesperado na analise de AUAS.'));
                  break readLoop;
                }
              } catch {
                // ignore malformed SSE chunk
              }
            }
          }
        }

        if (insufficientCredits) {
          return { ...result, ok: false, error: 'Saldo insuficiente.' };
        }
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result.ok) {
          throw new Error('Falha ao concluir análise AUAS.');
        }
        return result;
      } catch (err: any) {
        const message = String(err?.message || 'Erro inesperado.');
        setSimcarAuasMessages([{ role: 'ai', text: `❌ ${message}` }]);
        if (historyEntry && !skipConversation) {
          void appendSimcarEntriesToConversation(historyEntry, [
            { role: 'user', text: `Solicitei analise de AUAS para o recorte ${jobId}.` },
            { role: 'ai', text: `❌ ${message}` },
          ]);
        }
        return { ...result, ok: false, error: message };
      } finally {
        simcarAuasAbortRef.current = null;
        simcarAuasProcessJobIdRef.current = null;
        setSimcarAuasProcessing(false);
        setSimcarAuasProgress(null);
      }
    },
    [
      apiFetch,
      appendSimcarEntriesToConversation,
      applyBillingToWallet,
      handleInsufficientCredits,
      normalizeSimcarReportPatch,
      patchPersistedSimcarClip,
      readApiError,
      simcarAnalysisMessages,
      simcarClipHistory,
      splitThinkContent,
    ]
  );

  useEffect(() => {
    const clip = activeSimcarClip;
    if (!clip || clip.sourceMode !== 'vectorized-analysis') return;
    const jobId = String(clip.jobId || '').trim();
    if (!jobId) return;

    const hasFinalVectorizedReport =
      Array.isArray(clip.auasAnalysisMessages) &&
      clip.auasAnalysisMessages.length > 0;
    if (hasFinalVectorizedReport) {
      if (clip.status !== 'completed' || clip.processingStage !== 'done') {
        const patch: Partial<SimcarClipHistoryItem> = {
          status: 'completed',
          processingStage: 'done',
          error: undefined,
        };
        setSimcarClipHistory((prev) =>
          prev.map((item) => (item.jobId === jobId ? { ...item, ...patch } : item))
        );
        void patchPersistedSimcarClip(jobId, patch).catch(() => undefined);
      }
      return;
    }

    if (clip.status !== 'processing') return;
    if (simcarServerRuntimeState?.hasRunningJob) return;
    if (simcarVectorizedRunning || simcarAnalysisProcessing || simcarAuasProcessing) return;
    if (simcarVectorizedResumeInFlightRef.current === jobId) return;

    const dedupeImages = (images: Array<{ url: string; caption: string }>) =>
      images.filter((img, idx, arr) => img?.url && arr.findIndex((item) => item.url === img.url) === idx);

    const existingAcAvnText = (Array.isArray(clip.analysisMessages) ? clip.analysisMessages : [])
      .filter((message) => message.role === 'ai')
      .map((message) => String(message.text || '').trim())
      .filter(Boolean)
      .join('\n\n---\n\n')
      .trim();
    const existingAcAvnMeta = clip.analysisMeta;
    const existingAcAvnImages = dedupeImages(Array.isArray(clip.analysisImages) ? clip.analysisImages : []);
    const hasAcAvnArtifacts =
      Boolean(existingAcAvnText) ||
      Boolean(existingAcAvnMeta) ||
      existingAcAvnImages.length > 0;

    simcarVectorizedResumeInFlightRef.current = jobId;
    setSimcarVectorizedRunning(true);
    setSimcarClipProcessing(false);
    setSimcarClipError(null);

    const patchClip = async (patch: Partial<SimcarClipHistoryItem>) => {
      setSimcarClipHistory((prev) =>
        prev.map((item) => (item.jobId === jobId ? { ...item, ...patch } : item))
      );
      await patchPersistedSimcarClip(jobId, patch).catch(() => undefined);
    };

    void (async () => {
      let acAvnResult: Awaited<ReturnType<typeof runAcAvnAnalysis>> | null = null;

      if (!hasAcAvnArtifacts) {
        setSimcarVectorizedStatus({
          stage: 'acavn',
          message: 'Retomando automaticamente a etapa AC/AVN...',
        });
        await patchClip({
          status: 'processing',
          processingStage: 'acavn',
          error: undefined,
        });
        acAvnResult = await runAcAvnAnalysis({
          jobId,
          historyEntry: clip,
          layers: simcarFixedSatelliteKeys,
          imageOnly: false,
          silentOutput: true,
          skipConversation: true,
        });
        if (!acAvnResult.ok) {
          const errText = acAvnResult.error || 'Falha na etapa AC/AVN.';
          setSimcarClipError(errText);
          setSimcarVectorizedStatus({ stage: 'error', message: errText });
          await patchClip({
            status: 'failed',
            processingStage: 'error',
            error: errText,
          });
          return;
        }
      }

      const acAvnMeta = acAvnResult?.analysisMeta || existingAcAvnMeta;
      const previousAnalysisText = String(acAvnResult?.aiMessage?.text || existingAcAvnText || '').trim();
      const acAvnImages = dedupeImages(acAvnResult?.images || existingAcAvnImages);

      setSimcarVectorizedStatus({
        stage: 'auas',
        message: hasAcAvnArtifacts
          ? 'AC/AVN já concluído. Continuando automaticamente para AUAS...'
          : 'Consolidando laudo único (AUAS + AC/AVN)...',
      });
      await patchClip({
        status: 'processing',
        processingStage: 'auas',
        error: undefined,
        analysisMeta: acAvnMeta,
        ...(acAvnResult?.aiMessage ? { analysisMessages: [acAvnResult.aiMessage] } : {}),
        ...(acAvnImages.length > 0 ? { analysisImages: acAvnImages } : {}),
      });

      const auasResult = await runAuasAnalysis({
        jobId,
        historyEntry: {
          ...clip,
          analysisMeta: acAvnMeta,
        },
        previousAnalysis: previousAnalysisText,
        acAvnMeta,
        skipConversation: true,
      });
      if (!auasResult.ok) {
        const errText = auasResult.error || 'Falha na etapa AUAS.';
        setSimcarClipError(errText);
        setSimcarVectorizedStatus({ stage: 'error', message: errText });
        await patchClip({
          status: 'failed',
          processingStage: 'error',
          error: errText,
        });
        return;
      }

      const auasImages = dedupeImages(auasResult.images || []);
      const mergedImages = dedupeImages([...acAvnImages, ...auasImages]);
      const rawAuasText = String(auasResult.aiMessage?.text || '').trim();
      const backendLooksIntegrated =
        /(ac\/avn|area consolidada|área consolidada)/i.test(rawAuasText) && /\bauas\b/i.test(rawAuasText);
      const finalCombinedText = previousAnalysisText && rawAuasText && !backendLooksIntegrated
        ? buildIntegratedVectorizedReport(previousAnalysisText, rawAuasText)
        : rawAuasText || buildIntegratedVectorizedReport(previousAnalysisText, rawAuasText);
      const finalAiMessage: SimcarAnalysisMessage = {
        role: 'ai',
        text: finalCombinedText,
        thinkingText: auasResult.aiMessage?.thinkingText,
        images: mergedImages.map((img) => img.url),
      };

      setSimcarAnalysisImages(acAvnImages);
      setSimcarAnalysisMessages([]);
      setSimcarAuasImages(auasImages);
      setSimcarAuasMessages([finalAiMessage]);
      setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
      await patchClip({
        status: 'completed',
        processingStage: 'done',
        error: undefined,
        analysisMeta: acAvnMeta,
        ...(acAvnResult?.aiMessage ? { analysisMessages: [acAvnResult.aiMessage] } : {}),
        ...(acAvnImages.length > 0 ? { analysisImages: acAvnImages } : {}),
        auasAnalysisImages: auasImages,
        auasAnalysisMessages: [finalAiMessage],
        auasMeta: auasResult.auasMeta,
      });
      setSimcarVectorizedStatus({
        stage: 'done',
        message: 'Análise completa finalizada com sucesso.',
      });
      toast.success('Processamento vetorizado retomado automaticamente.');
    })()
      .catch((error: any) => {
        const message = String(error?.message || 'Falha ao retomar o processamento vetorizado.');
        setSimcarClipError(message);
        setSimcarVectorizedStatus({ stage: 'error', message });
      })
      .finally(() => {
        simcarVectorizedResumeInFlightRef.current = null;
        setSimcarVectorizedRunning(false);
      });
  }, [
    activeSimcarClip,
    patchPersistedSimcarClip,
    runAcAvnAnalysis,
    runAuasAnalysis,
    simcarAnalysisProcessing,
    simcarAuasProcessing,
    simcarFixedSatelliteKeys,
    simcarServerRuntimeState,
    simcarVectorizedRunning,
  ]);

  const runVectorizedCompleteAnalysis = useCallback(async () => {
    if (!simcarClipFile) {
      toast.error('Selecione um ZIP vetorizado para continuar.');
      return;
    }
    setSimcarUnifiedProgressDisplay(0);
    setSimcarVectorizedRunning(true);
    setSimcarVectorizedStatus({ stage: 'importing', message: 'Importando ZIP vetorizado...' });
    setSimcarClipError(null);
    setSimcarClipDownloadUrl(null);
    setSimcarClipSummary(null);
    setSimcarAnalysisImages([]);
    setSimcarAnalysisMessages([]);
    setSimcarAuasImages([]);
    setSimcarAuasMessages([]);
    setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
    let pipelineJobId = '';

    const patchVectorizedHistoryState = (jobId: string, patch: Partial<SimcarClipHistoryItem>) => {
      if (!jobId) return;
      setSimcarClipHistory((prev) =>
        prev.map((clip) => (clip.jobId === jobId ? { ...clip, ...patch } : clip))
      );
      void patchPersistedSimcarClip(jobId, patch).catch(() => undefined);
    };

    try {
      const base64 = await readFileAsBase64Payload(simcarClipFile);
      const response = await apiFetch('/api/simcar/clip/import-vectorized', {
        method: 'POST',
        body: JSON.stringify({
          propertyZip: base64,
          filename: simcarClipFile.name,
        }),
      });
      const payload = await readApiError(response);
      if (!response.ok) {
        if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
          handleInsufficientCredits(payload?.error);
          setSimcarVectorizedStatus({ stage: 'error', message: payload?.error || 'Saldo insuficiente.' });
          return;
        }
        throw new Error(payload?.error || `Erro ${response.status}`);
      }

      if (payload?.billing) {
        applyBillingToWallet(payload.billing as BillingResult);
      }

      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) {
        throw new Error('Importação concluída sem jobId válido.');
      }
      pipelineJobId = jobId;
      const resolvedDownloadUrl = resolveBackendDownloadUrl(payload?.downloadUrl, payload?.outputZipUrl);
      const summary = normalizeSimcarClipSummary(payload?.summary);
      const newClip: SimcarClipHistoryItem = {
        id: jobId,
        timestamp: new Date().toISOString(),
        filename: `Análise Vetorizada ${new Date().toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        downloadUrl: resolvedDownloadUrl,
        totalFeatures: Number(summary?.totalFeaturesClipped || 0),
        propertyAreaHa: Number(summary?.propertyAreaHa || 0),
        layersWithData: Number(summary?.layersWithData || summary?.layers?.filter((l: any) => Number(l?.features || 0) > 0).length || 0),
        totalLayers: Number(summary?.layersProcessed || summary?.layers?.length || 0),
        jobId,
        conversationId: nanoid(),
        inputZipUrl: payload?.inputZipUrl ? String(payload.inputZipUrl) : undefined,
        outputZipUrl: payload?.outputZipUrl ? String(payload.outputZipUrl) : undefined,
        contextUrl: payload?.contextUrl ? String(payload.contextUrl) : undefined,
        sourceMode: 'vectorized-analysis',
        status: 'processing',
        processingStage: 'importing',
        summary: summary || undefined,
      };

      setSimcarClipJobId(jobId);
      setSimcarClipDownloadUrl(resolvedDownloadUrl || null);
      setSimcarClipSummary(summary || null);
      setSimcarClipHistory((prev) => [newClip, ...prev.filter((c) => c.jobId !== jobId)]);
      await persistSimcarClipHistoryEntry(newClip);

      patchVectorizedHistoryState(jobId, {
        status: 'processing',
        processingStage: 'acavn',
        error: undefined,
      });
      const cloudinaryFiles = [
        newClip.outputZipUrl ? `- ZIP vetorizado: ${newClip.outputZipUrl}` : '',
        newClip.contextUrl ? `- Contexto JSON: ${newClip.contextUrl}` : '',
      ].filter(Boolean);
      void appendSimcarEntriesToConversation(
        newClip,
        [
          {
            role: 'user',
            text: [
              'Solicitei importação do ZIP vetorizado para análise completa SIMCAR.',
              `Arquivo: ${simcarClipFile.name}.`,
            ].join('\n'),
          },
          {
            role: 'ai',
            text: [
              `Importação vetorizada concluída (job ${jobId}).`,
              `Feições detectadas: ${newClip.totalFeatures}.`,
              `Área do imóvel: ${newClip.propertyAreaHa.toFixed(2)} ha.`,
              cloudinaryFiles.length > 0 ? `Arquivos no Cloudinary:\n${cloudinaryFiles.join('\n')}` : '',
              resolvedDownloadUrl ? `Download do ZIP: ${resolvedDownloadUrl}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        { title: newClip.filename }
      );

      setSimcarVectorizedStatus({ stage: 'acavn', message: 'Executando analise integrada (etapa AC/AVN)...' });
      const acAvnResult = await runAcAvnAnalysis({
        jobId,
        historyEntry: newClip,
        layers: simcarFixedSatelliteKeys,
        imageOnly: false,
        silentOutput: true,
        skipConversation: true,
      });
      if (!acAvnResult.ok) {
        const errText = acAvnResult.error || 'Falha na etapa AC/AVN.';
        setSimcarClipError(errText);
        setSimcarVectorizedStatus({ stage: 'error', message: errText });
        patchVectorizedHistoryState(jobId, {
          status: 'failed',
          processingStage: 'error',
          error: errText,
        });
        return;
      }

      patchVectorizedHistoryState(jobId, {
        status: 'processing',
        processingStage: 'auas',
        error: undefined,
      });
      setSimcarVectorizedStatus({ stage: 'auas', message: 'Consolidando laudo unico (AUAS + AC/AVN)...' });
      const previousAnalysisText = acAvnResult.aiMessage?.text
        || '';
      const auasResult = await runAuasAnalysis({
        jobId,
        historyEntry: {
          ...newClip,
          analysisMeta: acAvnResult.analysisMeta,
        },
        previousAnalysis: previousAnalysisText,
        acAvnMeta: acAvnResult.analysisMeta,
        skipConversation: true,
      });
      if (!auasResult.ok) {
        const errText = auasResult.error || 'Falha na etapa AUAS.';
        setSimcarClipError(errText);
        setSimcarVectorizedStatus({ stage: 'error', message: errText });
        patchVectorizedHistoryState(jobId, {
          status: 'failed',
          processingStage: 'error',
          error: errText,
        });
        return;
      }

      const acAvnImages = (acAvnResult.images || [])
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      const auasImages = (auasResult.images || [])
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      setSimcarAnalysisImages(acAvnImages);
      setSimcarAnalysisMessages([]);
      const rawAuasText = String(auasResult.aiMessage?.text || '').trim();
      const backendLooksIntegrated =
        /(ac\/avn|area consolidada|área consolidada)/i.test(rawAuasText) && /\bauas\b/i.test(rawAuasText);
      const finalCombinedText =
        (previousAnalysisText && rawAuasText && !backendLooksIntegrated)
          ? buildIntegratedVectorizedReport(previousAnalysisText, rawAuasText)
          : rawAuasText
            || buildIntegratedVectorizedReport(
              acAvnResult.aiMessage?.text || '',
              auasResult.aiMessage?.text || ''
            );
      const mergedImages = [...acAvnImages, ...auasImages]
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      const finalAiMessage: SimcarAnalysisMessage = {
        role: 'ai',
        text: finalCombinedText,
        thinkingText: auasResult.aiMessage?.thinkingText,
        images: mergedImages.map((img) => img.url),
      };
      setSimcarAuasImages(auasImages);
      setSimcarAuasMessages([finalAiMessage]);
      setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
      setSimcarClipHistory((prev) =>
        prev.map((c) =>
          c.jobId === jobId
            ? {
              ...c,
              status: 'completed',
              processingStage: 'done',
              error: undefined,
              analysisMeta: acAvnResult.analysisMeta,
              auasAnalysisImages: auasImages,
              auasAnalysisMessages: [finalAiMessage],
              auasMeta: auasResult.auasMeta,
            }
            : c
        )
      );
      void patchPersistedSimcarClip(jobId, {
        status: 'completed',
        processingStage: 'done',
        error: undefined,
        analysisMeta: acAvnResult.analysisMeta,
        auasAnalysisImages: auasImages,
        auasAnalysisMessages: [finalAiMessage],
        auasMeta: auasResult.auasMeta,
      });
      const imageLinks = mergedImages.map((img) => `- ${img.url}`);
      await appendSimcarEntriesToConversation(
        {
          ...newClip,
          analysisMeta: acAvnResult.analysisMeta,
          auasAnalysisImages: auasImages,
          auasAnalysisMessages: [finalAiMessage],
          auasMeta: auasResult.auasMeta,
        },
        [
          {
            role: 'user',
            text: `Solicitei analise completa vetorizada para o recorte ${jobId} (AC, AVN e AUAS em laudo unico).`,
          },
          {
            role: 'ai',
            text: [
              `Analise completa concluida para o recorte ${jobId}.`,
              imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
              finalCombinedText,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ]
      );

      setSimcarVectorizedStatus({ stage: 'done', message: 'Análise completa finalizada com sucesso.' });
      toast.success('Análise completa por IA concluída.');
    } catch (err: any) {
      const message = String(err?.message || 'Erro inesperado na análise completa vetorizada.');
      setSimcarClipError(message);
      setSimcarVectorizedStatus({ stage: 'error', message });
      if (pipelineJobId) {
        patchVectorizedHistoryState(pipelineJobId, {
          status: 'failed',
          processingStage: 'error',
          error: message,
        });
      }
    } finally {
      setSimcarVectorizedRunning(false);
    }
  }, [
    apiFetch,
    appendSimcarEntriesToConversation,
    applyBillingToWallet,
    handleInsufficientCredits,
    persistSimcarClipHistoryEntry,
    readApiError,
    runAcAvnAnalysis,
    runAuasAnalysis,
    simcarAnalysisMessages,
    simcarClipFile,
    simcarFixedSatelliteKeys,
    normalizeSimcarClipSummary,
    patchPersistedSimcarClip,
  ]);

  const patchMessageMeta = async (messageId: string, patch: Partial<NonNullable<ChatMessage['meta']>>, lastUserText: string) => {
    const updatedMessages = messagesRef.current.map((msg) =>
      msg.id === messageId
        ? {
          ...msg,
          meta: {
            ...(msg.meta || {}),
            ...patch,
          },
        }
        : msg
    );
    messagesRef.current = updatedMessages;
    setMessages(updatedMessages);
    await updateConversationMeta(updatedMessages, lastUserText || 'Nova conversa');
  };

  const handleSend = async () => {
    if ((!input.trim() && !imageFile && !pdfFile && queuedFiles.length === 0) || sending) return;


    if (!activeConversationRef && conversationsRef) {
      await createConversation(conversationsRef.collection);
    }

    const userText = input.trim();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const selectedQueuedFiles = [...queuedFiles];
    const queuedImageFiles = selectedQueuedFiles.filter((f) => (f.type || '').toLowerCase().startsWith('image/'));
    const queuedPdfFiles = selectedQueuedFiles.filter((f) => {
      const mime = (f.type || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return mime === 'application/pdf' || name.endsWith('.pdf') || mime.includes('pdf');
    });
    const selectedImageFiles = [...queuedImageFiles, ...(imageFile ? [imageFile] : [])];
    const selectedPdfFiles = [...queuedPdfFiles, ...(pdfFile ? [pdfFile] : [])];
    setChatError(null);
    const totalAttachments = selectedImageFiles.length + selectedPdfFiles.length;
    let localImagePreviewForChat: string | null = null;

    if (selectedImageFiles.length > 0) {
      try {
        localImagePreviewForChat = await readFileAsDataUrl(selectedImageFiles[0]);
      } catch (error: any) {
        toast.error(error.message || 'Erro ao preparar prévia da imagem');
      }
    }

    let userPayloadText = userText;
    if (selectedImageFiles.length) {
      const attachmentList = [
        ...selectedImageFiles.map((f) => `- Imagem: ${f.name}`),
        ...selectedPdfFiles.map((f) => `- PDF: ${f.name}`),
      ].join('\n');
      userPayloadText =
        `${userText || 'Analise a imagem anexada.'}

` +
        'Contexto: a imagem foi anexada pelo usuário para interpretação ambiental/florestal. ' +
        'Descreva achados objetivos, limitações e próximos dados necessários.' +
        `\n\nTotal de anexos: ${totalAttachments}` +
        (attachmentList ? `\nArquivos anexados:\n${attachmentList}` : '');
    } else if (selectedPdfFiles.length) {
      userPayloadText =
        `${userText || 'Analise o PDF anexado.'}

` +
        `Arquivos PDF: ${selectedPdfFiles.map((f) => f.name).join(', ') || 'documento.pdf'}
` +
        `Total de anexos: ${totalAttachments}
` +
        'O documento está em processamento. Faça análise preliminar e refine com o texto extraído quando disponível.';
    }
    setLastPromptText(userText || (totalAttachments > 0 ? 'Analise os anexos enviados.' : ''));

    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      text: userText || (selectedImageFiles.length ? 'Analise a imagem.' : 'Analise o PDF.'),
      time,
      meta: selectedImageFiles.length
        ? {
          fileType: 'image',
          fileName:
            totalAttachments > 1
              ? `${totalAttachments} arquivo(s) anexado(s)`
              : selectedImageFiles[0]?.name || 'imagem.png',
          uploadStatus: 'uploading',
          imageUrl: localImagePreviewForChat || undefined,
        }
        : selectedPdfFiles.length
          ? {
            fileType: 'pdf',
            fileName:
              totalAttachments > 1
                ? `${totalAttachments} arquivo(s) anexado(s)`
                : selectedPdfFiles[0]?.name || 'documento.pdf',
            uploadStatus: 'uploading',
          }
          : undefined,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    messagesRef.current = nextMessages;
    setInput('');
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setQueuedFiles([]);
    setSending(true);
    setUploading(Boolean(selectedImageFiles.length || selectedPdfFiles.length));
    setAiThinking(true);
    const typingId = nanoid();
    setTypingMessageId(typingId);
    flushTypingNow('');
    setLiveThinkingText('');
    setLiveThinkingTarget('');
    setProcessingHintIndex(0);

    const currentUserMessageId = userMessage.id;

    const imageUploadPromise = Promise.all(
      selectedImageFiles.map((file) => uploadImageFile(file).catch(() => null as string | null))
    ).then((urls) => [
      ...urls.filter((u): u is string => Boolean(u)),
    ]);
    const pdfUploadPromise = Promise.all(
      selectedPdfFiles.map((file) =>
        uploadPdfFile(file).catch(() => null as Awaited<ReturnType<typeof uploadPdfFile>>)
      )
    ).then((docs) => docs.filter((d): d is NonNullable<typeof d> => Boolean(d)));

    Promise.allSettled([imageUploadPromise, pdfUploadPromise]).finally(() => setUploading(false));

    imageUploadPromise
      .then(async (uploadedImageUrls) => {
        if (!uploadedImageUrls.length) return;
        const firstImage = uploadedImageUrls[0];
        await patchMessageMeta(
          currentUserMessageId,
          {
            imageUrl: firstImage,
            fileDownloadUrl: firstImage.startsWith('data:') ? firstImage : toCloudinaryDownloadUrl(firstImage),
            uploadStatus: 'done',
          },
          userText || 'Nova conversa'
        );
      })
      .catch(async () => {
        await patchMessageMeta(currentUserMessageId, { uploadStatus: 'error' }, userText || 'Nova conversa');
      });

    pdfUploadPromise
      .then(async (uploadedPdfs) => {
        if (!uploadedPdfs.length) return;
        const firstPdf = uploadedPdfs[0];
        await patchMessageMeta(
          currentUserMessageId,
          {
            fileUrl: firstPdf.url,
            fileDownloadUrl: firstPdf.downloadUrl,
            uploadStatus: 'done',
          },
          userText || 'Nova conversa'
        );
      })
      .catch(async () => {
        await patchMessageMeta(currentUserMessageId, { uploadStatus: 'error' }, userText || 'Nova conversa');
      });

    const imageDataUrlsForAi: string[] = [];
    for (const image of selectedImageFiles) {
      try {
        imageDataUrlsForAi.push(await readFileAsDataUrl(image));
      } catch (error: any) {
        toast.error(error.message || `Erro ao ler imagem ${image.name}`);
      }
    }
    const pendingPdfsForAi: Array<{ dataUrl: string; filename: string }> = [];
    for (const pdf of selectedPdfFiles) {
      try {
        const dataUrl = await readFileAsDataUrl(pdf);
        pendingPdfsForAi.push({ dataUrl, filename: pdf.name });
      } catch (error: any) {
        toast.error(error.message || `Erro ao ler PDF ${pdf.name}`);
      }
    }
    const hasCurrentImage = imageDataUrlsForAi.length > 0;
    const imageAnalysisSystemPrompt = hasCurrentImage
      ? {
        role: 'system',
        content: [
          '## MODO DE ANÁLISE VISUAL',
          'Siga esta estrutura rigorosamente:',
          '',
          '**1. Descrição objetiva** — Descreva APENAS o que é visível na imagem (cores, padrões, texturas, feições). NÃO interprete ainda.',
          '**2. Achados técnicos** — Liste os achados com evidência visual específica. Para cada um, indique o que na imagem sustenta a afirmação.',
          '**3. Interpretação** — Para cada achado, forneça a interpretação ambiental/florestal com nível de confiança [ALTA/MÉDIA/BAIXA] e justificativa.',
          '**4. Limitações e incertezas** — O que NÃO é possível afirmar com esta imagem. Quais dados adicionais seriam necessários.',
          '**5. Recomendações** — Próximas ações práticas de curto prazo.',
          '',
          'REGRAS CRÍTICAS para análise visual:',
          '- NÃO afirme espécies vegetais específicas a partir de imagem de satélite — use termos como "vegetação arbórea densa", "vegetação rasteira", "solo exposto".',
          '- NÃO fabrique valores de NDVI, área em hectares ou percentuais a menos que tenham sido calculados e fornecidos.',
          '- NÃO identifique propriedades, fazendas ou proprietários a menos que o usuário tenha informado.',
          '- Se a resolução da imagem não permite uma conclusão, diga isso explicitamente.',
          '- Se houver contexto geoespacial (BBOX/CRS/camada/ano), use explicitamente no raciocínio.',
          '- Se houver evidência clara de desmatamento anterior a 22/07/2008, indique como possível área consolidada (Art. 68, Lei 12.651/2012) com nível de confiança.',
          '',
          'CAMADAS DE OVERLAY NA IMAGEM:',
          '- Se o contexto técnico listar camadas de overlay ativas, elas estão VISÍVEIS na imagem como sobreposições vetoriais.',
          '- Identifique visualmente onde os limites/polígonos dos overlays aparecem na imagem.',
          '- Correlacione o que você vê na imagem base (satélite) com as informações das camadas sobrepostas.',
          '- Exemplos: se a camada "simcar_area_consolidada" está ativa, procure na imagem as áreas marcadas como consolidadas e compare com o uso do solo visível.',
          '- Se a camada de CAR está ativa, identifique os limites dos imóveis rurais e analise o cumprimento das obrigações (APP, RL).',
          '- Se a camada de AUA (Área de Uso Alternativo) está ativa, verifique se a supressão autorizada está dentro dos limites indicados.',
        ].join('\n'),
      }
      : null;

    const crossChatContext = buildCrossChatContext(activeConversationId, userText);
    const contextualMessages = nextMessages.slice(-40);
    const apiMessages = [
      systemPrompt,
      ...(imageAnalysisSystemPrompt ? [imageAnalysisSystemPrompt] : []),
      ...(crossChatContext ? [{ role: 'system', content: crossChatContext }] : []),
      ...contextualMessages.map((m) => {
        if (m.role === 'user' && (m.meta?.imageUrl || (m.id === currentUserMessageId && imageDataUrlsForAi.length))) {
          const imageUrlsForModel =
            m.id === currentUserMessageId
              ? imageDataUrlsForAi
              : m.meta?.imageUrl
                ? [m.meta.imageUrl]
                : [];
          const promptText =
            m.id === currentUserMessageId
              ? userPayloadText
              : `${m.text || 'Imagem anexada.'}

Arquivo de imagem previamente anexado pelo usuário.`;
          return {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              ...imageUrlsForModel.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          };
        }
        if (m.role === 'user' && m.meta?.fileType === 'pdf') {
          if (m.id === currentUserMessageId) {
            return { role: 'user', content: userPayloadText };
          }
          const historicalPdfContext =
            `PDF previamente anexado pelo usuário.
` +
            `Nome do arquivo: ${m.meta.fileName || 'documento.pdf'}
` +
            `Link: ${m.meta.fileUrl || ''}
` +
            `Resumo do pedido original: ${m.text || 'Analisar PDF.'}`;
          return { role: 'user', content: historicalPdfContext };
        }
        return { role: m.role === 'ai' ? 'assistant' : 'user', content: m.text };
      }),
    ];

    let chatController: AbortController | null = null;
    try {
      chatController = new AbortController();
      chatAbortRef.current = chatController;
      chatProcessJobIdRef.current = null;
      const res = await apiFetch('/api/chat-stream', {
        method: 'POST',
        signal: chatController.signal,
        body: JSON.stringify({
          messages: apiMessages,
          model: selectedModel,
          pendingPdfs: pendingPdfsForAi.length ? pendingPdfsForAi : undefined,
        }),
      });

      if (!res.ok) {
        if (res.status === 402) {
          const payload = await readApiError(res);
          resetChatGenerationUi();
          handleInsufficientCredits(payload?.error);
          return;
        }
        if (res.status === 404) {
          const fallback = await apiFetch('/api/chat', {
            method: 'POST',
            signal: chatController.signal,
            body: JSON.stringify({
              messages: apiMessages,
              model: selectedModel,
              pendingPdfs: pendingPdfsForAi.length ? pendingPdfsForAi : undefined,
            }),
          });
          if (!fallback.ok) {
            const fallbackPayload = await readApiError(fallback);
            if (fallback.status === 402 || fallbackPayload?.code === 'INSUFFICIENT_CREDITS') {
              resetChatGenerationUi();
              handleInsufficientCredits(fallbackPayload?.error);
              return;
            }
            throw new Error(fallbackPayload?.error || 'Falha ao consultar IA');
          }
          const fallbackData = await fallback.json();
          const billing = (fallbackData?.billing || null) as BillingResult | null;
          if (billing) applyBillingToWallet(billing);
          const parsedFallback = splitThinkContent(String(fallbackData?.content || ''));
          const aiMessage: ChatMessage = {
            id: typingId,
            role: 'ai',
            text: parsedFallback.cleanText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            meta: {
              model: fallbackData?.model || selectedModel,
              thinkingText: parsedFallback.thinkingText || undefined,
              billing: billing || undefined,
            },
          };
          setAiThinking(false);
          setTypingMessageId(null);
          flushTypingNow('');
          setLiveThinkingText('');
          setLiveThinkingTarget('');
          const latestMessages = messagesRef.current.length ? messagesRef.current : nextMessages;
          const updatedMessages = [...latestMessages.filter((m) => m.id !== typingId), aiMessage];
          setMessages(updatedMessages);
          messagesRef.current = updatedMessages;
          await updateConversationMeta(updatedMessages, userText || 'Nova conversa');
          return;
        }

        const payload = await readApiError(res);
        throw new Error(payload?.error || 'Falha ao consultar IA');
      }

      if (!res.body) {
        throw new Error('Resposta de streaming inválida');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalContent = '';
      let finalThinking = '';
      let usedModel = selectedModel;
      let finalBilling: BillingResult | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let chunk: any;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (chunk?.type === 'job_started' && typeof chunk?.jobId === 'string') {
            const streamJobId = String(chunk.jobId || '').trim();
            if (streamJobId) chatProcessJobIdRef.current = streamJobId;
            continue;
          }

          if (typeof chunk.model === 'string' && chunk.model) {
            usedModel = chunk.model;
          }
          if (chunk?.billing) {
            finalBilling = chunk.billing as BillingResult;
            applyBillingToWallet(finalBilling);
          }
          if (typeof chunk.thinkingText === 'string') {
            finalThinking = chunk.thinkingText;
            setLiveThinkingTarget(chunk.thinkingText);
          }
          if (typeof chunk.content === 'string') {
            finalContent = chunk.content;
            queueTypingAnimation(chunk.content);
            setAiThinking(false);
          }
        }
      }

      if (buffer.trim()) {
        const trailing = buffer.trim().split('\n');
        for (const line of trailing) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (chunk?.type === 'job_started' && typeof chunk?.jobId === 'string') {
              const streamJobId = String(chunk.jobId || '').trim();
              if (streamJobId) chatProcessJobIdRef.current = streamJobId;
              continue;
            }
            if (typeof chunk.model === 'string' && chunk.model) usedModel = chunk.model;
            if (chunk?.billing) {
              finalBilling = chunk.billing as BillingResult;
              applyBillingToWallet(finalBilling);
            }
            if (typeof chunk.thinkingText === 'string') {
              finalThinking = chunk.thinkingText;
              setLiveThinkingTarget(chunk.thinkingText);
            }
            if (typeof chunk.content === 'string') {
              finalContent = chunk.content;
              queueTypingAnimation(chunk.content);
            }
          } catch {
            // ignore trailing malformed line
          }
        }
      }

      flushTypingNow(finalContent);

      const aiMessage: ChatMessage = {
        id: typingId,
        role: 'ai',
        text: finalContent || 'Desculpe, não consegui responder agora.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        meta: {
          model: usedModel,
          thinkingText: finalThinking || undefined,
          billing: finalBilling || undefined,
        },
      };
      setAiThinking(false);
      setTypingMessageId(null);
      flushTypingNow('');
      setLiveThinkingText('');
      setLiveThinkingTarget('');
      const latestMessages = messagesRef.current.length ? messagesRef.current : nextMessages;
      const updatedMessages = [...latestMessages.filter((m) => m.id !== typingId), aiMessage];
      setMessages(updatedMessages);
      messagesRef.current = updatedMessages;
      await updateConversationMeta(updatedMessages, userText || 'Nova conversa');
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setChatError((prev) => prev || 'Resposta interrompida. Você pode reenviar.');
        return;
      }
      toast.error(error.message || 'Erro ao conversar com a IA');
      setChatError(error.message || 'Falha ao conversar com a IA.');
      setAiThinking(false);
      setTypingMessageId(null);
      flushTypingNow('');
      stopTypingAnimation(true);
      setLiveThinkingText('');
      setLiveThinkingTarget('');
    } finally {
      if (chatAbortRef.current === chatController) {
        chatAbortRef.current = null;
      }
      chatProcessJobIdRef.current = null;
      setSending(false);
    }
  };

  const onClearChat = async () => {
    const cleared: ChatMessage[] = [DEFAULT_ASSISTANT_MESSAGE];
    setMessages(cleared);
    if (activeConversationRef) {
      await setDoc(
        activeConversationRef,
        { messages: sanitizeMessagesForFirestore(cleared), updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  };

  const simcarConversationIds = useMemo(() => {
    return new Set(
      simcarClipHistory
        .map((clip) => String(clip.conversationId || '').trim())
        .filter(Boolean)
    );
  }, [simcarClipHistory]);

  const verticesConversationIds = useMemo(() => {
    return new Set(
      verticesHistory
        .map((entry) => String(entry.conversationId || '').trim())
        .filter(Boolean)
    );
  }, [verticesHistory]);

  const isWorkflowConversation = useCallback(
    (conv: Conversation) => {
      const kind = String(conv.kind || '').toLowerCase();
      if (kind === 'simcar_recorte' || kind === 'vertices_proximas') return true;
      if (String(conv.simcarJobId || '').trim() || String(conv.verticesJobId || '').trim()) return true;
      if (simcarConversationIds.has(conv.id) || verticesConversationIds.has(conv.id)) return true;
      const title = String(conv.title || '').toLowerCase();
      const preview = String(conv.lastMessagePreview || '').toLowerCase();
      // Fallback para casos de persistência ainda não reconciliada (troca rápida de abas).
      return (
        title.includes('recorte simcar') ||
        title.includes('vertices proximas') ||
        title.includes('vértices próximas') ||
        title.includes('analise de auas') ||
        title.includes('análise de auas') ||
        (preview.includes('recorte') && preview.includes('simcar')) ||
        (preview.includes('vértices') && preview.includes('concluída'))
      );
    },
    [simcarConversationIds, verticesConversationIds]
  );

  const filteredConversations = conversations.filter(
    (c) =>
      !isWorkflowConversation(c) &&
      c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedModelLabel =
    selectedModel === 'auto'
      ? 'Auto (Florestal)'
      : models.find((m) => m.id === selectedModel)?.label || selectedModel;

  const chatTimeline = useMemo(
    () => (
      <>
        {messages.map((msg) => {
          const parsedFromText = splitThinkContent(msg.text || '');
          const displayThinking = msg.meta?.thinkingText || parsedFromText.thinkingText;
          const displayText = parsedFromText.cleanText;
          return (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in-up`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'ai'
                  ? 'bg-gradient-to-br from-emerald-500 to-green-700 shadow-lg shadow-emerald-900/50'
                  : 'bg-slate-700'
                  }`}
              >
                {msg.role === 'ai' ? (
                  <img
                    src="/logo-no-bg.svg"
                    alt="GeoForest IA"
                    className="h-6 w-6 object-contain"
                  />                ) : (
                  <User size={14} className="text-slate-300" />
                )}
              </div>
              <div
                className={`
                        relative max-w-[85%] lg:max-w-[75%] p-4 rounded-2xl
                        ${msg.role === 'ai'
                    ? 'bg-[#131f18]/80 border border-emerald-500/10 text-slate-200 rounded-tl-sm'
                    : 'bg-emerald-600 text-white rounded-tr-sm shadow-md shadow-emerald-900/20'
                  }
                      `}
              >
                {(msg.meta?.fileType === 'pdf' || msg.meta?.fileType === 'image') && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      downloadAttachment(msg.meta);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        downloadAttachment(msg.meta);
                      }
                    }}
                    className={`mb-2 inline-flex max-w-[260px] items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] border ${msg.role === 'user'
                      ? 'bg-emerald-700/45 border-emerald-300/30 text-emerald-50'
                      : 'bg-[#0f1713] border-white/10 text-slate-200'
                      } cursor-pointer hover:border-emerald-400/40`}
                  >
                    <div
                      className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${msg.meta?.fileType === 'pdf'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                    >
                      {msg.meta?.fileType === 'pdf' ? <FileText size={13} /> : <ImagePlus size={13} />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{msg.meta?.fileName || (msg.meta?.fileType === 'pdf' ? 'Documento PDF' : 'Imagem anexada')}</p>
                      <p className={`text-[10px] ${msg.role === 'user' ? 'text-emerald-100/80' : 'text-slate-500'}`}>
                        {msg.meta?.fileType === 'pdf' ? 'Documento (clique para baixar)' : 'Imagem (clique para baixar)'}
                      </p>
                    </div>
                    <FileDown size={13} className={msg.role === 'user' ? 'text-emerald-100/80' : 'text-emerald-300'} />
                  </div>
                )}
                {msg.role === 'ai' && displayThinking && (
                  <div className="mb-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">
                        Pensamento da IA
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedThinking((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                        }
                        className="text-[10px] text-emerald-300 hover:text-emerald-200"
                      >
                        {expandedThinking[msg.id] ? 'Ocultar' : 'Expandir'}
                      </button>
                    </div>
                    {expandedThinking[msg.id] && (
                      <p className="mt-2 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                        {displayThinking}
                      </p>
                    )}
                  </div>
                )}
                {msg.role === 'ai' ? (
                  <div className="chat-markdown text-sm leading-relaxed">{renderRichText(displayText)}</div>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
                )}
                {msg.meta?.fileType === 'image' && msg.meta.imageUrl && (
                  <img src={msg.meta.imageUrl} alt="Imagem" className="mt-3 rounded-xl max-h-52 border border-white/10" />
                )}
                {msg.meta?.fileType === 'pdf' && !msg.meta?.fileUrl && !msg.meta?.fileDownloadUrl && (
                  <div className="mt-3">
                    <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                      <FileText size={14} /> Enviando PDF...
                    </span>
                  </div>
                )}
                {msg.role === 'ai' && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyMessageToClipboard(msg.id, displayText)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:border-emerald-500/40 hover:text-emerald-200"
                    >
                      <Copy size={12} />
                      {copiedMessageId === msg.id ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                )}
                <span
                  className={`text-[10px] absolute bottom-2 right-4 opacity-50 ${msg.role === 'user' ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                >
                  {msg.time}
                </span>
              </div>
            </div>
          );
        })}
        {(typingMessageId || aiThinking) && (
          <div className="flex gap-4 animate-fade-in-up">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[#203127] border border-emerald-500/20">
              <Sparkles size={14} className="text-emerald-300" />
            </div>
            <div className="relative max-w-[95%] sm:max-w-[85%] lg:max-w-[75%] p-3 sm:p-4 rounded-2xl bg-[#0f1713]/90 border border-dashed border-emerald-500/35 text-slate-200">
              <div className="mb-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-300/80 mb-1">
                  Pensamento da IA
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-300/90">
                  {liveThinkingText ||
                    [
                      'Lendo sua solicitação',
                      'Analisando contexto ambiental',
                      'Selecionando estratégia de resposta',
                      'Consolidando resultado',
                    ][processingHintIndex]}
                </p>
              </div>
              <p className="text-sm leading-relaxed text-slate-200/95 min-h-5 whitespace-pre-wrap break-words">
                {typingText || 'Gerando resposta...'}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </>
    ),
    [
      messages,
      splitThinkContent,
      downloadAttachment,
      copyMessageToClipboard,
      expandedThinking,
      copiedMessageId,
      typingMessageId,
      aiThinking,
      liveThinkingText,
      processingHintIndex,
      typingText,
    ]
  );



  // Custom components
  const CustomSelect = ({ label, icon: Icon, options, value, onChange }: any) => (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
      <div className="flex items-center gap-3">
        {Icon && <Icon size={16} className="text-slate-500 group-hover:text-emerald-400 transition-colors" />}
        <span className="text-slate-300 text-sm">{label}</span>
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="appearance-none bg-[#050b08] border border-white/10 rounded-lg text-xs text-slate-300 py-2 pl-3 pr-8 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 cursor-pointer transition-all hover:border-emerald-500/30"
        >
          {options.map((opt: string, idx: number) => (
            <option key={idx} value={opt} className="bg-[#0e1612] text-slate-200 py-2">
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>
    </div>
  );

  const ToggleSwitch = ({ label, sub, isActive, onToggle }: any) => (
    <div
      className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
      onClick={() => onToggle?.(!isActive)}
    >
      <div className="flex flex-col">
        <span className="text-slate-300 text-sm group-hover:text-white transition-colors">{label}</span>
        {sub && <span className="text-slate-500 text-[10px]">{sub}</span>}
      </div>
      <div
        className={`w-10 h-5 rounded-full relative transition-colors ${isActive ? 'bg-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-slate-700'
          }`}
      >
        <div
          className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${isActive ? 'left-6' : 'left-1'
            }`}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-screen w-full bg-[#050b08] text-slate-200 items-center justify-center">
        Carregando...
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-full bg-[#050b08] text-slate-200 overflow-hidden font-sans selection:bg-emerald-500/30 transition-colors duration-300"
      style={{ fontSize: 'var(--app-font-size, 15px)' }}
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-emerald-900/20 rounded-full blur-[120px] mix-blend-screen animate-pulse"
          style={{ animationDuration: '10s' }}
        />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-green-900/10 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {simcarImagePreview && (() => {
        const captionText = normalizeImageCaption(simcarImagePreview.caption);
        const previewUrl = resolveBackendUrl(simcarImagePreview.url);
        return (
          <div
            className="fixed inset-0 z-[140] bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
            onClick={() => setSimcarImagePreview(null)}
          >
            <div
              className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0a110e] shadow-2xl flex flex-col"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Imagem usada na análise SIMCAR"
            >
              <div className="flex items-start gap-3 p-4 border-b border-white/10">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-300 shrink-0">
                  <Eye size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{captionText}</p>
                  {simcarImagePreview.sourceLabel && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{simcarImagePreview.sourceLabel}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadSimcarAnalysisImage(simcarImagePreview)}
                    className="h-9 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors flex items-center gap-2"
                    title="Baixar imagem"
                  >
                    <Download size={14} />
                    Baixar
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                    className="h-9 w-9 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 transition-colors inline-flex items-center justify-center"
                    title="Abrir original"
                  >
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimcarImagePreview(null)}
                    className="h-9 w-9 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 transition-colors inline-flex items-center justify-center"
                    title="Fechar"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 bg-black/30 p-3 sm:p-4 flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt={captionText}
                  className="max-w-full max-h-[72vh] object-contain rounded-xl border border-white/10 bg-black"
                />
              </div>
            </div>
          </div>
        );
      })()}

      <aside
        className={`
          fixed lg:relative z-30 flex flex-col h-full w-[85vw] max-w-80
          bg-gradient-to-b from-[#0a120e]/98 via-[#0a120e]/95 to-[#0a120e]/98
          backdrop-blur-2xl border-r border-emerald-500/10
          shadow-2xl shadow-black/30
          transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-[72px] xl:w-80 xl:max-w-80'}
        `}
      >
        <div className="p-5 flex items-center gap-3 cursor-pointer group/sidebar-logo" onClick={() => setActiveView('simcar-clip')}>
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/60 blur-xl rounded-full animate-pulse opacity-60 group-hover/sidebar-logo:opacity-100 transition-opacity duration-500"></div>
            <div className="relative bg-gradient-to-br from-emerald-400 to-green-600 p-2 rounded-xl shadow-lg shadow-emerald-900/50 group-hover/sidebar-logo:shadow-emerald-500/30 transition-shadow duration-300">
              <img
                src="/logo-no-bg.svg"
                alt="GeoForest IA"
                className="h-7 w-7 sm:h-8 sm:w-8 object-contain"
              />
            </div>
          </div>
          <div className="flex flex-col overflow-hidden transition-all duration-300 xl:opacity-100 lg:opacity-0 lg:w-0 xl:w-auto">
            <span className="font-bold text-base tracking-tight text-white group-hover/sidebar-logo:text-emerald-200 transition-colors">GeoForest IA</span>
            <span className="text-[10px] text-emerald-400/70 font-medium tracking-[0.15em] uppercase">Forestry Intelligence</span>
          </div>
        </div>

        <div className="px-1 sm:px-3 mb-3 space-y-2">
          {/* ─── Abas — Segmented Control Moderno ─── */}
          <div className="relative p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm overflow-hidden">
            <div className="flex sm:grid sm:grid-cols-5 gap-0.5 relative scroll-tabs">
              {/* Active tab background slider */}
              <div
                className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(20%-2px)] rounded-xl transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] z-0"
                style={{
                  transform: `translateX(${activeView === 'simcar-clip' ? 0 : activeView === 'simcar-receipts' ? 100 : activeView === 'cbers-wpm' ? 200 : activeView === 'landsat' ? 300 : 400}%)`,
                  background: activeView === 'simcar-clip' 
                    ? 'linear-gradient(135deg, #7c3aed, #6366f1)' 
                    : activeView === 'simcar-receipts'
                    ? 'linear-gradient(135deg, #059669, #84cc16)'
                    : activeView === 'cbers-wpm' 
                    ? 'linear-gradient(135deg, #06b6d4, #10b981)'
                    : activeView === 'landsat'
                    ? 'linear-gradient(135deg, #0ea5e9, #10b981)'
                    : 'linear-gradient(135deg, #8b5cf6, #10b981)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                }}
              />
              <button
                onClick={() => {
                  setActiveView('simcar-clip');
                  if (simcarClipLayers.length === 0 && !simcarClipLayersLoading) {
                    loadSimcarClipLayers();
                  }
                }}
                className={`relative z-10 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                  activeView === 'simcar-clip' 
                    ? 'text-white' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <Scissors size={16} className={activeView === 'simcar-clip' ? 'drop-shadow-[0_0_6px_rgba(167,139,250,0.5)]' : ''} />
                <span className="block lg:hidden xl:block leading-none text-[10px] tracking-wide">SIMCAR</span>
              </button>
              <button
                onClick={() => setActiveView('simcar-receipts')}
                className={`relative z-10 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                  activeView === 'simcar-receipts'
                    ? 'text-white'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <Receipt size={16} className={activeView === 'simcar-receipts' ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]' : ''} />
                <span className="block lg:hidden xl:block leading-none text-[10px] tracking-wide">Recibos</span>
              </button>
              <button
                onClick={() => setActiveView('cbers-wpm')}
                className={`relative z-10 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                  activeView === 'cbers-wpm' 
                    ? 'text-white' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <Satellite size={16} className={activeView === 'cbers-wpm' ? 'drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]' : ''} />
                <span className="block lg:hidden xl:block leading-none text-[10px] tracking-wide">CBERS</span>
              </button>
              <button
                onClick={() => setActiveView('landsat')}
                className={`relative z-10 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                  activeView === 'landsat' 
                    ? 'text-white' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <Layers size={16} className={activeView === 'landsat' ? 'drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]' : ''} />
                <span className="block lg:hidden xl:block leading-none text-[10px] tracking-wide">Landsat</span>
              </button>
              <button
                onClick={() => setActiveView('vertices-proximas')}
                className={`relative z-10 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                  activeView === 'vertices-proximas' 
                    ? 'text-white' 
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <Network size={16} className={activeView === 'vertices-proximas' ? 'drop-shadow-[0_0_6px_rgba(167,139,250,0.5)]' : ''} />
                <span className="block lg:hidden xl:block leading-none text-[10px] tracking-wide">Vértices</span>
              </button>
            </div>
          </div>

          {/* ─── Botão de ação contextual ─── */}
          {activeView === 'simcar-clip' && (
            <button
              onClick={() => { resetSimcarDraft('auto-clip'); setActiveView('simcar-clip'); }}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transition-all duration-300 p-[1px] shadow-lg shadow-purple-900/30"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#120e1a] group-hover:bg-transparent text-purple-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Novo Recorte</span>
              </div>
            </button>
          )}
          {activeView === 'cbers-wpm' && (
            <button
              onClick={() => resetCbersDraft()}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 transition-all duration-300 p-[1px] shadow-lg shadow-cyan-900/30"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#071618] group-hover:bg-transparent text-cyan-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Nova Imagem</span>
              </div>
            </button>
          )}
          {activeView === 'landsat' && (
            <button
              onClick={() => resetLandsatDraft()}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 transition-all duration-300 p-[1px] shadow-lg shadow-sky-900/30"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#071318] group-hover:bg-transparent text-sky-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Nova Landsat</span>
              </div>
            </button>
          )}
          {activeView === 'vertices-proximas' && (
            <button
              onClick={() => resetVerticesDraft()}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 transition-all duration-300 p-[1px] shadow-lg shadow-violet-900/30"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#120e1a] group-hover:bg-transparent text-violet-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Nova Análise</span>
              </div>
            </button>
          )}

        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 custom-scrollbar">
          {activeView === 'cbers-wpm' ? (
            cbersHistory.length > 0 ? (
              cbersHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${cbersJobId === entry.jobId ? 'bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' : 'bg-[#071113]/60 hover:bg-[#101b1d] hover:border-cyan-500/20'}`}
                  onClick={() => selectCbersHistoryEntry(entry)}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${cbersJobId === entry.jobId ? 'bg-gradient-to-br from-cyan-500 to-emerald-500 text-white shadow-md shadow-cyan-900/40' : 'bg-white/5 text-slate-400 group-hover:text-cyan-300 group-hover:bg-cyan-500/10'}`}>
                    <Satellite size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block lg:hidden xl:block">
                    <p className={`text-sm truncate font-medium ${cbersJobId === entry.jobId ? 'text-cyan-100' : 'text-slate-200 group-hover:text-cyan-100'}`}>{entry.scene?.id || entry.itemId || entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-cyan-300">
                        {entry.percent}%
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${entry.status === 'processing'
                          ? 'text-amber-300'
                          : entry.status === 'completed'
                            ? 'text-emerald-300'
                            : entry.status === 'cancelled'
                              ? 'text-orange-300'
                              : 'text-red-300'
                          }`}
                      >
                        {entry.status === 'processing'
                          ? 'Processando'
                          : entry.status === 'completed'
                            ? 'Concluído'
                            : entry.status === 'cancelled'
                              ? 'Cancelado'
                              : 'Falhou'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteCbersJob(entry);
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block lg:hidden xl:block shrink-0"
                    title="Excluir imagem"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block lg:hidden xl:block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <Satellite size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhuma imagem CBERS.</p>
              </div>
            )
          ) : activeView === 'landsat' ? (
            landsatHistory.length > 0 ? (
              landsatHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${landsatJobId === entry.jobId ? 'bg-sky-500/10 border-sky-500/20 shadow-[0_0_15px_rgba(14,165,233,0.06)]' : 'bg-[#071318]/60 hover:bg-[#101b20] hover:border-sky-500/20'}`}
                  onClick={() => selectLandsatHistoryEntry(entry)}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${landsatJobId === entry.jobId ? 'bg-gradient-to-br from-sky-500 to-emerald-500 text-white shadow-md shadow-sky-900/40' : 'bg-white/5 text-slate-400 group-hover:text-sky-300 group-hover:bg-sky-500/10'}`}>
                    <Layers size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block lg:hidden xl:block">
                    <p className={`text-sm truncate font-medium ${landsatJobId === entry.jobId ? 'text-sky-100' : 'text-slate-200 group-hover:text-sky-100'}`}>{entry.scene?.id || entry.sceneId || entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-sky-300">
                        {entry.percent}%
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${entry.status === 'processing'
                          ? 'text-amber-300'
                          : entry.status === 'completed'
                            ? 'text-emerald-300'
                            : entry.status === 'cancelled'
                              ? 'text-orange-300'
                              : 'text-red-300'
                          }`}
                      >
                        {entry.status === 'processing'
                          ? 'Processando'
                          : entry.status === 'completed'
                            ? 'Concluído'
                            : entry.status === 'cancelled'
                              ? 'Cancelado'
                              : 'Falhou'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">
                      {entry.scene?.date || entry.scene?.year || 'Landsat'} • {entry.scene?.compositionLabel || entry.composition || 'falsa-cor'}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteLandsatJob(entry);
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block lg:hidden xl:block shrink-0"
                    title="Excluir imagem"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block lg:hidden xl:block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <Layers size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhuma imagem Landsat.</p>
              </div>
            )
          ) : activeView === 'vertices-proximas' ? (
            verticesHistory.length > 0 ? (
              verticesHistory.map((entry) => (
                <div
                  key={entry.jobId}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${verticesJobId === entry.jobId ? 'bg-violet-500/10 border-violet-500/20 shadow-[0_0_15px_rgba(139,92,246,0.06)]' : 'bg-[#100d18]/70 hover:bg-[#171322] hover:border-violet-500/20'}`}
                  onClick={() => selectVerticesHistoryEntry(entry)}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${verticesJobId === entry.jobId ? 'bg-gradient-to-br from-violet-500 to-emerald-500 text-white shadow-md shadow-violet-900/40' : 'bg-white/5 text-slate-400 group-hover:text-violet-300 group-hover:bg-violet-500/10'}`}>
                    <Network size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block lg:hidden xl:block">
                    <p className={`text-sm truncate font-medium ${verticesJobId === entry.jobId ? 'text-violet-100' : 'text-slate-200 group-hover:text-violet-100'}`}>{entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-300">
                        {entry.percent}%
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${entry.status === 'processing'
                          ? 'text-amber-300'
                          : entry.status === 'completed'
                            ? 'text-emerald-300'
                            : entry.status === 'cancelled'
                              ? 'text-orange-300'
                              : 'text-red-300'
                          }`}
                      >
                        {entry.status === 'processing'
                          ? 'Processando'
                          : entry.status === 'completed'
                            ? 'Concluído'
                            : entry.status === 'cancelled'
                              ? 'Cancelado'
                              : 'Falhou'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      {(entry.resultRows?.length || 0)} par(es) • {(entry.analyzedLayers?.length || 0)} camada(s)
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteVerticesJob(entry);
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block lg:hidden xl:block shrink-0"
                    title="Excluir análise"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Network size={32} className="text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Nenhuma análise de vértices</p>
                <p className="text-[10px] text-slate-600 mt-1">Clique em "Nova Análise" para começar</p>
              </div>
            )
          ) : activeView === 'simcar-clip' ? (
            /* ─── SIMCAR Clip History Cards ─── */
            simcarClipHistory.length > 0 ? (
              simcarClipHistory.map((clip) => (
                <div
                  key={clip.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group cursor-pointer mb-1"
                  onClick={() => {
                    selectSimcarClipEntry(clip);
                  }}
                >
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                    <Scissors size={16} />
                  </div>
                  <div className="flex-1 min-w-0 block lg:hidden xl:block">
                    <p className="text-sm text-slate-200 truncate">{clip.filename}</p>
                    <p className="text-[10px] text-slate-500">
                      {clip.layersWithData}/{clip.totalLayers} camadas • {clip.totalFeatures} feições
                    </p>
	                    {clip.status && (
	                      <p
                        className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${clip.status === 'processing'
                          ? 'text-amber-300'
                          : clip.status === 'completed'
                            ? 'text-emerald-300'
                            : clip.status === 'cancelled'
                              ? 'text-orange-300'
                              : 'text-red-300'
                          }`}
                      >
	                        {clip.status === 'processing'
	                          ? 'Processando'
	                          : clip.status === 'completed'
	                            ? 'Concluído'
	                            : clip.status === 'cancelled'
	                              ? 'Cancelado'
	                              : 'Falhou'}
	                      </p>
	                    )}
	                    {clip.reportPdfStatus === 'ready' && (
	                      <p className="text-[10px] text-cyan-300 mt-0.5 flex items-center gap-1">
	                        <FileText size={10} /> PDF disponível
	                      </p>
	                    )}
	                  </div>
	                  {clip.reportPdfStatus === 'ready' && (clip.reportPdfDownloadUrl || clip.reportPdfUrl) && (
	                    <button
	                      type="button"
	                      onClick={(e) => {
	                        e.stopPropagation();
	                        openSimcarPdfInNewTab(clip.reportPdfDownloadUrl || clip.reportPdfUrl);
	                      }}
	                      className="p-2 rounded-lg text-cyan-300 hover:text-white hover:bg-cyan-500/20 transition-colors opacity-0 group-hover:opacity-100"
	                      title="Abrir PDF técnico em nova aba"
	                    >
	                      <FileDown size={14} />
	                    </button>
	                  )}
	                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const cancelled = await cancelProcessingJobsForCard({
                        cardJobId: clip.jobId,
                        flow: 'simcar',
                        extraJobIds: [
                          simcarClipProcessJobIdRef.current,
                          simcarAnalysisProcessJobIdRef.current,
                          simcarAuasProcessJobIdRef.current,
                        ],
                      });
                      if (cancelled) {
                        toast.info('Processamento cancelado ao excluir o card. Cobrança mínima de cancelamento aplicada.');
                      }
                      if (simcarClipJobId === clip.jobId) {
                        simcarClipAbortRef.current?.abort();
                        simcarClipProcessJobIdRef.current = null;
                        simcarAnalysisAbortRef.current?.abort();
                        simcarAnalysisProcessJobIdRef.current = null;
                        simcarAuasAbortRef.current?.abort();
                        simcarAuasProcessJobIdRef.current = null;
                      }
                      // Delete from Cloudinary + remove from state
                      const imageUrls = (clip.analysisImages || []).map((img) => img.url);
                      const auasImageUrls = (clip.auasAnalysisImages || []).map((img) => img.url);
                      fetch(apiUrl(`/api/simcar/clip/${clip.jobId}`), {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          imageUrls,
                          auasImageUrls,
	                          inputZipUrl: clip.inputZipUrl,
	                          outputZipUrl: clip.outputZipUrl,
	                          contextUrl: clip.contextUrl,
	                          reportPdfUrl: clip.reportPdfUrl || clip.reportPdfDownloadUrl,
	                        }),
                      }).catch(() => { });
                      if (simcarClipsRef) {
                        void deleteDoc(doc(simcarClipsRef, clip.jobId)).catch(() => undefined);
                      }
                      if (conversationsRef) {
                        const linkedConversationIds = new Set<string>();
                        if (clip.conversationId) linkedConversationIds.add(clip.conversationId);
                        for (const conv of conversations) {
                          if (String(conv.simcarJobId || '').trim() === String(clip.jobId)) {
                            linkedConversationIds.add(conv.id);
                          }
                        }
                        for (const convId of linkedConversationIds) {
                          void deleteDoc(doc(conversationsRef.collection, convId)).catch(() => undefined);
                        }
                        if (linkedConversationIds.size > 0) {
                          setConversations((prev) => prev.filter((c) => !linkedConversationIds.has(c.id)));
                          if (activeConversationId && linkedConversationIds.has(activeConversationId)) {
                            setActiveConversationId(null);
                            setActiveConversationRef(null);
                            setMessages([DEFAULT_ASSISTANT_MESSAGE]);
                            messagesRef.current = [DEFAULT_ASSISTANT_MESSAGE];
                          }
                        }
                      }
                      setSimcarClipHistory((prev) => prev.filter((c) => c.id !== clip.id));
                      // Clear active clip if it was this one
                      if (simcarClipJobId === clip.jobId) {
                        resetSimcarDraft('auto-clip');
                        setActiveView('simcar-clip');
                      }
                    }}
                    className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition block lg:hidden xl:block"
                    title="Excluir recorte"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Scissors size={32} className="text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Nenhum recorte ainda</p>
                <p className="text-[10px] text-slate-600 mt-1">Clique em "Novo Recorte" para começar</p>
              </div>
            )
          ) : (
            /* ─── Chat removido — use as abas acima ─── */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TreePine size={40} className="text-emerald-700/50 mb-4" />
              <p className="text-sm text-slate-400">Selecione uma ferramenta acima</p>
              <p className="text-[10px] text-slate-600 mt-1">SIMCAR, CBERS, Landsat ou Vértices</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/5">
          <button
            onClick={() => setActiveView('features')}
            className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group mb-2 ${activeView === 'features' ? 'bg-white/10' : ''}`}
          >
            <BookOpen size={18} className={`transition-colors ${activeView === 'features' ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors block lg:hidden xl:block">
              Funcionalidades
            </span>
          </button>
          <button
            onClick={() => setActiveView('settings')}
            className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group mb-2 ${activeView === 'settings' ? 'bg-white/10' : ''}`}
          >
            <Settings size={18} className={`transition-colors ${activeView === 'settings' ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors block lg:hidden xl:block">
              Configurações
            </span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center ring-2 ring-transparent group-hover:ring-emerald-500/30 transition-all">
              <span className="font-bold text-white text-sm">
                {(userProfile?.fullName || 'U')
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
            </div>
            <div className="flex-1 text-left overflow-hidden block lg:hidden xl:block">
              <p className="text-sm font-medium text-white truncate">{userProfile?.fullName || 'Usuário'}</p>
              <p className="text-xs text-emerald-400/70">{userProfile?.email || 'Plano Pro'}</p>
            </div>
            {loggingOut ? (
              <Loader2 size={18} className="text-slate-400 animate-spin block lg:hidden xl:block" />
            ) : (
              <LogOut size={18} className="text-slate-500 group-hover:text-red-400 transition-colors block lg:hidden xl:block" />
            )}
          </button>
        </div>
      </aside>

      <main
        className="flex-1 flex flex-col relative h-full w-full overflow-hidden z-10"
      >
        <header className="h-14 sm:h-16 flex-shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/5 bg-[#050b08]/50 backdrop-blur-md safe-top">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="lg:hidden p-2 -ml-1 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <Zap size={16} className="text-emerald-400 fill-current shrink-0" />
              <span className="font-medium text-slate-200 text-sm sm:text-base truncate">
                {activeView === 'simcar-clip' ? 'Recorte SIMCAR' : activeView === 'simcar-receipts' ? 'Recibos SIMCAR' : activeView === 'cbers-wpm' ? 'CBERS 4A WPM' : activeView === 'landsat' ? 'Landsat WMS' : activeView === 'vertices-proximas' ? 'Vértices Próximas' : activeView === 'features' ? 'Funcionalidades' : 'Configurações'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2"></div>
        </header>

        {activeView === 'simcar-clip' ? (
          <div className="flex-1 overflow-y-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6 lg:py-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-3 sm:space-y-5 lg:space-y-6 animate-fade-in-up">
              <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-3 sm:p-5 lg:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                      <Scissors size={20} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-semibold text-base sm:text-lg text-slate-200">
                        {simcarClipMode === 'auto-clip' ? 'Recorte Automático SIMCAR' : 'Análise SIMCAR Vetorizado com IA'}
                      </h2>
                      <p className="text-[11px] sm:text-xs text-slate-400">
                        {simcarClipMode === 'auto-clip'
                          ? 'Envie o shapefile do imóvel e receba as camadas SIMCAR Digital da SEMA-MT recortadas'
                          : 'Envie o ZIP do modelo vetorizado para analisar diretamente com IA, sem recorte WFS'}
                      </p>
                      {isSimcarModeLocked && (
                        <p className="text-[11px] text-amber-300 mt-1">
                          Modo travado neste recorte: {simcarLockedMode === 'vectorized-analysis' ? 'Análise Vetorizada IA' : 'Recorte Automático'}.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 w-full sm:w-auto sm:min-w-[240px]">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Modo de Importação Ativo</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {([
                        { key: 'auto-clip' as const, label: 'Recorte da base' },
                        { key: 'vectorized-analysis' as const, label: 'Análise de vetorização' },
                      ]).map((modeOption) => {
                        const isActive = simcarClipMode === modeOption.key;
                        return (
                          <button
                            key={modeOption.key}
                            type="button"
                            onClick={() => {
                              if (isSimcarModeLocked) {
                                toast.info('Este recorte já foi processado em um modo fixo. Clique em "Novo Recorte" para trocar de modo.');
                                return;
                              }
                              if (simcarClipMode === modeOption.key) return;
                              resetSimcarDraft(modeOption.key);
                            }}
                            disabled={isSimcarModeLocked}
                            title={isSimcarModeLocked ? 'Modo bloqueado para o recorte ativo' : undefined}
                            className={`px-3 py-2 rounded-lg border text-[11px] font-semibold transition-colors ${isActive
                              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                              : isSimcarModeLocked
                                ? 'border-white/10 bg-white/5 text-slate-600 cursor-not-allowed'
                                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                              }`}
                          >
                            {modeOption.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      {simcarClipMode === 'auto-clip'
                        ? 'Ativo: Recorte da base.'
                        : 'Ativo: Análise de vetorização.'}
                    </p>
                  </div>
                </div>

                {/* CAR Number Input (auto-clip only) — mutually exclusive with ZIP upload */}
                {simcarClipMode === 'auto-clip' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                      Nº do CAR (dispensa o envio do polígono)
                    </label>
                    <input
                      type="text"
                      value={simcarCarNumber}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSimcarCarNumber(val);
                        if (val.trim()) {
                          setSimcarClipFile(null);
                          setSimcarSigefParcelCode('');
                        }
                      }}
                      disabled={!!simcarClipFile || !!simcarSigefParcelCode.trim()}
                      placeholder="Ex: MT-5107768-XXXXXXX..."
                      className={`w-full px-4 py-2.5 rounded-xl bg-black/30 border text-white text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-colors ${simcarClipFile || simcarSigefParcelCode.trim() ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {simcarCarNumber.trim()
                        ? 'A geometria será buscada automaticamente no WFS da SEMA.'
                        : simcarSigefParcelCode.trim()
                          ? 'Limpe o código SIGEF para usar o Nº do CAR.'
                          : 'Preencha para buscar pelo WFS. Ou envie o ZIP abaixo.'}
                    </p>
                  </div>
                )}

                {simcarClipMode === 'auto-clip' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                      Código da certificação SIGEF (parcela_codigo)
                    </label>
                    <input
                      type="text"
                      value={simcarSigefParcelCode}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setSimcarSigefParcelCode(val);
                        if (val) {
                          setSimcarClipFile(null);
                          setSimcarCarNumber('');
                        }
                      }}
                      disabled={!!simcarClipFile || !!simcarCarNumber.trim()}
                      placeholder="Ex: 17bd4a7d-ca00-4327-bad6-d6c28f62a5a3"
                      className={`w-full px-4 py-2.5 rounded-xl bg-black/30 border text-white text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-colors ${simcarClipFile || simcarCarNumber.trim() ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {simcarSigefParcelCode.trim()
                        ? 'A ATP será puxada do WFS de certificações SIGEF do INCRA.'
                        : simcarCarNumber.trim()
                          ? 'Limpe o Nº do CAR para usar a certificação SIGEF.'
                          : 'Informe o parcela_codigo para recortar com base na certificação SIGEF.'}
                    </p>
                  </div>
                )}

                {/* Hidden file input for upload */}
                <input
                  ref={simcarFileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSimcarClipFile(file);
                      setSimcarClipDownloadUrl(null);
                      setSimcarClipSummary(null);
                      setSimcarClipError(null);
                      setSimcarVectorizedStatus(null);
                      setSimcarCarNumber('');
                      setSimcarSigefParcelCode('');
                    }
                    // Reset so the same file can be re-selected
                    e.target.value = '';
                  }}
                />
                {/* Upload Area */}
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-4 ${(simcarCarNumber.trim() || simcarSigefParcelCode.trim()) && simcarClipMode === 'auto-clip'
                    ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                    : simcarClipFile
                      ? 'border-emerald-500/50 bg-emerald-500/5 cursor-pointer'
                      : simcarVectorizedServerZipReady
                        ? 'border-amber-500/30 bg-amber-500/10 cursor-default'
                        : 'border-white/10 hover:border-emerald-500/30 hover:bg-white/5 cursor-pointer'
                  }`}
                  onClick={() => {
                    if ((simcarCarNumber.trim() || simcarSigefParcelCode.trim()) && simcarClipMode === 'auto-clip') return;
                    if (simcarVectorizedServerZipReady) return;
                    simcarFileInputRef.current?.click();
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if ((simcarCarNumber.trim() || simcarSigefParcelCode.trim()) && simcarClipMode === 'auto-clip') return;
                    if (simcarVectorizedServerZipReady) return;
                    const file = e.dataTransfer.files[0];
                    if (file && file.name.toLowerCase().endsWith('.zip')) {
                      setSimcarClipFile(file);
                      setSimcarClipDownloadUrl(null);
                      setSimcarClipSummary(null);
                      setSimcarClipError(null);
                      setSimcarVectorizedStatus(null);
                      setSimcarCarNumber('');
                      setSimcarSigefParcelCode('');
                    }
                  }}
                >
                  {(simcarCarNumber.trim() || simcarSigefParcelCode.trim()) && simcarClipMode === 'auto-clip' ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Upload size={28} className="text-slate-600" />
                      <p className="text-sm text-slate-500">
                        Upload desabilitado — usando {simcarSigefParcelCode.trim() ? 'certificação SIGEF' : 'Nº do CAR'}
                      </p>
                      <p className="text-[10px] text-slate-600">Limpe o campo acima para voltar a enviar ZIP.</p>
                    </div>
                  ) : simcarClipFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText size={24} className="text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium text-white">{simcarClipFile.name}</p>
                        <p className="text-xs text-slate-400">{(simcarClipFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSimcarClipFile(null);
                          setSimcarVectorizedStatus(null);
                        }}
                        className="ml-2 p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : simcarVectorizedServerZipReady ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileText size={28} className="text-amber-300" />
                      <p className="text-sm font-semibold text-amber-100">ZIP já importado no servidor</p>
                      <p className="text-xs text-slate-300 break-words">
                        {activeSimcarClip?.filename || `Recorte ${String(activeSimcarClip?.jobId || '').slice(0, 8)}`}
                      </p>
                      <p className="text-[11px] text-amber-200/90">
                        A análise continua automaticamente, mesmo após recarregar a página.
                      </p>
                    </div>
                  ) : (
                    <>
                      <Upload size={32} className="text-slate-500 mx-auto mb-3" />
                      <p className="text-sm text-slate-300">
                        {simcarClipMode === 'auto-clip'
                          ? 'Arraste o ZIP do shapefile aqui'
                          : 'Arraste o ZIP do modelo vetorizado aqui'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {simcarClipMode === 'auto-clip'
                          ? 'ou clique para selecionar (.zip com .shp + .prj)'
                          : 'ou clique para selecionar (.zip com todos os shapes vetorizados)'}
                      </p>
                    </>
                  )}
                </div>

                {simcarClipMode === 'vectorized-analysis' && (
                  <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <p className="text-xs text-cyan-200 font-medium">Modo vetorizado ativo</p>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Neste modo, você envia um ZIP já vetorizado do modelo SIMCAR e a próxima etapa será apenas a análise com IA.
                    </p>
                  </div>
                )}

                {simcarClipMode === 'vectorized-analysis' && simcarVectorizedStatus && simcarUnifiedVectorizedProgress && (
                  <div
                    className={`mb-4 rounded-xl border p-3 ${simcarVectorizedStatus.stage === 'error'
                      ? 'border-red-500/30 bg-red-500/10'
                      : simcarVectorizedStatus.stage === 'done'
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : 'border-indigo-500/30 bg-indigo-500/10'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                        Fluxo completo
                      </p>
                      <span className="text-xs font-semibold tabular-nums text-slate-200">
                        {simcarUnifiedProgressDisplay}%
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-black/30 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 relative overflow-hidden ${simcarVectorizedStatus.stage === 'error'
                          ? 'bg-gradient-to-r from-red-500 to-rose-400'
                          : simcarVectorizedStatus.stage === 'done'
                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
                            : 'bg-gradient-to-r from-indigo-500 to-cyan-400'
                          }`}
                        style={{ width: `${simcarUnifiedProgressDisplay}%` }}
                      >
                        {simcarVectorizedStatus.stage !== 'done' && simcarVectorizedStatus.stage !== 'error' && (
                          <span
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.4s_linear_infinite]"
                            style={{ backgroundSize: '180% 100%' }}
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-200 leading-relaxed break-words">
                      {simcarUnifiedVectorizedProgress.phaseLabel}
                      {' — '}
                      {simcarUnifiedVectorizedProgress.message}
                    </p>
                  </div>
                )}

                {/* Layer Selection */}
                {simcarClipMode === 'auto-clip' && simcarClipLayers.length === 0 && (
                  <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                    {simcarClipLayersLoading ? (
                      <span className="text-slate-400">Carregando lista de camadas do servidor...</span>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-amber-300">
                          {simcarClipLayersError
                            ? `Não foi possível carregar as camadas: ${simcarClipLayersError}`
                            : 'Não foi possível carregar as camadas do servidor.'}
                        </span>
                        <button
                          onClick={loadSimcarClipLayers}
                          className="shrink-0 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-semibold text-amber-200 hover:bg-amber-400/20 transition-colors"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {simcarClipMode === 'auto-clip' && simcarClipLayers.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Camadas ({selectedSimcarClipLayerCount}/{simcarClipLayers.length})</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSimcarClipLayers((prev) => prev.map((l) => ({ ...l, selected: true })))}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Todos
                        </button>
                        <button
                          onClick={() =>
                            setSimcarClipLayers((prev) =>
                              prev.map((l) => ({
                                ...l,
                                selected: SIMCAR_MANDATORY_LAYERS.has(l.name) ? true : false,
                              })),
                            )
                          }
                          className="text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
                        >
                          Obrigatórias
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                      {simcarClipLayers.map((layer) => (
                        <button
                          key={layer.name}
                          onClick={() =>
                            setSimcarClipLayers((prev) =>
                              prev.map((l) => {
                                if (l.name !== layer.name) return l;
                                if (SIMCAR_MANDATORY_LAYERS.has(l.name)) return { ...l, selected: true };
                                return { ...l, selected: !l.selected };
                              }),
                            )
                          }
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${layer.selected
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                            : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
                            } ${SIMCAR_MANDATORY_LAYERS.has(layer.name) ? 'ring-1 ring-amber-400/35' : ''}`}
                        >
                          {layer.selected ? <CheckSquare size={12} /> : <Square size={12} />}
                          <span className="truncate">{layer.name}</span>
                          {layer.category === 'property' && (
                            <span className="text-[9px] text-amber-300 ml-auto font-semibold">FIXO</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* AIR Identification Input */}
                {simcarClipMode === 'auto-clip' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                      Nº Identificação da AIR *
                    </label>
                    <input
                      type="text"
                      value={simcarAirId}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const cleaned = raw.replace(/[a-zA-ZÀ-ÿ]/g, '');
                        setSimcarAirIdStripped(raw !== cleaned);
                        setSimcarAirId(cleaned);
                      }}
                      placeholder="Ex: 5107768..."
                      className={`w-full px-4 py-2.5 rounded-xl bg-black/30 border text-white text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-colors ${simcarAirIdStripped ? 'border-amber-500/50 focus:border-amber-400' : 'border-white/10'}`}
                    />
                    {simcarAirIdStripped && (
                      <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle size={10} />
                        Letras removidas automaticamente — use apenas números
                      </p>
                    )}
                    {!simcarAirIdStripped && (
                      <p className="text-[10px] text-slate-500 mt-1">Será preenchido no campo IDENTIFIC da camada AIR</p>
                    )}
                  </div>
                )}

                {/* Process Button */}
                <button
                  disabled={
                    simcarClipMode === 'auto-clip'
                      ? (!simcarClipFile && !simcarCarNumber.trim() && !simcarSigefParcelCode.trim()) || simcarClipProcessing || !simcarAirId.trim() || selectedSimcarClipLayerCount === 0
                      : !canRunVectorizedAnalysis || simcarVectorizedRunning || simcarAnalysisProcessing || simcarAuasProcessing
                  }
                  onClick={async () => {
                    if (simcarClipMode === 'vectorized-analysis') {
                      if (simcarClipFile) {
                        await runVectorizedCompleteAnalysis();
                        return;
                      }
                      if (simcarVectorizedServerZipReady && activeSimcarClip?.jobId) {
                        const resumedStage: NonNullable<SimcarClipHistoryItem['processingStage']> =
                          activeSimcarClip.processingStage === 'auas' ||
                            activeSimcarClip.processingStage === 'acavn' ||
                            activeSimcarClip.processingStage === 'importing'
                            ? activeSimcarClip.processingStage
                            : 'acavn';
                        const patch: Partial<SimcarClipHistoryItem> = {
                          status: 'processing',
                          processingStage: resumedStage,
                          error: undefined,
                        };
                        setSimcarClipHistory((prev) =>
                          prev.map((item) => (item.jobId === activeSimcarClip.jobId ? { ...item, ...patch } : item))
                        );
                        void patchPersistedSimcarClip(activeSimcarClip.jobId, patch).catch(() => undefined);
                        setSimcarVectorizedStatus({
                          stage: resumedStage === 'auas' ? 'auas' : 'acavn',
                          message: 'Retomando automaticamente o fluxo vetorizado no servidor...',
                        });
                        toast.info('Fluxo vetorizado retomado automaticamente.');
                        return;
                      }
                      toast.error('Selecione um ZIP vetorizado para continuar.');
                      return;
                    }
                    if (!simcarClipFile && !simcarCarNumber.trim() && !simcarSigefParcelCode.trim()) return;
                    setSimcarClipProcessing(true);
                    setSimcarClipCanceling(false);
                    simcarClipCancelRequestedRef.current = false;
                    // Show cancel button only after 400ms to avoid flicker on fast operations
                    simcarCancelTimerRef.current = setTimeout(() => setSimcarShowCancel(true), 400);
                    clearSimcarClipProgressQueue();
                    setSimcarClipProgress(null);
                    setSimcarClipDownloadUrl(null);
                    setSimcarClipSummary(null);
                    setSimcarClipError(null);

                    try {
                      const useCarNumber = !simcarClipFile && simcarCarNumber.trim();
                      const useSigefParcel = !simcarClipFile && !useCarNumber && simcarSigefParcelCode.trim();
                      const base64 = simcarClipFile ? await readFileAsBase64Payload(simcarClipFile) : undefined;
                      const selectedLayers = selectedSimcarClipLayerNames;
                      const controller = new AbortController();
                      simcarClipAbortRef.current = controller;
                      simcarClipProcessJobIdRef.current = null;

                      const payload: Record<string, any> = {
                        layerNames: selectedLayers,
                        airIdentificacao: simcarAirId.trim(),
                      };
                      if (useCarNumber) {
                        payload.carNumber = simcarCarNumber.trim();
                        payload.filename = `CAR_${simcarCarNumber.trim()}.zip`;
                      } else if (useSigefParcel) {
                        payload.sigefParcelCode = simcarSigefParcelCode.trim();
                        payload.filename = `SIGEF_${simcarSigefParcelCode.trim()}.zip`;
                      } else {
                        payload.propertyZip = base64;
                        payload.filename = simcarClipFile!.name;
                      }

                      const response = await apiFetch('/api/simcar/clip', {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        signal: controller.signal,
                      });

                      if (!response.ok) {
                        const err = await readApiError(response);
                        throw new Error(err?.error || `Erro ${response.status}`);
                      }

                      const reader = response.body?.getReader();
                      const decoder = new TextDecoder();
                      let buffer = '';

                      if (reader) {
                        while (true) {
                          const { done, value } = await reader.read();
                          if (done) break;
                          buffer += decoder.decode(value, { stream: true });
                          const lines = buffer.split('\n');
                          buffer = lines.pop() || '';

                          for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            try {
                              const event = JSON.parse(line.slice(6));
                              if (event.type === 'job_started') {
                                const streamJobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
                                if (streamJobId) {
                                  simcarClipProcessJobIdRef.current = streamJobId;
                                  setSimcarClipJobId(streamJobId);
                                  if (simcarClipCancelRequestedRef.current) {
                                    void requestProcessCancel(streamJobId);
                                  }
                                  const placeholder: SimcarClipHistoryItem = {
                                    id: streamJobId,
                                    timestamp: new Date().toISOString(),
                                    filename: simcarClipFile?.name || `Recorte ${streamJobId.slice(0, 8)}`,
                                    downloadUrl: '',
                                    totalFeatures: 0,
                                    propertyAreaHa: 0,
                                    layersWithData: 0,
                                    totalLayers: selectedLayers.length || 0,
                                    jobId: streamJobId,
                                    sourceMode: 'auto-clip',
                                    status: 'processing',
                                  };
                                  setSimcarClipHistory((prev) => {
                                    const existing = prev.find((c) => c.jobId === streamJobId);
                                    if (existing) return prev;
                                    return [placeholder, ...prev];
                                  });
                                  void persistSimcarClipHistoryEntry(placeholder).catch(() => undefined);
                                }
                              } else if (event.type === 'progress') {
                                queueSimcarClipProgress({
                                  current: event.current,
                                  total: event.total,
                                  layer: event.layer,
                                  status: event.status,
                                });
                              } else if (event.type === 'complete') {
                                const resolvedDownloadUrl = resolveBackendDownloadUrl(event.downloadUrl, event.outputZipUrl);
                                setSimcarClipDownloadUrl(resolvedDownloadUrl);
                                const summary = normalizeSimcarClipSummary(event.summary);
                                setSimcarClipSummary(summary);
                                const nextJobId =
                                  typeof event.jobId === 'string' && event.jobId.trim()
                                    ? event.jobId.trim()
                                    : event.downloadUrl?.match(/\/download\/([^/?]+)/)?.[1] || null;
                                if (nextJobId) {
                                  setSimcarClipJobId(nextJobId);
                                  // Push to clip history for sidebar cards and persist in Firestore
                                  const newClip: SimcarClipHistoryItem = {
                                    id: nextJobId,
                                    timestamp: new Date().toISOString(),
                                    filename: `Recorte ${new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
                                    downloadUrl: resolvedDownloadUrl,
                                    totalFeatures: summary?.totalFeaturesClipped ?? 0,
                                    propertyAreaHa: summary?.propertyAreaHa ?? 0,
                                    layersWithData: summary?.layersWithData ?? 0,
                                    totalLayers: summary?.layersProcessed ?? 0,
                                    jobId: nextJobId,
                                    conversationId: nanoid(),
                                    inputZipUrl: event.inputZipUrl || undefined,
                                    outputZipUrl: event.outputZipUrl || undefined,
                                    contextUrl: event.contextUrl || undefined,
                                    sourceMode: 'auto-clip',
                                    status: 'completed',
                                    summary: summary || undefined,
                                  };
                                  setSimcarClipHistory((prev) => {
                                    const filtered = prev.filter((c) => c.jobId !== nextJobId);
                                    return [newClip, ...filtered];
                                  });
                                  void persistSimcarClipHistoryEntry(newClip);
                                  const cloudinaryFiles = [
                                    newClip.inputZipUrl ? `- ZIP original: ${newClip.inputZipUrl}` : '',
                                    newClip.outputZipUrl ? `- ZIP recortado: ${newClip.outputZipUrl}` : '',
                                    newClip.contextUrl ? `- Contexto JSON: ${newClip.contextUrl}` : '',
                                  ].filter(Boolean);
                                  const selectedLayersLabel =
                                    selectedLayers.length > 0 ? selectedLayers.join(', ') : 'todas as camadas padrão';
                                  void appendSimcarEntriesToConversation(
                                    newClip,
                                    [
                                      {
                                        role: 'user',
                                        text: [
                                          `Solicitei um recorte SIMCAR para AIR ${simcarAirId.trim()}.`,
                                          useCarNumber
                                            ? `Fonte do limite: Nº do CAR ${simcarCarNumber.trim()}.`
                                            : useSigefParcel
                                              ? `Fonte do limite: certificação SIGEF ${simcarSigefParcelCode.trim()}.`
                                              : `Arquivo: ${simcarClipFile?.name || 'arquivo enviado'}.`,
                                          `Camadas selecionadas: ${selectedLayersLabel}.`,
                                        ].join('\n'),
                                      },
                                      {
                                        role: 'ai',
                                        text: [
                                          `Recorte concluído (job ${nextJobId}).`,
                                          `Feições recortadas: ${newClip.totalFeatures}.`,
                                          `Área do imóvel: ${newClip.propertyAreaHa.toFixed(2)} ha.`,
                                          `Camadas com dados: ${newClip.layersWithData}/${newClip.totalLayers}.`,
                                          cloudinaryFiles.length > 0
                                            ? `Arquivos no Cloudinary:\n${cloudinaryFiles.join('\n')}`
                                            : '',
                                          resolvedDownloadUrl ? `Download do resultado: ${resolvedDownloadUrl}` : '',
                                        ]
                                          .filter(Boolean)
                                          .join('\n\n'),
                                      },
                                    ],
                                    { title: newClip.filename }
                                  );
                                } else {
                                  setSimcarClipError('Recorte gerado, mas não foi possível identificar o job para salvar histórico.');
                                }
                              } else if (event.type === 'error') {
                                const eventMessage = String(event.message || 'Erro no processamento do recorte.');
                                setSimcarClipError(eventMessage);
                                const activeJobId = String(
                                  (typeof event.jobId === 'string' && event.jobId) || simcarClipProcessJobIdRef.current || ''
                                ).trim();
                                if (activeJobId) {
                                  markSimcarClipStatus(activeJobId, 'failed', eventMessage);
                                }
                              } else if (event.type === 'cancelled') {
                                const activeJobId = String(
                                  (typeof event.jobId === 'string' && event.jobId) || simcarClipProcessJobIdRef.current || ''
                                ).trim();
                                if (activeJobId) {
                                  markSimcarClipStatus(activeJobId, 'cancelled', String(event.message || 'Cancelamento solicitado pelo usuário.'));
                                }
                                setSimcarClipError(null);
                              }
                            } catch (parseErr: any) {
                              console.error('[SIMCAR SSE] Falha ao parsear evento:', parseErr?.message, 'linha:', line.slice(0, 200));
                            }
                          }
                        }
                      }
                    } catch (err: any) {
                      if (err.name !== 'AbortError') {
                        const errorMessage = err.message || 'Erro inesperado no processamento.';
                        setSimcarClipError(errorMessage);
                        const activeJobId = String(simcarClipProcessJobIdRef.current || '').trim();
                        if (activeJobId) {
                          markSimcarClipStatus(activeJobId, 'failed', errorMessage);
                        }
                      } else if (simcarClipCancelRequestedRef.current) {
                        const activeJobId = String(simcarClipProcessJobIdRef.current || '').trim();
                        if (activeJobId) {
                          markSimcarClipStatus(activeJobId, 'cancelled', 'Cancelamento solicitado pelo usuário.');
                        }
                      }
                    } finally {
                      if (simcarCancelTimerRef.current) {
                        clearTimeout(simcarCancelTimerRef.current);
                        simcarCancelTimerRef.current = null;
                      }
                      setSimcarShowCancel(false);
                      clearSimcarClipProgressQueue();
                      setSimcarClipProcessing(false);
                      setSimcarClipCanceling(false);
                      simcarClipAbortRef.current = null;
                      simcarClipProcessJobIdRef.current = null;
                      simcarClipCancelRequestedRef.current = false;
                    }
                  }}
                  className={`w-full py-3 rounded-xl font-medium text-sm transition-all duration-300 flex items-center justify-center gap-2 ${(
                    simcarClipMode === 'auto-clip'
                      ? (!simcarClipFile && !simcarCarNumber.trim() && !simcarSigefParcelCode.trim()) || simcarClipProcessing || !simcarAirId.trim() || selectedSimcarClipLayerCount === 0
                      : !canRunVectorizedAnalysis || simcarVectorizedRunning || simcarAnalysisProcessing || simcarAuasProcessing
                  )
                    ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                    }`}
                >
                  {(simcarClipProcessing || simcarVectorizedRunning) ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{simcarClipMode === 'auto-clip' ? 'Processando...' : 'Executando análise completa...'}</span>
                    </>
                  ) : (
                    <>
                      {simcarClipMode === 'auto-clip' ? <Scissors size={16} /> : <Brain size={16} />}
                      <span>{simcarClipMode === 'auto-clip' ? 'Processar Recorte' : 'Análise Completa por IA'}</span>
                    </>
                  )}
                </button>

                {/* Cancel Button */}
                {simcarShowCancel && (
                  <button
                    type="button"
                    disabled={simcarClipCanceling}
                    onClick={async () => {
                      if (simcarClipCanceling) return;
                      simcarClipCancelRequestedRef.current = true;
                      setSimcarClipCanceling(true);
                      const activeJobId = String(simcarClipProcessJobIdRef.current || '').trim();
                      const cancelAccepted = activeJobId ? await requestProcessCancel(activeJobId) : false;
                      simcarClipAbortRef.current?.abort();
                      clearSimcarClipProgressQueue();
                      setSimcarClipProcessing(false);
                      if (activeJobId) {
                        markSimcarClipStatus(activeJobId, 'cancelled', 'Cancelamento solicitado pelo usuário.');
                      }
                      if (activeJobId && !cancelAccepted) {
                        toast.warning('A conexão foi interrompida, mas o servidor não confirmou o cancelamento. Vou atualizar o status automaticamente.');
                      } else {
                        toast.info('Cancelamento solicitado. Cobrança proporcional aplicada.');
                      }
                    }}
                    className={`w-full mt-2 py-2 rounded-xl border border-red-500/20 text-sm transition-colors ${
                      simcarClipCanceling
                        ? 'text-red-300/60 bg-red-500/5 cursor-wait'
                        : 'text-red-400 hover:bg-red-500/10'
                    }`}
                  >
                    {simcarClipCanceling ? 'Cancelando...' : 'Cancelar'}
                  </button>
                )}
              </section>

              {/* Progress */}
              {simcarClipProgress && simcarClipProcessing && (() => {
                const pct = simcarClipProgress.total > 0 ? Math.round((simcarClipProgress.current / simcarClipProgress.total) * 100) : 0;
                return (
                  <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-slate-300">Processando camada {simcarClipProgress.current}/{simcarClipProgress.total}</span>
                      <span className="text-xs text-emerald-400 font-mono">{simcarClipProgress.layer}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-black/40 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-emerald-500 to-green-400 h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-emerald-400 tabular-nums min-w-[3ch] text-right">{pct}%</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      {(simcarClipProgress.status === 'fetching' || simcarClipProgress.status === 'fetching_local') &&
                        'Lendo feições no WFS da SEMA-MT...'}
                      {simcarClipProgress.status === 'clipping' && 'Recortando feições...'}
                      {simcarClipProgress.status === 'copying_property' && 'Copiando polígono do imóvel...'}
                      {simcarClipProgress.status === 'building_zip' && 'Montando arquivo ZIP...'}
                      {simcarClipProgress.status === 'no_wfs_match' && 'Camada não encontrada no WFS'}
                      {simcarClipProgress.status === 'no_local_match' && 'Camada não encontrada no WFS da SEMA-MT'}
                    </p>
                  </section>
                );
              })()}

              {/* Error */}
              {simcarClipError && (
                <section className="bg-red-900/20 border border-red-500/20 rounded-2xl p-6">
                  <p className="text-sm text-red-300">❌ {simcarClipError}</p>
                </section>
              )}

              {/* Result */}
              {simcarClipDownloadUrl && simcarClipSummary && (() => {
                const layers = simcarClipSummary.layers || [];
                const withData = layers.filter((layer) => layer.features > 0);
                const withoutData = layers.filter((layer) => layer.features === 0);
                const totalAreaHa = withData.reduce((sum, layer) => sum + (layer.areaHa || 0), 0);
                const totalFeatures = simcarClipSummary.totalFeaturesClipped || 0;
                const propertyAreaHa = simcarClipSummary.propertyAreaHa || 0;
                const summaryWarnings = Array.isArray(simcarClipSummary.warnings) ? simcarClipSummary.warnings : [];
                return (
                  <>
                    {summaryWarnings.length > 0 && (
                      <section className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Avisos de qualidade</p>
                        <div className="mt-2 space-y-1">
                          {summaryWarnings.map((warning) => (
                            <p key={warning} className="text-xs text-amber-100/90">{warning}</p>
                          ))}
                        </div>
                      </section>
                    )}
                    {simcarClipMode === 'auto-clip' && (
                      <>
                        {/* Summary Cards */}
                        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: 'Área Imóvel', value: `${propertyAreaHa.toFixed(2)} ha`, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                            { label: 'Camadas com Dados', value: `${withData.length} / ${layers.length}`, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                            { label: 'Feições Recortadas', value: String(totalFeatures), color: 'text-blue-400', bg: 'bg-blue-500/10' },
                            { label: 'Área Recortada', value: `${totalAreaHa.toFixed(2)} ha`, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                          ].map((card) => (
                            <div key={card.label} className={`${card.bg} border border-white/5 rounded-xl p-4 text-center`}>
                              <p className={`text-lg font-bold ${card.color}`}>{card.value}</p>
                              <p className="text-[10px] text-slate-400 mt-1">{card.label}</p>
                            </div>
                          ))}
                        </section>

                        {/* Download + Detailed Table */}
                        <section className="bg-[#0e1612]/60 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-4 sm:p-6 space-y-4">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                              <Download size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-white">Recorte Concluído</h3>
                              <p className="text-[11px] sm:text-xs text-slate-400">
                                Processado em {(simcarClipSummary.processingTimeMs / 1000).toFixed(1)}s • CRS: {simcarClipSummary.crs}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => downloadSimcarZip(
                                simcarClipDownloadUrl,
                                `SIMCAR_Recorte_${(simcarClipJobId || 'resultado').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`
                              )}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/30 w-full sm:w-auto justify-center sm:justify-start"
                            >
                              <Download size={14} />
                              Baixar ZIP
                            </button>
                          </div>

                          {/* Layers with data */}
                          {withData.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-2">
                                Camadas com dados ({withData.length})
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-white/10">
                                      <th className="text-left py-2 text-slate-400 font-medium">Camada</th>
                                      <th className="text-center py-2 text-slate-400 font-medium">Origem</th>
                                      <th className="text-right py-2 text-slate-400 font-medium">Feições</th>
                                      <th className="text-right py-2 text-slate-400 font-medium">Área (ha)</th>
                                      <th className="text-right py-2 text-slate-400 font-medium">% Imóvel</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {withData.map((layer) => {
                                      const pct = propertyAreaHa > 0 && layer.areaHa ? ((layer.areaHa / propertyAreaHa) * 100) : null;
                                      return (
                                        <tr key={layer.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                                          <td className="py-2 text-slate-200 font-mono text-xs">
                                            {layer.name}
                                            {layer.warning && (
                                              <span className="block text-[9px] text-amber-400/70 mt-0.5">{layer.warning}</span>
                                            )}
                                          </td>
                                          <td className="py-2 text-center">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${layer.source === 'property'
                                              ? 'bg-amber-500/10 text-amber-400'
                                              : 'bg-blue-500/10 text-blue-400'
                                              }`}>
                                              {layer.source === 'property' ? 'Imóvel' : 'WFS'}
                                            </span>
                                          </td>
                                          <td className="py-2 text-right text-emerald-400 font-medium">{layer.features}</td>
                                          <td className="py-2 text-right text-slate-300">{layer.areaHa ? layer.areaHa.toFixed(2) : '—'}</td>
                                          <td className="py-2 text-right text-slate-400">{pct !== null ? `${pct.toFixed(1)}%` : '—'}</td>
                                        </tr>
                                      );
                                    })}
                                    {/* Totals row */}
                                    <tr className="border-t border-emerald-500/20 font-medium">
                                      <td className="py-2 text-emerald-400 text-xs">TOTAL</td>
                                      <td className="py-2" />
                                      <td className="py-2 text-right text-emerald-400">{totalFeatures}</td>
                                      <td className="py-2 text-right text-emerald-300">{totalAreaHa.toFixed(2)}</td>
                                      <td className="py-2 text-right text-emerald-300">
                                        {propertyAreaHa > 0 ? `${((totalAreaHa / propertyAreaHa) * 100).toFixed(1)}%` : '—'}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Layers without data */}
                          {withoutData.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                Camadas sem dados na área ({withoutData.length})
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                  {withoutData.map((layer) => (
                                  <span
                                    key={layer.name}
                                    className="px-2 py-1 rounded-lg bg-white/5 text-[10px] text-slate-500 font-mono"
                                    title={layer.warning || 'Nenhuma feição encontrada na área do imóvel'}
                                  >
                                    {layer.name}
                                    {layer.warning && <span className="text-amber-400/50 ml-1">!</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </section>
                      </>
                    )}

	                    {(() => {
	                      const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
	                      const hasAnalysis =
	                        simcarAnalysisMessages.length > 0 ||
	                        simcarAuasMessages.length > 0 ||
	                        Boolean(historyEntry?.analysisMessages?.length) ||
	                        Boolean(historyEntry?.auasAnalysisMessages?.length);
	                      if (!hasAnalysis) return null;
	                      const pdfUrl = resolveBackendUrl(historyEntry?.reportPdfDownloadUrl || historyEntry?.reportPdfUrl || '');
	                      const isGenerating = historyEntry?.reportPdfStatus === 'generating';
	                      const failed = historyEntry?.reportPdfStatus === 'failed';
	                      return (
	                        <section className="bg-[#0e1216]/60 backdrop-blur-md border border-cyan-500/20 rounded-2xl p-4 sm:p-5">
	                          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
	                            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-300 shrink-0">
	                              <FileText size={20} />
	                            </div>
	                            <div className="flex-1 min-w-0">
	                              <h3 className="font-semibold text-white text-sm">PDF Técnico SIMCAR</h3>
	                              <p className="text-[11px] text-slate-400">
	                                Relatório executivo com resumo técnico, quantitativos e imagens principais da análise.
	                              </p>
	                              {historyEntry?.reportPdfGeneratedAt && (
	                                <p className="text-[10px] text-slate-500 mt-1">
	                                  Gerado em {new Date(historyEntry.reportPdfGeneratedAt).toLocaleString('pt-BR')}
	                                </p>
	                              )}
	                              {failed && historyEntry?.reportPdfError && (
	                                <p className="text-[10px] text-red-300 mt-1">{historyEntry.reportPdfError}</p>
	                              )}
	                            </div>
	                            <div className="flex gap-2 w-full sm:w-auto">
	                              {pdfUrl && (
	                                <button
	                                  type="button"
	                                  onClick={() => openSimcarPdfInNewTab(pdfUrl)}
	                                  className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors flex items-center justify-center gap-2"
	                                >
	                                  <Download size={14} />
	                                  Baixar PDF
	                                </button>
	                              )}
	                              <button
	                                type="button"
	                                onClick={() => void generateSimcarReportPdf(historyEntry)}
	                                disabled={isGenerating}
	                                className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed text-slate-100 text-xs font-medium transition-colors flex items-center justify-center gap-2"
	                              >
	                                {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
	                                {pdfUrl ? 'Regenerar' : isGenerating ? 'Gerando...' : 'Gerar PDF'}
	                              </button>
	                            </div>
	                          </div>
	                        </section>
	                      );
	                    })()}

	                    {/* Satellite Image Selection + Analysis Buttons */}
                    {simcarClipMode === 'auto-clip' && !simcarAnalysisProcessing && simcarAnalysisMessages.length === 0 && simcarAuasMessages.length === 0 && (
                      <section className="bg-[#0e1216]/60 backdrop-blur-md border border-white/5 rounded-2xl p-5 space-y-4">
                        {/* ZIP Download Links */}
                        {(() => {
                          const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
                          const inputUrl = resolveBackendUrl(historyEntry?.inputZipUrl);
                          const outputUrl = resolveBackendUrl(historyEntry?.outputZipUrl);
                          return (inputUrl || outputUrl) ? (
                            <div className="flex gap-2">
                              {inputUrl && (
                                <button type="button" onClick={() => downloadSimcarZip(inputUrl, `SIMCAR_Original_${(simcarClipJobId || 'resultado').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`)}
                                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white text-xs font-medium transition-colors">
                                  <Download size={14} /> Shapefile Original
                                </button>
                              )}
                              {outputUrl && (
                                <button type="button" onClick={() => downloadSimcarZip(outputUrl, `SIMCAR_Recorte_${(simcarClipJobId || 'resultado').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`)}
                                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-600/30 text-emerald-300 hover:text-white text-xs font-medium transition-colors">
                                  <Download size={14} /> ZIP Recortado
                                </button>
                              )}
                            </div>
                          ) : null;
                        })()}

                        {/* Satellite Selection */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            Imagens fixas da análise AC/AVN
                          </h4>
                          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                            <div className="flex flex-wrap gap-2">
                              {SIMCAR_FIXED_AC_AVN_SATELLITES.map((sat) => (
                                <span
                                  key={sat.key}
                                  className="px-2.5 py-1 rounded-md text-[10px] font-semibold border border-emerald-500/45 bg-emerald-500/20 text-emerald-300"
                                >
                                  {sat.label}
                                </span>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px] text-slate-500">
                              Conjunto fixo para validação técnica: Landsat 2006, Landsat 2007, SPOT 2008 e Landsat 2008.
                            </p>
                          </div>
                        </div>

                        {/* Two Buttons: Analyze with AI + View Images */}
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!simcarClipJobId) return;
                              const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
                              await runAcAvnAnalysis({
                                jobId: simcarClipJobId,
                                historyEntry,
                                layers: simcarFixedSatelliteKeys,
                                imageOnly: false,
                              });
                            }}
                            disabled={!simcarClipJobId}
                            className="flex-1 py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-900/30 transition-all duration-300 flex items-center justify-center gap-2"
                          >
                            <Brain size={16} />
                            Analisar com IA
                          </button>
                          <button
                            onClick={async () => {
                              if (!simcarClipJobId) return;
                              const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
                              await runAcAvnAnalysis({
                                jobId: simcarClipJobId,
                                historyEntry,
                                layers: simcarFixedSatelliteKeys,
                                imageOnly: true,
                              });
                            }}
                            disabled={!simcarClipJobId}
                            className="flex-1 py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white shadow-lg shadow-slate-900/30 transition-all duration-300 flex items-center justify-center gap-2"
                          >
                            <Eye size={16} />
                            Ver Imagens
                          </button>
                        </div>
                      </section>
                    )}

                    {/* ── Análise de AUAS Button (shown after AC/AVN analysis is done) ── */}
                    {simcarClipMode === 'auto-clip' && simcarAnalysisMessages.length > 0 && !simcarAuasProcessing && !simcarAuasMessages.length && (
                      <section className="px-4">
                        <button
                          onClick={async () => {
                            if (!simcarClipJobId) return;
                            const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
                            const previousAnalysis = simcarAnalysisMessages
                              .filter((m) => m.role === 'ai')
                              .map((m) => m.text)
                              .join('\n\n---\n\n');
                            await runAuasAnalysis({
                              jobId: simcarClipJobId,
                              historyEntry,
                              previousAnalysis,
                              acAvnMeta: historyEntry?.analysisMeta,
                            });
                          }}
                          disabled={!simcarClipJobId}
                          className="w-full py-3 rounded-xl font-medium text-sm bg-gradient-to-r from-white/10 to-slate-500/20 hover:from-white/15 hover:to-slate-400/25 text-white border border-white/15 shadow-lg shadow-black/20 transition-all duration-300 flex items-center justify-center gap-2"
                        >
                          <Layers size={16} />
                          Análise de AUAS
                        </button>
                      </section>
                    )}

                    {/* ── AUAS Processing Progress ── */}
                    {simcarClipMode === 'auto-clip' && simcarAuasProcessing && simcarAuasProgress && (
                      <section className="mx-4 rounded-xl border border-white/10 bg-[#0c1018]/90 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="p-1 rounded-md bg-white/10">
                            <Layers size={12} className="text-white animate-pulse" />
                          </div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Análise AUAS em progresso</p>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-1.5 mb-2">
                          <div className="bg-gradient-to-r from-white/60 to-slate-300 h-full rounded-full transition-all duration-500" style={{ width: `${simcarAuasProgress.percent}%` }} />
                        </div>
                        <p className="text-[10px] text-slate-500">{simcarAuasProgress.message}</p>
                      </section>
                    )}

                    {/* ── Balão de Agente IA (durante a análise) ── */}
                    {simcarClipMode === 'auto-clip' && simcarAnalysisProcessing && (() => {
                      const pct = simcarAnalysisProgress?.percent ?? 0;
                      const activeStep = simcarAgentLog.filter((s) => s.kind === 'step' && !s.done).at(-1);
                      const thinkingSteps = simcarAgentLog.filter((s) => s.kind === 'thinking');
                      const elMin = Math.floor(simcarElapsed / 60);
                      const elSec = simcarElapsed % 60;
                      const phaseIcons: Record<string, React.ReactNode> = {
                        satellite: <Satellite size={12} />,
                        upload: <Upload size={12} />,
                        brain: <Brain size={12} />,
                        zap: <Zap size={12} />,
                      };
                      const phaseColors: Record<string, { bg: string; text: string; border: string }> = {
                        zap: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
                        satellite: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
                        upload: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
                        brain: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
                      };
                      return (
                        <section className="relative rounded-2xl border border-purple-500/30 bg-[#0c1018]/95 backdrop-blur-md px-5 py-4 shadow-2xl shadow-purple-900/20">
                          {/* ponteiro do balão */}
                          <div className="absolute -top-[7px] left-7 h-3.5 w-3.5 rotate-45 border-l border-t border-purple-500/30 bg-[#0c1018]" />

                          {/* cabeçalho */}
                          <div className="flex items-center gap-3 mb-3">
                            <div className="relative flex-shrink-0">
                              <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400">
                                <Brain size={16} />
                              </div>
                              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-purple-400 animate-ping opacity-75" />
                              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-purple-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-200">GeoForest IA — analisando...</p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {activeStep?.label || simcarAnalysisProgress?.message || 'Preparando...'}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                              <span className="text-xs font-bold text-purple-400 tabular-nums">{pct}%</span>
                              <span className="text-[9px] text-slate-500 tabular-nums flex items-center gap-1">
                                <Clock size={9} />
                                {elMin > 0 ? `${elMin}m ${String(elSec).padStart(2, '0')}s` : `${elSec}s`}
                              </span>
                            </div>
                          </div>

                          {/* barra de progresso com shimmer */}
                          <div className="mb-3 bg-black/40 h-1.5 rounded-full overflow-hidden relative">
                            <div
                              className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden bg-gradient-to-r from-purple-500 to-indigo-400"
                              style={{ width: `${pct}%` }}
                            >
                              <div
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.5s_infinite]"
                                style={{ backgroundSize: '200% 100%' }}
                              />
                            </div>
                          </div>

                          {/* fases agrupadas */}
                          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                            {simcarGroupedPhases.map((phase) => {
                              const colors = phaseColors[phase.icon] || phaseColors.zap;
                              const activeSteps = phase.steps.filter((s) => !s.done);
                              const doneSteps = phase.steps.filter((s) => s.done);
                              const showCollapsed = phase.allDone && doneSteps.length > 2;
                              return (
                                <div key={phase.id} className={`rounded-lg border ${phase.allDone ? 'border-white/5 bg-white/[0.02]' : `${colors.border} bg-white/[0.03]`} overflow-hidden`}>
                                  {/* fase header */}
                                  <div className={`flex items-center gap-2 px-3 py-1.5 ${phase.allDone ? 'opacity-50' : ''}`}>
                                    <span className={`${colors.text} flex-shrink-0`}>{phaseIcons[phase.icon]}</span>
                                    <span className={`text-[10px] font-semibold ${phase.allDone ? 'text-slate-500' : 'text-slate-300'}`}>
                                      {phase.label}
                                    </span>
                                    {phase.allDone ? (
                                      <CheckCircle2 size={10} className="ml-auto text-emerald-500/70 flex-shrink-0" />
                                    ) : (
                                      <span className="ml-auto text-[9px] text-slate-500 tabular-nums">
                                        {doneSteps.length}/{phase.steps.length}
                                      </span>
                                    )}
                                  </div>

                                  {/* passos da fase */}
                                  {!showCollapsed && (
                                    <div className="px-3 pb-2 space-y-1">
                                      {phase.steps.map((step, i) => (
                                        <div
                                          key={i}
                                          className={`flex items-start gap-2 text-[11px] transition-all duration-300 ${step.done ? 'opacity-35' : 'opacity-100 pl-1 border-l-2 border-purple-400/50'
                                            }`}
                                        >
                                          {step.done ? (
                                            <CheckCircle2 size={10} className="mt-0.5 flex-shrink-0 text-emerald-400/70" />
                                          ) : (
                                            <Loader2 size={10} className="mt-0.5 flex-shrink-0 animate-spin text-purple-400" />
                                          )}
                                          <span className={`leading-snug ${step.done ? 'text-slate-500' : 'text-slate-200 font-medium'}`}>
                                            {step.label}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {showCollapsed && (
                                    <div className="px-3 pb-1.5">
                                      <span className="text-[10px] text-slate-600">{doneSteps.length} etapas concluídas</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* thinking steps separados */}
                            {thinkingSteps.length > 0 && (
                              <div className="rounded-lg border border-indigo-500/15 bg-indigo-500/[0.03] overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-1.5 opacity-60">
                                  <span className="text-indigo-400 flex-shrink-0"><Cpu size={12} /></span>
                                  <span className="text-[10px] font-semibold text-indigo-300/80">Raciocínio da IA</span>
                                  <span className="ml-auto text-[9px] text-slate-500 tabular-nums">{thinkingSteps.length}</span>
                                </div>
                                <div className="px-3 pb-2 space-y-0.5">
                                  {thinkingSteps.slice(-2).map((step, i) => (
                                    <p key={i} className="text-[10px] italic text-indigo-300/50 leading-snug truncate">
                                      💭 {step.label}
                                    </p>
                                  ))}
                                  {thinkingSteps.length > 2 && (
                                    <p className="text-[9px] text-indigo-400/30">+{thinkingSteps.length - 2} anteriores</p>
                                  )}
                                </div>
                              </div>
                            )}

                            <div ref={simcarAgentLogEndRef} />
                          </div>
                        </section>
                      );
                    })()}

                    {/* AI Analysis Chat */}
                    {simcarAnalysisMessages.length > 0 && (simcarClipMode !== 'vectorized-analysis' || simcarAuasMessages.length === 0) && (
                      <section className="bg-[#0e1216]/60 backdrop-blur-md border border-purple-500/20 rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                            <Brain size={18} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-white text-sm">Análise IA do Recorte SIMCAR</h3>
                            <p className="text-[10px] text-slate-500">Baseada nas imagens selecionadas (anos e sensores) + overlays AC/AVN</p>
                          </div>
                        </div>

                        {(() => {
                          const meta = activeSimcarClip?.jobId === simcarClipJobId ? activeSimcarClip.analysisMeta : undefined;
                          const globalVerdict = meta?.globalVerdict;
                          const satelliteVerdicts = Array.isArray(meta?.satelliteVerdicts) ? meta.satelliteVerdicts : [];
                          const usedSatellites = satelliteVerdicts.filter((sat) => sat.status === 'used');
                          const missingSatellites = satelliteVerdicts.filter((sat) => sat.status === 'missing');
                          const cloudWarnings = Array.isArray(meta?.cloudWarnings) ? meta.cloudWarnings : [];
                          const coherenceNotes = Array.isArray(meta?.coherence?.notes) ? meta.coherence.notes.filter(Boolean).slice(0, 3) : [];
                          if (!globalVerdict && usedSatellites.length === 0 && cloudWarnings.length === 0 && coherenceNotes.length === 0) {
                            return null;
                          }
                          const confidence = formatSimcarAcAvnConfidence(globalVerdict?.confidence);
                          const verdictRows = [
                            { label: 'AC fora do shape', value: globalVerdict?.acForaShape },
                            { label: 'AVN antropizada', value: globalVerdict?.avnDentroShapeAntropizado },
                            { label: 'AVN fora em AUAS', value: globalVerdict?.avnParcialForaShapeMasEmAuas },
                          ];
                          return (
                            <div className="px-6 pt-4">
                              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${confidence.className}`}>
                                    Confiança: {confidence.label}
                                  </span>
                                  <span className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-300">
                                    Satélites usados: {usedSatellites.length}
                                  </span>
                                  {missingSatellites.length > 0 && (
                                    <span className="px-2.5 py-1 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-200">
                                      Ausentes: {missingSatellites.length}
                                    </span>
                                  )}
                                  {cloudWarnings.length > 0 && (
                                    <span className="px-2.5 py-1 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-200">
                                      Nuvens/sombra: {cloudWarnings.length}
                                    </span>
                                  )}
                                  {typeof meta?.coherence?.isCoherent === 'boolean' && (
                                    <span className={`px-2.5 py-1 rounded-lg border text-[11px] ${meta.coherence.isCoherent
                                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                                      : 'border-red-500/25 bg-red-500/10 text-red-200'
                                      }`}>
                                      Coerência temporal: {meta.coherence.isCoherent ? 'consistente' : 'requer revisão'}
                                    </span>
                                  )}
                                </div>

                                <div className="grid gap-2 md:grid-cols-3">
                                  {verdictRows.map((row) => {
                                    const formatted = formatSimcarAcAvnVerdict(row.value);
                                    return (
                                      <div key={row.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{row.label}</p>
                                        <span className={`mt-2 inline-flex px-2 py-1 rounded-md border text-[11px] font-semibold ${formatted.className}`}>
                                          {formatted.label}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>

                                {usedSatellites.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {usedSatellites
                                      .slice()
                                      .sort((a, b) => a.year - b.year)
                                      .map((sat) => {
                                        const ac = formatSimcarAcAvnVerdict(sat.acForaShape);
                                        const avn = formatSimcarAcAvnVerdict(sat.avnDentroShapeAntropizado);
                                        return (
                                          <span
                                            key={sat.key}
                                            className="px-2 py-1 rounded-md border border-white/10 bg-white/[0.03] text-[10px] text-slate-300"
                                            title={`AC fora: ${ac.label} | AVN antropizada: ${avn.label}`}
                                          >
                                            {sat.label || sat.key} · {sat.year}
                                          </span>
                                        );
                                      })}
                                  </div>
                                )}

                                {coherenceNotes.length > 0 && (
                                  <div className="space-y-1">
                                    {coherenceNotes.map((note, idx) => (
                                      <p key={idx} className="text-[11px] text-slate-400 leading-relaxed">
                                        {note}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Images Gallery (Retrátil) */}
                        {simcarAnalysisImages.length > 0 && (
                          <div className="px-6 pt-4">
                            <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                              <button
                                type="button"
                                onClick={() =>
                                  setSimcarResultImagePanelsOpen((prev) => ({
                                    ...prev,
                                    acAvn: !prev.acAvn,
                                  }))
                                }
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                              >
                                <div className="p-1.5 rounded-md bg-white/10 text-slate-300">
                                  <Eye size={13} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-slate-200">Imagens da validação AC/AVN</p>
                                  <p className="text-[10px] text-slate-500">{simcarAnalysisImages.length} imagem(ns)</p>
                                </div>
                                <ChevronDown
                                  size={14}
                                  className={`text-slate-400 transition-transform duration-200 ${simcarResultImagePanelsOpen.acAvn ? 'rotate-180' : 'rotate-0'}`}
                                />
                              </button>
                              {simcarResultImagePanelsOpen.acAvn && (
                                <div className="px-4 pb-4">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {simcarAnalysisImages.map((img, idx) => {
                                      const captionText = normalizeImageCaption(img.caption);
                                      return (
                                        <button
                                          type="button"
                                          key={idx}
                                          onClick={() => openSimcarAnalysisImage(img, 'Validação AC/AVN')}
                                          className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors text-left"
                                        >
                                          <img
                                            src={img.url}
                                            alt={captionText}
                                            className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                            loading="lazy"
                                          />
                                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <span className="text-[10px] text-white flex items-center gap-1">
                                              <Eye size={10} /> Ampliar
                                            </span>
                                          </div>
                                          <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Messages */}
                        <div ref={simcarAnalysisChatRef} className="px-6 py-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                          {simcarAnalysisMessages.map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user'
                                ? 'bg-purple-600/20 text-purple-100 rounded-br-md whitespace-pre-wrap'
                                : 'bg-[#111a20]/80 border border-purple-500/20 text-slate-200 rounded-bl-md'
                                }`}>
                                {msg.role === 'ai' ? (
                                  <div className="analysis-markdown">
                                    {renderAnalysisRichText(msg.text)}
                                  </div>
                                ) : (
                                  msg.text
                                )}
                              </div>
                            </div>
                          ))}
                          {simcarAnalysisSending && (
                            <div className="flex justify-start">
                              <div className="max-w-[90%] rounded-2xl rounded-bl-md px-4 py-3 bg-[#111a20]/80 border border-purple-500/20 text-slate-200">
                                {simcarLiveAnswerText.trim() ? (
                                  <div className="analysis-markdown" ref={simcarLiveAnswerPanelRef}>
                                    {renderAnalysisRichText(simcarLiveAnswerText)}
                                    <span className="thinking-caret ml-1 align-middle" />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin text-purple-400" />
                                    <span className="text-xs text-slate-400">Pensando e estruturando resposta...</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                      </section>
                    )}

                    {/* ═══ AUAS Analysis Results ═══ */}
                    {simcarAuasMessages.length > 0 && (
                      <section className="mx-4 mb-4 rounded-2xl border border-white/5 bg-[#0e1216]/60 backdrop-blur-md overflow-hidden">
                        {/* AUAS Header */}
                        <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-white/10 text-white">
                            <Layers size={18} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-white text-sm">
                              {simcarClipMode === 'vectorized-analysis'
                                ? 'Análise Integrada SIMCAR (AC/AVN + AUAS)'
                                : 'Análise de AUAS'}
                            </h3>
                            <p className="text-[10px] text-slate-500">
                              {simcarClipMode === 'vectorized-analysis'
                                ? 'Síntese final única das validações de AC, AVN e AUAS'
                                : 'Uso Alternativo do Solo com série temporal e síntese técnica'}
                            </p>
                          </div>
                          <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-500 font-medium">
                            {simcarClipMode === 'vectorized-analysis' ? 'Laudo Único' : 'Uso Alternativo do Solo'}
                          </span>
                        </div>

                        {(() => {
                          const meta = activeSimcarClip?.jobId === simcarClipJobId ? activeSimcarClip.auasMeta : undefined;
                          if (!meta) return null;
                          const status = formatSimcarAuasStatus(meta.finalStatus);
                          const yearVerdicts = Array.isArray(meta.yearVerdicts) ? meta.yearVerdicts : [];
                          const recentVerdicts = [...yearVerdicts]
                            .sort((a, b) => b.year - a.year)
                            .slice(0, 6);
                          const cross = meta.auasAvnCrossCheck;
                          return (
                            <div className="px-6 pt-4">
                              <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${status.className}`}>
                                    {status.label}
                                  </span>
                                  {meta.confidence && (
                                    <span className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-300">
                                      Confiança: {meta.confidence}
                                    </span>
                                  )}
                                  <span className={`px-2.5 py-1 rounded-lg border text-[11px] ${meta.passivoAmbiental
                                    ? 'border-red-500/25 bg-red-500/10 text-red-200'
                                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                                    }`}>
                                    Passivo pós-2008: {meta.passivoAmbiental ? 'identificado' : 'não confirmado'}
                                  </span>
                                  {Number.isFinite(meta.firstDeforestationYear as number) && (
                                    <span className="px-2.5 py-1 rounded-lg border border-amber-500/25 bg-amber-500/10 text-[11px] text-amber-200">
                                      Ano provável: {meta.firstDeforestationYear}
                                    </span>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">AUAS vetorizada</p>
                                    <p className="mt-1 text-slate-200">{meta.hasAuasVectorizedLayer === false ? 'Não' : 'Sim'}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Satélites usados</p>
                                    <p className="mt-1 text-slate-200">{meta.satellitesUsed?.length || yearVerdicts.length || 0}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-slate-500">AUAS x AVN</p>
                                    <p className="mt-1 text-slate-200">
                                      {cross ? `${cross.overlapAreaHa.toFixed(2)} ha (${cross.overlapPctOfAuas.toFixed(1)}%)` : 'Sem cruzamento'}
                                    </p>
                                  </div>
                                </div>

                                {recentVerdicts.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {recentVerdicts.map((item) => (
                                      <span
                                        key={`${item.satelliteLabel}-${item.year}`}
                                        className={`px-2 py-1 rounded-md border text-[10px] ${simcarAuasVerdictClass(item.verdict)}`}
                                      >
                                        {item.year}: {formatSimcarAuasVerdict(item.verdict)}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {Array.isArray(meta.qualityFlags) && meta.qualityFlags.length > 0 && (
                                  <div className="space-y-1">
                                    {meta.qualityFlags.slice(0, 4).map((flag, idx) => (
                                      <p key={idx} className="text-[11px] text-amber-200/90 leading-relaxed">
                                        {flag}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Images Gallery */}
                        {simcarClipMode === 'vectorized-analysis' ? (
                          <div className="px-6 pt-4 space-y-3">
                            {([
                              {
                                key: 'acAvn' as const,
                                title: 'Imagens da validação AC/AVN',
                                images: simcarAnalysisImages,
                                emptyText: 'Sem imagens registradas para AC/AVN nesta análise.',
                              },
                              {
                                key: 'auas' as const,
                                title: 'Imagens da análise AUAS',
                                images: simcarAuasImages,
                                emptyText: 'Sem imagens registradas para AUAS nesta análise.',
                              },
                            ]).map((panel) => {
                              const isOpen = simcarResultImagePanelsOpen[panel.key];
                              const count = panel.images.length;
                              return (
                                <div key={panel.key} className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSimcarResultImagePanelsOpen((prev) => ({
                                        ...prev,
                                        [panel.key]: !prev[panel.key],
                                      }))
                                    }
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                                  >
                                    <div className="p-1.5 rounded-md bg-white/10 text-slate-300">
                                      <Eye size={13} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-slate-200">{panel.title}</p>
                                      <p className="text-[10px] text-slate-500">{count} imagem(ns)</p>
                                    </div>
                                    <ChevronDown
                                      size={14}
                                      className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                                    />
                                  </button>
                                  {isOpen && (
                                    <div className="px-4 pb-4">
                                      {count > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                          {panel.images.map((img, idx) => {
                                            const captionText = normalizeImageCaption(img.caption);
                                            return (
                                              <button
                                                type="button"
                                                key={`${panel.key}-${idx}`}
                                                onClick={() => openSimcarAnalysisImage(img, panel.title)}
                                                className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors text-left"
                                              >
                                                <img
                                                  src={img.url}
                                                  alt={captionText}
                                                  className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                                  loading="lazy"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                                  <span className="text-[10px] text-white flex items-center gap-1">
                                                    <Eye size={10} /> Ampliar
                                                  </span>
                                                </div>
                                                <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="text-[11px] text-slate-500 pt-1">{panel.emptyText}</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          simcarAuasImages.length > 0 && (
                            <div className="px-6 pt-4">
                              <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSimcarResultImagePanelsOpen((prev) => ({
                                      ...prev,
                                      auas: !prev.auas,
                                    }))
                                  }
                                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                                >
                                  <div className="p-1.5 rounded-md bg-white/10 text-slate-300">
                                    <Eye size={13} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-slate-200">Imagens da análise AUAS</p>
                                    <p className="text-[10px] text-slate-500">{simcarAuasImages.length} imagem(ns)</p>
                                  </div>
                                  <ChevronDown
                                    size={14}
                                    className={`text-slate-400 transition-transform duration-200 ${simcarResultImagePanelsOpen.auas ? 'rotate-180' : 'rotate-0'}`}
                                  />
                                </button>
                                {simcarResultImagePanelsOpen.auas && (
                                  <div className="px-4 pb-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {simcarAuasImages.map((img, idx) => {
                                        const captionText = normalizeImageCaption(img.caption);
                                        return (
                                          <button
                                            type="button"
                                            key={idx}
                                            onClick={() => openSimcarAnalysisImage(img, 'Análise AUAS')}
                                            className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors text-left"
                                          >
                                            <img
                                              src={img.url}
                                              alt={captionText}
                                              className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                              loading="lazy"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                              <span className="text-[10px] text-white flex items-center gap-1">
                                                <Eye size={10} /> Ampliar
                                              </span>
                                            </div>
                                            <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        )}

                        {/* AUAS Analysis Text */}
                        <div className="px-6 py-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                          {simcarAuasMessages.map((msg, idx) => (
                            <div key={idx} className="flex justify-start">
                              <div className="max-w-[90%] rounded-2xl rounded-bl-md px-4 py-3 bg-[#111a20]/80 border border-white/15 text-slate-200">
                                <div className="analysis-markdown">
                                  {renderAnalysisRichText(msg.text || '')}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        ) : activeView === 'simcar-receipts' ? (
          <ReceiptsHub apiFetch={apiFetch} />
        ) : activeView === 'cbers-wpm' ? (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
              <section className="rounded-2xl border border-cyan-500/15 bg-[#071113]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                      <Satellite size={13} />
                      CBERS-4A WPM
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">GeoTIFF 3-4-2 com pancromática</h2>
                    <p className="max-w-3xl text-sm text-slate-400">
                      Busque por ZIP/SHP ou por órbita, ponto e data, escolha uma cena L4 pública do STAC INPE e gere a folha completa em .tif para ArcMap.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Fonte', value: 'INPE STAC' },
                      { label: 'Coleção', value: 'L4-DN' },
                      { label: 'Saída', value: 'GeoTIFF' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                        <p className="mt-1 text-xs font-semibold text-cyan-100">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
                <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">Área de interesse</h3>
                      <p className="text-xs text-slate-500 mt-1">Use ZIP/SHP da ATP, Nº do CAR estadual ou filtre direto por órbita e ponto.</p>
                    </div>
                    {cbersAreaHa !== null && (
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                        {cbersAreaHa.toFixed(2)} ha
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nº do CAR estadual</label>
                    <input
                      type="text"
                      value={cbersCarNumber}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        setCbersCarNumber(value);
                        if (value) {
                          setCbersFile(null);
                          setCbersPropertyZipB64(null);
                          setCbersScenes([]);
                          setCbersSelectedSceneId(null);
                          setCbersSelectedSceneIds([]);
                          setCbersPreviewScene(null);
                          setCbersPropertyGeometry(null);
                          setCbersAreaHa(null);
                          setCbersError(null);
                          if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
                        }
                      }}
                      disabled={Boolean(cbersFile)}
                      placeholder="Ex: MT-5107768-XXXXXXX..."
                      className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-cyan-500/50 ${cbersFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                    />
                    <p className="mt-1 text-[10px] text-slate-500">
                      {cbersCarNumber.trim()
                        ? 'A ATP será buscada automaticamente no WFS da SEMA, pelo mesmo sistema do recorte SIMCAR.'
                        : cbersFile
                          ? 'Remova o ZIP para buscar pelo Nº do CAR.'
                          : 'Preencha para usar a geometria do CAR estadual sem enviar ZIP.'}
                    </p>
                  </div>

                  <label
                    className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${cbersCarNumber.trim()
                      ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                      : cbersFile
                        ? 'border-cyan-500/40 bg-cyan-500/5 cursor-pointer'
                        : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-white/[0.03] cursor-pointer'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!cbersCarNumber.trim()) e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (cbersCarNumber.trim()) return;
                      applyCbersZipFile(e.dataTransfer.files?.[0] || null);
                    }}
                  >
                    <input
                      ref={cbersFileInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      className="hidden"
                      disabled={Boolean(cbersCarNumber.trim())}
                      onChange={(e) => {
                        applyCbersZipFile(e.target.files?.[0] || null);
                      }}
                    />
                    <div className={`rounded-xl p-3 ${cbersFile ? 'bg-cyan-500/15 text-cyan-200' : cbersCarNumber.trim() ? 'bg-white/5 text-slate-600' : 'bg-white/5 text-slate-400 group-hover:text-cyan-300'}`}>
                      <Upload size={22} />
                    </div>
                    <div className="text-center min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {cbersCarNumber.trim() ? 'Upload desabilitado pelo Nº do CAR' : cbersFile ? cbersFile.name : 'Arraste ou selecione o ZIP da ATP'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {cbersFile ? `${(cbersFile.size / 1024).toFixed(0)} KB` : cbersCarNumber.trim() ? 'Limpe o CAR para enviar ZIP/SHP.' : 'Shapefile compactado em .zip'}
                      </p>
                    </div>
                    {cbersFile && !cbersCarNumber.trim() && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCbersFile(null);
                          setCbersPropertyZipB64(null);
                          setCbersScenes([]);
                          setCbersSelectedSceneId(null);
                          setCbersSelectedSceneIds([]);
                          setCbersPreviewScene(null);
                          setCbersPropertyGeometry(null);
                          setCbersAreaHa(null);
                          setCbersError(null);
                          if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
                        }}
                        className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                        aria-label="Remover ZIP CBERS"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </label>

                  {cbersError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
                      <AlertTriangle size={16} />
                      <span>{cbersError}</span>
                    </div>
                  )}

                  <div className="rounded-2xl border border-cyan-500/10 bg-[#071113]/70 p-3 sm:p-4 space-y-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Filtros da busca</p>
                        <p className="text-xs text-slate-500">Combine órbita/ponto, nuvem e período sem perder a seleção da área. A geração usa somente cenas L4.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCbersOrbit('');
                          setCbersPoint('');
                          setCbersDateStart('');
                          setCbersDateEnd('');
                          setCbersMaxCloudCover('');
                          setCbersLevelFilter('L4');
                          setCbersSortOrder('desc');
                        }}
                        className="self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/5 hover:text-white sm:self-auto"
                      >
                        Limpar filtros
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                      <div className="md:col-span-3 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Órbita</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cbersOrbit}
                          onChange={(e) => setCbersOrbit(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                          placeholder="213"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-3 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ponto</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cbersPoint}
                          onChange={(e) => setCbersPoint(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                          placeholder="129"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-6 lg:col-span-3">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nível CBERS</label>
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-100">
                          Somente L4-DN
                        </div>
                      </div>
                      <div className="md:col-span-4 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nuvem máx.</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="1"
                          value={cbersMaxCloudCover}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setCbersMaxCloudCover('');
                              return;
                            }
                            const numeric = Math.max(0, Math.min(100, Number(value)));
                            setCbersMaxCloudCover(Number.isFinite(numeric) ? String(numeric) : '');
                          }}
                          placeholder="100"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-4 lg:col-span-3">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ordenação</label>
                        <select
                          value={cbersSortOrder}
                          onChange={(e) => setCbersSortOrder(e.target.value === 'asc' ? 'asc' : 'desc')}
                          className="w-full rounded-xl border border-white/10 bg-[#0b1412] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        >
                          <option value="desc">Mais novas primeiro</option>
                          <option value="asc">Mais antigas primeiro</option>
                        </select>
                      </div>
                      <div className="md:col-span-6">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Período</label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="date"
                            value={cbersDateStart}
                            onChange={(e) => setCbersDateStart(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                          />
                          <input
                            type="date"
                            value={cbersDateEnd}
                            onChange={(e) => setCbersDateEnd(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => void searchCbersScenes()}
                      disabled={(!cbersFile && !cbersCarNumber.trim() && (!cbersOrbit.trim() || !cbersPoint.trim())) || cbersSearching || cbersProcessing}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cbersSearching ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                      Buscar cenas
                    </button>
                    <button
                      type="button"
                      onClick={() => void startCbersProcessing()}
                      disabled={cbersSelectedSceneIds.length === 0 || cbersProcessing || cbersSelectedScenes.some((scene) => scene.coversArea === false || scene.wmsAvailable || (scene.level && scene.level !== 'L4'))}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cbersProcessing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
                      Gerar L4 {cbersSelectedSceneIds.length > 1 ? `${cbersSelectedSceneIds.length} GeoTIFFs` : 'GeoTIFF'}
                    </button>
                  </div>

                  {cbersScenes.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">Cenas disponíveis</h3>
                        <span className="text-xs text-slate-500">{cbersVisibleScenes.length}/{cbersScenes.length} cena(s)</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cbersVisibleScenes.map((scene) => {
                          const selected = cbersSelectedSceneIds.includes(scene.id);
                          const date = scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data';
                          const coverage = Number(scene.coveragePercent ?? 0);
                          const hasCoverage = typeof scene.coveragePercent === 'number' && Number.isFinite(scene.coveragePercent);
                          const availableOnWms = scene.wmsAvailable && scene.wmsUrl;
                          const legacyNonL4 = Boolean(scene.level && scene.level !== 'L4');
                          const blocked = scene.coversArea === false || Boolean(availableOnWms) || legacyNonL4;
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              onClick={() => setCbersPreviewScene(scene)}
                              className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-cyan-500/40 bg-cyan-500/10' : availableOnWms ? 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/40' : blocked ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-cyan-500/25 hover:bg-cyan-500/[0.04]'}`}
                            >
                              <div className="flex gap-3">
                                <div className="h-16 w-16 rounded-lg border border-white/10 bg-black/30 overflow-hidden shrink-0">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="h-full w-full flex items-center justify-center text-slate-600">
                                      <Satellite size={20} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-white truncate">{scene.id}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <p className="text-xs text-slate-400">{date}</p>
                                    {scene.level && (
                                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${scene.level === 'L4' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-red-400/25 bg-red-400/10 text-red-200'}`}>
                                        {scene.level === 'L4' ? 'L4' : 'Legado'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                                    {scene.cloudCover === null ? 'Nuvem n/d' : `Nuvem ${scene.cloudCover.toFixed(1)}%`}
                                  </p>
                                  <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${scene.coversArea === false ? 'text-red-300' : hasCoverage ? 'text-emerald-300' : 'text-cyan-300'}`}>
                                    {hasCoverage ? `Cobertura ${coverage.toFixed(1)}%` : 'Busca por órbita/ponto'}
                                  </p>
                                  {availableOnWms && (
                                    <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                                        Disponível no WMS
                                      </p>
                                      <a
                                        href={scene.wmsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 inline-flex max-w-full items-center gap-1 text-[10px] font-medium text-cyan-200 hover:text-cyan-100"
                                      >
                                        <ArrowUpRight size={12} />
                                        <span className="truncate">{scene.wmsLayerName || scene.wmsUrl}</span>
                                      </a>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void downloadCbersWmsZip(scene);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter' && e.key !== ' ') return;
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void downloadCbersWmsZip(scene);
                                        }}
                                        className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                                      >
                                        {cbersWmsDownloadingId === scene.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        <span className="truncate">Baixar ZIP</span>
                                      </span>
                                    </div>
                                  )}
                                  {scene.alignmentStatus === 'failed_private' && (
                                    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">Apenas download privado</p>
                                      <p className="mt-1 text-[10px] text-amber-100/80">{scene.alignmentWarning || 'Imagem com aviso de deslocamento; sem publicação WMS.'}</p>
                                    </div>
                                  )}
                                </div>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCbersSceneSelection(scene);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleCbersSceneSelection(scene);
                                  }}
                                  className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${selected ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-slate-500'} ${blocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-cyan-200'}`}
                                  title={availableOnWms ? 'Já disponível no WMS' : selected ? 'Remover seleção' : 'Selecionar cena'}
                                >
                                  {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {cbersVisibleScenes.length === 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                          Nenhuma cena dentro do filtro de data atual.
                        </div>
                      )}
                    </div>
                  )}
                  {cbersSelectedScenes.length > 0 && (
                    <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Selecionadas lado a lado</h3>
                          <p className="text-xs text-slate-500">Cada cena gera um GeoTIFF separado no mesmo lote.</p>
                        </div>
                        {cbersEstimating && (
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">
                            <Loader2 size={13} className="animate-spin" />
                            Estimando arquivos
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cbersSelectedScenes.map((scene) => {
                          const estimate = scene.estimate;
                          return (
                            <div key={`selected-${scene.id}`} className="rounded-xl border border-white/10 bg-[#071113]/80 p-3">
                              <div className="flex gap-3">
                                <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-slate-600">
                                      <Satellite size={22} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-white">{scene.id}</p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data'}
                                  </p>
                                  {scene.wmsAvailable && scene.wmsUrl && (
                                    <a
                                      href={scene.wmsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15"
                                    >
                                      <ArrowUpRight size={12} />
                                      <span className="truncate">Disponível no WMS</span>
                                    </a>
                                  )}
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Download: {estimate ? `${estimate.downloadMb.toFixed(1)} MB` : 'estimando'}
                                    </span>
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Saída: {estimate ? `${estimate.outputMbEstimated.toFixed(1)} MB` : 'estimando'}
                                    </span>
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Tempo: {estimate ? `${Math.ceil(estimate.timeSecondsEstimated / 60)} min` : 'estimando'}
                                    </span>
                                    <span className={`rounded-md px-2 py-1 ${scene.coversArea === false ? 'bg-red-500/10 text-red-200' : typeof scene.coveragePercent === 'number' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-cyan-500/10 text-cyan-200'}`}>
                                      {typeof scene.coveragePercent === 'number' ? `Cobertura: ${scene.coveragePercent.toFixed(1)}%` : 'Folha completa'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>

                <aside className="rounded-2xl border border-white/10 bg-[#071113]/80 p-5 sm:p-6 space-y-5">
                  {(() => {
                    const activeCbers = cbersJobId ? cbersHistory.find((item) => item.jobId === cbersJobId) : null;
                    const pct = Math.max(0, Math.min(100, Math.round(Number(cbersProgress?.percent ?? activeCbers?.percent ?? 0))));
                    const done = activeCbers?.status === 'completed';
                    const activeCbersZipUrl = cbersArchiveZipUrl(activeCbers);

                    let totalEstimatedSeconds = 0;
                    if (activeCbers?.mode === 'batch' && Array.isArray(activeCbers?.scenes)) {
                      totalEstimatedSeconds = activeCbers.scenes.reduce((acc, s) => acc + (s.estimate?.timeSecondsEstimated || 0), 0);
                    } else if (activeCbers?.scene?.estimate?.timeSecondsEstimated) {
                      totalEstimatedSeconds = activeCbers.scene.estimate.timeSecondsEstimated;
                    } else if (activeCbers?.estimate?.timeSecondsEstimated) {
                      totalEstimatedSeconds = activeCbers.estimate.timeSecondsEstimated;
                    }

                    let timeRemainingStr = '';
                    if (!done && pct > 0 && pct < 100 && (activeCbers?.status === 'processing' || cbersProcessing)) {
                      let secondsRemaining = 0;
                      if (totalEstimatedSeconds > 0) {
                        secondsRemaining = Math.max(0, Math.round(totalEstimatedSeconds * (100 - pct) / 100));
                      } else if (activeCbers?.createdAt || activeCbers?.timestamp) {
                        const startedAtMs = new Date(activeCbers.createdAt || activeCbers.timestamp).getTime();
                        const elapsedSeconds = Number.isFinite(startedAtMs)
                          ? Math.max(0, (Date.now() - startedAtMs) / 1000)
                          : 0;
                        secondsRemaining = elapsedSeconds > 0 ? Math.round((elapsedSeconds * (100 - pct)) / pct) : 0;
                      }
                      if (secondsRemaining > 60) {
                        timeRemainingStr = `~ ${Math.ceil(secondsRemaining / 60)} min restantes`;
                      } else if (secondsRemaining > 0) {
                        timeRemainingStr = `~ ${secondsRemaining} s restantes`;
                      } else {
                        timeRemainingStr = 'Concluindo...';
                      }
                    }

                    const activeStage = String(cbersProgress?.stage || activeCbers?.stage || '').toLowerCase();
                    const stageLabelByKey: Record<string, string> = {
                      queued: 'Na fila',
                      geometry: 'Lendo área',
                      scene: 'Validando cena',
                      download: 'Baixando bandas',
                      pansharpen: 'Fusionando folha completa',
                      geotiff: 'Gerando GeoTIFF',
                      alignment_check: 'Validando georreferenciamento',
                      alignment_correction: 'Ajustando georreferenciamento',
                      save: 'Salvando arquivo',
                      publish: 'Publicando WMS',
                      private_zip: 'Gerando ZIP privado',
                      zip: 'Compactando entrega',
                      completed: 'Concluído',
                      failed: 'Falhou',
                      cancelled: 'Cancelado',
                    };
                    const stageLabel = stageLabelByKey[activeStage] || cbersProgress?.stage || activeCbers?.stage || 'Aguardando';
                    const heavyServerStage = ['pansharpen', 'geotiff', 'publish'].includes(activeStage) && !done;
                    const progressMessage = cbersProgress?.message || activeCbers?.message || 'Envie uma área e busque cenas para iniciar.';

                    return (
                      <>
                        <div>
                          <h3 className="text-base font-semibold text-white">Processamento</h3>
                          <p className="mt-1 text-xs text-slate-500">{activeCbers?.scene?.id || activeCbers?.itemId || 'Nenhum job selecionado'}</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs items-end">
                            <span className="font-medium text-slate-300">{stageLabel}</span>
                            <div className="flex flex-col items-end">
                              <span className="font-bold tabular-nums text-cyan-300">{pct}%</span>
                              {timeRemainingStr && (
                                <span className="text-[10px] text-cyan-200/70 font-medium">{timeRemainingStr}</span>
                              )}
                            </div>
                          </div>
                          <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          {heavyServerStage && (
                            <div className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-2.5 py-1.5 text-[10px] font-medium text-cyan-100/80">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
                              GDAL processando no servidor; nesta etapa o avanço pode ser estimado.
                            </div>
                          )}
                          <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
                        </div>
                        {activeCbers?.alignmentStatus === 'failed_private' && (
                          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                            <p className="font-semibold uppercase tracking-wider text-amber-200">Aviso de deslocamento</p>
                            <p className="mt-1">{activeCbers.alignmentWarning || 'A correção automática não validou a imagem. O arquivo está disponível apenas para este usuário e não foi publicado no WMS.'}</p>
                          </div>
                        )}
                        {cbersProcessing && cbersJobId && (
                          <button
                            type="button"
                            onClick={async () => {
                              await requestProcessCancel(cbersJobId);
                              setCbersProcessing(false);
                              setCbersError('Cancelamento solicitado.');
                            }}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/15 transition-colors"
                          >
                            <X size={16} />
                            Cancelar
                          </button>
                        )}
                        {done && activeCbersZipUrl && (
                          <button
                            type="button"
                            onClick={() => downloadSimcarZip(activeCbersZipUrl, cbersArchiveZipFilename(activeCbers))}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
                          >
                            <Download size={17} />
                            Baixar cena em ZIP
                          </button>
                        )}
                        {done && activeCbers?.batchZipUrl && (
                          <button
                            type="button"
                            onClick={() => downloadSimcarZip(activeCbers.batchZipUrl, activeCbers.batchZipFilename || cbersBatchZipFilename(activeCbers.jobId))}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
                          >
                            <Download size={17} />
                            Baixar todos em ZIP
                          </button>
                        )}
                        {Array.isArray(activeCbers?.scenes) && activeCbers.scenes.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cenas do lote</p>
                            {activeCbers.scenes.map((sceneState) => (
                              <div key={sceneState.itemId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-white">{sceneState.scene?.id || sceneState.itemId}</p>
                                    {sceneState.level || sceneState.scene?.level ? (
                                      <p className="mt-0.5 text-[10px] font-semibold text-cyan-200">{sceneState.level || sceneState.scene?.level}</p>
                                    ) : null}
                                    <p className="mt-1 text-[10px] text-slate-500">{sceneState.message || sceneState.stage || sceneState.status}</p>
                                  </div>
                                  <span className={`text-[10px] font-semibold uppercase ${sceneState.status === 'completed' ? 'text-emerald-300' : sceneState.status === 'failed' ? 'text-red-300' : sceneState.status === 'cancelled' ? 'text-orange-300' : 'text-cyan-300'}`}>
                                    {sceneState.percent}%
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, sceneState.percent))}%` }} />
                                </div>
                                {sceneState.status === 'completed' && cbersArchiveZipUrl(sceneState) && (
                                  <button
                                    type="button"
                                    onClick={() => downloadSimcarZip(cbersArchiveZipUrl(sceneState), cbersArchiveZipFilename(sceneState))}
                                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                                  >
                                    <Download size={14} />
                                    Baixar cena em ZIP
                                  </button>
                                )}
                                {sceneState.alignmentStatus === 'failed_private' && (
                                  <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[10px] text-amber-100">
                                    {sceneState.alignmentWarning || 'Cena disponível apenas como ZIP privado; não publicada no WMS.'}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {activeCbers?.outputBytes && (
                          <p className="text-center text-[10px] text-slate-500">
                            Arquivo final: {(activeCbers.outputBytes / 1024 / 1024).toFixed(1)} MB
                          </p>
                        )}
                        {activeCbers?.batchZipBytes && (
                          <p className="text-center text-[10px] text-slate-500">
                            ZIP do lote: {(activeCbers.batchZipBytes / 1024 / 1024).toFixed(1)} MB
                          </p>
                        )}
                      </>
                    );
                  })()}
                </aside>
              </div>
              {cbersPreviewScene && (() => {
                const previewDate = cbersPreviewScene.datetime
                  ? new Date(cbersPreviewScene.datetime).toLocaleString('pt-BR')
                  : 'Sem data';
                const selected = cbersSelectedSceneIds.includes(cbersPreviewScene.id);
                const availableOnWms = cbersPreviewScene.wmsAvailable && cbersPreviewScene.wmsUrl;
                const blocked = cbersPreviewScene.coversArea === false || Boolean(availableOnWms) || Boolean(cbersPreviewScene.level && cbersPreviewScene.level !== 'L4');
                const estimate = cbersPreviewScene.estimate;
                return createPortal(
                  <div
                    className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Pré-visualização da cena CBERS"
                    onClick={() => setCbersPreviewScene(null)}
                  >
                    <div
                      className="w-full max-w-5xl max-h-[94vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#071113] shadow-2xl custom-scrollbar"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Pré-visualização da cena</p>
                          <h3 className="truncate text-base font-semibold text-white">{cbersPreviewScene.id}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCbersPreviewScene(null)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                          title="Fechar"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-0">
                        <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(7,17,19,0.98))] p-3 sm:p-4">
                          {cbersPreviewScene.thumbnailUrl ? (
                            <>
                              <img
                                src={cbersPreviewScene.thumbnailUrl}
                                alt={cbersPreviewScene.id}
                                className="max-h-[64vh] min-h-[220px] w-full rounded-xl border border-white/10 bg-black/30 object-contain shadow-2xl"
                              />
                              <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 backdrop-blur">
                                Miniatura completa
                              </div>
                            </>
                          ) : (
                            <div className="flex h-full min-h-[220px] items-center justify-center text-slate-600">
                              <Satellite size={44} />
                            </div>
                          )}
                        </div>
                        <div className="space-y-4 p-5">
                          <CbersMapPreview
                            propertyGeometry={cbersPropertyGeometry}
                            sceneGeometry={cbersPreviewScene.geometry || null}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Data</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">{previewDate}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Nuvem</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">
                                {cbersPreviewScene.cloudCover === null ? 'n/d' : `${cbersPreviewScene.cloudCover.toFixed(1)}%`}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Bandas</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">3, 4, 2 + PAN</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Nível</p>
                              <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'text-red-200' : 'text-emerald-200'}`}>
                                {cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'Legado' : 'L4'}
                              </p>
                            </div>
                            <div className={`rounded-xl border p-3 ${cbersPreviewScene.coversArea === false ? 'border-red-500/20 bg-red-500/10' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-cyan-500/20 bg-cyan-500/10'}`}>
                              <p className="text-[10px] uppercase tracking-wider text-slate-400">Cobertura</p>
                              <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.coversArea === false ? 'text-red-200' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'text-emerald-200' : 'text-cyan-200'}`}>
                                {typeof cbersPreviewScene.coveragePercent === 'number' ? `${cbersPreviewScene.coveragePercent.toFixed(2)}%` : 'Folha completa'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Estimativa</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">
                                {estimate ? `${estimate.downloadMb.toFixed(1)} MB` : cbersEstimating ? 'Calculando...' : 'Pendente'}
                              </p>
                            </div>
                          </div>
                          {estimate && (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Download</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.downloadMb.toFixed(1)} MB</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">GeoTIFF</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.outputMbEstimated.toFixed(1)} MB</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Tempo</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{Math.ceil(estimate.timeSecondsEstimated / 60)} min</p>
                              </div>
                            </div>
                          )}
                          {cbersPreviewScene.alignmentStatus === 'failed_private' && (
                            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                              <p className="font-semibold">Imagem com aviso de deslocamento</p>
                              <p className="mt-1 text-xs text-amber-100/80">
                                {cbersPreviewScene.alignmentWarning || 'Esta imagem fica disponível apenas para download do usuário e não é publicada no WMS.'}
                              </p>
                            </div>
                          )}
                          {availableOnWms && (
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                              <div className="flex items-start gap-2">
                                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                                <div className="min-w-0">
                                  <p className="font-semibold">Esta folha já está disponível no WMS.</p>
                                  <p className="mt-1 text-xs text-emerald-200/80">
                                    A mesma órbita/ponto já foi publicada no acervo local, inclusive quando ela foi gerada por outra conta. Use a imagem existente em vez de gerar novamente.
                                  </p>
                                  <a
                                    href={cbersPreviewScene.wmsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-cyan-100 hover:text-white"
                                  >
                                    <ArrowUpRight size={13} />
                                    <span className="truncate">{cbersPreviewScene.wmsLayerName || cbersPreviewScene.wmsUrl}</span>
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void downloadCbersWmsZip(cbersPreviewScene)}
                                    disabled={cbersWmsDownloadingId === cbersPreviewScene.id}
                                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-50 transition-colors hover:bg-emerald-400/15 disabled:opacity-60"
                                  >
                                    {cbersWmsDownloadingId === cbersPreviewScene.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    Baixar ZIP da imagem
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          {cbersPreviewScene.coversArea === false && (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                              Esta cena não cobre 100% do imóvel e está bloqueada para evitar GeoTIFF incompleto.
                            </div>
                          )}
                          {cbersPreviewScene.bbox && (
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">BBox</p>
                              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                                {cbersPreviewScene.bbox.map((value) => value.toFixed(5)).join(', ')}
                              </p>
                            </div>
                          )}
                          <div className="flex flex-col sm:flex-row gap-3 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                toggleCbersSceneSelection(cbersPreviewScene);
                                setCbersPreviewScene(null);
                              }}
                              disabled={blocked}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                            >
                              {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                              {selected ? 'Remover seleção' : 'Selecionar cena'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (availableOnWms) return;
                                setCbersSelectedSceneId(cbersPreviewScene.id);
                                if (!cbersSelectedSceneIds.includes(cbersPreviewScene.id)) {
                                  setCbersSelectedSceneIds((prev) => [...prev, cbersPreviewScene.id]);
                                }
                                setCbersPreviewScene(null);
                                void startCbersProcessing(cbersPreviewScene.id);
                              }}
                              disabled={cbersProcessing || blocked}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              <Cpu size={17} />
                              Gerar esta imagem
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                );
              })()}
            </div>
          </div>
        ) : activeView === 'landsat' ? (
          <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-7 custom-scrollbar">
            <div className="mx-auto max-w-7xl space-y-5">
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#071318] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                        <Satellite size={13} />
                        Landsat Collection 2 SR
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                        <FolderTree size={13} />
                        RASTER / LANDSAT
                      </span>
                    </div>
                    <h2 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">Acervo Landsat operacional</h2>
                    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { icon: HardDrive, label: 'WMS local', value: String(landsatSearchStats.local), tone: 'emerald' },
                        { icon: CloudDownload, label: 'STAC externo', value: String(landsatSearchStats.external), tone: 'sky' },
                        { icon: MapPinned, label: 'Cobertura', value: landsatSearchStats.bestCoverage === null ? 'n/d' : `${landsatSearchStats.bestCoverage.toFixed(0)}%`, tone: 'amber' },
                        { icon: CalendarDays, label: 'Período', value: landsatSearchStats.periodLabel, tone: 'slate' },
                      ].map((item) => {
                        const Icon = item.icon;
                        const toneClass = item.tone === 'emerald'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                          : item.tone === 'sky'
                            ? 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                            : item.tone === 'amber'
                              ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                              : 'border-white/10 bg-white/[0.04] text-slate-200';
                        return (
                          <div key={item.label} className={`min-h-[76px] rounded-xl border p-3 ${toneClass}`}>
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                              <Icon size={13} />
                              <span>{item.label}</span>
                            </div>
                            <p className="mt-2 truncate text-lg font-bold tabular-nums">{item.value}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="border-t border-white/10 bg-black/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
                    <div className="grid gap-3">
                      {[
                        { icon: Search, label: 'Buscar', value: landsatSearching ? 'rodando' : landsatSearchStats.total ? `${landsatSearchStats.visible}/${landsatSearchStats.total}` : 'pronto' },
                        { icon: Database, label: 'Reuso', value: landsatSearchStats.visibleLocal ? `${landsatSearchStats.visibleLocal} WMS` : 'sem match' },
                        { icon: Cpu, label: 'Processar', value: landsatProcessing ? 'ativo' : activeLandsatHistory?.status === 'completed' ? 'concluído' : 'aguardando' },
                        { icon: Server, label: 'Publicar', value: activeLandsatHistory?.wmsLayerName ? 'WMS OK' : 'pendente' },
                      ].map((item, index) => {
                        const Icon = item.icon;
                        const active = index === 0 ? landsatSearching : index === 2 ? landsatProcessing : false;
                        return (
                          <div key={item.label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3">
                            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${active ? 'border-sky-400/40 bg-sky-400/15 text-sky-100' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                              {active ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                              <p className="truncate text-sm font-semibold text-slate-100">{item.value}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
                    <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-white">Entrada</h3>
                          <p className="mt-1 text-xs text-slate-500">CAR estadual, ZIP/SHP ou órbita/ponto.</p>
                        </div>
                        {landsatAreaHa !== null && (
                          <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                            {landsatAreaHa.toFixed(2)} ha
                          </span>
                        )}
                      </div>

                      <div className="mt-4 space-y-4">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nº do CAR estadual</label>
                          <input
                            type="text"
                            value={landsatCarNumber}
                            onChange={(e) => {
                              const value = e.target.value.trim();
                              setLandsatCarNumber(value);
                              if (value) {
                                setLandsatFile(null);
                                setLandsatPropertyZipB64(null);
                                setLandsatScenes([]);
                                setLandsatSelectedSceneId(null);
                                setLandsatPreviewScene(null);
                                setLandsatPropertyGeometry(null);
                                setLandsatAreaHa(null);
                                setLandsatError(null);
                                if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
                              }
                            }}
                            disabled={Boolean(landsatFile)}
                            placeholder="MT-5107768-..."
                            className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-sky-500/50 ${landsatFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                          />
                        </div>

                        <label
                          className={`group relative flex min-h-[156px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 text-center transition-all ${landsatCarNumber.trim()
                            ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                            : landsatFile
                              ? 'border-sky-500/40 bg-sky-500/5 cursor-pointer'
                              : 'border-white/10 bg-white/[0.02] hover:border-sky-500/30 hover:bg-white/[0.03] cursor-pointer'
                            }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (!landsatCarNumber.trim()) e.dataTransfer.dropEffect = 'copy';
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (landsatCarNumber.trim()) return;
                            applyLandsatZipFile(e.dataTransfer.files?.[0] || null);
                          }}
                        >
                          <input
                            ref={landsatFileInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            className="hidden"
                            disabled={Boolean(landsatCarNumber.trim())}
                            onChange={(e) => {
                              applyLandsatZipFile(e.target.files?.[0] || null);
                            }}
                          />
                          <span className={`rounded-xl p-3 ${landsatFile ? 'bg-sky-500/15 text-sky-200' : landsatCarNumber.trim() ? 'bg-white/5 text-slate-600' : 'bg-white/5 text-slate-400 group-hover:text-sky-300'}`}>
                            <FileArchive size={22} />
                          </span>
                          <span className="max-w-full">
                            <span className="block truncate text-sm font-semibold text-white">
                              {landsatCarNumber.trim() ? 'ZIP bloqueado pelo CAR' : landsatFile ? landsatFile.name : 'Selecionar ZIP/SHP'}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {landsatFile ? `${(landsatFile.size / 1024).toFixed(0)} KB` : 'ATP, imóvel ou polígono de busca'}
                            </span>
                          </span>
                          {landsatFile && !landsatCarNumber.trim() && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setLandsatFile(null);
                                setLandsatPropertyZipB64(null);
                                setLandsatScenes([]);
                                setLandsatSelectedSceneId(null);
                                setLandsatPreviewScene(null);
                                setLandsatPropertyGeometry(null);
                                setLandsatAreaHa(null);
                                setLandsatError(null);
                                if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
                              }}
                              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                              aria-label="Remover ZIP Landsat"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#071318]/85 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-white">Filtros</h3>
                          <p className="mt-1 text-xs text-slate-500">Órbita/ponto, data, nuvem e composição.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLandsatOrbit('');
                            setLandsatPoint('');
                            setLandsatDateStart('');
                            setLandsatDateEnd('');
                            setLandsatMaxCloudCover('30');
                            setLandsatComposition('false_color');
                          }}
                          className="inline-flex items-center gap-2 self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <RefreshCw size={12} />
                          Limpar
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Órbita</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={landsatOrbit}
                            onChange={(e) => setLandsatOrbit(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                            placeholder="224"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ponto</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={landsatPoint}
                            onChange={(e) => setLandsatPoint(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                            placeholder="069"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nuvem máx.</label>
                          <div className="relative">
                            <Gauge size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="100"
                              step="1"
                              value={landsatMaxCloudCover}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === '') {
                                  setLandsatMaxCloudCover('');
                                  return;
                                }
                                const numeric = Math.max(0, Math.min(100, Number(value)));
                                setLandsatMaxCloudCover(Number.isFinite(numeric) ? String(numeric) : '');
                              }}
                              placeholder="30"
                              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-sky-500/50"
                            />
                          </div>
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Composição</label>
                          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                            <button
                              type="button"
                              onClick={() => setLandsatComposition('false_color')}
                              className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${landsatComposition === 'false_color' ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-white'}`}
                            >
                              C654
                            </button>
                            <button
                              type="button"
                              onClick={() => setLandsatComposition('natural_color')}
                              className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${landsatComposition === 'natural_color' ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-white'}`}
                            >
                              RGB
                            </button>
                          </div>
                        </div>
                        <div className="md:col-span-6">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Data inicial</label>
                          <input
                            type="date"
                            value={landsatDateStart}
                            onChange={(e) => setLandsatDateStart(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-6">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Data final</label>
                          <input
                            type="date"
                            value={landsatDateEnd}
                            onChange={(e) => setLandsatDateEnd(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => void searchLandsatScenes()}
                          disabled={(!landsatFile && !landsatCarNumber.trim() && (!landsatOrbit.trim() || !landsatPoint.trim())) || landsatSearching || landsatProcessing}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {landsatSearching ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                          Buscar
                        </button>
                        <button
                          type="button"
                          onClick={() => void startLandsatProcessing()}
                          disabled={!landsatSelectedScene || landsatProcessing || landsatSelectedScene.coversArea === false}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {landsatProcessing ? <Loader2 size={17} className="animate-spin" /> : landsatSelectedScene?.wmsAvailable ? <CheckCircle2 size={17} /> : <CloudDownload size={17} />}
                          {landsatSelectedScene?.wmsAvailable ? 'Reusar WMS' : 'Baixar e publicar'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {landsatError && (
                    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                      <AlertTriangle size={16} />
                      <span>{landsatError}</span>
                    </div>
                  )}

                  {(landsatPropertyGeometry || landsatSelectedScene?.geometry) && (
                    <CbersMapPreview
                      propertyGeometry={landsatPropertyGeometry}
                      sceneGeometry={landsatSelectedScene?.geometry || null}
                    />
                  )}

                  <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-white">Cenas</h3>
                        <p className="mt-1 text-xs text-slate-500">{landsatSearchStats.visible}/{landsatSearchStats.total || 0} visíveis</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                          <HardDrive size={12} />
                          {landsatSearchStats.local} WMS
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                          <CloudDownload size={12} />
                          {landsatSearchStats.external} STAC
                        </span>
                      </div>
                    </div>

                    {landsatScenes.length > 0 ? (
                      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {landsatVisibleScenes.map((scene) => {
                          const selected = landsatSelectedSceneId === scene.id;
                          const date = scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : scene.date || 'Sem data';
                          const coverage = Number(scene.coveragePercent ?? 0);
                          const hasCoverage = typeof scene.coveragePercent === 'number' && Number.isFinite(scene.coveragePercent);
                          const availableOnWms = Boolean(scene.wmsAvailable && scene.wmsUrl);
                          const blocked = scene.coversArea === false;
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              onClick={() => setLandsatSelectedSceneId(scene.id)}
                              className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-sky-500/50 bg-sky-500/10 shadow-[0_0_0_1px_rgba(14,165,233,0.16)]' : availableOnWms ? 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/45' : blocked ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-sky-500/25 hover:bg-sky-500/[0.04]'}`}
                            >
                              <div className="flex gap-3">
                                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-600">
                                      <Layers size={22} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-start justify-between gap-2">
                                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{scene.id}</p>
                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${availableOnWms ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-sky-400/25 bg-sky-400/10 text-sky-200'}`}>
                                      {availableOnWms ? 'WMS' : 'STAC'}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <CalendarDays size={11} className="mr-1 inline" />
                                      {date}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <Radio size={11} className="mr-1 inline" />
                                      {scene.path}/{scene.row}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <Gauge size={11} className="mr-1 inline" />
                                      {scene.cloudCover === null ? 'Nuvem n/d' : `${scene.cloudCover.toFixed(1)}% nuvem`}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <SlidersHorizontal size={11} className="mr-1 inline" />
                                      {scene.compositionLabel}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${blocked ? 'text-red-300' : hasCoverage ? 'text-emerald-300' : 'text-sky-300'}`}>
                                      {hasCoverage ? `Cobertura ${coverage.toFixed(1)}%` : 'Órbita/ponto'}
                                    </span>
                                    {availableOnWms && (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void downloadLandsatWmsZip(scene);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter' && e.key !== ' ') return;
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void downloadLandsatWmsZip(scene);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                                      >
                                        {landsatWmsDownloadingId === scene.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        ZIP
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-sky-500/40 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-white/[0.04] text-slate-500'} ${blocked ? 'opacity-40' : 'hover:text-sky-200'}`}
                                  title={selected ? 'Cena selecionada' : 'Selecionar cena'}
                                >
                                  {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-sm text-slate-500">
                        <div className="text-center">
                          <Search size={22} className="mx-auto mb-2 text-slate-600" />
                          <p>Nenhuma busca Landsat carregada.</p>
                        </div>
                      </div>
                    )}

                    {landsatScenes.length > 0 && landsatVisibleScenes.length === 0 && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                        Nenhuma cena dentro dos filtros atuais.
                      </div>
                    )}
                  </div>
                </section>

                <aside className="space-y-5">
                  {(() => {
                    const activeLandsat = activeLandsatHistory;
                    const pct = Math.max(0, Math.min(100, Math.round(Number(landsatProgress?.percent ?? activeLandsat?.percent ?? 0))));
                    const done = activeLandsat?.status === 'completed';
                    const zipUrl = landsatArchiveZipUrl(activeLandsat || landsatSelectedScene);
                    const activeStage = String(landsatProgress?.stage || activeLandsat?.stage || '').toLowerCase();
                    const stageLabelByKey: Record<string, string> = {
                      queued: 'Na fila',
                      download: 'Baixando bandas',
                      compose: 'Compondo RGB',
                      composite: 'Compondo RGB',
                      vrt: 'Montando VRT',
                      geotiff: 'Gerando GeoTIFF',
                      archive: 'Salvando no acervo',
                      publish_wms: 'Publicando WMS',
                      verify_wms: 'Validando WMS',
                      completed: 'Concluído',
                      failed: 'Falhou',
                      cancelled: 'Cancelado',
                    };
                    const progressMessage = landsatProgress?.message || activeLandsat?.message || 'Aguardando seleção.';
                    const stageLabel = stageLabelByKey[activeStage] || landsatProgress?.stage || activeLandsat?.stage || 'Aguardando';
                    return (
                      <div className="rounded-2xl border border-white/10 bg-[#071318]/90 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-white">Status</h3>
                            <p className="mt-1 truncate text-xs text-slate-500">{activeLandsat?.scene?.id || activeLandsat?.sceneId || landsatSelectedScene?.id || 'Sem job ativo'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${done ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : landsatProcessing ? 'border-sky-500/25 bg-sky-500/10 text-sky-200' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                            {done ? 'WMS OK' : landsatProcessing ? 'Ativo' : 'Pronto'}
                          </span>
                        </div>

                        <div className="mt-5 space-y-2">
                          <div className="flex items-end justify-between text-xs">
                            <span className="font-medium text-slate-300">{stageLabel}</span>
                            <span className="font-bold tabular-nums text-sky-300">{pct}%</span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
                        </div>

                        <div className="mt-5 grid gap-2">
                          {landsatProcessing && activeLandsat && (
                            <button
                              type="button"
                              onClick={() => void deleteLandsatJob(activeLandsat)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/15"
                            >
                              <X size={16} />
                              Cancelar
                            </button>
                          )}
                          {done && activeLandsat && zipUrl && (
                            <button
                              type="button"
                              onClick={() => void downloadLandsatWmsZip(activeLandsat)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
                            >
                              {landsatWmsDownloadingId === activeLandsat.jobId ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                              Baixar ZIP
                            </button>
                          )}
                          {landsatSelectedScene?.wmsAvailable && !activeLandsat && (
                            <button
                              type="button"
                              onClick={() => void downloadLandsatWmsZip(landsatSelectedScene)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                            >
                              <Download size={17} />
                              Baixar WMS
                            </button>
                          )}
                          {activeLandsat?.wmsLayerName && (
                            <a
                              href={activeLandsat.wmsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.07]"
                            >
                              <ArrowUpRight size={14} />
                              Abrir GetCapabilities
                            </a>
                          )}
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Arquivo</p>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                              {activeLandsat?.outputBytes ? `${(activeLandsat.outputBytes / 1024 / 1024).toFixed(1)} MB` : 'n/d'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Camada</p>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                              {activeLandsat?.wmsStoreName || landsatSelectedScene?.wmsStoreName || 'n/d'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                    <h3 className="text-base font-semibold text-white">Árvore WMS</h3>
                    <div className="mt-4 space-y-2 text-sm">
                      {['RASTER', 'LANDSAT', landsatSelectedScene?.orbit ? `landsat_orbit_${landsatSelectedScene.orbit}` : 'landsat_orbit_*', landsatSelectedScene?.year ? `ano ${landsatSelectedScene.year}` : 'ano'].map((item, index) => (
                        <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-slate-300">
                          <FolderTree size={14} className={index < 2 ? 'text-emerald-300' : 'text-sky-300'} />
                          <span className="truncate">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        ) : activeView === 'vertices-proximas' ? (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
              <section className="rounded-2xl border border-violet-500/15 bg-[#0b1110]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-200">
                      <Network size={13} />
                      Vértices Próximas
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Pontos próximos no mesmo anel</h2>
                    <p className="max-w-3xl text-sm text-slate-400">
                      Importe o ZIP do SIMCAR, selecione camadas poligonais e gere pontos médios dos pares de vértices próximas sem comparar polígonos diferentes.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Entrada', value: '.zip' },
                      { label: 'Filtro', value: 'mm' },
                      { label: 'Saída', value: 'SHP' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                        <p className="mt-1 text-xs font-semibold text-violet-100">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">1. Upload do ZIP</h3>
                    <p className="text-xs text-slate-500 mt-1">O arquivo pode conter vários shapefiles. Apenas camadas poligonais com feições entram na análise.</p>
                  </div>
                  {verticesUploading && <Loader2 size={18} className="animate-spin text-violet-300" />}
                </div>
                <label
                  className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${verticesFile
                    ? 'border-violet-500/40 bg-violet-500/5'
                    : 'border-white/10 bg-white/[0.02] hover:border-violet-500/30 hover:bg-white/[0.03]'
                    } cursor-pointer`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void applyVerticesZipFile(e.dataTransfer.files?.[0] || null);
                  }}
                >
                  <input
                    ref={verticesFileInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => void applyVerticesZipFile(e.target.files?.[0] || null)}
                  />
                  <div className={`rounded-xl p-3 ${verticesFile ? 'bg-violet-500/15 text-violet-200' : 'bg-white/5 text-slate-400 group-hover:text-violet-300'}`}>
                    <Upload size={22} />
                  </div>
                  <div className="text-center min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {verticesFile ? verticesFile.name : 'Arraste ou selecione o ZIP do SIMCAR'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {verticesFile ? `${(verticesFile.size / 1024).toFixed(0)} KB` : 'Shapefiles compactados em .zip'}
                    </p>
                  </div>
                  {verticesFile && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        resetVerticesDraft();
                      }}
                      className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                      aria-label="Remover ZIP de vértices"
                    >
                      <X size={16} />
                    </button>
                  )}
                </label>
              </section>

              {verticesError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
                  <AlertTriangle size={16} />
                  <span>{verticesError}</span>
                </div>
              )}

              {verticesLayers.length > 0 && (
                <section className="relative overflow-hidden rounded-3xl border border-violet-400/15 bg-gradient-to-br from-[#0b1412]/95 via-[#101421]/90 to-[#140d1f]/90 p-4 shadow-2xl shadow-black/20 sm:p-6">
                  <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
                  <div className="relative space-y-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-100">
                          <Layers size={13} />
                          Camadas do ZIP
                        </div>
                        <h3 className="mt-3 text-lg font-bold text-white">2. Conferência das camadas</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          Escolha quais camadas entram na análise e ajuste pontos, tolerância e CRS antes de processar.
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
                        {[
                          { label: 'Camadas', value: verticesLayers.length },
                          { label: 'Analisáveis', value: verticesLayers.filter((layer) => !layer.ignoredReason && layer.featureCount > 0 && layer.geometryType === 'Polygon').length },
                          { label: 'Selecionadas', value: verticesLayers.filter((layer) => layer.analyze && !layer.ignoredReason && layer.featureCount > 0 && layer.geometryType === 'Polygon').length },
                        ].map((item) => (
                          <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                            <p className="mt-1 text-base font-black tabular-nums text-white">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-xs">
                          <thead>
                            <tr className="bg-white/[0.06] text-[10px] uppercase tracking-[0.18em] text-slate-400">
                              {['Analisar', 'Camada', 'Geometria', 'Feições', 'Pontos', 'Tolerância mm', 'CRS', 'Status'].map((head, idx) => (
                                <th key={head} className={`px-3 py-3 font-bold ${idx === 0 ? 'pl-4' : ''} ${idx === 7 ? 'pr-4' : ''}`}>{head}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {verticesLayers.map((layer, index) => {
                              const disabled = Boolean(layer.ignoredReason) || layer.featureCount <= 0 || layer.geometryType !== 'Polygon';
                              return (
                                <tr
                                  key={layer.id}
                                  className={`group transition-colors ${disabled
                                    ? 'text-slate-500 opacity-75'
                                    : 'text-slate-200 hover:bg-violet-500/[0.06]'
                                    } ${index % 2 === 0 ? 'bg-white/[0.015]' : 'bg-transparent'}`}
                                >
                                  <td className="border-t border-white/5 px-3 py-3 pl-4 align-middle">
                                    <label className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${disabled ? 'border-white/10 bg-white/[0.03]' : layer.analyze ? 'border-violet-300/40 bg-violet-500/20 text-violet-100 shadow-[0_0_18px_rgba(139,92,246,0.18)]' : 'border-white/10 bg-white/[0.04] hover:border-violet-300/30'}`}>
                                      <input
                                        type="checkbox"
                                        checked={layer.analyze}
                                        disabled={disabled}
                                        onChange={(e) => updateVerticesLayer(layer.id, { analyze: e.target.checked })}
                                        className="sr-only"
                                      />
                                      {layer.analyze && !disabled ? <CheckCircle2 size={17} /> : <Square size={15} />}
                                    </label>
                                  </td>
                                  <td className="max-w-[260px] border-t border-white/5 px-3 py-3 align-middle">
                                    <p className={`truncate font-bold ${disabled ? 'text-slate-500' : 'text-white'}`}>{layer.name}</p>
                                    {layer.path && <p className="mt-0.5 truncate text-[10px] text-slate-500">{layer.path}</p>}
                                  </td>
                                  <td className="border-t border-white/5 px-3 py-3 align-middle">
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${layer.geometryType === 'Polygon' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-500/10 text-slate-400'}`}>
                                      {layer.geometryType || '—'}
                                    </span>
                                  </td>
                                  <td className="border-t border-white/5 px-3 py-3 align-middle font-semibold tabular-nums text-slate-100">{layer.featureCount}</td>
                                  <td className="border-t border-white/5 px-3 py-3 align-middle">
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={layer.pointCount}
                                      disabled={disabled}
                                      onChange={(e) => updateVerticesLayer(layer.id, { pointCount: Math.max(1, Number(e.target.value || 1)) })}
                                      className="w-20 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2 text-xs font-semibold text-slate-100 outline-none transition focus:border-violet-400/60 focus:bg-violet-500/10 disabled:opacity-40"
                                    />
                                  </td>
                                  <td className="border-t border-white/5 px-3 py-3 align-middle">
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={layer.toleranceMm}
                                      disabled={disabled}
                                      placeholder="Opcional"
                                      onChange={(e) => updateVerticesLayer(layer.id, { toleranceMm: e.target.value })}
                                      className="w-28 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2 text-xs font-semibold text-slate-100 outline-none placeholder-slate-600 transition focus:border-violet-400/60 focus:bg-violet-500/10 disabled:opacity-40"
                                    />
                                  </td>
                                  <td className="max-w-[180px] border-t border-white/5 px-3 py-3 align-middle">
                                    {layer.missingCrs ? (
                                      <input
                                        type="text"
                                        value={layer.crsOverride}
                                        placeholder="EPSG:4674"
                                        onChange={(e) => updateVerticesLayer(layer.id, { crsOverride: e.target.value })}
                                        className="w-28 rounded-xl border border-amber-400/30 bg-amber-500/10 px-2 py-2 text-xs font-semibold text-amber-100 outline-none focus:border-amber-300"
                                      />
                                    ) : (
                                      <span className="block truncate text-slate-300" title={layer.crsLabel}>{layer.crsLabel}</span>
                                    )}
                                  </td>
                                  <td className="border-t border-white/5 px-3 py-3 pr-4 align-middle">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${disabled ? 'bg-white/5 text-slate-500' : layer.missingCrs ? 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/20' : 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/20'}`}>
                                      {!disabled && !layer.missingCrs && <CheckCircle2 size={12} />}
                                      {layer.ignoredReason || (layer.missingCrs ? 'CRS manual' : layer.status || 'Pronta')}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {verticesLayers.length > 0 && (
                <section className="relative overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-[#08130f]/95 via-[#0c1716]/95 to-[#111827]/90 p-4 shadow-2xl shadow-black/20 sm:p-6">
                  <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-20 left-1/3 h-44 w-44 rounded-full bg-violet-500/10 blur-3xl" />
                  <div className="relative space-y-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100">
                          <Settings size={13} />
                          Parâmetros da análise
                        </div>
                        <h3 className="mt-3 text-lg font-bold text-white">3. Configuração da análise</h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">
                          Não existe tolerância mínima obrigatória. Deixe em branco para buscar os pares mais próximos sem limite; preencha um valor apenas se quiser filtrar por distância máxima.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-emerald-300/15 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Regra ativa</p>
                        <p className="mt-1 text-2xl font-black leading-none tabular-nums">Sem limite</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Como funciona</p>
                        <p className="text-[11px] leading-relaxed text-slate-400">
                          O campo <strong className="text-slate-200">Pontos</strong> manda na quantidade: se colocar 6, retorna os 6 pares mais próximos disponíveis. Só há filtro de distância quando a tolerância da própria camada for preenchida.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {[
                          { checked: true, label: 'Gerar ponto médio', description: 'Sempre cria o ponto central entre os vértices.', disabled: true, onChange: () => undefined },
                          { checked: verticesIncludeOriginals, label: 'Gerar vértices A/B', description: 'Inclui os dois pontos originais detectados.', onChange: setVerticesIncludeOriginals },
                          { checked: verticesIncludeReport, label: 'Gerar relatório TXT', description: 'Resumo técnico em texto para conferência.', onChange: setVerticesIncludeReport },
                          { checked: verticesIncludeCsv, label: 'Gerar CSV resumo', description: 'Planilha com ranking, distâncias e camada.', onChange: setVerticesIncludeCsv },
                          { checked: verticesPreserveCrs, label: 'Manter CRS original', description: 'Entrega no mesmo sistema quando possível.', onChange: setVerticesPreserveCrs },
                          { checked: verticesMetricTemporary, label: 'Usar CRS métrico temporário', description: 'Mede distâncias em metros com mais precisão.', onChange: setVerticesMetricTemporary },
                        ].map((item) => (
                          <label
                            key={item.label}
                            className={`group rounded-2xl border p-3 transition-all ${item.checked
                              ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-50 shadow-[0_0_24px_rgba(16,185,129,0.08)]'
                              : 'border-white/10 bg-white/[0.035] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]'
                              } ${item.disabled ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${item.checked ? 'border-emerald-300/40 bg-emerald-400/15 text-emerald-200' : 'border-white/15 bg-white/[0.04] text-slate-500'}`}>
                                {item.checked ? <CheckCircle2 size={15} /> : <Square size={13} />}
                              </span>
                              <input
                                type="checkbox"
                                checked={item.checked}
                                disabled={item.disabled}
                                onChange={(e) => item.onChange(e.target.checked)}
                                className="sr-only"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs font-bold text-white">{item.label}</span>
                                <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 group-hover:text-slate-400">{item.description}</span>
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {verticesLayers.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white">4. Processamento</h3>
                      <p className="text-xs text-slate-500 mt-1">Cada feição, parte e anel é analisado isoladamente.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void startVerticesProcessing()}
                      disabled={verticesProcessing || verticesUploading || !verticesUploadId}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {verticesProcessing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
                      Processar vértices
                    </button>
                  </div>
                  {verticesProgress && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-slate-300">{verticesProgress.layer || verticesProgress.stage}</span>
                        <span className="font-bold tabular-nums text-violet-300">{verticesProgress.percent}%</span>
                      </div>
                      <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all duration-500" style={{ width: `${verticesProgress.percent}%` }} />
                      </div>
                      <p className="text-xs text-slate-400">{verticesProgress.message}</p>
                    </div>
                  )}
                </section>
              )}

              {(verticesRows.length > 0 || verticesDownloadUrl || verticesWarnings.length > 0) && (
                <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white">5. Resultado</h3>
                      <p className="text-xs text-slate-500 mt-1">{verticesRows.length} par(es) encontrado(s).</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {verticesDownloadUrl && (
                        <button
                          type="button"
                          onClick={() => downloadSimcarZip(verticesDownloadUrl, `vertices_proximas_${(verticesJobId || 'resultado').slice(0, 8)}.zip`)}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                        >
                          <Download size={16} />
                          Baixar ZIP
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setVerticesRows([]);
                          setVerticesWarnings([]);
                          setVerticesDownloadUrl(null);
                          setVerticesProgress(null);
                          setVerticesError(null);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                      >
                        <Trash2 size={16} />
                        Limpar análise
                      </button>
                      <button
                        type="button"
                        onClick={resetVerticesDraft}
                        className="inline-flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-100 hover:bg-violet-500/15"
                      >
                        <Plus size={16} />
                        Nova análise
                      </button>
                    </div>
                  </div>
                  {verticesWarnings.length > 0 && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
                      {verticesWarnings.map((warning, index) => (
                        <p key={`${warning}-${index}`}>{warning}</p>
                      ))}
                    </div>
                  )}
                  {verticesRows.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-white/10">
                      <table className="w-full min-w-[1100px] text-left text-xs">
                        <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-slate-500">
                          <tr>
                            {['Camada', 'Ranking', 'Feição', 'Parte', 'Anel', 'Vértice A', 'Vértice B', 'Dist m', 'Dist cm', 'Dist mm', 'X médio', 'Y médio'].map((head) => (
                              <th key={head} className="px-3 py-2">{head}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-slate-200">
                          {verticesRows.map((row, index) => (
                            <tr key={`${row.camada}-${row.ranking}-${index}`}>
                              <td className="px-3 py-2 font-semibold text-white">{row.camada}</td>
                              <td className="px-3 py-2 tabular-nums">{row.ranking}</td>
                              <td className="px-3 py-2 tabular-nums">{row.feicao}</td>
                              <td className="px-3 py-2 tabular-nums">{row.parte}</td>
                              <td className="px-3 py-2 tabular-nums">{row.anel}</td>
                              <td className="px-3 py-2 tabular-nums">{row.vertice_a}</td>
                              <td className="px-3 py-2 tabular-nums">{row.vertice_b}</td>
                              <td className="px-3 py-2 tabular-nums">{Number(row.dist_m || 0).toFixed(6)}</td>
                              <td className="px-3 py-2 tabular-nums">{Number(row.dist_cm || 0).toFixed(3)}</td>
                              <td className="px-3 py-2 tabular-nums">{Number(row.dist_mm || 0).toFixed(3)}</td>
                              <td className="px-3 py-2 tabular-nums">{Number(row.x_medio || 0).toFixed(8)}</td>
                              <td className="px-3 py-2 tabular-nums">{Number(row.y_medio || 0).toFixed(8)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        ) : activeView === 'features' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-5xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando manual de funcionalidades...</div>
              </div>
            </div>
          }>
            <FeaturesManual
              manualSection={manualSection}
              setManualSection={setManualSection}
              onGoChat={() => setActiveView('simcar-clip')}
              onGoSimcar={() => setActiveView('simcar-clip')}
              onGoCbers={() => setActiveView('cbers-wpm')}
            />
          </Suspense>
        ) : (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-5 sm:space-y-8 animate-fade-in-up">
              <section className="relative group">
                <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm" />
                <div className="relative bg-[#0e1612]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-6 md:p-8 flex flex-col items-center gap-4 sm:gap-6 md:flex-row">
                  <div className="relative shrink-0">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-2xl sm:text-3xl font-bold text-white shadow-2xl ring-4 ring-[#0e1612]">
                      {(userProfile?.fullName || 'U')
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <button className="absolute bottom-0 right-0 p-2 bg-emerald-600 rounded-full text-white hover:bg-emerald-500 transition-colors shadow-lg">
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="flex-1 text-center md:text-left space-y-1 sm:space-y-2 min-w-0">
                    <h2 className="text-xl sm:text-2xl font-semibold text-white truncate">{userProfile?.fullName || 'Usuário'}</h2>
                    <p className="text-sm sm:text-base text-slate-400 truncate">{userProfile?.email || 'email@exemplo.com'}</p>
                    <div className="flex items-center justify-center md:justify-start gap-2 pt-2 flex-wrap">
                      <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                        Plano Pro
                      </span>
                      <span className="px-3 py-1 rounded-full bg-white/5 text-slate-400 text-xs font-medium border border-white/10">
                        Membro desde 2023
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3 w-full md:w-auto">
                    <button
                      onClick={onEditProfileName}
                      className="w-full md:w-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-200 transition-all"
                    >
                      Editar Perfil
                    </button>
                  </div>
                </div>
              </section>

              {/* ── Saldo e Créditos ── */}
              <section className="relative group animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-700" />
                <div className="relative bg-[#0a110e]/70 backdrop-blur-2xl border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] rounded-3xl p-5 sm:p-8 md:p-10 overflow-hidden">

                  {/* Decorative glowing orbs */}
                  <div className="absolute -top-32 -right-32 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

                  <div className="relative flex flex-col pt-2 sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6 mb-8">
                    <div className="flex items-center gap-4">
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/20 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)] shrink-0">
                        <Wallet size={24} strokeWidth={2} />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg sm:text-xl text-white tracking-tight">Meus Créditos</h3>
                        <p className="text-xs sm:text-sm text-slate-400 mt-1">Cobrança por uso real. Sem plano mensal.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBillingTopupOpen(true)}
                      className="group/btn relative flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-white overflow-hidden shadow-[0_8px_16px_rgba(16,185,129,0.25)] hover:shadow-[0_12px_24px_rgba(16,185,129,0.35)] transition-all duration-300 hover:-translate-y-0.5 w-full sm:w-auto isolate"
                    >
                      <span className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out z-0" />
                      <Plus size={18} className="relative z-10 transition-transform duration-300 group-hover/btn:rotate-90" />
                      <span className="relative z-10">Adicionar créditos</span>
                    </button>
                  </div>

                  {/* Saldo principal */}
                  <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.08] p-6 sm:p-8 mb-8 backdrop-blur-md">
                    <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent opacity-50 pointer-events-none" />
                    <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
                      <div>
                        <p className="text-xs text-emerald-400/80 uppercase tracking-[0.2em] font-bold mb-2 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Saldo disponível
                        </p>
                        <p className="text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 tracking-tight drop-shadow-sm">
                          {billingLoading ? (
                            <span className="flex items-center gap-4 py-2">
                              <Loader2 size={32} className="animate-spin text-emerald-500/70" />
                              <span className="text-2xl text-slate-500 font-medium">Carregando...</span>
                            </span>
                          ) : (
                            formatBrl(billingMe?.wallet?.balanceBrl || 0)
                          )}
                        </p>
                        {!billingLoading && (billingMe?.wallet?.balanceBrl || 0) < 2 && (
                          <div className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
                            <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                            <p className="text-xs font-medium text-amber-300">Saldo baixo. Algumas ações podem ser bloqueadas.</p>
                          </div>
                        )}
                      </div>

                      {/* Currency helper mini-card inside main balance */}
                      {!billingLoading && (
                        <div className="flex items-center gap-2.5 px-4 py-2 bg-white/[0.03] border border-white/[0.05] rounded-xl self-start sm:self-end">
                          <DollarSign size={14} className="text-slate-400" />
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Câmbio USD</span>
                            <span className="text-xs text-slate-300 font-medium">{Number(billingPricing?.usdBrlRate || 0).toFixed(4)} <span className="text-slate-500">[{billingPricing?.usdBrlSource || 'n/d'}]</span></span>
                          </div>
                        </div>
                      )
                      }
                    </div>
                  </div>

                  {/* Cards de resumo */}
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 mb-8">
                    {[
                      { icon: TrendingUp, color: 'emerald', label: 'Total Recarregado', value: formatBrl(billingMe?.wallet?.totalTopupBrl || 0), subValue: null },
                      { icon: TrendingDown, color: 'rose', label: 'Total Gasto', value: formatBrl(billingMe?.wallet?.totalSpentBrl || 0), subValue: null },
                      { icon: Activity, color: 'blue', label: 'Gasto Hoje', value: formatBrl(billingMe?.usageToday?.totalCostBrl || 0), subValue: `${billingMe?.usageToday?.totalRequests || 0} reqs` },
                      { icon: Cpu, color: 'purple', label: 'Custo Médio / Req', value: (billingMe?.usageToday?.totalRequests || 0) > 0 ? formatBrl((billingMe?.usageToday?.totalCostBrl || 0) / (billingMe?.usageToday?.totalRequests || 1)) : 'R$ 0,00', subValue: 'hoje' }
                    ].map((card, idx) => (
                      <div key={idx} className={`group/card relative overflow-hidden rounded-2xl bg-[#131b17] border border-white/[0.05] p-5 hover:border-${card.color}-500/30 hover:bg-[#16201b] transition-all duration-300 shadow-sm`}>
                        <div className={`absolute -right-4 -top-4 w-16 h-16 bg-${card.color}-500/5 rounded-full blur-xl group-hover/card:bg-${card.color}-500/10 transition-colors pointer-events-none`} />
                        <div className="flex flex-col h-full relative z-10">
                          <div className="flex items-center gap-2.5 mb-3">
                            <div className={`p-1.5 rounded-lg bg-${card.color}-500/10 text-${card.color}-400 group-hover/card:scale-110 transition-transform duration-300`}>
                              <card.icon size={16} strokeWidth={2.5} />
                            </div>
                            <h4 className="text-[10px] text-slate-400 uppercase tracking-wider font-bold truncate leading-tight">{card.label}</h4>
                          </div>
                          <div className="mt-auto">
                            <p className="text-lg sm:text-xl font-bold text-white tracking-tight">{card.value}</p>
                            {card.subValue && <p className="text-[10px] text-slate-500 font-medium mt-1">{card.subValue}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Token summary strip */}
                  {(billingMe?.usageToday?.totalInputTokens || 0) + (billingMe?.usageToday?.totalOutputTokens || 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4 mb-8 rounded-2xl bg-[#0e1411] border border-white/[0.03] shadow-inner">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-widest shrink-0">
                        <Zap size={14} className="text-yellow-500" /> TOKENS (HOJE)
                      </div>
                      <div className="w-px h-4 bg-white/10 hidden sm:block" />
                      <div className="flex flex-wrap gap-4 sm:gap-8 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                          <span className="text-slate-400 text-xs">Entrada:</span>
                          <span className="text-white text-sm font-semibold tracking-tight">{(billingMe?.usageToday?.totalInputTokens || 0).toLocaleString('pt-BR')}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                          <span className="text-slate-400 text-xs">Saída:</span>
                          <span className="text-white text-sm font-semibold tracking-tight">{(billingMe?.usageToday?.totalOutputTokens || 0).toLocaleString('pt-BR')}</span>
                        </span>
                        <div className="ml-auto flex items-center gap-2 bg-white/5 px-3 py-1 rounded-lg">
                          <span className="text-slate-400 text-xs">Total:</span>
                          <span className="text-emerald-300 text-sm font-bold tracking-tight">
                            {((billingMe?.usageToday?.totalInputTokens || 0) + (billingMe?.usageToday?.totalOutputTokens || 0)).toLocaleString('pt-BR')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Consumo por modelo + Histórico lado a lado */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Consumo por modelo */}
                    <div className="flex flex-col rounded-2xl bg-[#0e1411] border border-white/[0.04] overflow-hidden">
                      <div className="flex items-center gap-3 p-5 border-b border-white/[0.04] bg-white/[0.01]">
                        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                          <BarChart3 size={16} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-200">Consumo por Categoria</h4>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Últimos 7 dias</p>
                        </div>
                      </div>
                      <div className="p-2 sm:p-5 flex-1 max-h-[320px] overflow-y-auto custom-scrollbar">
                        {billingMe?.modelSnapshot?.length ? (
                          <div className="space-y-4 pr-2">
                            {billingMe.modelSnapshot.slice(0, 10).map((item) => {
                              const maxCost = Math.max(...(billingMe.modelSnapshot || []).map((m) => m.costBrl), 0.01);
                              const pct = Math.min(100, (item.costBrl / maxCost) * 100);
                              const totalTk = (item.inputTokens || 0) + (item.outputTokens || 0);
                              return (
                                <div key={`${item.provider}-${item.model}`} className="group/row">
                                  <div className="flex items-center justify-between text-xs mb-2">
                                    <span className="text-slate-300 font-medium truncate shrink" title={item.model}>{item.model}</span>
                                    <div className="flex items-center gap-3 shrink-0 ml-2">
                                      <span className="text-[10px] font-semibold text-slate-500 bg-white/5 px-2 py-0.5 rounded-md">{item.requests || 0} reqs</span>
                                      <span className="text-white font-bold">{formatBrl(item.costBrl)}</span>
                                    </div>
                                  </div>
                                  <div className="h-2 rounded-full bg-black/40 overflow-hidden mb-1.5 border border-white/[0.02]">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-out relative overflow-hidden"
                                      style={{ width: `${pct}%` }}
                                    >
                                      <div className="absolute top-0 inset-x-0 h-[1px] bg-white/30" />
                                    </div>
                                  </div>
                                  {totalTk > 0 && (
                                    <div className="flex items-center gap-4 text-[10px] font-medium text-slate-500">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        {(item.inputTokens || 0).toLocaleString('pt-BR')} IN
                                      </span>
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        {(item.outputTokens || 0).toLocaleString('pt-BR')} OUT
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full py-10 text-slate-500">
                            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/5">
                              <BarChart3 size={24} className="opacity-50" />
                            </div>
                            <p className="text-sm font-medium text-slate-400">Sem dados recentes.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Histórico / Últimos lançamentos */}
                    <div className="flex flex-col rounded-2xl bg-[#0e1411] border border-white/[0.04] overflow-hidden">
                      <div className="flex items-center gap-3 p-5 border-b border-white/[0.04] bg-white/[0.01]">
                        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                          <Receipt size={16} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-200">Histórico de Transações</h4>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Últimas movimentações</p>
                        </div>
                      </div>
                      <div className="p-2 sm:p-3 flex-1 max-h-[320px] overflow-y-auto custom-scrollbar">
                        {billingLedger.length ? (
                          <div className="space-y-1">
                            {billingLedger.slice(0, 15).map((entry) => {
                              const amount = Number(entry.amountBrl || 0);
                              const isPositive = amount >= 0;
                              const isNeutral = entry.type === 'reserve_release' && amount === 0;
                              const typeLabel: Record<string, string> = {
                                topup_manual: 'Recarga Manual',
                                usage_debit: 'Processamento IA',
                                reserve_hold: 'Cativo (Reserva)',
                                reserve_release: 'Estorno de Reserva',
                                refund: 'Reembolso',
                              };
                              const label = typeLabel[entry.type] || String(entry.type || 'Movimentação').replace(/_/g, ' ');
                              const dateStr = entry.createdAt?.toDate
                                ? entry.createdAt.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                                : entry.createdAt?._seconds
                                  ? new Date(entry.createdAt._seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                                  : '';

                              let iconBg = 'bg-white/5 text-slate-400';
                              let amountColor = 'text-slate-400';
                              let amountPrefix = '';
                              let Icon = Activity;

                              if (isPositive && !isNeutral) {
                                iconBg = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                                amountColor = 'text-emerald-400';
                                amountPrefix = '+';
                                Icon = ArrowUpRight;
                              } else if (!isPositive) {
                                iconBg = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
                                amountColor = 'text-white'; // Destaque branco para saídas com fundo escuro, ou mantém vermelho sutil
                                Icon = ArrowDownRight;
                              }

                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-4 py-3 px-4 rounded-xl hover:bg-white/[0.04] transition-colors group/item"
                                >
                                  <div className={`p-2 rounded-xl shrink-0 transition-transform group-hover/item:scale-110 ${iconBg}`}>
                                    <Icon size={16} strokeWidth={2.5} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-200 truncate">{label}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {dateStr && <span className="text-[10px] font-medium text-slate-500">{dateStr}</span>}
                                      {entry.model && (
                                        <>
                                          <span className="w-1 h-1 rounded-full bg-slate-700" />
                                          <span className="text-[10px] font-medium text-slate-400 truncate max-w-[120px]">{entry.model}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className={`text-sm font-bold tracking-tight ${amountColor}`}>
                                      {amountPrefix}{formatBrl(Math.abs(amount))}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full py-10 text-slate-500">
                            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/5">
                              <Receipt size={24} className="opacity-50" />
                            </div>
                            <p className="text-sm font-medium text-slate-400">Sem histórico recente.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </section>

              {/* ── Segurança ── */}
              <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                    <Shield size={20} />
                  </div>
                  <h3 className="font-semibold text-lg text-slate-200">Segurança</h3>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={onResetPassword}
                    disabled={resettingPassword}
                    className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm text-slate-300">{resettingPassword ? 'Enviando e-mail...' : 'Alterar Senha'}</span>
                    {resettingPassword ? (
                      <Loader2 size={16} className="text-slate-500 animate-spin" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
                    )}
                  </button>
                  <button
                    onClick={() => updateSettings({ twoFactorEnabled: !settings.twoFactorEnabled })}
                    className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group"
                  >
                    <div className="flex flex-col text-left">
                      <span className="text-sm text-slate-300">Autenticação em 2 Etapas</span>
                      <span className={`text-[10px] flex items-center gap-1 ${settings.twoFactorEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {settings.twoFactorEnabled ? 'Ativado' : 'Desativado'}
                      </span>
                    </div>
                    <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
                  </button>
                  <TermsOfUseDialog
                    triggerClassName="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group text-left"
                  />
                </div>
              </section>
            </div>
          </div>
        )}


        {
          billingTopupOpen && (
            <div className="fixed inset-0 z-[145] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#0b120f] p-4 sm:p-5 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">Adicionar Créditos</h3>
                  <button
                    type="button"
                    onClick={() => setBillingTopupOpen(false)}
                    className="h-8 w-8 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Informe o valor em BRL e confirme em <strong className="text-slate-300">Paguei</strong> para crédito instantâneo.
                </p>
                <div className="space-y-2">
                  <label className="text-xs text-slate-400">Valor (R$)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={billingTopupAmount}
                    onChange={(e) => setBillingTopupAmount(e.target.value)}
                    className="w-full bg-[#050b08] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500/50"
                  />
                </div>
                <button
                  type="button"
                  onClick={onManualTopup}
                  disabled={billingTopupLoading}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {billingTopupLoading ? 'Processando...' : 'Paguei'}
                </button>
              </div>
            </div>
          )
        }

        <style>{`
          .custom-scrollbar {
            -webkit-overflow-scrolling: touch;
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(16, 185, 129, 0.4);
          }
          @media (max-width: 640px) {
            .custom-scrollbar::-webkit-scrollbar {
              width: 3px;
            }
          }
          @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(12px) scale(0.995); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in-up {
            animation: fade-in-up 0.48s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }
          .typing-dot {
            width: 6px;
            height: 6px;
            background: rgba(16, 185, 129, 0.7);
            border-radius: 999px;
            display: inline-block;
            animation: typing 1.2s infinite ease-in-out;
          }
          .typing-dot:nth-child(2) { animation-delay: 0.15s; }
          .typing-dot:nth-child(3) { animation-delay: 0.3s; }
          @keyframes typing {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
          .thinking-status-dot {
            width: 0.36rem;
            height: 0.36rem;
            border-radius: 999px;
            background: currentColor;
            opacity: 0.9;
            animation: thinking-pulse 1.1s ease-in-out infinite;
          }
          @keyframes thinking-pulse {
            0%, 100% { transform: scale(0.7); opacity: 0.45; }
            50% { transform: scale(1); opacity: 1; }
          }
          .thinking-caret {
            display: inline-block;
            width: 0.5rem;
            height: 0.92em;
            border-right: 2px solid rgba(196, 181, 253, 0.95);
            animation: thinking-caret-blink 0.9s step-end infinite;
          }
          @keyframes thinking-caret-blink {
            50% { opacity: 0; }
          }
          .chat-markdown .chat-p {
            margin: 0;
            white-space: pre-wrap;
          }
          .chat-markdown .chat-p + .chat-p {
            margin-top: 0.55rem;
          }
          .chat-markdown .chat-gap {
            height: 0.45rem;
          }
          .chat-markdown strong {
            color: #e8fff2;
            font-weight: 700;
          }
          .chat-markdown em {
            color: #b6f3d0;
          }
          .chat-markdown ul, .chat-markdown ol {
            margin: 0.45rem 0 0.2rem 1.05rem;
            padding: 0;
          }
          .chat-markdown li + li {
            margin-top: 0.2rem;
          }
          .chat-markdown code {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 0.08rem 0.35rem;
            font-size: 0.82em;
          }
          .chat-markdown a {
            color: #6ee7b7;
            text-decoration: underline;
          }
          .chat-markdown .chat-table-wrap {
            margin: 0.55rem 0;
            overflow-x: auto;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.7rem;
            background: rgba(2, 6, 23, 0.4);
          }
          .chat-markdown .chat-table {
            width: 100%;
            border-collapse: collapse;
            min-width: 320px;
          }
          .chat-markdown .chat-table th {
            text-align: left;
            font-size: 0.71rem;
            color: #b6f3d0;
            background: rgba(16, 185, 129, 0.08);
            border-bottom: 1px solid rgba(16, 185, 129, 0.2);
            padding: 0.45rem 0.55rem;
            font-weight: 600;
          }
          .chat-markdown .chat-table td {
            vertical-align: top;
            font-size: 0.74rem;
            color: #dbe7f5;
            border-top: 1px solid rgba(255, 255, 255, 0.07);
            padding: 0.42rem 0.55rem;
            white-space: normal;
          }
          .chat-markdown .chat-table tbody tr:nth-child(even) {
            background: rgba(148, 163, 184, 0.06);
          }
          .analysis-markdown {
            color: #dbe7f5;
            line-height: 1.6;
          }
          .analysis-markdown strong {
            color: #f7fbff;
            font-weight: 700;
          }
          .analysis-markdown em {
            color: #c3d6f3;
          }
          .analysis-markdown code {
            background: rgba(148, 163, 184, 0.14);
            border: 1px solid rgba(148, 163, 184, 0.25);
            border-radius: 6px;
            padding: 0.08rem 0.35rem;
            font-size: 0.82em;
          }
          .analysis-markdown .analysis-h1 {
            font-size: 0.95rem;
            font-weight: 700;
            color: #ffffff;
            margin-top: 0.15rem;
          }
          .analysis-markdown .analysis-h2 {
            font-size: 0.9rem;
            font-weight: 700;
            color: #e3ecff;
            margin-top: 0.25rem;
          }
          .analysis-markdown .analysis-h3 {
            font-size: 0.84rem;
            font-weight: 700;
            color: #d0ddff;
            margin-top: 0.2rem;
          }
          .analysis-markdown .analysis-item {
            display: flex;
            align-items: flex-start;
            gap: 0.45rem;
          }
          .analysis-markdown .analysis-item + .analysis-item {
            margin-top: 0.25rem;
          }
          .analysis-markdown .analysis-marker {
            flex-shrink: 0;
            color: #a5b8d8;
            min-width: 1rem;
            text-align: right;
          }
          .analysis-markdown .analysis-content {
            flex: 1;
          }
          .analysis-markdown .analysis-p + .analysis-p {
            margin-top: 0.45rem;
          }
          .analysis-markdown .analysis-quote {
            border-left: 2px solid rgba(168, 85, 247, 0.5);
            padding-left: 0.7rem;
            color: #c6d2e8;
          }
          .analysis-markdown .analysis-divider {
            border-top: 1px solid rgba(148, 163, 184, 0.24);
            margin: 0.45rem 0;
          }
          .analysis-markdown .analysis-gap {
            height: 0.42rem;
          }
          body.theme-light {
            background: #edf7f1;
          }
          body.theme-light #root {
            filter: saturate(0.95);
          }
          @media (prefers-reduced-motion: reduce) {
            .animate-fade-in-up, .typing-dot, .thinking-status-dot, .thinking-caret {
              animation: none !important;
            }
          }
        `}</style>
      </main>
      <VerticesProximasInfoDialog />
    </div>
  );
}
