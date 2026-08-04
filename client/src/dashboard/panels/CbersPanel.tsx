/**
 * Painel CBERS-4A WPM — container.
 *
 * NOTA (Plano 07, 03/08/2026): as 927 linhas originais foram divididas em
 * `panels/cbers/` (cabeçalho, seletor de cenas, coluna de jobs e preview).
 */
import React from 'react';
import type { UseCbersJobsReturn } from '@/dashboard/hooks/useCbersJobs';
import { CbersPanelHeader } from './cbers/CbersPanelHeader';
import { CbersSceneSelector } from './cbers/CbersSceneSelector';
import { CbersJobList } from './cbers/CbersJobList';
import { CbersPreviewMap } from './cbers/CbersPreviewMap';

export type CbersPanelProps = {
  cbers: UseCbersJobsReturn;
};

export default function CbersPanel({ cbers }: CbersPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <CbersPanelHeader cbers={cbers} />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <CbersSceneSelector cbers={cbers} />
          <CbersJobList cbers={cbers} />
        </div>
        <CbersPreviewMap cbers={cbers} />
      </div>
    </div>
  );
}
