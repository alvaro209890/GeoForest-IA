import React from 'react';
import { useLocation } from 'wouter';
import Dashboard from './Dashboard';
import { getViewFromPath } from '@/dashboard/routes';

/**
 * Roteador fino do Dashboard.
 * - Lê a URL e passa initialView
 * - NÃO remonta o Dashboard ao trocar de aba (preserva jobs/estado)
 * - A sincronização URL ←→ view é feita via useDashboardNavigation no Dashboard
 */
export const DashboardRouter: React.FC = () => {
  const [wouterLoc] = useLocation();
  const path = typeof window !== 'undefined' ? window.location.pathname : wouterLoc;
  const view = getViewFromPath(path);

  return <Dashboard initialView={view} />;
};

export default DashboardRouter;
