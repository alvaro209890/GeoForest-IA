import React, { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

const SimcarPage = lazy(() => import('./dashboard/SimcarPage'));
const RecibosPage = lazy(() => import('./dashboard/RecibosPage'));
const CbersPage = lazy(() => import('./dashboard/CbersPage'));
const LandsatPage = lazy(() => import('./dashboard/LandsatPage'));
const ErrosPage = lazy(() => import('./dashboard/ErrosPage'));
const ConfiguracoesPage = lazy(() => import('./dashboard/ConfiguracoesPage'));
const ManualPage = lazy(() => import('./dashboard/ManualPage'));
const ChatPage = lazy(() => import('./dashboard/ChatPage'));
const ProjectDetailPage = lazy(() => import('./dashboard/ProjectDetailPage'));

export const DashboardRouter: React.FC = () => {
  return (
    <DashboardLayout>
      <Suspense fallback={<div className="p-8 text-text-secondary">Carregando...</div>}>
        <Switch>
          <Route path="/dashboard/simcar">{() => <SimcarPage />}</Route>
          <Route path="/dashboard/recibos">{() => <RecibosPage />}</Route>
          <Route path="/dashboard/cbers">{() => <CbersPage />}</Route>
          <Route path="/dashboard/landsat">{() => <LandsatPage />}</Route>
          <Route path="/dashboard/erros">{() => <ErrosPage />}</Route>
          <Route path="/dashboard/configuracoes">{() => <ConfiguracoesPage />}</Route>
          <Route path="/dashboard/manual">{() => <ManualPage />}</Route>
          <Route path="/dashboard/chat">{() => <ChatPage />}</Route>
          <Route path="/dashboard/project/:id">{params => <ProjectDetailPage id={params.id} />}</Route>
          {/* Default Route */}
          <Route>{() => <SimcarPage />}</Route>
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
};

export default DashboardRouter;
