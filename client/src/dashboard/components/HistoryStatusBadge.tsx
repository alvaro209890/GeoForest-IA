/**
 * Badge de status reutilizável dos cards de histórico do Dashboard.
 * Plano 03, passo 10 — extraído do padrão repetido 8x em Dashboard.tsx.
 */

export type HistoryStatus = 'processing' | 'completed' | 'cancelled' | 'failed' | 'uploaded' | 'deleted' | 'queued';

const STATUS_COLOR: Record<string, string> = {
  processing: 'text-amber-300',
  completed: 'text-emerald-300',
  cancelled: 'text-orange-300',
  failed: 'text-red-300',
  uploaded: 'text-sky-300',
  deleted: 'text-slate-500',
  queued: 'text-slate-400',
};

const STATUS_LABEL: Record<string, string> = {
  processing: 'Processando',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  failed: 'Falhou',
  uploaded: 'Enviado',
  deleted: 'Removido',
  queued: 'Na fila',
};

export function HistoryStatusBadge({ status }: { status?: HistoryStatus | string | null }) {
  if (!status) return null;
  const normalized = String(status).toLowerCase();
  const className = STATUS_COLOR[normalized] || 'text-red-300';
  const label = STATUS_LABEL[normalized] || 'Falhou';
  return (
    <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${className}`}>
      {label}
    </p>
  );
}
