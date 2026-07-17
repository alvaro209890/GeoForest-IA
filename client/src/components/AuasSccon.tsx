import React, { useCallback, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  MapPin,
  Satellite,
  Upload,
  XCircle,
} from 'lucide-react';
import { auth } from '@/lib/firebase';

/* ─── API base (mesma regra do Dashboard) ─────────────────────── */
const DEFAULT_PRODUCTION_API_BASE = 'https://geoforest-api.cursar.space';
const CONFIGURED_API_BASE = String(
  import.meta.env.VITE_API_BASE ||
    (typeof window !== 'undefined' && /\.web\.app$/i.test(window.location.hostname)
      ? DEFAULT_PRODUCTION_API_BASE
      : ''),
)
  .trim()
  .replace(/\/+$/, '');
const apiUrl = (path: string) => {
  if (!path) return CONFIGURED_API_BASE || '';
  if (!CONFIGURED_API_BASE) return path;
  return `${CONFIGURED_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
};

type DateRule = 'min' | 'max';

type ReportDetail = {
  index: number;
  ID: number | string | null;
  ABERTURA_antes: string | null;
  ABERTURA_depois: string | null;
  n_alertas_intersect: number;
  data_alerta_min: string | null;
  data_alerta_max: string | null;
  classes: string;
  atualizado: boolean;
};

type Report = {
  regra_data: string;
  n_alertas_bbox: number;
  n_alertas_com_data: number;
  classes_alertas: Record<string, number>;
  n_auas: number;
  n_atualizados: number;
  n_sem_intersecao: number;
  n_pontos_sem_alerta: number;
  area_ha_sem_alerta: number;
  crs_auas: string;
  warnings?: string[];
  detalhes: ReportDetail[];
};

type DoneEvent = {
  jobId: string;
  filename: string;
  downloadUrl: string;
  report: Report;
};

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.readAsDataURL(file);
  });
}

export default function AuasSccon() {
  const [file, setFile] = useState<File | null>(null);
  const [dateRule, setDateRule] = useState<DateRule>('min');
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DoneEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) {
      setError('Envie um arquivo .zip contendo o shapefile AUAS (.shp, .dbf, .prj).');
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
  };

  const process = useCallback(async () => {
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setPct(0);
    setStatusMsg('Preparando envio…');
    setLogs([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const auasZip = await fileToBase64(file);
      const headers = new Headers({ 'Content-Type': 'application/json' });
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch {
        /* segue sem auth — endpoint é público */
      }

      const response = await fetch(apiUrl('/api/auas-sccon/process'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ auasZip, dateRule, filename: file.name }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Erro ${response.status} ao iniciar o processamento.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let evt: any;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === 'progress') {
            if (typeof evt.pct === 'number') setPct(Math.min(100, Math.max(0, evt.pct)));
            if (evt.message) {
              setStatusMsg(String(evt.message));
              setLogs((prev) => [...prev.slice(-40), String(evt.message)]);
            }
          } else if (evt.type === 'done') {
            finished = true;
            setPct(100);
            setStatusMsg('Concluído.');
            setResult(evt as DoneEvent);
          } else if (evt.type === 'error') {
            throw new Error(String(evt.message || 'Falha no processamento.'));
          }
        }
      }
      if (!finished && !result) {
        throw new Error('A conexão terminou antes de concluir o processamento.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(String(err?.message || err || 'Falha ao processar.'));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [file, dateRule, running, result]);

  const download = useCallback(async () => {
    if (!result) return;
    try {
      const headers = new Headers();
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch {
        /* público */
      }
      const res = await fetch(apiUrl(result.downloadUrl), { headers });
      if (!res.ok) throw new Error(`Erro ${res.status} ao baixar o ZIP.`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(String(err?.message || 'Falha ao baixar o arquivo.'));
    }
  }, [result]);

  const report = result?.report;

  return (
    <div className="flex-1 overflow-y-auto px-2 sm:px-4 lg:px-6 py-3 sm:py-6 lg:py-8 custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in-up">
        {/* Cabeçalho */}
        <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
              <CalendarClock size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-base sm:text-lg text-slate-200">
                Datação de AUAS × Alertas SCCON
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Importe o shapefile AUAS. O sistema cruza com os alertas de desmate da
                plataforma SCCON (SEMA-MT) e devolve o AUAS com a coluna{' '}
                <code className="text-emerald-300">ABERTURA</code> datada, mais um shape de
                pontos das AUAS sem alerta.
              </p>
            </div>
          </div>
        </section>

        {/* Upload + opções */}
        <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-4 sm:p-6 space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0] || null);
            }}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-white/10 hover:border-emerald-500/40 transition-colors p-6 text-center"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
            />
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 rounded-full bg-white/5 text-emerald-400">
                {file ? <FileArchive size={22} /> : <Upload size={22} />}
              </div>
              {file ? (
                <p className="text-sm text-slate-200 font-medium break-all">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-slate-300 font-medium">
                    Arraste o ZIP do AUAS aqui ou clique para selecionar
                  </p>
                  <p className="text-xs text-slate-500">
                    O .zip deve conter .shp, .dbf e .prj com o campo ABERTURA
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Regra de data */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Data gravada
            </span>
            <div className="inline-flex rounded-xl bg-white/[0.03] border border-white/[0.06] p-1">
              <button
                type="button"
                onClick={() => setDateRule('min')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  dateRule === 'min'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Mais antiga (MIN)
              </button>
              <button
                type="button"
                onClick={() => setDateRule('max')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  dateRule === 'max'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Mais recente (MAX)
              </button>
            </div>
            <span className="text-[11px] text-slate-500">
              {dateRule === 'min'
                ? 'Primeira detecção de desmate (recomendado p/ abertura).'
                : 'Última detecção de alerta.'}
            </span>
          </div>

          <button
            type="button"
            disabled={!file || running}
            onClick={process}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed py-3 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Satellite size={16} />}
            {running ? 'Processando…' : 'Cruzar com alertas SCCON'}
          </button>
        </section>

        {/* Progresso */}
        {(running || (result && pct === 100)) && (
          <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{statusMsg}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {logs.length > 0 && (
              <div className="max-h-32 overflow-y-auto custom-scrollbar text-[11px] text-slate-500 font-mono space-y-0.5">
                {logs.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Erro */}
        {error && (
          <section className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
            <XCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </section>
        )}

        {/* Resultado */}
        {report && (
          <section className="bg-[#0e1612]/60 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <h3 className="font-semibold text-slate-200">Processamento concluído</h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Polígonos AUAS" value={report.n_auas} />
              <Stat label="Datados" value={report.n_atualizados} accent="emerald" />
              <Stat label="Sem alerta" value={report.n_sem_intersecao} accent="amber" />
              <Stat label="Alertas (bbox)" value={report.n_alertas_bbox} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} className="text-amber-400" />
                {report.n_pontos_sem_alerta} pontos ·{' '}
                {report.area_ha_sem_alerta.toLocaleString('pt-BR')} ha sem alerta
              </span>
              <span>CRS: {report.crs_auas}</span>
              <span>{report.regra_data.includes('antiga') ? 'Regra: MIN' : 'Regra: MAX'}</span>
            </div>

            {report.warnings && report.warnings.length > 0 && (
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-1">
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-amber-200">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={download}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 py-3 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-all"
            >
              <Download size={16} />
              Baixar ZIP (AUAS datado + pontos + relatório)
            </button>

            {/* Prévia da tabela */}
            {report.detalhes?.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-[11px] text-slate-300">
                  <thead className="bg-white/[0.03] text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">ID</th>
                      <th className="text-left px-3 py-2 font-semibold">Antes</th>
                      <th className="text-left px-3 py-2 font-semibold">Depois</th>
                      <th className="text-right px-3 py-2 font-semibold">Alertas</th>
                      <th className="text-left px-3 py-2 font-semibold">Classes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.detalhes.slice(0, 60).map((d) => (
                      <tr
                        key={d.index}
                        className={`border-t border-white/5 ${d.atualizado ? '' : 'opacity-60'}`}
                      >
                        <td className="px-3 py-1.5 font-mono">{d.ID ?? '—'}</td>
                        <td className="px-3 py-1.5">{d.ABERTURA_antes ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          {d.atualizado ? (
                            <span className="text-emerald-300 font-medium">{d.ABERTURA_depois}</span>
                          ) : (
                            <span className="text-slate-500">{d.ABERTURA_depois ?? '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{d.n_alertas_intersect}</td>
                        <td className="px-3 py-1.5 text-slate-400">{d.classes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.detalhes.length > 60 && (
                  <p className="text-[10px] text-slate-500 px-3 py-2">
                    Mostrando 60 de {report.detalhes.length} polígonos. Detalhes completos no
                    RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json do ZIP.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <p className="text-[10px] text-slate-600 text-center">
          Alertas SCCON-MT começam em 22/07/2019. Conversões anteriores não terão data SCCON. A
          data é indicativa (disclaimer da própria plataforma SCCON).
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'emerald' | 'amber';
}) {
  const color =
    accent === 'emerald'
      ? 'text-emerald-300'
      : accent === 'amber'
        ? 'text-amber-300'
        : 'text-slate-200';
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value.toLocaleString('pt-BR')}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
