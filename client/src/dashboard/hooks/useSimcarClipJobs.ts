/**
 * Hook de estado do recorte SIMCAR (clip) do Dashboard.
 * Plano 03, passo 5 — extrai estado puro + history + derivados de Dashboard.tsx.
 *
 * Padrão: retorna estado + setters + valores derivados. Os callbacks pesados
 * (selectSimcarClipEntry, cancelProcessingJobsForCard, resetSimcarDraft completo)
 * permanecem no Dashboard e consomem os setters deste hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '@/lib/api';
import type {
  SimcarClipHistoryItem,
  SimcarClipSummary,
  SimcarServerRuntimeState,
} from '@/dashboard/types/history';

export type SimcarClipMode = 'auto-clip' | 'vectorized-analysis';

export type SimcarClipLayer = { name: string; category: string; selected: boolean };

export type SimcarClipProgressState = {
  current: number;
  total: number;
  layer: string;
  status: string;
};

export function useSimcarClipJobs() {
  // ─── SIMCAR Clip State ───
  const [simcarClipFile, setSimcarClipFile] = useState<File | null>(null);
  const [simcarClipMode, setSimcarClipMode] = useState<SimcarClipMode>('auto-clip');
  const [simcarClipLayers, setSimcarClipLayers] = useState<SimcarClipLayer[]>([]);
  const [simcarClipLayersLoading, setSimcarClipLayersLoading] = useState(false);
  const [simcarClipLayersError, setSimcarClipLayersError] = useState<string | null>(null);
  const [simcarClipProcessing, setSimcarClipProcessing] = useState(false);
  const [simcarClipCanceling, setSimcarClipCanceling] = useState(false);
  const [simcarVectorizedRunning, setSimcarVectorizedRunning] = useState(false);
  const [simcarVectorizedStatus, setSimcarVectorizedStatus] = useState<{
    stage: 'importing' | 'acavn' | 'auas' | 'done' | 'error';
    message: string;
  } | null>(null);
  const [simcarClipProgress, setSimcarClipProgress] = useState<SimcarClipProgressState | null>(null);
  const [simcarClipDownloadUrl, setSimcarClipDownloadUrl] = useState<string | null>(null);
  const [simcarClipSummary, setSimcarClipSummary] = useState<SimcarClipSummary | null>(null);
  const [simcarClipError, setSimcarClipError] = useState<string | null>(null);
  const simcarClipAbortRef = useRef<AbortController | null>(null);
  const simcarClipProcessJobIdRef = useRef<string | null>(null);
  const simcarClipCancelRequestedRef = useRef(false);
  const simcarClipProgressFlushTimerRef = useRef<number | null>(null);
  const simcarFileInputRef = useRef<HTMLInputElement | null>(null);
  const simcarClipProgressPendingRef = useRef<SimcarClipProgressState | null>(null);
  const [simcarAirId, setSimcarAirId] = useState('');
  const [simcarAirIdStripped, setSimcarAirIdStripped] = useState(false);
  const [simcarShowCancel, setSimcarShowCancel] = useState(false);
  const simcarCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [simcarCarNumber, setSimcarCarNumber] = useState('');
  const [simcarSigefParcelCode, setSimcarSigefParcelCode] = useState('');
  const [simcarClipJobId, setSimcarClipJobId] = useState<string | null>(null);

  // ─── SIMCAR Clip History (for sidebar cards) ───
  const [simcarClipHistory, setSimcarClipHistory] = useState<SimcarClipHistoryItem[]>([]);
  const [simcarServerRuntimeState, setSimcarServerRuntimeState] = useState<SimcarServerRuntimeState | null>(null);
  const simcarVectorizedResumeInFlightRef = useRef<string | null>(null);

  const activeSimcarClip = useMemo(
    () => (simcarClipJobId ? simcarClipHistory.find((clip) => clip.jobId === simcarClipJobId) : undefined),
    [simcarClipHistory, simcarClipJobId]
  );
  const simcarLockedMode = activeSimcarClip?.sourceMode;
  const isSimcarModeLocked = Boolean(simcarLockedMode);

  useEffect(() => {
    if (!simcarLockedMode) return;
    if (simcarClipMode !== simcarLockedMode) {
      setSimcarClipMode(simcarLockedMode);
    }
  }, [simcarClipMode, simcarLockedMode]);

  const loadSimcarClipLayers = useCallback(() => {
    setSimcarClipLayersLoading(true);
    setSimcarClipLayersError(null);
    fetch(apiUrl('/api/simcar/layers'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        if (!Array.isArray(data?.layers)) throw new Error('Resposta inválida do servidor');
        setSimcarClipLayers(data.layers.map((l: any) => ({ name: l.name, category: l.category, selected: true })));
      })
      .catch((err: any) => {
        setSimcarClipLayersError(err?.message || 'Falha ao carregar a lista de camadas do servidor.');
      })
      .finally(() => setSimcarClipLayersLoading(false));
  }, []);

  useEffect(() => {
    loadSimcarClipLayers();
  }, [loadSimcarClipLayers]);

  // ─── Derivados ───
  const selectedSimcarClipLayerNames = useMemo(
    () => simcarClipLayers.filter((layer) => layer.selected).map((layer) => layer.name),
    [simcarClipLayers]
  );
  const selectedSimcarClipLayerCount = selectedSimcarClipLayerNames.length;

  const simcarVectorizedServerZipReady = useMemo(() => {
    if (simcarClipMode !== 'vectorized-analysis') return false;
    if (simcarClipFile) return false;
    if (!activeSimcarClip || activeSimcarClip.jobId !== simcarClipJobId) return false;
    const hasPersistedZip = Boolean(
      activeSimcarClip.outputZipUrl ||
      activeSimcarClip.downloadUrl ||
      activeSimcarClip.contextUrl
    );
    return hasPersistedZip;
  }, [activeSimcarClip, simcarClipFile, simcarClipJobId, simcarClipMode]);

  const canRunVectorizedAnalysis = Boolean(simcarClipFile || simcarVectorizedServerZipReady);

  return {
    // estado
    simcarClipFile,
    simcarClipMode,
    simcarClipLayers,
    simcarClipLayersLoading,
    simcarClipLayersError,
    simcarClipProcessing,
    simcarClipCanceling,
    simcarVectorizedRunning,
    simcarVectorizedStatus,
    simcarClipProgress,
    simcarClipDownloadUrl,
    simcarClipSummary,
    simcarClipError,
    simcarAirId,
    simcarAirIdStripped,
    simcarShowCancel,
    simcarCarNumber,
    simcarSigefParcelCode,
    simcarClipJobId,
    simcarClipHistory,
    simcarServerRuntimeState,
    activeSimcarClip,
    simcarLockedMode,
    isSimcarModeLocked,
    selectedSimcarClipLayerNames,
    selectedSimcarClipLayerCount,
    simcarVectorizedServerZipReady,
    canRunVectorizedAnalysis,
    // refs
    simcarClipAbortRef,
    simcarClipProcessJobIdRef,
    simcarClipCancelRequestedRef,
    simcarClipProgressFlushTimerRef,
    simcarFileInputRef,
    simcarClipProgressPendingRef,
    simcarCancelTimerRef,
    simcarVectorizedResumeInFlightRef,
    // setters
    setSimcarClipFile,
    setSimcarClipMode,
    setSimcarClipLayers,
    setSimcarClipLayersLoading,
    setSimcarClipLayersError,
    setSimcarClipProcessing,
    setSimcarClipCanceling,
    setSimcarVectorizedRunning,
    setSimcarVectorizedStatus,
    setSimcarClipProgress,
    setSimcarClipDownloadUrl,
    setSimcarClipSummary,
    setSimcarClipError,
    setSimcarAirId,
    setSimcarAirIdStripped,
    setSimcarShowCancel,
    setSimcarCarNumber,
    setSimcarSigefParcelCode,
    setSimcarClipJobId,
    setSimcarClipHistory,
    setSimcarServerRuntimeState,
    // ações
    loadSimcarClipLayers,
  };
}
