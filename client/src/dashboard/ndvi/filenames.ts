/**
 * Helpers de nome de arquivo/URL do fluxo NDVI — molde de `cbers/filenames.ts`.
 *
 * Um job NDVI gera um ZIP do acervo por cena (todas as composições) e um ZIP
 * do lote quando há mais de uma cena. Quando o backend publica camadas WMS,
 * o download usa o `wmsDownloadUrl` devolvido no job/status.
 */
import type { NdviHistoryItem, NdviScene, NdviSceneJobState } from './types';

/** Exemplo de CAR estadual (SIMCAR MT) — nunca o número federal do SICAR. */
export const CAR_ESTADUAL_EXAMPLE = 'MT274719/2025';
export const CAR_ESTADUAL_PLACEHOLDER = `Ex: ${CAR_ESTADUAL_EXAMPLE}`;

/** Stem de nome de arquivo derivado do ID da cena Landsat. */
export const ndviOutputStem = (itemId?: string | null) => {
  const stem = String(itemId || 'LANDSAT_C2L2')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.(tif|tiff)$/i, '') || 'LANDSAT_C2L2';
  return stem;
};

/** Nome do ZIP do acervo de UMA cena NDVI (todas as composições do job). */
export const ndviArchiveZipFilename = (
  item?: Pick<NdviHistoryItem, 'archiveFilename' | 'outputFilename' | 'scenes' | 'itemIds' | 'jobId'> | NdviSceneJobState | null,
) => {
  if (!item) return 'NDVI_LANDSAT.zip';
  const state = 'itemId' in item ? item as NdviSceneJobState : null;
  const history = state ? null : item as Pick<NdviHistoryItem, 'archiveFilename' | 'outputFilename' | 'scenes' | 'itemIds' | 'jobId'>;
  const explicit = history?.archiveFilename
    || history?.outputFilename
    || state?.scene?.archiveFilename
    || state?.scene?.id
    || history?.scenes?.[0]?.scene?.archiveFilename
    || history?.scenes?.[0]?.scene?.id
    || history?.itemIds?.[0]
    || history?.jobId;
  const stem = String(explicit || 'NDVI_LANDSAT')
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_') || 'NDVI_LANDSAT';
  return `${stem}.zip`;
};

/** URL do ZIP do acervo de UMA cena NDVI. */
export const ndviArchiveZipUrl = (
  item?: Pick<NdviHistoryItem, 'wmsDownloadUrl' | 'outputUrl' | 'scenes' | 'itemIds'> | NdviSceneJobState | null,
) => {
  if (!item) return '';
  const state = 'itemId' in item ? item as NdviSceneJobState : null;
  const history = state ? null : item as Pick<NdviHistoryItem, 'wmsDownloadUrl' | 'outputUrl' | 'scenes' | 'itemIds'>;
  const direct = history?.wmsDownloadUrl
    || state?.wmsDownloadUrl
    || state?.scene?.wmsDownloadUrl
    || history?.scenes?.[0]?.wmsDownloadUrl;
  if (direct) return String(direct);
  if (history?.outputUrl) return String(history.outputUrl);
  const itemId = state?.scene?.id
    || history?.scenes?.[0]?.scene?.id
    || history?.itemIds?.[0];
  if (itemId) return `/api/ndvi/jobs/${encodeURIComponent(String(itemId))}/download`;
  return '';
};

/** Nome do ZIP do lote NDVI (várias cenas). */
export const ndviBatchZipFilename = (jobId?: string | null) => {
  const suffix = String(jobId || '').trim().slice(0, 8);
  return `NDVI_LANDSAT_LOTE${suffix ? `_${suffix}` : ''}.zip`;
};

/** URL do ZIP do lote NDVI. */
export const ndviBatchZipUrl = (item?: Pick<NdviHistoryItem, 'jobId' | 'batchZipUrl'> | null) => {
  if (!item) return '';
  if (item.batchZipUrl) return String(item.batchZipUrl);
  if (item.jobId) return `/api/ndvi/jobs/${encodeURIComponent(item.jobId)}/download-batch`;
  return '';
};

/** Caminho de download do ZIP de uma cena pesquisada (reuso direto do acervo). */
export const ndviSceneZipPath = (scene?: Pick<NdviScene, 'id' | 'wmsDownloadUrl' | 'archiveImageId'> | null): string => {
  if (!scene) return '';
  if (scene.wmsDownloadUrl) return scene.wmsDownloadUrl;
  if (scene.archiveImageId) {
    return `/api/ndvi/archive-download?imageId=${encodeURIComponent(scene.archiveImageId)}`;
  }
  if (scene.id) return `/api/ndvi/archive-download?itemId=${encodeURIComponent(scene.id)}`;
  return '';
};

export const ndviSceneZipFilename = (scene?: Pick<NdviScene, 'id' | 'archiveFilename'> | null): string => {
  if (!scene) return 'NDVI_LANDSAT.zip';
  const stem = String(scene.archiveFilename || ndviOutputStem(scene.id))
    .replace(/\.(tif|tiff|zip)$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_') || 'NDVI_LANDSAT';
  return `${stem}.zip`;
};
