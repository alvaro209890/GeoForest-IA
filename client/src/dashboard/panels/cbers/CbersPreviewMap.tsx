/**
 * Modal de pré-visualização da cena CBERS selecionada.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
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
  cbersSceneZipFilename,
  cbersSceneZipPath,
} from '@/dashboard/cbers/filenames';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersPanelProps } from '../CbersPanel';

export function CbersPreviewMap({ cbers }: CbersPanelProps) {
  const {
    setCbersSelectedSceneId,
    cbersSelectedSceneIds,
    setCbersSelectedSceneIds,
    cbersPreviewScene,
    setCbersPreviewScene,
    cbersPropertyGeometry,
    cbersEstimating,
    cbersProcessing,
    cbersWmsDownloadingId,
    toggleCbersSceneSelection,
    startCbersProcessing,
  } = cbers;

  return (
    <>
      {cbersPreviewScene && (() => {
        const previewDate = cbersPreviewScene.datetime
          ? new Date(cbersPreviewScene.datetime).toLocaleString('pt-BR')
          : 'Sem data';
        const selected = cbersSelectedSceneIds.includes(cbersPreviewScene.id);
        const availableOnWms = cbersPreviewScene.wmsAvailable && cbersPreviewScene.wmsUrl;
        const blocked = cbersPreviewScene.coversArea === false || Boolean(availableOnWms) || Boolean(cbersPreviewScene.level && cbersPreviewScene.level !== 'L4');
        const estimate = cbersPreviewScene.estimate;
        const zipHref = resolveBackendUrl(cbersSceneZipPath(cbersPreviewScene));
        return createPortal(
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Pré-visualização da cena CBERS"
            onClick={() => setCbersPreviewScene(null)}
          >
            <div
              className="w-full max-w-5xl max-h-[94vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#071113] shadow-2xl custom-scrollbar"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Pré-visualização da cena</p>
                  <h3 className="truncate text-base font-semibold text-white">{cbersPreviewScene.id}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCbersPreviewScene(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-0">
                <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(7,17,19,0.98))] p-3 sm:p-4">
                  {cbersPreviewScene.thumbnailUrl ? (
                    <>
                      <img
                        src={cbersPreviewScene.thumbnailUrl}
                        alt={cbersPreviewScene.id}
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
                    propertyGeometry={cbersPropertyGeometry}
                    sceneGeometry={cbersPreviewScene.geometry || null}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Data</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{previewDate}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Nuvem</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {cbersPreviewScene.cloudCover === null ? 'n/d' : `${cbersPreviewScene.cloudCover.toFixed(1)}%`}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Bandas</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">3, 4, 2 + PAN</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Nível</p>
                      <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'text-red-200' : 'text-emerald-200'}`}>
                        {cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'Legado' : 'L4'}
                      </p>
                    </div>
                    <div className={`rounded-xl border p-3 ${cbersPreviewScene.coversArea === false ? 'border-red-500/20 bg-red-500/10' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-cyan-500/20 bg-cyan-500/10'}`}>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400">Cobertura</p>
                      <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.coversArea === false ? 'text-red-200' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'text-emerald-200' : 'text-cyan-200'}`}>
                        {typeof cbersPreviewScene.coveragePercent === 'number' ? `${cbersPreviewScene.coveragePercent.toFixed(2)}%` : 'Folha completa'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Estimativa</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {estimate ? `${estimate.downloadMb.toFixed(1)} MB` : cbersEstimating ? 'Calculando...' : 'Pendente'}
                      </p>
                    </div>
                  </div>
                  {estimate && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Download</p>
                        <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.downloadMb.toFixed(1)} MB</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">GeoTIFF</p>
                        <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.outputMbEstimated.toFixed(1)} MB</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Tempo</p>
                        <p className="mt-1 text-sm font-semibold text-cyan-100">{Math.ceil(estimate.timeSecondsEstimated / 60)} min</p>
                      </div>
                    </div>
                  )}
                  {cbersPreviewScene.alignmentStatus === 'failed_private' && (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <p className="font-semibold">Imagem com aviso de deslocamento</p>
                      <p className="mt-1 text-xs text-amber-100/80">
                        {cbersPreviewScene.alignmentWarning || 'Esta imagem fica disponível apenas para download do usuário e não é publicada no WMS.'}
                      </p>
                    </div>
                  )}
                  {availableOnWms && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                        <div className="min-w-0">
                          <p className="font-semibold">Esta folha já está disponível no WMS.</p>
                          <p className="mt-1 text-xs text-emerald-200/80">
                            A mesma órbita/ponto já foi publicada no acervo local, inclusive quando ela foi gerada por outra conta. Use a imagem existente em vez de gerar novamente.
                          </p>
                          <a
                            href={cbersPreviewScene.wmsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-cyan-100 hover:text-white"
                          >
                            <ArrowUpRight size={13} />
                            <span className="truncate">{cbersPreviewScene.wmsLayerName || cbersPreviewScene.wmsUrl}</span>
                          </a>
                          {zipHref ? (
                            <a
                              href={zipHref}
                              download={cbersSceneZipFilename(cbersPreviewScene)}
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-50 transition-colors hover:bg-emerald-400/15"
                            >
                              {cbersWmsDownloadingId === cbersPreviewScene.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                              Baixar ZIP da imagem
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                  {cbersPreviewScene.coversArea === false && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                      Esta cena não cobre 100% do imóvel e está bloqueada para evitar GeoTIFF incompleto.
                    </div>
                  )}
                  {cbersPreviewScene.bbox && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">BBox</p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-300">
                        {cbersPreviewScene.bbox.map((value) => value.toFixed(5)).join(', ')}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        toggleCbersSceneSelection(cbersPreviewScene);
                        setCbersPreviewScene(null);
                      }}
                      disabled={blocked}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                      {selected ? 'Remover seleção' : 'Selecionar cena'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (availableOnWms) return;
                        setCbersSelectedSceneId(cbersPreviewScene.id);
                        if (!cbersSelectedSceneIds.includes(cbersPreviewScene.id)) {
                          setCbersSelectedSceneIds((prev) => [...prev, cbersPreviewScene.id]);
                        }
                        setCbersPreviewScene(null);
                        void startCbersProcessing(cbersPreviewScene.id);
                      }}
                      disabled={cbersProcessing || blocked}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <Cpu size={17} />
                      Gerar esta imagem
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
