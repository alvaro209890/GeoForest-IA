import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Layers,
  Loader2,
  Plus,
  Square,
  Trash2,
  Upload,
  Wrench,
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
  path: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  missingCrs: boolean;
  ignoredReason?: string;
};

export type GeometryErrorRow = {
  camada: string;
  tipo: string;
  feicao: number;
  parte: number;
  anel: number;
  x: number;
  y: number;
  detalhe: string;
};

type GeometryProgress = {
  stage?: string;
  percent?: number;
  message?: string;
};

type GeometrySummary = {
  totalErrors?: number;
  featuresWithErrors?: number;
  analyzedLayers?: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  fixedLayers?: Array<{ name: string; fixedFeatures: number }>;
};

type CheckDef = {
  id: string;
  label: string;
  description: string;
};

const CHECKS: CheckDef[] = [
  {
    id: 'selfIntersection',
    label: 'Borda de polígono se cruza',
    description: 'Auto-interseção: segmentos do mesmo anel se cruzam. O SIMCAR reprova com "Borda de polígono se cruza".',
  },
  {
    id: 'duplicateVertices',
    label: 'Vértices duplicados / anéis degenerados',
    description:
      'Vértices consecutivos idênticos no mesmo anel e anéis colapsados com menos de 3 vértices distintos. A correção remove os repetidos e descarta anéis inválidos.',
  },
  {
    id: 'overlaps',
    label: 'Sobreposição entre feições da mesma camada',
    description:
      'Feições de uma mesma camada que se sobrepõem. O ZIP inclui poligonos_sobreposicao.shp com a área exata de cada sobreposição (sem correção automática — decida no SIG qual feição recortar).',
  },
  {
    id: 'simcarConformity',
    label: 'Conformidade SIMCAR (CRS, 2D, nomenclatura, atributos)',
    description:
      'Estrutura padrão do Importador GEO da SEMA-MT: SIRGAS 2000 geográfico, shapefile 2D, primitiva correta (rio = polígono), nomenclatura oficial (ATP, AIR, AVN, AUAS...), ATP única e atributos obrigatórios no .dbf. Verifica o ZIP inteiro, independentemente das camadas marcadas.',
  },
  {
    id: 'simcarContainment',
    label: 'Contenção do Anexo 01 (AVN ⊂ AIR, AIR ⊂ ATP, ...)',
    description:
      'Regras de contenção impeditivas do Anexo 01 "Validações GEO" do SIMCAR, aplicadas automaticamente pela nomenclatura: AIR dentro da ATP; AVN/AUAS/ÁREA CONSOLIDADA/PANTANEIRA dentro da AIR; VEREDA/MANGUEZAL/RESTINGA/ARL dentro da AIR e da AVN; relevo dentro da ATP. Gera poligonos_regras_simcar.shp com as sobras. Verifica o ZIP inteiro.',
  },
];

const TIPO_LABEL: Record<string, string> = {
  borda_se_cruza: 'Borda se cruza',
  vertice_duplicado: 'Vértice duplicado',
  anel_degenerado: 'Anel degenerado',
  sobreposicao: 'Sobreposição',
  nomenclatura_desconhecida: 'Nomenclatura fora do padrão',
  crs_ausente: 'CRS ausente',
  crs_nao_conforme: 'CRS não conforme',
  dimensao_nao_2d: 'Shapefile não é 2D',
  primitiva_incorreta: 'Primitiva incorreta',
  atp_multipla: 'ATP com várias feições',
  atributo_ausente: 'Atributo obrigatório ausente',
  feicao_obrigatoria_ausente: 'Feição obrigatória ausente',
  fora_do_continente: 'Fora do continente (Anexo 01)',
};

