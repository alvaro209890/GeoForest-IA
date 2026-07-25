import type { LandsatHistoryItem, LandsatScene } from './types';

export const landsatArchiveZipFilename = (item?: LandsatHistoryItem | LandsatScene | null) => {
  const anyItem = item as any;
  const scene = anyItem?.source ? anyItem as LandsatScene : anyItem?.scene as LandsatScene | undefined;
  const explicit = anyItem?.outputFilename || scene?.outputFilename || anyItem?.wmsStoreName || scene?.wmsStoreName || anyItem?.wmsLayerName || scene?.wmsLayerName || scene?.id || anyItem?.sceneId || anyItem?.jobId;
  const stem = String(explicit || 'LANDSAT')
    .replace(/^.*:/, '')
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_') || 'LANDSAT';
  return `${stem}.zip`;
};

export const landsatArchiveZipUrl = (item?: LandsatHistoryItem | LandsatScene | null) => {
  if (!item) return '';
  const anyItem = item as any;
  const scene = anyItem?.source ? anyItem as LandsatScene : anyItem?.scene as LandsatScene | undefined;
  const direct = anyItem?.wmsDownloadUrl || scene?.wmsDownloadUrl;
  if (direct) return String(direct);
  const layerName = anyItem?.wmsLayerName || scene?.wmsLayerName || scene?.wmsStoreName || anyItem?.wmsStoreName;
  if (!layerName) return '';
  return `/api/landsat/wms-download?layerName=${encodeURIComponent(String(layerName))}`;
};
