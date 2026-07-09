import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Search } from 'lucide-react';
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

function statusColor(situacao: string): string {
  const s = situacao.toUpperCase();
  if (s === 'ATIVA' || s === 'VIGENTE') return 'text-emerald-400';
  if (s === 'CANCELADA') return 'text-red-400';
  if (s === 'VENCIDA') return 'text-amber-400';
  return 'text-slate-400';
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

  const canSearch = useMemo(
    () =>
      cpfCnpj.trim() || cpfResponsavel.trim() || numeroApf.trim() || carNumber.trim(),
    [cpfCnpj, cpfResponsavel, numeroApf, carNumber],
  );

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

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText size={20} className="text-blue-400" />
          APF Rural — SEMA/MT
        </h2>
        <p className="text-xs text-slate-400">
          Consulte e baixe Autorizações Provisórias de Funcionamento Rural.
        </p>
      </div>

      {/* Search form */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">CPF/CNPJ do proprietário</span>
            <input
              type="text"
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(e.target.value)}
              placeholder="000.000.001-91"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">CPF do Responsável</span>
            <input
              type="text"
              value={cpfResponsavel}
              onChange={(e) => setCpfResponsavel(e.target.value)}
              placeholder="000.000.000-00"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Número da APF</span>
            <input
              type="text"
              value={numeroApf}
              onChange={(e) => setNumeroApf(e.target.value)}
              placeholder="31708/2020"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Número do CAR</span>
            <div className="flex gap-2">
              <select
                value={carType}
                onChange={(e) => setCarType(e.target.value as 'FEDERAL' | 'ESTADUAL')}
                className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ESTADUAL">Estadual</option>
                <option value="FEDERAL">Federal</option>
              </select>
              <input
                type="text"
                value={carNumber}
                onChange={(e) => setCarNumber(e.target.value)}
                placeholder="MT-XXXXXX-XXX..."
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </div>
          </label>
        </div>

        <button
          onClick={search}
          disabled={!canSearch || loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          Buscar
        </button>
      </div>

      {/* Results */}
      {total > 0 && (
        <p className="text-xs text-slate-400">
          Existem {total} autorização{total > 1 ? 'ões' : ''} para o filtro informado.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const isCancelled = item.situacao.toUpperCase() === 'CANCELADA';
          const downloadKeyApf = `${item.numero}_apf`;
          const downloadKeyTermo = `${item.numero}_termo`;

          return (
            <div
              key={item.numero}
              className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      APF {item.numero}
                    </span>
                    <span className={`text-xs font-medium ${statusColor(item.situacao)}`}>
                      {item.situacao}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {item.imovel} — {item.municipio}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-400">
                  CAR: <span className="text-slate-200">{item.car || '—'}</span>
                </span>
                <span className="text-slate-400">
                  Responsável: <span className="text-slate-200">{item.responsavel || '—'}</span>
                </span>
                <span className="text-slate-400">
                  Atividade: <span className="text-slate-200">{item.atividade || '—'}</span>
                </span>
                <span className="text-slate-400">
                  Emissão: <span className="text-slate-200">{item.dataEmissao || '—'}</span>
                </span>
                <span className="text-slate-400">
                  Validade: <span className="text-slate-200">{item.dataValidade || '—'}</span>
                </span>
                <span className="text-slate-400">
                  Atualização: <span className="text-slate-200">{item.ultimaAtualizacao || '—'}</span>
                </span>
              </div>

              {isCancelled ? (
                <div className="flex items-center gap-2 text-xs text-amber-400/70 bg-amber-400/5 rounded-lg px-3 py-2 border border-amber-400/10">
                  <AlertTriangle size={14} />
                  APF cancelada — download não disponível.
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => download(item, 'apf')}
                    disabled={downloadingId === downloadKeyApf}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 transition-colors"
                  >
                    {downloadingId === downloadKeyApf ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    APF PDF
                  </button>
                  <button
                    onClick={() => download(item, 'termo')}
                    disabled={downloadingId === downloadKeyTermo}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-40 transition-colors"
                  >
                    {downloadingId === downloadKeyTermo ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    Termo PDF
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-slate-500">
          <FileText size={48} className="opacity-30" />
          <p className="text-sm">Preencha ao menos um campo e clique em Buscar.</p>
        </div>
      )}
    </div>
  );
}
