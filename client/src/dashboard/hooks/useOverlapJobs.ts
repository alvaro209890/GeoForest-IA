import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readApiError } from '@/lib/api';
import { overlapDownloadUrl, overlapZipFilename } from '../sobreposicoes/filenames';
import { mapOverlapDocToHistoryItem } from '../sobreposicoes/mapDoc';
import type { OverlapHistoryItem, OverlapMode, OverlapModeOption } from '../sobreposicoes/types';

export type UseOverlapJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseOverlapJobsReturn = ReturnType<typeof useOverlapJobs>;

const ALL_MODES: OverlapModeOption[] = [
  { id: 'sigef-car-estadual', label: 'SIGEF × CAR estadual' },
  { id: 'sigef-car-federal', label: 'SIGEF × CAR federal' },
  { id: 'car-estadual-car-estadual', label: 'CAR estadual × CAR estadual' },
];

export function useOverlapJobs({ apiFetch, downloadZip, fileToBase64Payload }: UseOverlapJobsDeps) {
  const [overlapHistory, setOverlapHistory] = useState<OverlapHistoryItem[]>([]);
  const [overlapJobId, setOverlapJobId] = useState<string | null>(null);
  const [overlapUploadId, setOverlapUploadId] = useState<string | null>(null);
  const [overlapProcessing, setOverlapProcessing] = useState(false);
  const [overlapProgress, setOverlapProgress] = useState(0);
  const [overlapStage, setOverlapStage] = useState('');
  const [overlapMessage, setOverlapMessage] = useState('');
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [overlapDownload, setOverlapDownload] = useState<string | null>(null);
  const [overlapFiles, setOverlapFiles] = useState<string[]>([]);
  const [overlapWarnings, setOverlapWarnings] = useState<string[]>([]);
  const [overlapFilename, setOverlapFilename] = useState('');
  const [overlapPolygonCount, setOverlapPolygonCount] = useState(0);
  const [overlapModes, setOverlapModes] = useState<OverlapMode[]>([
    'sigef-car-estadual',
    'sigef-car-federal',
    'car-estadual-car-estadual',
  ]);
  const [overlapModeOptions, setOverlapModeOptions] = useState<OverlapModeOption[]>(ALL_MODES);
  const [overlapParcelCodesText, setOverlapParcelCodesText] = useState('');
  const [overlapFile, setOverlapFile] = useState<File | null>(null);
  const [overlapUploading, setOverlapUploading] = useState(false);
  const [federalAvailable, setFederalAvailable] = useState<boolean | null>(null);
  const [federalHealthError, setFederalHealthError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const resetOverlapDraft = useCallback(() => {
    eventsAbortRef.current?.abort();
    eventsAbortRef.current = null;
    setOverlapJobId(null);
    setOverlapUploadId(null);
    setOverlapProcessing(false);
    setOverlapProgress(0);
    setOverlapStage('');
    setOverlapMessage('');
    setOverlapError(null);
    setOverlapDownload(null);
    setOverlapFiles([]);
    setOverlapWarnings([]);
    setOverlapFilename('');
    setOverlapPolygonCount(0);
    setOverlapFile(null);
    setOverlapParcelCodesText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const applyOverlapJobPatch = useCallback((job: OverlapHistoryItem) => {
    setOverlapHistory((prev) => {
      const idx = prev.findIndex((item) => item.jobId === job.jobId);
      if (idx < 0) return [job, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...job };
      return next;
    });
    if (job.status === 'processing') {
      setOverlapProcessing(true);
      setOverlapJobId(job.jobId);
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      setOverlapProcessing(false);
    }
    setOverlapProgress(job.percent || 0);
    setOverlapStage(job.stage || '');
    setOverlapMessage(job.message || '');
    if (job.error) setOverlapError(job.error);
    if (job.downloadUrl) setOverlapDownload(job.downloadUrl);
    if (job.files) setOverlapFiles(job.files);
    if (job.warnings) setOverlapWarnings(job.warnings);
    if (job.filename) setOverlapFilename(job.filename);
  }, []);

  const connectOverlapEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/overlap/jobs/${encodeURIComponent(id)}/events`, {
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
                applyOverlapJobPatch(mapOverlapDocToHistoryItem(id, evt.job));
              } else if (evt?.type === 'progress') {
                applyOverlapJobPatch(mapOverlapDocToHistoryItem(id, evt));
              }
            } catch {
              // ignore malformed SSE
            }
          }
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    },
    [apiFetch, applyOverlapJobPatch],
  );

  const selectOverlapHistoryEntry = useCallback(
    (entry: OverlapHistoryItem) => {
      setOverlapJobId(entry.jobId);
      setOverlapFilename(entry.filename);
      setOverlapProgress(entry.percent);
      setOverlapStage(entry.stage || '');
      setOverlapMessage(entry.message || '');
      setOverlapError(entry.error || null);
      setOverlapDownload(entry.downloadUrl || null);
      setOverlapFiles(entry.files || []);
      setOverlapWarnings(entry.warnings || []);
      setOverlapProcessing(entry.status === 'processing');
      if (entry.status === 'processing') void connectOverlapEvents(entry.jobId);
    },
    [connectOverlapEvents],
  );

  const hydrateFromDocs = useCallback(
    (docs: Array<{ id: string; data: any }>) => {
      const items = docs
        .map((d) => mapOverlapDocToHistoryItem(d.id, d.data))
        .filter((item) => item.status !== 'uploaded' && item.status !== 'deleted');
      setOverlapHistory(items);
      const running = items.find((item) => item.status === 'processing');
      if (running) {
        selectOverlapHistoryEntry(running);
      }
    },
    [selectOverlapHistoryEntry],
  );

  const probeFederalHealth = useCallback(async () => {
    try {
      const response = await apiFetch('/api/overlap/sources/health', { method: 'GET' });
      if (!response.ok) {
        setFederalAvailable(false);
        setFederalHealthError('Não foi possível checar a fonte federal.');
        return;
      }
      const payload = await response.json();
      const ok = Boolean(payload?.carFederal?.ok);
      setFederalAvailable(ok);
      setFederalHealthError(ok ? '' : String(payload?.carFederal?.error || 'WFS federal indisponível'));
    } catch (error: any) {
      setFederalAvailable(false);
      setFederalHealthError(String(error?.message || error));
    }
  }, [apiFetch]);

  useEffect(() => {
    void probeFederalHealth();
  }, [probeFederalHealth]);

  const applyZipFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!/\.zip$/i.test(file.name)) {
        setOverlapError('Envie um arquivo .zip com shapefile SIGEF.');
        return;
      }
      setOverlapError(null);
      setOverlapFile(file);
      setOverlapParcelCodesText('');
      setOverlapUploading(true);
      try {
        const zipBase64 = await fileToBase64Payload(file);
        const response = await apiFetch('/api/overlap/upload', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, zipBase64 }),
        });
        if (!response.ok) {
          const err = await readApiError(response);
          throw new Error(err.error || 'Falha no upload.');
        }
        const payload = await response.json();
        setOverlapUploadId(String(payload.uploadId || ''));
        setOverlapFilename(String(payload.filename || file.name));
        setOverlapPolygonCount(Number(payload.polygonCount || 0));
        if (Array.isArray(payload.modes)) setOverlapModeOptions(payload.modes);
        toast.success(`ZIP importado: ${payload.polygonCount || 0} polígono(s).`);
      } catch (error: any) {
        setOverlapError(String(error?.message || error));
        toast.error(String(error?.message || error));
      } finally {
        setOverlapUploading(false);
      }
    },
    [apiFetch, fileToBase64Payload],
  );

  const uploadParcelCodes = useCallback(async () => {
    const codes = overlapParcelCodesText
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!codes.length) {
      setOverlapError('Informe ao menos um código de parcela SIGEF.');
      return;
    }
    setOverlapError(null);
    setOverlapFile(null);
    setOverlapUploading(true);
    try {
      const response = await apiFetch('/api/overlap/upload', {
        method: 'POST',
        body: JSON.stringify({ parcelCodes: codes }),
      });
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err.error || 'Falha ao registrar códigos.');
      }
      const payload = await response.json();
      setOverlapUploadId(String(payload.uploadId || ''));
      setOverlapFilename(String(payload.filename || `${codes.length}_codigos`));
      setOverlapPolygonCount(Number(payload.polygonCount || codes.length));
      if (Array.isArray(payload.modes)) setOverlapModeOptions(payload.modes);
      toast.success(`${codes.length} código(s) SIGEF registrados.`);
    } catch (error: any) {
      setOverlapError(String(error?.message || error));
      toast.error(String(error?.message || error));
    } finally {
      setOverlapUploading(false);
    }
  }, [apiFetch, overlapParcelCodesText]);

  const toggleMode = useCallback((mode: OverlapMode) => {
    setOverlapModes((prev) => {
      if (prev.includes(mode)) return prev.filter((m) => m !== mode);
      return [...prev, mode];
    });
  }, []);

  const startOverlapProcessing = useCallback(async () => {
    if (!overlapUploadId) {
      setOverlapError('Faça o upload do ZIP ou informe códigos SIGEF antes de processar.');
      return;
    }
    const modes = overlapModes.filter((m) => m !== 'sigef-car-federal' || federalAvailable !== false);
    if (!modes.length) {
      setOverlapError('Selecione ao menos um modo disponível.');
      return;
    }
    setOverlapError(null);
    setOverlapProcessing(true);
    setOverlapProgress(1);
    setOverlapMessage('Enfileirando análise...');
    try {
      const response = await apiFetch('/api/overlap/process', {
        method: 'POST',
        body: JSON.stringify({ uploadId: overlapUploadId, modes }),
      });
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err.error || 'Falha ao iniciar análise.');
      }
      const payload = await response.json();
      const jobId = String(payload.jobId || '');
      if (!jobId) throw new Error('jobId ausente na resposta.');
      const optimistic = mapOverlapDocToHistoryItem(jobId, {
        jobId,
        filename: overlapFilename || 'sobreposicoes',
        status: 'processing',
        percent: 1,
        modes,
        message: 'Análise iniciada.',
      });
      applyOverlapJobPatch(optimistic);
      setOverlapJobId(jobId);
      void connectOverlapEvents(jobId);
    } catch (error: any) {
      setOverlapProcessing(false);
      setOverlapError(String(error?.message || error));
      toast.error(String(error?.message || error));
    }
  }, [
    apiFetch,
    applyOverlapJobPatch,
    connectOverlapEvents,
    federalAvailable,
    overlapFilename,
    overlapModes,
    overlapUploadId,
  ]);

  const deleteOverlapJob = useCallback(
    async (entry: OverlapHistoryItem) => {
      try {
        await apiFetch(`/api/overlap/jobs/${encodeURIComponent(entry.jobId)}`, { method: 'DELETE' });
      } catch {
        // ignore
      }
      setOverlapHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
      if (overlapJobId === entry.jobId) resetOverlapDraft();
    },
    [apiFetch, overlapJobId, resetOverlapDraft],
  );

  const downloadOverlapZip = useCallback(async () => {
    const entry = overlapHistory.find((item) => item.jobId === overlapJobId) || null;
    const url = overlapDownload || overlapDownloadUrl(entry);
    if (!url) {
      toast.error('Download indisponível.');
      return;
    }
    await downloadZip(url, overlapZipFilename(entry || { filename: overlapFilename } as OverlapHistoryItem));
  }, [downloadZip, overlapDownload, overlapFilename, overlapHistory, overlapJobId]);

  useEffect(() => {
    if (!overlapProcessing || !overlapJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(`/api/overlap/jobs/${encodeURIComponent(overlapJobId)}/status`);
        if (!response.ok || !active) return;
        const payload = await response.json();
        if (payload?.job) applyOverlapJobPatch(mapOverlapDocToHistoryItem(overlapJobId, payload.job));
      } catch {
        // ignore poll errors
      }
    };
    void pollStatus();
    const interval = window.setInterval(() => void pollStatus(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, applyOverlapJobPatch, overlapJobId, overlapProcessing]);

  return {
    overlapHistory,
    setOverlapHistory,
    overlapJobId,
    setOverlapJobId,
    overlapUploadId,
    overlapProcessing,
    setOverlapProcessing,
    overlapProgress,
    overlapStage,
    overlapMessage,
    overlapError,
    overlapDownload,
    overlapFiles,
    overlapWarnings,
    overlapFilename,
    overlapPolygonCount,
    overlapModes,
    overlapModeOptions,
    overlapParcelCodesText,
    setOverlapParcelCodesText,
    overlapFile,
    overlapUploading,
    federalAvailable,
    federalHealthError,
    fileInputRef,
    resetOverlapDraft,
    applyOverlapJobPatch,
    selectOverlapHistoryEntry,
    hydrateFromDocs,
    applyZipFile,
    uploadParcelCodes,
    toggleMode,
    startOverlapProcessing,
    deleteOverlapJob,
    downloadOverlapZip,
    probeFederalHealth,
  };
}
