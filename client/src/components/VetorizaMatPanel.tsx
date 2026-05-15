import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Database,
  Download,
  FileArchive,
  FileText,
  FolderPlus,
  Loader2,
  MapPinned,
  PlayCircle,
  RefreshCw,
  Save,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '@/lib/auth';
import { MapView } from '@/components/Map';

type VetorizaScreen = 'dashboard' | 'new-project' | 'project' | 'review' | 'download';

type VetorizaUser = {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  ativo: boolean;
  criado_em: string;
};

type VetorizaProject = {
  id: string;
  user_id: string;
  nome: string;
  descricao: string | null;
  status: string;
  criado_em: string;
  atualizado_em: string;
};

type VetorizaDocument = {
  id: string;
  project_id: string;
  nome_original: string;
  tipo_mime: string | null;
  tamanho_bytes: number | null;
  paginas_total: number | null;
  status: string;
  erro_detalhe: string | null;
  criado_em: string;
  atualizado_em: string;
};

type VetorizaProjectDetail = VetorizaProject & {
  documents: VetorizaDocument[];
  latest_extraction_id: string | null;
  latest_polygon_id: string | null;
};

type VetorizaExtraction = {
  id: string;
  document_id: string;
  modelo_ia: string | null;
  json_resultado: Record<string, unknown> | null;
  confianca_ia: number | null;
  alertas: string[] | null;
  aprovado: boolean;
};

type VetorizaVertex = {
  id: string;
  ai_extraction_id: string;
  ordem: number;
  nome: string | null;
  longitude_dms: string | null;
  latitude_dms: string | null;
  longitude_decimal: number | null;
  latitude_decimal: number | null;
  altitude_m: number | null;
  confianca_ocr: number | null;
  editado_por_usuario: boolean;
};

type VetorizaPolygon = {
  id: string;
  project_id: string;
  ai_extraction_id: string | null;
  area_calculada_ha: number | null;
  area_declarada_ha: number | null;
  divergencia_pct: number | null;
  is_valid: boolean | null;
  is_closed: boolean | null;
  tem_autointers: boolean;
  aprovado: boolean;
};

type VetorizaExport = {
  id: string;
  project_id: string;
  polygon_id: string | null;
  formatos: string[] | null;
  caminho_zip: string | null;
  tamanho_bytes: number | null;
  disponivel: boolean;
  criado_em: string;
};

type VetorizaFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
  }>;
};

type VetorizaTestData = {
  matricula: string;
  nome: string;
  pdf_nome: string;
  area_titulada_ha: number | null;
  area_calculada_ha: number;
  perimetro_titulado_m: number | null;
  perimetro_calculado_m: number | null;
  diff_ha: number | null;
  vertices_esperados: number;
  certsigef: string | null;
};

type VetorizaRunTestDataResult = {
  project_id: string;
  document_id: string;
  matricula: string;
  upload_url: string;
  revisao_url: string;
};

type VetorizaValidationReport = {
  disponivel: boolean;
  aprovado: boolean;
  matricula: string | null;
  nome: string | null;
  motivo: string | null;
  area_extraida_ha: number | null;
  area_esperada_ha: number | null;
  diferenca_area_pct: number | null;
  vertices_extraidos: number | null;
  vertices_esperados: number | null;
  iou: number | null;
  expected_geojson: VetorizaFeatureCollection | null;
  criterios: Record<string, unknown>;
};

type VertexDraft = {
  nome?: string;
  longitude_decimal?: string;
  latitude_decimal?: string;
  altitude_m?: string;
};

const DEFAULT_PRODUCTION_API_BASE = 'https://geoforest-api.cursar.space';
const CONFIGURED_API_BASE = String(
  import.meta.env.VITE_API_BASE ||
  (typeof window !== 'undefined' && /\.web\.app$/i.test(window.location.hostname) ? DEFAULT_PRODUCTION_API_BASE : '')
).trim().replace(/\/+$/, '');

