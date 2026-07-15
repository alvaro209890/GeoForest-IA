import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileStack,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
) => Promise<Response>;

type GeometryLayer = {
  id: string;
  name: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  ignoredReason?: string;
};

type ErrorRow = {
  camada: string;
  tipo: string;
  feicao: number;
  parte: number;
  anel: number;
  x: number;
  y: number;
  detalhe: string;
};

type CamadaRec = {
  name: string;
  code: string | null;
  featureCount: number;
  crsLabel: string;
};

type Progress = {
  stage?: string;
  percent?: number;
  message?: string;
  layer?: string;
};

export type ProcessarHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted' | 'queued' | 'import_ok' | 'import_failed';
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  type?: string;
  uploadId?: string;
  importId?: string;
  downloadUrl?: string;
  importPdfUrl?: string;
  resultRows?: ErrorRow[];
  importRows?: ErrorRow[];
  warnings?: string[];
  camadasReconhecidas?: CamadaRec[];
  importOk?: boolean | null;
  importErrors?: number;
  processErrors?: number;
  totalErrors?: number;
  relatorioTexto?: string;
};

const TIPO_LABEL: Record<string, string> = {
  // Rótulos alinhados ao PDF "Relatório de importação"
  borda_se_cruza: 'Borda do polígono se cruza',
  vertice_duplicado: 'A geometria contém pontos repetidos',
  anel_degenerado: 'Anel degenerado',
  sobreposicao: 'Sobreposição',
  vazio: 'Vazio/gap',
  air_atp_area: 'Soma AIR ≠ ATP',
  erro_calculo_app: 'Erro de cálculo de APP',
  nomenclatura_desconhecida: 'Nomenclatura fora do padrão',
  crs_ausente: 'CRS ausente',
  crs_nao_conforme: 'CRS não conforme',
  dimensao_nao_2d: 'Shapefile não é 2D',
  primitiva_incorreta: 'Primitiva incorreta',
  atp_multipla: 'ATP com várias feições',
  atributo_ausente: 'Atributo obrigatório ausente',
  feicao_obrigatoria_ausente: 'Feição obrigatória ausente',
  fora_do_continente: 'Fora do continente (Anexo 01)',
  sobreposicao_proibida: 'Sobreposição proibida (Anexo 01)',
};

type Props = {
  apiFetch: ApiFetch;
  onJobSnapshot?: (job: Record<string, unknown>) => void;
  selectedJobId?: string | null;
  historyEntry?: ProcessarHistoryItem | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

async function readApiError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `Erro ${response.status}`;
    try {
      const json = JSON.parse(text);
      return json?.error || json?.message || text;
    } catch {
      return text;
    }
  } catch {
    return `Erro ${response.status}`;
  }
}

