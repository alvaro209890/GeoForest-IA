import React, { lazy, Suspense } from 'react';
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

function getInitialView(path: string): DashboardView | null {
  for (const [route, view] of Object.entries(VIEW_MAP)) {
    if (path.startsWith(route)) return view;
  }
  return null;
}

export const DashboardRouter: React.FC = () => {
  const [location] = useLocation();

  return (
    <DashboardLayout>
      <Suspense fallback={<div className="p-8 text-text-secondary">Carregando...</div>}>
        {(() => {
          // Rotas standalone
          if (location.startsWith('/dashboard/chat')) {
            return <ChatPage />;
          }
          if (location.startsWith('/dashboard/project/')) {
            const id = location.split('/').pop() || '';
            return <ProjectDetailPage id={id} />;
          }

          const view = getInitialView(location);
          if (view) {
            // key força remontagem completa ao trocar de view,
            // evitando que o React reuse a instância do Dashboard
            // e ignore a prop initialView
            return <Dashboard key={view} initialView={view} hideSidebar />;
          }

          // Fallback: SIMCAR
          return <Dashboard key="simcar-clip" initialView="simcar-clip" hideSidebar />;
        })()}
      </Suspense>
    </DashboardLayout>
  );
};

export default DashboardRouter;
