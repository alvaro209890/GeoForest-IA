/**
 * Cabeçalho do painel NDVI — badge, título, subtítulo e stats (Fonte/Composições/Saída).
 */
import React from 'react';
import { Layers, Leaf, Satellite } from 'lucide-react';
import { NDVI_COMPOSITION_META } from '@/dashboard/ndvi/types';
import type { NdviPanelProps } from './NdviPanel';

export function NdviPanelHeader({ ndvi }: NdviPanelProps) {
  const compositions = ndvi.ndviCompositions;
  return (
    <section className="rounded-2xl border border-lime-500/15 bg-[#0a1208]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-lime-500/20 bg-lime-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-lime-200">
            <Satellite size={13} />
            NDVI · Landsat C2 L2
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Cena completa com composições</h2>
          <p className="max-w-3xl text-sm text-slate-400">
            Importe um polígono (ZIP/SHP), Nº do CAR estadual ou órbita/ponto, busque cenas Landsat C2 L2 e gere a cena
            completa com NDVI, NDFI, RGB e SWIR para ArcMap.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Fonte</p>
            <p className="mt-1 text-xs font-semibold text-lime-100">Landsat C2 L2</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Composições</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-lime-100">
              <Layers size={12} className="text-lime-300" />
              {compositions.length === 0 ? '—' : compositions.map((key) => NDVI_COMPOSITION_META[key].label).join(' + ')}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Saída</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-lime-100">
              <Leaf size={12} className="text-lime-300" />
              ZIP / WMS
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
