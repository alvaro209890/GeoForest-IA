import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Leaf, Loader2, X } from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { downloadSimcarReportDocx } from '@/dashboard/lib/download-actions';
import { readSseEvents } from '@/dashboard/lib/analysis-helpers';
import type { SimcarClipHistoryItem } from '@/dashboard/types/history';

export type NdviPanelProps = {
  /** Recortes SIMCAR do usuário (histórico carregado pelo Dashboard). */
  clips: SimcarClipHistoryItem[];
  /** jobId do recorte selecionado (estado controlado pelo Dashboard para sincronizar com o histórico lateral). */
  selectedJobId: string | null;
  /** Callback ao selecionar um recorte. */
  onSelectJob: (jobId: string | null) => void;
  /** Navega para a aba SIMCAR (usado no empty state). */
  onGoSimcar: () => void;
};

type NdviResult = {
  ndviJobId?: string;
  propertyStat?: {
    mean?: number;
    validPct?: number;
    classeLabel?: string | null;
    aviso?: string | null;
  } | null;
  reportDocxUrl?: string;
  reportDocxFilename?: string;
  raster?: { wmsPublicUrl?: string; ndviLayerName?: string };
  scene?: { acquiredAt?: string; platformLabel?: string };
};

type NdviApiState = {
  enabled: boolean;
  status: string;
  ndviJobId: string | null;
  result: NdviResult | null;
  error: string | null;
};

