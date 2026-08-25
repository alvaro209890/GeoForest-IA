/**
 * Hook do fluxo NDVI (Landsat C2 L2) — molde de `useCbersJobs.ts`.
 *
 * Gerencia o ciclo completo da aba NDVI no padrão CBERS:
 *  - upload ZIP da ATP / Nº do CAR estadual / órbita+ponto;
 *  - `POST /api/ndvi/search` → cenas Landsat C2 L2 com cobertura;
 *  - seleção de cenas + composições (NDVI/NDFI/RGB/SWIR);
 *  - `POST /api/ndvi/jobs` → job com `{ itemIds, propertyZip/carNumber, filename, compositions }`;
 *  - progresso ao vivo via SSE (`/events`), polling de fallback (`/status`);
 *  - cancelamento (`DELETE /api/ndvi/jobs/:jobId`) e histórico (`GET /api/ndvi/archive`).
 *
 * O backend NDVI novo está sendo criado em paralelo; o contrato usado aqui é o
 * da reunião (rotas `/api/ndvi/*`), com normalização de nomes no front
 * (ex.: `scene.itemId` → `scene.id`, `scene.acquiredAt` → `scene.datetime`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import { ndviBatchZipUrl } from '../ndvi/filenames';
import { mapNdviDocToHistoryItem, normalizeNdviScene } from '../ndvi/mapDoc';
import {
  NDVI_COMPOSITIONS,
  type NdviComposition,
  type NdviHistoryItem,
  type NdviScene,
  type NdviSceneJobState,
} from '../ndvi/types';

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export type UseNdviJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  requestProcessCancel: (jobId: string | null | undefined) => Promise<boolean>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseNdviJobsReturn = ReturnType<typeof useNdviJobs>;

export function useNdviJobs({
  apiFetch,
  requestProcessCancel,
  downloadZip,
  fileToBase64Payload,
}: UseNdviJobsDeps) {
  const [ndviFile, setNdviFile] = useState<File | null>(null);
  const [ndviPropertyZipB64, setNdviPropertyZipB64] = useState<string | null>(null);
  const [ndviSearching, setNdviSearching] = useState(false);
  const [ndviScenes, setNdviScenes] = useState<NdviScene[]>([]);
  const [ndviSelectedSceneId, setNdviSelectedSceneId] = useState<string | null>(null);
  const [ndviSelectedSceneIds, setNdviSelectedSceneIds] = useState<string[]>([]);
  const [ndviPreviewScene, setNdviPreviewScene] = useState<NdviScene | null>(null);
  const [ndviOrbit, setNdviOrbit] = useState('');
  const [ndviPoint, setNdviPoint] = useState('');
  const [ndviCarNumber, setNdviCarNumber] = useState('');
  const [ndviDateStart, setNdviDateStart] = useState('');
  const [ndviDateEnd, setNdviDateEnd] = useState('');
  const [ndviMaxCloudCover, setNdviMaxCloudCover] = useState('');
  const [ndviAreaHa, setNdviAreaHa] = useState<number | null>(null);
  const [ndviPropertyGeometry, setNdviPropertyGeometry] = useState<CbersGeoJsonGeometry | null>(null);
  const [ndviCompositions, setNdviCompositions] = useState<NdviComposition[]>([...NDVI_COMPOSITIONS]);
  const [ndviProcessing, setNdviProcessing] = useState(false);
  const [ndviHistory, setNdviHistory] = useState<NdviHistoryItem[]>([]);
  const [ndviJobId, setNdviJobId] = useState<string | null>(null);
  const [ndviProgress, setNdviProgress] = useState<{ stage: string; percent: number; message: string } | null>(null);
  const [ndviError, setNdviError] = useState<string | null>(null);
  const ndviFileInputRef = useRef<HTMLInputElement | null>(null);
  const ndviEventsAbortRef = useRef<AbortController | null>(null);

  const resetNdviDraft = useCallback(() => {
    ndviEventsAbortRef.current?.abort();
    ndviEventsAbortRef.current = null;
    setNdviFile(null);
    setNdviPropertyZipB64(null);
    setNdviSearching(false);
    setNdviScenes([]);
    setNdviSelectedSceneId(null);
    setNdviSelectedSceneIds([]);
    setNdviPreviewScene(null);
    setNdviOrbit('');
    setNdviPoint('');
    setNdviCarNumber('');
    setNdviDateStart('');
    setNdviDateEnd('');
    setNdviMaxCloudCover('');
    setNdviAreaHa(null);
    setNdviPropertyGeometry(null);
    setNdviCompositions([...NDVI_COMPOSITIONS]);
    setNdviProcessing(false);
    setNdviJobId(null);
    setNdviProgress(null);
    setNdviError(null);
    if (ndviFileInputRef.current) ndviFileInputRef.current.value = '';
  }, []);

  const applyNdviJobPatch = useCallback((job: NdviHistoryItem) => {
    setNdviHistory((prev) => {
      const exists = prev.some((item) => item.jobId === job.jobId);
      const next = exists
        ? prev.map((item) => (item.jobId === job.jobId ? {
          ...item,
          ...job,
          filename: job.filename === 'NDVI' ? item.filename : job.filename,
          timestamp: item.timestamp || job.timestamp,
          createdAt: job.createdAt || item.createdAt,
          updatedAt: job.updatedAt || item.updatedAt,
          itemIds: job.itemIds || item.itemIds,
          scenes: job.scenes || item.scenes,
          mode: job.mode || item.mode,
          areaHa: job.areaHa ?? item.areaHa,
          compositions: job.compositions || item.compositions,
          outputUrl: job.outputUrl || item.outputUrl,
          outputRelativePath: job.outputRelativePath || item.outputRelativePath,
          outputFilename: job.outputFilename || item.outputFilename,
          outputBytes: job.outputBytes ?? item.outputBytes,
          wmsLayerName: job.wmsLayerName || item.wmsLayerName,
          wmsUrl: job.wmsUrl || item.wmsUrl,
          wmsDownloadUrl: job.wmsDownloadUrl || item.wmsDownloadUrl,
          batchZipUrl: job.batchZipUrl || item.batchZipUrl,
          batchZipRelativePath: job.batchZipRelativePath || item.batchZipRelativePath,
          batchZipFilename: job.batchZipFilename || item.batchZipFilename,
          batchZipBytes: job.batchZipBytes ?? item.batchZipBytes,
        } : item))
        : [job, ...prev];
      return next.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    });
    setNdviJobId(job.jobId);
    setNdviProcessing(job.status === 'processing');
    setNdviProgress({
      stage: job.stage || job.status,
      percent: job.percent,
      message: job.message || '',
    });
    setNdviError(job.status === 'failed' || job.status === 'cancelled' ? job.error || job.message || null : null);
  }, []);

  const connectNdviEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    ndviEventsAbortRef.current?.abort();
    const controller = new AbortController();
    ndviEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/ndvi/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
        method: 'GET',
        signal: controller.signal,
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
              applyNdviJobPatch(mapNdviDocToHistoryItem(normalizedJobId, evt.job));
            } else if (evt?.type === 'progress') {
              applyNdviJobPatch(mapNdviDocToHistoryItem(normalizedJobId, evt));
            }
          } catch {
            // Ignora frames SSE malformados.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos NDVI:', error);
      }
    } finally {
      if (ndviEventsAbortRef.current === controller) ndviEventsAbortRef.current = null;
    }
  }, [apiFetch, applyNdviJobPatch]);

  const selectNdviHistoryEntry = useCallback((entry: NdviHistoryItem) => {
    setNdviJobId(entry.jobId);
    setNdviProcessing(entry.status === 'processing');
    setNdviProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || '',
    });
    setNdviError(entry.status === 'failed' || entry.status === 'cancelled' ? entry.error || entry.message || null : null);
    setNdviSelectedSceneId(entry.itemIds?.[0] || entry.scenes?.[0]?.itemId || null);
    if (entry.status === 'processing') void connectNdviEvents(entry.jobId);
  }, [connectNdviEvents]);

  const hydrateFromDocs = useCallback((docs: Array<{ id: string; data: any }>) => {
    const ndviEntries = docs.map((docSnap) => mapNdviDocToHistoryItem(docSnap.id, docSnap.data));
    setNdviHistory(ndviEntries);
    const runningNdvi = ndviEntries.find((entry) => entry.status === 'processing');
    if (runningNdvi) {
      selectNdviHistoryEntry(runningNdvi);
    } else if (ndviEntries.length > 0) {
      selectNdviHistoryEntry(ndviEntries[0]);
    }
  }, [selectNdviHistoryEntry]);

  const sortNdviScenes = useCallback((scenes: NdviScene[]) => {
    return [...scenes].sort((a, b) => String(b.datetime || '').localeCompare(String(a.datetime || '')));
  }, []);

  const ndviVisibleScenes = useMemo(() => {
    const startMs = ndviDateStart ? new Date(`${ndviDateStart}T00:00:00`).getTime() : null;
    const endMs = ndviDateEnd ? new Date(`${ndviDateEnd}T23:59:59`).getTime() : null;
    const maxCloud = ndviMaxCloudCover.trim() ? Number(ndviMaxCloudCover) : null;
    return sortNdviScenes(
      ndviScenes.filter((scene) => {
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          if (scene.cloudCover === null) return false;
          if (scene.cloudCover > maxCloud) return false;
        }
        if (scene.datetime) {
          const sceneMs = new Date(scene.datetime).getTime();
          if (Number.isFinite(sceneMs)) {
            if (startMs !== null && Number.isFinite(startMs) && sceneMs < startMs) return false;
            if (endMs !== null && Number.isFinite(endMs) && sceneMs > endMs) return false;
          }
        }
        return true;
      })
    );
  }, [ndviDateEnd, ndviDateStart, ndviMaxCloudCover, ndviScenes, sortNdviScenes]);

  useEffect(() => {
    if (ndviScenes.length === 0) return;
    const visibleIds = new Set(ndviVisibleScenes.map((scene) => scene.id));
    setNdviSelectedSceneIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    if (ndviSelectedSceneId && !visibleIds.has(ndviSelectedSceneId)) {
      setNdviSelectedSceneId(ndviVisibleScenes[0]?.id || null);
    }
  }, [ndviScenes.length, ndviSelectedSceneId, ndviVisibleScenes]);

  const ndviSelectedScenes = useMemo(
    () => ndviSelectedSceneIds
      .map((id) => ndviScenes.find((scene) => scene.id === id))
      .filter((scene): scene is NdviScene => Boolean(scene)),
    [ndviScenes, ndviSelectedSceneIds]
  );

  const toggleNdviSceneSelection = useCallback((scene: NdviScene) => {
    if (scene.wmsAvailable) {
      toast.info('Esta cena já está publicada no acervo. Use a imagem existente em vez de gerar novamente.');
      return;
    }
    if (scene.coversArea === false) {
      toast.error(`Cena cobre apenas ${(scene.coveragePercent ?? 0).toFixed(2)}% da área.`);
      return;
    }
    setNdviSelectedSceneId(scene.id);
    setNdviSelectedSceneIds((prev) => {
      if (prev.includes(scene.id)) return prev.filter((id) => id !== scene.id);
      return [...prev, scene.id];
    });
  }, []);

  const applyNdviZipFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um shapefile compactado em .zip.');
      return;
    }
    setNdviFile(file);
    setNdviPropertyZipB64(null);
    setNdviScenes([]);
    setNdviSelectedSceneId(null);
    setNdviSelectedSceneIds([]);
    setNdviPreviewScene(null);
    setNdviPropertyGeometry(null);
    setNdviAreaHa(null);
    setNdviError(null);
    setNdviCarNumber('');
  }, []);

  const searchNdviScenes = useCallback(async () => {
    const orbit = ndviOrbit.trim();
    const point = ndviPoint.trim();
    const carNumber = ndviCarNumber.trim();
    const hasDirectFilter = orbit.length > 0 && point.length > 0;
    if (!ndviFile && !carNumber && !hasDirectFilter) {
      toast.error('Selecione um ZIP/SHP, informe Nº do CAR estadual ou informe órbita e ponto.');
      return;
    }
    if (ndviDateStart && ndviDateEnd && ndviDateStart > ndviDateEnd) {
      toast.error('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    setNdviSearching(true);
    setNdviError(null);
    setNdviScenes([]);
    setNdviSelectedSceneId(null);
    setNdviSelectedSceneIds([]);
    setNdviPreviewScene(null);
    try {
      const body: Record<string, unknown> = {
        dateStart: ndviDateStart || undefined,
        dateEnd: ndviDateEnd || undefined,
        orbit: orbit || undefined,
        point: point || undefined,
      };
      if (ndviFile) {
        const propertyZip = await fileToBase64Payload(ndviFile);
        setNdviPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
        body.filename = ndviFile.name;
      } else if (carNumber) {
        setNdviPropertyZipB64(null);
        body.carNumber = carNumber;
        body.filename = `CAR_${carNumber}.zip`;
      } else {
        setNdviPropertyZipB64(null);
      }
      const response = await apiFetch('/api/ndvi/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao buscar cenas NDVI.');
      const scenes = sortNdviScenes(
        (Array.isArray(payload?.scenes) ? payload.scenes : [])
          .map((item: any) => normalizeNdviScene(item))
          .filter((item: NdviScene | null): item is NdviScene => Boolean(item))
      );
      const nextAreaHa = Number(payload?.areaHa);
      setNdviAreaHa(Number.isFinite(nextAreaHa) && nextAreaHa > 0 ? nextAreaHa : null);
      setNdviPropertyGeometry(isPlainObject(payload?.propertyGeometry) ? payload.propertyGeometry as CbersGeoJsonGeometry : null);
      setNdviScenes(scenes);
      const maxCloud = ndviMaxCloudCover.trim() ? Number(ndviMaxCloudCover) : null;
      const firstCovered = scenes.find((scene) => {
        if (scene.coversArea === false || scene.wmsAvailable) return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          return scene.cloudCover !== null && scene.cloudCover <= maxCloud;
        }
        return true;
      });
      setNdviSelectedSceneId(firstCovered?.id || scenes[0]?.id || null);
      setNdviSelectedSceneIds(firstCovered ? [firstCovered.id] : []);
      if (!scenes.length) {
        toast.info(hasDirectFilter && !carNumber ? 'Nenhuma cena Landsat C2 L2 encontrada para essa órbita/ponto.' : 'Nenhuma cena Landsat C2 L2 encontrada para essa área.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao buscar cenas NDVI.';
      setNdviError(message);
      toast.error(message);
    } finally {
      setNdviSearching(false);
    }
  }, [apiFetch, fileToBase64Payload, ndviCarNumber, ndviDateEnd, ndviDateStart, ndviFile, ndviMaxCloudCover, ndviOrbit, ndviPoint, sortNdviScenes]);

  const toggleNdviComposition = useCallback((composition: NdviComposition) => {
    setNdviCompositions((prev) => {
      if (prev.includes(composition)) {
        if (prev.length === 1) {
          toast.error('Selecione ao menos uma composição.');
          return prev;
        }
        return prev.filter((item) => item !== composition);
      }
      return [...prev, composition];
    });
  }, []);

  const startNdviJobs = useCallback(async (sceneIdOverride?: string) => {
    const targetSceneIds = sceneIdOverride
      ? [String(sceneIdOverride).trim()].filter(Boolean)
      : ndviSelectedSceneIds.length > 0
        ? ndviSelectedSceneIds
        : [String(ndviSelectedSceneId || '').trim()].filter(Boolean);
    if (targetSceneIds.length === 0) {
      toast.error('Selecione ao menos uma cena NDVI.');
      return;
    }
    if (ndviCompositions.length === 0) {
      toast.error('Selecione ao menos uma composição.');
      return;
    }
    const blocked = targetSceneIds
      .map((id) => ndviScenes.find((scene) => scene.id === id))
      .find((scene) => scene?.coversArea === false || scene?.wmsAvailable);
    if (blocked) {
      toast.error(
        blocked.wmsAvailable
          ? `A cena ${blocked.id} já está publicada no acervo. Use a imagem existente.`
          : `Cena ${blocked.id} não cobre 100% da área.`
      );
      return;
    }
    setNdviError(null);
    setNdviProcessing(true);
    setNdviProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento NDVI ao servidor.' });
    try {
      const carNumber = ndviCarNumber.trim();
      const filename = ndviFile?.name || (carNumber ? `CAR_${carNumber}.zip` : `NDVI_${targetSceneIds[0] || 'ORBITA_PONTO'}`);
      const body: Record<string, unknown> = {
        itemIds: targetSceneIds,
        filename,
        compositions: ndviCompositions,
      };
      if (ndviFile) {
        const propertyZip = ndviPropertyZipB64 || await fileToBase64Payload(ndviFile);
        setNdviPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/ndvi/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento NDVI.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId NDVI.');
      const optimisticScenes: NdviSceneJobState[] = targetSceneIds.map((itemId) => ({
        itemId,
        scene: ndviScenes.find((item) => item.id === itemId) || null,
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Aguardando processamento.',
        compositions: ndviCompositions,
      }));
      const optimistic: NdviHistoryItem = {
        id: jobId,
        jobId,
        filename,
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Processamento NDVI enviado para o servidor.',
        itemIds: targetSceneIds,
        mode: targetSceneIds.length > 1 ? 'batch' : 'single',
        areaHa: ndviAreaHa || undefined,
        compositions: ndviCompositions,
        scenes: optimisticScenes,
      };
      applyNdviJobPatch(optimistic);
      void connectNdviEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao iniciar processamento NDVI.';
      setNdviProcessing(false);
      setNdviError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyNdviJobPatch,
    connectNdviEvents,
    fileToBase64Payload,
    ndviAreaHa,
    ndviCarNumber,
    ndviCompositions,
    ndviFile,
    ndviPropertyZipB64,
    ndviScenes,
    ndviSelectedSceneId,
    ndviSelectedSceneIds,
  ]);

  const deleteNdviJob = useCallback(async (entry: NdviHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      if (entry.status === 'processing') {
        await requestProcessCancel(entry.jobId);
      }
      await apiFetch(`/api/ndvi/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Mantém a limpeza local responsiva mesmo se o backend já removeu o job.
    }
    setNdviHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
    if (ndviJobId === entry.jobId) {
      setNdviJobId(null);
      setNdviProcessing(false);
      setNdviProgress(null);
      setNdviError(null);
    }
  }, [apiFetch, ndviJobId, requestProcessCancel]);

  const cancelNdviJob = useCallback(async (entry: NdviHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      await requestProcessCancel(entry.jobId);
      await apiFetch(`/api/ndvi/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Fallback: o SSE/status marca o job como cancelado.
    }
    setNdviProcessing(false);
    setNdviError('Cancelamento solicitado.');
  }, [apiFetch, requestProcessCancel]);

  useEffect(() => {
    if (!ndviProcessing || !ndviJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/ndvi/jobs/${encodeURIComponent(ndviJobId)}/status`, {
          method: 'GET',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active || !payload?.job) return;
        applyNdviJobPatch(mapNdviDocToHistoryItem(ndviJobId, payload.job));
      } catch {
        // SSE continua sendo o canal primário; polling é só fallback.
      }
    };
    void pollStatus();
    const interval = window.setInterval(() => {
      void pollStatus();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, applyNdviJobPatch, ndviJobId, ndviProcessing]);

  const downloadNdviBatchZip = useCallback(async (entry: NdviHistoryItem) => {
    const url = ndviBatchZipUrl(entry);
    const resolved = resolveBackendUrl(url);
    if (!resolved) {
      toast.error('Link do ZIP do lote NDVI indisponível.');
      return;
    }
    await downloadZip(url, entry.batchZipFilename || `NDVI_LANDSAT_LOTE_${entry.jobId.slice(0, 8)}.zip`);
  }, [downloadZip]);

  return {
    ndviFile,
    setNdviFile,
    ndviPropertyZipB64,
    setNdviPropertyZipB64,
    ndviSearching,
    setNdviSearching,
    ndviScenes,
    setNdviScenes,
    ndviSelectedSceneId,
    setNdviSelectedSceneId,
    ndviSelectedSceneIds,
    setNdviSelectedSceneIds,
    ndviPreviewScene,
    setNdviPreviewScene,
    ndviOrbit,
    setNdviOrbit,
    ndviPoint,
    setNdviPoint,
    ndviCarNumber,
    setNdviCarNumber,
    ndviDateStart,
    setNdviDateStart,
    ndviDateEnd,
    setNdviDateEnd,
    ndviMaxCloudCover,
    setNdviMaxCloudCover,
    ndviAreaHa,
    setNdviAreaHa,
    ndviPropertyGeometry,
    setNdviPropertyGeometry,
    ndviCompositions,
    setNdviCompositions,
    ndviProcessing,
    setNdviProcessing,
    ndviHistory,
    setNdviHistory,
    ndviJobId,
    setNdviJobId,
    ndviProgress,
    setNdviProgress,
    ndviError,
    setNdviError,
    ndviFileInputRef,
    ndviEventsAbortRef,
    resetNdviDraft,
    applyNdviJobPatch,
    connectNdviEvents,
    selectNdviHistoryEntry,
    hydrateFromDocs,
    sortNdviScenes,
    ndviVisibleScenes,
    ndviSelectedScenes,
    toggleNdviSceneSelection,
    applyNdviZipFile,
    searchNdviScenes,
    toggleNdviComposition,
    startNdviJobs,
    deleteNdviJob,
    cancelNdviJob,
    downloadNdviBatchZip,
    downloadZip,
    requestProcessCancel,
  };
}
