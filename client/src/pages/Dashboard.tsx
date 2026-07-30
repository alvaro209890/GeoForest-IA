import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Receipt,
  ArrowUpRight,
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
  ShieldAlert,
  FileStack,
  CalendarClock,
  Combine,
  Map as MapIcon,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DASHBOARD_VIEW_LABELS,
  DashboardSidebarTabs,
  useCbersJobs,
  useLandsatJobs,
  useOverlapJobs,
  useCroquiJobs,
  useDashboardNavigation,
  type DashboardView,
} from '@/dashboard';
import {
  DEFAULT_SETTINGS,
  SETTINGS_FONT_SIZE_OPTIONS,
  SETTINGS_THEME_OPTIONS,
  type UserSettings,
} from '@/dashboard/settings/types';
import {
  apiFetch as apiFetchShared,
  apiUrl,
  fileToBase64,
  readApiError as readApiErrorShared,
  resolveBackendUrl,
} from '@/lib/api';
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
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import VerticesProximasInfoDialog from '@/components/VerticesProximasInfoDialog';
import type { ContainmentRow, ContainmentSummary } from '@/components/ContainmentAnalysis';
import type { GeometryErrorRow, GeometrySummary } from '@/components/GeometryErrorsAnalysis';

const FeaturesManual = lazy(() => import('@/components/FeaturesManual'));
const ReceiptsHub = lazy(() => import('@/components/ReceiptsHub'));
const AuasSccon = lazy(() => import('@/components/AuasSccon'));
const ContainmentAnalysis = lazy(() => import('@/components/ContainmentAnalysis'));
const GeometryErrorsAnalysis = lazy(() => import('@/components/GeometryErrorsAnalysis'));
const SettingsPanel = lazy(() => import('@/dashboard/panels/SettingsPanel'));
const CbersPanel = lazy(() => import('@/dashboard/panels/CbersPanel'));
const LandsatPanel = lazy(() => import('@/dashboard/panels/LandsatPanel'));
const SobreposicoesPanel = lazy(() => import('@/dashboard/panels/SobreposicoesPanel'));
const CroquiPanel = lazy(() => import('@/dashboard/panels/CroquiPanel'));

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

