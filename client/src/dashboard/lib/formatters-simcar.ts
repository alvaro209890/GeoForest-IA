/**
 * Formatadores de rótulos/classes SIMCAR (AC/AVN/AUAS) do Dashboard.
 * Extraídos de Dashboard.tsx (plano 03, passo 2) — puros, sem hooks.
 */
import type { SimcarAuasMetaV1 } from '@/dashboard/types/history';

export const formatSimcarAuasStatus = (status?: SimcarAuasMetaV1['finalStatus']) => {
  if (status === 'AUAS_VALIDA') return { label: 'AUAS válida', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' };
  if (status === 'AUAS_INVALIDA') return { label: 'AUAS inválida', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (status === 'AUAS_PARCIAL') return { label: 'Revisão parcial', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
  return { label: 'Sem status', className: 'border-white/10 bg-white/5 text-slate-300' };
};

export const formatSimcarAcAvnVerdict = (verdict?: 'SIM' | 'NAO' | 'INCONCLUSIVO' | null) => {
  if (verdict === 'SIM') return { label: 'Sim', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (verdict === 'NAO') return { label: 'Não', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  return { label: 'Inconclusivo', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
};

export const formatSimcarAcAvnConfidence = (confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'INCONCLUSIVO' | null) => {
  if (confidence === 'ALTA') return { label: 'Alta', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  if (confidence === 'MEDIA') return { label: 'Média', className: 'border-blue-500/20 bg-blue-500/10 text-blue-200' };
  if (confidence === 'BAIXA') return { label: 'Baixa', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
  return { label: 'Inconclusiva', className: 'border-slate-500/20 bg-slate-500/10 text-slate-300' };
};

export const formatSimcarAuasVerdict = (verdict: NonNullable<SimcarAuasMetaV1['yearVerdicts']>[number]['verdict']) => {
  if (verdict === 'CONSOLIDADO') return 'Consolidado';
  if (verdict === 'VEGETACAO_NATIVA_PRESENTE') return 'Vegetação nativa';
  if (verdict === 'DESMATAMENTO_RECENTE') return 'Supressão pós-2008';
  return 'Inconclusivo';
};

export const simcarAuasVerdictClass = (verdict: NonNullable<SimcarAuasMetaV1['yearVerdicts']>[number]['verdict']) => {
  if (verdict === 'CONSOLIDADO') return 'border-blue-500/20 bg-blue-500/10 text-blue-200';
  if (verdict === 'VEGETACAO_NATIVA_PRESENTE') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
  if (verdict === 'DESMATAMENTO_RECENTE') return 'border-red-500/20 bg-red-500/10 text-red-200';
  return 'border-slate-500/20 bg-slate-500/10 text-slate-300';
};
