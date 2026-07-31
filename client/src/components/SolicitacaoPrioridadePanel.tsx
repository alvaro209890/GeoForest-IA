import { useState, useRef, useCallback } from 'react';
import { FileUp, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface SseEvent {
  type: string;
  jobId?: string;
  stage?: string;
  message?: string;
  downloadUrl?: string;
}

export function SolicitacaoPrioridadePanel() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const readerRef = useRef<AbortController | null>(null);

  const handleProcess = useCallback(async () => {
    if (!file) return;

    setStatus('uploading');
    setMessage('Lendo arquivo...');

    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      setStatus('processing');
      setMessage('Enviando para processamento...');

      const controller = new AbortController();
      readerRef.current = controller;

      const idToken = ''; // Will use Firebase auth if available
      const resp = await fetch('/api/solicitacao-prioridade/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipBase64: base64 }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
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
    }
  }, [file]);

  const handleCancel = () => {
    readerRef.current?.abort();
    setStatus('idle');
    setMessage('');
  };

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
          status === 'processing'
            ? 'border-cyan-500/50 bg-cyan-500/5'
            : file
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-600 hover:border-slate-500 bg-slate-800/50'
        }`}
      >
        {status === 'idle' && (
          <>
            <FileUp size={32} className="text-slate-500" />
            <p className="text-sm text-slate-400">
              {file ? file.name : 'Clique ou arraste um arquivo ZIP'}
            </p>
            <input
              type="file"
              accept=".zip"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </>
        )}

        {status === 'uploading' && (
          <div className="flex items-center gap-3 text-cyan-400">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">{message}</span>
          </div>
        )}

        {status === 'processing' && (
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
              <a
                href={downloadUrl}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                <Download size={16} />
                Baixar documentos
              </a>
            )}
            <button
              onClick={() => { setStatus('idle'); setFile(null); setMessage(''); }}
              className="text-xs text-slate-500 hover:text-slate-300 underline mt-2"
            >
              Processar outro
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3">
            <AlertTriangle size={32} className="text-red-400" />
            <p className="text-sm text-red-400">{message}</p>
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
    </div>
  );
}
