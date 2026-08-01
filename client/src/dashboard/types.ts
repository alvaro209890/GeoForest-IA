/**
 * Tipos de navegação do Dashboard GeoForest.
 * Fonte única para views, rotas e labels.
 */
export type {
  ChatMessage,
  Conversation,
  BillingUsageItem,
  BillingResult,
  BillingMePayload,
  SimcarAnalysisMessage,
  SimcarAnalysisImage,
  SimcarAcAvnAnalysisMeta,
  SimcarAuasMetaV1,
  SimcarAuasMeta,
  SimcarConversationEntry,
  SimcarLayerSummary,
  SimcarClipSummary,
  SimcarClipHistoryItem,
  SimcarServerRuntimeState,
  VerticesLayer,
  VerticesResultRow,
  VerticesProgress,
  VerticesHistoryItem,
  ContainmentHistoryItem,
  GeometryHistoryItem,
  ReceiptHistoryItem,
} from './types/history';

export type DashboardView =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes'
  | 'croqui'
  | 'solicitacao-prioridade'
  | 'features'
  | 'settings';

export type DashboardTabId =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes'
  | 'croqui'
  | 'solicitacao-prioridade';

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  'simcar-clip': 'Recorte SIMCAR',
  'simcar-receipts': 'Recibos SIMCAR',
  'cbers-wpm': 'CBERS 4A WPM',
  landsat: 'Landsat WMS',
  'vertices-proximas': 'Análise de Erros',
  'auas-sccon': 'AUAS × SCCON',
  sobreposicoes: 'Sobreposições',
  croqui: 'Croqui',
  'solicitacao-prioridade': 'Solicitação Prioridade',
  features: 'Funcionalidades',
  settings: 'Configurações',
};
