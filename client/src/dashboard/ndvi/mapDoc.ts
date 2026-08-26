/**
 * Normalização de documentos de job NDVI → `NdviHistoryItem`.
 *
 * O doc pode vir de três origens com formatos diferentes:
 *  - SSE (`evt.job`) e `GET /status` (`payload.job`) — doc do job com `scenes[]`,
 *    `compositions[]` e campos de arquivo;
 *  - SSE `progress` — patch raso (`stage`/`percent`/`message`/`status`);
 *  - Firestore (acervo do usuário) — doc persistido.
 *
 * Independente da origem, os nomes alternativos do contrato são normalizados
 * aqui: `scene.itemId` → `scene.id`, `scene.acquiredAt` → `scene.datetime`,
 * `scene.cloudCoverPct` → `scene.cloudCover`, `scene.platformLabel` → `scene.platform`.
 */
import { resolveBackendUrl } from '@/lib/api';
import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';
import {
  isNdviComposition,
  type NdviComposition,
  type NdviHistoryItem,
  type NdviJobStatus,
  type NdviScene,
  type NdviSceneJobState,
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

/** Normaliza os nomes alternativos de uma cena Landsat do contrato da API. */
export function normalizeNdviScene(raw: any): NdviScene | null {
  if (!isPlainObject(raw)) return null;
  const id = String(raw?.id || raw?.itemId || raw?.wmsLayerName || '');
  if (!id) return null;
  const cloudCover = Number.isFinite(Number(raw?.cloudCover))
    ? Number(raw.cloudCover)
    : Number.isFinite(Number(raw?.cloudCoverPct))
      ? Number(raw.cloudCoverPct)
      : null;
  const datetime = String(raw?.datetime || raw?.acquiredAt || '');
  const platform = String(raw?.platform || raw?.platformLabel || '');

  // `/api/ndvi/search` devolve o contrato em português (`sensorDegradado` e
  // `coberturaParcial`, este último invertido); outras respostas já usam os
  // nomes em inglês. Aceitar os dois evita o bug silencioso em que o selo
  // "SLC-off" existia na UI e nunca aparecia, deixando o usuário escolher uma
  // cena Landsat 7 pós-2003 sem aviso das faixas sem dado.
  const slcOff =
    typeof raw?.slcOff === 'boolean'
      ? raw.slcOff
      : typeof raw?.sensorDegradado === 'boolean'
        ? raw.sensorDegradado
        : undefined;
  const coversArea =
    typeof raw?.coversArea === 'boolean'
      ? raw.coversArea
      : typeof raw?.coberturaParcial === 'boolean'
        ? !raw.coberturaParcial
        : undefined;

  return {
    id,
    itemId: raw?.itemId ? String(raw.itemId) : id,
    collectionId: raw?.collectionId ? String(raw.collectionId) : undefined,
    datetime,
    acquiredAt: raw?.acquiredAt ? String(raw.acquiredAt) : datetime || undefined,
    cloudCover,
    cloudCoverPct: Number.isFinite(Number(raw?.cloudCoverPct)) ? Number(raw.cloudCoverPct) : cloudCover ?? undefined,
    path: String(raw?.path || ''),
    row: String(raw?.row || ''),
    platform: platform || undefined,
    platformLabel: raw?.platformLabel ? String(raw.platformLabel) : platform || undefined,
    coversArea,
    coveragePercent: Number.isFinite(Number(raw?.coveragePercent)) ? Number(raw.coveragePercent) : undefined,
    slcOff,
    bbox: Array.isArray(raw?.bbox) && raw.bbox.length >= 4
      ? [Number(raw.bbox[0]), Number(raw.bbox[1]), Number(raw.bbox[2]), Number(raw.bbox[3])] as [number, number, number, number]
      : null,
    geometry: raw?.geometry as CbersGeoJsonGeometry | undefined,
    thumbnailUrl: raw?.thumbnailUrl ? String(raw.thumbnailUrl) : undefined,
    assetKeys: Array.isArray(raw?.assetKeys) ? raw.assetKeys.map((item: any) => String(item)) : [],
    wmsAvailable: Boolean(raw?.wmsAvailable),
    wmsLayerName: raw?.wmsLayerName ? String(raw.wmsLayerName) : undefined,
    wmsUrl: raw?.wmsUrl ? String(raw.wmsUrl) : undefined,
    wmsDownloadUrl: raw?.wmsDownloadUrl ? String(raw.wmsDownloadUrl) : undefined,
    archiveImageId: raw?.archiveImageId ? String(raw.archiveImageId) : undefined,
    archiveFilename: raw?.archiveFilename ? String(raw.archiveFilename) : undefined,
  };
}

const normalizeCompositions = (raw: any): NdviComposition[] | undefined => {
  const list = Array.isArray(raw?.compositions)
    ? raw.compositions
    : Array.isArray(raw?.wmsLayerNames)
      ? raw.wmsLayerNames
      : [];
  const normalized = list
    .map((item: any) => String(item).trim())
    .filter((item: string): item is NdviComposition => isNdviComposition(item));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
};

const normalizeSceneJobState = (raw: any, docId: string, index: number): NdviSceneJobState | null => {
  if (!isPlainObject(raw)) return null;
  const itemId = String(raw?.itemId || raw?.scene?.id || raw?.scene?.itemId || '');
  if (!itemId) return null;
  const scene = normalizeNdviScene(raw?.scene);
  const statusRaw = String(raw?.status || '').trim().toLowerCase();
  const status: NdviJobStatus =
    statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'cancelled'
      ? statusRaw
      : 'processing';
  const wmsLayerNames = Array.isArray(raw?.wmsLayerNames)
    ? raw.wmsLayerNames.map((item: any) => String(item)).filter(Boolean)
    : undefined;
  return {
    itemId,
    scene,
    status,
    stage: raw?.stage ? String(raw.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(raw?.percent || 0)))),
    message: raw?.message ? String(raw.message) : undefined,
    error: raw?.error ? String(raw.error) : undefined,
    wmsLayerNames,
    compositions: normalizeCompositions(raw),
    outputUrl: raw?.outputUrl ? resolveBackendUrl(String(raw.outputUrl)) : undefined,
    outputRelativePath: raw?.outputRelativePath ? String(raw.outputRelativePath) : undefined,
    outputFilename: raw?.outputFilename ? String(raw.outputFilename) : undefined,
    outputBytes: Number.isFinite(Number(raw?.outputBytes)) ? Number(raw.outputBytes) : undefined,
    wmsUrl: raw?.wmsUrl ? String(raw.wmsUrl) : scene?.wmsUrl,
    wmsDownloadUrl: raw?.wmsDownloadUrl ? String(raw.wmsDownloadUrl) : scene?.wmsDownloadUrl,
  };
};

