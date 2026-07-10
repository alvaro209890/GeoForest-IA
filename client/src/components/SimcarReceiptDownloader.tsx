import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Leaf,
  Loader2,
  MapPin,
  Receipt,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
) => Promise<Response>;

type SimcarReceiptItem = {
  id: number;
  rid: number | null;
  numeroCompleto: string;
  numeroReciboFederal: string;
  situacao: string;
  situacaoCompleta: string;
  propriedadeNome: string;
  municipioTexto: string;
  dataUltimoEnvio: string;
  dinamizadoId: number | null;
  dinamizadoSituacao: string | null;
  dinamizadoDataProcessamento: string | null;
};

type SearchResponse = {
  total: number;
  items: SimcarReceiptItem[];
  error?: string;
};

type Props = {
  apiFetch: ApiFetch;
  onDownloaded?: (receipt: {
    type: 'simcar' | 'apf';
    filename: string;
    cpf?: string;
    car?: string;
    downloadUrl?: string;
    sizeBytes?: number;
    error?: string;
  }) => void;
};

function formatDateTime(value: string): string {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeFilenamePart(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function receiptFilename(item: SimcarReceiptItem): string {
  const car = safeFilenamePart(item.numeroCompleto.replace('/', '_')) || `requerimento_${item.id}`;
  const property = safeFilenamePart(item.propriedadeNome) || 'imovel';
  return `recibo_${item.id}_${car}_${property}.pdf`;
}

async function readJsonError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Erro ${response.status}`;
  try {
    const payload = JSON.parse(text);
    return String(payload?.error || `Erro ${response.status}`);
  } catch {
    return text.slice(0, 300);
  }
}

export default function SimcarReceiptDownloader({ apiFetch, onDownloaded }: Props) {
  const [cpf, setCpf] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [items, setItems] = useState<SimcarReceiptItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const hasQuery = cpf.trim().length > 0 || carNumber.trim().length > 0;

  const searchReceipts = useCallback(async () => {
    if (!hasQuery) {
      setError('Informe CPF ou número do CAR.');
      setItems([]);
      setSelectedId(null);
      return;
    }

    setSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const response = await apiFetch('/api/simcar/receipts/search', {
        method: 'POST',
        body: JSON.stringify({
          cpf: cpf.trim(),
          carNumber: carNumber.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }

      const payload = (await response.json()) as SearchResponse;
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(nextItems);
      setSelectedId(nextItems[0]?.id || null);

      if (nextItems.length === 0) {
        toast.info('Nenhum CAR encontrado para os filtros informados.');
      } else if (nextItems.length === 1) {
        toast.success('1 CAR encontrado.');
      } else {
        toast.success(`${nextItems.length} CARs encontrados. Selecione qual recibo baixar.`);
      }
    } catch (err: any) {
      const message = String(err?.message || 'Falha ao consultar o SIMCAR.');
      setError(message);
      setItems([]);
      setSelectedId(null);
      toast.error(message);
    } finally {
      setSearching(false);
    }
  }, [apiFetch, carNumber, cpf, hasQuery]);

  const downloadReceipt = useCallback(
    async (item: SimcarReceiptItem | null) => {
      if (!item) {
        setError('Selecione um CAR para baixar o recibo.');
        return;
      }

      setDownloadingId(item.id);
      setError(null);
      const filename = receiptFilename(item);
      try {
        const response = await apiFetch(
          `/api/simcar/receipts/download/${item.id}?filename=${encodeURIComponent(filename)}`,
          { method: 'GET' },
        );

        if (!response.ok) {
          throw new Error(await readJsonError(response));
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(() => window.URL.revokeObjectURL(url), 250);
        toast.success(`Recibo ${item.numeroCompleto || item.id} baixado.`);
        onDownloaded?.({
          type: 'simcar',
          filename,
          cpf,
          car: item.carCodigo || carNumber,
          sizeBytes: blob.size,
        });
      } catch (err: any) {
        const message = String(err?.message || 'Falha ao baixar recibo.');
        setError(message);
        toast.error(message);
      } finally {
        setDownloadingId(null);
      }
    },
    [apiFetch, cpf, carNumber, onDownloaded],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !searching) {
        event.preventDefault();
        void searchReceipts();
      }
    },
    [searchReceipts, searching],
  );

  const clearAll = () => {
    setCpf('');
    setCarNumber('');
    setItems([]);
    setSelectedId(null);
    setError(null);
    setHasSearched(false);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header card ── */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/10 bg-gradient-to-br from-emerald-950/40 via-slate-950/40 to-slate-950/40 p-5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
              <Receipt size={18} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Recibos SIMCAR</h2>
              <p className="text-[11px] text-slate-500 font-medium">SEMA/MT — Consulta pública de recibos do CAR</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[
              { label: 'Fonte', value: 'SEMA-MT' },
              { label: 'Busca', value: 'CPF/CAR' },
              { label: 'Saída', value: 'PDF' },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[9px] uppercase tracking-wider text-slate-500">{item.label}</span>
                <span className="text-[11px] font-semibold text-emerald-200">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Search Panel ── */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 backdrop-blur-sm overflow-hidden">
        {/* Quick search row — responsive: wraps on mobile */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3">
          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex items-center gap-2 flex-1 bg-slate-800/60 rounded-xl border border-slate-700/40 px-3 py-2.5 focus-within:border-emerald-500/50 transition-colors min-h-[44px]">
              <User size={15} className="text-slate-500 shrink-0" />
              <input
                type="text"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="CPF do proprietário"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none border-none p-0"
              />
              {cpf && (
                <button onClick={() => setCpf('')} className="shrink-0 text-slate-500 hover:text-slate-300 min-w-[28px] min-h-[28px] flex items-center justify-center">
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider text-center py-1 sm:py-0">ou</span>
            <div className="flex items-center gap-2 flex-1 bg-slate-800/60 rounded-xl border border-slate-700/40 px-3 py-2.5 focus-within:border-emerald-500/50 transition-colors min-h-[44px]">
              <Leaf size={15} className="text-slate-500 shrink-0" />
              <input
                type="text"
                value={carNumber}
                onChange={(e) => setCarNumber(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Nº do CAR (ex: MT274719/2025)"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none border-none p-0"
              />
              {carNumber && (
                <button onClick={() => setCarNumber('')} className="shrink-0 text-slate-500 hover:text-slate-300 min-w-[28px] min-h-[28px] flex items-center justify-center">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void searchReceipts()}
              disabled={searching || !hasQuery}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/20 active:scale-95 min-h-[44px]"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Buscar
            </button>
            {hasQuery && (
              <button
                onClick={clearAll}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-slate-800/60 border border-slate-700/40 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors min-h-[44px]"
              >
                <RefreshCw size={13} />
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Expandable tip */}
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="w-full flex items-center justify-center gap-2 py-1.5 border-t border-slate-700/30 text-[11px] text-slate-500 hover:text-slate-300 transition-colors bg-slate-900/20 group"
        >
          <span>{filtersOpen ? 'Ocultar' : 'Mostrar'} dicas de busca</span>
          <ChevronDown
            size={13}
            className={`transition-transform duration-300 ${filtersOpen ? 'rotate-180' : ''} group-hover:text-slate-400`}
          />
        </button>

        {filtersOpen && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-700/20">
            <div className="flex flex-wrap gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500/60" />
                CPF + CAR juntos = busca mais precisa
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-500/60" />
                Formato estadual: <code className="text-slate-400 bg-slate-800/60 px-1 rounded">MT274719/2025</code>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-blue-500/60" />
                Recibo federal: <code className="text-slate-400 bg-slate-800/60 px-1 rounded">MT-5107065-...</code>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100 animate-fade-in-up">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Results ── */}
      {items.length > 0 && (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-900/40 backdrop-blur-sm p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <FileText size={16} className="text-emerald-400" />
                {items.length} CAR{items.length > 1 ? 's' : ''} encontrado{items.length > 1 ? 's' : ''}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {items.length > 1
                  ? 'Selecione o imóvel correto antes de baixar o recibo.'
                  : 'Confira os dados antes de baixar.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void downloadReceipt(selectedItem)}
              disabled={!selectedItem || downloadingId !== null}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 text-sm font-semibold text-white hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-600/10 active:scale-[0.97]"
            >
              {downloadingId ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Baixar selecionado
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const selected = item.id === selectedItem?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`group relative w-full rounded-xl border p-4 text-left transition-all duration-300 ${
                    selected
                      ? 'border-emerald-400/40 bg-emerald-500/8 shadow-[0_0_20px_rgba(16,185,129,0.06)]'
                      : 'border-slate-700/50 bg-white/[0.02] hover:border-emerald-500/25 hover:bg-white/[0.04]'
                  }`}
                >
                  {/* Selection indicator */}
                  <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                    selected
                      ? 'border-emerald-400 bg-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                      : 'border-slate-600 group-hover:border-slate-500'
                  }`}>
                    {selected && (
                      <CheckCircle2 size={14} className="text-emerald-300 transition-transform duration-300 scale-100" />
                    )}
                  </div>

                  <div className="flex flex-col gap-3 pr-8">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-bold transition-colors duration-300 ${
                          selected ? 'text-emerald-100' : 'text-white'
                        }`}>
                          {item.numeroCompleto || `Requerimento ${item.id}`}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
                          selected
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-white/10 bg-black/20 text-slate-400'
                        }`}>
                          ID {item.id}
                        </span>
                        {selected && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200 animate-fade-in-up">
                            <CheckCircle2 size={10} />
                            selecionado
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 truncate text-sm transition-colors duration-300 ${
                        selected ? 'text-slate-200' : 'text-slate-300'
                      }`}>
                        {item.propriedadeNome || 'Imóvel sem nome'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <MapPin size={10} />
                          {item.municipioTexto || '—'}
                        </span>
                        <span>Situação: {item.situacaoCompleta || item.situacao || '—'}</span>
                        <span>Último envio: {formatDateTime(item.dataUltimoEnvio)}</span>
                      </div>
                      {item.numeroReciboFederal && (
                        <p className="mt-2 break-all font-mono text-[10px] text-slate-600">
                          {item.numeroReciboFederal}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadReceipt(item);
                        }}
                        className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-all cursor-pointer ${
                          downloadingId !== null
                            ? 'opacity-30 cursor-not-allowed'
                            : selected
                              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {downloadingId === item.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        PDF
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Empty state (before any search) ── */}
      {!searching && !hasSearched && items.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/30 flex items-center justify-center">
            <Search size={28} className="text-slate-600" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-medium">
              Busque recibos do SIMCAR por CPF ou número do CAR
            </p>
            <p className="text-[11px] text-slate-600 mt-1 max-w-sm">
              O sistema consulta a base pública da SEMA-MT e retorna os recibos disponíveis para download
            </p>
          </div>
        </div>
      )}

      {/* ── Loading state ── */}
      {searching && (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Loader2 size={28} className="text-emerald-400 animate-spin" />
            </div>
            <div className="absolute inset-0 rounded-2xl animate-pulse bg-emerald-500/5" />
          </div>
          <div className="text-center">
            <p className="text-sm text-slate-400 font-medium">Consultando SIMCAR...</p>
            <p className="text-[11px] text-slate-600 mt-1">Isso pode levar alguns segundos</p>
          </div>
        </div>
      )}
    </div>
  );
}