type Props = {
  apiFetch: ApiFetch;
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

const GeometryErrorsAnalysis: React.FC<Props> = ({ apiFetch }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [layers, setLayers] = useState<GeometryLayer[]>([]);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);

  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
  const [enabledChecks, setEnabledChecks] = useState<Set<string>>(new Set(CHECKS.map((c) => c.id)));
  const [generateFixed, setGenerateFixed] = useState(true);
  const [minOverlapM2, setMinOverlapM2] = useState<string>('1');

  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GeometryProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<GeometryErrorRow[]>([]);
  const [summary, setSummary] = useState<GeometrySummary | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const analyzableLayers = useMemo(
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
    setSelectedLayerIds(new Set());
    setEnabledChecks(new Set(CHECKS.map((c) => c.id)));
    setGenerateFixed(true);
    setMinOverlapM2('1');
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
      setSelectedLayerIds(new Set());
      setRows([]);
      setSummary(null);
      setWarnings([]);
      setDownloadUrl(null);
      setError(null);
      setProgress(null);
      setUploading(true);
      try {
        const zipBase64 = await fileToBase64(picked);
        const response = await apiFetch('/api/geometry-errors/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: picked.name, zipBase64 }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = await response.json();
        const visible: GeometryLayer[] = Array.isArray(payload?.layers) ? payload.layers : [];
        setUploadId(String(payload?.uploadId || ''));
        setLayers(visible);
        setSelectedLayerIds(new Set(visible.map((l) => l.id)));
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

  const toggleLayer = useCallback((id: string) => {
    setSelectedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCheck = useCallback((id: string) => {
    setEnabledChecks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applySnapshot = useCallback((job: any) => {
    if (!job) return;
    const status = String(job.status || '').toLowerCase();
    setProgress({ stage: job.stage || status, percent: Number(job.percent || 0), message: job.message });
    setProcessing(status === 'processing' || status === 'queued');
    if (Array.isArray(job.resultRows)) setRows(job.resultRows as GeometryErrorRow[]);
    if (Array.isArray(job.warnings)) setWarnings(job.warnings as string[]);
    if (job.downloadUrl) setDownloadUrl(String(job.downloadUrl));
    if (status === 'completed') {
      setSummary({
        totalErrors: Number(job.totalErrors || 0),
        featuresWithErrors: Number(job.featuresWithErrors || 0),
        analyzedLayers: Array.isArray(job.analyzedLayers) ? job.analyzedLayers : [],
        fixedLayers: Array.isArray(job.fixedLayers) ? job.fixedLayers : [],
      });
      setError(null);
    } else if (status === 'failed') {
      setError(job.error || job.message || 'Falha ao processar análise.');
    }
  }, []);

  const connectEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/geometry-errors/jobs/${encodeURIComponent(id)}/events`, {
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
    if (selectedLayerIds.size === 0) {
      toast.error('Selecione ao menos uma camada para analisar.');
      return;
    }
    if (enabledChecks.size === 0) {
      toast.error('Selecione ao menos um tipo de erro para verificar.');
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
      const checks: Record<string, boolean> = {};
      for (const check of CHECKS) checks[check.id] = enabledChecks.has(check.id);
      const response = await apiFetch('/api/geometry-errors/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          layerIds: [...selectedLayerIds],
          checks,
          settings: { generateFixed, minOverlapM2: Number(minOverlapM2) || 0 },
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
  }, [apiFetch, connectEvents, enabledChecks, generateFixed, minOverlapM2, selectedLayerIds, uploadId]);

  const downloadZip = useCallback(async () => {
    if (!downloadUrl) return;
    try {
      const response = await apiFetch(downloadUrl);
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `erros_geometria_${(jobId || 'resultado').slice(0, 8)}.zip`;
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

  const canProcess = Boolean(uploadId) && selectedLayerIds.size > 0 && enabledChecks.size > 0 && !processing;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ─── Hero / explicação didática ─── */}
      <section className="rounded-2xl border border-amber-500/15 bg-[#121009]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
              <AlertTriangle size={13} />
              Erros de Geometria
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Geometrias que o SIMCAR reprova
            </h2>
            <p className="max-w-3xl text-sm text-slate-400">
              O validador da SEMA rejeita shapefiles com geometria inválida — por exemplo{' '}
              <strong className="text-amber-200">"Borda de polígono se cruza"</strong> (auto-interseção). Aqui você
              importa o ZIP do CAR/SIMCAR, escolhe as verificações, e o sistema gera os{' '}
              <strong className="text-slate-200">pontos exatos dos erros</strong> e, se quiser, uma{' '}
              <strong className="text-emerald-200">camada corrigida</strong> pronta para revisar no SIG.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Entrada', value: '.zip' },
              { label: 'Correção', value: 'auto' },
              { label: 'Saída', value: 'SHP' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                <p className="mt-1 text-xs font-semibold text-amber-100">{item.value}</p>
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
          {uploading && <Loader2 size={18} className="animate-spin text-amber-300" />}
        </div>
        <label
          className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
            file
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-white/10 bg-white/[0.02] hover:border-amber-500/30 hover:bg-white/[0.03]'
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
          <div className={`rounded-xl p-3 ${file ? 'bg-amber-500/15 text-amber-200' : 'bg-white/5 text-slate-400 group-hover:text-amber-300'}`}>
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

      {/* ─── 2. Camadas e verificações ─── */}
      {analyzableLayers.length > 0 && (
        <section className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-[#14100b]/95 via-[#131019]/90 to-[#0d1512]/90 p-4 shadow-2xl shadow-black/20 sm:p-6">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative space-y-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100">
                <Layers size={13} />
                Camadas e verificações
              </div>
              <h3 className="mt-3 text-lg font-bold text-white">2. O que verificar?</h3>
              <p className="mt-1 text-xs text-slate-400">
                Marque as <strong className="text-amber-200">camadas</strong> e os{' '}
                <strong className="text-amber-200">tipos de erro</strong> que deseja detectar.
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-xs">
                  <thead>
                    <tr className="bg-white/[0.06] text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-3 pl-4 font-bold text-center">Analisar</th>
                      <th className="px-3 py-3 font-bold">Camada</th>
                      <th className="px-3 py-3 font-bold">Feições</th>
                      <th className="px-3 py-3 pr-4 font-bold">CRS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyzableLayers.map((layer, index) => {
                      const isSelected = selectedLayerIds.has(layer.id);
                      return (
                        <tr
                          key={layer.id}
                          className={`transition-colors ${index % 2 === 0 ? 'bg-white/[0.015]' : 'bg-transparent'} ${
                            isSelected ? 'bg-amber-500/[0.06]' : 'hover:bg-white/[0.04]'
                          } text-slate-200`}
                        >
                          <td className="border-t border-white/5 px-3 py-3 pl-4 align-middle text-center">
                            <button
                              type="button"
                              onClick={() => toggleLayer(layer.id)}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                                isSelected
                                  ? 'border-amber-300/50 bg-amber-500/25 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.2)]'
                                  : 'border-white/10 bg-white/[0.04] text-slate-500 hover:border-amber-300/30 hover:text-amber-200'
                              }`}
                              aria-label={`Analisar ${layer.name}`}
                            >
                              {isSelected ? <CheckCircle2 size={17} /> : <Square size={15} />}
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

            {/* Tipos de erro */}
            <div className="space-y-2">
              {CHECKS.map((check) => {
                const enabled = enabledChecks.has(check.id);
                return (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => toggleCheck(check.id)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                      enabled
                        ? 'border-amber-300/30 bg-amber-500/10'
                        : 'border-white/10 bg-black/20 hover:border-amber-300/20'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                        enabled
                          ? 'border-amber-300/50 bg-amber-500/25 text-amber-100'
                          : 'border-white/10 bg-white/[0.04] text-slate-500'
                      }`}
                    >
                      {enabled ? <CheckCircle2 size={14} /> : <Square size={12} />}
                    </span>
                    <span>
                      <span className={`block text-sm font-bold ${enabled ? 'text-amber-100' : 'text-slate-200'}`}>
                        {check.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{check.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Área mínima de sobreposição */}
            {enabledChecks.has('overlaps') && (
              <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-md">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Sobreposição mínima (m²)</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Sobreposições menores que este valor são descartadas. Bordas quase coincidentes geram interseções de
                    poucos cm² que não são erros reais — o padrão de <strong className="text-slate-300">1 m²</strong> filtra
                    esse ruído. Use <strong className="text-slate-300">0</strong> para ver absolutamente tudo.
                  </p>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={minOverlapM2}
                  onChange={(e) => setMinOverlapM2(e.target.value)}
                  className="w-28 shrink-0 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none transition focus:border-amber-400/60 focus:bg-amber-500/10"
                />
              </div>
            )}

            {/* Correção automática */}
            <button
              type="button"
              onClick={() => setGenerateFixed((prev) => !prev)}
              className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                generateFixed
                  ? 'border-emerald-300/30 bg-emerald-500/10'
                  : 'border-white/10 bg-black/20 hover:border-emerald-300/20'
              }`}
            >
              <span
                className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                  generateFixed
                    ? 'border-emerald-300/50 bg-emerald-500/25 text-emerald-100'
                    : 'border-white/10 bg-white/[0.04] text-slate-500'
                }`}
              >
                <Wrench size={13} />
              </span>
              <span>
                <span className={`block text-sm font-bold ${generateFixed ? 'text-emerald-100' : 'text-slate-200'}`}>
                  Gerar camadas corrigidas
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                  Para cada camada com erro o ZIP inclui <code className="text-emerald-200">corrigido_&lt;camada&gt;.shp</code>:
                  polígonos com borda cruzada são divididos em polígonos simples, vértices duplicados são removidos e anéis
                  degenerados são descartados. O atributo <code>feicao</code> preserva o número original para re-associar os
                  atributos no SIG.
                </span>
              </span>
            </button>
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
                Verifica cada anel de cada feição das camadas selecionadas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startProcessing()}
              disabled={!canProcess}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
              Analisar geometria
            </button>
          </div>
          {progress && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">{progress.stage}</span>
                <span className="font-bold tabular-nums text-amber-300">{progress.percent || 0}%</span>
              </div>
              <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-500"
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
                  ? `${rows.length} erro(s) de geometria encontrado(s).`
                  : summary
                    ? 'Nenhum erro de geometria encontrado. ✔'
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
                className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/15"
              >
                <Plus size={16} />
                Nova análise
              </button>
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: 'Camadas',
                  value: summary.analyzedLayers?.length ?? '—',
                },
                {
                  label: 'Erros',
                  value: summary.totalErrors ?? rows.length,
                  danger: (summary.totalErrors ?? rows.length) > 0,
                },
                { label: 'Feições com erro', value: summary.featuresWithErrors ?? '—', danger: (summary.featuresWithErrors || 0) > 0 },
                {
                  label: 'Feições corrigidas',
                  value: (summary.fixedLayers || []).reduce((acc, item) => acc + Number(item.fixedFeatures || 0), 0),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-2xl border px-3 py-3 text-center ${
                    (item as any).danger
                      ? 'border-amber-400/25 bg-amber-500/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className={`mt-1 text-lg font-black tabular-nums ${(item as any).danger ? 'text-amber-200' : 'text-white'}`}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {summary && (summary.fixedLayers || []).length > 0 && (
            <p className="text-[11px] text-slate-500">
              Camadas corrigidas no ZIP:{' '}
              <span className="text-emerald-200">
                {(summary.fixedLayers || []).map((l) => `corrigido_${l.name}.shp`).join(', ')}
              </span>
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
                    {['Camada', 'Tipo', 'Feição', 'Parte', 'Anel', 'X', 'Y', 'Detalhe'].map((head) => (
                      <th key={head} className="px-3 py-2">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-slate-200">
                  {rows.map((row, index) => (
                    <tr key={`${row.camada}-${row.tipo}-${row.feicao}-${index}`}>
                      <td className="px-3 py-2 font-semibold text-white">{row.camada}</td>
                      <td className="px-3 py-2 text-amber-200">{TIPO_LABEL[row.tipo] || row.tipo}</td>
                      <td className="px-3 py-2 tabular-nums">{row.feicao}</td>
                      <td className="px-3 py-2 tabular-nums">{row.parte}</td>
                      <td className="px-3 py-2 tabular-nums">{row.anel}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(row.x || 0).toFixed(8)}</td>
                      <td className="px-3 py-2 tabular-nums">{Number(row.y || 0).toFixed(8)}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={row.detalhe}>{row.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : summary ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              <CheckCircle2 size={20} />
              <span>Nenhum erro de geometria encontrado nas camadas e verificações selecionadas.</span>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
};

export default GeometryErrorsAnalysis;
