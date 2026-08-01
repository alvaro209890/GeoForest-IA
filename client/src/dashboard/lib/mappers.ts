/**
 * Mappers doc → history item do Dashboard GeoForest.
 * Plano 03, passo 4 — extraídos de Dashboard.tsx (puros, sem hooks).
 */
import { resolveBackendUrl } from '@/lib/api';
import type {
  ContainmentHistoryItem,
  GeometryHistoryItem,
  VerticesHistoryItem,
  VerticesResultRow,
} from '@/dashboard/types/history';
import type { ContainmentRow, ContainmentSummary } from '@/components/ContainmentAnalysis';
import type { GeometryErrorRow } from '@/components/GeometryErrorsAnalysis';

export const toIsoDateFromUnknown = (value: any) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

export const mapVerticesDocToHistoryItem = (docId: string, data: any): VerticesHistoryItem => {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: VerticesHistoryItem['status'] =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
      ? rawStatus
      : 'processing';
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'Vértices Próximas'),
    timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
    resultRows: Array.isArray(data?.resultRows) ? data.resultRows as VerticesResultRow[] : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
    analyzedLayers: Array.isArray(data?.analyzedLayers) ? data.analyzedLayers.map((item: any) => ({
      name: String(item?.name || 'Camada'),
      requested: Number(item?.requested || 0),
      found: Number(item?.found || 0),
      crsLabel: item?.crsLabel ? String(item.crsLabel) : undefined,
      metricCrsLabel: item?.metricCrsLabel ? String(item.metricCrsLabel) : undefined,
    })) : undefined,
    conversationId: data?.conversationId ? String(data.conversationId) : undefined,
  };
};

export const mapContainmentDocToHistoryItem = (docId: string, data: any): ContainmentHistoryItem => {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: ContainmentHistoryItem['status'] =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
      ? rawStatus
      : 'processing';
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'Áreas Não Contidas'),
    timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
    resultRows: Array.isArray(data?.resultRows) ? data.resultRows as ContainmentRow[] : undefined,
    summary: data?.summary && typeof data.summary === 'object' ? data.summary as ContainmentSummary : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
    targetLayerName: data?.targetLayerName ? String(data.targetLayerName) : undefined,
    containerCount: Number.isFinite(Number(data?.containerCount)) ? Number(data.containerCount) : undefined,
  };
};

export const mapGeometryDocToHistoryItem = (docId: string, data: any): GeometryHistoryItem => {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: GeometryHistoryItem['status'] =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled' || rawStatus === 'uploaded' || rawStatus === 'deleted'
      ? rawStatus
      : 'processing';
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'Erros de Geometria'),
    timestamp: toIsoDateFromUnknown(data?.completedAt || data?.updatedAt || data?.createdAt || data?.timestamp),
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || (status === 'completed' ? 100 : 0))))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    resultRows: Array.isArray(data?.resultRows) ? data.resultRows as GeometryErrorRow[] : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((item: any) => String(item)) : undefined,
    summary: status === 'completed' ? {
      totalErrors: Number(data?.totalErrors || 0),
      featuresWithErrors: Number(data?.featuresWithErrors || 0),
      analyzedLayers: Array.isArray(data?.analyzedLayers) ? data.analyzedLayers : [],
      fixedLayers: Array.isArray(data?.fixedLayers) ? data.fixedLayers : [],
    } : undefined,
  };
};
