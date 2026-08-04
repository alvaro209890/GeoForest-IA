/**
 * Acervo CBERS: reaproveitamento de cenas já processadas e disponibilidade WMS.
 */
import { finishJob } from "../processing-jobs";
import type { CbersArchiveRecord } from "../cbers-archive";
import { listCbersArchiveRecords } from "../cbers-archive";
import { cbersCollectionByLevel } from "./collections";
import { CBERS_GENERATION_LEVEL } from "./constants";
import { findLocalGeoserverLayerForItem } from "./geoserver";
import { persistCbersJob } from "./sse";
import { CbersAreaContext, CbersScene, CbersSceneJobState } from "./types";
import { CbersWmsAvailability, parseCbersItemIdForWms, wmsDownloadPathForArchiveImage } from "./wms";

export function isActiveArchiveRecord(record: CbersArchiveRecord | null | undefined): record is CbersArchiveRecord {
  return Boolean(
    record &&
    !record.adminDeletedAt &&
    record.wmsPublicUrl &&
    (record.wmsLayerName || record.wmsStoreName),
  );
}

export function archiveAvailabilityFromRecord(record: CbersArchiveRecord): CbersWmsAvailability {
  return {
    wmsLayerName: record.wmsLayerName || record.wmsStoreName,
    wmsUrl: record.wmsPublicUrl,
    wmsDownloadUrl: wmsDownloadPathForArchiveImage(record.imageId),
    sourcePath: record.hdPath,
    archiveImageId: record.imageId,
    archiveFilename: record.archiveFilename,
  };
}

export function cbersDatetimeFromItemId(itemId: string): string {
  const parsed = parseCbersItemIdForWms(itemId);
  if (!parsed?.dateCompact) return "";
  const iso = `${parsed.dateCompact.slice(0, 4)}-${parsed.dateCompact.slice(4, 6)}-${parsed.dateCompact.slice(6, 8)}T00:00:00Z`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : "";
}

export function buildReusedCbersSceneState(record: CbersArchiveRecord): CbersSceneJobState {
  const level = record.level === "L2" || record.level === "L4" ? record.level : CBERS_GENERATION_LEVEL;
  const collection = level === CBERS_GENERATION_LEVEL
    ? cbersCollectionByLevel(CBERS_GENERATION_LEVEL)
    : null;
  const wmsDownloadUrl = wmsDownloadPathForArchiveImage(record.imageId);
  return {
    itemId: record.itemId,
    collectionId: collection?.collectionId,
    level,
    scene: {
      id: record.itemId,
      collectionId: collection?.collectionId,
      level,
      datetime: cbersDatetimeFromItemId(record.itemId),
      cloudCover: null,
      bbox: null,
      assetKeys: [],
      wmsAvailable: true,
      wmsLayerName: record.wmsLayerName,
      wmsUrl: record.wmsPublicUrl,
      wmsDownloadUrl,
      archiveImageId: record.imageId,
      archiveFilename: record.archiveFilename,
      alignmentStatus: "aligned",
    },
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "Imagem CBERS já publicada no WMS; acervo reaproveitado para este usuário.",
    outputUrl: wmsDownloadUrl,
    outputRelativePath: record.hdRelativePath,
    outputFilename: record.sourceFilename,
    outputBytes: record.bytes,
    archive: record,
    archiveImageId: record.imageId,
    wmsLayerName: record.wmsLayerName,
    wmsUrl: record.wmsPublicUrl,
    wmsDownloadUrl,
    alignmentStatus: "aligned",
  };
}

export function persistCompletedCbersReuseJob(args: {
  uid: string;
  jobId: string;
  filename: string;
  area: CbersAreaContext;
  itemIds: string[];
  reusedScenes: CbersSceneJobState[];
}): void {
  const first = args.reusedScenes[0];
  const now = new Date().toISOString();
  persistCbersJob(args.uid, args.jobId, {
    status: "completed",
    stage: "completed",
    percent: 100,
    message: args.reusedScenes.length === 1
      ? "Imagem CBERS já estava publicada no WMS; acervo reaproveitado."
      : `${args.reusedScenes.length} imagem(ns) CBERS já estavam publicadas no WMS; acervo reaproveitado.`,
    filename: args.filename,
    itemId: args.itemIds[0],
    itemIds: args.itemIds,
    mode: args.itemIds.length > 1 ? "batch" : "single",
    areaHa: args.area.areaHa || undefined,
    propertyGeometry: args.area.geometry,
    scene: first?.scene || null,
    scenes: args.reusedScenes,
    outputUrl: first?.outputUrl,
    outputRelativePath: first?.outputRelativePath,
    outputFilename: first?.outputFilename,
    outputBytes: first?.outputBytes,
    archive: first?.archive,
    archiveImageId: first?.archiveImageId,
    wmsLayerName: first?.wmsLayerName,
    wmsUrl: first?.wmsUrl,
    wmsDownloadUrl: first?.wmsDownloadUrl,
    alignmentStatus: first?.alignmentStatus,
    createdAt: now,
    completedAt: now,
  });
  finishJob({ jobId: args.jobId, status: "completed" });
}

export function findArchiveRecordByImageId(imageId: string): CbersArchiveRecord | null {
  const cleanImageId = String(imageId || "").trim();
  if (!cleanImageId) return null;
  return listCbersArchiveRecords().find((record) => (
    record.imageId === cleanImageId &&
    isActiveArchiveRecord(record)
  )) || null;
}

export function findActiveArchiveRecordForItem(itemId: string): CbersArchiveRecord | null {
  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) return null;
  return listCbersArchiveRecords().find((record) => (
    record.itemId === cleanItemId &&
    isActiveArchiveRecord(record)
  )) || null;
}

export function findAnyActiveArchiveForItem(itemId: string): CbersWmsAvailability | null {
  const cleanItemId = String(itemId || "").trim();
  if (!cleanItemId) return null;
  const archive = findActiveArchiveRecordForItem(cleanItemId);
  if (archive) return archiveAvailabilityFromRecord(archive);
  return findLocalGeoserverLayerForItem(cleanItemId);
}

export function findExactArchiveAvailability(
  itemId: string,
  _geometryHash?: string | null,
): CbersWmsAvailability | null {
  const archive = findActiveArchiveRecordForItem(itemId);
  return archive ? archiveAvailabilityFromRecord(archive) : null;
}

export function attachArchiveAvailability(scene: CbersScene, geometryHash?: string | null): CbersScene {
  const archive = findExactArchiveAvailability(scene.id, geometryHash);
  if (!archive) return scene;
  return {
    ...scene,
    wmsAvailable: true,
    wmsLayerName: archive.wmsLayerName,
    wmsUrl: archive.wmsUrl,
    wmsDownloadUrl: archive.wmsDownloadUrl,
    archiveImageId: archive.archiveImageId,
    archiveFilename: archive.archiveFilename,
  };
}
