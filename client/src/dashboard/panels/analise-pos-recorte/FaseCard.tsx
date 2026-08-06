import { Layers, Lock, Loader2, CheckCircle2 } from 'lucide-react';

import type { PhaseCard } from './phase-state';

type FaseCardProps = {
  card: PhaseCard;
  onRun?: () => void;
  /** Progresso da fase em execução (percentual + mensagem do SSE). */
  progress?: { percent: number; message: string } | null;
  children?: React.ReactNode;
};

/** Um card de fase: cabeçalho, prévia, estado e botão. Bloqueio sempre com motivo. */
export function FaseCard({ card, onRun, progress, children }: FaseCardProps) {
  const running = card.state === 'RUNNING';
  const completed = card.state === 'COMPLETED';
  const clickable = card.actionEnabled && !!onRun;

  return (
    <div className="rounded-xl border border-white/10 bg-[#0c1018]/70 p-4 space-y-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-[11px] font-semibold text-slate-200">
          {card.order}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{card.title}</p>
          <p className="text-[11px] text-slate-500">{card.question}</p>
        </div>
        <button
          type="button"
          onClick={clickable ? onRun : undefined}
          disabled={!clickable}
          aria-disabled={!clickable}
          title={card.blockedMessage || undefined}
          className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-300 flex items-center gap-1.5 ${
            clickable
              ? 'bg-gradient-to-r from-white/10 to-slate-500/20 hover:from-white/15 hover:to-slate-400/25 text-white border border-white/15'
              : 'bg-white/5 text-slate-500 border border-white/5 cursor-not-allowed'
          }`}
        >
          {running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : completed ? (
            <CheckCircle2 size={13} />
          ) : clickable ? (
            <Layers size={13} />
          ) : (
            <Lock size={13} />
          )}
          {card.actionLabel}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">{card.preview}</p>

      {card.resultLine && (
        <p className="text-[11px] text-emerald-200/90">{card.resultLine}</p>
      )}

      {card.stale && (
        <p className="text-[11px] text-amber-200/90">
          ⚠ Resultado de uma execução anterior — refaça a fase para atualizar.
        </p>
      )}

      {card.blockedMessage && !running && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Lock size={11} />
          {card.blockedMessage}
        </p>
      )}

      {running && progress && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-white/60 to-slate-300 transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500">{progress.message}</p>
        </div>
      )}

      {children}
    </div>
  );
}

export default FaseCard;
