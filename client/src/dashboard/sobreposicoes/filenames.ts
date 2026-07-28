import type { OverlapHistoryItem } from './types';

export const overlapZipFilename = (item?: OverlapHistoryItem | null) => {
  const stem = String(item?.filename || item?.jobId || 'sobreposicoes')
    .replace(/\.(zip|xlsx)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_') || 'sobreposicoes';
  return `${stem}.zip`;
};

export const overlapDownloadUrl = (item?: OverlapHistoryItem | null) => {
  if (!item) return '';
  if (item.downloadUrl) return String(item.downloadUrl);
  if (item.jobId) return `/api/overlap/download/${encodeURIComponent(item.jobId)}`;
  return '';
};
