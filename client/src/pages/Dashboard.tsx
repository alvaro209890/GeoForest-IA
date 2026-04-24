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
import TermsOfUseDialog from '@/components/TermsOfUseDialog';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';

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
};

type SimcarAuasMeta = {
  yearVerdicts?: Array<{
    satelliteLabel: string;
    year: number;
    verdict: 'CONSOLIDADO' | 'VEGETACAO_NATIVA_PRESENTE' | 'DESMATAMENTO_RECENTE' | 'INCONCLUSIVO';
  }>;
  firstDeforestationYear?: number | null;
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

type AuasTabResult = {
  acAreaHa: number;
  auasAreaHa: number;
  avnAreaHa: number;
  arlAreaHa: number;
  propertyAreaHa: number;
  riverBufferHa: number;
  auasPolygons: Array<{ year: number; areaHa: number }>;
  downloadUrl?: string;
  inputZipUrl?: string;
  outputZipUrl?: string;
  contextUrl?: string;
  analysis?: string;
  images?: Array<{ url: string; caption: string }>;
  satellitesUsed?: string[];
  satellitesMissing?: string[];
  cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
  analysisMeta?: SimcarAcAvnAnalysisMeta;
  analysisRulesVersion?: string;
  auasOpeningYear?: number;
  auasOpeningDate?: string;
  auasOpeningSource?: 'PRODES' | 'AI_FALLBACK';
  status?: 'processing' | 'completed' | 'failed' | 'cancelled';
  error?: string;
};

type AuasHistoryItem = AuasTabResult & {
  id: string;
  timestamp: string;
  filename: string;
  jobId: string;
  inputFilename?: string;
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
const AUAS_FIRESTORE_WRITE_RETRIES = 3;
const AUAS_FIRESTORE_RETRY_BASE_MS = 450;

const CONFIGURED_API_BASE = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
const apiUrl = (path: string) => {
  if (!path) return CONFIGURED_API_BASE || '';
  if (!CONFIGURED_API_BASE) return path;
  return `${CONFIGURED_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
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
  const persistent = String(persistentUrl || '').trim();
  if (persistent) return persistent;
  const raw = String(downloadUrl || '').trim();
  if (!raw) return '';
  return raw.startsWith('/api/') ? apiUrl(raw) : raw;
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
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={`analysis-gap-${i}`} className="analysis-gap" />;
    }

    const divider = trimmed.match(/^[-_*]{3,}$/);
    if (divider) {
      return <div key={`analysis-divider-${i}`} className="analysis-divider" />;
    }

    const title = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (title) {
      const level = title[1].length;
      const klass = level === 1 ? 'analysis-h1' : level === 2 ? 'analysis-h2' : 'analysis-h3';
      return (
        <div key={`analysis-title-${i}`} className={klass}>
          {renderInlineRichText(title[2])}
        </div>
      );
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      return (
        <div key={`analysis-ol-${i}`} className="analysis-item">
          <span className="analysis-marker">{numbered[1]}.</span>
          <span className="analysis-content">{renderInlineRichText(numbered[2])}</span>
        </div>
      );
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      return (
        <div key={`analysis-ul-${i}`} className="analysis-item">
          <span className="analysis-marker">•</span>
          <span className="analysis-content">{renderInlineRichText(bullet[1])}</span>
        </div>
      );
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      return (
        <div key={`analysis-quote-${i}`} className="analysis-quote">
          {renderInlineRichText(quote[1])}
        </div>
      );
    }

    return (
      <p key={`analysis-p-${i}`} className="analysis-p">
        {renderInlineRichText(line)}
      </p>
    );
  });
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


export default function Dashboard() {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'simcar-clip' | 'features' | 'auas'>('chat');
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
  const [simcarClipProcessing, setSimcarClipProcessing] = useState(false);
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
  const simcarClipProgressFlushTimerRef = useRef<number | null>(null);
  const simcarClipProgressPendingRef = useRef<{ current: number; total: number; layer: string; status: string } | null>(
    null
  );
  const [simcarAirId, setSimcarAirId] = useState('');
  const [simcarClipJobId, setSimcarClipJobId] = useState<string | null>(null);

  // ─── SIMCAR AI Analysis State ───
  const [simcarAnalysisProcessing, setSimcarAnalysisProcessing] = useState(false);
  const [simcarAnalysisProgress, setSimcarAnalysisProgress] = useState<{ step: string; percent: number; message: string } | null>(null);
  const [simcarAgentLog, setSimcarAgentLog] = useState<Array<{ label: string; done: boolean; kind: 'step' | 'thinking' }>>([]);
  const [simcarAnalysisImages, setSimcarAnalysisImages] = useState<Array<{ url: string; caption: string }>>([]);
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
  const [simcarAuasImages, setSimcarAuasImages] = useState<Array<{ url: string; caption: string }>>([]);
  const [simcarAuasMessages, setSimcarAuasMessages] = useState<SimcarAnalysisMessage[]>([]);
  const [simcarAuasAgentLog, setSimcarAuasAgentLog] = useState<Array<{ label: string; done: boolean; kind: 'step' | 'thinking' }>>([]);
  const simcarAuasAbortRef = useRef<AbortController | null>(null);
  const simcarAuasProcessJobIdRef = useRef<string | null>(null);
  const [simcarResultImagePanelsOpen, setSimcarResultImagePanelsOpen] = useState<{ acAvn: boolean; auas: boolean }>({
    acAvn: false,
    auas: false,
  });

  // ─── AUAS Tab State ───
  const [auasFile, setAuasFile] = useState<File | null>(null);
  const [auasProcessing, setAuasProcessing] = useState(false);
  const [auasJobId, setAuasJobId] = useState<string | null>(null);
  const [auasProgress, setAuasProgress] = useState<{ step: string; percent: number; message: string } | null>(null);
  const [auasResult, setAuasResult] = useState<AuasTabResult | null>(null);
  const [auasHistory, setAuasHistory] = useState<AuasHistoryItem[]>([]);
  const [auasAgentLog, setAuasAgentLog] = useState<Array<{ label: string; done: boolean; kind: 'step' | 'thinking' }>>([]);
  const auasAgentLogEndRef = useRef<HTMLDivElement | null>(null);
  const [auasElapsed, setAuasElapsed] = useState(0);
  const [auasError, setAuasError] = useState<string | null>(null);
  const auasAbortRef = useRef<AbortController | null>(null);
  const auasProcessJobIdRef = useRef<string | null>(null);
  const auasFileInputRef = useRef<HTMLInputElement | null>(null);

  const resetAuasDraft = useCallback(() => {
    auasAbortRef.current?.abort();
    auasAbortRef.current = null;
    auasProcessJobIdRef.current = null;
    setAuasFile(null);
    setAuasProcessing(false);
    setAuasJobId(null);
    setAuasProgress(null);
    setAuasResult(null);
    setAuasAgentLog([]);
    setAuasElapsed(0);
    setAuasError(null);
    if (auasFileInputRef.current) auasFileInputRef.current.value = '';
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

  useEffect(() => {
    if (auasProcessing) {
      setAuasElapsed(0);
      const iv = setInterval(() => setAuasElapsed((prev) => prev + 1), 1000);
      return () => clearInterval(iv);
    }
  }, [auasProcessing]);

  useEffect(() => {
    auasAgentLogEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [auasAgentLog]);

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

  const auasGroupedPhases = useMemo((): AgentPhase[] => {
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
    const map = new Map<AgentPhase['icon'], typeof auasAgentLog>();
    for (const step of auasAgentLog) {
      if (step.kind !== 'step') continue;
      const key = classify(step.label);
      const arr = map.get(key) || [];
      arr.push(step);
      map.set(key, arr);
    }
    return phaseOrder
      .map((icon) => {
        const steps = map.get(icon) || [];
        if (!steps.length) return null;
        const id = `auas-${icon}`;
        const allDone = steps.every((s) => s.done);
        return { id, label: phaseLabels[icon], icon, steps, allDone };
      })
      .filter((p): p is AgentPhase => !!p);
  }, [auasAgentLog]);

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
  const [auasJobsRef, setAuasJobsRef] = useState<ReturnType<typeof collection> | null>(null);
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
    simcarAnalysisProcessJobIdRef.current = null;
    simcarAuasProcessJobIdRef.current = null;
    simcarVectorizedResumeInFlightRef.current = null;
    setSimcarServerRuntimeState(null);
    setSimcarClipMode(nextMode);
    setSimcarClipFile(null);
    setSimcarClipProcessing(false);
    setSimcarClipProgress(null);
    setSimcarClipDownloadUrl(null);
    setSimcarClipSummary(null);
    setSimcarClipError(null);
    setSimcarClipJobId(null);
    setSimcarAirId('');
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
      return { error: text };
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
      flow: 'simcar' | 'auas';
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

            const isAuasEndpoint = endpoint === '/api/auas/analyze';
            if (!isAuasEndpoint) return;
            if (sameDoc) idsToCancel.add(String(docSnap.id));
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

  const normalizeAuasResultPayload = useCallback((raw: any): AuasTabResult => {
    const toNumber = (value: any) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const outputZipUrl = String(raw?.outputZipUrl || '').trim() || undefined;
    const inputZipUrl = String(raw?.inputZipUrl || '').trim() || undefined;
    const contextUrl = String(raw?.contextUrl || '').trim() || undefined;
    const rawDownloadUrl = String(raw?.downloadUrl || '').trim();
    const resolvedDownloadUrl = outputZipUrl
      || (rawDownloadUrl
        ? (rawDownloadUrl.startsWith('/api/') ? apiUrl(rawDownloadUrl) : rawDownloadUrl)
        : undefined);
    const images = Array.isArray(raw?.images)
      ? raw.images
        .map((img: any) => ({
          url: String(img?.url || '').trim(),
          caption: String(img?.caption || '').trim(),
        }))
        .filter((img: { url: string }) => Boolean(img.url))
      : [];
    const auasPolygons = Array.isArray(raw?.auasPolygons)
      ? raw.auasPolygons
        .map((item: any) => ({
          year: Math.round(toNumber(item?.year)),
          areaHa: toNumber(item?.areaHa),
        }))
        .filter((item: { year: number; areaHa: number }) => item.year > 0 && item.areaHa >= 0)
      : [];
    const openingYear = (() => {
      const parsed = Number(raw?.auasOpeningYear);
      return Number.isFinite(parsed) && parsed > 1900 ? Math.floor(parsed) : undefined;
    })();
    const openingSourceRaw = String(raw?.auasOpeningSource || '').trim().toUpperCase();
    const openingSource =
      openingSourceRaw === 'PRODES'
        ? 'PRODES'
        : openingSourceRaw === 'AI_FALLBACK'
          ? 'AI_FALLBACK'
          : undefined;
    const openingDate = String(raw?.auasOpeningDate || '').trim() || undefined;
    const statusRaw = String(raw?.status || '').trim().toLowerCase();
    const status =
      statusRaw === 'processing' || statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'cancelled'
        ? (statusRaw as AuasTabResult['status'])
        : undefined;
    const error = raw?.error ? String(raw.error) : undefined;
    return {
      propertyAreaHa: toNumber(raw?.propertyAreaHa),
      acAreaHa: toNumber(raw?.acAreaHa),
      auasAreaHa: toNumber(raw?.auasAreaHa),
      avnAreaHa: toNumber(raw?.avnAreaHa),
      arlAreaHa: toNumber(raw?.arlAreaHa),
      riverBufferHa: toNumber(raw?.riverBufferHa),
      auasPolygons,
      downloadUrl: resolvedDownloadUrl,
      inputZipUrl,
      outputZipUrl,
      contextUrl,
      analysis: raw?.analysis ? String(raw.analysis) : undefined,
      images,
      satellitesUsed: Array.isArray(raw?.satellitesUsed) ? raw.satellitesUsed.map((v: any) => String(v)) : undefined,
      satellitesMissing: Array.isArray(raw?.satellitesMissing) ? raw.satellitesMissing.map((v: any) => String(v)) : undefined,
      cloudWarnings: Array.isArray(raw?.cloudWarnings)
        ? raw.cloudWarnings
          .map((item: any) => ({
            satellite: String(item?.satellite || ''),
            cloudScore: toNumber(item?.cloudScore),
          }))
          .filter((item: { satellite: string }) => Boolean(item.satellite))
        : undefined,
      analysisMeta: isPlainObject(raw?.analysisMeta) ? (raw.analysisMeta as SimcarAcAvnAnalysisMeta) : undefined,
      analysisRulesVersion: raw?.analysisRulesVersion ? String(raw.analysisRulesVersion) : undefined,
      auasOpeningYear: openingYear,
      auasOpeningDate: openingDate,
      auasOpeningSource: openingSource,
      status,
      error,
    };
  }, []);

  const mapAuasDocToHistoryItem = useCallback(
    (docId: string, data: any): AuasHistoryItem => {
      const normalizedResult = normalizeAuasResultPayload({
        propertyAreaHa: data?.propertyAreaHa,
        acAreaHa: data?.acAreaHa,
        auasAreaHa: data?.auasAreaHa,
        avnAreaHa: data?.avnAreaHa,
        arlAreaHa: data?.arlAreaHa,
        riverBufferHa: data?.riverBufferHa,
        auasPolygons: data?.auasPolygons,
        downloadUrl: data?.downloadUrl,
        inputZipUrl: data?.inputZipUrl ?? data?.files?.inputZipUrl,
        outputZipUrl: data?.outputZipUrl ?? data?.files?.outputZipUrl,
        contextUrl: data?.contextUrl ?? data?.files?.contextUrl,
        analysis: data?.analysis,
        images: data?.images,
        satellitesUsed: data?.satellitesUsed,
        satellitesMissing: data?.satellitesMissing,
        cloudWarnings: data?.cloudWarnings,
        analysisMeta: data?.analysisMeta,
        analysisRulesVersion: data?.analysisRulesVersion,
        auasOpeningYear: data?.auasOpeningYear,
        auasOpeningDate: data?.auasOpeningDate,
        auasOpeningSource: data?.auasOpeningSource,
        status: data?.status,
        error: data?.error,
      });
      return {
        id: String(data?.id || docId),
        jobId: String(data?.jobId || docId),
        timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
        filename: String(data?.filename || 'Novo CAR'),
        inputFilename: data?.inputFilename ? String(data.inputFilename) : undefined,
        conversationId: data?.conversationId ? String(data.conversationId) : undefined,
        ...normalizedResult,
      };
    },
    [normalizeAuasResultPayload]
  );

  const resumeAuasProcessingUi = useCallback((entry: AuasHistoryItem) => {
    setAuasJobId(entry.jobId);
    setAuasError(entry.error || null);
    setAuasProcessing(true);
    setAuasResult(null);
    setAuasProgress((prev) => {
      const prevPercent = Math.max(5, Math.round(Number(prev?.percent || 12)));
      return {
        step: 'processing',
        percent: Math.min(95, prevPercent),
        message: 'Processamento em andamento no servidor. Você pode sair do site e voltar depois.',
      };
    });
    setAuasAgentLog((prev) => {
      if (prev.length > 0) return prev;
      return [{ label: 'Processamento retomado a partir do servidor...', done: false, kind: 'step' }];
    });
  }, []);

  const selectAuasHistoryEntry = useCallback(
    (entry: AuasHistoryItem) => {
      setAuasJobId(entry.jobId);
      setAuasError(entry.error || null);

      if (entry.status === 'processing') {
        resumeAuasProcessingUi(entry);
        return;
      }

      setAuasProcessing(false);
      setAuasProgress(null);
      setAuasAgentLog([]);

      if (entry.status === 'failed' || entry.status === 'cancelled') {
        setAuasResult(null);
        if (!entry.error) {
          setAuasError(entry.status === 'cancelled' ? 'Processamento cancelado.' : 'Processamento falhou.');
        }
        return;
      }

      setAuasResult(normalizeAuasResultPayload(entry));
    },
    [normalizeAuasResultPayload, resumeAuasProcessingUi]
  );

  const persistAuasHistoryEntry = useCallback(
    async (entry: AuasHistoryItem) => {
      if (!auasJobsRef || !entry?.jobId) return;
      const auasDocRef = doc(auasJobsRef, entry.jobId);
      const cleanEntry = stripUndefinedDeep(entry);
      const payload = stripUndefinedDeep({
        ...cleanEntry,
        kind: 'novo_car',
        title: cleanEntry.filename,
        files: {
          inputZipUrl: cleanEntry.inputZipUrl,
          outputZipUrl: cleanEntry.outputZipUrl,
          contextUrl: cleanEntry.contextUrl,
        },
        analysisImageCount: cleanEntry.images?.length ?? 0,
        cloudinaryPersisted:
          Boolean(cleanEntry.inputZipUrl) &&
          Boolean(cleanEntry.outputZipUrl) &&
          Boolean(cleanEntry.contextUrl),
      });
      let lastError: any = null;
      for (let attempt = 1; attempt <= AUAS_FIRESTORE_WRITE_RETRIES; attempt += 1) {
        try {
          await setDoc(
            auasDocRef,
            {
              ...payload,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
          return;
        } catch (error: any) {
          lastError = error;
          if (attempt >= AUAS_FIRESTORE_WRITE_RETRIES) break;
          const waitMs = AUAS_FIRESTORE_RETRY_BASE_MS * attempt;
          await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        }
      }
      throw lastError || new Error('Falha ao persistir historico Novo CAR no Firestore.');
    },
    [auasJobsRef]
  );

  const markAuasHistoryStatus = useCallback(
    (jobId: string, status: NonNullable<AuasHistoryItem['status']>, error?: string) => {
      const safeJobId = String(jobId || '').trim();
      if (!safeJobId) return;
      let patchedEntry: AuasHistoryItem | null = null;
      setAuasHistory((prev) =>
        prev.map((item) => {
          if (item.jobId !== safeJobId) return item;
          patchedEntry = {
            ...item,
            status,
            error: error ? String(error) : undefined,
          };
          return patchedEntry;
        })
      );
      if (patchedEntry) {
        void persistAuasHistoryEntry(patchedEntry).catch((persistErr) => {
          console.warn('Falha ao atualizar status do card Novo CAR:', persistErr);
        });
      }
    },
    [persistAuasHistoryEntry]
  );

  const appendAuasEntriesToConversation = useCallback(
    async (
      job: AuasHistoryItem,
      entries: SimcarConversationEntry[],
      options?: { title?: string },
    ) => {
      if (!conversationsRef || !job?.jobId) return null;

      const validEntries = entries
        .map((entry) => ({
          ...entry,
          text: String(entry?.text || '').trim(),
        }))
        .filter((entry) => entry.text.length > 0);
      if (validEntries.length === 0) return job.conversationId || null;

      const conversationId = job.conversationId || nanoid();
      const convDocRef = doc(conversationsRef.collection, conversationId);
      const snap = await getDoc(convDocRef);
      const existingMessages = snap.exists()
        ? ((snap.data() as any)?.messages as ChatMessage[] | undefined)
        : undefined;
      const baseMessages = Array.isArray(existingMessages) && existingMessages.length > 0
        ? existingMessages
        : [DEFAULT_ASSISTANT_MESSAGE];
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const additions: ChatMessage[] = validEntries.map((entry) => {
        const cleanedMeta = entry.meta
          ? Object.fromEntries(Object.entries(entry.meta).filter(([, value]) => value !== undefined))
          : undefined;
        return {
          id: nanoid(),
          role: entry.role,
          text: entry.text,
          time: now,
          ...(cleanedMeta && Object.keys(cleanedMeta).length > 0 ? { meta: cleanedMeta as ChatMessage['meta'] } : {}),
        };
      });

      const mergedMessages = [...baseMessages, ...additions];
      const existingTitle = snap.exists() ? String((snap.data() as any)?.title || '').trim() : '';
      const fallbackTitle = options?.title?.trim() || job.filename || `Novo CAR ${job.jobId.slice(0, 8)}`;
      const nextTitle = existingTitle || fallbackTitle;
      const lastPreview = additions[additions.length - 1]?.text?.slice(0, 120) || '';

      const conversationPayload: Record<string, any> = {
        title: nextTitle,
        kind: 'novo_car',
        auasJobId: job.jobId,
        messages: sanitizeMessagesForFirestore(mergedMessages),
        updatedAt: serverTimestamp(),
        lastMessagePreview: lastPreview,
        lastAttachmentType: null,
      };
      if (!snap.exists()) {
        conversationPayload.createdAt = serverTimestamp();
      }
      await setDoc(convDocRef, conversationPayload, { merge: true });

      setConversations((prev) => {
        const next: Conversation = {
          id: conversationId,
          title: nextTitle,
          lastMessagePreview: lastPreview,
          auasJobId: job.jobId,
          kind: 'novo_car',
        };
        return [next, ...prev.filter((item) => item.id !== conversationId)];
      });

      if (!job.conversationId && auasJobsRef) {
        await setDoc(
          doc(auasJobsRef, job.jobId),
          { conversationId, updatedAt: serverTimestamp() },
          { merge: true }
        );
        setAuasHistory((prev) =>
          prev.map((item) => (item.jobId === job.jobId ? { ...item, conversationId } : item))
        );
      }

      return conversationId;
    },
    [auasJobsRef, conversationsRef]
  );

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

      setSimcarClipDownloadUrl(clip.outputZipUrl || clip.downloadUrl);
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
          setSimcarClipProcessing(serverRunning || !runtimeStatus);
          setSimcarVectorizedRunning(false);
          setSimcarVectorizedStatus(null);
          setSimcarAnalysisProcessing(false);
          setSimcarAuasProcessing(false);
          setSimcarAnalysisProgress(null);
          setSimcarAuasProgress(null);
          setSimcarClipProgress((prev) =>
            prev || {
              current: 1,
              total: Math.max(1, Number(clip.totalLayers || 1)),
              layer: 'Processando',
              status: 'fetching',
            }
          );
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
      clip: SimcarClipHistoryItem,
      entries: SimcarConversationEntry[],
      options?: { title?: string },
    ) => {
      if (!conversationsRef || !clip?.jobId) return null;

      const validEntries = entries
        .map((entry) => ({
          ...entry,
          text: String(entry?.text || '').trim(),
        }))
        .filter((entry) => entry.text.length > 0);

      if (validEntries.length === 0) return clip.conversationId || null;

      const conversationId = clip.conversationId || nanoid();
      const convDocRef = doc(conversationsRef.collection, conversationId);
      const snap = await getDoc(convDocRef);
      const existingMessages = snap.exists()
        ? ((snap.data() as any)?.messages as ChatMessage[] | undefined)
        : undefined;
      const baseMessages = Array.isArray(existingMessages) && existingMessages.length > 0
        ? existingMessages
        : [DEFAULT_ASSISTANT_MESSAGE];
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const additions: ChatMessage[] = validEntries.map((entry) => {
        const cleanedMeta = entry.meta
          ? Object.fromEntries(Object.entries(entry.meta).filter(([, value]) => value !== undefined))
          : undefined;
        return {
          id: nanoid(),
          role: entry.role,
          text: entry.text,
          time: now,
          ...(cleanedMeta && Object.keys(cleanedMeta).length > 0 ? { meta: cleanedMeta as ChatMessage['meta'] } : {}),
        };
      });

      const mergedMessages = [...baseMessages, ...additions];
      const existingTitle = snap.exists() ? String((snap.data() as any)?.title || '').trim() : '';
      const fallbackTitle = options?.title?.trim() || clip.filename || `Recorte SIMCAR ${clip.jobId.slice(0, 8)}`;
      const nextTitle = existingTitle || fallbackTitle;
      const lastPreview = additions[additions.length - 1]?.text?.slice(0, 120) || '';

      const conversationPayload: Record<string, any> = {
        title: nextTitle,
        kind: 'simcar_recorte',
        simcarJobId: clip.jobId,
        messages: sanitizeMessagesForFirestore(mergedMessages),
        updatedAt: serverTimestamp(),
        lastMessagePreview: lastPreview,
        lastAttachmentType: null,
      };
      if (!snap.exists()) {
        conversationPayload.createdAt = serverTimestamp();
      }

      await setDoc(convDocRef, conversationPayload, { merge: true });

      setConversations((prev) => {
        const next: Conversation = {
          id: conversationId,
          title: nextTitle,
          lastMessagePreview: lastPreview,
        };
        return [next, ...prev.filter((item) => item.id !== conversationId)];
      });

      if (!clip.conversationId) {
        await patchPersistedSimcarClip(clip.jobId, { conversationId });
        setSimcarClipHistory((prev) =>
          prev.map((item) => (item.jobId === clip.jobId ? { ...item, conversationId } : item)),
        );
      }

      return conversationId;
    },
    [conversationsRef, patchPersistedSimcarClip]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          setSimcarClipsRef(null);
          setAuasJobsRef(null);
          setAuasHistory([]);
          setAuasJobId(null);
          setAuasResult(null);
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
        const auasRef = collection(db, 'users', currentUser.uid, 'auas_jobs');
        setAuasJobsRef(auasRef);

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
          const auasSnap = await getDocs(query(auasRef, orderBy('updatedAt', 'desc')));
          const auasEntries: AuasHistoryItem[] = [];
          auasSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            auasEntries.push(mapAuasDocToHistoryItem(docSnap.id, data));
          });
          setAuasHistory(auasEntries);
          if (auasEntries.length > 0) {
            const latest = auasEntries[0];
            selectAuasHistoryEntry(latest);
          }
        } catch (error) {
          console.warn('Falha ao carregar histórico Novo CAR salvo:', error);
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
  }, [mapAuasDocToHistoryItem, normalizeSimcarClipSummary, selectAuasHistoryEntry, selectSimcarClipEntry, setLocation]);

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
            patch.status = hasFinalVectorizedReport ? 'completed' : activeClip.status || 'processing';
            if (activeClip.sourceMode === 'vectorized-analysis' && hasFinalVectorizedReport) {
              patch.processingStage = 'done';
            }
            patch.error = undefined;
          } else if (normalizedLatestEndpoint === '/api/simcar/clip/analyze') {
            if (activeClip.sourceMode === 'vectorized-analysis' && !hasFinalVectorizedReport) {
              patch.status = 'processing';
              patch.processingStage = 'auas';
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

  const activeAuasEntry = useMemo(
    () => (auasJobId ? auasHistory.find((item) => item.jobId === auasJobId) || null : auasHistory[0] || null),
    [auasHistory, auasJobId]
  );

  useEffect(() => {
    const uid = String(userProfile?.uid || '').trim();
    const activeJobId = String(activeAuasEntry?.jobId || '').trim();
    const activeStatus = activeAuasEntry?.status;
    if (!uid || !activeJobId || activeStatus !== 'processing') return;

    let alive = true;
    const pollAuasJob = async () => {
      try {
        const jobRef = doc(db, 'users', uid, 'auas_jobs', activeJobId);
        const snap = await getDoc(jobRef);
        if (!alive || !snap.exists()) return;
        const nextEntry = mapAuasDocToHistoryItem(snap.id, snap.data() as any);

        setAuasHistory((prev) => {
          let found = false;
          const updated = prev.map((item) => {
            if (item.jobId !== nextEntry.jobId) return item;
            found = true;
            return {
              ...item,
              ...nextEntry,
            };
          });
          return found ? updated : [nextEntry, ...updated];
        });

        if (nextEntry.status === 'processing') {
          setAuasProcessing(true);
          setAuasResult(null);
          setAuasError(nextEntry.error || null);
          if (auasAbortRef.current) return;
          setAuasProgress((prev) => {
            const current = Math.max(5, Math.round(Number(prev?.percent || 10)));
            const bumped = Math.min(95, current + (current < 85 ? 3 : 1));
            return {
              step: 'processing',
              percent: bumped,
              message: 'Processamento em andamento no servidor. Você pode sair do site e voltar depois.',
            };
          });
          setAuasAgentLog((prev) => {
            if (prev.length === 0) {
              return [{ label: 'Processamento em andamento no servidor...', done: false, kind: 'step' }];
            }
            const hasServerStep = prev.some((step) => step.label.toLowerCase().includes('servidor'));
            if (hasServerStep) return prev;
            return [...prev, { label: 'Processamento continua no servidor após recarregar.', done: false, kind: 'step' }];
          });
          return;
        }

        if (nextEntry.status === 'completed') {
          setAuasProcessing(false);
          setAuasProgress(null);
          setAuasError(null);
          setAuasResult(normalizeAuasResultPayload(nextEntry));
          setAuasAgentLog((prev) => {
            const donePrev = prev.map((step) => ({ ...step, done: true }));
            const hasFinal = donePrev.some((step) => step.label.toLowerCase().includes('conclu'));
            if (hasFinal) return donePrev;
            return [...donePrev, { label: 'Processamento concluído e card sincronizado.', done: true, kind: 'step' }];
          });
          return;
        }

        if (nextEntry.status === 'failed' || nextEntry.status === 'cancelled') {
          setAuasProcessing(false);
          setAuasProgress(null);
          setAuasResult(null);
          setAuasError(
            nextEntry.error ||
            (nextEntry.status === 'cancelled' ? 'Processamento cancelado.' : 'Processamento falhou no servidor.')
          );
          setAuasAgentLog((prev) => {
            const donePrev = prev.map((step) => ({ ...step, done: true }));
            const failLabel =
              nextEntry.status === 'cancelled'
                ? 'Processamento cancelado pelo usuário.'
                : 'Processamento falhou no servidor.';
            const exists = donePrev.some((step) => step.label === failLabel);
            if (exists) return donePrev;
            return [...donePrev, { label: failLabel, done: true, kind: 'step' }];
          });
        }
      } catch {
        // best-effort polling
      }
    };

    void pollAuasJob();
    const intervalId = window.setInterval(() => {
      void pollAuasJob();
    }, 8000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [activeAuasEntry?.jobId, activeAuasEntry?.status, mapAuasDocToHistoryItem, normalizeAuasResultPayload, userProfile?.uid]);

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
    if (activeView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeView]);

  useEffect(() => {
    if (activeView !== 'chat') return;
    if (!typingMessageId && !aiThinking) return;
    const container = chatScrollRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceToBottom > 180) return;

    const raf = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(raf);
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
    setActiveView('chat');
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
    setActiveView('chat');
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
                  setSimcarAnalysisProgress(null);
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
                  setSimcarAuasProgress(null);
                  setSimcarAuasAgentLog((prev) => prev.map((s) => ({ ...s, done: true })));
                  const patch: Partial<SimcarClipHistoryItem> = {
                    auasAnalysisImages: images,
                    auasAnalysisMessages: [aiMessage],
                    auasMeta,
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

  const isSimcarConversation = useCallback(
    (conv: Conversation) => {
      if (String(conv.kind || '').toLowerCase() === 'simcar_recorte') return true;
      if (String(conv.simcarJobId || '').trim()) return true;
      if (simcarConversationIds.has(conv.id)) return true;
      const title = String(conv.title || '').toLowerCase();
      const preview = String(conv.lastMessagePreview || '').toLowerCase();
      // Fallback para casos de persistência ainda não reconciliada (troca rápida de abas).
      return (
        title.includes('recorte simcar') ||
        title.includes('analise de auas') ||
        title.includes('análise de auas') ||
        preview.includes('recorte') && preview.includes('simcar')
      );
    },
    [simcarConversationIds]
  );

  const filteredConversations = conversations.filter(
    (c) =>
      !isSimcarConversation(c) &&
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
                    src="/geoforest_app_logo.png"
                    alt="GeoForest IA"
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
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

      <aside
        className={`
          fixed lg:relative z-30 flex flex-col h-full w-[85vw] max-w-80
          bg-[#0a120e]/95 lg:bg-[#0a120e]/80 backdrop-blur-xl border-r border-white/5
          transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-20 xl:w-80 xl:max-w-80'}
        `}
      >
        <div className="p-6 flex items-center gap-3 cursor-pointer" onClick={() => setActiveView('chat')}>
          <div className="relative group">
            <div className="absolute inset-0 bg-emerald-500 blur opacity-40 group-hover:opacity-60 transition-opacity rounded-lg"></div>
            <div className="relative bg-gradient-to-br from-emerald-400 to-green-600 p-1.5 rounded-xl shadow-lg shadow-emerald-900/50">
              <img
                src="/geoforest_app_logo.png"
                alt="GeoForest IA"
                className="h-8 w-8 rounded-lg object-contain"
              />
            </div>
          </div>
          <div className="flex flex-col xl:flex lg:hidden overflow-hidden">
            <span className="font-bold text-base sm:text-lg tracking-tight text-white">GeoForest IA</span>
            <span className="text-[10px] sm:text-xs text-emerald-400/80 font-medium tracking-wide">INTELLIGENCE</span>
          </div>
        </div>

        <div className="px-4 mb-4 space-y-1.5">
          {/* ─── 3 Abas permanentes ─── */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white/5 border border-white/5">
            <button
              onClick={() => setActiveView('chat')}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all text-xs font-medium ${activeView === 'chat' ? 'bg-emerald-600/80 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
            >
              <MessageSquare size={15} />
              <span className="block lg:hidden xl:block leading-none text-[10px] sm:text-xs">Assistente</span>
            </button>
            <button
              onClick={() => {
                setActiveView('simcar-clip');
                if (simcarClipLayers.length === 0) {
                  fetch(apiUrl('/api/simcar/layers'))
                    .then((r) => r.json())
                    .then((data: any) => {
                      if (Array.isArray(data?.layers)) {
                        setSimcarClipLayers(
                          data.layers.map((l: any) => ({ name: l.name, category: l.category, selected: true })),
                        );
                      }
                    })
                    .catch(() => { });
                }
              }}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all text-xs font-medium ${activeView === 'simcar-clip' ? 'bg-purple-600/80 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
            >
              <Scissors size={15} />
              <span className="block lg:hidden xl:block leading-none text-[10px] sm:text-xs">SIMCAR</span>
            </button>
            <button
              onClick={() => setActiveView('auas')}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg transition-all text-xs font-medium ${activeView === 'auas' ? 'bg-amber-600/80 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
            >
              <Layers size={15} />
              <span className="block lg:hidden xl:block leading-none text-[10px] sm:text-xs">Novo CAR</span>
            </button>
          </div>

          {/* ─── Botão de ação contextual ─── */}
          {activeView === 'chat' && (
            <button
              onClick={() => createConversation()}
              className="w-full group relative overflow-hidden rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-all duration-300 p-[1px]"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#0f241a] group-hover:bg-transparent text-emerald-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Novo Chat</span>
              </div>
            </button>
          )}
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
          {activeView === 'auas' && (
            <button
              onClick={() => resetAuasDraft()}
              className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all duration-300 p-[1px] shadow-lg shadow-amber-900/30"
            >
              <div className="relative flex items-center justify-center gap-2 bg-[#1a1100] group-hover:bg-transparent text-amber-100 py-2.5 rounded-[11px] transition-colors">
                <Plus size={16} />
                <span className="font-medium block lg:hidden xl:block text-sm">Novo CAR</span>
              </div>
            </button>
          )}

          {/* ─── Busca (só no chat) ─── */}
          {activeView === 'chat' && (
            <div className="relative">
              <Search size={16} className="text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar conversa..."
                className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 focus:ring-emerald-400/40"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 custom-scrollbar">
          {activeView === 'auas' ? (
            /* ─── Novo CAR History Cards ─── */
            auasHistory.length > 0 ? (
              auasHistory.map((entry) => (
                <div
                  key={entry.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${auasJobId === entry.jobId ? 'bg-amber-500/10 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]' : 'bg-[#0a110e]/60 hover:bg-[#131b17] hover:border-amber-500/20'}`}
                  onClick={() => {
                    selectAuasHistoryEntry(entry);
                  }}
                >
                  <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${auasJobId === entry.jobId ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-900/40' : 'bg-white/5 text-slate-400 group-hover:text-amber-400 group-hover:bg-amber-500/10'}`}>
                    <Layers size={18} />
                  </div>
                  <div className="flex-1 min-w-0 block lg:hidden xl:block">
                    <p className={`text-sm truncate font-medium ${auasJobId === entry.jobId ? 'text-amber-100' : 'text-slate-200 group-hover:text-amber-100'}`}>{entry.filename}</p>
                    <div className="flex items-center gap-2 mt-1 opacity-80">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        AUAS: {entry.auasAreaHa.toFixed(1)}ha
                      </span>
                      {entry.status && (
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
                      )}
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const cancelled = await cancelProcessingJobsForCard({
                        cardJobId: entry.jobId,
                        flow: 'auas',
                        extraJobIds: [auasProcessJobIdRef.current],
                      });
                      if (cancelled) {
                        toast.info('Processamento cancelado ao excluir o card. Cobrança mínima de cancelamento aplicada.');
                      }
                      if (auasJobId === entry.jobId) {
                        auasAbortRef.current?.abort();
                        auasAbortRef.current = null;
                        auasProcessJobIdRef.current = null;
                      }
                      if (auasJobsRef) {
                        void deleteDoc(doc(auasJobsRef, entry.jobId)).catch(() => undefined);
                      }
                      if (conversationsRef) {
                        const linkedConversationIds = new Set<string>();
                        if (entry.conversationId) linkedConversationIds.add(entry.conversationId);
                        for (const conv of conversations) {
                          if (String(conv.auasJobId || '').trim() === String(entry.jobId)) {
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
                      setAuasHistory((prev) => prev.filter((item) => item.id !== entry.id));
                      if (auasJobId === entry.jobId) {
                        setAuasJobId(null);
                        setAuasResult(null);
                        setAuasProcessing(false);
                        setAuasProgress(null);
                        setAuasError(null);
                      }
                    }}
                    className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block lg:hidden xl:block shrink-0"
                    title="Excluir histórico"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 block lg:hidden xl:block">
                <div className="inline-flex justify-center items-center w-10 h-10 rounded-full bg-white/5 text-slate-500 mb-2">
                  <Clock size={16} />
                </div>
                <p className="text-xs text-slate-500">Nenhum histórico de Novo CAR.</p>
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
                  </div>
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
            /* ─── Chat Conversation List ─── */
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors group ${conv.id === activeConversationId ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-slate-400'}`}
              >
                <button
                  onClick={() => onSelectConversation(conv.id)}
                  className="flex-1 min-w-0 text-left flex items-center gap-3"
                >
                  <MessageSquare
                    size={18}
                    className={conv.id === activeConversationId ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}
                  />
                  <div className="overflow-hidden block lg:hidden xl:block">
                    <p className="text-sm text-slate-300 truncate group-hover:text-white transition-colors inline-flex items-center gap-2">
                      {conv.lastAttachmentType === 'pdf' && <FileText size={12} className="text-emerald-300 shrink-0" />}
                      {conv.lastAttachmentType === 'image' && <ImagePlus size={12} className="text-emerald-300 shrink-0" />}
                      <span className="truncate">{conv.title}</span>
                    </p>
                    {conv.lastMessagePreview && <p className="text-[10px] text-slate-600 truncate">{conv.lastMessagePreview}</p>}
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
                  title="Excluir chat"
                  aria-label="Excluir chat"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
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
        <header className="h-14 sm:h-16 flex-shrink-0 flex items-center justify-between px-3 sm:px-6 border-b border-white/5 bg-[#050b08]/50 backdrop-blur-md">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors shrink-0"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <Zap size={16} className="text-emerald-400 fill-current shrink-0" />
              <span className="font-medium text-slate-200 text-sm sm:text-base truncate">
                {activeView === 'chat' ? 'GeoForest v2.0' : activeView === 'simcar-clip' ? 'Recorte SIMCAR' : activeView === 'auas' ? 'Novo CAR' : activeView === 'features' ? 'Funcionalidades' : 'Configurações'}
              </span>
              {activeView === 'chat' && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 uppercase tracking-wide shrink-0 hidden sm:inline-block">
                  Online
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2"></div>
        </header>

        {activeView === 'chat' ? (
          <>
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-2 sm:px-4 py-4 sm:py-6 scroll-smooth custom-scrollbar relative z-0">
              <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
                {chatTimeline}
              </div>
            </div>

            <div className="p-2 sm:p-4 pb-4 sm:pb-6 w-full flex-shrink-0 relative z-30">
              {chatError && (
                <div className="max-w-3xl mx-auto mb-2">
                  <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    <AlertTriangle size={14} className="mt-0.5 text-amber-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="leading-relaxed">{chatError}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onRetryLastPrompt}
                          className="rounded-md border border-amber-300/35 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-400/20"
                        >
                          Repetir ultima pergunta
                        </button>
                        <button
                          type="button"
                          onClick={() => setChatError(null)}
                          className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="max-w-3xl mx-auto relative group z-30">
                <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm group-focus-within:bg-emerald-500/10 transition-all duration-500" />
                <div className="relative bg-[#0e1612]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-visible focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all duration-300">
                  <textarea
                    ref={chatTextareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder="Descreva sua análise ambiental ou anexe um mapa..."
                    className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 px-4 py-4 min-h-[60px] max-h-[200px] resize-none focus:outline-none text-sm leading-relaxed custom-scrollbar"
                    rows={1}
                    style={{ height: input ? `${Math.min(input.split('\n').length * 24 + 32, 200)}px` : '60px' }}
                  />
                  {(imageFile || pdfFile || queuedFiles.length > 0) && (
                    <div className="px-4 pb-2">
                      <div className="inline-flex max-w-[320px] items-center gap-2 px-2.5 py-2 rounded-xl bg-[#0c1511] border border-white/10 text-xs text-slate-200 shadow-sm">
                        <div
                          className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${imageFile || queuedFiles.some((f) => (f.type || '').toLowerCase().startsWith('image/'))
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/20 text-red-300'
                            }`}
                        >
                          {imageFile ||
                            queuedFiles.some((f) => (f.type || '').toLowerCase().startsWith('image/')) ? (
                            <ImagePlus size={13} />
                          ) : (
                            <FileText size={13} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {queuedFiles.length > 0
                              ? `${queuedFiles.length} arquivo(s) selecionado(s)`
                              : imageFile?.name || pdfFile?.name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {queuedFiles.length > 0
                              ? 'Múltiplos anexos prontos para envio'
                              : imageFile
                                ? 'Imagem pronta para envio'
                                : 'PDF pronto para envio'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => clearAttachments()}
                          className="ml-1 h-6 w-6 shrink-0 rounded-md text-slate-500 hover:text-red-300 hover:bg-red-500/10"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs cursor-pointer">
                        <ImagePlus size={16} className="text-emerald-300" />
                        <span className="hidden sm:inline">Anexar</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            onPickAttachment(Array.from(e.target.files || []));
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <div className="relative z-40" ref={modelMenuRef}>
                        <button
                          type="button"
                          onClick={() => setModelMenuOpen((v) => !v)}
                          className="inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs"
                        >
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]"></span>
                          <span className="max-w-[80px] sm:max-w-[140px] truncate">{selectedModelLabel}</span>
                          <ChevronDown
                            size={13}
                            className={`text-slate-400 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {modelMenuOpen && (
                          <div className="absolute left-0 sm:left-0 right-0 sm:right-auto bottom-full mb-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 rounded-2xl bg-[#0d1612]/95 border border-white/10 shadow-2xl backdrop-blur-xl z-[120] overflow-hidden">
                            <div className="px-4 py-3 border-b border-white/10">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Seleção de modelo</p>
                              <p className="text-xs text-slate-300 mt-1">Escolha manualmente ou use Auto</p>
                            </div>
                            <div className="max-h-80 overflow-auto custom-scrollbar p-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedModel('auto');
                                  setModelMenuOpen(false);
                                }}
                                className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${selectedModel === 'auto'
                                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                  }`}
                              >
                                <div className="text-xs font-medium">Auto (Florestal)</div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Escolhe modelo por contexto (texto, imagem e documento)
                                </div>
                              </button>
                              {models.map((model) => (
                                <button
                                  key={model.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModel(model.id);
                                    setModelMenuOpen(false);
                                  }}
                                  className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${selectedModel === model.id
                                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                    }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium">{model.label}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                                      {(model.capabilities || ['text']).join(' + ')}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                    {model.description}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 ml-auto">
                      {(sending || aiThinking) && (
                        <button
                          type="button"
                          onClick={onStopChatGeneration}
                          className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                        >
                          <Square size={12} />
                          <span className="hidden sm:inline">Parar</span>
                        </button>
                      )}
                      <div className="h-4 w-[1px] bg-white/10 hidden sm:block"></div>
                      <button
                        onClick={handleSend}
                        disabled={sending || uploading || (!input.trim() && !imageFile && !pdfFile && queuedFiles.length === 0)}
                        className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${input.trim() || imageFile || pdfFile || queuedFiles.length > 0
                          ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-400'
                          : 'bg-white/5 text-slate-500 cursor-not-allowed'
                          }`}
                      >
                        <span className="hidden sm:inline">{sending ? 'Gerando...' : uploading ? 'Enviando...' : 'Enviar'}</span>
                        <Send size={14} className={input.trim() ? 'fill-current' : ''} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-2">
                  <p className="text-[10px] text-slate-600">A IA pode cometer erros. Verifique informações críticas.</p>
                </div>
              </div>
            </div>
          </>
        ) : activeView === 'simcar-clip' ? (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in-up">
              <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-4 sm:p-6">
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

                {/* Upload Area */}
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-4 ${simcarClipFile
                    ? 'border-emerald-500/50 bg-emerald-500/5 cursor-pointer'
                    : simcarVectorizedServerZipReady
                      ? 'border-amber-500/30 bg-amber-500/10 cursor-default'
                      : 'border-white/10 hover:border-emerald-500/30 hover:bg-white/5 cursor-pointer'
                    }`}
                  onClick={() => {
                    if (simcarVectorizedServerZipReady) return;
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.zip';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        setSimcarClipFile(file);
                        setSimcarClipDownloadUrl(null);
                        setSimcarClipSummary(null);
                        setSimcarClipError(null);
                        setSimcarVectorizedStatus(null);
                      }
                    };
                    input.click();
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (simcarVectorizedServerZipReady) return;
                    const file = e.dataTransfer.files[0];
                    if (file && file.name.toLowerCase().endsWith('.zip')) {
                      setSimcarClipFile(file);
                      setSimcarClipDownloadUrl(null);
                      setSimcarClipSummary(null);
                      setSimcarClipError(null);
                      setSimcarVectorizedStatus(null);
                    }
                  }}
                >
                  {simcarClipFile ? (
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
                          Nenhum
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
                      onChange={(e) => setSimcarAirId(e.target.value)}
                      placeholder="Ex: MT-5107768-4D6B3C22B5FE4..."
                      className="w-full px-4 py-2.5 rounded-xl bg-black/30 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-colors"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Será preenchido no campo IDENTIFIC da camada AIR</p>
                  </div>
                )}

                {/* Process Button */}
                <button
                  disabled={
                    simcarClipMode === 'auto-clip'
                      ? !simcarClipFile || simcarClipProcessing || !simcarAirId.trim() || selectedSimcarClipLayerCount === 0
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
                    if (!simcarClipFile) return;
                    setSimcarClipProcessing(true);
                    clearSimcarClipProgressQueue();
                    setSimcarClipProgress(null);
                    setSimcarClipDownloadUrl(null);
                    setSimcarClipSummary(null);
                    setSimcarClipError(null);

                    try {
                      const base64 = await readFileAsBase64Payload(simcarClipFile);
                      const selectedLayers = selectedSimcarClipLayerNames;
                      const controller = new AbortController();
                      simcarClipAbortRef.current = controller;
                      simcarClipProcessJobIdRef.current = null;

                      const response = await apiFetch('/api/simcar/clip', {
                        method: 'POST',
                        body: JSON.stringify({
                          propertyZip: base64,
                          filename: simcarClipFile.name,
                          layerNames: selectedLayers,
                          airIdentificacao: simcarAirId.trim(),
                        }),
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
                                          `Arquivo: ${simcarClipFile.name}.`,
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
                              }
                            } catch { }
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
                      }
                    } finally {
                      clearSimcarClipProgressQueue();
                      setSimcarClipProcessing(false);
                      simcarClipAbortRef.current = null;
                      simcarClipProcessJobIdRef.current = null;
                    }
                  }}
                  className={`w-full py-3 rounded-xl font-medium text-sm transition-all duration-300 flex items-center justify-center gap-2 ${(
                    simcarClipMode === 'auto-clip'
                      ? !simcarClipFile || simcarClipProcessing || !simcarAirId.trim() || selectedSimcarClipLayerCount === 0
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
                {simcarClipProcessing && (
                  <button
                    onClick={async () => {
                      await requestProcessCancel(simcarClipProcessJobIdRef.current);
                      simcarClipProcessJobIdRef.current = null;
                      simcarClipAbortRef.current?.abort();
                      clearSimcarClipProgressQueue();
                      setSimcarClipProcessing(false);
                      toast.info('Cancelamento solicitado. Cobrança proporcional aplicada.');
                    }}
                    className="w-full mt-2 py-2 rounded-xl border border-red-500/20 text-red-400 text-sm hover:bg-red-500/10 transition-colors"
                  >
                    Cancelar
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
                            <a
                              href={simcarClipDownloadUrl}
                              download
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/30 w-full sm:w-auto justify-center sm:justify-start"
                            >
                              <Download size={14} />
                              Baixar ZIP
                            </a>
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

                    {/* Satellite Image Selection + Analysis Buttons */}
                    {simcarClipMode === 'auto-clip' && !simcarAnalysisProcessing && simcarAnalysisMessages.length === 0 && simcarAuasMessages.length === 0 && (
                      <section className="bg-[#0e1216]/60 backdrop-blur-md border border-white/5 rounded-2xl p-5 space-y-4">
                        {/* ZIP Download Links */}
                        {(() => {
                          const historyEntry = simcarClipHistory.find((c) => c.jobId === simcarClipJobId);
                          const inputUrl = historyEntry?.inputZipUrl;
                          const outputUrl = historyEntry?.outputZipUrl;
                          return (inputUrl || outputUrl) ? (
                            <div className="flex gap-2">
                              {inputUrl && (
                                <a href={inputUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white text-xs font-medium transition-colors">
                                  <Download size={14} /> Shapefile Original
                                </a>
                              )}
                              {outputUrl && (
                                <a href={outputUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-600/30 text-emerald-300 hover:text-white text-xs font-medium transition-colors">
                                  <Download size={14} /> ZIP Recortado
                                </a>
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
                                        <a
                                          key={idx}
                                          href={img.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors"
                                        >
                                          <img
                                            src={img.url}
                                            alt={captionText}
                                            className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                            loading="lazy"
                                          />
                                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <span className="text-[10px] text-white flex items-center gap-1">
                                              <Eye size={10} /> Abrir
                                            </span>
                                          </div>
                                          <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                        </a>
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
                                              <a
                                                key={`${panel.key}-${idx}`}
                                                href={img.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors"
                                              >
                                                <img
                                                  src={img.url}
                                                  alt={captionText}
                                                  className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                                  loading="lazy"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                                  <span className="text-[10px] text-white flex items-center gap-1">
                                                    <Eye size={10} /> Abrir
                                                  </span>
                                                </div>
                                                <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                              </a>
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
                                          <a
                                            key={idx}
                                            href={img.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group block relative rounded-xl overflow-hidden border border-white/10 cursor-zoom-in hover:border-white/20 transition-colors"
                                          >
                                            <img
                                              src={img.url}
                                              alt={captionText}
                                              className="w-full h-32 object-cover transition-transform duration-300 group-hover:scale-105"
                                              loading="lazy"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                              <span className="text-[10px] text-white flex items-center gap-1">
                                                <Eye size={10} /> Abrir
                                              </span>
                                            </div>
                                            <p className="text-[9px] text-slate-400 px-2 py-1.5 bg-black/30 truncate" title={captionText}>{captionText}</p>
                                          </a>
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
        ) : activeView === 'auas' ? (
          /* ══════════════════════════════════════════════════════════
             ABA AUAS — Área de Uso Alternativo do Solo
          ══════════════════════════════════════════════════════════ */
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in-up">

              {/* ─── Cabeçalho ─── */}
              <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a110e]/70 backdrop-blur-2xl p-5 sm:p-8 md:p-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                {/* Decorative glowing orbs */}
                <div className="absolute -top-32 -right-32 w-64 h-64 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-700 pointer-events-none" />

                <div className="relative flex flex-col sm:flex-row items-start gap-5 sm:gap-6">
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.15)] shrink-0 text-amber-400">
                    <Layers size={28} strokeWidth={2} />
                  </div>
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-white mb-2 tracking-tight">Novo CAR</h1>
                    <p className="text-slate-400 text-xs sm:text-sm leading-relaxed max-w-2xl">
                      Classifica as áreas do imóvel com base no PRODES (desmatamento pré e pós-2008),
                      aplica buffer de 2 m para cada lado nos rios da base SFB e calcula
                      <strong className="text-amber-300"> AC</strong>,
                      <strong className="text-emerald-300"> AUAS</strong>,
                      <strong className="text-blue-300"> AVN</strong> e
                      <strong className="text-purple-300"> ARL</strong>.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 sm:gap-3 text-[10px] sm:text-xs">
                      {[
                        { label: 'AC', desc: 'Desmatamento < 2008', color: 'amber' },
                        { label: 'AUAS', desc: 'Desmatamento ≥ 2008', color: 'emerald' },
                        { label: 'AVN', desc: 'Imóvel − AC − AUAS − Rios', color: 'blue' },
                        { label: 'ARL', desc: 'Igual à AVN', color: 'purple' },
                      ].map((item) => (
                        <span key={item.label} className={`px-3 py-1.5 rounded-xl bg-${item.color}-500/10 border border-${item.color}-500/20 text-${item.color}-300 flex items-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
                          <span className={`w-1.5 h-1.5 rounded-full bg-${item.color}-400`} />
                          <strong>{item.label}</strong> <span className="text-white/20">|</span> <span className="opacity-80 font-medium">{item.desc}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* ─── Upload do Shapefile ─── */}
              {!auasResult && !auasProcessing && (
                <section className="bg-gradient-to-br from-white/[0.04] to-transparent backdrop-blur-md border border-white/[0.08] rounded-3xl p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                  <h2 className="font-semibold text-slate-200 mb-1.5 flex items-center gap-2 text-base">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                      <Upload size={16} strokeWidth={2.5} />
                    </div>
                    Shapefile do Imóvel
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mb-6">
                    Envie o ZIP com o shapefile da propriedade (.shp, .dbf, .prj).
                    O servidor consultará o PRODES e a base SFB automaticamente.
                  </p>

                  <label className={`group relative flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden isolate ${auasFile ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 hover:border-amber-500/30 bg-white/[0.02] hover:bg-white/[0.03]'}`}>
                    <div className={`absolute inset-0 bg-gradient-to-br from-amber-500/0 via-amber-500/0 to-amber-500/5 transition-opacity ${auasFile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    <input
                      ref={auasFileInputRef}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setAuasFile(f);
                        setAuasError(null);
                      }}
                    />
                    {auasFile ? (
                      <>
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)] relative z-10">
                          <CheckCircle2 size={32} strokeWidth={2} />
                        </div>
                        <div className="text-center relative z-10">
                          <p className="font-bold text-white text-base tracking-tight">{auasFile.name}</p>
                          <p className="text-xs text-slate-400 mt-1 font-medium">{(auasFile.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setAuasFile(null); if (auasFileInputRef.current) auasFileInputRef.current.value = ''; }}
                          className="text-xs font-semibold text-slate-400 hover:text-red-400 transition-colors mt-2 px-3 py-1.5 rounded-lg hover:bg-red-500/10 relative z-10"
                        >
                          Remover arquivo
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="p-4 rounded-2xl bg-white/5 text-slate-400 border border-white/5 group-hover:-translate-y-1 transition-transform duration-300 relative z-10 shadow-sm">
                          <Upload size={32} strokeWidth={1.5} />
                        </div>
                        <div className="text-center relative z-10">
                          <p className="font-semibold text-slate-200 text-sm sm:text-base">Arraste ou clique para selecionar</p>
                          <p className="text-xs text-slate-500 mt-1.5 font-medium">Arquivo ZIP com shapefile do imóvel</p>
                        </div>
                      </>
                    )}
                  </label>

                  {auasError && (
                    <div className="mt-5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                      <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-400" />
                      <span className="font-medium">{auasError}</span>
                    </div>
                  )}

                  <button
                    disabled={!auasFile}
                    onClick={async () => {
                      if (!auasFile) return;
                      setAuasError(null);
                      setAuasProcessing(true);
                      setAuasProgress({ step: 'upload', percent: 5, message: 'Enviando shapefile...' });
                      setAuasAgentLog([{ label: 'Iniciando processamento Novo CAR...', done: false, kind: 'step' }]);
                      auasAbortRef.current = new AbortController();
                      auasProcessJobIdRef.current = null;
                      try {
                        const reader = new FileReader();
                        const zipB64: string = await new Promise((resolve, reject) => {
                          reader.onload = () => resolve((reader.result as string).split(',')[1]);
                          reader.onerror = reject;
                          reader.readAsDataURL(auasFile);
                        });
                        const resp = await apiFetch('/api/auas/analyze', {
                          method: 'POST',
                          body: JSON.stringify({ propertyZip: zipB64, filename: auasFile.name }),
                          signal: auasAbortRef.current.signal,
                        });
                        if (!resp.ok || !resp.body) {
                          const err = await readApiError(resp);
                          if (resp.status === 402 || String(err?.code || '').toUpperCase() === 'INSUFFICIENT_CREDITS') {
                            handleInsufficientCredits(err.error || 'Saldo insuficiente para processar Novo CAR.');
                          }
                          throw new Error(err.error || `HTTP ${resp.status}`);
                        }
                        const reader2 = resp.body.getReader();
                        const decoder = new TextDecoder();
                        let buf = '';
                        while (true) {
                          const { value, done } = await reader2.read();
                          if (done) break;
                          buf += decoder.decode(value, { stream: true });
                          const lines = buf.split('\n');
                          buf = lines.pop() ?? '';
                          for (const line of lines) {
                            if (!line.startsWith('data:')) continue;
                            let evt: any;
                            try {
                              evt = JSON.parse(line.slice(5));
                            } catch {
                              continue;
                            }
                            if (evt.type === 'job_started') {
                              const streamJobId = typeof evt.jobId === 'string' ? evt.jobId.trim() : '';
                              if (streamJobId) {
                                auasProcessJobIdRef.current = streamJobId;
                                setAuasJobId(streamJobId);
                                const placeholderResult = normalizeAuasResultPayload({
                                  propertyAreaHa: 0,
                                  acAreaHa: 0,
                                  auasAreaHa: 0,
                                  avnAreaHa: 0,
                                  arlAreaHa: 0,
                                  riverBufferHa: 0,
                                  auasPolygons: [],
                                  status: 'processing',
                                });
                                const placeholder: AuasHistoryItem = {
                                  id: streamJobId,
                                  timestamp: new Date().toISOString(),
                                  filename: auasFile.name || `Novo CAR ${streamJobId.slice(0, 8)}`,
                                  jobId: streamJobId,
                                  inputFilename: auasFile.name,
                                  ...placeholderResult,
                                };
                                setAuasHistory((prev) => {
                                  const existing = prev.find((item) => item.jobId === streamJobId);
                                  if (existing) return prev;
                                  return [placeholder, ...prev];
                                });
                                void persistAuasHistoryEntry(placeholder).catch(() => undefined);
                              }
                              continue;
                            }
                            if (evt.type === 'progress') {
                              const msg = normalizeBackendText(String(evt.message || 'Processando...'));
                              const nextPercent = Math.max(0, Math.min(100, Math.round(Number(evt.percent || 0))));
                              setAuasProgress((prev) => {
                                const current = Math.max(0, Math.min(100, Math.round(Number(prev?.percent || 0))));
                                return {
                                  step: evt.step || '',
                                  percent: Math.max(current, nextPercent),
                                  message: msg,
                                };
                              });
                              setAuasAgentLog((prev) => {
                                const updated = prev.map((s) => (s.done ? s : { ...s, done: true }));
                                return [...updated, { label: msg, done: false, kind: 'step' as const }];
                              });
                              continue;
                            }
                            if (evt.type === 'model_thinking') {
                              const source = evt.source ? `[${evt.source}]` : '';
                              const thought = String(evt.thinkingText || '').trim();
                              if (thought) {
                                const snippet = thought.replace(/\s+/g, ' ').slice(0, 120);
                                const label = source ? `${source}: ${snippet}...` : `${snippet}...`;
                                setAuasAgentLog((prev) => [...prev, { label, done: true, kind: 'thinking' as const }]);
                              }
                              continue;
                            }
                            if (evt.type === 'billing' && evt.billing) {
                              applyBillingToWallet(evt.billing as BillingResult);
                              continue;
                            }
                            if (evt.type === 'error') {
                              if (String(evt.code || '').toUpperCase() === 'INSUFFICIENT_CREDITS') {
                                handleInsufficientCredits(String(evt.message || 'Saldo insuficiente para processar Novo CAR.'));
                              }
                              throw new Error(evt.message || 'Erro na análise AUAS');
                            }
                            if (evt.type === 'result') {
                              const nextJobId = typeof evt.jobId === 'string' && evt.jobId.trim()
                                ? evt.jobId.trim()
                                : evt?.data?.downloadUrl?.match?.(/\/auas\/download\/([^/?]+)/)?.[1] || null;
                              const normalizedResult = {
                                ...normalizeAuasResultPayload(evt.data),
                                status: 'completed' as const,
                                error: undefined,
                              };
                              if (!nextJobId) {
                                throw new Error('Resultado do Novo CAR sem jobId valido.');
                              }
                              const missingArtifacts = [
                                !normalizedResult.inputZipUrl ? 'ZIP original' : '',
                                !normalizedResult.outputZipUrl ? 'ZIP de saida' : '',
                                !normalizedResult.contextUrl ? 'Contexto JSON' : '',
                              ].filter(Boolean);
                              if (missingArtifacts.length > 0) {
                                throw new Error(`Falha na persistencia Cloudinary do Novo CAR: ${missingArtifacts.join(', ')}.`);
                              }
                              setAuasResult(normalizedResult);
                              setAuasJobId(nextJobId);
                              setAuasProcessing(false);
                              setAuasProgress(null);
                              setAuasAgentLog((prev) => prev.map((item) => ({ ...item, done: true })));

                              const entry: AuasHistoryItem = {
                                id: nextJobId,
                                timestamp: new Date().toISOString(),
                                filename: `Novo CAR ${new Date().toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`,
                                jobId: nextJobId,
                                inputFilename: auasFile.name,
                                ...normalizedResult,
                              };
                              setAuasHistory((prev) => {
                                const filtered = prev.filter((item) => item.jobId !== nextJobId);
                                return [entry, ...filtered];
                              });
                              void persistAuasHistoryEntry(entry).catch((error) => {
                                console.warn('Falha ao persistir histórico Novo CAR:', error);
                                toast.error('Nao foi possivel sincronizar o card do Novo CAR no Firestore pelo app.');
                              });

                              const cloudinaryFiles = [
                                entry.inputZipUrl ? `- ZIP original: ${entry.inputZipUrl}` : '',
                                entry.outputZipUrl ? `- ZIP Novo CAR: ${entry.outputZipUrl}` : '',
                                entry.contextUrl ? `- Contexto JSON: ${entry.contextUrl}` : '',
                              ].filter(Boolean);
                              const summaryLines = [
                                `Novo CAR concluído (job ${nextJobId}).`,
                                `Área do imóvel: ${entry.propertyAreaHa.toFixed(2)} ha.`,
                                `AC: ${entry.acAreaHa.toFixed(2)} ha | AUAS: ${entry.auasAreaHa.toFixed(2)} ha | AVN/ARL: ${entry.avnAreaHa.toFixed(2)} ha.`,
                                entry.riverBufferHa > 0 ? `Buffer de rios removido: ${entry.riverBufferHa.toFixed(4)} ha.` : '',
                                entry.auasOpeningDate
                                  ? `ABERTURA automática do shape AUAS: ${entry.auasOpeningDate} (${entry.auasOpeningSource === 'PRODES' ? 'fonte PRODES' : 'fallback IA'}).`
                                  : 'ABERTURA do shape AUAS não preenchida (ano não detectado).',
                                cloudinaryFiles.length > 0 ? `Arquivos no Cloudinary:\n${cloudinaryFiles.join('\n')}` : '',
                                entry.downloadUrl ? `Download do resultado: ${entry.downloadUrl}` : '',
                              ].filter(Boolean);
                              if (entry.analysis) {
                                const excerpt = entry.analysis.length > 1800
                                  ? `${entry.analysis.slice(0, 1800)}...`
                                  : entry.analysis;
                                summaryLines.push(`Síntese IA:\n${excerpt}`);
                              }
                              void appendAuasEntriesToConversation(
                                entry,
                                [
                                  {
                                    role: 'user',
                                    text: [
                                      'Solicitei um processamento de Novo CAR (AUAS).',
                                      `Arquivo: ${auasFile.name}.`,
                                    ].join('\n'),
                                  },
                                  {
                                    role: 'ai',
                                    text: summaryLines.join('\n\n'),
                                  },
                                ],
                                { title: entry.filename }
                              ).catch((error) => {
                                console.warn('Falha ao anexar resultado Novo CAR na conversa:', error);
                              });
                            }
                          }
                        }
                      } catch (err: any) {
                        if (err?.name !== 'AbortError') {
                          const errorMessage = err.message || 'Erro ao processar análise AUAS.';
                          setAuasError(errorMessage);
                          const activeJobId = String(auasProcessJobIdRef.current || '').trim();
                          if (activeJobId) {
                            markAuasHistoryStatus(activeJobId, 'failed', errorMessage);
                          }
                          setAuasAgentLog((prev) => [
                            ...prev.map((item) => ({ ...item, done: true })),
                            { label: `Erro: ${errorMessage}`, done: true, kind: 'step' as const },
                          ]);
                        }
                        setAuasProcessing(false);
                        setAuasProgress(null);
                      } finally {
                        auasAbortRef.current = null;
                        auasProcessJobIdRef.current = null;
                      }
                    }}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-all shadow-lg shadow-amber-900/30"
                  >
                    <Zap size={16} />
                    Iniciar Novo CAR
                  </button>
                </section>
              )}

              {/* ─── Em processamento ─── */}
              {auasProcessing && (
                <section className="relative rounded-2xl border border-amber-500/30 bg-[#111612]/95 backdrop-blur-md px-5 py-4 shadow-2xl shadow-amber-900/20">
                  <div className="absolute -top-[7px] left-7 h-3.5 w-3.5 rotate-45 border-l border-t border-amber-500/30 bg-[#111612]" />
                  {(() => {
                    const pct = Math.max(0, Math.min(100, Math.round(Number(auasProgress?.percent || 0))));
                    const activeStep = auasAgentLog.filter((s) => s.kind === 'step' && !s.done).at(-1);
                    const thinkingSteps = auasAgentLog.filter((s) => s.kind === 'thinking');
                    const elMin = Math.floor(auasElapsed / 60);
                    const elSec = auasElapsed % 60;
                    const phaseIcons: Record<string, React.ReactNode> = {
                      satellite: <Satellite size={12} />,
                      upload: <Upload size={12} />,
                      brain: <Brain size={12} />,
                      zap: <Zap size={12} />,
                    };
                    const phaseColors: Record<string, { text: string; border: string }> = {
                      zap: { text: 'text-amber-400', border: 'border-amber-500/20' },
                      satellite: { text: 'text-cyan-400', border: 'border-cyan-500/20' },
                      upload: { text: 'text-emerald-400', border: 'border-emerald-500/20' },
                      brain: { text: 'text-purple-400', border: 'border-purple-500/20' },
                    };
                    return (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="relative flex-shrink-0">
                            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
                              <Brain size={16} />
                            </div>
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 animate-ping opacity-75" />
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-200">GeoForest IA — Novo CAR em execução...</p>
                            <p className="text-[10px] text-slate-400 truncate">
                              {activeStep?.label || auasProgress?.message || 'Preparando...'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                            <span className="text-xs font-bold text-amber-400 tabular-nums">{pct}%</span>
                            <span className="text-[9px] text-slate-500 tabular-nums flex items-center gap-1">
                              <Clock size={9} />
                              {elMin > 0 ? `${elMin}m ${String(elSec).padStart(2, '0')}s` : `${elSec}s`}
                            </span>
                          </div>
                        </div>

                        <div className="mb-3 bg-black/40 h-1.5 rounded-full overflow-hidden relative">
                          <div
                            className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden bg-gradient-to-r from-amber-500 to-orange-400"
                            style={{ width: `${pct}%` }}
                          >
                            <div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.5s_infinite]"
                              style={{ backgroundSize: '200% 100%' }}
                            />
                          </div>
                        </div>

                        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                          {auasGroupedPhases.map((phase) => {
                            const colors = phaseColors[phase.icon] || phaseColors.zap;
                            const doneSteps = phase.steps.filter((s) => s.done);
                            const showCollapsed = phase.allDone && doneSteps.length > 2;
                            return (
                              <div key={phase.id} className={`rounded-lg border ${phase.allDone ? 'border-white/5 bg-white/[0.02]' : `${colors.border} bg-white/[0.03]`} overflow-hidden`}>
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
                                {!showCollapsed && (
                                  <div className="px-3 pb-2 space-y-1">
                                    {phase.steps.map((step, i) => (
                                      <div
                                        key={i}
                                        className={`flex items-start gap-2 text-[11px] transition-all duration-300 ${step.done ? 'opacity-35' : 'opacity-100 pl-1 border-l-2 border-amber-400/50'}`}
                                      >
                                        {step.done ? (
                                          <CheckCircle2 size={10} className="mt-0.5 flex-shrink-0 text-emerald-400/70" />
                                        ) : (
                                          <Loader2 size={10} className="mt-0.5 flex-shrink-0 animate-spin text-amber-400" />
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

                          <div ref={auasAgentLogEndRef} />
                        </div>

                        <button
                          onClick={async () => {
                            await requestProcessCancel(auasProcessJobIdRef.current);
                            auasProcessJobIdRef.current = null;
                            auasAbortRef.current?.abort();
                            setAuasProcessing(false);
                            setAuasProgress(null);
                            toast.info('Cancelamento solicitado. Cobrança proporcional aplicada.');
                          }}
                          className="mt-3 text-xs text-slate-500 hover:text-red-400 transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    );
                  })()}
                </section>
              )}

              {/* ─── Resultados ─── */}
              {auasResult && !auasProcessing && (
                <>
                  {/* Cards de área */}
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
                    {[
                      { label: 'Imóvel', value: auasResult.propertyAreaHa, color: 'slate', icon: '🏠' },
                      { label: 'AC (pré-2008)', value: auasResult.acAreaHa, color: 'amber', icon: '📅' },
                      { label: 'AUAS (pós-2008)', value: auasResult.auasAreaHa, color: 'emerald', icon: '🌿' },
                      { label: 'AVN / ARL', value: auasResult.avnAreaHa, color: 'blue', icon: '🌳' },
                    ].map((card, idx) => (
                      <div key={card.label} className={`group/card relative overflow-hidden rounded-2xl bg-[#131b17] border border-white/[0.05] p-4 sm:p-5 hover:border-${card.color}-500/30 hover:bg-[#16201b] transition-all duration-300 shadow-sm animate-fade-in-up`} style={{ animationDelay: `${idx * 50}ms` }}>
                        <div className={`absolute -right-4 -top-4 w-16 h-16 bg-${card.color}-500/5 rounded-full blur-xl group-hover/card:bg-${card.color}-500/10 transition-colors pointer-events-none`} />
                        <div className="flex flex-col h-full relative z-10">
                          <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                            <span className="text-sm">{card.icon}</span> {card.label}
                          </p>
                          <div className="mt-auto">
                            <p className={`text-2xl sm:text-3xl font-bold text-${card.color}-300 tracking-tight group-hover/card:scale-105 origin-left transition-transform duration-300`}>
                              {card.value.toFixed(2)}
                            </p>
                            <p className="text-[10px] font-medium text-slate-500 mt-0.5">hectares</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <section className="relative overflow-hidden bg-gradient-to-br from-[#0e1612]/80 to-[#0a110e]/90 border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] rounded-2xl p-5 sm:p-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
                    {auasResult.auasOpeningDate ? (
                      <div className="flex items-start sm:items-center gap-4 relative z-10">
                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                          <Clock size={20} />
                        </div>
                        <div>
                          <p className="text-sm text-slate-300 leading-relaxed">
                            <strong className="text-amber-300 font-semibold tracking-wide">DATA DE ABERTURA</strong> preenchida no shape AUAS:{' '}
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-white/10 text-white font-bold ml-1">
                              {auasResult.auasOpeningDate}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                            <CheckCircle2 size={12} className="text-emerald-500/70" />
                            Fonte: {auasResult.auasOpeningSource === 'PRODES' ? 'Detectado via PRODES' : 'Fallback IA Estimado'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start sm:items-center gap-4 relative z-10 opacity-70">
                        <div className="p-2.5 rounded-xl bg-slate-500/10 text-slate-400 border border-slate-500/20 shrink-0">
                          <AlertTriangle size={20} />
                        </div>
                        <p className="text-sm text-slate-400">
                          ABERTURA não preenchida automaticamente por ausência de ano detectável.
                        </p>
                      </div>
                    )}
                  </section>

                  {/* Buffer de rios */}
                  {auasResult.riverBufferHa > 0 && (
                    <section className="relative overflow-hidden bg-gradient-to-br from-cyan-950/20 to-[#0e1612]/80 border border-cyan-500/10 shadow-[0_0_15px_rgba(6,182,212,0.03)] rounded-2xl p-5 sm:p-6 animate-fade-in-up" style={{ animationDelay: '250ms' }}>
                      <div className="absolute bottom-0 left-0 w-40 h-40 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
                      <div className="relative z-10 flex items-start gap-4">
                        <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0 mt-0.5">
                          <Layers size={20} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-cyan-300 text-sm mb-1">
                            Buffer de Rios SFB Aplicado
                          </h3>
                          <p className="text-slate-300 text-sm leading-relaxed mb-2">
                            Área excluída por buffer (2m de cada lado):{' '}
                            <strong className="text-cyan-400 text-base">{auasResult.riverBufferHa.toFixed(4)} ha</strong>
                          </p>
                          <div className="inline-flex items-center gap-1.5 text-xs text-cyan-500/70 bg-cyan-500/5 px-2.5 py-1 rounded-lg border border-cyan-500/10">
                            <CheckCircle2 size={12} />
                            <span>Interseções com rios removidas das classes AC, AUAS e AVN.</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Detalhamento AUAS por ano */}
                  {auasResult.auasPolygons.length > 0 && (
                    <section className="bg-gradient-to-br from-[#0e1612]/60 to-transparent border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] rounded-2xl p-5 sm:p-6 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                      <div className="flex items-center gap-3 mb-5 border-b border-white/5 pb-4">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <BarChart3 size={18} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-200 text-sm sm:text-base">Distribuição Anual AUAS</h3>
                          <p className="text-xs text-slate-500 mt-0.5">Baseado em dados do PRODES (pós-2008)</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {auasResult.auasPolygons
                          .sort((a, b) => a.year - b.year)
                          .map((p, idx) => (
                            <div key={p.year} className="flex items-center gap-4 group/bar">
                              <span className="text-xs font-medium text-slate-400 w-12 shrink-0 group-hover/bar:text-slate-300 transition-colors">{p.year}</span>
                              <div className="flex-1 h-6 sm:h-7 bg-white/5 rounded-lg overflow-hidden relative shadow-inner">
                                <div
                                  className="absolute top-0 left-0 h-full rounded-lg bg-gradient-to-r from-emerald-500/80 to-teal-400/80 transition-all duration-1000 ease-out flex items-center shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                  style={{
                                    width: `${Math.max(2, Math.min(100, (p.areaHa / auasResult.auasAreaHa) * 100))}%`,
                                    transformOrigin: 'left',
                                    animation: `scaleX 1s ease-out ${350 + idx * 50}ms both`
                                  }}
                                >
                                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover/bar:opacity-100 transition-opacity" />
                                </div>
                              </div>
                              <span className="text-xs font-semibold text-emerald-300 w-20 text-right shrink-0 group-hover/bar:scale-105 transition-transform">{p.areaHa.toFixed(2)} ha</span>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}

                  {/* Botões de ação */}
                  <div className="flex flex-col sm:flex-row gap-4 pt-2 animate-fade-in-up" style={{ animationDelay: '350ms' }}>
                    {auasResult.downloadUrl && (
                      <a
                        href={
                          auasResult.downloadUrl.startsWith('https://res.cloudinary.com/')
                            ? toFileProxyUrl(
                              auasResult.downloadUrl,
                              `novo_car_${(auasJobId || 'resultado').replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`,
                              'download'
                            )
                            : auasResult.downloadUrl
                        }
                        download
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold text-sm transition-all shadow-lg shadow-amber-900/30 hover:shadow-xl hover:shadow-amber-900/40 hover:-translate-y-0.5 group/dwn"
                      >
                        <Download size={18} className="group-hover/dwn:-translate-y-0.5 transition-transform" />
                        Baixar Shapefiles Resultantes
                      </a>
                    )}
                    <button
                      onClick={() => resetAuasDraft()}
                      className="flex-shrink-0 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 font-medium text-sm transition-all group/new hover:text-white"
                    >
                      <Plus size={18} className="group-hover/new:rotate-90 transition-transform duration-300" />
                      Novo Processo
                    </button>
                  </div>
                </>
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
              onGoChat={() => setActiveView('chat')}
              onGoSimcar={() => setActiveView('simcar-clip')}
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
      </main >
    </div >
  );
}
