import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FolderArchive,
  KeyRound,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, fileToBase64, readApiError, resolveBackendUrl } from '@/lib/api';
import { auth } from '@/lib/firebase';

/** Chave PRÓPRIA do GeoForest (decisão A5) — nada é compartilhado com o acompanhamento-de-processos. */
const CREDENCIAIS_KEY = 'geoforest_simcar_credenciais_v1';

type LoteDetectado = {
  filename: string;
  carEstadual: string | null;
  reciboFederal: string | null;
  propriedade: string | null;
  municipio: string | null;
  proprietario: string | null;
  erro: string | null;
};

type LinhaRelatorio = {
  filename: string;
  car: string | null;
  propriedade: string | null;
  municipio: string | null;
  pasta: string | null;
  baixados: string[];
  faltantes: string[];
  erro: string | null;
};

type JobLotes = {
  jobId?: string;
  status?: string;
  fase?: string;
  percent?: number;
  message?: string;
  loteAtual?: number;
  totalLotes?: number;
  lotesConcluidos?: number;
  relatorio?: LinhaRelatorio[];
  downloadUrl?: string | null;
  outputFilename?: string | null;
  error?: string | null;
  cancelado?: boolean;
};

const FASE_LABEL: Record<string, string> = {
  queued: 'Na fila',
  lendo: 'Lendo recibos',
  login: 'Autenticando no SIMCAR',
  resolvendo: 'Localizando CARs',
  baixando: 'Baixando documentos',
  zipando: 'Gerando ZIP',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  erro: 'Falhou',
};

function lerCredenciais(): { cpf: string; senha: string; lembrar: boolean } {
  try {
    const raw = window.localStorage.getItem(CREDENCIAIS_KEY);
    if (!raw) return { cpf: '', senha: '', lembrar: true };
    const parsed = JSON.parse(raw) as { cpf?: string; senha?: string };
    return { cpf: String(parsed.cpf || ''), senha: String(parsed.senha || ''), lembrar: true };
  } catch {
    return { cpf: '', senha: '', lembrar: true };
  }
}

function formatarCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Empacota os arquivos escolhidos num único envio base64.
 * 1 arquivo (PDF ou ZIP) vai direto; vários viram um ZIP montado no navegador
 * (store, sem compressão — os PDFs já são comprimidos).
 */
async function montarEnvio(files: File[]): Promise<{ base64: string; filename: string }> {
  if (files.length === 1) {
    return { base64: await fileToBase64(files[0]), filename: files[0].name };
  }
  const entradas = await Promise.all(
    files.map(async (file) => ({ nome: file.name, dados: new Uint8Array(await file.arrayBuffer()) })),
  );
  return { base64: zipStore(entradas), filename: 'recibos.zip' };
}