type ContainmentHistoryItem = {
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

type GeometryHistoryItem = {
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

type ReceiptHistoryItem = {
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

interface DashboardProps {
  initialView?: DashboardView;
  hideSidebar?: boolean;
}

export default function Dashboard({ initialView = 'simcar-clip', hideSidebar = false }: DashboardProps) {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedErrorLocation, setSelectedErrorLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [selectedErrorLabel, setSelectedErrorLabel] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>(initialView);
  const { navigateView } = useDashboardNavigation(setActiveView);
  const initialViewRef = React.useRef(initialView);

  useEffect(() => {
    if (initialView) {
      setActiveView(initialView);
      initialViewRef.current = initialView;
    }
  }, [initialView]);

  // Sub-abas dentro de "Análise de Erros": vértices próximas x áreas não contidas (containment) x erros de geometria
  const [errorAnalysisTab, setErrorAnalysisTab] = useState<'vertices' | 'containment' | 'geometry'>('vertices');
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
  const [containmentHistory, setContainmentHistory] = useState<ContainmentHistoryItem[]>([]);
  const [containmentJobId, setContainmentJobId] = useState<string | null>(null);
  const [geometryHistory, setGeometryHistory] = useState<GeometryHistoryItem[]>([]);
  const [geometryJobId, setGeometryJobId] = useState<string | null>(null);
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
  const [containmentJobsRef, setContainmentJobsRef] = useState<ReturnType<typeof collection> | null>(null);
  const [geometryJobsRef, setGeometryJobsRef] = useState<ReturnType<typeof collection> | null>(null);
  const [receiptHistory, setReceiptHistory] = useState<ReceiptHistoryItem[]>([]);
  const [receiptsRef, setReceiptsRef] = useState<ReturnType<typeof collection> | null>(null);
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

  const apiFetch = apiFetchShared;
  const readApiError = readApiErrorShared;

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
    navigateView('settings');
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

  const fileToBase64Payload = fileToBase64;

  const cbersDownloadZipRef = useRef<(url?: string | null, filename?: string) => void | Promise<void>>(async () => {});
  const cbersDownloadZip = useCallback((url?: string | null, filename?: string) => {
    return cbersDownloadZipRef.current(url, filename);
  }, []);

  const cbers = useCbersJobs({
    apiFetch,
    requestProcessCancel,
    downloadZip: cbersDownloadZip,
    fileToBase64Payload,
  });
  const {
    cbersHistory,
    setCbersHistory,
    cbersJobId,
    setCbersJobId,
    setCbersProcessing,
    resetCbersDraft,
    selectCbersHistoryEntry,
    hydrateFromDocs: hydrateCbersFromDocs,
    deleteCbersJob,
  } = cbers;

  const landsatDownloadZipRef = useRef<(url?: string | null, filename?: string) => void | Promise<void>>(async () => {});
  const landsatDownloadZip = useCallback((url?: string | null, filename?: string) => {
    return landsatDownloadZipRef.current(url, filename);
  }, []);

  const landsat = useLandsatJobs({
    apiFetch,
    downloadZip: landsatDownloadZip,
    fileToBase64Payload,
  });
  const {
    landsatHistory,
    setLandsatHistory,
    landsatJobId,
    setLandsatJobId,
    setLandsatProcessing,
    resetLandsatDraft,
    selectLandsatHistoryEntry,
    hydrateFromDocs: hydrateLandsatFromDocs,
    deleteLandsatJob,
  } = landsat;

  const overlapDownloadZipRef = useRef<(url?: string | null, filename?: string) => void | Promise<void>>(async () => {});
  const overlapDownloadZip = useCallback((url?: string | null, filename?: string) => {
    return overlapDownloadZipRef.current(url, filename);
  }, []);

  const overlap = useOverlapJobs({
    apiFetch,
    downloadZip: overlapDownloadZip,
    fileToBase64Payload,
  });
  const {
    overlapHistory,
    overlapJobId,
    resetOverlapDraft,
    selectOverlapHistoryEntry,
    hydrateFromDocs: hydrateOverlapFromDocs,
    deleteOverlapJob,
  } = overlap;

  const croquiDownloadZipRef = useRef<(url?: string | null, filename?: string) => void | Promise<void>>(async () => {});
  const croquiDownloadZip = useCallback((url?: string | null, filename?: string) => {
    return croquiDownloadZipRef.current(url, filename);
  }, []);

  const croqui = useCroquiJobs({
    apiFetch,
    downloadZip: croquiDownloadZip,
    fileToBase64Payload,
  });
  const {
    croquiHistory,
    croquiJobId,
    resetCroquiDraft,
    selectCroquiHistoryEntry,
    hydrateFromDocs: hydrateCroquiFromDocs,
    deleteCroquiJob,
  } = croqui;

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

  const mapContainmentDocToHistoryItem = useCallback((docId: string, data: any): ContainmentHistoryItem => {
    const rawStatus = String(data?.status || '').trim().toLowerCase();
    const status: ContainmentHistoryItem['status'] =
      rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
        ? rawStatus
        : 'processing';
    return {
      id: String(data?.id || docId),
      jobId: String(data?.jobId || docId),
      filename: String(data?.filename || 'Áreas Não Contidas'),
      timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
      status,
      stage: data?.stage ? String(data.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
      message: data?.message ? String(data.message) : undefined,
      error: data?.error ? String(data.error) : undefined,
      downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
      outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
      outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
      resultRows: Array.isArray(data?.resultRows) ? data.resultRows as ContainmentRow[] : undefined,
      summary: data?.summary && typeof data.summary === 'object' ? data.summary as ContainmentSummary : undefined,
      warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
      targetLayerName: data?.targetLayerName ? String(data.targetLayerName) : undefined,
      containerCount: Number.isFinite(Number(data?.containerCount)) ? Number(data.containerCount) : undefined,
    };
  }, []);

  const mapGeometryDocToHistoryItem = useCallback((docId: string, data: any): GeometryHistoryItem => {
    const rawStatus = String(data?.status || '').trim().toLowerCase();
    const status: GeometryHistoryItem['status'] =
      rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
        ? rawStatus
        : 'processing';
    return {
      id: String(data?.id || docId),
      jobId: String(data?.jobId || docId),
      filename: String(data?.filename || 'Erros de Geometria'),
      timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
      status,
      stage: data?.stage ? String(data.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
      message: data?.message ? String(data.message) : undefined,
      error: data?.error ? String(data.error) : undefined,
      downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
      resultRows: Array.isArray(data?.resultRows) ? data.resultRows as GeometryErrorRow[] : undefined,
      warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
      summary: status === 'completed' ? {
        totalErrors: Number(data?.totalErrors || 0),
        featuresWithErrors: Number(data?.featuresWithErrors || 0),
        analyzedLayers: Array.isArray(data?.analyzedLayers) ? data.analyzedLayers : [],
        fixedLayers: Array.isArray(data?.fixedLayers) ? data.fixedLayers : [],
      } : undefined,
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
    navigateView('vertices-proximas');
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
          setContainmentJobsRef(null);
          setGeometryJobsRef(null);
          setReceiptsRef(null);
          setCbersHistory([]);
          setLandsatHistory([]);
          setVerticesHistory([]);
          setContainmentHistory([]);
          setContainmentJobId(null);
          setGeometryHistory([]);
          setGeometryJobId(null);
          setReceiptHistory([]);
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
        const containmentRef = collection(db, 'users', currentUser.uid, 'containment_jobs');
        setContainmentJobsRef(containmentRef);
        const geometryRef = collection(db, 'users', currentUser.uid, 'geometry_errors_jobs');
        setGeometryJobsRef(geometryRef);
        const receiptsColRef = collection(db, 'users', currentUser.uid, 'receipts');
        setReceiptsRef(receiptsColRef);
        const cbersRef = collection(db, 'users', currentUser.uid, 'cbers_wpm_jobs');
        const landsatRef = collection(db, 'users', currentUser.uid, 'landsat_jobs');
        const overlapRef = collection(db, 'users', currentUser.uid, 'overlap_jobs');
        const croquiRef = collection(db, 'users', currentUser.uid, 'croqui_jobs');

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
            navigateView('vertices-proximas');
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
          const containmentSnap = await getDocs(query(containmentRef, orderBy('updatedAtMs', 'desc')));
          const containmentEntries: ContainmentHistoryItem[] = [];
          containmentSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const item = mapContainmentDocToHistoryItem(docSnap.id, data);
            if (item.status !== 'uploaded' && item.status !== 'deleted') containmentEntries.push(item);
          });
          setContainmentHistory(containmentEntries);
          const runningContainment = containmentEntries.find((entry) => entry.status === 'processing');
          if (runningContainment) {
            navigateView('vertices-proximas');
            setErrorAnalysisTab('containment');
            setContainmentJobId(runningContainment.jobId);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico de containment salvo:', error);
        }

        try {
          const geometrySnap = await getDocs(query(geometryRef, orderBy('updatedAtMs', 'desc')));
          const geometryEntries: GeometryHistoryItem[] = [];
          geometrySnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const item = mapGeometryDocToHistoryItem(docSnap.id, data);
            if (item.status !== 'uploaded' && item.status !== 'deleted') geometryEntries.push(item);
          });
          setGeometryHistory(geometryEntries);
          const runningGeometry = geometryEntries.find((entry) => entry.status === 'processing');
          if (runningGeometry) {
            navigateView('vertices-proximas');
            setErrorAnalysisTab('geometry');
            setGeometryJobId(runningGeometry.jobId);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico de erros de geometria salvo:', error);
        }

        try {
          const receiptsSnap = await getDocs(query(receiptsColRef, orderBy('updatedAtMs', 'desc')));
          const receiptsEntries: ReceiptHistoryItem[] = [];
          receiptsSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            receiptsEntries.push({
              id: String(data?.id || docSnap.id),
              receiptId: String(data?.receiptId || docSnap.id),
              type: data?.type === 'apf' ? 'apf' : 'simcar',
              filename: String(data?.filename || 'Recibo'),
              timestamp: String(data?.timestamp || data?.updatedAt || new Date().toISOString()),
              status: data?.status === 'failed' ? 'failed' : 'completed',
              downloadUrl: data?.downloadUrl ? String(data.downloadUrl) : undefined,
              error: data?.error ? String(data.error) : undefined,
              cpf: data?.cpf ? String(data.cpf) : undefined,
              car: data?.car ? String(data.car) : undefined,
              sizeBytes: Number.isFinite(Number(data?.sizeBytes)) ? Number(data.sizeBytes) : undefined,
            });
          });
          setReceiptHistory(receiptsEntries);
        } catch (error) {
          console.warn('Falha ao carregar histórico de recibos:', error);
        }

        try {
          const cbersSnap = await getDocs(query(cbersRef, orderBy('updatedAtMs', 'desc')));
          const docs = cbersSnap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() as any }));
          hydrateCbersFromDocs(docs);
        } catch (error) {
          console.warn('Falha ao carregar histórico CBERS salvo:', error);
        }

        try {
          const landsatSnap = await getDocs(query(landsatRef, orderBy('updatedAtMs', 'desc')));
          const docs = landsatSnap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() as any }));
          hydrateLandsatFromDocs(docs);
        } catch (error) {
          console.warn('Falha ao carregar histórico Landsat salvo:', error);
        }

        try {
          const overlapSnap = await getDocs(query(overlapRef, orderBy('updatedAtMs', 'desc')));
          const docs = overlapSnap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() as any }));
          hydrateOverlapFromDocs(docs);
        } catch (error) {
          console.warn('Falha ao carregar histórico de sobreposições:', error);
        }

        try {
          const croquiSnap = await getDocs(query(croquiRef, orderBy('updatedAtMs', 'desc')));
          const docs = croquiSnap.docs.map((docSnap: any) => ({ id: docSnap.id, data: docSnap.data() as any }));
          hydrateCroquiFromDocs(docs);
        } catch (error) {
          console.warn('Falha ao carregar histórico de croquis:', error);
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
  }, [mapVerticesDocToHistoryItem, normalizeSimcarClipSummary, normalizeSimcarReportPatch, hydrateCbersFromDocs, hydrateLandsatFromDocs, hydrateOverlapFromDocs, hydrateCroquiFromDocs, selectSimcarClipEntry, setLocation]);

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
    if (initialViewRef.current === 'simcar-clip') {
      navigateView('simcar-clip');
    }
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
    if (initialViewRef.current === 'simcar-clip') {
      navigateView('simcar-clip');
    }
    // Não fechar a sidebar no boot: os cards de histórico moram nela.
    // Em mobile, o fechamento fica a cargo de onSelectConversation.
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

  cbersDownloadZipRef.current = downloadSimcarZip;
  landsatDownloadZipRef.current = downloadSimcarZip;
  overlapDownloadZipRef.current = downloadSimcarZip;
  croquiDownloadZipRef.current = downloadSimcarZip;

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

      {!hideSidebar && (
        <aside
          className={`
          fixed lg:relative z-30 flex flex-col h-full w-[85vw] max-w-80
          bg-gradient-to-b from-[#0a120e]/98 via-[#0a120e]/95 to-[#0a120e]/98
          backdrop-blur-2xl border-r border-emerald-500/10
          shadow-2xl shadow-black/30
          transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isSidebarOpen ? 'translate-x-0 lg:w-80 lg:max-w-80' : '-translate-x-full lg:translate-x-0 lg:w-80 lg:max-w-80'}
        `}
      >
        <div className="p-5 flex items-center gap-3 cursor-pointer group/sidebar-logo" onClick={() => navigateView('simcar-clip')}>
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
          <div className="flex flex-col overflow-hidden transition-all duration-300 opacity-100">
            <span className="font-bold text-base tracking-tight text-white group-hover/sidebar-logo:text-emerald-200 transition-colors">GeoForest IA</span>
            <span className="text-[10px] text-emerald-400/70 font-medium tracking-[0.15em] uppercase">Forestry Intelligence</span>
          </div>
        </div>

        <div className="px-1 sm:px-3 mb-3 space-y-2">
          {/* ─── Abas — Segmented Control Moderno ─── */}
          <DashboardSidebarTabs
            activeView={activeView}
            onNavigate={(view) => {
              navigateView(view);
              if (view === 'simcar-clip' && simcarClipLayers.length === 0 && !simcarClipLayersLoading) {
                loadSimcarClipLayers();
              }
            }}
          />

          {/* ─── Botão de ação contextual (camada única — evita “++” do botão em anel) ─── */}
          {activeView === 'simcar-clip' && (
            <button
              type="button"
              onClick={() => { resetSimcarDraft('auto-clip'); navigateView('simcar-clip'); }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Novo Recorte</span>
            </button>
          )}
          {activeView === 'cbers-wpm' && (
            <button
              type="button"
              onClick={() => resetCbersDraft()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Nova Imagem</span>
            </button>
          )}
          {activeView === 'landsat' && (
            <button
              type="button"
              onClick={() => resetLandsatDraft()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Nova Landsat</span>
            </button>
          )}
          {activeView === 'sobreposicoes' && (
            <button
              type="button"
              onClick={() => resetOverlapDraft()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-teal-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Nova Análise</span>
            </button>
          )}
          {activeView === 'croqui' && (
            <button
              type="button"
              onClick={() => resetCroquiDraft()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-amber-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Novo Croqui</span>
            </button>
          )}
          {activeView === 'vertices-proximas' && (
            <button
              type="button"
              onClick={() => resetVerticesDraft()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 py-2.5 px-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-all"
            >
              <Plus size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
              <span>Nova Análise</span>
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
                  <div className="flex-1 min-w-0 block">
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
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                    title="Excluir imagem"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block">
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
                  <div className="flex-1 min-w-0 block">
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
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                    title="Excluir imagem"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <Layers size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhuma imagem Landsat.</p>
              </div>
            )
          ) : activeView === 'sobreposicoes' ? (
            overlapHistory.length > 0 ? (
              overlapHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${overlapJobId === entry.jobId ? 'bg-teal-500/10 border-teal-500/20 shadow-[0_0_15px_rgba(20,184,166,0.06)]' : 'bg-[#071413]/60 hover:bg-[#101b1a] hover:border-teal-500/20'}`}
                  onClick={() => selectOverlapHistoryEntry(entry)}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${overlapJobId === entry.jobId ? 'bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-md shadow-teal-900/40' : 'bg-white/5 text-slate-400 group-hover:text-teal-300 group-hover:bg-teal-500/10'}`}>
                    <Combine size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block">
                    <p className={`text-sm truncate font-medium ${overlapJobId === entry.jobId ? 'text-teal-100' : 'text-slate-200 group-hover:text-teal-100'}`}>{entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-teal-300">
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
                      {entry.targetCount ? `${entry.targetCount} imóvel(is)` : 'Sobreposições'} • {(entry.modes || []).length} modo(s)
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteOverlapJob(entry);
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                    title="Excluir análise"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <Combine size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhuma análise de sobreposição.</p>
              </div>
            )
          ) : activeView === 'croqui' ? (
            croquiHistory.length > 0 ? (
              croquiHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${croquiJobId === entry.jobId ? 'bg-amber-500/10 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.06)]' : 'bg-[#141008]/60 hover:bg-[#1b160c] hover:border-amber-500/20'}`}
                  onClick={() => selectCroquiHistoryEntry(entry)}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${croquiJobId === entry.jobId ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-900/40' : 'bg-white/5 text-slate-400 group-hover:text-amber-300 group-hover:bg-amber-500/10'}`}>
                    <MapIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block">
                    <p className={`text-sm truncate font-medium ${croquiJobId === entry.jobId ? 'text-amber-100' : 'text-slate-200 group-hover:text-amber-100'}`}>{entry.title || entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-300">
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
                      {entry.municipioNome || 'Croqui'} • {entry.routeLabel || 'PDF + DOCX + KML'}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteCroquiJob(entry.jobId);
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                    title="Excluir croqui"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <MapIcon size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhum croqui gerado.</p>
              </div>
            )
          ) : activeView === 'vertices-proximas' ? (
            errorAnalysisTab === 'containment' ? (
              containmentHistory.length > 0 ? (
                containmentHistory.map((entry) => (
                  <div
                    key={entry.jobId}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${containmentJobId === entry.jobId ? 'bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.06)]' : 'bg-[#100d18]/70 hover:bg-[#171322] hover:border-rose-500/20'}`}
                    onClick={() => {
                      setContainmentJobId(entry.jobId);
                      setErrorAnalysisTab('containment');
                    }}
                  >
                    <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${containmentJobId === entry.jobId ? 'bg-gradient-to-br from-rose-500 to-emerald-500 text-white shadow-md shadow-rose-900/40' : 'bg-white/5 text-slate-400 group-hover:text-rose-300 group-hover:bg-rose-500/10'}`}>
                      <ShieldAlert size={18} />
                    </div>
                    <div className="flex-1 min-w-0 block">
                      <p className={`text-sm truncate font-medium ${containmentJobId === entry.jobId ? 'text-rose-100' : 'text-slate-200 group-hover:text-rose-100'}`}>{entry.filename}</p>
                      <div className="flex items-center gap-2 mt-1 opacity-80">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-rose-300">
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
                        {(entry.resultRows?.length || 0)} áreas • {entry.containerCount ?? '?'} continentes
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (containmentJobsRef) void deleteDoc(doc(containmentJobsRef, entry.jobId)).catch(() => {});
                        setContainmentHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
                        if (containmentJobId === entry.jobId) setContainmentJobId(null);
                      }}
                      className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                      title="Excluir análise"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ShieldAlert size={32} className="text-slate-600 mb-3" />
                  <p className="text-sm text-slate-400">Nenhuma análise de áreas não contidas</p>
                  <p className="text-[10px] text-slate-600 mt-1">Use a aba para fazer upload</p>
                </div>
              )
            ) : errorAnalysisTab === 'geometry' ? (
              geometryHistory.length > 0 ? (
                geometryHistory.map((entry) => (
                  <div
                    key={entry.jobId}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${geometryJobId === entry.jobId ? 'bg-amber-500/10 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.06)]' : 'bg-[#100d18]/70 hover:bg-[#171322] hover:border-amber-500/20'}`}
                    onClick={() => {
                      setGeometryJobId(entry.jobId);
                      setErrorAnalysisTab('geometry');
                    }}
                  >
                    <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${geometryJobId === entry.jobId ? 'bg-gradient-to-br from-amber-500 to-emerald-500 text-white shadow-md shadow-amber-900/40' : 'bg-white/5 text-slate-400 group-hover:text-amber-300 group-hover:bg-amber-500/10'}`}>
                      <AlertTriangle size={18} />
                    </div>
                    <div className="flex-1 min-w-0 block">
                      <p className={`text-sm truncate font-medium ${geometryJobId === entry.jobId ? 'text-amber-100' : 'text-slate-200 group-hover:text-amber-100'}`}>{entry.filename}</p>
                      <div className="flex items-center gap-2 mt-1 opacity-80">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-300">
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
                        {entry.summary?.totalErrors ?? (entry.resultRows?.length || 0)} erros • {entry.summary?.analyzedLayers?.length ?? '?'} camadas
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (geometryJobsRef) void deleteDoc(doc(geometryJobsRef, entry.jobId)).catch(() => {});
                        setGeometryHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
                        if (geometryJobId === entry.jobId) setGeometryJobId(null);
                      }}
                      className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                      title="Excluir análise"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <AlertTriangle size={32} className="text-slate-600 mb-3" />
                  <p className="text-sm text-slate-400">Nenhuma análise de erros de geometria</p>
                  <p className="text-[10px] text-slate-600 mt-1">Use a aba para fazer upload</p>
                </div>
              )
            ) : (
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
                  <div className="flex-1 min-w-0 block">
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
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
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
          )) : activeView === 'simcar-clip' ? (
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
                  <div className="flex-1 min-w-0 block">
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
                        navigateView('simcar-clip');
                      }
                    }}
                    className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition block"
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
          ) : activeView === 'simcar-receipts' ? (
            receiptHistory.length > 0 ? (
              receiptHistory.map((receipt) => (
                <div
                  key={receipt.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group cursor-pointer mb-1"
                >
                  <div className={`p-2 rounded-lg shrink-0 ${receipt.type === 'apf' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    <Receipt size={16} />
                  </div>
                  <div className="flex-1 min-w-0 block">
                    <p className="text-sm text-slate-200 truncate">{receipt.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${receipt.type === 'apf' ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {receipt.type === 'apf' ? 'APF' : 'SIMCAR'}
                      </span>
                      {receipt.cpf && <span className="text-[10px] text-slate-500">CPF: {receipt.cpf}</span>}
                      {receipt.car && <span className="text-[10px] text-slate-500">CAR: {receipt.car}</span>}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {receipt.status === 'completed' ? 'Baixado' : 'Falhou'}
                      {receipt.sizeBytes ? ` • ${(receipt.sizeBytes / 1024).toFixed(0)} KB` : ''}
                    </p>
                  </div>
                  {receipt.downloadUrl && (
                    <a
                      href={receipt.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-500/20 transition-colors opacity-0 group-hover:opacity-100"
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (receiptsRef) void deleteDoc(doc(receiptsRef, receipt.receiptId)).catch(() => {});
                      setReceiptHistory((prev) => prev.filter((item) => item.receiptId !== receipt.receiptId));
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
                    title="Excluir"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Receipt size={32} className="text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Nenhum recibo baixado</p>
                <p className="text-[10px] text-slate-600 mt-1">Os recibos aparecem aqui</p>
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
            onClick={() => navigateView('features')}
            className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group mb-2 ${activeView === 'features' ? 'bg-white/10' : ''}`}
          >
            <BookOpen size={18} className={`transition-colors ${activeView === 'features' ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors block">
              Funcionalidades
            </span>
          </button>
          <button
            onClick={() => navigateView('settings')}
            className={`w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group mb-2 ${activeView === 'settings' ? 'bg-white/10' : ''}`}
          >
            <Settings size={18} className={`transition-colors ${activeView === 'settings' ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}`} />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors block">
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
            <div className="flex-1 text-left overflow-hidden block">
              <p className="text-sm font-medium text-white truncate">{userProfile?.fullName || 'Usuário'}</p>
              <p className="text-xs text-emerald-400/70">{userProfile?.email || 'Plano Pro'}</p>
            </div>
            {loggingOut ? (
              <Loader2 size={18} className="text-slate-400 animate-spin block" />
            ) : (
              <LogOut size={18} className="text-slate-500 group-hover:text-red-400 transition-colors block" />
            )}
          </button>
        </div>
        </aside>
      )}

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
                {DASHBOARD_VIEW_LABELS[activeView]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2"></div>
        </header>

        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col min-h-0 min-w-0"
            >
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
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Carregando recibos...</div>}>
          <ReceiptsHub
            apiFetch={apiFetch}
            onReceiptDownloaded={(receipt) => {
              const id = nanoid();
              const item: ReceiptHistoryItem = {
                id,
                receiptId: id,
                type: receipt.type,
                filename: receipt.filename,
                timestamp: new Date().toISOString(),
                status: 'completed',
                cpf: receipt.cpf,
                car: receipt.car,
                sizeBytes: receipt.sizeBytes,
              };
              setReceiptHistory((prev) => [item, ...prev]);
              if (receiptsRef) {
                void setDoc(doc(receiptsRef, id), {
                  ...item,
                  updatedAtMs: Date.now(),
                }, { merge: true }).catch(() => {});
              }
            }}
          />
          </Suspense>
        ) : activeView === 'cbers-wpm' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando CBERS...</div>
              </div>
            </div>
          }>
            <CbersPanel cbers={cbers} />
          </Suspense>
        ) : activeView === 'landsat' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando Landsat...</div>
              </div>
            </div>
          }>
            <LandsatPanel landsat={landsat} />
          </Suspense>
        ) : activeView === 'sobreposicoes' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando Sobreposições...</div>
              </div>
            </div>
          }>
            <SobreposicoesPanel overlap={overlap} />
          </Suspense>
        ) : activeView === 'croqui' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-6xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando Croqui...</div>
              </div>
            </div>
          }>
            <CroquiPanel croqui={croqui} />
          </Suspense>
        ) : activeView === 'vertices-proximas' ? (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
              {/* ─── Sub-abas: Análise de Erros ─── */}
              <div className="relative p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setErrorAnalysisTab('vertices')}
                    className={`relative z-10 flex items-center justify-center gap-2 py-2.5 px-2 sm:px-3 rounded-xl transition-all duration-300 text-[11px] sm:text-xs font-semibold ${
                      errorAnalysisTab === 'vertices'
                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <Network size={15} />
                    <span className="truncate">Vértices Próximas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setErrorAnalysisTab('containment')}
                    className={`relative z-10 flex items-center justify-center gap-2 py-2.5 px-2 sm:px-3 rounded-xl transition-all duration-300 text-[11px] sm:text-xs font-semibold ${
                      errorAnalysisTab === 'containment'
                        ? 'bg-gradient-to-r from-rose-600 to-emerald-600 text-white shadow-lg shadow-rose-900/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <ShieldAlert size={15} />
                    <span className="truncate">Áreas Não Contidas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setErrorAnalysisTab('geometry')}
                    className={`relative z-10 flex items-center justify-center gap-2 py-2.5 px-2 sm:px-3 rounded-xl transition-all duration-300 text-[11px] sm:text-xs font-semibold ${
                      errorAnalysisTab === 'geometry'
                        ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-900/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                  >
                    <AlertTriangle size={15} />
                    <span className="truncate">Erros de Geometria</span>
                  </button>
                </div>
              </div>

              {errorAnalysisTab === 'geometry' ? (
                <Suspense fallback={<div className="rounded-xl border border-white/10 bg-black/20 p-6 text-sm text-slate-400">Carregando análise de geometria...</div>}>
                <GeometryErrorsAnalysis
                  apiFetch={apiFetch}
                  onHighlightLocation={(loc, lbl) => {
                    setSelectedErrorLocation(loc);
                    setSelectedErrorLabel(lbl);
                  }}
                  onJobSnapshot={(job) => {
                    const item = mapGeometryDocToHistoryItem(String(job?.jobId || job?.id || ''), job);
                    setGeometryHistory((prev) => {
                      const idx = prev.findIndex((e) => e.jobId === item.jobId);
                      if (idx >= 0) {
                        const copy = [...prev];
                        copy[idx] = item;
                        return copy;
                      }
                      return [item, ...prev];
                    });
                    if (item.status !== 'processing' && item.status !== 'queued') {
                      setGeometryJobId(null);
                    } else {
                      setGeometryJobId(item.jobId);
                    }
                    if (geometryJobsRef) {
                      void setDoc(doc(geometryJobsRef, item.jobId), {
                        ...job,
                        updatedAtMs: Date.now(),
                      }, { merge: true }).catch(() => {});
                    }
                  }}
                />
                </Suspense>
              ) : errorAnalysisTab === 'containment' ? (
                <Suspense fallback={<div className="rounded-xl border border-white/10 bg-black/20 p-6 text-sm text-slate-400">Carregando análise de contenção...</div>}>
                <ContainmentAnalysis
                  apiFetch={apiFetch}
                  onHighlightLocation={(loc, lbl) => {
                    setSelectedErrorLocation(loc);
                    setSelectedErrorLabel(lbl);
                  }}
                  onJobSnapshot={(job) => {
                    const item = mapContainmentDocToHistoryItem(String(job?.jobId || job?.id || ''), job);
                    setContainmentHistory((prev) => {
                      const idx = prev.findIndex((e) => e.jobId === item.jobId);
                      if (idx >= 0) {
                        const copy = [...prev];
                        copy[idx] = item;
                        return copy;
                      }
                      return [item, ...prev];
                    });
                    if (item.status !== 'processing' && item.status !== 'queued') {
                      setContainmentJobId(null);
                    } else {
                      setContainmentJobId(item.jobId);
                    }
                    if (containmentJobsRef) {
                      void setDoc(doc(containmentJobsRef, item.jobId), {
                        ...job,
                        updatedAtMs: Date.now(),
                      }, { merge: true }).catch(() => {});
                    }
                  }}
                />
                </Suspense>
              ) : (
              <>
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
                            <tr 
                              key={`${row.camada}-${row.ranking}-${index}`}
                              onClick={() => {
                                setSelectedErrorLocation({ lat: Number(row.y_medio), lng: Number(row.x_medio) });
                                setSelectedErrorLabel(`Vértice Próxima: ${row.camada} (Ranking ${row.ranking})`);
                              }}
                              className="cursor-pointer hover:bg-violet-500/10 transition-colors"
                            >
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
              </>
              )}

              {selectedErrorLocation && (
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl animate-fade-in-up">
                  <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <MapPinned size={16} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-white">{selectedErrorLabel || 'Localização do Erro'}</span>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => {
                        setSelectedErrorLocation(null);
                        setSelectedErrorLabel(null);
                      }}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <MapView
                    className="h-[300px] w-full"
                    initialCenter={selectedErrorLocation}
                    initialZoom={18}
                    mapTypeId="hybrid"
                    onMapReady={(map) => {
                      new window.google.maps.marker.AdvancedMarkerElement({
                        map,
                        position: selectedErrorLocation,
                        title: selectedErrorLabel || "Erro",
                      });
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : activeView === 'auas-sccon' ? (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Carregando AUAS × SCCON...</div>}>
            <AuasSccon />
          </Suspense>
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
              onGoChat={() => navigateView('simcar-clip')}
              onGoSimcar={() => navigateView('simcar-clip')}
              onGoCbers={() => navigateView('cbers-wpm')}
            />
          </Suspense>
        ) : activeView === 'settings' ? (
          <Suspense fallback={
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
              <div className="max-w-4xl mx-auto">
                <div className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-6 text-sm text-slate-300">Carregando configurações...</div>
              </div>
            </div>
          }>
            <SettingsPanel
              userProfile={userProfile}
              onEditProfileName={onEditProfileName}
              onOpenBillingTopup={() => setBillingTopupOpen(true)}
              billingLoading={billingLoading}
              billingMe={billingMe}
              billingPricing={billingPricing}
              billingLedger={billingLedger}
              formatBrl={formatBrl}
              onResetPassword={onResetPassword}
              resettingPassword={resettingPassword}
              settings={settings}
              updateSettings={updateSettings}
            />
          </Suspense>
        ) : null}


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
            </motion.div>
          </AnimatePresence>
        </div>

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
