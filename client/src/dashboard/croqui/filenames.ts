import type { CroquiHistoryItem } from './types';

// Aceitam item parcial: só leem título/propriedade/arquivo/jobId.
export const croquiZipFilename = (item?: Partial<CroquiHistoryItem> | null) => {
  const stem = String(item?.title || item?.propertyName || item?.filename || item?.jobId || 'croqui')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_') || 'croqui';
  return `${stem}_croqui.zip`;
};

export const croquiDownloadUrl = (item?: Partial<CroquiHistoryItem> | null) => {
  if (item?.downloadUrl) return item.downloadUrl;
  if (item?.jobId) return `/api/croqui/download/${encodeURIComponent(item.jobId)}`;
  return null;
};
