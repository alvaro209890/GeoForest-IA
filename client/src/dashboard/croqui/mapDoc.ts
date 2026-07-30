import { resolveBackendUrl } from '@/lib/api';
import type { CroquiHistoryItem, CroquiJobStatus } from './types';

const toIsoDateFromUnknown = (value: unknown) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

export function mapCroquiDocToHistoryItem(docId: string, data: Record<string, unknown>): CroquiHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: CroquiJobStatus =
    rawStatus === 'completed' ||
    rawStatus === 'failed' ||
    rawStatus === 'cancelled' ||
    rawStatus === 'uploaded' ||
    rawStatus === 'deleted'
      ? rawStatus
      : 'processing';
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || data?.title || 'CROQUI'),
    title: data?.title ? String(data.title) : undefined,
    propertyName: data?.propertyName ? String(data.propertyName) : undefined,
    municipioNome: data?.municipioNome ? String(data.municipioNome) : undefined,
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    files: Array.isArray(data?.files) ? data.files.map((f) => String(f)) : undefined,
    routeLabel: data?.routeLabel ? String(data.routeLabel) : undefined,
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
  };
}
