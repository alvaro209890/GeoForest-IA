/**
 * Tipos e erro de cancelamento do pipeline CBERS-4A WPM.
 */
import type { MultiPolygon, Polygon } from "geojson";
import type { CbersArchiveRecord } from "./archive";

export type CbersJobStatus = "processing" | "completed" | "failed" | "cancelled";
export type CbersCollectionLevel = "L4" | "L2";
export type CbersAlignmentStatus =
  | "not_checked"
  | "reference_missing"
  | "aligned"
  | "corrected"
  | "failed_private";

export type CbersCollectionConfig = {
  level: CbersCollectionLevel;
  collectionId: string;
  priority: number;
};

export type CbersAlignmentResult = {
  status: CbersAlignmentStatus;
  warning?: string;
  reference?: string;
  offsetXM?: number;
  offsetYM?: number;
  offsetMeters?: number;
  correctedPath?: string;
};

export type CbersScene = {
  id: string;
  collectionId?: string;
  level?: CbersCollectionLevel;
  datetime: string;
  cloudCover: number | null;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon | MultiPolygon;
  thumbnailUrl?: string;
  assetKeys: string[];
  coveragePercent?: number;
  coversArea?: boolean;
  estimate?: CbersEstimate;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  archiveImageId?: string;
  archiveFilename?: string;
  fallbackFromL2?: boolean;
  alignmentStatus?: CbersAlignmentStatus;
  alignmentWarning?: string;
};

export type CbersEstimate = {
  downloadBytes: number;
  downloadMb: number;
  outputBytesEstimated: number;
  outputMbEstimated: number;
  timeSecondsEstimated: number;
  completeAssetSizes: boolean;
  assetSizes: Record<string, number | null>;
};

export type CbersAreaContext = {
  geometry?: Polygon | MultiPolygon;
  geometryHash?: string | null;
  areaHa: number;
};

export type CbersSceneJobState = {
  itemId: string;
  collectionId?: string;
  level?: CbersCollectionLevel;
  scene?: CbersScene | null;
  status: CbersJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  estimate?: CbersEstimate;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archive?: CbersArchiveRecord;
  archiveImageId?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: CbersAlignmentStatus;
  alignmentWarning?: string;
  alignment?: CbersAlignmentResult;
};

export type CbersProgressPatch = {
  status?: CbersJobStatus;
  stage?: string;
  percent?: number;
  message?: string;
  error?: string | null;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archive?: CbersArchiveRecord;
  archiveImageId?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: CbersAlignmentStatus;
  alignmentWarning?: string;
  alignment?: CbersAlignmentResult;
  batchZipUrl?: string;
  batchZipRelativePath?: string;
  batchZipFilename?: string;
  batchZipBytes?: number;
  completedAt?: string;
  scene?: CbersScene | null;
  estimate?: CbersEstimate | null;
  scenes?: CbersSceneJobState[];
  mode?: "single" | "batch";
};

export class CbersCancelError extends Error {
  constructor(message = "Cancelamento solicitado pelo usuário.") {
    super(message);
    this.name = "CbersCancelError";
  }
}
