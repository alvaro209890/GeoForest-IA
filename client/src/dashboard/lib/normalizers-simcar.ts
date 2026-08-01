/**
 * Normalizadores SIMCAR (clip summary / report patch / stage inference) do Dashboard.
 * Plano 03 — extraídos de Dashboard.tsx (puros, sem hooks).
 */
import type { SimcarClipHistoryItem, SimcarClipSummary, SimcarLayerSummary } from '@/dashboard/types/history';

export const normalizeSimcarClipSummary = (raw: any): SimcarClipSummary | null => {
  if (!raw || typeof raw !== 'object') return null;
  const toNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const layers = Array.isArray(raw?.layers)
    ? raw.layers
      .map((layer: any) => ({
        name: String(layer?.name || '').trim(),
        source: layer?.source === 'property' ? 'property' : 'wfs',
        features: toNumber(layer?.features),
        areaHa: layer?.areaHa === undefined || layer?.areaHa === null ? undefined : toNumber(layer.areaHa),
        warning: layer?.warning ? String(layer.warning) : undefined,
        partial: layer?.partial === true,
      }))
      .filter((layer: SimcarLayerSummary) => Boolean(layer.name))
    : [];
  return {
    propertyAreaHa: toNumber(raw?.propertyAreaHa),
    crs: String(raw?.crs || 'EPSG:4674'),
    layersProcessed: toNumber(raw?.layersProcessed ?? layers.length),
    layersWithData: toNumber(raw?.layersWithData ?? layers.filter((layer: SimcarLayerSummary) => layer.features > 0).length),
    totalFeaturesClipped: toNumber(raw?.totalFeaturesClipped),
    processingTimeMs: toNumber(raw?.processingTimeMs),
    layers,
    warnings: Array.isArray(raw?.warnings)
      ? raw.warnings.map((item: any) => String(item || '').trim()).filter(Boolean)
      : undefined,
  };
};

export const normalizeSimcarReportPatch = (raw: any): Partial<SimcarClipHistoryItem> => {
  if (!raw || typeof raw !== 'object') return {};
  const status = String(raw?.reportPdfStatus || '').trim();
  const patch: Partial<SimcarClipHistoryItem> = {};
  const reportPdfUrl = String(raw?.reportPdfUrl || raw?.files?.reportPdfUrl || '').trim();
  const reportPdfDownloadUrl = String(raw?.reportPdfDownloadUrl || raw?.files?.reportPdfDownloadUrl || reportPdfUrl).trim();
  if (reportPdfUrl) patch.reportPdfUrl = reportPdfUrl;
  if (reportPdfDownloadUrl) patch.reportPdfDownloadUrl = reportPdfDownloadUrl;
  if (raw?.reportPdfFilename) patch.reportPdfFilename = String(raw.reportPdfFilename);
  if (raw?.reportPdfGeneratedAt) patch.reportPdfGeneratedAt = String(raw.reportPdfGeneratedAt);
  if (raw?.reportPdfVersion) patch.reportPdfVersion = String(raw.reportPdfVersion);
  if (status === 'generating' || status === 'ready' || status === 'failed') {
    patch.reportPdfStatus = status;
  }
  if (raw?.reportPdfError) patch.reportPdfError = String(raw.reportPdfError);
  return patch;
};

export const inferSimcarStageFromEndpoint = (
  endpoint: string,
  sourceMode?: SimcarClipHistoryItem['sourceMode'],
): { stage?: SimcarClipHistoryItem['processingStage']; message?: string } => {
  const normalizedEndpoint = String(endpoint || '').trim().toLowerCase();
  const isVectorized = sourceMode === 'vectorized-analysis';
  if (normalizedEndpoint === '/api/simcar/clip') {
    return {
      stage: 'importing',
      message: 'Recorte base em processamento no servidor...',
    };
  }
  if (normalizedEndpoint === '/api/simcar/clip/analyze') {
    return {
      stage: isVectorized ? 'acavn' : undefined,
      message: 'Análise AC/AVN em processamento no servidor...',
    };
  }
  if (normalizedEndpoint === '/api/simcar/clip/analyze-auas') {
    return {
      stage: isVectorized ? 'auas' : undefined,
      message: 'Análise AUAS em processamento no servidor...',
    };
  }
  if (normalizedEndpoint === '/api/simcar/clip/analyze/chat') {
    return {
      stage: undefined,
      message: 'Chat de análise em processamento...',
    };
  }
  return {};
};
