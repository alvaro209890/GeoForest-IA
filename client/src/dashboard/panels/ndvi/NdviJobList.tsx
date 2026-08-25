/**
 * Coluna lateral do painel NDVI: progresso do job e histórico.
 */
import React from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  X,
} from 'lucide-react';
import {
  ndviArchiveZipFilename,
  ndviArchiveZipUrl,
  ndviBatchZipFilename,
  ndviBatchZipUrl,
} from '@/dashboard/ndvi/filenames';
import { NDVI_COMPOSITION_META } from '@/dashboard/ndvi/types';
import { resolveBackendUrl } from '@/lib/api';
import type { NdviHistoryItem } from '@/dashboard/ndvi/types';
import type { NdviPanelProps } from './NdviPanel';

const NDVI_STAGE_LABELS: Record<string, string> = {
  queued: 'Na fila',
  geometry: 'Lendo área',
  scene: 'Validando cena',
  search: 'Localizando cenas',
  download: 'Baixando bandas',
  ndvi: 'Calculando NDVI',
  ndfi: 'Calculando NDFI',
  rgb: 'Compondo RGB',
  swir: 'Compondo SWIR',
  composite: 'Gerando composições',
  vrt: 'Montando VRT',
  geotiff: 'Gerando GeoTIFF',
  save: 'Salvando arquivo',
  publish: 'Publicando WMS',
  zip: 'Compactando entrega',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

export function NdviJobList({ ndvi }: NdviPanelProps) {
  const {
    ndviProcessing,
    setNdviProcessing,
    ndviHistory,
    ndviJobId,
    ndviProgress,
    setNdviError,
    requestProcessCancel,
    cancelNdviJob,
    deleteNdviJob,
    downloadNdviBatchZip,
    selectNdviHistoryEntry,
  } = ndvi;

  return (
    <aside className="rounded-2xl border border-white/10 bg-[#07130a]/80 p-5 sm:p-6 space-y-5">
      {(() => {
        const activeNdvi = ndviJobId ? ndviHistory.find((item) => item.jobId === ndviJobId) : null;
        const pct = Math.max(0, Math.min(100, Math.round(Number(ndviProgress?.percent ?? activeNdvi?.percent ?? 0))));
        const done = activeNdvi?.status === 'completed';
        const failed = activeNdvi?.status === 'failed' || activeNdvi?.status === 'cancelled';
        const activeNdviZipUrl = ndviArchiveZipUrl(activeNdvi);
        const batchZipUrl = done ? ndviBatchZipUrl(activeNdvi) : '';

        let timeRemainingStr = '';
        if (!done && !failed && pct > 0 && pct < 100 && (activeNdvi?.status === 'processing' || ndviProcessing)) {
          const startedAtMs = new Date(activeNdvi?.createdAt || activeNdvi?.timestamp || Date.now()).getTime();
          const elapsedSeconds = Number.isFinite(startedAtMs)
            ? Math.max(0, (Date.now() - startedAtMs) / 1000)
            : 0;
          const secondsRemaining = elapsedSeconds > 0 ? Math.round((elapsedSeconds * (100 - pct)) / pct) : 0;
          if (secondsRemaining > 60) {
            timeRemainingStr = `~ ${Math.ceil(secondsRemaining / 60)} min restantes`;
          } else if (secondsRemaining > 0) {
            timeRemainingStr = `~ ${secondsRemaining} s restantes`;
          } else {
            timeRemainingStr = 'Concluindo...';
          }
        }

        const activeStage = String(ndviProgress?.stage || activeNdvi?.stage || '').toLowerCase();
        const stageLabel = NDVI_STAGE_LABELS[activeStage] || ndviProgress?.stage || activeNdvi?.stage || 'Aguardando';
        const progressMessage = ndviProgress?.message || activeNdvi?.message || 'Importe uma área e busque cenas para iniciar.';

        return (
          <>
            <div>
              <h3 className="text-base font-semibold text-white">Processamento</h3>
              <p className="mt-1 text-xs text-slate-500">{activeNdvi?.itemIds?.[0] || activeNdvi?.scenes?.[0]?.itemId || 'Nenhum job selecionado'}</p>
            </div>

            {activeNdvi ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs items-end">
                  <span className="font-medium text-slate-300">{stageLabel}</span>
                  <div className="flex flex-col items-end">
                    <span className="font-bold tabular-nums text-lime-300">{pct}%</span>
                    {timeRemainingStr && (
                      <span className="text-[10px] text-lime-200/70 font-medium">{timeRemainingStr}</span>
                    )}
                  </div>
                </div>
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                {Array.isArray(activeNdvi.compositions) && activeNdvi.compositions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeNdvi.compositions.map((key) => (
                      <span
                        key={key}
                        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${NDVI_COMPOSITION_META[key].badgeClass}`}
                      >
                        <span className={`inline-block h-2 w-2 rounded-full bg-gradient-to-r ${NDVI_COMPOSITION_META[key].swatchClass}`} />
                        {NDVI_COMPOSITION_META[key].label}
                      </span>
                    ))}
                  </div>
                )}
                <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin text-lime-300" />
                <span>Aguardando job NDVI.</span>
              </div>
            )}

            {ndviProcessing && activeNdvi && (
              <button
                type="button"
                onClick={async () => {
                  await requestProcessCancel(activeNdvi.jobId);
                  setNdviProcessing(false);
                  setNdviError('Cancelamento solicitado.');
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/15 transition-colors"
              >
                <X size={16} />
                Cancelar
              </button>
            )}

            {done && activeNdviZipUrl && resolveBackendUrl(activeNdviZipUrl) && (
              <a
                href={resolveBackendUrl(activeNdviZipUrl)}
                download={ndviArchiveZipFilename(activeNdvi)}
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-lime-700 px-4 py-3 text-sm font-semibold text-white hover:bg-lime-600 transition-colors"
              >
                <Download size={17} />
                Baixar cena em ZIP
              </a>
            )}

            {done && batchZipUrl && (
              <button
                type="button"
                onClick={() => void downloadNdviBatchZip(activeNdvi as NdviHistoryItem)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                <Download size={17} />
                Baixar lote em ZIP
              </button>
            )}

            {Array.isArray(activeNdvi?.scenes) && activeNdvi.scenes.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cenas do lote</p>
                {activeNdvi.scenes.map((sceneState) => (
                  <div key={sceneState.itemId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{sceneState.scene?.id || sceneState.itemId}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{sceneState.message || sceneState.stage || sceneState.status}</p>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase ${sceneState.status === 'completed' ? 'text-emerald-300' : sceneState.status === 'failed' ? 'text-red-300' : sceneState.status === 'cancelled' ? 'text-orange-300' : 'text-lime-300'}`}>
                        {sceneState.percent}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-lime-400" style={{ width: `${Math.max(0, Math.min(100, sceneState.percent))}%` }} />
                    </div>
                    {sceneState.status === 'completed' && ndviArchiveZipUrl(sceneState) && resolveBackendUrl(ndviArchiveZipUrl(sceneState)) && (
                      <a
                        href={resolveBackendUrl(ndviArchiveZipUrl(sceneState))}
                        download={ndviArchiveZipFilename(sceneState)}
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-lime-700 px-3 py-2 text-xs font-semibold text-white hover:bg-lime-600"
                      >
                        <Download size={14} />
                        Baixar cena em ZIP
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeNdvi?.outputBytes && (
              <p className="text-center text-[10px] text-slate-500">
                Arquivo final: {(activeNdvi.outputBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            {activeNdvi?.batchZipBytes && (
              <p className="text-center text-[10px] text-slate-500">
                ZIP do lote: {(activeNdvi.batchZipBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            )}

            <div className="border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">Histórico</h4>
                {ndviProcessing && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-lime-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime-400 animate-pulse" />
                    job ativo
                  </span>
                )}
              </div>
              {ndviHistory.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Nenhum job NDVI ainda. Busque cenas e gere a primeira cena completa.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {ndviHistory.map((entry) => {
                    const isActive = ndviJobId === entry.jobId;
                    return (
                      <div
                        key={entry.jobId}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectNdviHistoryEntry(entry)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          selectNdviHistoryEntry(entry);
                        }}
                        className={`rounded-xl border p-3 transition-all cursor-pointer ${isActive ? 'border-lime-500/30 bg-lime-500/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-lime-500/25 hover:bg-white/[0.04]'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">{entry.filename}</p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {entry.timestamp ? new Date(entry.timestamp).toLocaleString('pt-BR') : ''}
                              {entry.mode === 'batch' ? ' · lote' : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {entry.status === 'completed' ? (
                              <CheckCircle2 size={14} className="text-emerald-300" />
                            ) : (
                              <span className={`text-[10px] font-bold tabular-nums ${entry.status === 'processing' ? 'text-lime-300' : entry.status === 'failed' ? 'text-red-300' : entry.status === 'cancelled' ? 'text-orange-300' : 'text-emerald-300'}`}>
                                {entry.percent}%
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entry.status === 'processing') {
                                  void cancelNdviJob(entry);
                                } else {
                                  void deleteNdviJob(entry);
                                }
                              }}
                              title={entry.status === 'processing' ? 'Cancelar job' : 'Excluir do histórico'}
                              className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-red-300"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full rounded-full ${entry.status === 'failed' ? 'bg-red-400' : entry.status === 'cancelled' ? 'bg-orange-400' : 'bg-lime-400'}`} style={{ width: `${Math.max(0, Math.min(100, entry.percent))}%` }} />
                        </div>
                        {entry.status === 'completed' && entry.batchZipUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void downloadNdviBatchZip(entry);
                            }}
                            className="mt-2 inline-flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                          >
                            <Download size={11} />
                            {ndviBatchZipFilename(entry.jobId)}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        );
      })()}
    </aside>
  );
}