export function mapNdviDocToHistoryItem(docId: string, data: any): NdviHistoryItem {
  const rawStatus = String(data?.status || '').trim().toLowerCase();
  const status: NdviJobStatus =
    rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled'
      ? rawStatus
      : 'processing';
  const scenes = Array.isArray(data?.scenes)
    ? data.scenes
      .map((item: any, index: number) => normalizeSceneJobState(item, docId, index))
      .filter((item: NdviSceneJobState | null): item is NdviSceneJobState => Boolean(item))
    : undefined;
  const firstSceneState = scenes?.[0];
  const wmsLayerNames = firstSceneState?.wmsLayerNames;
  return {
    id: String(data?.id || docId),
    jobId: String(data?.jobId || docId),
    filename: String(data?.filename || 'NDVI'),
    timestamp: toIsoDateFromUnknown(data?.timestamp || data?.updatedAt || data?.createdAt),
    createdAt: data?.createdAt ? toIsoDateFromUnknown(data.createdAt) : undefined,
    updatedAt: data?.updatedAt ? toIsoDateFromUnknown(data.updatedAt) : undefined,
    status,
    stage: data?.stage ? String(data.stage) : undefined,
    percent: Math.max(0, Math.min(100, Math.round(Number(data?.percent || 0)))),
    message: data?.message ? String(data.message) : undefined,
    error: data?.error ? String(data.error) : undefined,
    itemIds: Array.isArray(data?.itemIds)
      ? data.itemIds.map((item: any) => String(item))
      : scenes
        ? scenes.map((sceneState: NdviSceneJobState) => sceneState.itemId)
        : undefined,
    scenes,
    mode: data?.mode === 'batch' ? 'batch' : data?.mode === 'single' ? 'single' : scenes && scenes.length > 1 ? 'batch' : undefined,
    areaHa: Number.isFinite(Number(data?.areaHa)) ? Number(data.areaHa) : undefined,
    compositions: normalizeCompositions(data),
    wmsLayerName: data?.wmsLayerName ? String(data.wmsLayerName) : wmsLayerNames?.[0],
    wmsUrl: data?.wmsUrl ? String(data.wmsUrl) : firstSceneState?.wmsUrl,
    wmsDownloadUrl: data?.wmsDownloadUrl ? String(data.wmsDownloadUrl) : firstSceneState?.wmsDownloadUrl,
    outputUrl: data?.outputUrl ? resolveBackendUrl(String(data.outputUrl)) : firstSceneState?.outputUrl,
    outputRelativePath: data?.outputRelativePath ? String(data.outputRelativePath) : firstSceneState?.outputRelativePath,
    outputFilename: data?.outputFilename ? String(data.outputFilename) : firstSceneState?.outputFilename,
    outputBytes: Number.isFinite(Number(data?.outputBytes)) ? Number(data.outputBytes) : firstSceneState?.outputBytes,
    batchZipUrl: data?.batchZipUrl ? resolveBackendUrl(String(data.batchZipUrl)) : undefined,
    batchZipRelativePath: data?.batchZipRelativePath ? String(data.batchZipRelativePath) : undefined,
    batchZipFilename: data?.batchZipFilename ? String(data.batchZipFilename) : undefined,
    batchZipBytes: Number.isFinite(Number(data?.batchZipBytes)) ? Number(data.batchZipBytes) : undefined,
  };
}
