import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileStack,
  Loader2,
  Play,
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

const TIPO_LABEL: Record<string, string> = {
  borda_se_cruza: 'Borda se cruza',
  vertice_duplicado: 'Vértice duplicado',
  anel_degenerado: 'Anel degenerado',
  sobreposicao: 'Sobreposição',
  vazio: 'Vazio/gap',
  air_atp_area: 'Soma AIR ≠ ATP',
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

const ProcessarProjetoAnalysis: React.FC<Props> = ({ apiFetch, onJobSnapshot }) => {
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

  const [generateFixed, setGenerateFixed] = useState(true);
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
    setGenerateFixed(true);
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

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
      setRows([]);
      setWarnings([]);
      setDownloadUrl(null);
      setCompletedMessage(null);
      setError(null);
      setProgress(null);
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
        setUploadId(String(payload?.uploadId || ''));
        setLayers(visible);
        setUploadWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
        if (!visible.length) toast.error('Nenhuma camada poligonal encontrada no ZIP.');
        else toast.success('ZIP carregado. Clique em Importar.');
      } catch (err: any) {
        setError(err?.message || 'Falha ao enviar ZIP.');
        setFile(null);
      } finally {
        setUploading(false);
      }
    },
    [apiFetch],
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
      setImportId(String(payload?.importId || ''));
      setImportOk(Boolean(payload?.ok));
      setImportRows(Array.isArray(payload?.rows) ? payload.rows : []);
      setCamadasRec(Array.isArray(payload?.camadasReconhecidas) ? payload.camadasReconhecidas : []);
      setImportRelatorio(payload?.relatorioTexto ? String(payload.relatorioTexto) : null);
      setImportErrors(Number(payload?.totalErrors || 0));
      if (payload?.ok) toast.success('Importação OK — sem erros estruturais.');
      else toast.warning(`Importação com ${payload?.totalErrors || 0} inconsistência(s).`);
    } catch (err: any) {
      setError(err?.message || 'Falha na importação.');
    } finally {
      setImporting(false);
    }
  }, [apiFetch, uploadId]);

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
      if (Array.isArray(job.resultRows)) setRows(job.resultRows as ErrorRow[]);
      if (Array.isArray(job.warnings)) setWarnings(job.warnings as string[]);
      if (job.downloadUrl) setDownloadUrl(String(job.downloadUrl));
      if (status === 'completed') {
        setProcessErrors(Number(job.processErrors ?? job.totalErrors ?? 0));
        setImportErrors(Number(job.importErrors || 0));
        setCompletedMessage(String(job.message || 'Concluído.'));
        setError(null);
      } else if (status === 'failed') {
        setError(job.error || job.message || 'Falha ao processar projeto.');
      }
      onJobSnapshot?.(job);
    },
    [onJobSnapshot],
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
    if (importOk === null && !importId) {
      toast.error('Execute a importação antes de processar.');
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
            generateFixed,
            minOverlapM2: Number(minOverlapM2) || 0,
          },
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const newJobId = String(payload?.jobId || '');
      setJobId(newJobId);
      void connectEvents(newJobId);
    } catch (err: any) {
      setProcessing(false);
      setError(err?.message || 'Falha ao iniciar processamento.');
    }
  }, [apiFetch, connectEvents, generateFixed, importId, importOk, minOverlapM2, uploadId]);

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

  const canImport = Boolean(uploadId) && !uploading && !importing && !processing;
  const canProcess = Boolean(uploadId) && importOk !== null && !processing && !importing;

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
              Projeto Geográfico (estilo SIMCAR)
            </h2>
            <p className="max-w-3xl text-sm text-slate-400">
              Pré-validação local em <strong className="text-cyan-200">dois passos</strong>, como no Importador GEO da
              SEMA: <strong className="text-slate-200">Importar</strong> (estrutura: CRS, 2D, nomenclatura, atributos) e{' '}
              <strong className="text-slate-200">Processar</strong> (topologia, Anexo 01, soma AIR×ATP). O ZIP de saída
              inclui <strong className="text-emerald-200">arquivo processado</strong>, arquivo enviado, conferência,
              erros e quadro de áreas (estilo SIMCAR).{' '}
              <strong className="text-amber-200">Não substitui</strong> o validador oficial da SEMA.
            </p>
          </div>
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
              {file ? `${(file.size / 1024).toFixed(0)} KB · ${polygonLayers.length} camada(s)` : 'Shapefiles em .zip'}
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
                2D, nomenclatura, ATP única e atributos obrigatórios.
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
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                importOk
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-rose-500/25 bg-rose-500/10 text-rose-100'
              }`}
            >
              {importOk ? <CheckCircle2 size={20} className="shrink-0 mt-0.5" /> : <XCircle size={20} className="shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-semibold">
                  {importOk ? 'Importação OK' : `Importação com ${importErrors} inconsistência(s)`}
                </p>
                <p className="text-xs opacity-80 mt-0.5">
                  {importOk
                    ? 'Estrutura do ZIP alinhada às regras de conformidade do Manual SIMCAR.'
                    : 'Corrija os itens abaixo antes de enviar ao SIMCAR oficial (ou processe mesmo assim para ver topologia).'}
                </p>
              </div>
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
                Equivalente a <code className="text-cyan-200/80">[CAR_PROCESSAR_GEOMETRIAS]</code>: auto-interseção,
                vértices, sobreposição, vazios, contenção/sobreposição proibida (Anexo 01) e soma AIR×ATP.
              </p>
            </div>
            <button
              type="button"
              disabled={!canProcess}
              onClick={() => void runProcess()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : <Cpu size={16} />}
              Processar projeto
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={generateFixed}
                onChange={(e) => setGenerateFixed(e.target.checked)}
                className="rounded border-white/20"
              />
              <span className="text-xs text-slate-300">
                Gerar camadas corrigidas (unkink / limpar vértices)
              </span>
            </label>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="text-xs text-slate-400">Área mínima (m²)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={minOverlapM2}
                onChange={(e) => setMinOverlapM2(e.target.value)}
                className="w-24 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
              />
            </div>
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
          </div>

          {downloadUrl && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100/90 space-y-1">
              <p className="font-semibold text-emerald-100">Conteúdo do ZIP (estilo SIMCAR)</p>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-300">
                <li>
                  <code className="text-emerald-200">arquivo_processado.zip</code> — projeto limpo (vértices +
                  unkink)
                </li>
                <li>
                  <code className="text-emerald-200">arquivo_enviado.zip</code> — shapefiles originais
                </li>
                <li>
                  <code className="text-emerald-200">arquivo_conferencia.zip</code> — camadas com area_m2 / area_ha
                </li>
                <li>
                  <code className="text-emerald-200">erros_processamento.zip</code> — pontos e polígonos de erro
                </li>
                <li>
                  <code className="text-slate-200">quadro_areas.csv</code>, relatórios e pastas espelhadas no SIG
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
