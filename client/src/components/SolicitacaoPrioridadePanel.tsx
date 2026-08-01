import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileUp,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Trash2,
  Clock,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, fileToBase64, readApiError, resolveBackendUrl } from '@/lib/api';
import { auth, db } from '@/lib/firebase';
import { collection, deleteDoc, doc, getDocs, query, orderBy } from '@/lib/localFirestore';

interface SseEvent {
  type: string;
  jobId?: string;
  stage?: string;
  message?: string;
  downloadUrl?: string;
}

interface SolicitacaoHistoryItem {
  id: string;
  jobId: string;
  kind?: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  title?: string;
  filename?: string;
  downloadUrl?: string | null;
  pdfCount?: number;
  error?: string | null;
  timestamp?: string;
  updatedAtMs?: number;
}

function mapSolicitacaoDocToHistoryItem(docId: string, data: any): SolicitacaoHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: SolicitacaoHistoryItem['status'] =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'processing'
      ? rawStatus
      : 'processing';
  return {
    id: docId,
    jobId: String(data?.jobId || docId),
    kind: data?.kind || 'solicitacao_prioridade',
    status,
    title: data?.title || 'Solicitação de Prioridade',
    filename: data?.filename || `${docId.slice(0, 8)}.zip`,
    downloadUrl: data?.downloadUrl || null,
    pdfCount: Number(data?.pdfCount || 0),
    error: data?.error ? String(data.error) : null,
    timestamp: data?.timestamp,
    updatedAtMs: Number(data?.updatedAtMs || 0),
  };
}

