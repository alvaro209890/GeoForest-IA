import type { CroquiHistoryItem } from './types';

export const croquiZipFilename = (item?: CroquiHistoryItem | null) => {
  const stem = String(item?.title || item?.propertyName || item?.filename || item?.jobId || 'croqui')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_') || 'croqui';
  return `${stem}_croqui.zip`;
};

export const croquiDownloadUrl = (item?: CroquiHistoryItem | null) => {
  if (item?.downloadUrl) return item.downloadUrl;
  if (item?.jobId) return `/api/croqui/download/${encodeURIComponent(item.jobId)}`;
  return null;
};
