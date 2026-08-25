import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '@/lib/api';
import { downloadSimcarReportDocx } from '@/dashboard/lib/download-actions';
import { readSseEvents } from '@/dashboard/lib/analysis-helpers';

import { FaseCard } from './FaseCard';
import {
  buildPhaseCards,
  isPhase1MetaCompleted,
  type PhaseId,
  type PhaseCard,
  type PhasesResponse,
} from './phase-state';

export type AnalisePosRecortePanelProps = {
  jobId: string;
  contextUrl?: string;
  outputZipUrl?: string;
  /** Bloco V2 da Fase 1 conhecido pelo front (histórico ou resultado recém-chegado). */
  auasMeta?: unknown;
  /** Resultado da Fase 2 (datação 2009–2019). */
  auasPos2008Meta?: unknown;
  /** Resultado da Fase 3 (vegetação na AC). */
  acVegetacaoMeta?: unknown;
  /** Fase em execução nesta aba. */
  runningPhase?: PhaseId | null;
  progress?: { percent: number; message: string } | null;
  onRunPhase1: () => void;
  onRunPhase2?: () => void;
  onRunPhase3?: () => void;
  onCancelPhase2?: () => void;
  onCancelPhase3?: () => void;
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

/**
 * Painel "Análise pós-recorte": quatro análises independentes. As três análises
 * visuais e o NDVI nunca formam uma esteira automática.
 */
export function AnalisePosRecortePanel({
  jobId,
  contextUrl,
  outputZipUrl,
  auasMeta,
  auasPos2008Meta,
  acVegetacaoMeta,
  runningPhase = null,
  progress,
  onRunPhase1,
  onRunPhase2,
  onRunPhase3,
  onCancelPhase2,
  onCancelPhase3,
}: AnalisePosRecortePanelProps) {
  const [payload, setPayload] = useState<PhasesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
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

  const phase1Done = isPhase1MetaCompleted(auasMeta);
  const phase2Done = !!auasPos2008Meta;
  const phase3Done = !!acVegetacaoMeta;

  const loadPhases = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (contextUrl) query.set('contextUrl', contextUrl);
      if (outputZipUrl) query.set('outputZipUrl', outputZipUrl);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await apiFetch(`/api/simcar/clip/phases/${encodeURIComponent(jobId)}${suffix}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPayload((await response.json()) as PhasesResponse);
      setError(false);
    } catch {
      setPayload(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [jobId, contextUrl, outputZipUrl]);

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

  const connectNdviProgress = useCallback(async (ndviJobId: string) => {
    if (!ndviJobId || ndviConnectedJobRef.current === ndviJobId) return;
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
  }, [jobId, loadNdvi]);

  const runNdvi = useCallback(async () => {
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

  // Recarrega ao trocar de job e quando uma fase conclui (o gate das seguintes muda).
  useEffect(() => {
    void loadPhases();
  }, [loadPhases, phase1Done, phase2Done, phase3Done]);

  useEffect(() => {
    void loadNdvi();
    return () => ndviAbortRef.current?.abort();
  }, [loadNdvi]);

  useEffect(() => {
    if (ndvi.status === 'running' && ndvi.ndviJobId) {
      void connectNdviProgress(ndvi.ndviJobId);
    }
  }, [connectNdviProgress, ndvi.ndviJobId, ndvi.status]);

  const cards = useMemo(
    () => buildPhaseCards(payload, { runningPhase, loading: loading && !payload, error }),
    [payload, runningPhase, loading, error],
  );

  const ndviCard = useMemo<PhaseCard>(() => {
    const running = ndvi.status === 'running';
    const completed = ndvi.status === 'completed' && !!ndvi.result;
    const mean = ndvi.result?.propertyStat?.mean;
    const validPct = ndvi.result?.propertyStat?.validPct;
    const resultLine = completed && Number.isFinite(mean) && Number.isFinite(validPct)
      ? `NDVI médio ${Number(mean).toFixed(3)} · pixels válidos ${(Number(validPct) * 100).toFixed(1)}%${ndvi.result?.propertyStat?.classeLabel ? ` · ${ndvi.result.propertyStat.classeLabel}` : ''}`
      : completed
        ? 'NDVI concluído — consulte o laudo para as limitações da medição.'
        : null;
    return {
      id: 'NDVI',
      order: 4,
      title: 'Índice de Vegetação (NDVI)',
      question: 'Qual é o vigor da vegetação medido por reflectância de superfície?',
      state: running ? 'RUNNING' : completed ? 'COMPLETED' : ndvi.status === 'failed' ? 'FAILED' : ndvi.enabled ? 'AVAILABLE' : 'BLOCKED',
      preview: `Landsat C2 L2 · ano ${ndviYear} · estatística por polígono`,
      resultLine,
      blockedMessage: ndvi.enabled ? null : 'NDVI ainda não está habilitado neste ambiente.',
      actionLabel: running ? 'Calculando…' : completed ? 'Recalcular' : ndvi.status === 'failed' ? 'Tentar novamente' : 'Calcular NDVI',
      actionEnabled: ndvi.enabled && !running,
      notImplemented: !ndvi.enabled,
      stale: false,
      report: null,
    };
  }, [ndvi, ndviYear]);

  // O detalhamento por polígono da Fase 1 (SimcarAuasPre2008PanelV2) já é
  // renderizado no card de resultado do recorte; aqui fica só o resumo de estado.
  return (
    <section className="mx-4 rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Análise pós-recorte
        </p>
        <button
          type="button"
          onClick={() => void loadPhases()}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          atualizar
        </button>
      </div>

      <div className="space-y-2">
        {cards.map((card) => {
          const onRun =
            card.id === 'PRE_2008' ? onRunPhase1
              : card.id === 'POS_2008' ? onRunPhase2
              : onRunPhase3;
          const onCancel =
            card.id === 'POS_2008' ? onCancelPhase2
              : card.id === 'AC_VEG' ? onCancelPhase3
              : undefined;
          return (
            <FaseCard
              key={card.id}
              card={card}
              progress={card.id === runningPhase ? progress : null}
              onRun={onRun}
              onCancel={onCancel}
            >
              {card.id === 'POS_2008' && auasPos2008Meta ? (
                <PhaseResultDetail label="Datação 2009–2019" meta={auasPos2008Meta} />
              ) : null}
              {card.id === 'AC_VEG' && acVegetacaoMeta ? (
                <PhaseResultDetail label="Vegetação na AC" meta={acVegetacaoMeta} />
              ) : null}
            </FaseCard>
          );
        })}
        <FaseCard
          card={ndviCard}
          progress={ndviProgress}
          onRun={() => void runNdvi()}
          onCancel={() => void cancelNdvi()}
        >
          {!ndviProgress && ndvi.enabled ? (
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              Ano da cena
              <select
                value={ndviYear}
                onChange={(event) => setNdviYear(Number(event.target.value))}
                className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-slate-200"
              >
                {Array.from({ length: defaultNdviYear() - 1983 }, (_, index) => defaultNdviYear() - index).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
          ) : null}
          {ndvi.error && ndvi.status !== 'running' ? (
            <p className="text-[11px] text-red-300">{ndvi.error}</p>
          ) : null}
          {ndvi.result && ndvi.status === 'completed' ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {ndvi.result.reportDocxUrl ? (
                <button
                  type="button"
                  onClick={() => downloadSimcarReportDocx(ndvi.result?.reportDocxUrl, ndvi.result?.reportDocxFilename)}
                  className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200"
                >
                  Baixar laudo NDVI (Word)
                </button>
              ) : null}
              {ndvi.result.raster?.wmsPublicUrl ? (
                <button
                  type="button"
                  onClick={() => window.open(ndvi.result?.raster?.wmsPublicUrl, '_blank', 'noopener,noreferrer')}
                  className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200"
                >
                  Abrir WMS · {ndvi.result.raster.ndviLayerName || 'camada NDVI'}
                </button>
              ) : null}
            </div>
          ) : null}
        </FaseCard>
      </div>
    </section>
  );
}

function PhaseResultDetail({ label, meta }: { label: string; meta: unknown }) {
  const summary = (meta as Record<string, unknown>)?.summary as Record<string, number> | undefined;
  if (!summary || typeof summary !== 'object') return null;
  const lines = Object.entries(summary)
    .filter(([key, value]) => typeof value === 'number' && value > 0)
    .map(([key, value]) => ({ key, value }));
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {lines.map(({ key, value }) => (
          <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-400 truncate">{prettyFieldLabel(key)}</span>
            <span className="text-slate-200 font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  polygonCount: 'polígonos',
  totalAcAreaHa: 'área AC (ha)',
  declaredVegetationCount: 'vegetação declarada',
  declaredVegetationAreaHa: 'área declarada (ha)',
  apparentVegetationCount: 'vegetação aparente',
  cleanCount: 'áreas limpas',
  inconclusiveCount: 'inconclusivos',
  confirmedYearCount: 'anos confirmados',
  intervalCount: 'intervalos',
  alreadyAnthropizedCount: 'já em uso em 2009',
  noChangeCount: 'sem alteração',
  totalAuasAreaHa: 'área AUAS (ha)',
};

function prettyFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export default AnalisePosRecortePanel;
