import type { LucideIcon } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { HistoryStatusBadge } from './HistoryStatusBadge';

export type HistoryCardTheme = {
  /** Ícone da aba */
  Icon: LucideIcon;
  /** Card quando ativo (fundo + borda + sombra) */
  activeBg: string;
  /** Card quando inativo (fundo + hover + borda hover) */
  inactiveBg: string;
  /** Ícone quando ativo (gradiente + sombra) */
  iconActive: string;
  /** Ícone quando inativo */
  iconInactive: string;
  /** Título quando ativo */
  titleActive: string;
  /** Título quando inativo */
  titleInactive: string;
  /** Cor do percentual */
  percentText: string;
};

export type HistoryCardProps = {
  theme: HistoryCardTheme;
  active: boolean;
  title: string;
  percent: number;
  status?: string;
  /** Linha extra de detalhe (opcional) */
  subtitle?: ReactNode;
  onSelect: () => void;
  onDelete?: () => void;
  deleteTitle?: string;
  /** Ações extras à direita (antes do delete) */
  extraActions?: ReactNode;
  className?: string;
};

/**
 * Card de histórico por aba (padrão visual repetido 6x no Dashboard).
 * Extraído no plano 03, passo 12: ícone + título + percentual + badge + subtítulo + delete.
 */
export function HistoryCard({
  theme,
  active,
  title,
  percent,
  status,
  subtitle,
  onSelect,
  onDelete,
  deleteTitle = 'Excluir análise',
  extraActions,
  className = '',
}: HistoryCardProps) {
  const { Icon, activeBg, inactiveBg, iconActive, iconInactive, titleActive, titleInactive, percentText } = theme;
  return (
    <div
      className={`w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 transition-all group cursor-pointer mb-2 ${
        active ? activeBg : inactiveBg
      } ${className}`}
      onClick={onSelect}
    >
      <div className={`p-2.5 rounded-lg shrink-0 transition-colors ${active ? iconActive : iconInactive}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0 block">
        <p className={`text-sm truncate font-medium ${active ? titleActive : titleInactive}`}>{title}</p>
        <div className="flex items-center gap-2 mt-1 opacity-80">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${percentText}`}>{percent}%</span>
          <HistoryStatusBadge status={status} />
        </div>
        {subtitle && <div className="mt-0.5 truncate text-[10px] text-slate-500">{subtitle}</div>}
      </div>
      {extraActions}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 -mr-1 rounded-lg text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all block shrink-0"
          title={deleteTitle}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
