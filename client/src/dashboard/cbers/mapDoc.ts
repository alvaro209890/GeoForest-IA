import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import type {
  CbersEstimate,
  CbersHistoryItem,
  CbersJobStatus,
  CbersScene,
  CbersSceneJobState,
} from './types';

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const toIsoDateFromUnknown = (value: any) => {
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

export function mapCbersDocToHistoryItem(docId: string, data: any): CbersHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: CbersJobStatus =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
      ? rawStatus
      : 'processing';
  const scene = isPlainObject(data?.scene)
    ? {
      id: String(data.scene.id || ''),
      collectionId: data.scene.collectionId ? String(data.scene.collectionId) : undefined,
      level: data.scene.level === 'L2' || data.scene.level === 'L4' ? data.scene.level : undefined,
      datetime: String(data.scene.datetime || ''),
      cloudCover: Number.isFinite(Number(data.scene.cloudCover)) ? Number(data.scene.cloudCover) : null,
      bbox: Array.isArray(data.scene.bbox) && data.scene.bbox.length >= 4
        ? [Number(data.scene.bbox[0]), Number(data.scene.bbox[1]), Number(data.scene.bbox[2]), Number(data.scene.bbox[3])] as [number, number, number, number]
        : null,
      geometry: data.scene.geometry as CbersGeoJsonGeometry | undefined,
      thumbnailUrl: data.scene.thumbnailUrl ? String(data.scene.thumbnailUrl) : undefined,
      assetKeys: Array.isArray(data.scene.assetKeys) ? data.scene.assetKeys.map((item: any) => String(item)) : [],
      coveragePercent: Number.isFinite(Number(data.scene.coveragePercent)) ? Number(data.scene.coveragePercent) : undefined,
      coversArea: typeof data.scene.coversArea === 'boolean' ? data.scene.coversArea : undefined,
      estimate: isPlainObject(data.scene.estimate) ? data.scene.estimate as CbersEstimate : undefined,
      wmsAvailable: Boolean(data.scene.wmsAvailable),
      wmsLayerName: data.scene.wmsLayerName ? String(data.scene.wmsLayerName) : undefined,
      wmsUrl: data.scene.wmsUrl ? String(data.scene.wmsUrl) : undefined,
      wmsDownloadUrl: data.scene.wmsDownloadUrl ? String(data.scene.wmsDownloadUrl) : undefined,
      archiveImageId: data.scene.archiveImageId ? String(data.scene.archiveImageId) : undefined,
      archiveFilename: data.scene.archiveFilename ? String(data.scene.archiveFilename) : undefined,
      fallbackFromL2: Boolean(data.scene.fallbackFromL2),
      alignmentStatus: data.scene.alignmentStatus ? String(data.scene.alignmentStatus) as CbersScene['alignmentStatus'] : undefined,
      alignmentWarning: data.scene.alignmentWarning ? String(data.scene.alignmentWarning) : undefined,
    }
    : null;
  const scenes = Array.isArray(data?.scenes)
    ? data.scenes.map((item: any) => ({
      itemId: String(item?.itemId || ''),
      collectionId: item?.collectionId ? String(item.collectionId) : undefined,
      level: item?.level === 'L2' || item?.level === 'L4' ? item.level : undefined,
      scene: isPlainObject(item?.scene) ? mapCbersDocToHistoryItem(`${docId}-${item.itemId || 'scene'}`, { scene: item.scene }).scene : null,
      status: item?.status === 'completed' || item?.status === 'failed' || item?.status === 'cancelled' ? item.status : 'processing',
      stage: item?.stage ? String(item.stage) : undefined,
      percent: Math.max(0, Math.min(100, Math.round(Number(item?.percent || 0)))),
      message: item?.message ? String(item.message) : undefined,
      error: item?.error ? String(item.error) : undefined,
      estimate: isPlainObject(item?.estimate) ? item.estimate as CbersEstimate : undefined,
      outputUrl: item?.outputUrl ? resolveBackendUrl(String(item.outputUrl)) : undefined,
      outputRelativePath: item?.outputRelativePath ? String(item.outputRelativePath) : undefined,
      outputFilename: item?.outputFilename ? String(item.outputFilename) : undefined,
      outputBytes: Number.isFinite(Number(item?.outputBytes)) ? Number(item.outputBytes) : undefined,
      archiveImageId: item?.archiveImageId ? String(item.archiveImageId) : undefined,
      archiveFilename: item?.archive?.archiveFilename ? String(item.archive.archiveFilename) : item?.archiveFilename ? String(item.archiveFilename) : undefined,
      wmsLayerName: item?.wmsLayerName ? String(item.wmsLayerName) : undefined,
      wmsUrl: item?.wmsUrl ? String(item.wmsUrl) : undefined,
      wmsDownloadUrl: item?.wmsDownloadUrl ? String(item.wmsDownloadUrl) : undefined,
      alignmentStatus: item?.alignmentStatus ? String(item.alignmentStatus) as CbersSceneJobState['alignmentStatus'] : undefined,
      alignmentWarning: item?.alignmentWarning ? String(item.alignmentWarning) : undefined,
    })).filter((item: CbersSceneJobState) => Boolean(item.itemId))
    : undefined;
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'CBERS-4A/WPM'),
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    itemId: data?.itemId ? String(data.itemId) : undefined,
    itemIds: Array.isArray(data?.itemIds) ? data.itemIds.map((item: any) => String(item)) : undefined,
    mode: data?.mode === 'batch' ? 'batch' : data?.mode === 'single' ? 'single' : undefined,
    collection: data?.collection ? String(data.collection) : undefined,
    areaHa: Number.isFinite(Number(data?.areaHa)) ? Number(data.areaHa) : undefined,
    scene,
    scenes,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : undefined,
    outputRelativePath: data?.outputRelativePath ? String(data.outputRelativePath) : undefined,
    outputFilename: data?.outputFilename ? String(data.outputFilename) : undefined,
    outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : undefined,
    archiveImageId: data?.archiveImageId ? String(data.archiveImageId) : undefined,
    archiveFilename: data?.archive?.archiveFilename ? String(data.archive.archiveFilename) : data?.archiveFilename ? String(data.archiveFilename) : undefined,
    wmsLayerName: data?.wmsLayerName ? String(data.wmsLayerName) : undefined,
    wmsUrl: data?.wmsUrl ? String(data.wmsUrl) : undefined,
    wmsDownloadUrl: data?.wmsDownloadUrl ? String(data.wmsDownloadUrl) : undefined,
    alignmentStatus: data?.alignmentStatus ? String(data.alignmentStatus) as CbersHistoryItem['alignmentStatus'] : undefined,
    alignmentWarning: data?.alignmentWarning ? String(data.alignmentWarning) : undefined,
    batchZipUrl: data?.batchZipUrl ? resolveBackendUrl(String(data.batchZipUrl)) : undefined,
    batchZipRelativePath: data?.batchZipRelativePath ? String(data.batchZipRelativePath) : undefined,
    batchZipFilename: data?.batchZipFilename ? String(data.batchZipFilename) : undefined,
    batchZipBytes: Number.isFinite(Number(data?.batchZipBytes)) ? Number(data.batchZipBytes) : undefined,
  };
}
