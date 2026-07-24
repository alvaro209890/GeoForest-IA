import React from 'react';
import {
  Plus,
  Zap,
  Shield,
  Loader2,
  AlertTriangle,
  Wallet,
  TrendingDown,
  TrendingUp,
  Activity,
  BarChart3,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  ChevronDown,
  Cpu,
} from 'lucide-react';
import TermsOfUseDialog from '@/components/TermsOfUseDialog';
import type { UserSettings } from '@/dashboard/settings/types';

export type SettingsBillingWallet = {
  balanceBrl?: number;
  totalTopupBrl?: number;
  totalSpentBrl?: number;
};

export type SettingsBillingUsageToday = {
  totalCostBrl?: number;
  totalRequests?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
};

export type SettingsBillingModelSnapshotItem = {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
  requests: number;
};

export type SettingsBillingMe = {
  wallet?: SettingsBillingWallet;
  usageToday?: SettingsBillingUsageToday;
  modelSnapshot?: SettingsBillingModelSnapshotItem[];
};

export type SettingsBillingPricing = {
  usdBrlRate?: number;
  usdBrlSource?: string;
} | null;

export type SettingsBillingLedgerEntry = {
  id: string;
  amountBrl?: number;
  type?: string;
  model?: string;
  createdAt?: {
    toDate?: () => Date;
    _seconds?: number;
  };
};

export type SettingsPanelProps = {
  userProfile: { fullName?: string; email?: string } | null;
  onEditProfileName: () => void;
  onOpenBillingTopup: () => void;
  billingLoading: boolean;
  billingMe: SettingsBillingMe | null;
  billingPricing: SettingsBillingPricing;
  billingLedger: SettingsBillingLedgerEntry[];
  formatBrl: (value: number) => string;
  onResetPassword: () => void;
  resettingPassword: boolean;
  settings: UserSettings;
  updateSettings: (next: Partial<UserSettings>) => void | Promise<unknown>;
};

