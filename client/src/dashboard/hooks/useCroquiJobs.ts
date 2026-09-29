import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readApiError } from '@/lib/api';
import { croquiDownloadUrl, croquiZipFilename } from '../croqui/filenames';
import { mapCroquiDocToHistoryItem } from '../croqui/mapDoc';
import type { CroquiHistoryItem, CroquiRouteOptionsResponse, CroquiUploadSummary } from '../croqui/types';

export type UseCroquiJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseCroquiJobsReturn = ReturnType<typeof useCroquiJobs>;

export function useCroquiJobs({ apiFetch, downloadZip, fileToBase64Payload }: UseCroquiJobsDeps) {
  const [croquiHistory, setCroquiHistory] = useState<CroquiHistoryItem[]>([]);
  const [croquiJobId, setCroquiJobId] = useState<string | null>(null);
  const [croquiUploadId, setCroquiUploadId] = useState<string | null>(null);
  const [croquiProcessing, setCroquiProcessing] = useState(false);
  const [croquiProgress, setCroquiProgress] = useState(0);
  const [croquiStage, setCroquiStage] = useState('');
  const [croquiMessage, setCroquiMessage] = useState('');
  const [croquiError, setCroquiError] = useState<string | null>(null);
  const [croquiDownload, setCroquiDownload] = useState<string | null>(null);
  const [croquiFiles, setCroquiFiles] = useState<string[]>([]);
  const [croquiFilename, setCroquiFilename] = useState('');
  const [croquiTitle, setCroquiTitle] = useState('');
  const [croquiPropertyName, setCroquiPropertyName] = useState('');
  const [croquiMunicipio, setCroquiMunicipio] = useState('');
  const [croquiMunicipioPartida, setCroquiMunicipioPartida] = useState<string | null>(null);
  const [croquiFile, setCroquiFile] = useState<File | null>(null);
  const [croquiUploading, setCroquiUploading] = useState(false);
  const [croquiRoutes, setCroquiRoutes] = useState<CroquiRouteOptionsResponse | null>(null);
  const [croquiRouteId, setCroquiRouteId] = useState<string | null>(null);
  const [croquiLoadingRoutes, setCroquiLoadingRoutes] = useState(false);
  /** null = ainda não respondido; o backend usa a sede do ZIP, se houver. */
  const [croquiPossuiSede, setCroquiPossuiSede] = useState<boolean | null>(null);
  const [croquiSede, setCroquiSede] = useState<[number, number] | null>(null);
  /** Partida escolhida no mapa — sobrevive a recalcular por causa da sede. */
  const [croquiStartOverride, setCroquiStartOverride] = useState<{ lon: number; lat: number } | null>(null);
  /** Vértices editados no site, por caminho. */
  const [croquiEditedCoords, setCroquiEditedCoords] = useState<Record<string, [number, number][]>>({});

  const [availableUploads, setAvailableUploads] = useState<CroquiUploadSummary[]>([]);
  const [availableUploadsLoading, setAvailableUploadsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const resetCroquiDraft = useCallback(() => {
    eventsAbortRef.current?.abort();
    eventsAbortRef.current = null;
    setCroquiJobId(null);
    setCroquiUploadId(null);
    setCroquiProcessing(false);
    setCroquiProgress(0);
    setCroquiStage('');
    setCroquiMessage('');
    setCroquiError(null);
    setCroquiDownload(null);
    setCroquiFiles([]);
    setCroquiFilename('');
    setCroquiMunicipio('');
    setCroquiMunicipioPartida(null);
    setCroquiFile(null);
    setCroquiRoutes(null);
    setCroquiRouteId(null);
    setCroquiLoadingRoutes(false);
    setCroquiPossuiSede(null);
    setCroquiSede(null);
    setCroquiStartOverride(null);
    setCroquiEditedCoords({});
  }, []);

  const applyCroquiJobPatch = useCallback((job: CroquiHistoryItem) => {
    setCroquiHistory((prev) => {
      const idx = prev.findIndex((item) => item.jobId === job.jobId);
      if (idx < 0) return [job, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...job };
      return next;
    });
    if (job.status === 'processing') {
      setCroquiProcessing(true);
      setCroquiJobId(job.jobId);
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      setCroquiProcessing(false);
    }
    setCroquiProgress(job.percent || 0);
    setCroquiStage(job.stage || '');
    setCroquiMessage(job.message || '');
    if (job.error) setCroquiError(job.error);
    if (job.downloadUrl) setCroquiDownload(job.downloadUrl);
    if (job.files) setCroquiFiles(job.files);
    if (job.filename) setCroquiFilename(job.filename);
    if (job.title) setCroquiTitle(job.title);
    if (job.propertyName) setCroquiPropertyName(job.propertyName);
    if (job.municipioNome) setCroquiMunicipio(job.municipioNome);
  }, []);

  const connectCroquiEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/croqui/jobs/${encodeURIComponent(id)}/events`, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((item) => item.startsWith('data:'));
            if (!line) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              if (evt?.type === 'snapshot' && evt?.job) {
                applyCroquiJobPatch(mapCroquiDocToHistoryItem(id, evt.job));
              } else if (evt?.type === 'progress') {
                applyCroquiJobPatch(mapCroquiDocToHistoryItem(id, evt));
              }
            } catch {
              // ignore malformed SSE
            }
          }
        }
      } catch (error: unknown) {
        if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') return;
      }
    },
    [apiFetch, applyCroquiJobPatch],
  );

  const selectCroquiHistoryEntry = useCallback(
    (entry: CroquiHistoryItem) => {
      setCroquiJobId(entry.jobId);
      setCroquiFilename(entry.filename);
      setCroquiTitle(entry.title || '');
      setCroquiPropertyName(entry.propertyName || '');
      setCroquiMunicipio(entry.municipioNome || '');
      if (entry.municipioPartida) {
        setCroquiMunicipioPartida(entry.municipioPartida);
      } else if (entry.municipioNome) {
        setCroquiMunicipioPartida(entry.municipioNome);
      } else {
        setCroquiMunicipioPartida(null);
      }
      setCroquiProgress(entry.percent);
      setCroquiStage(entry.stage || '');
      setCroquiMessage(entry.message || '');
      setCroquiError(entry.error || null);
      setCroquiDownload(entry.downloadUrl || null);
      setCroquiFiles(entry.files || []);
      setCroquiProcessing(entry.status === 'processing');
      if (entry.status === 'processing') void connectCroquiEvents(entry.jobId);
    },
    [connectCroquiEvents],
  );

  const hydrateFromDocs = useCallback(
    (docs: Array<{ id: string; data: Record<string, unknown> }>) => {
      const items = docs
        .map((doc) => mapCroquiDocToHistoryItem(doc.id, doc.data))
        .filter((item) => item.status !== 'deleted' && item.status !== 'uploaded');
      setCroquiHistory(items);
      const active = items.find((item) => item.status === 'processing');
      if (active) {
        setCroquiJobId(active.jobId);
        setCroquiProcessing(true);
        void connectCroquiEvents(active.jobId);
      }
    },
    [connectCroquiEvents],
  );

  const applyZipFile = useCallback((file: File | null) => {
    setCroquiFile(file);
    setCroquiUploadId(null);
    setCroquiError(null);
    // Os caminhos são do ATP anterior; trocar o ZIP invalida a escolha.
    setCroquiRoutes(null);
    setCroquiRouteId(null);
    setCroquiPossuiSede(null);
    setCroquiSede(null);
    setCroquiStartOverride(null);
    setCroquiEditedCoords({});
    if (file) setCroquiFilename(file.name);
  }, []);

  const uploadCroquiZip = useCallback(async () => {
    if (!croquiFile) {
      setCroquiError('Selecione o ZIP com o shapefile ATP.');
      return null;
    }
    setCroquiUploading(true);
    setCroquiError(null);
    try {
      const zipBase64 = await fileToBase64Payload(croquiFile);
      const response = await apiFetch('/api/croqui/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipBase64, filename: croquiFile.name }),
      });
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err?.error || 'Falha no upload.');
      }
      const data = await response.json();
      setCroquiUploadId(String(data.uploadId));
      toast.success('ATP importado.');
      return String(data.uploadId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha no upload.';
      setCroquiError(message);
      toast.error(message);
      return null;
    } finally {
      setCroquiUploading(false);
    }
  }, [apiFetch, croquiFile, fileToBase64Payload]);

  const loadAvailableUploads = useCallback(async () => {
    setAvailableUploadsLoading(true);
    try {
      const response = await apiFetch('/api/croqui/uploads');
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err?.error || 'Falha ao listar uploads salvos.');
      }
      const data = await response.json();
      setAvailableUploads(Array.isArray(data?.uploads) ? data.uploads : []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao listar uploads salvos.';
      toast.error(message);
    } finally {
      setAvailableUploadsLoading(false);
    }
  }, [apiFetch]);

  const selectExistingUpload = useCallback(
    (summary: CroquiUploadSummary) => {
      eventsAbortRef.current?.abort();
      eventsAbortRef.current = null;
      setCroquiUploadId(summary.uploadId);
      setCroquiFile(null);
      setCroquiFilename(summary.filename);
      setCroquiTitle('');
      setCroquiPropertyName('');
      setCroquiMunicipio(summary.municipioNome || '');
      setCroquiMunicipioPartida(summary.municipioNome || null);
      setCroquiRoutes(null);
      setCroquiRouteId(null);
      setCroquiPossuiSede(null);
      setCroquiSede(null);
      setCroquiStartOverride(null);
      setCroquiEditedCoords({});
      setCroquiError(null);
      setCroquiProcessing(false);
      setCroquiProgress(0);
      setCroquiMessage('');
      setCroquiDownload(null);
      setCroquiFiles([]);
      setCroquiJobId(null);
      toast.success(`ATP "${summary.filename}" selecionado.`);
    },
    [],
  );

  const loadCroquiRouteOptions = useCallback(
    async (
      uploadId: string,
      startOverride?: { lon: number; lat: number } | null,
      municipioPartidaOverride?: string | null,
      sedeOverride?: { possuiSede: boolean; sede: [number, number] | null },
    ): Promise<CroquiRouteOptionsResponse | null> => {
      setCroquiLoadingRoutes(true);
      setCroquiError(null);
      // undefined = mantém a partida escolhida antes; null = volta para a cidade.
      const startToSend = startOverride !== undefined ? startOverride : croquiStartOverride;
      const sedeToSend = sedeOverride ?? { possuiSede: croquiPossuiSede, sede: croquiSede };
      try {
        const municipioToSend =
          municipioPartidaOverride !== undefined
            ? (municipioPartidaOverride || undefined)
            : (croquiMunicipioPartida || undefined);
        const response = await apiFetch('/api/croqui/route-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            ...(startToSend ? { startLon: startToSend.lon, startLat: startToSend.lat } : {}),
            ...(municipioToSend ? { municipioPartida: municipioToSend } : {}),
            ...(sedeToSend.possuiSede !== null ? { possuiSede: sedeToSend.possuiSede } : {}),
            ...(sedeToSend.possuiSede && sedeToSend.sede
              ? { sedeLon: sedeToSend.sede[0], sedeLat: sedeToSend.sede[1] }
              : {}),
          }),
        });
        if (!response.ok) {
          const err = await readApiError(response);
          throw new Error(err?.error || 'Falha ao calcular os caminhos de acesso.');
        }
        const data = await response.json();
        const parsed: CroquiRouteOptionsResponse = {
          municipioNome: String(data?.municipioNome || ''),
          municipioPartida: data?.municipioPartida ? String(data.municipioPartida) : undefined,
          options: Array.isArray(data?.options) ? data.options : [],
          atp: Array.isArray(data?.atp) ? data.atp : [],
          start: Array.isArray(data?.start) ? data.start : null,
          startLabel: data?.startLabel ? String(data.startLabel) : undefined,
          startSource: data?.startSource ? String(data.startSource) : undefined,
          possuiSede: typeof data?.possuiSede === 'boolean' ? data.possuiSede : undefined,
          sede: Array.isArray(data?.sede) ? (data.sede as [number, number]) : null,
          sedeFromZip: !!data?.sedeFromZip,
        };
        setCroquiStartOverride(startToSend ?? null);
        setCroquiPossuiSede(parsed.possuiSede ?? false);
        setCroquiSede(parsed.sede ?? null);
        // Caminhos novos: edições do traçado anterior não valem mais.
        setCroquiEditedCoords({});
        const activeMunicipio = parsed.municipioPartida || parsed.municipioNome;
        if (activeMunicipio) setCroquiMunicipioPartida(activeMunicipio);
        if (parsed.municipioNome) setCroquiMunicipio(parsed.municipioNome);
        setCroquiRoutes(parsed);
        setCroquiRouteId(
          parsed.options.find((option) => option.recommended)?.id || parsed.options[0]?.id || null,
        );
        return parsed;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Falha ao calcular os caminhos de acesso.';
        setCroquiError(message);
        toast.error(message);
        return null;
      } finally {
        setCroquiLoadingRoutes(false);
      }
    },
    [apiFetch, croquiMunicipioPartida, croquiStartOverride, croquiPossuiSede, croquiSede],
  );

  /** "Possui sede?" — recalcula os caminhos terminando (ou não) na sede. */
  const changeCroquiPossuiSede = useCallback(
    async (possui: boolean): Promise<CroquiRouteOptionsResponse | null> => {
      setCroquiPossuiSede(possui);
      if (!croquiUploadId) return null;
      return loadCroquiRouteOptions(croquiUploadId, undefined, undefined, {
        possuiSede: possui,
        sede: possui ? croquiSede : null,
      });
    },
    [croquiUploadId, croquiSede, loadCroquiRouteOptions],
  );

  /** Sede clicada/arrastada no mapa — o backend valida que fica dentro do imóvel. */
  const changeCroquiSede = useCallback(
    async (lon: number, lat: number): Promise<CroquiRouteOptionsResponse | null> => {
      if (!croquiUploadId) return null;
      return loadCroquiRouteOptions(croquiUploadId, undefined, undefined, {
        possuiSede: true,
        sede: [lon, lat],
      });
    },
    [croquiUploadId, loadCroquiRouteOptions],
  );

  /** Vértices editados de um caminho; null desfaz a edição. */
  const setCroquiEditedRoute = useCallback((routeId: string, coords: [number, number][] | null) => {
    setCroquiEditedCoords((prev) => {
      const next = { ...prev };
      if (coords && coords.length >= 2) next[routeId] = coords;
      else delete next[routeId];
      return next;
    });
  }, []);

  /** Move a partida do croqui e manda o backend recalcular os caminhos a partir dali. */
  const recalculateCroquiFromPoint = useCallback(
    async (lon: number, lat: number): Promise<CroquiRouteOptionsResponse | null> => {
      if (!croquiUploadId) {
        toast.error('Envie o ZIP da ATP antes de mudar o ponto de partida.');
        return null;
      }
      return loadCroquiRouteOptions(croquiUploadId, { lon, lat }, croquiMunicipioPartida);
    },
    [croquiUploadId, croquiMunicipioPartida, loadCroquiRouteOptions],
  );

  /** Altera o município de partida do croqui e recalcula os caminhos a partir da nova sede. */
  const changeCroquiMunicipioPartida = useCallback(
    async (municipio: string): Promise<CroquiRouteOptionsResponse | null> => {
      setCroquiMunicipioPartida(municipio);
      if (!croquiUploadId) return null;
      // Ao mudar de município, limpamos o ponto customizado para focar na nova sede
      return loadCroquiRouteOptions(croquiUploadId, null, municipio);
    },
    [croquiUploadId, loadCroquiRouteOptions],
  );

  /**
   * Sem caminho escolhido, primeiro descobre as opções. Com mais de uma, pára e
   * devolve a escolha ao usuário — é ele quem sabe por onde se entra na
   * propriedade. Com uma só, segue direto usando esse traçado já calculado.
   */
  const startCroquiProcessing = useCallback(async (chosenRouteId?: string | null) => {
    const title = croquiTitle.trim();
    const propertyName = croquiPropertyName.trim();
    if (!title) {
      setCroquiError('Informe o título do croqui.');
      return;
    }
    if (!propertyName) {
      setCroquiError('Informe o nome da propriedade.');
      return;
    }
    let uploadId = croquiUploadId;
    if (!uploadId) {
      uploadId = await uploadCroquiZip();
      if (!uploadId) return;
    }

    // Primeiro clique só mostra os caminhos: antes de gerar, a pessoa confere o
    // traçado, diz se há sede e, se quiser, ajusta os vértices.
    if (!croquiRoutes) {
      const found = await loadCroquiRouteOptions(uploadId);
      if (!found) return;
      toast.info('Confira o caminho no mapa (sede e vértices) e clique em gerar.');
      return;
    }
    let routeOptionId = chosenRouteId ?? croquiRouteId ?? croquiRoutes.options[0]?.id ?? null;
    if (croquiPossuiSede && !croquiSede) {
      const message = 'Marque no mapa onde fica a sede da propriedade.';
      setCroquiError(message);
      toast.error(message);
      return;
    }
    const editedCoordinates = routeOptionId ? croquiEditedCoords[routeOptionId] : undefined;

    setCroquiProcessing(true);
    setCroquiError(null);
    setCroquiProgress(1);
    setCroquiMessage('Gerando croqui...');
    try {
      const municipioPartida = croquiMunicipioPartida || croquiMunicipio || undefined;
      const response = await apiFetch('/api/croqui/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          title,
          propertyName,
          routeOptionId,
          municipioPartida,
          possuiSede: !!croquiPossuiSede,
          ...(croquiPossuiSede && croquiSede ? { sedeLon: croquiSede[0], sedeLat: croquiSede[1] } : {}),
          ...(editedCoordinates ? { editedCoordinates } : {}),
        }),
      });
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err?.error || 'Falha ao gerar croqui.');
      }
      const data = await response.json();
      const jobId = String(data.jobId);
      setCroquiJobId(jobId);
      const draft: CroquiHistoryItem = {
        id: jobId,
        jobId,
        filename: title,
        title,
        propertyName,
        timestamp: new Date().toISOString(),
        status: 'processing',
        percent: 2,
        message: 'Gerando croqui...',
      };
      applyCroquiJobPatch(draft);
      void connectCroquiEvents(jobId);
      toast.success('Croqui em processamento.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Falha ao gerar croqui.';
      setCroquiError(message);
      setCroquiProcessing(false);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyCroquiJobPatch,
    connectCroquiEvents,
    croquiPropertyName,
    croquiRouteId,
    croquiRoutes,
    croquiTitle,
    croquiPossuiSede,
    croquiSede,
    croquiEditedCoords,
    croquiUploadId,
    loadCroquiRouteOptions,
    uploadCroquiZip,
  ]);

  const downloadCroquiZip = useCallback(
    (item?: CroquiHistoryItem | null) => {
      const url = croquiDownloadUrl(item || { jobId: croquiJobId || '', downloadUrl: croquiDownload || undefined });
      if (!url) return;
      const filename = croquiZipFilename(item || { title: croquiTitle, propertyName: croquiPropertyName, jobId: croquiJobId || undefined });
      void downloadZip(url, filename);
    },
    [croquiDownload, croquiJobId, croquiPropertyName, croquiTitle, downloadZip],
  );

  const deleteCroquiJob = useCallback(
    async (jobId: string) => {
      try {
        await apiFetch(`/api/croqui/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
        setCroquiHistory((prev) => prev.filter((item) => item.jobId !== jobId));
        if (croquiJobId === jobId) resetCroquiDraft();
        toast.success('Croqui removido.');
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Falha ao remover.');
      }
    },
    [apiFetch, croquiJobId, resetCroquiDraft],
  );

  return {
    croquiHistory,
    croquiJobId,
    croquiUploadId,
    croquiProcessing,
    croquiProgress,
    croquiStage,
    croquiMessage,
    croquiError,
    croquiDownload,
    croquiFiles,
    croquiFilename,
    croquiTitle,
    setCroquiTitle,
    croquiPropertyName,
    setCroquiPropertyName,
    croquiMunicipio,
    croquiMunicipioPartida,
    setCroquiMunicipioPartida,
    changeCroquiMunicipioPartida,
    croquiPossuiSede,
    changeCroquiPossuiSede,
    croquiSede,
    changeCroquiSede,
    croquiEditedCoords,
    setCroquiEditedRoute,
    croquiFile,
    croquiUploading,
    croquiRoutes,
    croquiRouteId,
    setCroquiRouteId,
    croquiLoadingRoutes,
    loadCroquiRouteOptions,
    recalculateCroquiFromPoint,
    fileInputRef,
    resetCroquiDraft,
    applyZipFile,
    uploadCroquiZip,
    startCroquiProcessing,
    downloadCroquiZip,
    selectCroquiHistoryEntry,
    hydrateFromDocs,
    deleteCroquiJob,
    availableUploads,
    availableUploadsLoading,
    loadAvailableUploads,
    selectExistingUpload,
  };
}
