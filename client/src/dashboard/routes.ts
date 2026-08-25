import type { DashboardView } from './types';

/**
 * Mapa path → view. Paths mais longos têm prioridade no match.
 */
export const DASHBOARD_PATH_TO_VIEW: Record<string, DashboardView> = {
  '/dashboard': 'simcar-clip',
  '/dashboard/simcar': 'simcar-clip',
  '/dashboard/recibos': 'simcar-receipts',
  '/dashboard/lotes': 'simcar-lotes',
  '/dashboard/cbers': 'cbers-wpm',
  '/dashboard/landsat': 'landsat',
  '/dashboard/erros': 'vertices-proximas',
  '/dashboard/auas': 'auas-sccon',
  '/dashboard/sobreposicoes': 'sobreposicoes',
  '/dashboard/croqui': 'croqui',
  '/dashboard/ndvi': 'ndvi',
  '/dashboard/solicitacao': 'solicitacao-prioridade',
  '/dashboard/manual': 'features',
  '/dashboard/configuracoes': 'settings',
  '/dashboard/chat': 'simcar-clip',
};

export const DASHBOARD_VIEW_TO_PATH: Record<DashboardView, string> = {
  'simcar-clip': '/dashboard/simcar',
  'simcar-receipts': '/dashboard/recibos',
  'simcar-lotes': '/dashboard/lotes',
  'cbers-wpm': '/dashboard/cbers',
  landsat: '/dashboard/landsat',
  'vertices-proximas': '/dashboard/erros',
  'auas-sccon': '/dashboard/auas',
  sobreposicoes: '/dashboard/sobreposicoes',
  croqui: '/dashboard/croqui',
  ndvi: '/dashboard/ndvi',
  'solicitacao-prioridade': '/dashboard/solicitacao',
  features: '/dashboard/manual',
  settings: '/dashboard/configuracoes',
};

export function getViewFromPath(path: string): DashboardView {
  const entries = Object.entries(DASHBOARD_PATH_TO_VIEW).sort((a, b) => b[0].length - a[0].length);
  for (const [route, view] of entries) {
    if (path === route || path.startsWith(`${route}/`)) return view;
  }
  if (path.startsWith('/dashboard')) return 'simcar-clip';
  return 'simcar-clip';
}

export function getPathForView(view: DashboardView): string {
  return DASHBOARD_VIEW_TO_PATH[view] || '/dashboard/simcar';
}
