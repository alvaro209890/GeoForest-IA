import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiFetch } from '@/lib/api';

import { FaseCard } from './FaseCard';
import {
  buildPhaseCards,
  isPhase1MetaCompleted,
  type PhaseId,
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

/**
 * Painel "Análise pós-recorte": os 3 botões encadeados que substituem o botão
 * solto de AUAS (`docs/planos/analise-pos-recorte/07-frontend-ux.md`).
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

  // Recarrega ao trocar de job e quando uma fase conclui (o gate das seguintes muda).
  useEffect(() => {
    void loadPhases();
  }, [loadPhases, phase1Done, phase2Done, phase3Done]);

  const cards = useMemo(
    () => buildPhaseCards(payload, { runningPhase, loading: loading && !payload, error }),
    [payload, runningPhase, loading, error],
  );

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
