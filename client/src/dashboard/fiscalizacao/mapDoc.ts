import { resolveBackendUrl } from '@/lib/api';
import type {
  FiscalizacaoHistoryItem,
  FiscalizacaoJobStatus,
  FiscalizacaoResumoItem,
  FiscalizacaoSource,
} from './types';
import { toIsoDateFromUnknown } from '@/dashboard/lib/values';

const SOURCES: FiscalizacaoSource[] = ['ibama', 'sema', 'siga'];

function parseResumo(raw: unknown): FiscalizacaoResumoItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((entry: any) => {
      const source = String(entry?.source || '') as FiscalizacaoSource;
      if (!SOURCES.includes(source)) return null;
      return {
        source,
        label: String(entry?.label || source.toUpperCase()),
        total: Number(entry?.total || 0),
        incidentes: Number(entry?.incidentes || 0),
        error: entry?.error ? String(entry.error) : undefined,
      } satisfies FiscalizacaoResumoItem;
    })
    .filter(Boolean) as FiscalizacaoResumoItem[];
  return items.length ? items : undefined;
}

export function mapFiscalizacaoDocToHistoryItem(docId: string, data: any): FiscalizacaoHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: FiscalizacaoJobStatus =
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
    filename: String(data?.filename || 'ATP'),
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    files: Array.isArray(data?.files) ? data.files.map((f: unknown) => String(f)) : undefined,
    atpNome: data?.atpNome ? String(data.atpNome) : undefined,
    atpAreaHa: Number.isFinite(Number(data?.atpAreaHa)) ? Number(data.atpAreaHa) : undefined,
    totalIncidentes: Number.isFinite(Number(data?.totalIncidentes))
      ? Number(data.totalIncidentes)
      : undefined,
    resumo: parseResumo(data?.resumo),
    downloadUrl: data?.downloadUrl ? resolveBackendUrl(String(data.downloadUrl)) : undefined,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.map((w: unknown) => String(w)) : undefined,
  };
}
