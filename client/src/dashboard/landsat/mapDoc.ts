import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import type {
  LandsatComposition,
  LandsatHistoryItem,
  LandsatJobStatus,
  LandsatScene,
} from './types';
import { isPlainObject, toIsoDateFromUnknown } from '@/dashboard/lib/values';

export function normalizeLandsatScene(raw: any): LandsatScene | null {
  if (!isPlainObject(raw)) return null;
  const composition: LandsatComposition = String(raw?.composition || '') === 'natural_color' ? 'natural_color' : 'false_color';
  return {
    id: String(raw?.id || raw?.wmsStoreName || raw?.wmsLayerName || ''),
    source: raw?.source === 'local_wms' ? 'local_wms' : 'usgs_stac',
    collectionId: raw?.collectionId ? String(raw.collectionId) : undefined,
    platform: raw?.platform ? String(raw.platform) : undefined,
    sensor: raw?.sensor ? String(raw.sensor) : undefined,
    path: String(raw?.path || raw?.orbit || ''),
    row: String(raw?.row || ''),
    orbit: String(raw?.orbit || [raw?.path, raw?.row].filter(Boolean).join('_')),
    year: String(raw?.year || ''),
    date: String(raw?.date || ''),
    datetime: String(raw?.datetime || ''),
    cloudCover: Number.isFinite(Number(raw?.cloudCover)) ? Number(raw.cloudCover) : null,
    composition,
    compositionLabel: String(raw?.compositionLabel || (composition === 'natural_color' ? 'Natural' : 'Falsa-cor')),
    bbox: Array.isArray(raw?.bbox) && raw.bbox.length >= 4
      ? [Number(raw.bbox[0]), Number(raw.bbox[1]), Number(raw.bbox[2]), Number(raw.bbox[3])] as [number, number, number, number]
      : null,
    geometry: raw?.geometry as CbersGeoJsonGeometry | undefined,
    thumbnailUrl: raw?.thumbnailUrl ? String(raw.thumbnailUrl) : undefined,
    coveragePercent: Number.isFinite(Number(raw?.coveragePercent)) ? Number(raw.coveragePercent) : undefined,
    coversArea: typeof raw?.coversArea === 'boolean' ? raw.coversArea : undefined,
    assetKeys: Array.isArray(raw?.assetKeys) ? raw.assetKeys.map((item: any) => String(item)) : undefined,
    downloadBytes: Number.isFinite(Number(raw?.downloadBytes)) ? Number(raw.downloadBytes) : null,
    wmsAvailable: Boolean(raw?.wmsAvailable),
    wmsLayerName: raw?.wmsLayerName ? String(raw.wmsLayerName) : undefined,
    wmsStoreName: raw?.wmsStoreName ? String(raw.wmsStoreName) : undefined,
    wmsUrl: raw?.wmsUrl ? String(raw.wmsUrl) : undefined,
    wmsDownloadUrl: raw?.wmsDownloadUrl ? String(raw.wmsDownloadUrl) : undefined,
    sourcePath: raw?.sourcePath ? String(raw.sourcePath) : undefined,
    outputFilename: raw?.outputFilename ? String(raw.outputFilename) : undefined,
  };
}

export function mapLandsatDocToHistoryItem(docId: string, data: any): LandsatHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: LandsatJobStatus =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
      ? rawStatus
      : 'processing';
  const scene = normalizeLandsatScene(data?.scene);
  const composition = String(data?.composition || scene?.composition || '') === 'natural_color' ? 'natural_color' : 'false_color';
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'LANDSAT'),
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    sceneId: data?.sceneId ? String(data.sceneId) : scene?.id,
    composition,
    scene,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    outputRelativePath: data?.outputRelativePath ? String(data.outputRelativePath) : undefined,
    outputFilename: data?.outputFilename ? String(data.outputFilename) : undefined,
    outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
    wmsLayerName: data?.wmsLayerName ? String(data.wmsLayerName) : scene?.wmsLayerName,
    wmsStoreName: data?.wmsStoreName ? String(data.wmsStoreName) : scene?.wmsStoreName,
    wmsUrl: data?.wmsUrl ? String(data.wmsUrl) : scene?.wmsUrl,
    wmsDownloadUrl: data?.wmsDownloadUrl ? String(data.wmsDownloadUrl) : scene?.wmsDownloadUrl,
  };
}
