import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import { cbersOutputFilename } from '../cbers/filenames';
import { mapCbersDocToHistoryItem } from '../cbers/mapDoc';
import type {
  CbersEstimate,
  CbersHistoryItem,
  CbersScene,
  CbersSceneJobState,
} from '../cbers/types';
import { isPlainObject } from '@/dashboard/lib/values';

export type UseCbersJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  requestProcessCancel: (jobId: string | null | undefined) => Promise<boolean>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseCbersJobsReturn = ReturnType<typeof useCbersJobs>;

export function useCbersJobs({
  apiFetch,
  requestProcessCancel,
  downloadZip,
  fileToBase64Payload,
}: UseCbersJobsDeps) {
  const [cbersFile, setCbersFile] = useState<File | null>(null);
  const [cbersPropertyZipB64, setCbersPropertyZipB64] = useState<string | null>(null);
  const [cbersSearching, setCbersSearching] = useState(false);
  const [cbersScenes, setCbersScenes] = useState<CbersScene[]>([]);
  const [cbersSelectedSceneId, setCbersSelectedSceneId] = useState<string | null>(null);
  const [cbersSelectedSceneIds, setCbersSelectedSceneIds] = useState<string[]>([]);
  const [cbersPreviewScene, setCbersPreviewScene] = useState<CbersScene | null>(null);
  const [cbersOrbit, setCbersOrbit] = useState('');
  const [cbersPoint, setCbersPoint] = useState('');
  const [cbersCarNumber, setCbersCarNumber] = useState('');
  const [cbersDateStart, setCbersDateStart] = useState('');
  const [cbersDateEnd, setCbersDateEnd] = useState('');
  const [cbersMaxCloudCover, setCbersMaxCloudCover] = useState('');
  const [, setCbersLevelFilter] = useState<'L4'>('L4');
  const [cbersSortOrder, setCbersSortOrder] = useState<'desc' | 'asc'>('desc');
  const [cbersAreaHa, setCbersAreaHa] = useState<number | null>(null);
  const [cbersPropertyGeometry, setCbersPropertyGeometry] = useState<CbersGeoJsonGeometry | null>(null);
  const [cbersEstimating, setCbersEstimating] = useState(false);
  const [cbersProcessing, setCbersProcessing] = useState(false);
  const [cbersHistory, setCbersHistory] = useState<CbersHistoryItem[]>([]);
  const [cbersJobId, setCbersJobId] = useState<string | null>(null);
  const [cbersProgress, setCbersProgress] = useState<{ stage: string; percent: number; message: string } | null>(null);
  const [cbersError, setCbersError] = useState<string | null>(null);
  const [cbersWmsDownloadingId, setCbersWmsDownloadingId] = useState<string | null>(null);
  const cbersFileInputRef = useRef<HTMLInputElement | null>(null);
  const cbersEventsAbortRef = useRef<AbortController | null>(null);

  const resetCbersDraft = useCallback(() => {
    cbersEventsAbortRef.current?.abort();
    cbersEventsAbortRef.current = null;
    setCbersFile(null);
    setCbersPropertyZipB64(null);
    setCbersSearching(false);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    setCbersSelectedSceneIds([]);
    setCbersPreviewScene(null);
    setCbersOrbit('');
    setCbersPoint('');
    setCbersCarNumber('');
    setCbersDateStart('');
    setCbersDateEnd('');
    setCbersMaxCloudCover('');
    setCbersLevelFilter('L4');
    setCbersSortOrder('desc');
    setCbersAreaHa(null);
    setCbersPropertyGeometry(null);
    setCbersEstimating(false);
    setCbersProcessing(false);
    setCbersJobId(null);
    setCbersProgress(null);
    setCbersError(null);
    if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
  }, []);

  const applyCbersJobPatch = useCallback((job: CbersHistoryItem) => {
    setCbersHistory((prev) => {
      const exists = prev.some((item) => item.jobId === job.jobId);
      const next = exists
        ? prev.map((item) => (item.jobId === job.jobId ? {
          ...item,
          ...job,
          filename: job.filename === 'CBERS-4A/WPM' ? item.filename : job.filename,
          timestamp: item.timestamp || job.timestamp,
          createdAt: job.createdAt || item.createdAt,
          updatedAt: job.updatedAt || item.updatedAt,
          itemId: job.itemId || item.itemId,
          collection: job.collection || item.collection,
          areaHa: job.areaHa ?? item.areaHa,
          scene: job.scene || item.scene,
          scenes: job.scenes || item.scenes,
          itemIds: job.itemIds || item.itemIds,
          mode: job.mode || item.mode,
          outputUrl: job.outputUrl || item.outputUrl,
          outputRelativePath: job.outputRelativePath || item.outputRelativePath,
          outputBytes: job.outputBytes ?? item.outputBytes,
          archiveImageId: job.archiveImageId || item.archiveImageId,
          archiveFilename: job.archiveFilename || item.archiveFilename,
          wmsLayerName: job.wmsLayerName || item.wmsLayerName,
          wmsUrl: job.wmsUrl || item.wmsUrl,
          wmsDownloadUrl: job.wmsDownloadUrl || item.wmsDownloadUrl,
        } : item))
        : [job, ...prev];
      return next.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    });
    setCbersJobId(job.jobId);
    setCbersProcessing(job.status === 'processing');
    setCbersProgress({
      stage: job.stage || job.status,
      percent: job.percent,
      message: job.message || '',
    });
    setCbersError(job.status === 'failed' || job.status === 'cancelled' ? job.error || job.message || null : null);
  }, []);

  const connectCbersEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    cbersEventsAbortRef.current?.abort();
    const controller = new AbortController();
    cbersEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
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
              applyCbersJobPatch(mapCbersDocToHistoryItem(normalizedJobId, evt.job));
            } else if (evt?.type === 'progress') {
              applyCbersJobPatch(mapCbersDocToHistoryItem(normalizedJobId, evt));
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos CBERS:', error);
      }
    } finally {
      if (cbersEventsAbortRef.current === controller) cbersEventsAbortRef.current = null;
    }
  }, [apiFetch, applyCbersJobPatch]);

  const selectCbersHistoryEntry = useCallback((entry: CbersHistoryItem) => {
    setCbersJobId(entry.jobId);
    setCbersProcessing(entry.status === 'processing');
    setCbersProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || '',
    });
    setCbersError(entry.status === 'failed' || entry.status === 'cancelled' ? entry.error || entry.message || null : null);
    setCbersSelectedSceneId(entry.itemId || entry.scene?.id || null);
    if (entry.status === 'processing') void connectCbersEvents(entry.jobId);
  }, [connectCbersEvents]);

  const hydrateFromDocs = useCallback((docs: Array<{ id: string; data: any }>) => {
    const cbersEntries = docs.map((docSnap) => mapCbersDocToHistoryItem(docSnap.id, docSnap.data));
    setCbersHistory(cbersEntries);
    const runningCbers = cbersEntries.find((entry) => entry.status === 'processing');
    if (runningCbers) {
      selectCbersHistoryEntry(runningCbers);
    } else if (cbersEntries.length > 0) {
      selectCbersHistoryEntry(cbersEntries[0]);
    }
  }, [selectCbersHistoryEntry]);

  const sortCbersScenes = useCallback(
    (scenes: CbersScene[]) => {
      return [...scenes].sort((a, b) => {
        const cmp = String(b.datetime || '').localeCompare(String(a.datetime || ''));
        return cbersSortOrder === 'desc' ? cmp : -cmp;
      });
    },
    [cbersSortOrder]
  );

  const cbersVisibleScenes = useMemo(() => {
    const startMs = cbersDateStart ? new Date(`${cbersDateStart}T00:00:00`).getTime() : null;
    const endMs = cbersDateEnd ? new Date(`${cbersDateEnd}T23:59:59`).getTime() : null;
    const maxCloud = cbersMaxCloudCover.trim() ? Number(cbersMaxCloudCover) : null;
    return sortCbersScenes(
      cbersScenes.filter((scene) => {
        if (scene.level && scene.level !== 'L4') return false;
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
  }, [cbersDateEnd, cbersDateStart, cbersMaxCloudCover, cbersScenes, sortCbersScenes]);

  useEffect(() => {
    if (cbersScenes.length === 0) return;
    const visibleIds = new Set(cbersVisibleScenes.map((scene) => scene.id));
    setCbersSelectedSceneIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    if (cbersSelectedSceneId && !visibleIds.has(cbersSelectedSceneId)) {
      setCbersSelectedSceneId(cbersVisibleScenes[0]?.id || null);
    }
  }, [cbersScenes.length, cbersSelectedSceneId, cbersVisibleScenes]);

  const cbersSelectedScenes = useMemo(
    () => cbersSelectedSceneIds
      .map((id) => cbersScenes.find((scene) => scene.id === id))
      .filter((scene): scene is CbersScene => Boolean(scene)),
    [cbersScenes, cbersSelectedSceneIds]
  );

  const toggleCbersSceneSelection = useCallback((scene: CbersScene) => {
    if (scene.level && scene.level !== 'L4') {
      toast.error('A geração CBERS está restrita a cenas L4.');
      return;
    }
    if (scene.wmsAvailable) {
      toast.info('Esta folha já está disponível no WMS. Use a imagem publicada em vez de gerar novamente.');
      return;
    }
    if (scene.coversArea === false) {
      toast.error(`Cena cobre apenas ${(scene.coveragePercent ?? 0).toFixed(2)}% da área.`);
      return;
    }
    setCbersSelectedSceneId(scene.id);
    setCbersSelectedSceneIds((prev) => {
      if (prev.includes(scene.id)) return prev.filter((id) => id !== scene.id);
      return [...prev, scene.id];
    });
  }, []);

  const estimateCbersScenes = useCallback(async (itemIds: string[]) => {
    if (itemIds.length === 0) return;
    setCbersEstimating(true);
    try {
      const body: Record<string, unknown> = { itemIds };
      const carNumber = cbersCarNumber.trim();
      if (cbersFile) {
        const propertyZip = cbersPropertyZipB64 || await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/cbers-wpm/estimate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao estimar cenas CBERS.');
      const estimates = Array.isArray(payload?.estimates) ? payload.estimates : [];
      setCbersScenes((prev) => prev.map((scene) => {
        const found = estimates.find((item: any) => String(item?.itemId || '') === scene.id);
        if (!found) return scene;
        return {
          ...scene,
          ...(isPlainObject(found.scene) ? found.scene : {}),
          estimate: isPlainObject(found.estimate) ? found.estimate as CbersEstimate : scene.estimate,
        } as CbersScene;
      }));
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao estimar cenas CBERS.');
    } finally {
      setCbersEstimating(false);
    }
  }, [apiFetch, cbersCarNumber, cbersFile, cbersPropertyZipB64, fileToBase64Payload]);

  useEffect(() => {
    const missing = cbersSelectedScenes
      .filter((scene) => scene.coversArea !== false && !scene.estimate)
      .map((scene) => scene.id);
    if (missing.length > 0) void estimateCbersScenes(missing);
  }, [cbersSelectedScenes, estimateCbersScenes]);

  const applyCbersZipFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um shapefile compactado em .zip.');
      return;
    }
    setCbersFile(file);
    setCbersPropertyZipB64(null);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    setCbersSelectedSceneIds([]);
    setCbersPreviewScene(null);
    setCbersPropertyGeometry(null);
    setCbersAreaHa(null);
    setCbersError(null);
    setCbersCarNumber('');
  }, []);

  const searchCbersScenes = useCallback(async () => {
    const orbit = cbersOrbit.trim();
    const point = cbersPoint.trim();
    const carNumber = cbersCarNumber.trim();
    const hasDirectFilter = orbit.length > 0 && point.length > 0;
    if (!cbersFile && !carNumber && !hasDirectFilter) {
      toast.error('Selecione um ZIP/SHP, informe Nº do CAR estadual ou informe órbita e ponto.');
      return;
    }
    if (cbersDateStart && cbersDateEnd && cbersDateStart > cbersDateEnd) {
      toast.error('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    setCbersSearching(true);
    setCbersError(null);
    setCbersScenes([]);
    setCbersSelectedSceneId(null);
    try {
      const body: Record<string, unknown> = {
        dateStart: cbersDateStart || undefined,
        dateEnd: cbersDateEnd || undefined,
        orbit: orbit || undefined,
        point: point || undefined,
      };
      if (cbersFile) {
        const propertyZip = await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
        body.filename = cbersFile.name;
      } else if (carNumber) {
        setCbersPropertyZipB64(null);
        body.carNumber = carNumber;
        body.filename = `CAR_${carNumber}.zip`;
      } else {
        setCbersPropertyZipB64(null);
      }
      const response = await apiFetch('/api/cbers-wpm/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao buscar cenas CBERS.');
      const scenes = sortCbersScenes(Array.isArray(payload?.scenes) ? payload.scenes as CbersScene[] : []);
      const nextAreaHa = Number(payload?.areaHa);
      setCbersAreaHa(Number.isFinite(nextAreaHa) && nextAreaHa > 0 ? nextAreaHa : null);
      setCbersPropertyGeometry(isPlainObject(payload?.propertyGeometry) ? payload.propertyGeometry as CbersGeoJsonGeometry : null);
      setCbersScenes(scenes);
      const maxCloud = cbersMaxCloudCover.trim() ? Number(cbersMaxCloudCover) : null;
      const firstCovered = scenes.find((scene) => {
        if (scene.level && scene.level !== 'L4') return false;
        if (scene.coversArea === false || scene.wmsAvailable) return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          return scene.cloudCover !== null && scene.cloudCover <= maxCloud;
        }
        return true;
      });
      setCbersSelectedSceneId(firstCovered?.id || scenes[0]?.id || null);
      setCbersSelectedSceneIds(firstCovered ? [firstCovered.id] : []);
      setCbersPreviewScene(null);
      if (!scenes.length) {
        toast.info(hasDirectFilter && !carNumber ? 'Nenhuma cena CBERS-4A/WPM encontrada para essa órbita/ponto.' : 'Nenhuma cena CBERS-4A/WPM encontrada para essa área.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao buscar cenas CBERS.';
      setCbersError(message);
      toast.error(message);
    } finally {
      setCbersSearching(false);
    }
  }, [apiFetch, cbersCarNumber, cbersDateEnd, cbersDateStart, cbersFile, cbersMaxCloudCover, cbersOrbit, cbersPoint, fileToBase64Payload, sortCbersScenes]);

  const startCbersProcessing = useCallback(async (sceneIdOverride?: string) => {
    const targetSceneIds = sceneIdOverride
      ? [String(sceneIdOverride).trim()].filter(Boolean)
      : cbersSelectedSceneIds.length > 0
        ? cbersSelectedSceneIds
        : [String(cbersSelectedSceneId || '').trim()].filter(Boolean);
    if (targetSceneIds.length === 0) {
      toast.error('Selecione ao menos uma cena CBERS.');
      return;
    }
    const blocked = targetSceneIds
      .map((id) => cbersScenes.find((scene) => scene.id === id))
      .find((scene) => scene?.coversArea === false || scene?.wmsAvailable || (scene?.level && scene.level !== 'L4'));
    if (blocked) {
      toast.error(
        blocked.wmsAvailable
          ? `A folha da cena ${blocked.id} já está disponível no WMS. Use a imagem existente.`
          : blocked.level && blocked.level !== 'L4'
            ? `A cena ${blocked.id} é ${blocked.level}; a geração aceita somente L4.`
            : `Cena ${blocked.id} não cobre 100% da área.`
      );
      return;
    }
    setCbersError(null);
    setCbersProcessing(true);
    setCbersProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento CBERS ao servidor.' });
    try {
      const carNumber = cbersCarNumber.trim();
      const filename = cbersFile?.name || (carNumber ? `CAR_${carNumber}.zip` : `CBERS_${targetSceneIds[0] || 'ORBITA_PONTO'}`);
      const body: Record<string, unknown> = {
        filename,
        itemId: targetSceneIds[0],
        itemIds: targetSceneIds,
      };
      if (cbersFile) {
        const propertyZip = cbersPropertyZipB64 || await fileToBase64Payload(cbersFile);
        setCbersPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/cbers-wpm/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento CBERS.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId CBERS.');
      const scene = cbersScenes.find((item) => item.id === targetSceneIds[0]) || null;
      const optimisticScenes: CbersSceneJobState[] = targetSceneIds.map((itemId) => ({
        itemId,
        scene: cbersScenes.find((item) => item.id === itemId) || null,
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Aguardando processamento.',
        estimate: cbersScenes.find((item) => item.id === itemId)?.estimate,
      }));
      const optimistic: CbersHistoryItem = {
        id: jobId,
        jobId,
        filename,
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: 'Processamento CBERS enviado para o servidor.',
        itemId: targetSceneIds[0],
        itemIds: targetSceneIds,
        mode: targetSceneIds.length > 1 ? 'batch' : 'single',
        collection: 'CB4A-WPM-L4-DN-1',
        areaHa: cbersAreaHa || undefined,
        scene,
        scenes: optimisticScenes,
      };
      applyCbersJobPatch(optimistic);
      void connectCbersEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao iniciar processamento CBERS.';
      setCbersProcessing(false);
      setCbersError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyCbersJobPatch,
    cbersAreaHa,
    cbersCarNumber,
    cbersFile,
    cbersPropertyZipB64,
    cbersScenes,
    cbersSelectedSceneId,
    cbersSelectedSceneIds,
    connectCbersEvents,
    fileToBase64Payload,
  ]);

  const deleteCbersJob = useCallback(async (entry: CbersHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      if (entry.status === 'processing') {
        await requestProcessCancel(entry.jobId);
      }
      await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Keep local cleanup responsive even if backend already removed it.
    }
    setCbersHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
    if (cbersJobId === entry.jobId) {
      setCbersJobId(null);
      setCbersProcessing(false);
      setCbersProgress(null);
      setCbersError(null);
    }
  }, [apiFetch, cbersJobId, requestProcessCancel]);

  useEffect(() => {
    if (!cbersProcessing || !cbersJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/cbers-wpm/jobs/${encodeURIComponent(cbersJobId)}/status`, {
          method: 'GET',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active || !payload?.job) return;
        applyCbersJobPatch(mapCbersDocToHistoryItem(cbersJobId, payload.job));
      } catch {
        // SSE remains the primary live channel; polling is only a fallback.
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
  }, [apiFetch, applyCbersJobPatch, cbersJobId, cbersProcessing]);

  const downloadCbersWmsZip = useCallback(async (scene: CbersScene) => {
    const endpoint = scene.wmsDownloadUrl || (
      scene.archiveImageId
        ? `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(scene.archiveImageId)}`
        : `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(scene.id)}`
    );
    if (!resolveBackendUrl(endpoint)) {
      toast.error('Link do ZIP da imagem WMS indisponível.');
      return;
    }
    setCbersWmsDownloadingId(scene.id);
    try {
      await downloadZip(
        endpoint,
        `${scene.archiveFilename || cbersOutputFilename(scene.id).replace(/\.(tif|tiff)$/i, '')}.zip`
          .replace(/[^a-zA-Z0-9._-]/g, '_') || 'CBERS_4A_WPM.zip',
      );
    } finally {
      window.setTimeout(() => setCbersWmsDownloadingId(null), 1200);
    }
  }, [downloadZip]);

  return {
    cbersFile,
    setCbersFile,
    cbersPropertyZipB64,
    setCbersPropertyZipB64,
    cbersSearching,
    setCbersSearching,
    cbersScenes,
    setCbersScenes,
    cbersSelectedSceneId,
    setCbersSelectedSceneId,
    cbersSelectedSceneIds,
    setCbersSelectedSceneIds,
    cbersPreviewScene,
    setCbersPreviewScene,
    cbersOrbit,
    setCbersOrbit,
    cbersPoint,
    setCbersPoint,
    cbersCarNumber,
    setCbersCarNumber,
    cbersDateStart,
    setCbersDateStart,
    cbersDateEnd,
    setCbersDateEnd,
    cbersMaxCloudCover,
    setCbersMaxCloudCover,
    setCbersLevelFilter,
    cbersSortOrder,
    setCbersSortOrder,
    cbersAreaHa,
    setCbersAreaHa,
    cbersPropertyGeometry,
    setCbersPropertyGeometry,
    cbersEstimating,
    setCbersEstimating,
    cbersProcessing,
    setCbersProcessing,
    cbersHistory,
    setCbersHistory,
    cbersJobId,
    setCbersJobId,
    cbersProgress,
    setCbersProgress,
    cbersError,
    setCbersError,
    cbersWmsDownloadingId,
    setCbersWmsDownloadingId,
    cbersFileInputRef,
    cbersEventsAbortRef,
    resetCbersDraft,
    applyCbersJobPatch,
    connectCbersEvents,
    selectCbersHistoryEntry,
    hydrateFromDocs,
    sortCbersScenes,
    cbersVisibleScenes,
    cbersSelectedScenes,
    toggleCbersSceneSelection,
    estimateCbersScenes,
    applyCbersZipFile,
    searchCbersScenes,
    startCbersProcessing,
    deleteCbersJob,
    downloadCbersWmsZip,
    downloadZip,
    requestProcessCancel,
  };
}
