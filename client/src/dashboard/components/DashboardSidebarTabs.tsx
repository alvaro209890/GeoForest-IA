import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  Combine,
  FileText,
  FolderArchive,
  Layers,
  Map,
  Network,
  Receipt,
  Satellite,
  Scissors,
  Sprout,
} from 'lucide-react';
import type { DashboardTabId, DashboardView } from '../types';

export type DashboardTabDef = {
  id: DashboardTabId;
  label: string;
  Icon: LucideIcon;
  /** Gradiente CSS do estado ativo */
  activeGradient: string;
  /** Classe de glow do ícone quando ativo */
  iconGlowClass: string;
};

export const DASHBOARD_TABS: DashboardTabDef[] = [
  {
    id: 'simcar-clip',
    label: 'SIMCAR',
    Icon: Scissors,
    activeGradient: 'linear-gradient(135deg, #059669, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]',
  },
  {
    id: 'simcar-receipts',
    label: 'Recibos',
    Icon: Receipt,
    activeGradient: 'linear-gradient(135deg, #059669, #84cc16)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]',
  },
  {
    id: 'simcar-lotes',
    label: 'Lotes',
    Icon: FolderArchive,
    activeGradient: 'linear-gradient(135deg, #059669, #22d3ee)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]',
  },
  {
    id: 'cbers-wpm',
    label: 'CBERS',
    Icon: Satellite,
    activeGradient: 'linear-gradient(135deg, #06b6d4, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]',
  },
  {
    id: 'landsat',
    label: 'Landsat',
    Icon: Layers,
    activeGradient: 'linear-gradient(135deg, #0ea5e9, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(56,189,248,0.5)]',
  },
  {
    id: 'vertices-proximas',
    label: 'Erros',
    Icon: Network,
    activeGradient: 'linear-gradient(135deg, #8b5cf6, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(167,139,250,0.5)]',
  },
  {
    id: 'auas-sccon',
    label: 'AUAS',
    Icon: CalendarClock,
    activeGradient: 'linear-gradient(135deg, #059669, #16a34a)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(16,185,129,0.5)]',
  },
  {
    id: 'sobreposicoes',
    label: 'Sobrepos.',
    Icon: Combine,
    activeGradient: 'linear-gradient(135deg, #0d9488, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(45,212,191,0.5)]',
  },
  {
    id: 'croqui',
    label: 'Croqui',
    Icon: Map,
    activeGradient: 'linear-gradient(135deg, #d97706, #f59e0b)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]',
  },
  {
    id: 'ndvi',
    label: 'NDVI',
    Icon: Sprout,
    activeGradient: 'linear-gradient(135deg, #65a30d, #10b981)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(132,204,22,0.5)]',
  },
  {
    id: 'solicitacao-prioridade',
    label: 'Solicitação',
    Icon: FileText,
    activeGradient: 'linear-gradient(135deg, #0891b2, #06b6d4)',
    iconGlowClass: 'drop-shadow-[0_0_6px_rgba(6,182,212,0.5)]',
  },
];

type DashboardSidebarTabsProps = {
  activeView: DashboardView;
  onNavigate: (view: DashboardTabId) => void;
};

/**
 * Abas principais do sidebar (segmented control).
 * Extraído do monólito Dashboard para permitir evolução independente da navegação.
 */
export function DashboardSidebarTabs({ activeView, onNavigate }: DashboardSidebarTabsProps) {
  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.03] p-1 backdrop-blur-sm">
      <div
        className="grid grid-cols-4 gap-1"
        role="tablist"
        aria-label="Ferramentas do dashboard"
      >
        {DASHBOARD_TABS.map((tab) => {
          const active = activeView === tab.id;
          const Icon = tab.Icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={tab.label}
              title={tab.label}
              onClick={() => onNavigate(tab.id)}
              style={
                active
                  ? {
                      background: tab.activeGradient,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                    }
                  : undefined
              }
              className={`relative z-10 flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 transition-all duration-300 ${
                active ? 'text-white' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
              }`}
            >
              <Icon size={15} className={active ? tab.iconGlowClass : ''} aria-hidden />
              <span className="block w-full truncate text-center text-[9px] font-semibold leading-tight tracking-wide">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
