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
  SimcarPos2008Meta,
  SimcarAcVegetacaoMeta,
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
  LotesHistoryItem,
  LotesRelatorioRow,
  ReceiptHistoryItem,
} from './types/history';

export type DashboardView =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'simcar-lotes'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes'
  | 'fiscalizacao'
  | 'croqui'
  | 'ndvi'
  | 'solicitacao-prioridade'
  | 'relatorio-fotografico'
  | 'features'
  | 'settings';

export type DashboardTabId =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'simcar-lotes'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes'
  | 'fiscalizacao'
  | 'croqui'
  | 'ndvi'
  | 'solicitacao-prioridade'
  | 'relatorio-fotografico';

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  'simcar-clip': 'Recorte SIMCAR',
  'simcar-receipts': 'Recibos SIMCAR',
  'simcar-lotes': 'Lotes SIMCAR',
  'cbers-wpm': 'CBERS 4A WPM',
  landsat: 'Landsat WMS',
  'vertices-proximas': 'Análise de Erros',
  'auas-sccon': 'AUAS × SCCON',
  sobreposicoes: 'Sobreposições',
  fiscalizacao: 'Fiscalização',
  croqui: 'Croqui',
  ndvi: 'NDVI',
  'solicitacao-prioridade': 'Solicitação Prioridade',
  'relatorio-fotografico': 'Relatório Fotográfico',
  features: 'Funcionalidades',
  settings: 'Configurações',
};
