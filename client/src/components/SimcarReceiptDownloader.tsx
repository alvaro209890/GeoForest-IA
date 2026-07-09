import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Receipt, Search } from 'lucide-react';
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

export default function SimcarReceiptDownloader({ apiFetch }: Props) {
  const [cpf, setCpf] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [items, setItems] = useState<SimcarReceiptItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const hasQuery = cpf.trim().length > 0 || carNumber.trim().length > 0;

  const searchReceipts = useCallback(async () => {
    if (!hasQuery) {
      setError('Informe CPF, número do CAR estadual ou recibo federal.');
      setItems([]);
      setSelectedId(null);
      return;
    }

    setSearching(true);
    setError(null);
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
      } catch (err: any) {
        const message = String(err?.message || 'Falha ao baixar recibo.');
        setError(message);
        toast.error(message);
      } finally {
        setDownloadingId(null);
      }
    },
    [apiFetch],
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

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-8 custom-scrollbar">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 animate-fade-in-up">
        <section className="rounded-2xl border border-emerald-500/15 bg-[#07130f]/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                <Receipt size={13} />
                Recibo SIMCAR
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Baixar recibo pelo CPF ou CAR</h2>
              <p className="max-w-3xl text-sm text-slate-400">
                Consulte o SIMCAR público, escolha o CAR correto quando houver mais de um resultado e baixe o recibo pelo identificador oficial do requerimento.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Fonte', value: 'SEMA-MT' },
                { label: 'Busca', value: 'CPF/CAR' },
                { label: 'Saída', value: 'PDF' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-100">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                CPF do proprietário
              </label>
              <input
                type="text"
                value={cpf}
                onChange={(event) => setCpf(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ex: 002.480.951-96"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 transition-colors focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Número do CAR
              </label>
              <input
                type="text"
                value={carNumber}
                onChange={(event) => setCarNumber(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ex: MT274719/2025 ou MT-5107065-..."
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 transition-colors focus:border-emerald-500/50"
              />
            </div>
            <button
              type="button"
              onClick={() => void searchReceipts()}
              disabled={searching || !hasQuery}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Buscar
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Se informar CPF e CAR juntos, a busca retorna somente o vínculo que atender aos dois filtros.
          </p>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-300" />
            <span>{error}</span>
          </div>
        )}

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Resultados encontrados</h3>
              <p className="mt-1 text-xs text-slate-500">
                {items.length > 1
                  ? 'Selecione o imóvel e clique para baixar o recibo correto.'
                  : items.length === 1
                    ? 'Confira os dados antes de baixar.'
                    : 'Faça uma busca para listar os CARs.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void downloadReceipt(selectedItem)}
              disabled={!selectedItem || downloadingId !== null}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloadingId ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Baixar selecionado
            </button>
          </div>

          {items.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-center">
              <FileText size={34} className="mb-3 text-slate-600" />
              <p className="text-sm text-slate-400">Nenhum recibo carregado</p>
              <p className="mt-1 max-w-md text-xs text-slate-600">
                Pesquise por CPF completo, número estadual do CAR ou recibo federal.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item) => {
                const selected = item.id === selectedItem?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-emerald-400/50 bg-emerald-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-emerald-500/25 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-white">{item.numeroCompleto || `Requerimento ${item.id}`}</span>
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                            Id {item.id}
                          </span>
                          {selected && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                              <CheckCircle2 size={11} />
                              selecionado
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-300">{item.propriedadeNome || 'Imóvel sem nome'}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>Município: {item.municipioTexto || '-'}</span>
                          <span>Situação: {item.situacaoCompleta || item.situacao || '-'}</span>
                          <span>Último envio: {formatDateTime(item.dataUltimoEnvio)}</span>
                        </div>
                        {item.numeroReciboFederal && (
                          <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                            {item.numeroReciboFederal}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void downloadReceipt(item);
                          }}
                          disabled={downloadingId !== null}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {downloadingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          Recibo
                        </button>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
