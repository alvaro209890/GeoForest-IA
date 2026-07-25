import type { CbersHistoryItem, CbersSceneJobState } from './types';

export const cbersOutputFilename = (itemId?: string | null) => {
  const stem = String(itemId || 'CBERS_4A_WPM')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.(tif|tiff)$/i, '')
    .replace(/_C?342(?:_PAN)?$/i, '')
    .replace(/_PAN$/i, '') || 'CBERS_4A_WPM';
  return `${stem}_C342_PAN.TIF`;
};

export const cbersDownloadFilename = (item?: Pick<CbersHistoryItem, 'outputFilename' | 'scene' | 'itemId' | 'jobId'> | CbersSceneJobState | null) => {
  if (!item) return cbersOutputFilename(null);
  const explicit = 'outputFilename' in item ? item.outputFilename : undefined;
  return explicit || cbersOutputFilename(item.scene?.id || item.itemId || ('jobId' in item ? item.jobId : null));
};

export const cbersArchiveZipFilename = (item?: Pick<CbersHistoryItem, 'outputFilename' | 'archiveFilename' | 'scene' | 'itemId' | 'jobId'> | CbersSceneJobState | null) => {
  if (!item) return 'CBERS_4A_WPM.zip';
  const explicit = ('archiveFilename' in item ? item.archiveFilename : undefined) || item.scene?.archiveFilename || cbersDownloadFilename(item);
  const stem = String(explicit || cbersOutputFilename(item.scene?.id || item.itemId || ('jobId' in item ? item.jobId : null)))
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_') || 'CBERS_4A_WPM';
  return `${stem}.zip`;
};

export const cbersArchiveZipUrl = (item?: Pick<CbersHistoryItem, 'archiveImageId' | 'scene' | 'itemId' | 'wmsDownloadUrl' | 'outputUrl' | 'alignmentStatus'> | CbersSceneJobState | null) => {
  if (!item) return '';
  if ('outputUrl' in item && item.outputUrl && item.alignmentStatus === 'failed_private') return item.outputUrl;
  if ('wmsDownloadUrl' in item && item.wmsDownloadUrl) return item.wmsDownloadUrl;
  if (item.scene?.wmsDownloadUrl) return item.scene.wmsDownloadUrl;
  if (item.scene?.alignmentStatus === 'failed_private') return '';
  const archiveImageId = ('archiveImageId' in item ? item.archiveImageId : undefined) || item.scene?.archiveImageId;
  if (archiveImageId) return `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(archiveImageId)}`;
  const itemId = item.scene?.id || item.itemId;
  if (itemId) return `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(itemId)}`;
  return '';
};

export const cbersBatchZipFilename = (jobId?: string | null) => {
  const suffix = String(jobId || '').trim().slice(0, 8);
  return `CBERS_4A_WPM_LOTE${suffix ? `_${suffix}` : ''}_C342_PAN.zip`;
};
