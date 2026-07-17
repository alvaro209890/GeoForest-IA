import React, { lazy, useEffect } from 'react';
import { useLocation } from 'wouter';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import Dashboard from './Dashboard';

// Páginas standalone (não usam o componente Dashboard)
const ChatPage = lazy(() => import('./dashboard/ChatPage'));
const ProjectDetailPage = lazy(() => import('./dashboard/ProjectDetailPage'));
const ConfiguracoesPage = lazy(() => import('./dashboard/ConfiguracoesPage'));

type DashboardView = 'simcar-clip' | 'simcar-receipts' | 'cbers-wpm' | 'landsat' | 'vertices-proximas' | 'features' | 'settings';

const VIEW_MAP: Record<string, DashboardView> = {
  '/dashboard/simcar': 'simcar-clip',
  '/dashboard/recibos': 'simcar-receipts',
  '/dashboard/cbers': 'cbers-wpm',
  '/dashboard/landsat': 'landsat',
  '/dashboard/erros': 'vertices-proximas',
  '/dashboard/manual': 'features',
  '/dashboard/configuracoes': 'settings',
};

function getViewFromPath(path: string): DashboardView {
  for (const [route, view] of Object.entries(VIEW_MAP)) {
    if (path.startsWith(route)) return view;
  }
  return 'simcar-clip';
}

export const DashboardRouter: React.FC = () => {
  const [wouterLoc] = useLocation();
  const path = typeof window !== 'undefined' ? window.location.pathname : wouterLoc;
  const view = getViewFromPath(path);

  useEffect(() => {
    console.log('[DashboardRouter] path:', path, '→ view:', view);
  }, [path, view]);

  // Chat: página standalone
  if (path.startsWith('/dashboard/chat')) {
    return (
      <DashboardLayout>
        <React.Suspense fallback={<div className="p-8 text-text-secondary">Carregando...</div>}>
          <ChatPage />
        </React.Suspense>
      </DashboardLayout>
    );
  }

  // Project detail: página standalone
  if (path.startsWith('/dashboard/project/')) {
    const id = path.split('/').pop() || '';
    return (
      <DashboardLayout>
        <React.Suspense fallback={<div className="p-8 text-text-secondary">Carregando...</div>}>
          <ProjectDetailPage id={id} />
        </React.Suspense>
      </DashboardLayout>
    );
  }

  // Dashboard principal: SEM Suspense wrapper para evitar que lazy imports
  // internos do Dashboard capturem o fallback deste router.
  //
  // NÃO usar DashboardLayout/Sidebar de navegação aqui nem hideSidebar:
  // o próprio Dashboard já tem a sidebar com abas + cards de histórico
  // (recortes SIMCAR, CBERS, Landsat, erros, processar, recibos).
  // hideSidebar={true} escondia 100% dos cards salvos (regressão do redesign Pencil).
  return <Dashboard key={view} initialView={view} />;
};

export default DashboardRouter;