/** ZIP "stored" mínimo (sem deflate) — evita dependência nova no cliente. */
function zipStore(entradas: Array<{ nome: string; dados: Uint8Array }>): string {
  const encoder = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let offset = 0;

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (data: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const entrada of entradas) {
    const nome = encoder.encode(entrada.nome);
    const crc = crc32(entrada.dados);
    const local = new Uint8Array(30 + nome.length + entrada.dados.length);
    const dvLocal = new DataView(local.buffer);
    dvLocal.setUint32(0, 0x04034b50, true);
    dvLocal.setUint16(4, 20, true);
    dvLocal.setUint16(8, 0, true); // stored
    dvLocal.setUint32(14, crc, true);
    dvLocal.setUint32(18, entrada.dados.length, true);
    dvLocal.setUint32(22, entrada.dados.length, true);
    dvLocal.setUint16(26, nome.length, true);
    local.set(nome, 30);
    local.set(entrada.dados, 30 + nome.length);
    locais.push(local);

    const central = new Uint8Array(46 + nome.length);
    const dvCentral = new DataView(central.buffer);
    dvCentral.setUint32(0, 0x02014b50, true);
    dvCentral.setUint16(4, 20, true);
    dvCentral.setUint16(6, 20, true);
    dvCentral.setUint16(10, 0, true);
    dvCentral.setUint32(16, crc, true);
    dvCentral.setUint32(20, entrada.dados.length, true);
    dvCentral.setUint32(24, entrada.dados.length, true);
    dvCentral.setUint16(28, nome.length, true);
    dvCentral.setUint32(42, offset, true);
    central.set(nome, 46);
    centrais.push(central);

    offset += local.length;
  }

  const tamanhoCentral = centrais.reduce((total, item) => total + item.length, 0);
  const eocd = new Uint8Array(22);
  const dvEocd = new DataView(eocd.buffer);
  dvEocd.setUint32(0, 0x06054b50, true);
  dvEocd.setUint16(8, entradas.length, true);
  dvEocd.setUint16(10, entradas.length, true);
  dvEocd.setUint32(12, tamanhoCentral, true);
  dvEocd.setUint32(16, offset, true);

  const total = offset + tamanhoCentral + eocd.length;
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const parte of [...locais, ...centrais, eocd]) {
    zip.set(parte, cursor);
    cursor += parte.length;
  }

  let binario = '';
  for (let i = 0; i < zip.length; i += 0x8000) {
    binario += String.fromCharCode(...zip.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

export type SimcarLotesPanelProps = {
  /** Espelha cada snapshot do job para o histórico do Dashboard (cards laterais). */
  onJobSnapshot?: (job: Record<string, unknown>) => void;
  /**
   * Job escolhido num card do histórico — o painel carrega e exibe o resultado dele.
   * O `nonce` muda a cada clique para que reabrir o MESMO card depois de rodar outra
   * análise volte a carregá-lo (só o jobId não mudaria e o efeito não dispararia).
   */
  jobParaAbrir?: { jobId: string; nonce: number } | null;
};

export default function SimcarLotesPanel({ onJobSnapshot, jobParaAbrir }: SimcarLotesPanelProps = {}) {
  const salvas = useMemo(lerCredenciais, []);
  const [cpf, setCpf] = useState(() => formatarCpf(salvas.cpf));
  const [senha, setSenha] = useState(salvas.senha);
  const [lembrar, setLembrar] = useState(salvas.lembrar);

  const [files, setFiles] = useState<File[]>([]);
  const [lotes, setLotes] = useState<LoteDetectado[]>([]);
  const [analisando, setAnalisando] = useState(false);
  const [job, setJob] = useState<JobLotes | null>(null);
  const [erro, setErro] = useState('');
  const envioRef = useRef<{ base64: string; filename: string } | null>(null);
  const eventsRef = useRef<AbortController | null>(null);
  // Ref para o callback não recriar `aplicarPatch` (que é dependência do SSE).
  const onJobSnapshotRef = useRef(onJobSnapshot);
  onJobSnapshotRef.current = onJobSnapshot;

  useEffect(() => () => eventsRef.current?.abort(), []);

  const salvarCredenciais = useCallback(() => {
    try {
      if (!lembrar) {
        window.localStorage.removeItem(CREDENCIAIS_KEY);
        return;
      }
      window.localStorage.setItem(CREDENCIAIS_KEY, JSON.stringify({ cpf, senha }));
    } catch {
      // localStorage indisponível (aba anônima) — segue sem persistir.
    }
  }, [cpf, senha, lembrar]);

  const limparCredenciais = useCallback(() => {
    try {
      window.localStorage.removeItem(CREDENCIAIS_KEY);
    } catch {
      // Nada a fazer.
    }
    setCpf('');
    setSenha('');
    toast.success('Credenciais removidas deste navegador.');
  }, []);

  const analisar = useCallback(async () => {
    if (!files.length) return;
    setAnalisando(true);
    setErro('');
    setLotes([]);
    try {
      const envio = await montarEnvio(files);
      envioRef.current = envio;
      const resp = await apiFetch('/api/simcar-lotes/parse-recibos', {
        method: 'POST',
        body: JSON.stringify({ zipBase64: envio.base64, filename: envio.filename }),
      });
      if (!resp.ok) throw new Error((await readApiError(resp)).error || 'Falha ao ler os recibos.');
      const payload = await resp.json();
      setLotes(Array.isArray(payload.lotes) ? payload.lotes : []);
    } catch (error: any) {
      setErro(error?.message || 'Falha ao analisar os recibos.');
    } finally {
      setAnalisando(false);
    }
  }, [files]);

  /**
   * Aplica um patch do job no estado e espelha o snapshot completo para o
   * Dashboard (card do histórico + persistência em `simcar_lotes_jobs`).
   */
  const aplicarPatch = useCallback(
    (jobId: string, patch: Record<string, unknown>) => {
      setJob((atual) => {
        const proximo = { ...(atual || {}), ...patch, jobId } as JobLotes;
        onJobSnapshotRef.current?.({ ...proximo, jobId });
        return proximo;
      });
    },
    [],
  );

  const acompanhar = useCallback(async (jobId: string) => {
    const controller = new AbortController();
    eventsRef.current?.abort();
    eventsRef.current = controller;
    try {
      const resp = await apiFetch(`/api/simcar-lotes/jobs/${jobId}/events`, { signal: controller.signal });
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop() || '';
        for (const linha of linhas) {
          if (!linha.startsWith('data: ')) continue;
          try {
            const evento = JSON.parse(linha.slice(6));
            if (evento.type === 'heartbeat') continue;
            const patch = evento.type === 'snapshot' ? evento.job : evento;
            aplicarPatch(jobId, patch);
          } catch {
            // Evento malformado — ignora.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        // Sem SSE (proxy/rede): cai para uma leitura final do status.
        try {
          const resp = await apiFetch(`/api/simcar-lotes/jobs/${jobId}/status`);
          if (resp.ok) aplicarPatch(jobId, (await resp.json()).job || {});
        } catch {
          // Mantém o último estado conhecido.
        }
      }
    }
  }, [aplicarPatch]);

  /** Card do histórico clicado: carrega o job salvo e reconecta se ainda estiver rodando. */
  const abrirJobId = jobParaAbrir?.jobId || '';
  const abrirNonce = jobParaAbrir?.nonce ?? 0;
  useEffect(() => {
    const jobId = abrirJobId.trim();
    if (!jobId) return;
    let cancelado = false;
    void (async () => {
      try {
        const resp = await apiFetch(`/api/simcar-lotes/jobs/${jobId}/status`);
        if (!resp.ok || cancelado) return;
        const salvo = (await resp.json()).job || {};
        setJob({ ...salvo, jobId });
        setErro('');
        if (String(salvo.status || '') === 'processing') void acompanhar(jobId);
      } catch {
        // Job sumiu do disco — mantém a tela como está.
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce é o gatilho intencional
  }, [abrirJobId, abrirNonce, acompanhar]);

  const baixarDocumentos = useCallback(async () => {
    const envio = envioRef.current;
    if (!envio) return;
    if (cpf.replace(/\D/g, '').length !== 11 || !senha) {
      setErro('Configure o CPF e a senha do SIMCAR antes de buscar.');
      return;
    }
    setErro('');
    salvarCredenciais();
    setJob({ status: 'processing', fase: 'queued', percent: 1, message: 'Enviando ao servidor...' });
    try {
      const carsManuais: Record<string, string> = {};
      for (const lote of lotes) {
        if (lote.carEstadual) carsManuais[lote.filename] = lote.carEstadual;
      }
      const resp = await apiFetch('/api/simcar-lotes/process', {
        method: 'POST',
        body: JSON.stringify({
          zipBase64: envio.base64,
          filename: envio.filename,
          cpf: cpf.replace(/\D/g, ''),
          senha,
          carsManuais,
        }),
      });
      if (!resp.ok) throw new Error((await readApiError(resp)).error || 'Falha ao iniciar o download.');
      const { jobId } = await resp.json();
      // Emite já aqui para o card aparecer no histórico antes do primeiro evento SSE.
      aplicarPatch(jobId, { filename: envio.filename, totalLotes: lotes.length });
      void acompanhar(jobId);
    } catch (error: any) {
      setJob(null);
      setErro(error?.message || 'Falha ao iniciar o download dos lotes.');
    }
  }, [acompanhar, aplicarPatch, cpf, lotes, salvarCredenciais, senha]);

  const cancelar = useCallback(async () => {
    if (!job?.jobId) return;
    try {
      await apiFetch(`/api/simcar-lotes/jobs/${job.jobId}`, { method: 'DELETE' });
      toast.info('Cancelamento solicitado — o ZIP virá com os lotes já concluídos.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao cancelar.');
    }
  }, [job?.jobId]);

  const baixarZip = useCallback(async () => {
    const url = resolveBackendUrl(job?.downloadUrl || '');
    if (!url) {
      toast.error('Link do ZIP indisponível.');
      return;
    }
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Faça login novamente para baixar o ZIP.');
      const token = await user.getIdToken();
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await readApiError(response))?.error || 'Falha ao baixar o ZIP.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = job?.outputFilename || 'lotes_simcar.zip';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao baixar o ZIP.');
    }
  }, [job?.downloadUrl, job?.outputFilename]);

  const processando = job?.status === 'processing';
  const concluido = job?.status === 'completed' || job?.status === 'cancelled';
  const lotesValidos = lotes.filter((lote) => lote.carEstadual || lote.reciboFederal);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <FolderArchive size={18} className="text-cyan-400" />
          Lotes SIMCAR
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Arraste os recibos de inscrição do CAR (PDF ou ZIP). O servidor entra no SIMCAR com as
          suas credenciais e devolve um ZIP com uma pasta por lote — Arquivo Enviado, Arquivo
          Processado e Recibo de Inscrição.
        </p>
      </div>

      {/* Card 1 — credenciais */}
      <div className="rounded-xl border border-white/[0.06] bg-slate-800/30 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <KeyRound size={14} className="text-slate-500" />
          Credenciais do SIMCAR (conta técnica)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            CPF
            <input
              type="text"
              inputMode="numeric"
              autoComplete="username"
              value={cpf}
              onChange={(e) => setCpf(formatarCpf(e.target.value))}
              placeholder="000.000.000-00"
              className="min-h-[44px] rounded-lg border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha do SIMCAR"
              className="min-h-[44px] rounded-lg border border-white/10 bg-slate-900/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={lembrar}
              onChange={(e) => setLembrar(e.target.checked)}
              className="h-4 w-4 accent-cyan-500"
            />
            Lembrar neste navegador
          </label>
          <button
            type="button"
            onClick={limparCredenciais}
            className="text-xs text-slate-500 underline hover:text-slate-300"
          >
            Limpar credenciais
          </button>
        </div>
        <p className="mt-2 text-[10px] text-slate-600">
          As credenciais ficam salvas apenas neste navegador e são enviadas somente para gerar os
          downloads — nunca são gravadas no servidor.
        </p>
      </div>

      {/* Card 2 — recibos */}
      <div className="rounded-xl border border-white/[0.06] bg-slate-800/30 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <FileText size={14} className="text-slate-500" />
          Recibos de inscrição
        </h3>
        <div
          className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors ${
            files.length ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-600 bg-slate-900/40 hover:border-slate-500'
          }`}
        >
          <Upload size={26} className="text-slate-500" />
          <p className="text-sm text-slate-400">Clique ou arraste os recibos (.pdf) ou um .zip</p>
          <input
            type="file"
            multiple
            accept=".pdf,.zip"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              setFiles(Array.from(e.target.files || []));
              setLotes([]);
              setJob(null);
              setErro('');
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="mt-3 space-y-1">
            {files.map((file) => (
              <p key={file.name} className="truncate text-xs text-slate-400">
                • {file.name}
              </p>
            ))}
            <button
              type="button"
              onClick={() => void analisar()}
              disabled={analisando}
              className="mt-3 flex min-h-[44px] items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {analisando ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              Analisar recibos
            </button>
          </div>
        )}

        {lotes.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Arquivo</th>
                  <th className="pb-2 pr-3 font-medium">CAR estadual</th>
                  <th className="pb-2 pr-3 font-medium">Propriedade</th>
                  <th className="pb-2 pr-3 font-medium">Município</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {lotes.map((lote, index) => (
                  <tr key={`${lote.filename}-${index}`} className="border-t border-white/[0.06]">
                    <td className="max-w-[180px] truncate py-2 pr-3" title={lote.filename}>
                      {lote.filename}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        value={lote.carEstadual || ''}
                        placeholder="MT00000/0000"
                        onChange={(e) =>
                          setLotes((atual) =>
                            atual.map((item, i) =>
                              i === index ? { ...item, carEstadual: e.target.value.trim() || null } : item,
                            ),
                          )
                        }
                        className="w-32 rounded border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-100 outline-none focus:border-cyan-500/50"
                      />
                    </td>
                    <td className="max-w-[160px] truncate py-2 pr-3">{lote.propriedade || '—'}</td>
                    <td className="py-2 pr-3">{lote.municipio || '—'}</td>
                    <td className="py-2">
                      {lote.carEstadual || lote.reciboFederal ? (
                        <span className="text-emerald-400">OK</span>
                      ) : (
                        <span className="text-amber-400" title={lote.erro || ''}>
                          sem identificação
                        </span>
                      )}
                    </td>
                    <td className="py-2 pl-2">
                      <button
                        type="button"
                        onClick={() => setLotes((atual) => atual.filter((_, i) => i !== index))}
                        className="rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                        title="Remover da lista"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Card 3 — download */}
      <div className="rounded-xl border border-white/[0.06] bg-slate-800/30 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Download size={14} className="text-slate-500" />
          Documentos dos lotes
        </h3>

        {erro && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {!processando && !concluido && (
          <button
            type="button"
            onClick={() => void baixarDocumentos()}
            disabled={!lotesValidos.length}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            <Download size={16} />
            Baixar documentos do lote
            {lotesValidos.length > 0 ? ` (${lotesValidos.length})` : ''}
          </button>
        )}

        {(processando || concluido) && job && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {processando ? (
                <Loader2 size={16} className="animate-spin text-cyan-400" />
              ) : job.status === 'cancelled' ? (
                <AlertTriangle size={16} className="text-orange-400" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">{FASE_LABEL[job.fase || ''] || job.fase || ''}</p>
                <p className="truncate text-xs text-slate-500">{job.message}</p>
              </div>
              {processando && (
                <button
                  type="button"
                  onClick={() => void cancelar()}
                  className="flex items-center gap-1 text-xs text-slate-500 underline hover:text-slate-300"
                >
                  <X size={12} /> Cancelar
                </button>
              )}
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
                style={{ width: `${Math.min(100, Math.max(2, Number(job.percent || 0)))}%` }}
              />
            </div>

            {job.status === 'completed' || job.status === 'cancelled' ? (
              <button
                type="button"
                onClick={() => void baixarZip()}
                className="flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
              >
                <Download size={16} />
                Baixar ZIP ({job.lotesConcluidos ?? 0} lote{(job.lotesConcluidos ?? 0) === 1 ? '' : 's'})
              </button>
            ) : null}

            {Array.isArray(job.relatorio) && job.relatorio.length > 0 && (
              <div className="space-y-2 rounded-lg border border-white/[0.06] bg-slate-900/40 p-3">
                {job.relatorio.map((linha, index) => (
                  <div key={`${linha.filename}-${index}`} className="text-xs">
                    <p className="text-slate-300">
                      {linha.car || linha.filename}
                      {linha.propriedade ? ` — ${linha.propriedade}` : ''}
                    </p>
                    {linha.baixados.length > 0 && (
                      <p className="text-emerald-400">✓ {linha.baixados.join(', ')}</p>
                    )}
                    {linha.faltantes.length > 0 && (
                      <p className="text-amber-400">⚠ sem na SEMA: {linha.faltantes.join(', ')}</p>
                    )}
                    {linha.erro && <p className="text-red-400">✕ {linha.erro}</p>}
                  </div>
                ))}
              </div>
            )}

            {concluido && (
              <button
                type="button"
                onClick={() => {
                  setJob(null);
                  setFiles([]);
                  setLotes([]);
                  envioRef.current = null;
                }}
                className="text-xs text-slate-500 underline hover:text-slate-300"
              >
                Processar outros recibos
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
