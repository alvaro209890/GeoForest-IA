import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Leaf,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
) => Promise<Response>;

type ApfReceiptItem = {
  numero: string;
  situacao: string;
  imovel: string;
  car: string;
  responsavel: string;
  atividade: string;
  municipio: string;
  dataEmissao: string;
  dataValidade: string;
  ultimaAtualizacao: string;
};

type SearchResponse = {
  total: number;
  items: ApfReceiptItem[];
  error?: string;
};

type Props = {
  apiFetch: ApiFetch;
};

type StatusBadge = {
  label: string;
  icon: React.ReactNode;
  bg: string;
  text: string;
  border: string;
  glow: string;
};

function getStatusBadge(situacao: string): StatusBadge {
  const s = situacao.toUpperCase();
  if (s === 'ATIVA' || s === 'VIGENTE' || s === 'REGULAR') {
    return {
      label: s === 'REGULAR' ? 'Regular' : s === 'ATIVA' ? 'Ativa' : 'Vigente',
      icon: <CheckCircle2 size={12} />,
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-300',
      border: 'border-emerald-500/20',
      glow: 'shadow-[0_0_12px_rgba(16,185,129,0.15)]',
    };
  }
  if (s === 'CANCELADA') {
    return {
      label: 'Cancelada',
      icon: <X size={12} />,
      bg: 'bg-red-500/10',
      text: 'text-red-300',
      border: 'border-red-500/20',
      glow: '',
    };
  }
  if (s === 'VENCIDA') {
    return {
      label: 'Vencida',
      icon: <AlertTriangle size={12} />,
      bg: 'bg-amber-500/10',
      text: 'text-amber-300',
      border: 'border-amber-500/20',
      glow: '',
    };
  }
  return {
    label: situacao,
    icon: <FileText size={12} />,
    bg: 'bg-slate-500/10',
    text: 'text-slate-300',
    border: 'border-slate-500/20',
    glow: '',
  };
}

