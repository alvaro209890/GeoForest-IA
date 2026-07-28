/**
 * Tipos de navegação do Dashboard GeoForest.
 * Fonte única para views, rotas e labels.
 */

export type DashboardView =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes'
  | 'features'
  | 'settings';

export type DashboardTabId =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'sobreposicoes';

export const DASHBOARD_VIEW_LABELS: Record<DashboardView, string> = {
  'simcar-clip': 'Recorte SIMCAR',
  'simcar-receipts': 'Recibos SIMCAR',
  'cbers-wpm': 'CBERS 4A WPM',
  landsat: 'Landsat WMS',
  'vertices-proximas': 'Análise de Erros',
  'auas-sccon': 'AUAS × SCCON',
  sobreposicoes: 'Sobreposições',
  features: 'Funcionalidades',
  settings: 'Configurações',
};