const PROCESSING_STATUSES = new Set(['enviado', 'em_ocr', 'em_analise_ia', 'processando', 'pendente']);
const TERMINAL_STATUSES = new Set(['aguardando_revisao', 'concluido', 'erro']);

function apiUrl(path: string): string {
  if (!CONFIGURED_API_BASE) return path;
  return `${CONFIGURED_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `Erro ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.detail || parsed?.message || parsed?.error || text);
  } catch {
    return text;
  }
}

async function vetorizaRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new Error('Usuario nao autenticado.');
  const headers = new Headers(init.headers || {});
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiUrl(`/api/vetoriza${path.startsWith('/') ? path : `/${path}`}`), {
    ...init,
    headers,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function vetorizaBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = await getIdToken();
  if (!token) throw new Error('Usuario nao autenticado.');
  const response = await fetch(apiUrl(`/api/vetoriza${path.startsWith('/') ? path : `/${path}`}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const disposition = response.headers.get('content-disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || 'vetorizamat_export.zip',
  };
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let current = value / 1024;
  let unit = units[0];
  for (let idx = 1; idx < units.length && current >= 1024; idx += 1) {
    current /= 1024;
    unit = units[idx];
  }
  return `${formatNumber(current, current >= 10 ? 1 : 2)} ${unit}`;
}

function statusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    criado: 'Criado',
    processando: 'Processando',
    enviado: 'Enviado',
    pendente: 'Pendente',
    em_ocr: 'OCR',
    em_analise_ia: 'Analise IA',
    aguardando_revisao: 'Revisao',
    concluido: 'Concluido',
    erro: 'Erro',
  };
  return labels[String(status || '')] || String(status || '-');
}

function polygonRings(geojson: VetorizaFeatureCollection | null | undefined): number[][][] {
  return geojson?.features?.flatMap((feature) => feature.geometry?.coordinates || []) || [];
}

function allGeometryPoints(
  geojson: VetorizaFeatureCollection | null,
  expectedGeojson: VetorizaFeatureCollection | null | undefined,
  vertices: VetorizaVertex[],
): number[][] {
  return [
    ...polygonRings(geojson).flat(),
    ...polygonRings(expectedGeojson).flat(),
    ...vertices
      .filter((vertex) => vertex.longitude_decimal !== null && vertex.latitude_decimal !== null)
      .map((vertex) => [vertex.longitude_decimal as number, vertex.latitude_decimal as number]),
  ];
}

function StatusPipeline({ status }: { status: string }) {
  const steps = ['enviado', 'em_ocr', 'em_analise_ia', 'aguardando_revisao', 'concluido'];
  const activeIndex = Math.max(0, steps.indexOf(status));
  const isError = status === 'erro';

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <strong className="text-sm text-white">Pipeline</strong>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
          {statusLabel(status)}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => {
          const active = !isError && PROCESSING_STATUSES.has(status) && index === activeIndex;
          const done = !isError && (index < activeIndex || (!PROCESSING_STATUSES.has(status) && index <= activeIndex));
          const Icon = isError && index === activeIndex ? XCircle : active ? Loader2 : done ? CheckCircle2 : Circle;
          return (
            <div key={step} className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <Icon className={active ? 'animate-spin text-emerald-300' : done ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-slate-500'} size={15} />
              <span className="font-semibold">{statusLabel(step)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VetorizaPolygonPreview({
  geojson,
  expectedGeojson,
  vertices,
}: {
  geojson: VetorizaFeatureCollection | null;
  expectedGeojson?: VetorizaFeatureCollection | null;
  vertices: VetorizaVertex[];
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const overlaysRef = useRef<Array<{ setMap: (map: null) => void }>>([]);
  const points = useMemo(() => allGeometryPoints(geojson, expectedGeojson, vertices), [geojson, expectedGeojson, vertices]);

  const draw = useCallback(
    (map: any) => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      if (!points.length || typeof google === 'undefined') return;
      const bounds = new google.maps.LatLngBounds();

      const addPolygon = (source: VetorizaFeatureCollection | null | undefined, stroke: string, fill: string, dashed = false) => {
        polygonRings(source).forEach((ring) => {
          const paths = ring
            .filter((coord) => coord.length >= 2)
            .map(([lng, lat]) => {
              const point = { lat, lng };
              bounds.extend(point);
              return point;
            });
          if (paths.length < 3) return;
          const polygon = new google.maps.Polygon({
            paths,
            strokeColor: stroke,
            strokeWeight: dashed ? 2 : 3,
            strokeOpacity: dashed ? 0.8 : 0.95,
            fillColor: fill,
            fillOpacity: dashed ? 0.08 : 0.2,
            map,
          });
          overlaysRef.current.push(polygon);
        });
      };

      addPolygon(expectedGeojson, '#f59e0b', '#f59e0b', true);
      addPolygon(geojson, '#22c55e', '#22c55e');

      vertices.forEach((vertex) => {
        if (vertex.latitude_decimal === null || vertex.longitude_decimal === null) return;
        const position = { lat: vertex.latitude_decimal, lng: vertex.longitude_decimal };
        bounds.extend(position);
        const marker = new google.maps.Marker({
          position,
          map,
          title: vertex.nome || `V-${vertex.ordem}`,
          label: {
            text: String(vertex.ordem),
            color: '#0b1511',
            fontSize: '10px',
            fontWeight: '700',
          },
        });
        overlaysRef.current.push(marker);
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
    },
    [expectedGeojson, geojson, points.length, vertices],
  );

  if (!points.length) {
    return (
      <div className="flex h-[340px] items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-sm text-slate-500">
        Sem geometria para exibir.
      </div>
    );
  }

  if (mapFailed) {
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(0.000001, maxX - minX);
    const height = Math.max(0.000001, maxY - minY);
    const svgPoint = ([lng, lat]: number[]) => `${((lng - minX) / width) * 90 + 5},${95 - ((lat - minY) / height) * 90}`;

    return (
      <div className="h-[340px] overflow-hidden rounded-2xl border border-white/10 bg-black/25">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {polygonRings(expectedGeojson).map((ring, idx) => (
            <polygon key={`expected-${idx}`} points={ring.map(svgPoint).join(' ')} fill="rgba(245,158,11,0.08)" stroke="#f59e0b" strokeWidth="1.1" />
          ))}
          {polygonRings(geojson).map((ring, idx) => (
            <polygon key={`geo-${idx}`} points={ring.map(svgPoint).join(' ')} fill="rgba(34,197,94,0.2)" stroke="#22c55e" strokeWidth="1.3" />
          ))}
          {vertices.map((vertex) => {
            if (vertex.longitude_decimal === null || vertex.latitude_decimal === null) return null;
            const [cx, cy] = svgPoint([vertex.longitude_decimal, vertex.latitude_decimal]).split(',').map(Number);
            return <circle key={vertex.id} cx={cx} cy={cy} r="1.6" fill="#f59e0b" stroke="#0b1511" strokeWidth="0.6" />;
          })}
        </svg>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
      <MapView
        className="h-[340px] w-full"
        initialCenter={{ lat: points[0][1], lng: points[0][0] }}
        initialZoom={14}
        onMapReady={draw}
        onLoadError={() => setMapFailed(true)}
      />
    </div>
  );
}

export default function VetorizaMatPanel() {
  const [screen, setScreen] = useState<VetorizaScreen>('dashboard');
  const [user, setUser] = useState<VetorizaUser | null>(null);
  const [projects, setProjects] = useState<VetorizaProject[]>([]);
  const [testData, setTestData] = useState<VetorizaTestData[]>([]);
  const [project, setProject] = useState<VetorizaProjectDetail | null>(null);
  const [extraction, setExtraction] = useState<VetorizaExtraction | null>(null);
  const [vertices, setVertices] = useState<VetorizaVertex[]>([]);
  const [polygon, setPolygon] = useState<VetorizaPolygon | null>(null);
  const [geojson, setGeojson] = useState<VetorizaFeatureCollection | null>(null);
  const [validation, setValidation] = useState<VetorizaValidationReport | null>(null);
  const [exportRecord, setExportRecord] = useState<VetorizaExport | null>(null);
  const [vertexDrafts, setVertexDrafts] = useState<Record<string, VertexDraft>>({});
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingVertexId, setSavingVertexId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedDocument = project?.documents?.[0] || null;
  const reviewReady = selectedDocument?.status === 'aguardando_revisao' || project?.status === 'aguardando_revisao';
  const stats = useMemo(
    () => ({
      total: projects.length,
      andamento: projects.filter((item) => !['concluido', 'criado'].includes(item.status)).length,
      concluidos: projects.filter((item) => item.status === 'concluido').length,
    }),
    [projects],
  );

  const loadDashboard = useCallback(async () => {
    setError(null);
    const [me, projectList, fixtures] = await Promise.all([
      vetorizaRequest<VetorizaUser>('/auth/me'),
      vetorizaRequest<VetorizaProject[]>('/projetos'),
      vetorizaRequest<VetorizaTestData[]>('/validacao/dados-teste').catch(() => []),
    ]);
    setUser(me);
    setProjects(projectList);
    setTestData(fixtures);
  }, []);

  const loadProject = useCallback(async (projectId: string, quiet = false) => {
    if (!quiet) setProjectLoading(true);
    setError(null);
    try {
      const detail = await vetorizaRequest<VetorizaProjectDetail>(`/projetos/${projectId}`);
      setProject(detail);
      setExportRecord(null);
      setVertexDrafts({});

      const validationResult = await vetorizaRequest<VetorizaValidationReport>(`/projetos/${projectId}/validacao`).catch(() => null);
      setValidation(validationResult);

      if (!detail.latest_extraction_id) {
        setExtraction(null);
        setVertices([]);
        setPolygon(null);
        setGeojson(null);
        return;
      }

      const firstDocument = detail.documents[0];
      const [vertexList, extractionResult] = await Promise.all([
        vetorizaRequest<VetorizaVertex[]>(`/extracoes/${detail.latest_extraction_id}/vertices`),
        firstDocument ? vetorizaRequest<VetorizaExtraction>(`/documentos/${firstDocument.id}/extracao`).catch(() => null) : Promise.resolve(null),
      ]);
      setVertices(vertexList);
      setExtraction(extractionResult);

      if (detail.latest_polygon_id) {
        const [polygonResult, geojsonResult] = await Promise.all([
          vetorizaRequest<VetorizaPolygon>(`/poligonos/${detail.latest_polygon_id}`),
          vetorizaRequest<VetorizaFeatureCollection>(`/poligonos/${detail.latest_polygon_id}/geojson`),
        ]);
        setPolygon(polygonResult);
        setGeojson(geojsonResult);
      } else {
        setPolygon(null);
        setGeojson(null);
      }
    } finally {
      if (!quiet) setProjectLoading(false);
    }
  }, []);

  const openProject = useCallback(
    async (projectId: string, nextScreen: VetorizaScreen = 'project') => {
      setScreen(nextScreen);
      await loadProject(projectId);
    },
    [loadProject],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar VetorizaMat.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadDashboard]);

  useEffect(() => {
    if (!project?.id || !selectedDocument || TERMINAL_STATUSES.has(selectedDocument.status)) return;
    const timer = window.setInterval(() => {
      void loadProject(project.id, true).catch((err) => setError(err instanceof Error ? err.message : 'Falha ao atualizar projeto.'));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadProject, project?.id, selectedDocument?.id, selectedDocument?.status]);

  async function refreshAll() {
    setBusy('refresh');
    try {
      await loadDashboard();
      if (project?.id) await loadProject(project.id, true);
      toast.success('VetorizaMat atualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar VetorizaMat.');
    } finally {
      setBusy(null);
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const created = await vetorizaRequest<VetorizaProjectDetail>('/projetos', {
        method: 'POST',
        body: JSON.stringify({
          nome: newProjectName.trim(),
          descricao: newProjectDescription.trim() || null,
        }),
      });
      setNewProjectName('');
      setNewProjectDescription('');
      await loadDashboard();
      await openProject(created.id, 'project');
      toast.success('Projeto Vetoriza criado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar projeto.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadDocument(file: File | null | undefined) {
    if (!project?.id || !file) return;
    setBusy('upload');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await vetorizaRequest<VetorizaDocument>(`/projetos/${project.id}/documentos`, {
        method: 'POST',
        body: formData,
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadProject(project.id);
      toast.success('Documento enviado ao VetorizaMat.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar documento.');
    } finally {
      setBusy(null);
    }
  }

  async function runTestData(matricula: string) {
    setBusy(`test-${matricula}`);
    setError(null);
    try {
      const result = await vetorizaRequest<VetorizaRunTestDataResult>(`/validacao/dados-teste/${encodeURIComponent(matricula)}/rodar`, {
        method: 'POST',
      });
      await loadDashboard();
      await openProject(result.project_id, 'project');
      toast.success(`Validacao ${matricula} iniciada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar validacao.');
    } finally {
      setBusy(null);
    }
  }

  async function recalculatePolygon() {
    if (!project?.latest_extraction_id) return;
    setBusy('recalculate');
    setError(null);
    try {
      await vetorizaRequest<VetorizaPolygon>(`/extracoes/${project.latest_extraction_id}/recalcular`, { method: 'POST' });
      await loadProject(project.id);
      toast.success('Poligono recalculado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao recalcular poligono.');
    } finally {
      setBusy(null);
    }
  }

  async function approvePolygon() {
    if (!project?.id || !polygon) return;
    setBusy('approve');
    setError(null);
    try {
      await vetorizaRequest<VetorizaPolygon>(`/poligonos/${polygon.id}/aprovar`, { method: 'POST' });
      await loadProject(project.id);
      toast.success('Poligono aprovado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao aprovar poligono.');
    } finally {
      setBusy(null);
    }
  }

  async function saveVertex(vertex: VetorizaVertex) {
    const draft = vertexDrafts[vertex.id] || {};
    const nome = draft.nome ?? vertex.nome ?? '';
    const lonRaw = draft.longitude_decimal ?? String(vertex.longitude_decimal ?? '');
    const latRaw = draft.latitude_decimal ?? String(vertex.latitude_decimal ?? '');
    const altRaw = draft.altitude_m ?? String(vertex.altitude_m ?? '');
    const longitude = Number(lonRaw);
    const latitude = Number(latRaw);
    const altitude = altRaw === '' ? null : Number(altRaw);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || (altitude !== null && !Number.isFinite(altitude))) {
      toast.error('Coordenadas invalidas.');
      return;
    }

    setSavingVertexId(vertex.id);
    setError(null);
    try {
      await vetorizaRequest<VetorizaVertex>(`/vertices/${vertex.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nome: nome.trim() || null,
          longitude_decimal: longitude,
          latitude_decimal: latitude,
          altitude_m: altitude,
        }),
      });
      if (project?.id) await loadProject(project.id);
      toast.success('Vertice salvo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar vertice.');
    } finally {
      setSavingVertexId(null);
    }
  }

  async function generateExport() {
    if (!project?.id) return;
    setBusy('export');
    setError(null);
    try {
      const created = await vetorizaRequest<VetorizaExport>(`/projetos/${project.id}/exportar`, { method: 'POST' });
      setExportRecord(created);
      await loadProject(project.id, true);
      toast.success('ZIP GIS gerado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar ZIP GIS.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadExport(record: VetorizaExport) {
    setBusy(`download-${record.id}`);
    setError(null);
    try {
      const { blob, filename } = await vetorizaBlob(`/exportacoes/${record.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'vetorizamat_export.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar ZIP GIS.');
    } finally {
      setBusy(null);
    }
  }

  function updateVertexDraft(vertexId: string, patch: VertexDraft) {
    setVertexDrafts((current) => ({
      ...current,
      [vertexId]: { ...(current[vertexId] || {}), ...patch },
    }));
  }

  const renderHeader = () => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20">
          <MapPinned size={21} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300/80">{user?.email || 'VetorizaMat'}</p>
          <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">
            {screen === 'dashboard' ? 'VetorizaMat' : project?.nome || 'Novo projeto'}
          </h2>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {screen !== 'dashboard' && (
          <button
            type="button"
            onClick={() => {
              setScreen('dashboard');
              setProject(null);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            <ArrowLeft size={16} />
            Projetos
          </button>
        )}
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={busy === 'refresh'}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
        >
          {busy === 'refresh' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Atualizar
        </button>
        <button
          type="button"
          onClick={() => setScreen('new-project')}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <FolderPlus size={16} />
          Novo projeto
        </button>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ['Total', stats.total],
          ['Em andamento', stats.andamento],
          ['Concluidos', stats.concluidos],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-300">{value}</p>
          </div>
        ))}
      </div>

      {testData.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-300/20">
              <Database size={17} />
            </span>
            <h3 className="text-lg font-semibold text-white">Dados de teste</h3>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            {testData.map((fixture) => (
              <div key={fixture.matricula} className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Matricula {fixture.matricula}</p>
                <h4 className="mt-1 line-clamp-2 font-semibold text-white">{fixture.nome}</h4>
                <p className="mt-2 text-xs text-slate-500">
                  {fixture.vertices_esperados} vertices · {formatNumber(fixture.area_calculada_ha, 2)} ha
                </p>
                <button
                  type="button"
                  onClick={() => void runTestData(fixture.matricula)}
                  disabled={busy !== null}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === `test-${fixture.matricula}` ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                  Rodar validacao
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-white">Projetos</h3>
        <div className="grid gap-3">
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openProject(item.id, 'project')}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0e1612]/80 p-4 text-left transition-colors hover:border-emerald-400/30 hover:bg-[#132019]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                  <FileText size={19} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white group-hover:text-emerald-100">{item.nome}</p>
                  <p className="truncate text-xs text-slate-500">{item.descricao || 'Sem descricao'}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                {statusLabel(item.status)}
              </span>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-8 text-center">
              <p className="text-sm font-semibold text-slate-300">Nenhum projeto VetorizaMat.</p>
              <button
                type="button"
                onClick={() => setScreen('new-project')}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                <FolderPlus size={16} />
                Criar projeto
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderNewProject = () => (
    <form className="max-w-2xl rounded-2xl border border-white/10 bg-[#0e1612]/80 p-5" onSubmit={createProject}>
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-semibold text-slate-200">
          Nome do projeto
          <input
            className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            required
            minLength={2}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-200">
          Descricao
          <textarea
            className="min-h-28 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60"
            value={newProjectDescription}
            onChange={(event) => setNewProjectDescription(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy === 'create'}
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}
          Criar e abrir
        </button>
      </div>
    </form>
  );

  const renderProject = () => {
    if (projectLoading && !project) {
      return <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-6 text-sm text-slate-300">Carregando projeto...</div>;
    }
    if (!project) return null;

    return (
      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">{statusLabel(project.status)}</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{project.nome}</h3>
                {project.descricao && <p className="mt-1 text-sm text-slate-400">{project.descricao}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setScreen('review')}
                  disabled={!project.latest_extraction_id}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                >
                  <MapPinned size={16} />
                  Revisao
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('download')}
                  disabled={!project.latest_polygon_id}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Download size={16} />
                  ZIP GIS
                </button>
              </div>
            </div>
          </div>

          <label className="group flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-400/30 bg-emerald-500/[0.05] p-5 text-center hover:bg-emerald-500/10">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(event) => void uploadDocument(event.target.files?.[0])}
            />
            {busy === 'upload' ? <Loader2 size={26} className="animate-spin text-emerald-300" /> : <UploadCloud size={26} className="text-emerald-300" />}
            <span className="mt-2 text-sm font-semibold text-white">Enviar matricula</span>
            <span className="mt-1 text-xs text-slate-500">PDF ou imagem · ate 50 MB</span>
          </label>
        </div>

        {selectedDocument && (
          <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate font-semibold text-white">{selectedDocument.nome_original}</h4>
                <p className="mt-1 text-xs text-slate-500">
                  {formatBytes(selectedDocument.tamanho_bytes)} · {selectedDocument.tipo_mime || 'tipo desconhecido'}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                {statusLabel(selectedDocument.status)}
              </span>
            </div>
            {selectedDocument.erro_detalhe && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{selectedDocument.erro_detalhe}</p>
            )}
            {reviewReady && (
              <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-100">
                Analise pronta para revisao tecnica.
              </p>
            )}
          </div>
        )}

        {selectedDocument && <StatusPipeline status={selectedDocument.status} />}
      </div>
    );
  };

  const renderReview = () => {
    if (!project) return null;
    if (!project.latest_extraction_id) {
      return (
        <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-8 text-center">
          <p className="text-sm font-semibold text-slate-300">Ainda nao ha extracao para revisar.</p>
          <button
            type="button"
            onClick={() => setScreen('project')}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <UploadCloud size={16} />
            Enviar documento
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void recalculatePolygon()}
            disabled={busy === 'recalculate'}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            {busy === 'recalculate' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Recalcular
          </button>
          <button
            type="button"
            onClick={() => void approvePolygon()}
            disabled={!polygon || polygon.aprovado || busy === 'approve'}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <CheckCircle2 size={16} />
            {polygon?.aprovado ? 'Aprovado' : 'Aprovar'}
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <Metric label="Area calculada" value={`${formatNumber(polygon?.area_calculada_ha, 2)} ha`} />
          <Metric label="Area declarada" value={`${formatNumber(polygon?.area_declarada_ha, 2)} ha`} />
          <Metric label="Divergencia" value={`${formatNumber(polygon?.divergencia_pct, 2)}%`} />
        </div>

        {extraction?.alertas && extraction.alertas.length > 0 && (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-amber-200">
              <AlertTriangle size={16} />
              <strong className="text-sm">Alertas</strong>
            </div>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-100/90">
              {extraction.alertas.map((alerta) => <li key={alerta}>{alerta}</li>)}
            </ul>
          </div>
        )}

        {validation?.disponivel && (
          <div className={`rounded-2xl border p-4 ${validation.aprovado ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-amber-400/30 bg-amber-500/10'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {validation.aprovado ? <CheckCircle2 className="text-emerald-300" size={22} /> : <XCircle className="text-amber-300" size={22} />}
                <div>
                  <strong className="text-sm text-white">{validation.aprovado ? 'Validacao aprovada' : 'Validacao pendente'}</strong>
                  <p className="text-xs text-slate-400">{validation.motivo}</p>
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
                Matricula {validation.matricula}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <Metric compact label="Area extraida" value={`${formatNumber(validation.area_extraida_ha, 2)} ha`} />
              <Metric compact label="Area esperada" value={`${formatNumber(validation.area_esperada_ha, 2)} ha`} />
              <Metric compact label="Diferenca" value={`${formatNumber(validation.diferenca_area_pct, 2)}%`} />
              <Metric compact label="Vertices / IoU" value={`${validation.vertices_extraidos ?? '-'} / ${validation.vertices_esperados ?? '-'} · ${formatNumber(validation.iou, 3)}`} />
            </div>
          </div>
        )}

        <VetorizaPolygonPreview geojson={geojson} expectedGeojson={validation?.expected_geojson} vertices={vertices} />

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0e1612]/80">
          <table className="w-full min-w-[840px] border-collapse text-sm">
            <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="p-3">Ordem</th>
                <th className="p-3">Nome</th>
                <th className="p-3">Longitude</th>
                <th className="p-3">Latitude</th>
                <th className="p-3">Altitude</th>
                <th className="p-3">Confianca</th>
                <th className="p-3 text-right">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vertices.map((vertex) => {
                const draft = vertexDrafts[vertex.id] || {};
                return (
                  <tr key={vertex.id} className="hover:bg-white/[0.03]">
                    <td className="p-3 font-semibold text-slate-200">{vertex.ordem}</td>
                    <td className="p-3">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
                        value={draft.nome ?? vertex.nome ?? ''}
                        onChange={(event) => updateVertexDraft(vertex.id, { nome: event.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
                        type="number"
                        step="0.000001"
                        value={draft.longitude_decimal ?? vertex.longitude_decimal ?? ''}
                        onChange={(event) => updateVertexDraft(vertex.id, { longitude_decimal: event.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
                        type="number"
                        step="0.000001"
                        value={draft.latitude_decimal ?? vertex.latitude_decimal ?? ''}
                        onChange={(event) => updateVertexDraft(vertex.id, { latitude_decimal: event.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <input
                        className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
                        type="number"
                        step="0.1"
                        value={draft.altitude_m ?? vertex.altitude_m ?? ''}
                        onChange={(event) => updateVertexDraft(vertex.id, { altitude_m: event.target.value })}
                      />
                    </td>
                    <td className="p-3 text-slate-300">{formatNumber(vertex.confianca_ocr ? vertex.confianca_ocr * 100 : null, 0)}%</td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => void saveVertex(vertex)}
                        disabled={savingVertexId === vertex.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        {savingVertexId === vertex.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Salvar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDownload = () => {
    if (!project) return null;
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-white/10 bg-[#0e1612]/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                <FileArchive size={24} />
              </span>
              <div>
                <h3 className="font-semibold text-white">Pacote GIS</h3>
                <p className="text-sm text-slate-500">GeoJSON, CSV e KML</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void generateExport()}
              disabled={busy === 'export' || !project.latest_polygon_id}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === 'export' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Gerar ZIP
            </button>
          </div>
        </div>

        {exportRecord && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-white">Exportacao pronta</h4>
                <p className="text-sm text-slate-400">{formatBytes(exportRecord.tamanho_bytes)} · {(exportRecord.formatos || []).join(', ')}</p>
              </div>
              <button
                type="button"
                onClick={() => void downloadExport(exportRecord)}
                disabled={busy === `download-${exportRecord.id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === `download-${exportRecord.id}` ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Baixar ZIP
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-8 custom-scrollbar">
      <div className="mx-auto max-w-6xl space-y-5 animate-fade-in-up">
        {renderHeader()}

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 shrink-0 text-red-300" size={17} />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#0e1612]/80 p-10 text-slate-300">
            <Loader2 className="mr-2 animate-spin text-emerald-300" size={18} />
            Carregando VetorizaMat...
          </div>
        ) : screen === 'dashboard' ? (
          renderDashboard()
        ) : screen === 'new-project' ? (
          renderNewProject()
        ) : screen === 'project' ? (
          renderProject()
        ) : screen === 'review' ? (
          renderReview()
        ) : (
          renderDownload()
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#0e1612]/80 ${compact ? 'p-3' : 'p-5'}`}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`${compact ? 'mt-1 text-sm' : 'mt-2 text-2xl'} font-semibold text-emerald-300`}>{value}</p>
    </div>
  );
}
