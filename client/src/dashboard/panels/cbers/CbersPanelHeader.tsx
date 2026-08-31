/**
 * Cabeçalho do painel CBERS-4A WPM.
 */
import React from 'react';
import { Satellite } from 'lucide-react';
import type { CbersPanelProps } from '../CbersPanel';

export function CbersPanelHeader(_props: CbersPanelProps) {
  return (
    <section className="rounded-2xl border border-cyan-500/15 bg-[#071113]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
            <Satellite size={13} />
            CBERS-4A WPM
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">GeoTIFF 3-4-2 com pancromática</h2>
          <p className="max-w-3xl text-sm text-slate-400">
            Busque por ZIP/SHP ou por órbita, ponto e data, escolha uma cena L4 pública do STAC INPE e gere a folha completa em .tif para ArcMap.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Fonte', value: 'INPE STAC' },
            { label: 'Coleção', value: 'L4-DN' },
            { label: 'Saída', value: 'GeoTIFF' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
              <p className="mt-1 text-xs font-semibold text-cyan-100">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
