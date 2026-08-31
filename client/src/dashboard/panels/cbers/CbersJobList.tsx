/**
 * Coluna lateral do painel CBERS: progresso do job e histórico.
 */
import React from 'react';
import {
  Download,
  X,
} from 'lucide-react';
import {
  cbersArchiveZipFilename,
  cbersArchiveZipUrl,
  cbersBatchZipFilename,
} from '@/dashboard/cbers/filenames';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersPanelProps } from '../CbersPanel';

export function CbersJobList({ cbers }: CbersPanelProps) {
  const {
    cbersProcessing,
    setCbersProcessing,
    cbersHistory,
    cbersJobId,
    cbersProgress,
    setCbersError,
    requestProcessCancel,
  } = cbers;

  return (
    <aside className="rounded-2xl border border-white/10 bg-[#071113]/80 p-5 sm:p-6 space-y-5">
      {(() => {
        const activeCbers = cbersJobId ? cbersHistory.find((item) => item.jobId === cbersJobId) : null;
        const pct = Math.max(0, Math.min(100, Math.round(Number(cbersProgress?.percent ?? activeCbers?.percent ?? 0))));
        const done = activeCbers?.status === 'completed';
        const activeCbersZipUrl = cbersArchiveZipUrl(activeCbers);
    
        let totalEstimatedSeconds = 0;
        if (activeCbers?.mode === 'batch' && Array.isArray(activeCbers?.scenes)) {
          totalEstimatedSeconds = activeCbers.scenes.reduce((acc, s) => acc + (s.estimate?.timeSecondsEstimated || 0), 0);
        } else if (activeCbers?.scene?.estimate?.timeSecondsEstimated) {
          totalEstimatedSeconds = activeCbers.scene.estimate.timeSecondsEstimated;
        } else if (activeCbers?.estimate?.timeSecondsEstimated) {
          totalEstimatedSeconds = activeCbers.estimate.timeSecondsEstimated;
        }
    
        let timeRemainingStr = '';
        if (!done && pct > 0 && pct < 100 && (activeCbers?.status === 'processing' || cbersProcessing)) {
          let secondsRemaining = 0;
          if (totalEstimatedSeconds > 0) {
            secondsRemaining = Math.max(0, Math.round(totalEstimatedSeconds * (100 - pct) / 100));
          } else if (activeCbers?.createdAt || activeCbers?.timestamp) {
            const startedAtMs = new Date(activeCbers.createdAt || activeCbers.timestamp).getTime();
            const elapsedSeconds = Number.isFinite(startedAtMs)
              ? Math.max(0, (Date.now() - startedAtMs) / 1000)
              : 0;
            secondsRemaining = elapsedSeconds > 0 ? Math.round((elapsedSeconds * (100 - pct)) / pct) : 0;
          }
          if (secondsRemaining > 60) {
            timeRemainingStr = `~ ${Math.ceil(secondsRemaining / 60)} min restantes`;
          } else if (secondsRemaining > 0) {
            timeRemainingStr = `~ ${secondsRemaining} s restantes`;
          } else {
            timeRemainingStr = 'Concluindo...';
          }
        }
    
        const activeStage = String(cbersProgress?.stage || activeCbers?.stage || '').toLowerCase();
        const stageLabelByKey: Record<string, string> = {
          queued: 'Na fila',
          geometry: 'Lendo área',
          scene: 'Validando cena',
          download: 'Baixando bandas',
          pansharpen: 'Fusionando folha completa',
          geotiff: 'Gerando GeoTIFF',
          alignment_check: 'Validando georreferenciamento',
          alignment_correction: 'Ajustando georreferenciamento',
          save: 'Salvando arquivo',
          publish: 'Publicando WMS',
          private_zip: 'Gerando ZIP privado',
          zip: 'Compactando entrega',
          completed: 'Concluído',
          failed: 'Falhou',
          cancelled: 'Cancelado',
        };
        const stageLabel = stageLabelByKey[activeStage] || cbersProgress?.stage || activeCbers?.stage || 'Aguardando';
        const heavyServerStage = ['pansharpen', 'geotiff', 'publish'].includes(activeStage) && !done;
        const progressMessage = cbersProgress?.message || activeCbers?.message || 'Envie uma área e busque cenas para iniciar.';
    
        return (
          <>
            <div>
              <h3 className="text-base font-semibold text-white">Processamento</h3>
              <p className="mt-1 text-xs text-slate-500">{activeCbers?.scene?.id || activeCbers?.itemId || 'Nenhum job selecionado'}</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs items-end">
                <span className="font-medium text-slate-300">{stageLabel}</span>
                <div className="flex flex-col items-end">
                  <span className="font-bold tabular-nums text-cyan-300">{pct}%</span>
                  {timeRemainingStr && (
                    <span className="text-[10px] text-cyan-200/70 font-medium">{timeRemainingStr}</span>
                  )}
                </div>
              </div>
              <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              {heavyServerStage && (
                <div className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-2.5 py-1.5 text-[10px] font-medium text-cyan-100/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
                  GDAL processando no servidor; nesta etapa o avanço pode ser estimado.
                </div>
              )}
              <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
            </div>
            {activeCbers?.alignmentStatus === 'failed_private' && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                <p className="font-semibold uppercase tracking-wider text-amber-200">Aviso de deslocamento</p>
                <p className="mt-1">{activeCbers.alignmentWarning || 'A correção automática não validou a imagem. O arquivo está disponível apenas para este usuário e não foi publicado no WMS.'}</p>
              </div>
            )}
            {cbersProcessing && cbersJobId && (
              <button
                type="button"
                onClick={async () => {
                  await requestProcessCancel(cbersJobId);
                  setCbersProcessing(false);
                  setCbersError('Cancelamento solicitado.');
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/15 transition-colors"
              >
                <X size={16} />
                Cancelar
              </button>
            )}
            {done && activeCbersZipUrl && resolveBackendUrl(activeCbersZipUrl) && (
              <a
                href={resolveBackendUrl(activeCbersZipUrl)}
                download={cbersArchiveZipFilename(activeCbers)}
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
              >
                <Download size={17} />
                Baixar cena em ZIP
              </a>
            )}
            {done && activeCbers?.batchZipUrl && resolveBackendUrl(activeCbers.batchZipUrl) && (
              <a
                href={resolveBackendUrl(activeCbers.batchZipUrl)}
                download={activeCbers.batchZipFilename || cbersBatchZipFilename(activeCbers.jobId)}
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                <Download size={17} />
                Baixar todos em ZIP
              </a>
            )}
            {Array.isArray(activeCbers?.scenes) && activeCbers.scenes.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cenas do lote</p>
                {activeCbers.scenes.map((sceneState) => (
                  <div key={sceneState.itemId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{sceneState.scene?.id || sceneState.itemId}</p>
                        {sceneState.level || sceneState.scene?.level ? (
                          <p className="mt-0.5 text-[10px] font-semibold text-cyan-200">{sceneState.level || sceneState.scene?.level}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-slate-500">{sceneState.message || sceneState.stage || sceneState.status}</p>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase ${sceneState.status === 'completed' ? 'text-emerald-300' : sceneState.status === 'failed' ? 'text-red-300' : sceneState.status === 'cancelled' ? 'text-orange-300' : 'text-cyan-300'}`}>
                        {sceneState.percent}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, sceneState.percent))}%` }} />
                    </div>
                    {sceneState.status === 'completed' && cbersArchiveZipUrl(sceneState) && resolveBackendUrl(cbersArchiveZipUrl(sceneState)) && (
                      <a
                        href={resolveBackendUrl(cbersArchiveZipUrl(sceneState))}
                        download={cbersArchiveZipFilename(sceneState)}
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                      >
                        <Download size={14} />
                        Baixar cena em ZIP
                      </a>
                    )}
                    {sceneState.alignmentStatus === 'failed_private' && (
                      <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[10px] text-amber-100">
                        {sceneState.alignmentWarning || 'Cena disponível apenas como ZIP privado; não publicada no WMS.'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {activeCbers?.outputBytes && (
              <p className="text-center text-[10px] text-slate-500">
                Arquivo final: {(activeCbers.outputBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            {activeCbers?.batchZipBytes && (
              <p className="text-center text-[10px] text-slate-500">
                ZIP do lote: {(activeCbers.batchZipBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </>
        );
      })()}
    </aside>
  );
}