export default function SettingsPanel({
  userProfile,
  onEditProfileName,
  onOpenBillingTopup,
  billingLoading,
  billingMe,
  billingPricing,
  billingLedger,
  formatBrl,
  onResetPassword,
  resettingPassword,
  settings,
  updateSettings,
}: SettingsPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-5 sm:space-y-8 animate-fade-in-up">
        <section className="relative group">
          <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm" />
          <div className="relative bg-[#0e1612]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-6 md:p-8 flex flex-col items-center gap-4 sm:gap-6 md:flex-row">
            <div className="relative shrink-0">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-2xl sm:text-3xl font-bold text-white shadow-2xl ring-4 ring-[#0e1612]">
                {(userProfile?.fullName || 'U')
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </div>
              <button className="absolute bottom-0 right-0 p-2 bg-emerald-600 rounded-full text-white hover:bg-emerald-500 transition-colors shadow-lg">
                <Plus size={16} />
              </button>
            </div>
            <div className="flex-1 text-center md:text-left space-y-1 sm:space-y-2 min-w-0">
              <h2 className="text-xl sm:text-2xl font-semibold text-white truncate">{userProfile?.fullName || 'Usuário'}</h2>
              <p className="text-sm sm:text-base text-slate-400 truncate">{userProfile?.email || 'email@exemplo.com'}</p>
              <div className="flex items-center justify-center md:justify-start gap-2 pt-2 flex-wrap">
                <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                  Plano Pro
                </span>
                <span className="px-3 py-1 rounded-full bg-white/5 text-slate-400 text-xs font-medium border border-white/10">
                  Membro desde 2023
                </span>
              </div>
            </div>
            <div className="flex gap-3 w-full md:w-auto">
              <button
                onClick={onEditProfileName}
                className="w-full md:w-auto px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-200 transition-all"
              >
                Editar Perfil
              </button>
            </div>
          </div>
        </section>

        {/* ── Saldo e Créditos ── */}
        <section className="relative group animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-700" />
          <div className="relative bg-[#0a110e]/70 backdrop-blur-2xl border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] rounded-3xl p-5 sm:p-8 md:p-10 overflow-hidden">

            {/* Decorative glowing orbs */}
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative flex flex-col pt-2 sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/20 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)] shrink-0">
                  <Wallet size={24} strokeWidth={2} />
                </div>
                <div>
                  <h3 className="font-bold text-lg sm:text-xl text-white tracking-tight">Meus Créditos</h3>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">Cobrança por uso real. Sem plano mensal.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenBillingTopup}
                className="group/btn relative flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-white overflow-hidden shadow-[0_8px_16px_rgba(16,185,129,0.25)] hover:shadow-[0_12px_24px_rgba(16,185,129,0.35)] transition-all duration-300 hover:-translate-y-0.5 w-full sm:w-auto isolate"
              >
                <span className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out z-0" />
                <Plus size={18} className="relative z-10 transition-transform duration-300 group-hover/btn:rotate-90" />
                <span className="relative z-10">Adicionar créditos</span>
              </button>
            </div>

            {/* Saldo principal */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.08] p-6 sm:p-8 mb-8 backdrop-blur-md">
              <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent opacity-50 pointer-events-none" />
              <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
                <div>
                  <p className="text-xs text-emerald-400/80 uppercase tracking-[0.2em] font-bold mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Saldo disponível
                  </p>
                  <p className="text-4xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-400 tracking-tight drop-shadow-sm">
                    {billingLoading ? (
                      <span className="flex items-center gap-4 py-2">
                        <Loader2 size={32} className="animate-spin text-emerald-500/70" />
                        <span className="text-2xl text-slate-500 font-medium">Carregando...</span>
                      </span>
                    ) : (
                      formatBrl(billingMe?.wallet?.balanceBrl || 0)
                    )}
                  </p>
                  {!billingLoading && (billingMe?.wallet?.balanceBrl || 0) < 2 && (
                    <div className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
                      <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                      <p className="text-xs font-medium text-amber-300">Saldo baixo. Algumas ações podem ser bloqueadas.</p>
                    </div>
                  )}
                </div>

                {/* Currency helper mini-card inside main balance */}
                {!billingLoading && (
                  <div className="flex items-center gap-2.5 px-4 py-2 bg-white/[0.03] border border-white/[0.05] rounded-xl self-start sm:self-end">
                    <DollarSign size={14} className="text-slate-400" />
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Câmbio USD</span>
                      <span className="text-xs text-slate-300 font-medium">{Number(billingPricing?.usdBrlRate || 0).toFixed(4)} <span className="text-slate-500">[{billingPricing?.usdBrlSource || 'n/d'}]</span></span>
                    </div>
                  </div>
                )
                }
              </div>
            </div>

            {/* Cards de resumo */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 mb-8">
              {[
                { icon: TrendingUp, color: 'emerald', label: 'Total Recarregado', value: formatBrl(billingMe?.wallet?.totalTopupBrl || 0), subValue: null },
                { icon: TrendingDown, color: 'rose', label: 'Total Gasto', value: formatBrl(billingMe?.wallet?.totalSpentBrl || 0), subValue: null },
                { icon: Activity, color: 'blue', label: 'Gasto Hoje', value: formatBrl(billingMe?.usageToday?.totalCostBrl || 0), subValue: `${billingMe?.usageToday?.totalRequests || 0} reqs` },
                { icon: Cpu, color: 'purple', label: 'Custo Médio / Req', value: (billingMe?.usageToday?.totalRequests || 0) > 0 ? formatBrl((billingMe?.usageToday?.totalCostBrl || 0) / (billingMe?.usageToday?.totalRequests || 1)) : 'R$ 0,00', subValue: 'hoje' }
              ].map((card, idx) => (
                <div key={idx} className={`group/card relative overflow-hidden rounded-2xl bg-[#131b17] border border-white/[0.05] p-5 hover:border-${card.color}-500/30 hover:bg-[#16201b] transition-all duration-300 shadow-sm`}>
                  <div className={`absolute -right-4 -top-4 w-16 h-16 bg-${card.color}-500/5 rounded-full blur-xl group-hover/card:bg-${card.color}-500/10 transition-colors pointer-events-none`} />
                  <div className="flex flex-col h-full relative z-10">
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className={`p-1.5 rounded-lg bg-${card.color}-500/10 text-${card.color}-400 group-hover/card:scale-110 transition-transform duration-300`}>
                        <card.icon size={16} strokeWidth={2.5} />
                      </div>
                      <h4 className="text-[10px] text-slate-400 uppercase tracking-wider font-bold truncate leading-tight">{card.label}</h4>
                    </div>
                    <div className="mt-auto">
                      <p className="text-lg sm:text-xl font-bold text-white tracking-tight">{card.value}</p>
                      {card.subValue && <p className="text-[10px] text-slate-500 font-medium mt-1">{card.subValue}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Token summary strip */}
            {(billingMe?.usageToday?.totalInputTokens || 0) + (billingMe?.usageToday?.totalOutputTokens || 0) > 0 && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4 mb-8 rounded-2xl bg-[#0e1411] border border-white/[0.03] shadow-inner">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-widest shrink-0">
                  <Zap size={14} className="text-yellow-500" /> TOKENS (HOJE)
                </div>
                <div className="w-px h-4 bg-white/10 hidden sm:block" />
                <div className="flex flex-wrap gap-4 sm:gap-8 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                    <span className="text-slate-400 text-xs">Entrada:</span>
                    <span className="text-white text-sm font-semibold tracking-tight">{(billingMe?.usageToday?.totalInputTokens || 0).toLocaleString('pt-BR')}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                    <span className="text-slate-400 text-xs">Saída:</span>
                    <span className="text-white text-sm font-semibold tracking-tight">{(billingMe?.usageToday?.totalOutputTokens || 0).toLocaleString('pt-BR')}</span>
                  </span>
                  <div className="ml-auto flex items-center gap-2 bg-white/5 px-3 py-1 rounded-lg">
                    <span className="text-slate-400 text-xs">Total:</span>
                    <span className="text-emerald-300 text-sm font-bold tracking-tight">
                      {((billingMe?.usageToday?.totalInputTokens || 0) + (billingMe?.usageToday?.totalOutputTokens || 0)).toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Consumo por modelo + Histórico lado a lado */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Consumo por modelo */}
              <div className="flex flex-col rounded-2xl bg-[#0e1411] border border-white/[0.04] overflow-hidden">
                <div className="flex items-center gap-3 p-5 border-b border-white/[0.04] bg-white/[0.01]">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <BarChart3 size={16} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-200">Consumo por Categoria</h4>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Últimos 7 dias</p>
                  </div>
                </div>
                <div className="p-2 sm:p-5 flex-1 max-h-[320px] overflow-y-auto custom-scrollbar">
                  {billingMe?.modelSnapshot?.length ? (
                    <div className="space-y-4 pr-2">
                      {billingMe.modelSnapshot.slice(0, 10).map((item) => {
                        const maxCost = Math.max(...(billingMe.modelSnapshot || []).map((m) => m.costBrl), 0.01);
                        const pct = Math.min(100, (item.costBrl / maxCost) * 100);
                        const totalTk = (item.inputTokens || 0) + (item.outputTokens || 0);
                        return (
                          <div key={`${item.provider}-${item.model}`} className="group/row">
                            <div className="flex items-center justify-between text-xs mb-2">
                              <span className="text-slate-300 font-medium truncate shrink" title={item.model}>{item.model}</span>
                              <div className="flex items-center gap-3 shrink-0 ml-2">
                                <span className="text-[10px] font-semibold text-slate-500 bg-white/5 px-2 py-0.5 rounded-md">{item.requests || 0} reqs</span>
                                <span className="text-white font-bold">{formatBrl(item.costBrl)}</span>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-black/40 overflow-hidden mb-1.5 border border-white/[0.02]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-out relative overflow-hidden"
                                style={{ width: `${pct}%` }}
                              >
                                <div className="absolute top-0 inset-x-0 h-[1px] bg-white/30" />
                              </div>
                            </div>
                            {totalTk > 0 && (
                              <div className="flex items-center gap-4 text-[10px] font-medium text-slate-500">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                  {(item.inputTokens || 0).toLocaleString('pt-BR')} IN
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  {(item.outputTokens || 0).toLocaleString('pt-BR')} OUT
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full py-10 text-slate-500">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/5">
                        <BarChart3 size={24} className="opacity-50" />
                      </div>
                      <p className="text-sm font-medium text-slate-400">Sem dados recentes.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Histórico / Últimos lançamentos */}
              <div className="flex flex-col rounded-2xl bg-[#0e1411] border border-white/[0.04] overflow-hidden">
                <div className="flex items-center gap-3 p-5 border-b border-white/[0.04] bg-white/[0.01]">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                    <Receipt size={16} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-200">Histórico de Transações</h4>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">Últimas movimentações</p>
                  </div>
                </div>
                <div className="p-2 sm:p-3 flex-1 max-h-[320px] overflow-y-auto custom-scrollbar">
                  {billingLedger.length ? (
                    <div className="space-y-1">
                      {billingLedger.slice(0, 15).map((entry) => {
                        const amount = Number(entry.amountBrl || 0);
                        const isPositive = amount >= 0;
                        const isNeutral = entry.type === 'reserve_release' && amount === 0;
                        const typeLabel: Record<string, string> = {
                          topup_manual: 'Recarga Manual',
                          usage_debit: 'Processamento IA',
                          reserve_hold: 'Cativo (Reserva)',
                          reserve_release: 'Estorno de Reserva',
                          refund: 'Reembolso',
                        };
                        const label = typeLabel[entry.type || ''] || String(entry.type || 'Movimentação').replace(/_/g, ' ');
                        const dateStr = entry.createdAt?.toDate
                          ? entry.createdAt.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : entry.createdAt?._seconds
                            ? new Date(entry.createdAt._seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                            : '';

                        let iconBg = 'bg-white/5 text-slate-400';
                        let amountColor = 'text-slate-400';
                        let amountPrefix = '';
                        let Icon = Activity;

                        if (isPositive && !isNeutral) {
                          iconBg = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                          amountColor = 'text-emerald-400';
                          amountPrefix = '+';
                          Icon = ArrowUpRight;
                        } else if (!isPositive) {
                          iconBg = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
                          amountColor = 'text-white'; // Destaque branco para saídas com fundo escuro, ou mantém vermelho sutil
                          Icon = ArrowDownRight;
                        }

                        return (
                          <div
                            key={entry.id}
                            className="flex items-center gap-4 py-3 px-4 rounded-xl hover:bg-white/[0.04] transition-colors group/item"
                          >
                            <div className={`p-2 rounded-xl shrink-0 transition-transform group-hover/item:scale-110 ${iconBg}`}>
                              <Icon size={16} strokeWidth={2.5} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-200 truncate">{label}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {dateStr && <span className="text-[10px] font-medium text-slate-500">{dateStr}</span>}
                                {entry.model && (
                                  <>
                                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                                    <span className="text-[10px] font-medium text-slate-400 truncate max-w-[120px]">{entry.model}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`text-sm font-bold tracking-tight ${amountColor}`}>
                                {amountPrefix}{formatBrl(Math.abs(amount))}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full py-10 text-slate-500">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/5">
                        <Receipt size={24} className="opacity-50" />
                      </div>
                      <p className="text-sm font-medium text-slate-400">Sem histórico recente.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* ── Segurança ── */}
        <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
              <Shield size={20} />
            </div>
            <h3 className="font-semibold text-lg text-slate-200">Segurança</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={onResetPassword}
              disabled={resettingPassword}
              className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="text-sm text-slate-300">{resettingPassword ? 'Enviando e-mail...' : 'Alterar Senha'}</span>
              {resettingPassword ? (
                <Loader2 size={16} className="text-slate-500 animate-spin" />
              ) : (
                <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
              )}
            </button>
            <button
              onClick={() => updateSettings({ twoFactorEnabled: !settings.twoFactorEnabled })}
              className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group"
            >
              <div className="flex flex-col text-left">
                <span className="text-sm text-slate-300">Autenticação em 2 Etapas</span>
                <span className={`text-[10px] flex items-center gap-1 ${settings.twoFactorEnabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {settings.twoFactorEnabled ? 'Ativado' : 'Desativado'}
                </span>
              </div>
              <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
            </button>
            <TermsOfUseDialog
              triggerClassName="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors group text-left"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
