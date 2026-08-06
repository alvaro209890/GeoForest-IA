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
  /** Fase em execução nesta aba. */
  runningPhase?: PhaseId | null;
  progress?: { percent: number; message: string } | null;
  onRunPhase1: () => void;
};

/**
 * Painel "Análise pós-recorte": os 3 botões encadeados que substituem o botão
 * solto de AUAS (`docs/planos/analise-pos-recorte/07-frontend-ux.md`).
 *
 * Nesta versão só a Fase 1 está ligada — as fases 2 e 3 aparecem desde o início,
 * desabilitadas e com o motivo em texto, como manda o plano: nada surge do nada.
 */
export function AnalisePosRecortePanel({
  jobId,
  contextUrl,
  outputZipUrl,
  auasMeta,
  runningPhase = null,
  progress,
  onRunPhase1,
}: AnalisePosRecortePanelProps) {
  const [payload, setPayload] = useState<PhasesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const phase1Done = isPhase1MetaCompleted(auasMeta);

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

  // Recarrega ao trocar de job e quando a Fase 1 conclui (o gate das seguintes muda).
  useEffect(() => {
    void loadPhases();
  }, [loadPhases, phase1Done]);

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
        {cards.map((card) => (
          <FaseCard
            key={card.id}
            card={card}
            progress={card.id === runningPhase ? progress : null}
            onRun={card.id === 'PRE_2008' ? onRunPhase1 : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export default AnalisePosRecortePanel;