export default function ApfReceiptDownloader({ apiFetch }: Props) {
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [cpfResponsavel, setCpfResponsavel] = useState('');
  const [numeroApf, setNumeroApf] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [carType, setCarType] = useState<'FEDERAL' | 'ESTADUAL'>('ESTADUAL');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ApfReceiptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const hasActiveFilters = useMemo(
    () => !!(cpfCnpj.trim() || cpfResponsavel.trim() || numeroApf.trim() || carNumber.trim()),
    [cpfCnpj, cpfResponsavel, numeroApf, carNumber],
  );

  const canSearch = hasActiveFilters;

  const search = useCallback(async () => {
    if (!canSearch) return;
    setLoading(true);
    setItems([]);
    setTotal(0);

    try {
      const res = await apiFetch('/api/apf/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpfCnpj,
          cpfResponsavel,
          numeroApf,
          carNumber,
          carType,
        }),
      });

      const data: SearchResponse = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao consultar APF');

      setItems(data.items || []);
      setTotal(data.total || 0);

      if (!data.items?.length) {
        toast.info('Nenhuma APF encontrada para os filtros informados.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao consultar APF');
    } finally {
      setLoading(false);
    }
  }, [canSearch, cpfCnpj, cpfResponsavel, numeroApf, carNumber, carType, apiFetch]);

  const download = useCallback(
    async (item: ApfReceiptItem, type: 'apf' | 'termo' = 'apf') => {
      const key = `${item.numero}_${type}`;
      setDownloadingId(key);
      try {
        const params = new URLSearchParams({
          numeroApf: item.numero,
          cpfCnpj: cpfCnpj || '',
          type,
          carNumber: carNumber || '',
          carType: carType || 'ESTADUAL',
          filename: `apf_${type}_${item.numero.replace('/', '_')}_${(item.imovel || 'imovel').replace(/\s+/g, '_')}.pdf`,
        });

        const res = await apiFetch(`/api/apf/download?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Erro ao baixar' }));
          throw new Error(err.error || 'Erro ao baixar');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = params.get('filename') || `apf_${item.numero}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        toast.success(`${type === 'termo' ? 'Termo' : 'APF'} baixado com sucesso`);
      } catch (err: any) {
        toast.error(err?.message || 'Falha ao baixar APF');
      } finally {
        setDownloadingId(null);
      }
    },
    [cpfCnpj, carNumber, carType, apiFetch],
  );

  const clearFilters = () => {
    setCpfCnpj('');
    setCpfResponsavel('');
    setNumeroApf('');
    setCarNumber('');
    setCarType('ESTADUAL');
    setItems([]);
    setTotal(0);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header with gradient accent ── */}
      <div className="relative overflow-hidden rounded-2xl border border-blue-500/10 bg-gradient-to-br from-blue-950/40 via-slate-950/40 to-slate-950/40 p-5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20">
                <FileText size={18} className="text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">APF Rural</h2>
                <p className="text-[11px] text-slate-500 font-medium">SEMA/MT — Autorização Provisória de Funcionamento</p>
              </div>
            </div>
          </div>
          {total > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <span className="text-xl font-bold text-blue-300">{total}</span>
              <span className="text-[11px] text-blue-400/70">APF{total > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 backdrop-blur-sm overflow-hidden">
        {/* Quick search row */}
        <div className="flex items-center gap-3 p-3">
          <div className="flex-1 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 bg-slate-800/60 rounded-xl border border-slate-700/40 px-3 py-2.5 focus-within:border-blue-500/50 transition-colors">
              <Search size={15} className="text-slate-500 shrink-0" />
              <input
                type="text"
                value={numeroApf}
                onChange={(e) => setNumeroApf(e.target.value)}
                placeholder="Nº da APF (ex: 31708/2020)"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none border-none p-0"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              {numeroApf && (
                <button onClick={() => setNumeroApf('')} className="shrink-0 text-slate-500 hover:text-slate-300">
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">ou</span>
            <div className="flex items-center gap-2 flex-1 bg-slate-800/60 rounded-xl border border-slate-700/40 px-3 py-2.5 focus-within:border-blue-500/50 transition-colors">
              <Leaf size={15} className="text-slate-500 shrink-0" />
              <input
                type="text"
                value={carNumber}
                onChange={(e) => setCarNumber(e.target.value)}
                placeholder="Nº do CAR (ex: MT226703/2022)"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none border-none p-0"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              {carNumber && (
                <button onClick={() => setCarNumber('')} className="shrink-0 text-slate-500 hover:text-slate-300">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <button
            onClick={search}
            disabled={!canSearch || loading}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/20 active:scale-95"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Buscar
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/60 border border-slate-700/40 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
            >
              <RefreshCw size={13} />
              Limpar
            </button>
          )}
        </div>

        {/* Expandable filters */}
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 border-t border-slate-700/30 text-[11px] text-slate-500 hover:text-slate-300 transition-colors bg-slate-900/20"
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`}
          />
          Filtros avançados
        </button>

        {filtersOpen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 pt-2 border-t border-slate-700/20">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium">CPF/CNPJ Proprietário</span>
              <input
                type="text"
                value={cpfCnpj}
                onChange={(e) => setCpfCnpj(e.target.value)}
                placeholder="000.000.001-91"
                className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium">CPF Responsável</span>
              <input
                type="text"
                value={cpfResponsavel}
                onChange={(e) => setCpfResponsavel(e.target.value)}
                placeholder="000.000.000-00"
                className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium">Tipo do CAR</span>
              <select
                value={carType}
                onChange={(e) => setCarType(e.target.value as 'FEDERAL' | 'ESTADUAL')}
                className="rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none transition-colors"
              >
                <option value="ESTADUAL">Estadual</option>
                <option value="FEDERAL">Federal</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {total > 0 && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">
            {total} autorização{total > 1 ? 'ões' : ''} encontrada{total > 1 ? 's' : ''}
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-700" />
          <button onClick={clearFilters} className="text-blue-400 hover:text-blue-300 transition-colors">
            Nova busca
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const status = getStatusBadge(item.situacao);
          const isCancelled = item.situacao.toUpperCase() === 'CANCELADA';
          const downloadKeyApf = `${item.numero}_apf`;
          const downloadKeyTermo = `${item.numero}_termo`;

          return (
            <div
              key={item.numero}
              className={`group relative overflow-hidden rounded-2xl border bg-slate-900/60 backdrop-blur-sm transition-all duration-300 hover:border-slate-600/60 ${
                isCancelled
                  ? 'border-red-500/10 hover:border-red-500/20'
                  : 'border-slate-700/50 hover:shadow-lg hover:shadow-blue-500/5'
              }`}
            >
              {/* Subtle gradient glow for active APFs */}
              {!isCancelled && (
                <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/3 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
              )}

              <div className="relative p-4">
                {/* Top row: number + status + imovel */}
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${
                      isCancelled
                        ? 'bg-red-500/10 border border-red-500/15'
                        : 'bg-blue-500/10 border border-blue-500/15'
                    }`}>
                      <ShieldCheck size={18} className={isCancelled ? 'text-red-400/60' : 'text-blue-400'} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white tracking-tight truncate">
                          APF {item.numero}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${status.bg} ${status.text} ${status.border} ${status.glow}`}
                        >
                          {status.icon}
                          {status.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {item.imovel || 'Imóvel não informado'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {[
                    { icon: <Leaf size={11} />, label: 'CAR', value: item.car },
                    { icon: <User size={11} />, label: 'Responsável', value: item.responsavel?.split(' - ')[0] },
                    { icon: <MapPin size={11} />, label: 'Município', value: item.municipio },
                    { icon: <Building2 size={11} />, label: 'Atividade', value: item.atividade },
                  ].map((info, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-0.5 rounded-xl bg-slate-800/40 border border-slate-700/30 px-3 py-2"
                    >
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        {info.icon}
                        {info.label}
                      </span>
                      <span className="text-[11px] text-slate-200 font-medium truncate">
                        {info.value || '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Dates row */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-[10px] text-slate-500">
                  {item.dataEmissao && (
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      Emissão: <span className="text-slate-300 font-medium">{item.dataEmissao}</span>
                    </span>
                  )}
                  {item.dataValidade && (
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      Validade: <span className="text-slate-300 font-medium">{item.dataValidade}</span>
                    </span>
                  )}
                  {item.ultimaAtualizacao && (
                    <span className="flex items-center gap-1">
                      <RefreshCw size={10} />
                      Atualização: <span className="text-slate-300 font-medium">{item.ultimaAtualizacao}</span>
                    </span>
                  )}
                </div>

                {/* Actions */}
                {isCancelled ? (
                  <div className="flex items-center gap-2 rounded-xl bg-red-500/5 border border-red-500/10 px-3 py-2 text-[11px] text-red-400/70">
                    <AlertTriangle size={13} className="shrink-0" />
                    Esta APF está cancelada e não permite download de documentos.
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => download(item, 'apf')}
                      disabled={downloadingId === downloadKeyApf}
                      className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2 text-xs font-semibold text-white hover:from-blue-500 hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/10 active:scale-[0.97]"
                    >
                      {downloadingId === downloadKeyApf ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      Baixar APF
                    </button>
                    <button
                      onClick={() => download(item, 'termo')}
                      disabled={downloadingId === downloadKeyTermo}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.97]"
                    >
                      {downloadingId === downloadKeyTermo ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      Baixar Termo
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Empty + Loading states ── */}
      {loading && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Loader2 size={28} className="text-blue-400 animate-spin" />
            </div>
            <div className="absolute inset-0 rounded-2xl animate-pulse bg-blue-500/5" />
          </div>
          <div className="text-center">
            <p className="text-sm text-slate-400 font-medium">Consultando SEMA-MT...</p>
            <p className="text-[11px] text-slate-600 mt-1">Isso pode levar alguns segundos</p>
          </div>
        </div>
      )}

      {!loading && items.length === 0 && !hasActiveFilters && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/30 flex items-center justify-center">
            <FileText size={28} className="text-slate-600" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-sm text-slate-400 font-medium">Consultar APF Rural</p>
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
              Preencha o número da APF, CAR, CPF/CNPJ ou CPF do responsável e clique em Buscar.
            </p>
          </div>
        </div>
      )}

      {!loading && items.length === 0 && hasActiveFilters && total === 0 && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/30 flex items-center justify-center">
            <Search size={28} className="text-slate-600" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-sm text-slate-400 font-medium">Nenhum resultado</p>
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
              Nenhuma APF encontrada para os filtros informados. Tente outros parâmetros.
            </p>
            <button
              onClick={clearFilters}
              className="mt-3 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
