import type { FiscalizacaoHistoryItem } from './types';

export const fiscalizacaoZipFilename = (item?: FiscalizacaoHistoryItem | null) => {
  const stem =
    String(item?.atpNome || item?.filename || item?.jobId || 'fiscalizacao')
      .replace(/\.(zip|xlsx|pdf)$/i, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_') || 'fiscalizacao';
  return `Fiscalizacao_${stem}.zip`;
};

export const fiscalizacaoDownloadUrl = (item?: FiscalizacaoHistoryItem | null) => {
  if (!item) return '';
  if (item.downloadUrl) return String(item.downloadUrl);
  if (item.jobId) return `/api/fiscalizacao/download/${encodeURIComponent(item.jobId)}`;
  return '';
};
