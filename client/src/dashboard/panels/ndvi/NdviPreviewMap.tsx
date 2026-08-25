/**
 * Modal de pré-visualização da cena NDVI selecionada (mapa com geometria/bbox).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  CheckSquare,
  Cpu,
  Download,
  Loader2,
  Satellite,
  Square,
  X,
} from 'lucide-react';
import { CbersMapPreview } from '@/dashboard/components/CbersMapPreview';
import {
  ndviSceneZipFilename,
  ndviSceneZipPath,
} from '@/dashboard/ndvi/filenames';
import { NDVI_COMPOSITION_META } from '@/dashboard/ndvi/types';
import { resolveBackendUrl } from '@/lib/api';
import type { NdviPanelProps } from './NdviPanel';

export function NdviPreviewMap({ ndvi }: NdviPanelProps) {
  const {
    setNdviSelectedSceneId,
    ndviSelectedSceneIds,
    setNdviSelectedSceneIds,
    ndviPreviewScene,
    setNdviPreviewScene,
    ndviPropertyGeometry,
    ndviCompositions,
    ndviProcessing,
    toggleNdviSceneSelection,
    startNdviJobs,
  } = ndvi;

  return (
    <>
      {ndviPreviewScene && (() => {
        const previewDate = ndviPreviewScene.datetime
          ? new Date(ndviPreviewScene.datetime).toLocaleString('pt-BR')
          : 'Sem data';
        const selected = ndviSelectedSceneIds.includes(ndviPreviewScene.id);
        const availableOnWms = ndviPreviewScene.wmsAvailable && ndviPreviewScene.wmsUrl;
        const blocked = ndviPreviewScene.coversArea === false || Boolean(availableOnWms);
        const zipHref = resolveBackendUrl(ndviSceneZipPath(ndviPreviewScene));
        return createPortal(
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Pré-visualização da cena NDVI"
            onClick={() => setNdviPreviewScene(null)}
          >
            <div
              className="w-full max-w-5xl max-h-[94vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#0a1208] shadow-2xl custom-scrollbar"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-lime-300">Pré-visualização da cena</p>
                  <h3 className="truncate text-base font-semibold text-white">{ndviPreviewScene.id}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setNdviPreviewScene(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-0">
                <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(132,204,22,0.12),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(10,18,8,0.98))] p-3 sm:p-4">
                  {ndviPreviewScene.thumbnailUrl ? (
                    <>
                      <img
                        src={ndviPreviewScene.thumbnailUrl}
                        alt={ndviPreviewScene.id}
                        className="max-h-[64vh] min-h-[220px] w-full rounded-xl border border-white/10 bg-black/30 object-contain shadow-2xl"
                      />
                      <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 backdrop-blur">
                        Miniatura completa
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-slate-600">
                      <Satellite size={44} />
                    </div>
                  )}
                </div>
                <div className="space-y-4 p-5">
                  <CbersMapPreview
                    propertyGeometry={ndviPropertyGeometry}
                    sceneGeometry={ndviPreviewScene.geometry || null}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Data</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{previewDate}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Nuvem</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {ndviPreviewScene.cloudCover === null ? 'n/d' : `${ndviPreviewScene.cloudCover.toFixed(1)}%`}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Órbita/Ponto</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {ndviPreviewScene.path || '—'}/{ndviPreviewScene.row || '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Plataforma</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {ndviPreviewScene.platformLabel || ndviPreviewScene.platform || 'Landsat'}
                      </p>
                    </div>
                    <div className={`rounded-xl border p-3 ${ndviPreviewScene.coversArea === false ? 'border-red-500/20 bg-red-500/10' : typeof ndviPreviewScene.coveragePercent === 'number' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-lime-500/20 bg-lime-500/10'}`}>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">Cobertura</p>
                      <p className={`mt-1 text-sm font-semibold ${ndviPreviewScene.coversArea === false ? 'text-red-200' : typeof ndviPreviewScene.coveragePercent === 'number' ? 'text-emerald-200' : 'text-lime-200'}`}>
                        {typeof ndviPreviewScene.coveragePercent === 'number' ? `${ndviPreviewScene.coveragePercent.toFixed(2)}%` : 'Folha completa'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">SLC-off</p>
                      <p className={`mt-1 text-sm font-semibold ${ndviPreviewScene.slcOff ? 'text-amber-200' : 'text-emerald-200'}`}>
                        {ndviPreviewScene.slcOff ? 'Sim (L7)' : 'Não'}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Composições da cena completa</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ndviCompositions.length === 0 ? (
                        <p className="text-xs text-slate-500">Nenhuma composição selecionada.</p>
                      ) : (
                        ndviCompositions.map((key) => (
                          <span
                            key={key}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold ${NDVI_COMPOSITION_META[key].badgeClass}`}
                          >
                            <span className={`inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-r ${NDVI_COMPOSITION_META[key].swatchClass}`} />
                            {NDVI_COMPOSITION_META[key].label}
                          </span>
                        ))
                      )}
                    </div>
                    {ndviCompositions.length > 0 && (
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                        {ndviCompositions.map((key) => NDVI_COMPOSITION_META[key].description).join(' ')}
                      </p>
                    )}
                  </div>
                  {availableOnWms && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                        <div className="min-w-0">
                          <p className="font-semibold">Esta cena já está disponível no acervo.</p>
                          <p className="mt-1 text-xs text-emerald-200/80">
                            A mesma cena já foi publicada no acervo local. Use a imagem existente em vez de gerar novamente.
                          </p>
                          <a
                            href={ndviPreviewScene.wmsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-lime-100 hover:text-white"
                          >
                            <span className="truncate">{ndviPreviewScene.wmsLayerName || ndviPreviewScene.wmsUrl}</span>
                          </a>
                          {zipHref ? (
                            <a
                              href={zipHref}
                              download={ndviSceneZipFilename(ndviPreviewScene)}
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-50 transition-colors hover:bg-emerald-400/15"
                            >
                              <Download size={14} />
                              Baixar ZIP da imagem
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                  {ndviPreviewScene.coversArea === false && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                      Esta cena não cobre 100% do imóvel e está bloqueada para evitar cena completa incompleta.
                    </div>
                  )}
                  {ndviPreviewScene.bbox && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">BBox</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-300">
                        {ndviPreviewScene.bbox.map((value) => value.toFixed(5)).join(', ')}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        toggleNdviSceneSelection(ndviPreviewScene);
                        setNdviPreviewScene(null);
                      }}
                      disabled={blocked}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-lime-700 px-4 py-3 text-sm font-semibold text-white hover:bg-lime-600 disabled:opacity-50"
                    >
                      {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                      {selected ? 'Remover seleção' : 'Selecionar cena'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (availableOnWms) return;
                        setNdviSelectedSceneId(ndviPreviewScene.id);
                        if (!ndviSelectedSceneIds.includes(ndviPreviewScene.id)) {
                          setNdviSelectedSceneIds((prev) => [...prev, ndviPreviewScene.id]);
                        }
                        setNdviPreviewScene(null);
                        void startNdviJobs(ndviPreviewScene.id);
                      }}
                      disabled={ndviProcessing || blocked || ndviCompositions.length === 0}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {ndviProcessing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
                      Gerar esta cena
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}