function defaultNdviYear(): number {
  const now = new Date();
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function clipStatusClass(status?: SimcarClipHistoryItem['status']): string {
  switch (status) {
    case 'processing':
      return 'bg-amber-500/10 text-amber-300';
    case 'failed':
      return 'bg-red-500/10 text-red-300';
    case 'cancelled':
      return 'bg-white/5 text-slate-400';
    default:
      return 'bg-emerald-500/10 text-emerald-300';
  }
}

function formatSceneDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

export function NdviPanel({ clips, selectedJobId, onSelectJob, onGoSimcar }: NdviPanelProps) {
  const jobId = selectedJobId;
  const [ndvi, setNdvi] = useState<NdviApiState>({
    enabled: false,
    status: 'idle',
    ndviJobId: null,
    result: null,
    error: null,
  });
  const [ndviYear, setNdviYear] = useState(defaultNdviYear);
  const [ndviProgress, setNdviProgress] = useState<{ percent: number; message: string } | null>(null);
  const ndviAbortRef = useRef<AbortController | null>(null);
  const ndviConnectedJobRef = useRef<string | null>(null);

  const loadNdvi = useCallback(async () => {
    if (!jobId) return;
    try {
      const response = await apiFetch(`/api/simcar/clip/ndvi/${encodeURIComponent(jobId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      setNdvi({
        enabled: body?.enabled === true,
        status: String(body?.status || 'idle'),
        ndviJobId: body?.ndviJobId ? String(body.ndviJobId) : null,
        result: body?.ndvi || null,
        error: body?.error ? String(body.error) : null,
      });
    } catch (err) {
      setNdvi((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [jobId]);

  const connectNdviProgress = useCallback(
    async (ndviJobId: string) => {
      if (!jobId || !ndviJobId || ndviConnectedJobRef.current === ndviJobId) return;
      ndviConnectedJobRef.current = ndviJobId;
      const controller = new AbortController();
      ndviAbortRef.current = controller;
      try {
        const response = await apiFetch(
          `/api/simcar/clip/ndvi/${encodeURIComponent(jobId)}/events?ndviJobId=${encodeURIComponent(ndviJobId)}`,
          { signal: controller.signal },
        );
        if (!response.ok || !response.body) throw new Error(`Falha ao acompanhar NDVI (HTTP ${response.status}).`);
        await readSseEvents(response.body.getReader(), (event) => {
          if (event.percent !== undefined || event.message) {
            setNdviProgress({
              percent: Math.max(0, Math.min(100, Number(event.percent) || 0)),
              message: String(event.message || event.stage || 'Processando NDVI...'),
            });
          }
          const status = String(event.status || 'running');
          setNdvi((prev) => ({
            ...prev,
            status,
            error: event.error ? String(event.error) : prev.error,
          }));
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            void loadNdvi();
          }
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setNdvi((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        if (ndviAbortRef.current === controller) ndviAbortRef.current = null;
        ndviConnectedJobRef.current = null;
        setNdviProgress(null);
        void loadNdvi();
      }
    },
    [jobId, loadNdvi],
  );

  const runNdvi = useCallback(async () => {
    if (!jobId) return;
    setNdvi((prev) => ({ ...prev, status: 'running', error: null }));
    setNdviProgress({ percent: 0, message: 'Iniciando cálculo NDVI...' });
    try {
      const response = await apiFetch('/api/simcar/clip/analyze-ndvi', {
        method: 'POST',
        body: JSON.stringify({ jobId, ano: ndviYear }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      const ndviJobId = String(body?.ndviJobId || '');
      if (!ndviJobId) throw new Error('Servidor iniciou o NDVI sem identificador do job.');
      setNdvi((prev) => ({ ...prev, status: 'running', ndviJobId }));
      await connectNdviProgress(ndviJobId);
    } catch (err) {
      setNdvi((prev) => ({
        ...prev,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      setNdviProgress(null);
    }
  }, [connectNdviProgress, jobId, ndviYear]);

  const cancelNdvi = useCallback(async () => {
    if (!ndvi.ndviJobId) return;
    await apiFetch(`/api/simcar/clip/ndvi/${encodeURIComponent(ndvi.ndviJobId)}`, { method: 'DELETE' });
    setNdviProgress((prev) => ({ percent: prev?.percent || 0, message: 'Cancelamento solicitado...' }));
  }, [ndvi.ndviJobId]);

  // Ao trocar de recorte: aborta o SSE anterior, reseta progresso e recarrega o estado.
  useEffect(() => {
    ndviAbortRef.current?.abort();
    ndviAbortRef.current = null;
    setNdviProgress(null);
    void loadNdvi();
    return () => ndviAbortRef.current?.abort();
  }, [loadNdvi]);

  // Reconecta o SSE caso o job já esteja rodando (ex.: recarregou a página ou voltou ao painel).
  useEffect(() => {
    if (ndvi.status === 'running' && ndvi.ndviJobId) {
      void connectNdviProgress(ndvi.ndviJobId);
    }
  }, [connectNdviProgress, ndvi.ndviJobId, ndvi.status]);

  const running = ndvi.status === 'running';
  const completed = ndvi.status === 'completed' && !!ndvi.result;
  const selectedClip = clips.find((clip) => clip.jobId === selectedJobId);
  const mean = ndvi.result?.propertyStat?.mean;
  const validPct = ndvi.result?.propertyStat?.validPct;
  const resultLine = completed && Number.isFinite(mean) && Number.isFinite(validPct)
    ? `NDVI médio ${Number(mean).toFixed(3)} · pixels válidos ${(Number(validPct) * 100).toFixed(1)}%${ndvi.result?.propertyStat?.classeLabel ? ` · ${ndvi.result.propertyStat.classeLabel}` : ''}`
    : completed
      ? 'NDVI concluído — consulte o laudo para as limitações da medição.'
      : null;
  const actionLabel = running
    ? 'Calculando…'
    : completed
      ? 'Recalcular'
      : ndvi.status === 'failed'
        ? 'Tentar novamente'
        : 'Calcular NDVI';

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-4">
        {clips.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0c1018]/70 p-8 sm:p-10 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lime-500/10 text-lime-300">
              <Leaf size={22} />
            </div>
            <h2 className="text-lg font-semibold text-white">Nenhum recorte SIMCAR disponível</h2>
            <p className="mx-auto max-w-md text-sm text-slate-400">
              O NDVI é calculado sobre recortes SIMCAR do seu imóvel. Crie um recorte primeiro para habilitar esta análise.
            </p>
            <button
              type="button"
              onClick={onGoSimcar}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-lime-500/20 to-emerald-500/10 border border-lime-500/25 px-4 py-2 text-xs font-medium text-emerald-50 transition-all duration-300 hover:from-lime-500/30 hover:to-emerald-500/20"
            >
              Ir para Recorte SIMCAR
            </button>
          </div>
        ) : !selectedJobId ? (
          <div className="space-y-3">
            <header className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Índice de Vegetação (NDVI)
              </p>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Selecione um recorte</h2>
              <p className="text-sm text-slate-400">O NDVI é calculado sobre a área de um recorte SIMCAR.</p>
            </header>
            <div className="space-y-2">
              {clips.map((clip) => (
                <button
                  key={clip.jobId}
                  type="button"
                  onClick={() => onSelectJob(clip.jobId)}
                  className="w-full rounded-xl border border-white/10 bg-[#0c1018]/70 p-3 sm:p-4 text-left transition-colors hover:border-white/25 hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium text-white">{clip.filename}</p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(clip.timestamp).toLocaleDateString('pt-BR')}
                        {typeof clip.propertyAreaHa === 'number' && Number.isFinite(clip.propertyAreaHa)
                          ? ` · ${clip.propertyAreaHa.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ha`
                          : ''}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${clipStatusClass(clip.status)}`}>
                        {clip.status ?? 'completed'}
                      </span>
                      <ChevronRight size={14} className="text-slate-600" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Índice de Vegetação (NDVI)
                </p>
                <h2 className="truncate text-base sm:text-lg font-semibold text-white">
                  {selectedClip?.filename ?? 'Recorte selecionado'}
                </h2>
                {selectedClip ? (
                  <p className="text-xs text-slate-500">
                    {new Date(selectedClip.timestamp).toLocaleDateString('pt-BR')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onSelectJob(null)}
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                trocar
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0c1018]/70 p-4 sm:p-5 space-y-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-medium text-white">Índice de Vegetação (NDVI)</h3>
                <p className="text-[11px] text-slate-500">
                  Landsat C2 L2 · reflectância de superfície · estatística por polígono
                </p>
              </div>

              {!ndvi.enabled && !running ? (
                <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  <AlertTriangle size={12} className="shrink-0" />
                  NDVI ainda não está habilitado neste ambiente.
                </p>
              ) : null}

              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Ano da cena
                <select
                  value={ndviYear}
                  onChange={(event) => setNdviYear(Number(event.target.value))}
                  disabled={running}
                  className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-slate-200 disabled:opacity-50"
                >
                  {Array.from({ length: defaultNdviYear() - 1983 }, (_, index) => defaultNdviYear() - index).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void runNdvi()}
                disabled={!ndvi.enabled || running}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-300 ${
                  !ndvi.enabled || running
                    ? 'bg-white/5 text-slate-500 border border-white/5 cursor-not-allowed'
                    : 'bg-gradient-to-r from-lime-500/20 to-emerald-500/10 border border-lime-500/25 text-emerald-50 hover:from-lime-500/30 hover:to-emerald-500/20'
                }`}
              >
                {running ? <Loader2 size={13} className="animate-spin" /> : null}
                {actionLabel}
              </button>

              {running && ndviProgress ? (
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, ndviProgress.percent))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-500 truncate">{ndviProgress.message}</p>
                    <button
                      type="button"
                      onClick={() => void cancelNdvi()}
                      title="Cancelar cálculo NDVI"
                      className="shrink-0 flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                    >
                      <X size={10} />
                      cancelar
                    </button>
                  </div>
                </div>
              ) : null}

              {ndvi.error && !running ? (
                <p className="text-[11px] text-red-300">{ndvi.error}</p>
              ) : null}

              {completed ? (
                <div className="space-y-1.5">
                  {resultLine ? <p className="text-[11px] text-emerald-200">{resultLine}</p> : null}
                  {ndvi.result?.scene?.acquiredAt ? (
                    <p className="text-[11px] text-slate-400">Cena: {formatSceneDate(ndvi.result.scene.acquiredAt)}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {ndvi.result?.reportDocxUrl ? (
                      <button
                        type="button"
                        onClick={() => downloadSimcarReportDocx(ndvi.result?.reportDocxUrl, ndvi.result?.reportDocxFilename)}
                        className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] text-emerald-200 transition-colors hover:bg-emerald-500/20"
                      >
                        Baixar laudo NDVI (Word)
                      </button>
                    ) : null}
                    {ndvi.result?.raster?.wmsPublicUrl ? (
                      <button
                        type="button"
                        onClick={() => window.open(ndvi.result?.raster?.wmsPublicUrl, '_blank', 'noopener,noreferrer')}
                        className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        Abrir WMS · {ndvi.result.raster.ndviLayerName || 'camada NDVI'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default NdviPanel;
