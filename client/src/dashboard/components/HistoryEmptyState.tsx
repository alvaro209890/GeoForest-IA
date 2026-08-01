/**
 * Empty state reutilizável dos cards de histórico do Dashboard.
 * Plano 03, passo 10 — extraído do padrão repetido 11x em Dashboard.tsx.
 */
import type { LucideIcon } from 'lucide-react';

export function HistoryEmptyState({
  Icon,
  title,
  hint,
  iconClassName = 'text-slate-600',
}: {
  Icon: LucideIcon;
  title: string;
  hint?: string;
  iconClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon size={32} className={`${iconClassName} mb-3`} />
      <p className="text-sm text-slate-400">{title}</p>
      {hint && <p className="text-[10px] text-slate-600 mt-1">{hint}</p>}
    </div>
  );
}
