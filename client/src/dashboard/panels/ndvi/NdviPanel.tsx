/**
 * Painel NDVI (Landsat Collection 2 Level-2) — container no padrão da aba CBERS.
 *
 * Fluxo: importar polígono (ZIP/SHP, CAR estadual ou órbita+ponto) → buscar cenas →
 * gerar cena completa com múltiplas composições (NDVI/NDFI/RGB/SWIR) → jobs com
 * progresso via SSE → histórico com download.
 */
import React from 'react';
import type { UseNdviJobsReturn } from '@/dashboard/hooks/useNdviJobs';
import { NdviPanelHeader } from './NdviPanelHeader';
import { NdviSceneSelector } from './NdviSceneSelector';
import { NdviJobList } from './NdviJobList';
import { NdviPreviewMap } from './NdviPreviewMap';

export type NdviPanelProps = {
  ndvi: UseNdviJobsReturn;
};

export default function NdviPanel({ ndvi }: NdviPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <NdviPanelHeader ndvi={ndvi} />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <NdviSceneSelector ndvi={ndvi} />
          <NdviJobList ndvi={ndvi} />
        </div>
        <NdviPreviewMap ndvi={ndvi} />
      </div>
    </div>
  );
}
