import React from 'react';
import { useLocation } from 'wouter';
import Dashboard from './Dashboard';

/**
 * Roteador fino do padrão clássico do GeoForest.
 * Todo o shell (sidebar + abas + cards de histórico + conteúdo) vive no Dashboard.
 * O layout Pencil (DashboardLayout/Sidebar de navegação) foi descartado.
 */

type DashboardView =
  | 'simcar-clip'
  | 'simcar-receipts'
  | 'cbers-wpm'
  | 'landsat'
  | 'vertices-proximas'
  | 'auas-sccon'
  | 'features'
  | 'settings';

const VIEW_MAP: Record<string, DashboardView> = {
  '/dashboard': 'simcar-clip',
  '/dashboard/simcar': 'simcar-clip',
  '/dashboard/recibos': 'simcar-receipts',
  '/dashboard/cbers': 'cbers-wpm',
  '/dashboard/landsat': 'landsat',
  '/dashboard/erros': 'vertices-proximas',
  '/dashboard/auas': 'auas-sccon',
  '/dashboard/manual': 'features',
  '/dashboard/configuracoes': 'settings',
  '/dashboard/chat': 'simcar-clip',
};

function getViewFromPath(path: string): DashboardView {
  // match longest prefix first
  const entries = Object.entries(VIEW_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [route, view] of entries) {
    if (path === route || path.startsWith(route + '/')) return view;
  }
  if (path.startsWith('/dashboard')) return 'simcar-clip';
  return 'simcar-clip';
}

export const DashboardRouter: React.FC = () => {
  const [wouterLoc] = useLocation();
  const path = typeof window !== 'undefined' ? window.location.pathname : wouterLoc;
  const view = getViewFromPath(path);

  // key={view} força remount limpo ao trocar de rota/aba externa
  return <Dashboard key={view} initialView={view} />;
};

export default DashboardRouter;
