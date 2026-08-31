import { resolveBackendUrl } from '@/lib/api';
import type { OverlapHistoryItem, OverlapJobStatus, OverlapMode } from './types';
import { isPlainObject, toIsoDateFromUnknown } from '@/dashboard/lib/values';

export function mapOverlapDocToHistoryItem(docId: string, data: any): OverlapHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: OverlapJobStatus =
    rawStatus === 'completed' ||
    rawStatus === 'failed' ||
    rawStatus === 'cancelled' ||
    rawStatus === 'uploaded' ||
    rawStatus === 'deleted'
      ? rawStatus
      : 'processing';
  const modes = Array.isArray(data?.modes)
    ? (data.modes.map((m: unknown) => String(m)).filter(Boolean) as OverlapMode[])
    : undefined;
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'SOBREPOSICOES'),
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    modes,
    files: Array.isArray(data?.files) ? data.files.map((f: unknown) => String(f)) : undefined,
    targetCount: Number.isFinite(Number(data?.targetCount)) ? Number(data.targetCount) : undefined,
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((w: unknown) => String(w)) : undefined,
  };
}

export function isPlainOverlapObject(value: unknown): value is Record<string, any> {
  return isPlainObject(value);
}
