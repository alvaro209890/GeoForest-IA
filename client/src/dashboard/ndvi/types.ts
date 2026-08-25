/**
 * Tipos do fluxo NDVI (Landsat Collection 2 Level-2) — molde da aba CBERS.
 *
 * O backend NDVI está sendo construído em paralelo; estes tipos espelham o
 * contrato de `/api/ndvi/*` e são normalizados no front sempre que o backend
 * devolver nomes alternativos (ex.: `scene.id` vs `scene.itemId`,
 * `scene.datetime` vs `scene.acquiredAt`).
 */
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';

/** Composições geradas por cena completa NDVI. */
export type NdviComposition = 'NDVI' | 'NDFI' | 'RGB' | 'SWIR';

export const NDVI_COMPOSITIONS: NdviComposition[] = ['NDVI', 'NDFI', 'RGB', 'SWIR'];

export const isNdviComposition = (value: unknown): value is NdviComposition =>
  NDVI_COMPOSITIONS.includes(value as NdviComposition);

export type NdviCompositionMeta = {
  key: NdviComposition;
  label: string;
  description: string;
  /** Classes do chip quando selecionado (borda + fundo + texto). */
  badgeClass: string;
  /** Pequeno gradiente de amostra da composição. */
  swatchClass: string;
};

/**
 * Metadados de UI das composições (reunião): label + descrição + cores.
 * NDVI lime · NDFI white/amber · RGB rainbow/blue · SWIR purple.
 */
export const NDVI_COMPOSITION_META: Record<NdviComposition, NdviCompositionMeta> = {
  NDVI: {
    key: 'NDVI',
    label: 'NDVI',
    description: 'Índice de vegetação (verde→amarelo→marrom).',
    badgeClass: 'border-lime-500/30 bg-lime-500/10 text-lime-200',
    swatchClass: 'from-lime-500 via-amber-400 to-amber-700',
  },
  NDFI: {
    key: 'NDFI',
    label: 'NDFI',
    description: 'Detecção de área convertida (solo exposto/desmate fica BRANCO).',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    swatchClass: 'from-white via-amber-200 to-amber-600',
  },
  RGB: {
    key: 'RGB',
    label: 'RGB',
    description: 'Cor natural.',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    swatchClass: 'from-sky-500 via-emerald-400 to-rose-400',
  },
  SWIR: {
    key: 'SWIR',
    label: 'SWIR',
    description: 'Falsa-cor 6-5-4 (banda 7 — cicatriz de exploração).',
    badgeClass: 'border-purple-500/30 bg-purple-500/10 text-purple-200',
    swatchClass: 'from-purple-700 via-fuchsia-500 to-purple-300',
  },
};

export type NdviJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * Cena Landsat Collection 2 Level-2 retornada por `POST /api/ndvi/search`.
 *
 * O backend pode entregar `itemId`/`acquiredAt`/`cloudCoverPct`/`platformLabel`;
 * o front normaliza para `id`/`datetime`/`cloudCover`/`platform` (ver mapDoc.ts).
 */
export type NdviScene = {
  id: string;
  itemId?: string;
  collectionId?: string;
  datetime: string;
  acquiredAt?: string;
  cloudCover: number | null;
  cloudCoverPct?: number;
  path: string;
  row: string;
  platform?: string;
  platformLabel?: string;
  coversArea?: boolean;
  coveragePercent?: number;
  /** Landsat 7 pós 31/05/2003 — faixas sem dado (SLC-off). */
  slcOff?: boolean;
  bbox: [number, number, number, number] | null;
  geometry?: CbersGeoJsonGeometry;
  thumbnailUrl?: string;
  assetKeys: string[];
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  archiveImageId?: string;
  archiveFilename?: string;
};

/** Estado por cena dentro de um job NDVI (SSE/status). */
export type NdviSceneJobState = {
  itemId: string;
  scene?: NdviScene | null;
  status: NdviJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  /** Uma camada WMS por composição (mesma ordem de `compositions`). */
  wmsLayerNames?: string[];
  compositions?: NdviComposition[];
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
};

/** Item de histórico do fluxo NDVI (job no acervo do usuário). */
export type NdviHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: NdviJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  itemIds?: string[];
  scenes?: NdviSceneJobState[];
  mode?: 'single' | 'batch';
  areaHa?: number;
  compositions?: NdviComposition[];
  archiveImageId?: string;
  archiveFilename?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  batchZipUrl?: string;
  batchZipRelativePath?: string;
  batchZipFilename?: string;
  batchZipBytes?: number;
};

/** Registro do acervo NDVI (`GET /api/ndvi/archive`). */
export type NdviArchiveRecord = {
  ndviId: string;
  uid: string;
  ndviJobId: string;
  clipJobId: string;
  itemId: string;
  platform: string;
  path: string;
  row: string;
  year: string;
  acquiredAt: string;
  cloudCoverPct: number | null;
  ndviFilename: string;
  ndviHdPath: string;
  ndviLayerName: string;
  rgbFilename: string;
  rgbHdPath: string;
  rgbLayerName: string;
  bytes: number;
  wmsPublicUrl: string;
  createdAt: string;
  updatedAt: string;
  userDeletedAt?: string | null;
};
