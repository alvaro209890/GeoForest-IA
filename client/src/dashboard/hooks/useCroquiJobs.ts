import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readApiError } from '@/lib/api';
import { croquiDownloadUrl, croquiZipFilename } from '../croqui/filenames';
import { mapCroquiDocToHistoryItem } from '../croqui/mapDoc';
import type { CroquiHistoryItem } from '../croqui/types';

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
  const [croquiFile, setCroquiFile] = useState<File | null>(null);
  const [croquiUploading, setCroquiUploading] = useState(false);

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
    setCroquiFile(null);
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
      if (!response.ok) throw new Error(await readApiError(response));
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

  const startCroquiProcessing = useCallback(async () => {
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
    setCroquiProcessing(true);
    setCroquiError(null);
    setCroquiProgress(1);
    setCroquiMessage('Gerando croqui...');
    try {
      const response = await apiFetch('/api/croqui/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, title, propertyName }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
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
    croquiTitle,
    croquiUploadId,
    uploadCroquiZip,
  ]);

  const downloadCroquiZip = useCallback(
    (item?: CroquiHistoryItem | null) => {
      const url = croquiDownloadUrl(item || { jobId: croquiJobId || '', downloadUrl: croquiDownload || undefined } as CroquiHistoryItem);
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
    croquiFile,
    croquiUploading,
    fileInputRef,
    resetCroquiDraft,
    applyZipFile,
    uploadCroquiZip,
    startCroquiProcessing,
    downloadCroquiZip,
    selectCroquiHistoryEntry,
    hydrateFromDocs,
    deleteCroquiJob,
  };
}