const ProcessarProjetoAnalysis: React.FC<Props> = ({
  apiFetch,
  onJobSnapshot,
  selectedJobId = null,
  historyEntry = null,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [layers, setLayers] = useState<GeometryLayer[]>([]);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

  const [importing, setImporting] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<boolean | null>(null);
  const [importRows, setImportRows] = useState<ErrorRow[]>([]);
  const [camadasRec, setCamadasRec] = useState<CamadaRec[]>([]);
  const [importRelatorio, setImportRelatorio] = useState<string | null>(null);
  const [importPdfUrl, setImportPdfUrl] = useState<string | null>(null);

  const [minOverlapM2, setMinOverlapM2] = useState('1');

  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [processErrors, setProcessErrors] = useState(0);
  const [importErrors, setImportErrors] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);
  const lastRestoredJobRef = useRef<string | null>(null);

  const polygonLayers = useMemo(
    () => layers.filter((l) => l.geometryType === 'Polygon' && l.featureCount > 0 && !l.ignoredReason),
    [layers],
  );

  const resetDraft = useCallback(() => {
    eventsAbortRef.current?.abort();
    eventsAbortRef.current = null;
    setFile(null);
    setUploading(false);
    setUploadId(null);
    setLayers([]);
    setUploadWarnings([]);
    setImporting(false);
    setImportId(null);
    setImportOk(null);
    setImportRows([]);
    setCamadasRec([]);
    setImportRelatorio(null);
    setImportPdfUrl(null);
    setMinOverlapM2('1');
    setProcessing(false);
    setJobId(null);
    setProgress(null);
    setError(null);
    setRows([]);
    setProcessErrors(0);
    setImportErrors(0);
    setWarnings([]);
    setDownloadUrl(null);
    setCompletedMessage(null);
    lastRestoredJobRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const startNewZip = useCallback(() => {
    resetDraft();
    // Abre o seletor logo após limpar, para reiniciar com outro ZIP.
    window.setTimeout(() => fileInputRef.current?.click(), 50);
  }, [resetDraft]);

  const applyZipFile = useCallback(
    async (picked: File | null) => {
      if (!picked) return;
      if (!picked.name.toLowerCase().endsWith('.zip')) {
        toast.error('Envie um arquivo .zip com os shapefiles.');
        return;
      }
      eventsAbortRef.current?.abort();
      setFile(picked);
      setUploadId(null);
      setLayers([]);
      setUploadWarnings([]);
      setImportId(null);
      setImportOk(null);
      setImportRows([]);
      setCamadasRec([]);
      setImportRelatorio(null);
      setImportPdfUrl(null);
      setRows([]);
      setWarnings([]);
      setDownloadUrl(null);
      setCompletedMessage(null);
      setError(null);
      setProgress(null);
      setJobId(null);
      setUploading(true);
      try {
        const zipBase64 = await fileToBase64(picked);
        const response = await apiFetch('/api/processar-projeto/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: picked.name, zipBase64 }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = await response.json();
        const visible: GeometryLayer[] = Array.isArray(payload?.layers) ? payload.layers : [];
        const newUploadId = String(payload?.uploadId || '');
        setUploadId(newUploadId);
        setLayers(visible);
        setUploadWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
        if (!visible.length) toast.error('Nenhuma camada poligonal encontrada no ZIP.');
        else toast.success('ZIP carregado. Clique em Importar.');
        // Card de rascunho no histórico (upload)
        onJobSnapshot?.({
          jobId: newUploadId,
          type: 'upload',
          status: 'uploaded',
          filename: picked.name,
          percent: 5,
          stage: 'uploaded',
          message: 'ZIP enviado — aguardando importação.',
          layers: visible,
          createdAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
        });
      } catch (err: any) {
        setError(err?.message || 'Falha ao enviar ZIP.');
        setFile(null);
      } finally {
        setUploading(false);
      }
    },
    [apiFetch, onJobSnapshot],
  );

  const runImport = useCallback(async () => {
    if (!uploadId) {
      toast.error('Envie o ZIP antes de importar.');
      return;
    }
    setImporting(true);
    setError(null);
    setImportRows([]);
    setImportOk(null);
    setImportPdfUrl(null);
    setCompletedMessage(null);
    setRows([]);
    setDownloadUrl(null);
    try {
      const response = await apiFetch('/api/processar-projeto/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const newImportId = String(payload?.importId || '');
      const ok = Boolean(payload?.ok);
      const rowsPayload: ErrorRow[] = Array.isArray(payload?.rows) ? payload.rows : [];
      const camadas: CamadaRec[] = Array.isArray(payload?.camadasReconhecidas) ? payload.camadasReconhecidas : [];
      const pdfUrl = payload?.pdfUrl ? String(payload.pdfUrl) : null;
      setImportId(newImportId);
      setImportOk(ok);
      setImportRows(rowsPayload);
      setCamadasRec(camadas);
      setImportRelatorio(payload?.relatorioTexto ? String(payload.relatorioTexto) : null);
      setImportErrors(Number(payload?.totalErrors || 0));
      setImportPdfUrl(pdfUrl);
      if (ok) toast.success('Importação OK — sem erros estruturais.');
      else toast.warning(`Importação com ${payload?.totalErrors || 0} inconsistência(s). PDF do relatório disponível.`);

      // Card de importação no histórico
      onJobSnapshot?.({
        jobId: newImportId,
        type: 'import',
        uploadId,
        status: ok ? 'import_ok' : 'import_failed',
        filename: file?.name || 'Projeto Geográfico',
        percent: ok ? 40 : 30,
        stage: ok ? 'import_ok' : 'import_failed',
        message: ok
          ? 'Importação aprovada.'
          : `Importação reprovada (${payload?.totalErrors || 0} erro(s)).`,
        ok,
        importOk: ok,
        rows: rowsPayload,
        importRows: rowsPayload,
        camadasReconhecidas: camadas,
        relatorioTexto: payload?.relatorioTexto || null,
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
        totalErrors: Number(payload?.totalErrors || 0),
        importErrors: Number(payload?.totalErrors || 0),
        pdfUrl,
        importPdfUrl: pdfUrl,
        createdAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
    } catch (err: any) {
      setError(err?.message || 'Falha na importação.');
    } finally {
      setImporting(false);
    }
  }, [apiFetch, file?.name, onJobSnapshot, uploadId]);

  const applySnapshot = useCallback(
    (job: any) => {
      if (!job) return;
      const status = String(job.status || '').toLowerCase();
      setProgress({
        stage: job.stage || status,
        percent: Number(job.percent || 0),
        message: job.message,
        layer: job.layer,
      });
      setProcessing(status === 'processing' || status === 'queued');
      if (job.uploadId) setUploadId(String(job.uploadId));
      if (job.importId) setImportId(String(job.importId));
      if (Array.isArray(job.resultRows)) setRows(job.resultRows as ErrorRow[]);
      if (Array.isArray(job.importRows)) {
        setImportRows(job.importRows as ErrorRow[]);
        setImportErrors(job.importRows.length);
      }
      if (Array.isArray(job.warnings)) setWarnings(job.warnings as string[]);
      if (job.downloadUrl) setDownloadUrl(String(job.downloadUrl));
      if (job.importPdfUrl || job.pdfUrl) setImportPdfUrl(String(job.importPdfUrl || job.pdfUrl));
      if (Array.isArray(job.camadasReconhecidas)) setCamadasRec(job.camadasReconhecidas as CamadaRec[]);
      if (typeof job.importOk === 'boolean') setImportOk(job.importOk);
      else if (status === 'import_ok') setImportOk(true);
      else if (status === 'import_failed') setImportOk(false);
      else if (status === 'completed' || status === 'processing' || status === 'queued') {
        // Process jobs only start after approved import.
        if (importOk === null) setImportOk(true);
      }
      if (job.relatorioTexto) setImportRelatorio(String(job.relatorioTexto));
      if (job.filename && !file) {
        // Placeholder file name display without real File blob.
        setFile(new File([], String(job.filename)));
      }
      if (status === 'completed') {
        setProcessErrors(Number(job.processErrors ?? job.totalErrors ?? 0));
        setImportErrors(Number(job.importErrors || 0));
        setCompletedMessage(String(job.message || 'Concluído.'));
        setError(null);
      } else if (status === 'failed') {
        setError(job.error || job.message || 'Falha ao processar projeto.');
      } else if (status === 'import_ok' || status === 'import_failed') {
        setImportOk(status === 'import_ok');
        if (Array.isArray(job.rows)) setImportRows(job.rows as ErrorRow[]);
        setImportErrors(Number(job.totalErrors || job.importErrors || (job.rows?.length ?? 0)));
      }
      onJobSnapshot?.(job);
    },
    [file, importOk, onJobSnapshot],
  );

  const connectEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/processar-projeto/jobs/${encodeURIComponent(id)}/events`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        if (!response.ok || !response.body) throw new Error(await readApiError(response));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt.type === 'snapshot' && evt.job) applySnapshot(evt.job);
              else if (evt.type === 'progress') applySnapshot(evt);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          /* stream end after complete is ok */
        }
      } finally {
        if (eventsAbortRef.current === controller) eventsAbortRef.current = null;
      }
    },
    [apiFetch, applySnapshot],
  );

  const runProcess = useCallback(async () => {
    if (!uploadId) {
      toast.error('Envie e importe o ZIP antes de processar.');
      return;
    }
    if (importOk !== true) {
      toast.error(
        importOk === false
          ? 'Situação da importação: Reprovado - Corrija os erros encontrados e envie novamente!'
          : 'Execute a importação antes de processar.',
      );
      return;
    }
    setProcessing(true);
    setError(null);
    setRows([]);
    setWarnings([]);
    setDownloadUrl(null);
    setCompletedMessage(null);
    setProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento ao servidor.' });
    try {
      const response = await apiFetch('/api/processar-projeto/processar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          importId: importId || undefined,
          settings: {
            minOverlapM2: Number(minOverlapM2) || 0,
          },
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const newJobId = String(payload?.jobId || '');
      setJobId(newJobId);
      onJobSnapshot?.({
        jobId: newJobId,
        type: 'process',
        uploadId,
        importId: importId || null,
        filename: file?.name || 'Projeto Geográfico',
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Processamento enviado ao servidor.',
        importOk: true,
        createdAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
      });
      void connectEvents(newJobId);
    } catch (err: any) {
      setProcessing(false);
      setError(err?.message || 'Falha ao iniciar processamento.');
    }
  }, [apiFetch, connectEvents, file?.name, importId, importOk, minOverlapM2, onJobSnapshot, uploadId]);

  const downloadZip = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      const response = await apiFetch(downloadUrl);
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `processar_projeto_${(jobId || 'resultado').slice(0, 8)}.zip`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success('Download iniciado.');
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao baixar ZIP.');
    }
  }, [apiFetch, downloadUrl, jobId]);

  const downloadImportPdf = useCallback(async () => {
    if (!importPdfUrl) return;
    try {
      const response = await apiFetch(importPdfUrl);
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `relatorio_importacao_geoforest_${(importId || 'import').slice(0, 8)}.pdf`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.success('PDF do relatório de importação baixado.');
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao baixar PDF de importação.');
    }
  }, [apiFetch, importId, importPdfUrl]);

  // Restaura job selecionado no histórico (cards laterais).
  useEffect(() => {
    const id = String(selectedJobId || historyEntry?.jobId || '').trim();
    if (!id || lastRestoredJobRef.current === id) return;
    lastRestoredJobRef.current = id;

    const restoreFromEntry = (entry: ProcessarHistoryItem | Record<string, unknown>) => {
      const status = String((entry as any).status || '').toLowerCase();
      const type = String((entry as any).type || '').toLowerCase();
      setJobId(type === 'process' ? String((entry as any).jobId || id) : null);
      setUploadId((entry as any).uploadId ? String((entry as any).uploadId) : type === 'upload' ? id : null);
      setImportId((entry as any).importId ? String((entry as any).importId) : type === 'import' ? id : null);
      if ((entry as any).filename) setFile(new File([], String((entry as any).filename)));
      setProgress({
        stage: String((entry as any).stage || status),
        percent: Number((entry as any).percent || 0),
        message: (entry as any).message ? String((entry as any).message) : undefined,
      });
      setProcessing(status === 'processing' || status === 'queued');
      if (Array.isArray((entry as any).resultRows)) setRows((entry as any).resultRows as ErrorRow[]);
      if (Array.isArray((entry as any).importRows)) {
        setImportRows((entry as any).importRows as ErrorRow[]);
      } else if (Array.isArray((entry as any).rows) && (type === 'import' || status.startsWith('import'))) {
        setImportRows((entry as any).rows as ErrorRow[]);
      }
      if (Array.isArray((entry as any).warnings)) setWarnings((entry as any).warnings as string[]);
      if (Array.isArray((entry as any).camadasReconhecidas)) {
        setCamadasRec((entry as any).camadasReconhecidas as CamadaRec[]);
      }
      if ((entry as any).downloadUrl) setDownloadUrl(String((entry as any).downloadUrl));
      if ((entry as any).importPdfUrl || (entry as any).pdfUrl) {
        setImportPdfUrl(String((entry as any).importPdfUrl || (entry as any).pdfUrl));
      }
      if (typeof (entry as any).importOk === 'boolean') setImportOk((entry as any).importOk);
      else if (status === 'import_ok' || status === 'completed' || status === 'processing') setImportOk(true);
      else if (status === 'import_failed') setImportOk(false);
      if ((entry as any).relatorioTexto) setImportRelatorio(String((entry as any).relatorioTexto));
      setImportErrors(Number((entry as any).importErrors || 0));
      setProcessErrors(Number((entry as any).processErrors || 0));
      if (status === 'completed') setCompletedMessage(String((entry as any).message || 'Concluído.'));
      if (status === 'failed') setError(String((entry as any).error || (entry as any).message || 'Falhou.'));
      else setError(null);
    };

    if (historyEntry && historyEntry.jobId === id) {
      restoreFromEntry(historyEntry);
    }

    // Busca snapshot fresco no backend (process/import/upload).
    void (async () => {
      try {
        const response = await apiFetch(`/api/processar-projeto/jobs/${encodeURIComponent(id)}/status`);
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.job) {
          restoreFromEntry(payload.job);
          if (String(payload.job.status || '').toLowerCase() === 'processing') {
            setJobId(id);
            void connectEvents(id);
          }
        }
      } catch {
        /* keep local restore */
      }
    })();
  }, [apiFetch, connectEvents, historyEntry, selectedJobId]);

  const canImport = Boolean(uploadId) && !uploading && !importing && !processing;
  // SIMCAR: Processar só libera com importação aprovada.
  const canProcess = Boolean(uploadId) && importOk === true && !processing && !importing;
  const hasWork = Boolean(file || uploadId || importId || jobId || downloadUrl || completedMessage);

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-2xl border border-cyan-500/15 bg-[#0a1214]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
              <FileStack size={13} />
              Processar projeto
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Projeto Geográfico (SIMCAR)
            </h2>
            <p className="max-w-3xl text-sm text-slate-400">
              Fluxo completo no espírito do SIMCAR: <strong className="text-slate-200">Importar</strong> e{' '}
              <strong className="text-slate-200">Processar</strong> (ProcessarGeo). O processamento gera{' '}
              <strong className="text-emerald-200">APP, APPP, APPD, APPRL, AURD, ARLDR</strong> por buffers oficiais
              do Código Florestal + topologia/Anexo 01, e empacota arquivo processado, enviado, conferência e erros
              de APP.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: '1', value: 'Importar' },
                { label: '2', value: 'Processar' },
                { label: 'Saída', value: 'ZIP' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xs font-semibold text-cyan-100">{item.value}</p>
                </div>
              ))}
            </div>
            {hasWork && (
              <button
                type="button"
                onClick={startNewZip}
                disabled={uploading || importing || processing}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw size={15} />
                Reiniciar com outro ZIP
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Upload */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">1. Upload do ZIP</h3>
            <p className="text-xs text-slate-500 mt-1">ZIP com shapefiles do Projeto Geográfico (ATP, AIR, AVN…).</p>
          </div>
          {uploading && <Loader2 size={18} className="animate-spin text-cyan-300" />}
        </div>
        <label
          className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all cursor-pointer ${
            file
              ? 'border-cyan-500/40 bg-cyan-500/5'
              : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-white/[0.03]'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            void applyZipFile(e.dataTransfer.files?.[0] || null);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => void applyZipFile(e.target.files?.[0] || null)}
          />
          <div
            className={`rounded-xl p-3 ${file ? 'bg-cyan-500/15 text-cyan-200' : 'bg-white/5 text-slate-400 group-hover:text-cyan-300'}`}
          >
            <Upload size={22} />
          </div>
          <div className="text-center min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {file ? file.name : 'Arraste ou selecione o ZIP do CAR/SIMCAR'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {file
                ? file.size > 0
                  ? `${(file.size / 1024).toFixed(0)} KB · ${polygonLayers.length} camada(s)`
                  : 'Restaurado do histórico'
                : 'Shapefiles em .zip'}
            </p>
          </div>
          {file && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resetDraft();
              }}
              className="text-xs text-slate-400 underline hover:text-slate-200"
            >
              Limpar
            </button>
          )}
        </label>
        {uploadWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90 space-y-1">
            {uploadWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
      </section>

      {/* Importar */}
      {uploadId && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">2. Importar (conformidade estrutural)</h3>
              <p className="text-xs text-slate-500 mt-1">
                Equivalente à fila <code className="text-cyan-200/80">[CAR_IMPORTAR_SHAPEFILE]</code>: CRS SIRGAS 2000,
                2D, nomenclatura, ATP única, atributos e topologia do importador (borda se cruza / pontos repetidos).
                Se reprovar, o Processar não libera.
              </p>
            </div>
            <button
              type="button"
              disabled={!canImport}
              onClick={() => void runImport()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Importar
            </button>
          </div>

          {importOk !== null && (
            <div
              className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between rounded-xl border px-4 py-3 ${
                importOk
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/25 bg-rose-500/10 text-rose-100'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {importOk ? <CheckCircle2 size={20} className="shrink-0 mt-0.5" /> : <XCircle size={20} className="shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {importOk
                      ? 'Situação da importação: Aprovado'
                      : `Situação da importação: Reprovado (${importErrors} erro(s))`}
                  </p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {importOk
                      ? 'Importação OK — conformidade e topologia sem inconsistências. O Processar está liberado.'
                      : 'Corrija os erros encontrados e envie novamente! O processamento não é liberado com importação reprovada.'}
                  </p>
                </div>
              </div>
              {importPdfUrl && (
                <button
                  type="button"
                  onClick={() => void downloadImportPdf()}
                  className="inline-flex items-center justify-center gap-2 shrink-0 rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <FileText size={14} />
                  Baixar PDF da importação
                </button>
              )}
            </div>
          )}

          {camadasRec.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Camada</th>
                    <th className="px-3 py-2 font-semibold">Código SIMCAR</th>
                    <th className="px-3 py-2 font-semibold">Feições</th>
                    <th className="px-3 py-2 font-semibold">CRS</th>
                  </tr>
                </thead>
                <tbody>
                  {camadasRec.map((c) => (
                    <tr key={c.name} className="border-t border-white/5 text-slate-200">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2">{c.code || <span className="text-rose-300">—</span>}</td>
                      <td className="px-3 py-2 tabular-nums">{c.featureCount}</td>
                      <td className="px-3 py-2">{c.crsLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-rose-500/20 max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#121a18] text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Camada</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, i) => (
                    <tr key={`${row.camada}-${row.tipo}-${i}`} className="border-t border-white/5">
                      <td className="px-3 py-2 text-slate-200">{row.camada}</td>
                      <td className="px-3 py-2 text-rose-200">{TIPO_LABEL[row.tipo] || row.tipo}</td>
                      <td className="px-3 py-2 text-slate-400">{row.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Processar */}
      {importOk !== null && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">3. Processar Projeto Geográfico</h3>
              <p className="text-xs text-slate-500 mt-1">
                Equivalente a <code className="text-cyan-200/80">[CAR_PROCESSAR_GEOMETRIAS]</code> / ProcessarGeo:
                sobreposição, vazios, contenção/sobreposição proibida (Anexo 01), soma AIR×ATP e camadas APP*.
                Bloqueado enquanto a importação estiver reprovada.
              </p>
              {importOk === false && (
                <p className="text-xs text-rose-300 mt-2 font-medium">
                  Processar desabilitado — corrija os erros de importação primeiro.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={!canProcess}
              onClick={() => void runProcess()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              title={
                importOk === false
                  ? 'Importação reprovada — processamento não liberado'
                  : importOk === true
                    ? 'Processar projeto geográfico'
                    : 'Importe o ZIP antes de processar'
              }
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : <Cpu size={16} />}
              Processar projeto
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 max-w-sm">
            <span className="text-xs text-slate-400">Área mínima de sobreposição/vazio (m²)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={minOverlapM2}
              onChange={(e) => setMinOverlapM2(e.target.value)}
              className="w-24 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
            />
          </div>

          {progress && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  {progress.layer || progress.stage || '…'}
                </span>
                <span className="tabular-nums text-cyan-300 font-bold">{progress.percent ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-400 transition-all duration-500"
                  style={{ width: `${Math.min(100, Number(progress.percent || 0))}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">{progress.message}</p>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {(rows.length > 0 || downloadUrl || completedMessage) && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">4. Resultados</h3>
              <p className="text-xs text-slate-500 mt-1">
                {completedMessage ||
                  `${rows.length} linha(s) · importação ${importErrors} · processamento ${processErrors || rows.length}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {downloadUrl && (
                <button
                  type="button"
                  onClick={() => void downloadZip()}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
                >
                  <Download size={16} />
                  Baixar ZIP completo
                </button>
              )}
              <button
                type="button"
                onClick={startNewZip}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-white/[0.08]"
              >
                <Plus size={16} />
                Novo projeto (outro ZIP)
              </button>
            </div>
          </div>

          {downloadUrl && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100/90 space-y-1">
              <p className="font-semibold text-emerald-100">Conteúdo do ZIP (estilo SIMCAR)</p>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                <li>
                  <code className="text-emerald-200">arquivo_processado.zip</code> — limpos +{' '}
                  <strong>APP / APPP / APPD / APPRL / AURD / ARLDR</strong>
                </li>
                <li>
                  <code className="text-emerald-200">arquivo_enviado.zip</code> — shapefiles originais
                </li>
                <li>
                  <code className="text-emerald-200">arquivo_conferencia.zip</code> — camadas com area_m2 / area_ha
                </li>
                <li>
                  <code className="text-emerald-200">erros_processamento.zip</code> — topologia / Anexo 01
                </li>
                <li>
                  <code className="text-emerald-200">erros_processamento_app.zip</code> — erros de cálculo de APP
                </li>
                <li>
                  <code className="text-slate-200">quadro_areas.csv</code> (inclui APP*) + relatórios
                </li>
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90 space-y-1 max-h-32 overflow-y-auto">
              {warnings.map((w, i) => (
                <p key={`${w}-${i}`}>{w}</p>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10 max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#121a18] text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Camada</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Feição</th>
                    <th className="px-3 py-2">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.camada}-${row.tipo}-${row.feicao}-${i}`} className="border-t border-white/5">
                      <td className="px-3 py-2 text-slate-200">{row.camada}</td>
                      <td className="px-3 py-2 text-cyan-200">{TIPO_LABEL[row.tipo] || row.tipo}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-400">{row.feicao || '—'}</td>
                      <td className="px-3 py-2 text-slate-400 max-w-md">{row.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importRelatorio && (
            <details className="rounded-xl border border-white/10 bg-black/20">
              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-300">
                Relatório de importação (texto)
              </summary>
              <pre className="px-4 pb-4 text-[11px] text-slate-500 whitespace-pre-wrap overflow-x-auto max-h-48">
                {importRelatorio}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
};

export default ProcessarProjetoAnalysis;
