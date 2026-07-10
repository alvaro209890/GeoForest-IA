import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Layers,
  Loader2,
  Plus,
  ShieldAlert,
  Square,
  Target,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
) => Promise<Response>;

type ContainmentLayer = {
  id: string;
  name: string;
  path: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  missingCrs: boolean;
  ignoredReason?: string;
};

export type ContainmentRow = {
  alvo: string;
  feicao: number;
  parte: number;
  area_ha: number;
  area_m2: number;
  x: number;
  y: number;
  contido_em: string;
};

type ContainmentProgress = {
  stage?: string;
  percent?: number;
  message?: string;
};

export type ContainmentSummary = {
  targetName?: string;
  containerNames?: string[];
  totalTargetFeatures?: number;
  featuresWithGap?: number;
  totalAreaHa?: number;
  metricLabel?: string;
  crsLabel?: string;
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

const ContainmentAnalysis: React.FC<Props> = ({ apiFetch, onJobSnapshot }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [layers, setLayers] = useState<ContainmentLayer[]>([]);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

  const [targetLayerId, setTargetLayerId] = useState<string | null>(null);
  const [containerLayerIds, setContainerLayerIds] = useState<Set<string>>(new Set());
  const [minAreaM2, setMinAreaM2] = useState<string>('1');

  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ContainmentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<ContainmentRow[]>([]);
  const [summary, setSummary] = useState<ContainmentSummary | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const analyzableLayers = useMemo(
    () => layers.filter((l) => l.geometryType === 'Polygon' && l.featureCount > 0 && !l.ignoredReason),
    [layers],
  );
  const targetLayer = useMemo(() => layers.find((l) => l.id === targetLayerId) || null, [layers, targetLayerId]);
  const containerLayers = useMemo(
    () => layers.filter((l) => containerLayerIds.has(l.id)),
    [layers, containerLayerIds],
  );

  const resetDraft = useCallback(() => {
    eventsAbortRef.current?.abort();
    eventsAbortRef.current = null;
    setFile(null);
    setUploading(false);
    setUploadId(null);
    setLayers([]);
    setUploadWarnings([]);
    setTargetLayerId(null);
    setContainerLayerIds(new Set());
    setMinAreaM2('1');
    setProcessing(false);
    setJobId(null);
    setProgress(null);
    setError(null);
    setRows([]);
    setSummary(null);
    setWarnings([]);
    setDownloadUrl(null);
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
      setTargetLayerId(null);
      setContainerLayerIds(new Set());
      setRows([]);
      setSummary(null);
      setWarnings([]);
      setDownloadUrl(null);
      setError(null);
      setProgress(null);
      setUploading(true);
      try {
        const zipBase64 = await fileToBase64(picked);
        const response = await apiFetch('/api/containment/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: picked.name, zipBase64 }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = await response.json();
        const visible: ContainmentLayer[] = Array.isArray(payload?.layers) ? payload.layers : [];
        setUploadId(String(payload?.uploadId || ''));
        setLayers(visible);
        setUploadWarnings(Array.isArray(payload?.warnings) ? payload.warnings : []);
        if (!visible.length) toast.error('Nenhuma camada poligonal encontrada no ZIP.');
      } catch (err: any) {
        setError(err?.message || 'Falha ao importar ZIP.');
        setFile(null);
      } finally {
        setUploading(false);
      }
    },
    [apiFetch],
  );

  const toggleContainer = useCallback((id: string) => {
    setContainerLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pickTarget = useCallback((id: string) => {
    setTargetLayerId(id);
    setContainerLayerIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const applySnapshot = useCallback((job: any) => {
    if (!job) return;
    const status = String(job.status || '').toLowerCase();
    setProgress({ stage: job.stage || status, percent: Number(job.percent || 0), message: job.message });
    setProcessing(status === 'processing' || status === 'queued');
    if (Array.isArray(job.resultRows)) setRows(job.resultRows as ContainmentRow[]);
    if (Array.isArray(job.warnings)) setWarnings(job.warnings as string[]);
    if (job.downloadUrl) setDownloadUrl(String(job.downloadUrl));
    if (status === 'completed') {
      setSummary({
        targetName: job.targetName,
        containerNames: job.containerNames,
        totalTargetFeatures: job.totalTargetFeatures,
        featuresWithGap: job.featuresWithGap,
        totalAreaHa: job.totalAreaHa,
        metricLabel: job.metricLabel,
        crsLabel: job.crsLabel,
      });
      setError(null);
    } else if (status === 'failed') {
      setError(job.error || job.message || 'Falha ao processar análise.');
    }
    // Report snapshot to parent (Dashboard) for sidebar history persistence
    onJobSnapshot?.(job);
  }, [onJobSnapshot]);

  const connectEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/containment/jobs/${encodeURIComponent(id)}/events`, {
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
              else if (evt.type === 'heartbeat') { /* keep-alive */ }
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // A stream drop after completion is expected; only surface if still processing.
        }
      } finally {
        if (eventsAbortRef.current === controller) eventsAbortRef.current = null;
      }
    },
    [apiFetch, applySnapshot],
  );

  const startProcessing = useCallback(async () => {
    if (!uploadId) {
      toast.error('Importe o ZIP antes de processar.');
      return;
    }
    if (!targetLayerId) {
      toast.error('Selecione a camada-alvo (que deve estar contida).');
      return;
    }
    if (containerLayerIds.size === 0) {
      toast.error('Selecione ao menos uma camada-continente.');
      return;
    }
    setProcessing(true);
    setError(null);
    setRows([]);
    setSummary(null);
    setWarnings([]);
    setDownloadUrl(null);
    setProgress({ stage: 'queued', percent: 1, message: 'Enviando análise ao servidor.' });
    try {
      const response = await apiFetch('/api/containment/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          targetLayerId,
          containerLayerIds: [...containerLayerIds],
          minAreaM2: Number(minAreaM2) || 0,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const newJobId = String(payload?.jobId || '');
      setJobId(newJobId);
      void connectEvents(newJobId);
    } catch (err: any) {
      setProcessing(false);
      setError(err?.message || 'Falha ao iniciar análise.');
    }
  }, [apiFetch, connectEvents, containerLayerIds, minAreaM2, targetLayerId, uploadId]);

  const downloadZip = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      const response = await apiFetch(downloadUrl);
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `areas_nao_contidas_${(jobId || 'resultado').slice(0, 8)}.zip`;
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

  const canProcess = Boolean(uploadId) && Boolean(targetLayerId) && containerLayerIds.size > 0 && !processing;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ─── Hero / explicação didática ─── */}
      <section className="rounded-2xl border border-rose-500/15 bg-[#12090d]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-200">
              <ShieldAlert size={13} />
              Áreas Não Contidas
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Regra de containment do SIMCAR
            </h2>
            <p className="max-w-3xl text-sm text-slate-400">
              O validador da SEMA reprova quando uma camada não está <strong className="text-slate-200">completamente contida</strong>{' '}
              por outras — por exemplo,{' '}
              <span className="text-rose-200">AREA_UMIDA</span> deve caber dentro de{' '}
              <span className="text-emerald-200">AVN + AUAS + AREA_CONSOLIDADA</span>. Aqui você escolhe a camada-alvo e as
              camadas-continente, e o sistema calcula a diferença geométrica e gera os polígonos (e pontos) das áreas que
              "sobram".
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Entrada', value: '.zip' },
              { label: 'Operação', value: 'alvo − ∪' },
              { label: 'Saída', value: 'SHP' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                <p className="mt-1 text-xs font-semibold text-rose-100">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 1. Upload ─── */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">1. Upload do ZIP</h3>
            <p className="text-xs text-slate-500 mt-1">
              Envie o ZIP do CAR/SIMCAR. Somente camadas poligonais com feições entram na análise.
            </p>
          </div>
          {uploading && <Loader2 size={18} className="animate-spin text-rose-300" />}
        </div>
        <label
          className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
            file
              ? 'border-rose-500/40 bg-rose-500/5'
              : 'border-white/10 bg-white/[0.02] hover:border-rose-500/30 hover:bg-white/[0.03]'
          } cursor-pointer`}
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
          <div className={`rounded-xl p-3 ${file ? 'bg-rose-500/15 text-rose-200' : 'bg-white/5 text-slate-400 group-hover:text-rose-300'}`}>
            <Upload size={22} />
          </div>
          <div className="text-center min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {file ? file.name : 'Arraste ou selecione o ZIP do CAR/SIMCAR'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {file ? `${(file.size / 1024).toFixed(0)} KB` : 'Shapefiles compactados em .zip'}
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
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
              aria-label="Remover ZIP"
            >
              <Trash2 size={16} />
            </button>
          )}
        </label>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
        {uploadWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
            {uploadWarnings.map((w, i) => (
              <p key={`${w}-${i}`}>{w}</p>
            ))}
          </div>
        )}
      </section>

      {/* ─── 2. Definir a regra ─── */}
      {analyzableLayers.length > 0 && (
        <section className="relative overflow-hidden rounded-3xl border border-rose-400/15 bg-gradient-to-br from-[#140b0f]/95 via-[#131019]/90 to-[#0d1512]/90 p-4 shadow-2xl shadow-black/20 sm:p-6">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-rose-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative space-y-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-100">
                <Layers size={13} />
                Definição da regra
              </div>
              <h3 className="mt-3 text-lg font-bold text-white">2. Quem deve estar contido em quem?</h3>
              <p className="mt-1 text-xs text-slate-400">
                Marque <strong className="text-rose-200">1 camada-alvo</strong> (a que precisa estar contida) e{' '}
                <strong className="text-emerald-200">1 ou mais continentes</strong> (as que devem cobri-la).
              </p>
            </div>

            {/* Frase-resumo da regra */}
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm">
              {targetLayer ? (
                <p className="text-slate-300">
                  <span className="font-bold text-rose-200">{targetLayer.name}</span>{' '}
                  <span className="text-slate-500">deve estar contida em</span>{' '}
                  {containerLayers.length ? (
                    <span className="font-bold text-emerald-200">{containerLayers.map((l) => l.name).join(' + ')}</span>
                  ) : (
                    <span className="italic text-slate-500">selecione ao menos um continente…</span>
                  )}
                </p>
              ) : (
                <p className="italic text-slate-500">Selecione a camada-alvo para montar a regra…</p>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-xs">
                  <thead>
                    <tr className="bg-white/[0.06] text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-3 pl-4 font-bold text-center">Alvo</th>
                      <th className="px-3 py-3 font-bold text-center">Continente</th>
                      <th className="px-3 py-3 font-bold">Camada</th>
                      <th className="px-3 py-3 font-bold">Feições</th>
                      <th className="px-3 py-3 pr-4 font-bold">CRS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyzableLayers.map((layer, index) => {
                      const isTarget = targetLayerId === layer.id;
                      const isContainer = containerLayerIds.has(layer.id);
                      return (
                        <tr
                          key={layer.id}
                          className={`transition-colors ${index % 2 === 0 ? 'bg-white/[0.015]' : 'bg-transparent'} ${
                            isTarget ? 'bg-rose-500/[0.08]' : isContainer ? 'bg-emerald-500/[0.06]' : 'hover:bg-white/[0.04]'
                          } text-slate-200`}
                        >
                          {/* Alvo (radio) */}
                          <td className="border-t border-white/5 px-3 py-3 pl-4 align-middle text-center">
                            <button
                              type="button"
                              onClick={() => pickTarget(layer.id)}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                                isTarget
                                  ? 'border-rose-300/50 bg-rose-500/25 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.2)]'
                                  : 'border-white/10 bg-white/[0.04] text-slate-500 hover:border-rose-300/30 hover:text-rose-200'
                              }`}
                              aria-label={`Definir ${layer.name} como alvo`}
                            >
                              <Target size={17} />
                            </button>
                          </td>
                          {/* Continente (checkbox) */}
                          <td className="border-t border-white/5 px-3 py-3 align-middle text-center">
                            <button
                              type="button"
                              onClick={() => toggleContainer(layer.id)}
                              disabled={isTarget}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                                isContainer
                                  ? 'border-emerald-300/50 bg-emerald-500/25 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.2)]'
                                  : 'border-white/10 bg-white/[0.04] text-slate-500 hover:border-emerald-300/30 hover:text-emerald-200'
                              }`}
                              aria-label={`Marcar ${layer.name} como continente`}
                            >
                              {isContainer ? <CheckCircle2 size={17} /> : <Square size={15} />}
                            </button>
                          </td>
                          <td className="max-w-[260px] border-t border-white/5 px-3 py-3 align-middle">
                            <p className="truncate font-bold text-white">{layer.name}</p>
                            {layer.path && <p className="mt-0.5 truncate text-[10px] text-slate-500">{layer.path}</p>}
                          </td>
                          <td className="border-t border-white/5 px-3 py-3 align-middle font-semibold tabular-nums text-slate-100">
                            {layer.featureCount}
                          </td>
                          <td className="max-w-[160px] border-t border-white/5 px-3 py-3 pr-4 align-middle">
                            <span className="block truncate text-slate-300" title={layer.crsLabel}>
                              {layer.crsLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Área mínima */}
            <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-md">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Área mínima (m²)</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Fragmentos menores que este valor são descartados. Ao longo de bordas quase coincidentes o cálculo gera
                  "frestas" de poucos cm² que não são erros reais — o padrão de <strong className="text-slate-300">1 m²</strong>{' '}
                  filtra esse ruído. Use <strong className="text-slate-300">0</strong> para ver absolutamente tudo.
                </p>
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                value={minAreaM2}
                onChange={(e) => setMinAreaM2(e.target.value)}
                className="w-28 shrink-0 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none transition focus:border-rose-400/60 focus:bg-rose-500/10"
              />
            </div>
          </div>
        </section>
      )}

      {/* ─── 3. Processar ─── */}
      {analyzableLayers.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">3. Processamento</h3>
              <p className="text-xs text-slate-500 mt-1">
                Calcula <span className="text-slate-300">alvo − união(continentes)</span> feição por feição.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startProcessing()}
              disabled={!canProcess}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
              Analisar containment
            </button>
          </div>
          {progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">{progress.stage}</span>
                <span className="font-bold tabular-nums text-rose-300">{progress.percent || 0}%</span>
              </div>
              <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${progress.percent || 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">{progress.message}</p>
            </div>
          )}
        </section>
      )}

      {/* ─── 4. Resultado ─── */}
      {(rows.length > 0 || downloadUrl || summary || warnings.length > 0) && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">4. Resultado</h3>
              <p className="text-xs text-slate-500 mt-1">
                {rows.length > 0
                  ? `${rows.length} polígono(s) não contido(s).`
                  : summary
                    ? 'Camada-alvo totalmente contida. ✔'
                    : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {downloadUrl && (
                <button
                  type="button"
                  onClick={() => void downloadZip()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  <Download size={16} />
                  Baixar ZIP
                </button>
              )}
              <button
                type="button"
                onClick={resetDraft}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 hover:bg-rose-500/15"
              >
                <Plus size={16} />
                Nova análise
              </button>
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Feições alvo', value: summary.totalTargetFeatures ?? '—' },
                { label: 'Com erro', value: summary.featuresWithGap ?? '—', danger: (summary.featuresWithGap || 0) > 0 },
                { label: 'Polígonos', value: rows.length },
                { label: 'Área total (ha)', value: (summary.totalAreaHa ?? 0).toFixed(4) },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-2xl border px-3 py-3 text-center ${
                    (item as any).danger
                      ? 'border-rose-400/25 bg-rose-500/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className={`mt-1 text-lg font-black tabular-nums ${(item as any).danger ? 'text-rose-200' : 'text-white'}`}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {summary && (summary.crsLabel || summary.metricLabel) && (
            <p className="text-[11px] text-slate-500">
              CRS de saída: <span className="text-slate-300">{summary.crsLabel}</span> · Área medida em{' '}
              <span className="text-slate-300">{summary.metricLabel}</span>
              {summary.containerNames?.length ? (
                <>
                  {' '}· Continentes: <span className="text-slate-300">{summary.containerNames.join(', ')}</span>
                </>
              ) : null}
            </p>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
              {warnings.map((w, i) => (
                <p key={`${w}-${i}`}>{w}</p>
              ))}
            </div>
          )}

          {rows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    {['Camada alvo', 'Feição', 'Parte', 'Área (ha)', 'Área (m²)', 'X', 'Y'].map((head) => (
                      <th key={head} className="px-3 py-2">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-slate-200">
                  {rows.map((row, index) => (
                    <tr key={`${row.alvo}-${row.feicao}-${row.parte}-${index}`}>
                      <td className="px-3 py-2 font-semibold text-white">{row.alvo}</td>
                      <td className="px-3 py-2 tabular-nums">{row.feicao}</td>
                      <td className="px-3 py-2 tabular-nums">{row.parte}</td>
                      <td className="px-3 py-2 tabular-nums text-rose-200">{Number(row.area_ha || 0).toFixed(6)}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(row.area_m2 || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(row.x || 0).toFixed(8)}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(row.y || 0).toFixed(8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : summary ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              <CheckCircle2 size={20} />
              <span>
                Nenhuma área não contida encontrada (acima de {minAreaM2 || 0} m²). A camada-alvo está totalmente contida
                pelos continentes selecionados.
              </span>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
};

export default ContainmentAnalysis;
