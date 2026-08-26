import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { readApiError } from '@/lib/api';
import { fiscalizacaoDownloadUrl, fiscalizacaoZipFilename } from '../fiscalizacao/filenames';
import { mapFiscalizacaoDocToHistoryItem } from '../fiscalizacao/mapDoc';
import type { FiscalizacaoHistoryItem, FiscalizacaoResumoItem } from '../fiscalizacao/types';

export type UseFiscalizacaoJobsDeps = {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  downloadZip: (url?: string | null, filename?: string) => void | Promise<void>;
  fileToBase64Payload: (file: File) => Promise<string>;
};

export type UseFiscalizacaoJobsReturn = ReturnType<typeof useFiscalizacaoJobs>;

export function useFiscalizacaoJobs({
  apiFetch,
  downloadZip,
  fileToBase64Payload,
}: UseFiscalizacaoJobsDeps) {
  const [fiscHistory, setFiscHistory] = useState<FiscalizacaoHistoryItem[]>([]);
  const [fiscJobId, setFiscJobId] = useState<string | null>(null);
  const [fiscUploadId, setFiscUploadId] = useState<string | null>(null);
  const [fiscProcessing, setFiscProcessing] = useState(false);
  const [fiscProgress, setFiscProgress] = useState(0);
  const [fiscStage, setFiscStage] = useState('');
  const [fiscMessage, setFiscMessage] = useState('');
  const [fiscError, setFiscError] = useState<string | null>(null);
  const [fiscDownload, setFiscDownload] = useState<string | null>(null);
  const [fiscFiles, setFiscFiles] = useState<string[]>([]);
  const [fiscWarnings, setFiscWarnings] = useState<string[]>([]);
  const [fiscFilename, setFiscFilename] = useState('');
  const [fiscPolygonCount, setFiscPolygonCount] = useState(0);
  const [fiscAreaHa, setFiscAreaHa] = useState(0);
  const [fiscResumo, setFiscResumo] = useState<FiscalizacaoResumoItem[]>([]);
  const [fiscTotalIncidentes, setFiscTotalIncidentes] = useState<number | null>(null);
  const [fiscFile, setFiscFile] = useState<File | null>(null);
  const [fiscUploading, setFiscUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const resetFiscDraft = useCallback(() => {
    eventsAbortRef.current?.abort();
    eventsAbortRef.current = null;
    setFiscJobId(null);
    setFiscUploadId(null);
    setFiscProcessing(false);
    setFiscProgress(0);
    setFiscStage('');
    setFiscMessage('');
    setFiscError(null);
    setFiscDownload(null);
    setFiscFiles([]);
    setFiscWarnings([]);
    setFiscFilename('');
    setFiscPolygonCount(0);
    setFiscAreaHa(0);
    setFiscResumo([]);
    setFiscTotalIncidentes(null);
    setFiscFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const applyFiscJobPatch = useCallback((job: FiscalizacaoHistoryItem) => {
    setFiscHistory((prev) => {
      const idx = prev.findIndex((item) => item.jobId === job.jobId);
      if (idx < 0) return [job, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...job };
      return next;
    });
    if (job.status === 'processing') {
      setFiscProcessing(true);
      setFiscJobId(job.jobId);
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      setFiscProcessing(false);
    }
    setFiscProgress(job.percent || 0);
    setFiscStage(job.stage || '');
    setFiscMessage(job.message || '');
    if (job.error) setFiscError(job.error);
    if (job.downloadUrl) setFiscDownload(job.downloadUrl);
    if (job.files) setFiscFiles(job.files);
    if (job.warnings) setFiscWarnings(job.warnings);
    if (job.filename) setFiscFilename(job.filename);
    if (job.resumo) setFiscResumo(job.resumo);
    if (typeof job.totalIncidentes === 'number') setFiscTotalIncidentes(job.totalIncidentes);
    if (typeof job.atpAreaHa === 'number') setFiscAreaHa(job.atpAreaHa);
  }, []);

  const connectFiscEvents = useCallback(
    async (id: string) => {
      eventsAbortRef.current?.abort();
      const controller = new AbortController();
      eventsAbortRef.current = controller;
      try {
        const response = await apiFetch(`/api/fiscalizacao/jobs/${encodeURIComponent(id)}/events`, {
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
                applyFiscJobPatch(mapFiscalizacaoDocToHistoryItem(id, evt.job));
              } else if (evt?.type === 'progress') {
                applyFiscJobPatch(mapFiscalizacaoDocToHistoryItem(id, evt));
              }
            } catch {
              // ignora SSE malformado
            }
          }
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    },
    [apiFetch, applyFiscJobPatch],
  );

  const selectFiscHistoryEntry = useCallback(
    (entry: FiscalizacaoHistoryItem) => {
      setFiscJobId(entry.jobId);
      setFiscFilename(entry.filename);
      setFiscProgress(entry.percent);
      setFiscStage(entry.stage || '');
      setFiscMessage(entry.message || '');
      setFiscError(entry.error || null);
      setFiscDownload(entry.downloadUrl || null);
      setFiscFiles(entry.files || []);
      setFiscWarnings(entry.warnings || []);
      setFiscResumo(entry.resumo || []);
      setFiscTotalIncidentes(
        typeof entry.totalIncidentes === 'number' ? entry.totalIncidentes : null,
      );
      setFiscAreaHa(entry.atpAreaHa || 0);
      setFiscProcessing(entry.status === 'processing');
      if (entry.status === 'processing') void connectFiscEvents(entry.jobId);
    },
    [connectFiscEvents],
  );

  const hydrateFromDocs = useCallback(
    (docs: Array<{ id: string; data: any }>) => {
      const items = docs
        .map((d) => mapFiscalizacaoDocToHistoryItem(d.id, d.data))
        .filter((item) => item.status !== 'uploaded' && item.status !== 'deleted');
      setFiscHistory(items);
      const running = items.find((item) => item.status === 'processing');
      if (running) selectFiscHistoryEntry(running);
    },
    [selectFiscHistoryEntry],
  );

  const applyZipFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!/\.zip$/i.test(file.name)) {
        setFiscError('Envie um arquivo .zip com o shapefile da ATP.');
        return;
      }
      setFiscError(null);
      setFiscFile(file);
      setFiscUploading(true);
      try {
        const zipBase64 = await fileToBase64Payload(file);
        const response = await apiFetch('/api/fiscalizacao/upload', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, zipBase64 }),
        });
        if (!response.ok) {
          const err = await readApiError(response);
          throw new Error(err.error || 'Falha no upload.');
        }
        const payload = await response.json();
        setFiscUploadId(String(payload.uploadId || ''));
        setFiscFilename(String(payload.filename || file.name));
        setFiscPolygonCount(Number(payload.polygonCount || 0));
        setFiscAreaHa(Number(payload.areaHa || 0));
        toast.success(
          `ATP importada: ${payload.polygonCount || 0} polígono(s), ${Number(
            payload.areaHa || 0,
          ).toFixed(2)} ha.`,
        );
      } catch (error: any) {
        setFiscFile(null);
        setFiscError(String(error?.message || error));
        toast.error(String(error?.message || error));
      } finally {
        setFiscUploading(false);
      }
    },
    [apiFetch, fileToBase64Payload],
  );

  const startFiscProcessing = useCallback(async () => {
    if (!fiscUploadId) {
      setFiscError('Importe o ZIP da ATP antes de gerar os mapas.');
      return;
    }
    setFiscError(null);
    setFiscProcessing(true);
    setFiscProgress(1);
    setFiscResumo([]);
    setFiscTotalIncidentes(null);
    setFiscMessage('Enfileirando análise...');
    try {
      const response = await apiFetch('/api/fiscalizacao/process', {
        method: 'POST',
        body: JSON.stringify({ uploadId: fiscUploadId }),
      });
      if (!response.ok) {
        const err = await readApiError(response);
        throw new Error(err.error || 'Falha ao iniciar a análise.');
      }
      const payload = await response.json();
      const jobId = String(payload.jobId || '');
      if (!jobId) throw new Error('jobId ausente na resposta.');
      applyFiscJobPatch(
        mapFiscalizacaoDocToHistoryItem(jobId, {
          jobId,
          filename: fiscFilename || 'ATP',
          status: 'processing',
          percent: 1,
          message: 'Análise iniciada.',
        }),
      );
      setFiscJobId(jobId);
      void connectFiscEvents(jobId);
    } catch (error: any) {
      setFiscProcessing(false);
      setFiscError(String(error?.message || error));
      toast.error(String(error?.message || error));
    }
  }, [apiFetch, applyFiscJobPatch, connectFiscEvents, fiscFilename, fiscUploadId]);

  const deleteFiscJob = useCallback(
    async (entry: FiscalizacaoHistoryItem) => {
      try {
        await apiFetch(`/api/fiscalizacao/jobs/${encodeURIComponent(entry.jobId)}`, {
          method: 'DELETE',
        });
      } catch {
        // ignora
      }
      setFiscHistory((prev) => prev.filter((item) => item.jobId !== entry.jobId));
      if (fiscJobId === entry.jobId) resetFiscDraft();
    },
    [apiFetch, fiscJobId, resetFiscDraft],
  );

  const downloadFiscZip = useCallback(async () => {
    const entry = fiscHistory.find((item) => item.jobId === fiscJobId) || null;
    const url = fiscDownload || fiscalizacaoDownloadUrl(entry);
    if (!url) {
      toast.error('Download indisponível.');
      return;
    }
    await downloadZip(
      url,
      fiscalizacaoZipFilename(entry || ({ filename: fiscFilename } as FiscalizacaoHistoryItem)),
    );
  }, [downloadZip, fiscDownload, fiscFilename, fiscHistory, fiscJobId]);

  useEffect(() => {
    if (!fiscProcessing || !fiscJobId) return;
    let active = true;
    const pollStatus = async () => {
      try {
        const response = await apiFetch(
          `/api/fiscalizacao/jobs/${encodeURIComponent(fiscJobId)}/status`,
        );
        if (!response.ok || !active) return;
        const payload = await response.json();
        if (payload?.job) applyFiscJobPatch(mapFiscalizacaoDocToHistoryItem(fiscJobId, payload.job));
      } catch {
        // ignora erro de polling
      }
    };
    void pollStatus();
    const interval = window.setInterval(() => void pollStatus(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiFetch, applyFiscJobPatch, fiscJobId, fiscProcessing]);

  return {
    fiscHistory,
    setFiscHistory,
    fiscJobId,
    setFiscJobId,
    fiscUploadId,
    fiscProcessing,
    fiscProgress,
    fiscStage,
    fiscMessage,
    fiscError,
    fiscDownload,
    fiscFiles,
    fiscWarnings,
    fiscFilename,
    fiscPolygonCount,
    fiscAreaHa,
    fiscResumo,
    fiscTotalIncidentes,
    fiscFile,
    fiscUploading,
    fileInputRef,
    resetFiscDraft,
    applyFiscJobPatch,
    selectFiscHistoryEntry,
    hydrateFromDocs,
    applyZipFile,
    startFiscProcessing,
    deleteFiscJob,
    downloadFiscZip,
  };
}
