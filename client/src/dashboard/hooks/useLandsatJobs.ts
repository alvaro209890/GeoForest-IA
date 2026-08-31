import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import {
  landsatArchiveZipFilename,
  landsatArchiveZipUrl,
} from '../landsat/filenames';
import { mapLandsatDocToHistoryItem, normalizeLandsatScene } from '../landsat/mapDoc';
import type {
  LandsatComposition,
  LandsatHistoryItem,
  LandsatScene,
} from '../landsat/types';
import { isPlainObject } from '@/dashboard/lib/values';

export type UseLandsatJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseLandsatJobsReturn = ReturnType<typeof useLandsatJobs>;

export function useLandsatJobs({
  apiFetch,
  downloadZip,
  fileToBase64Payload,
}: UseLandsatJobsDeps) {
  const [landsatFile, setLandsatFile] = useState<File | null>(null);
  const [landsatPropertyZipB64, setLandsatPropertyZipB64] = useState<string | null>(null);
  const [landsatSearching, setLandsatSearching] = useState(false);
  const [landsatScenes, setLandsatScenes] = useState<LandsatScene[]>([]);
  const [landsatSelectedSceneId, setLandsatSelectedSceneId] = useState<string | null>(null);
  const [landsatPreviewScene, setLandsatPreviewScene] = useState<LandsatScene | null>(null);
  const [landsatOrbit, setLandsatOrbit] = useState('');
  const [landsatPoint, setLandsatPoint] = useState('');
  const [landsatCarNumber, setLandsatCarNumber] = useState('');
  const [landsatDateStart, setLandsatDateStart] = useState('');
  const [landsatDateEnd, setLandsatDateEnd] = useState('');
  const [landsatMaxCloudCover, setLandsatMaxCloudCover] = useState('30');
  const [landsatComposition, setLandsatComposition] = useState<LandsatComposition>('false_color');
  const [landsatAreaHa, setLandsatAreaHa] = useState<number | null>(null);
  const [landsatPropertyGeometry, setLandsatPropertyGeometry] = useState<CbersGeoJsonGeometry | null>(null);
  const [landsatProcessing, setLandsatProcessing] = useState(false);
  const [landsatHistory, setLandsatHistory] = useState<LandsatHistoryItem[]>([]);
  const [landsatJobId, setLandsatJobId] = useState<string | null>(null);
  const [landsatProgress, setLandsatProgress] = useState<{ stage: string; percent: number; message: string } | null>(null);
  const [landsatError, setLandsatError] = useState<string | null>(null);
  const [landsatWmsDownloadingId, setLandsatWmsDownloadingId] = useState<string | null>(null);
  const landsatFileInputRef = useRef<HTMLInputElement | null>(null);
  const landsatEventsAbortRef = useRef<AbortController | null>(null);

  const resetLandsatDraft = useCallback(() => {
    landsatEventsAbortRef.current?.abort();
    landsatEventsAbortRef.current = null;
    setLandsatFile(null);
    setLandsatPropertyZipB64(null);
    setLandsatSearching(false);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    setLandsatPreviewScene(null);
    setLandsatOrbit('');
    setLandsatPoint('');
    setLandsatCarNumber('');
    setLandsatDateStart('');
    setLandsatDateEnd('');
    setLandsatMaxCloudCover('30');
    setLandsatComposition('false_color');
    setLandsatAreaHa(null);
    setLandsatPropertyGeometry(null);
    setLandsatProcessing(false);
    setLandsatJobId(null);
    setLandsatProgress(null);
    setLandsatError(null);
    setLandsatWmsDownloadingId(null);
    if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
  }, []);

  const applyLandsatJobPatch = useCallback((job: LandsatHistoryItem) => {
    setLandsatHistory((prev) => {
      const exists = prev.some((item) => item.jobId === job.jobId);
      const next = exists
        ? prev.map((item) => (item.jobId === job.jobId ? {
          ...item,
          ...job,
          filename: job.filename === 'LANDSAT' ? item.filename : job.filename,
          timestamp: item.timestamp || job.timestamp,
          createdAt: job.createdAt || item.createdAt,
          updatedAt: job.updatedAt || item.updatedAt,
          sceneId: job.sceneId || item.sceneId,
          composition: job.composition || item.composition,
          scene: job.scene || item.scene,
          outputUrl: job.outputUrl || item.outputUrl,
          outputRelativePath: job.outputRelativePath || item.outputRelativePath,
          outputFilename: job.outputFilename || item.outputFilename,
          outputBytes: job.outputBytes ?? item.outputBytes,
          wmsLayerName: job.wmsLayerName || item.wmsLayerName,
          wmsStoreName: job.wmsStoreName || item.wmsStoreName,
          wmsUrl: job.wmsUrl || item.wmsUrl,
          wmsDownloadUrl: job.wmsDownloadUrl || item.wmsDownloadUrl,
        } : item))
        : [job, ...prev];
      return next.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    });
    setLandsatJobId(job.jobId);
    setLandsatProcessing(job.status === 'processing');
    setLandsatProgress({
      stage: job.stage || job.status,
      percent: job.percent,
      message: job.message || '',
    });
    setLandsatError(job.status === 'failed' || job.status === 'cancelled' ? job.error || job.message || null : null);
    if (job.sceneId) setLandsatSelectedSceneId(job.sceneId);
  }, []);

  const connectLandsatEvents = useCallback(async (jobId: string) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    landsatEventsAbortRef.current?.abort();
    const controller = new AbortController();
    landsatEventsAbortRef.current = controller;
    try {
      const response = await apiFetch(`/api/landsat/jobs/${encodeURIComponent(normalizedJobId)}/events`, {
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
              applyLandsatJobPatch(mapLandsatDocToHistoryItem(normalizedJobId, evt.job));
            } else if (evt?.type === 'progress') {
              applyLandsatJobPatch(mapLandsatDocToHistoryItem(normalizedJobId, evt));
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.warn('Falha ao acompanhar eventos Landsat:', error);
      }
    } finally {
      if (landsatEventsAbortRef.current === controller) landsatEventsAbortRef.current = null;
    }
  }, [apiFetch, applyLandsatJobPatch]);

  const selectLandsatHistoryEntry = useCallback((entry: LandsatHistoryItem) => {
    setLandsatJobId(entry.jobId);
    setLandsatProcessing(entry.status === 'processing');
    setLandsatProgress({
      stage: entry.stage || entry.status,
      percent: entry.percent,
      message: entry.message || '',
    });
    setLandsatError(entry.status === 'failed' || entry.status === 'cancelled' ? entry.error || entry.message || null : null);
    setLandsatSelectedSceneId(entry.sceneId || entry.scene?.id || null);
    if (entry.status === 'processing') void connectLandsatEvents(entry.jobId);
  }, [connectLandsatEvents]);

  const hydrateFromDocs = useCallback((docs: Array<{ id: string; data: any }>) => {
    const landsatEntries = docs.map((docSnap) => mapLandsatDocToHistoryItem(docSnap.id, docSnap.data));
    setLandsatHistory(landsatEntries);
    const runningLandsat = landsatEntries.find((entry) => entry.status === 'processing');
    if (runningLandsat) {
      selectLandsatHistoryEntry(runningLandsat);
    } else if (landsatEntries.length > 0) {
      selectLandsatHistoryEntry(landsatEntries[0]);
    }
  }, [selectLandsatHistoryEntry]);

  const sortLandsatScenes = useCallback((scenes: LandsatScene[]) => {
    return [...scenes].sort((a, b) => String(b.datetime || '').localeCompare(String(a.datetime || '')));
  }, []);

  const landsatVisibleScenes = useMemo(() => {
    const startMs = landsatDateStart ? new Date(`${landsatDateStart}T00:00:00`).getTime() : null;
    const endMs = landsatDateEnd ? new Date(`${landsatDateEnd}T23:59:59`).getTime() : null;
    const maxCloud = landsatMaxCloudCover.trim() ? Number(landsatMaxCloudCover) : null;
    return sortLandsatScenes(
      landsatScenes.filter((scene) => {
        if (scene.composition !== landsatComposition) return false;
        if (maxCloud !== null && Number.isFinite(maxCloud)) {
          if (scene.cloudCover !== null && scene.cloudCover > maxCloud) return false;
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
  }, [landsatComposition, landsatDateEnd, landsatDateStart, landsatMaxCloudCover, landsatScenes, sortLandsatScenes]);

  useEffect(() => {
    if (landsatScenes.length === 0) return;
    const visibleIds = new Set(landsatVisibleScenes.map((scene) => scene.id));
    if (landsatSelectedSceneId && !visibleIds.has(landsatSelectedSceneId)) {
      setLandsatSelectedSceneId(landsatVisibleScenes[0]?.id || null);
    }
  }, [landsatScenes.length, landsatSelectedSceneId, landsatVisibleScenes]);

  const landsatSelectedScene = useMemo(
    () => landsatScenes.find((scene) => scene.id === landsatSelectedSceneId) || null,
    [landsatScenes, landsatSelectedSceneId]
  );
  const activeLandsatHistory = useMemo(
    () => landsatJobId ? landsatHistory.find((item) => item.jobId === landsatJobId) || null : null,
    [landsatHistory, landsatJobId]
  );
  const landsatSearchStats = useMemo(() => {
    const local = landsatScenes.filter((scene) => scene.wmsAvailable || scene.source === 'local_wms').length;
    const external = landsatScenes.filter((scene) => !scene.wmsAvailable && scene.source !== 'local_wms').length;
    const visibleLocal = landsatVisibleScenes.filter((scene) => scene.wmsAvailable || scene.source === 'local_wms').length;
    const coverages = landsatVisibleScenes
      .map((scene) => Number(scene.coveragePercent))
      .filter((value) => Number.isFinite(value));
    const bestCoverage = coverages.length ? Math.max(...coverages) : null;
    const dates = landsatVisibleScenes
      .map((scene) => scene.datetime || (scene.date && scene.date.length === 8 ? `${scene.date.slice(0, 4)}-${scene.date.slice(4, 6)}-${scene.date.slice(6, 8)}T00:00:00Z` : ''))
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const firstDate = dates.length ? new Date(dates[0]).toLocaleDateString('pt-BR') : 'n/d';
    const lastDate = dates.length ? new Date(dates[dates.length - 1]).toLocaleDateString('pt-BR') : 'n/d';
    return {
      total: landsatScenes.length,
      visible: landsatVisibleScenes.length,
      local,
      external,
      visibleLocal,
      bestCoverage,
      periodLabel: firstDate === lastDate ? firstDate : `${firstDate} - ${lastDate}`,
    };
  }, [landsatScenes, landsatVisibleScenes]);

  const applyLandsatZipFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Envie um shapefile compactado em .zip.');
      return;
    }
    setLandsatFile(file);
    setLandsatPropertyZipB64(null);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    setLandsatPreviewScene(null);
    setLandsatPropertyGeometry(null);
    setLandsatAreaHa(null);
    setLandsatError(null);
    setLandsatCarNumber('');
  }, []);

  const searchLandsatScenes = useCallback(async () => {
    const orbit = landsatOrbit.trim();
    const point = landsatPoint.trim();
    const carNumber = landsatCarNumber.trim();
    const hasDirectFilter = orbit.length > 0 && point.length > 0;
    if (!landsatFile && !carNumber && !hasDirectFilter) {
      toast.error('Selecione um ZIP/SHP, informe Nº do CAR estadual ou informe órbita e ponto.');
      return;
    }
    if (landsatDateStart && landsatDateEnd && landsatDateStart > landsatDateEnd) {
      toast.error('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    const maxCloud = landsatMaxCloudCover.trim() ? Number(landsatMaxCloudCover) : undefined;
    setLandsatSearching(true);
    setLandsatError(null);
    setLandsatScenes([]);
    setLandsatSelectedSceneId(null);
    try {
      const body: Record<string, unknown> = {
        dateStart: landsatDateStart || undefined,
        dateEnd: landsatDateEnd || undefined,
        orbit: orbit || undefined,
        row: point || undefined,
        point: point || undefined,
        maxCloudCover: Number.isFinite(maxCloud) ? maxCloud : undefined,
        composition: landsatComposition,
      };
      if (landsatFile) {
        const propertyZip = await fileToBase64Payload(landsatFile);
        setLandsatPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
        body.filename = landsatFile.name;
      } else if (carNumber) {
        setLandsatPropertyZipB64(null);
        body.carNumber = carNumber;
        body.filename = `CAR_${carNumber}.zip`;
      } else {
        setLandsatPropertyZipB64(null);
      }
      const response = await apiFetch('/api/landsat/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao buscar cenas Landsat.');
      const scenes = sortLandsatScenes(
        (Array.isArray(payload?.scenes) ? payload.scenes : [])
          .map((item: any) => normalizeLandsatScene(item))
          .filter((item: LandsatScene | null): item is LandsatScene => Boolean(item))
      );
      const nextAreaHa = Number(payload?.areaHa);
      setLandsatAreaHa(Number.isFinite(nextAreaHa) && nextAreaHa > 0 ? nextAreaHa : null);
      setLandsatPropertyGeometry(isPlainObject(payload?.propertyGeometry) ? payload.propertyGeometry as CbersGeoJsonGeometry : null);
      setLandsatScenes(scenes);
      const firstCovered = scenes.find((scene) => scene.coversArea !== false) || scenes[0] || null;
      setLandsatSelectedSceneId(firstCovered?.id || null);
      setLandsatPreviewScene(null);
      if (!scenes.length) {
        toast.info(hasDirectFilter && !carNumber ? 'Nenhuma cena Landsat encontrada para essa órbita/ponto.' : 'Nenhuma cena Landsat encontrada para essa área.');
      }
    } catch (error: any) {
      const message = error?.message || 'Falha ao buscar cenas Landsat.';
      setLandsatError(message);
      toast.error(message);
    } finally {
      setLandsatSearching(false);
    }
  }, [
    apiFetch,
    fileToBase64Payload,
    landsatCarNumber,
    landsatComposition,
    landsatDateEnd,
    landsatDateStart,
    landsatFile,
    landsatMaxCloudCover,
    landsatOrbit,
    landsatPoint,
    sortLandsatScenes,
  ]);

  const startLandsatProcessing = useCallback(async (sceneIdOverride?: string) => {
    const targetSceneId = String(sceneIdOverride || landsatSelectedSceneId || '').trim();
    if (!targetSceneId) {
      toast.error('Selecione uma cena Landsat.');
      return;
    }
    const scene = landsatScenes.find((item) => item.id === targetSceneId) || landsatSelectedScene;
    if (scene?.coversArea === false) {
      toast.error(`Cena cobre apenas ${(scene.coveragePercent ?? 0).toFixed(2)}% da área.`);
      return;
    }
    setLandsatError(null);
    setLandsatProcessing(true);
    setLandsatProgress({ stage: 'queued', percent: 1, message: 'Enviando processamento Landsat ao servidor.' });
    try {
      const carNumber = landsatCarNumber.trim();
      const filename = landsatFile?.name || (carNumber ? `CAR_${carNumber}.zip` : `LANDSAT_${scene?.orbit || targetSceneId}`);
      const body: Record<string, unknown> = {
        filename,
        sceneId: targetSceneId,
        composition: scene?.composition || landsatComposition,
      };
      if (landsatFile) {
        const propertyZip = landsatPropertyZipB64 || await fileToBase64Payload(landsatFile);
        setLandsatPropertyZipB64(propertyZip);
        body.propertyZip = propertyZip;
      } else if (carNumber) {
        body.carNumber = carNumber;
      }
      const response = await apiFetch('/api/landsat/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Falha ao iniciar processamento Landsat.');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) throw new Error('Backend não retornou jobId Landsat.');
      const optimistic: LandsatHistoryItem = {
        id: jobId,
        jobId,
        filename,
        timestamp: new Date().toISOString(),
        status: 'processing',
        stage: 'queued',
        percent: 1,
        message: scene?.wmsAvailable ? 'Imagem Landsat encontrada no WMS; registrando reuso.' : 'Processamento Landsat enviado para o servidor.',
        sceneId: targetSceneId,
        composition: scene?.composition || landsatComposition,
        scene: scene || null,
      };
      applyLandsatJobPatch(optimistic);
      void connectLandsatEvents(jobId);
    } catch (error: any) {
      const message = error?.message || 'Falha ao iniciar processamento Landsat.';
      setLandsatProcessing(false);
      setLandsatError(message);
      toast.error(message);
    }
  }, [
    apiFetch,
    applyLandsatJobPatch,
    connectLandsatEvents,
    fileToBase64Payload,
    landsatCarNumber,
    landsatComposition,
    landsatFile,
    landsatPropertyZipB64,
    landsatScenes,
    landsatSelectedScene,
    landsatSelectedSceneId,
  ]);

  const deleteLandsatJob = useCallback(async (entry: LandsatHistoryItem) => {
    if (!entry?.jobId) return;
    try {
      await apiFetch(`/api/landsat/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
    } catch {
      // Keep local cleanup responsive even if backend already removed it.
    }
    setLandsatHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
    if (landsatJobId === entry.jobId) {
      setLandsatJobId(null);
      setLandsatProcessing(false);
      setLandsatProgress(null);
      setLandsatError(null);
    }
  }, [apiFetch, landsatJobId]);

  useEffect(() => {
    if (!landsatProcessing || !landsatJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/landsat/jobs/${encodeURIComponent(landsatJobId)}/status`, {
          method: 'GET',
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active || !payload?.job) return;
        applyLandsatJobPatch(mapLandsatDocToHistoryItem(landsatJobId, payload.job));
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
  }, [apiFetch, applyLandsatJobPatch, landsatJobId, landsatProcessing]);

  const downloadLandsatWmsZip = useCallback(async (item: LandsatHistoryItem | LandsatScene) => {
    const url = landsatArchiveZipUrl(item);
    const resolved = resolveBackendUrl(url);
    if (!resolved) {
      toast.error('Link do ZIP Landsat indisponível.');
      return;
    }
    const id = (item as any)?.jobId || (item as any)?.id || (item as any)?.sceneId || 'landsat';
    setLandsatWmsDownloadingId(String(id));
    try {
      await downloadZip(url, landsatArchiveZipFilename(item));
    } finally {
      window.setTimeout(() => setLandsatWmsDownloadingId(null), 1200);
    }
  }, [downloadZip]);

  return {
    landsatFile,
    setLandsatFile,
    landsatPropertyZipB64,
    setLandsatPropertyZipB64,
    landsatSearching,
    setLandsatSearching,
    landsatScenes,
    setLandsatScenes,
    landsatSelectedSceneId,
    setLandsatSelectedSceneId,
    landsatPreviewScene,
    setLandsatPreviewScene,
    landsatOrbit,
    setLandsatOrbit,
    landsatPoint,
    setLandsatPoint,
    landsatCarNumber,
    setLandsatCarNumber,
    landsatDateStart,
    setLandsatDateStart,
    landsatDateEnd,
    setLandsatDateEnd,
    landsatMaxCloudCover,
    setLandsatMaxCloudCover,
    landsatComposition,
    setLandsatComposition,
    landsatAreaHa,
    setLandsatAreaHa,
    landsatPropertyGeometry,
    setLandsatPropertyGeometry,
    landsatProcessing,
    setLandsatProcessing,
    landsatHistory,
    setLandsatHistory,
    landsatJobId,
    setLandsatJobId,
    landsatProgress,
    setLandsatProgress,
    landsatError,
    setLandsatError,
    landsatWmsDownloadingId,
    setLandsatWmsDownloadingId,
    landsatFileInputRef,
    landsatEventsAbortRef,
    resetLandsatDraft,
    applyLandsatJobPatch,
    connectLandsatEvents,
    selectLandsatHistoryEntry,
    hydrateFromDocs,
    sortLandsatScenes,
    landsatVisibleScenes,
    landsatSelectedScene,
    activeLandsatHistory,
    landsatSearchStats,
    applyLandsatZipFile,
    searchLandsatScenes,
    startLandsatProcessing,
    deleteLandsatJob,
    downloadLandsatWmsZip,
    downloadZip,
  };
}