const STATUS_LABEL: Record<SolicitacaoHistoryItem['status'], string> = {
  processing: 'Processando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

const STATUS_COLOR: Record<SolicitacaoHistoryItem['status'], string> = {
  processing: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-red-300',
  cancelled: 'text-orange-300',
};

export default function SolicitacaoPrioridadePanel() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [history, setHistory] = useState<SolicitacaoHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const readerRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setHistoryLoading(true);
    try {
      const collRef = collection(db, 'users', user.uid, 'solicitacao_prioridade_jobs');
      const snap = await getDocs(query(collRef, orderBy('updatedAtMs', 'desc')));
      const items: SolicitacaoHistoryItem[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (!data || !data.jobId) return;
        const item = mapSolicitacaoDocToHistoryItem(docSnap.id, data);
        if (item.status !== 'cancelled' || item.error) items.push(item);
      });
      setHistory(items);
    } catch (error) {
      console.warn('Falha ao carregar histórico de Solicitação de Prioridade:', error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleProcess = useCallback(async () => {
    if (!file) return;

    setStatus('uploading');
    setMessage('Lendo arquivo...');

    try {
      const base64 = await fileToBase64(file);

      setStatus('processing');
      setMessage('Enviando para processamento...');

      const controller = new AbortController();
      readerRef.current = controller;

      const resp = await apiFetch('/api/solicitacao-prioridade/process', {
        method: 'POST',
        body: JSON.stringify({ zipBase64: base64, filename: file.name }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.error || 'Erro no servidor');
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('Sem resposta do servidor');

      const decoder = new TextDecoder();
      let buffer2 = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer2 += decoder.decode(value, { stream: true });

        const lines = buffer2.split('\n');
        buffer2 = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: SseEvent = JSON.parse(line.slice(6));
              if (event.type === 'jobId') setJobId(event.jobId || '');
              if (event.type === 'progress') setMessage(event.message || '');
              if (event.type === 'complete') {
                setDownloadUrl(event.downloadUrl || '');
                setStatus('done');
                setMessage(event.message || 'Documentos preenchidos!');
              }
              if (event.type === 'error' || event.type === 'cancelled') {
                setStatus('error');
                setMessage(event.message || 'Erro');
              }
            } catch { /* ignore malformed JSON */ }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatus('error');
        setMessage(err.message || 'Erro ao processar');
      }
    } finally {
      void loadHistory();
    }
  }, [file, loadHistory]);

  const handleCancel = () => {
    readerRef.current?.abort();
    setStatus('idle');
    setMessage('');
  };

  const downloadWithAuth = useCallback(async (url?: string | null, filename = 'Solicitacao_Prioridade.zip') => {
    const resolved = resolveBackendUrl(url || '');
    if (!resolved) {
      toast.error('Link do ZIP indisponível. Gere novamente.');
      return;
    }
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Usuário não autenticado. Faça login novamente para baixar o ZIP.');
      const token = await user.getIdToken();
      const response = await fetch(resolved, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const payload = await readApiError(response);
        throw new Error(payload?.error || `Falha ao baixar ZIP (${response.status}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success('Download do ZIP iniciado.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao baixar ZIP.');
    }
  }, []);

  const deleteJob = useCallback(
    async (item: SolicitacaoHistoryItem) => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'solicitacao_prioridade_jobs', item.id));
        setHistory((prev) => prev.filter((h) => h.id !== item.id));
        toast.success('Registro removido.');
      } catch (error: any) {
        toast.error(error?.message || 'Falha ao remover registro.');
      }
    },
    []
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Solicitação de Prioridade SEMA</h2>
        <p className="text-sm text-slate-400 mt-1">
          Envie um ZIP com os PDFs (CAR, Matrícula, Procuração, CNH, Comprovante de Endereço, AI/TE)
          e receba os documentos preenchidos automaticamente.
        </p>
      </div>

      {/* Upload area */}
      <div
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors ${
          status === 'processing' || status === 'uploading'
            ? 'border-cyan-500/50 bg-cyan-500/5'
            : file
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
        }`}
      >
        {status === 'idle' && !file && (
          <>
            <FileUp size={32} className="text-slate-500" />
            <p className="text-sm text-slate-400">
              Clique ou arraste um arquivo ZIP
            </p>
            <input
              type="file"
              accept=".zip"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </>
        )}

        {status === 'idle' && file && (
          <div className="flex flex-col items-center gap-4">
            <FileText size={32} className="text-emerald-400" />
            <p className="text-sm text-slate-300 text-center break-all max-w-full">
              {file.name}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void handleProcess()}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors min-h-[44px]"
              >
                <Play size={16} />
                Processar ZIP
              </button>
              <button
                onClick={() => { setFile(null); setMessage(''); }}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Remover
              </button>
            </div>
          </div>
        )}

        {(status === 'uploading' || status === 'processing') && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-cyan-400" />
            <p className="text-sm text-cyan-400">{message}</p>
            <button
              onClick={handleCancel}
              className="text-xs text-slate-500 hover:text-slate-300 underline"
            >
              Cancelar
            </button>
          </div>
        )}

        {status === 'done' && (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 size={32} className="text-emerald-400" />
            <p className="text-sm text-emerald-400">{message}</p>
            {downloadUrl && (
              <button
                onClick={() => void downloadWithAuth(downloadUrl, `Solicitacao_Prioridade_${jobId.slice(0, 8)}.zip`)}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors min-h-[44px]"
              >
                <Download size={16} />
                Baixar documentos
              </button>
            )}
            <button
              onClick={() => { setStatus('idle'); setFile(null); setMessage(''); setDownloadUrl(''); }}
              className="text-xs text-slate-500 hover:text-slate-300 underline mt-2"
            >
              Processar outro
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3">
            <AlertTriangle size={32} className="text-red-400" />
            <p className="text-sm text-red-400 max-w-md text-center">{message}</p>
            <button
              onClick={() => { setStatus('idle'); setMessage(''); }}
              className="text-xs text-slate-500 hover:text-slate-300 underline"
            >
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-xl border border-white/[0.06] bg-slate-800/30 p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-2">PDFs necessários no ZIP:</h3>
        <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
          <li>CAR — Recibo de Inscrição</li>
          <li>Matrícula do imóvel</li>
          <li>Procuração vigente</li>
          <li>CNH ou RG do proprietário</li>
          <li>Comprovante de endereço</li>
          <li>AI e TE (Auto de Infração e Termo de Embargo)</li>
        </ul>
      </div>

      {/* Histórico salvo no banco (igual ao recorte SIMCAR) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Clock size={14} className="text-slate-500" />
            Histórico
          </h3>
          {historyLoading && <Loader2 size={14} className="animate-spin text-slate-500" />}
        </div>

        {history.length > 0 ? (
          history.map((item) => (
            <div
              key={item.id}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
            >
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <FileText size={16} />
              </div>
              <div className="flex-1 min-w-0 block">
                <p className="text-sm text-slate-200 truncate">{item.filename}</p>
                <p className="text-[10px] text-slate-500">
                  {(item.pdfCount ?? 0) > 0 ? `${item.pdfCount ?? 0} PDFs • ` : ''}
                  {item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : ''}
                </p>
                {item.status && (
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${STATUS_COLOR[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </p>
                )}
                {item.status === 'failed' && item.error && (
                  <p className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</p>
                )}
              </div>
              {item.status === 'completed' && item.downloadUrl && (
                <button
                  type="button"
                  onClick={() => void downloadWithAuth(item.downloadUrl, item.filename || 'Solicitacao_Prioridade.zip')}
                  className="p-2 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-500/20 transition-colors opacity-0 group-hover:opacity-100"
                  title="Baixar ZIP"
                >
                  <Download size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => void deleteJob(item)}
                className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                title="Remover registro"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-white/[0.06] bg-slate-800/30">
            <FileText size={28} className="text-slate-600 mb-2" />
            <p className="text-sm text-slate-400">Nenhuma solicitação processada</p>
            <p className="text-[10px] text-slate-600 mt-1">Envie um ZIP para começar</p>
          </div>
        )}
      </div>
    </div>
  );
}
