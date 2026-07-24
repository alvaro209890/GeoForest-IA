import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  Layers,
  Network,
  Receipt,
  Satellite,
  Scissors,
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
    <div className="relative p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm overflow-hidden">
      <div className="flex sm:grid sm:grid-cols-6 gap-0.5 relative scroll-tabs" role="tablist" aria-label="Ferramentas do dashboard">
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
              onClick={() => onNavigate(tab.id)}
              style={
                active
                  ? {
                      background: tab.activeGradient,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                    }
                  : undefined
              }
              className={`relative z-10 flex flex-1 flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all duration-300 text-xs font-semibold ${
                active ? 'text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
              }`}
            >
              <Icon size={16} className={active ? tab.iconGlowClass : ''} aria-hidden />
              <span className="block leading-none text-[10px] tracking-wide">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
