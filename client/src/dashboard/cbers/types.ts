import type { CbersGeoJsonGeometry } from '../components/CbersMapPreview';

export type CbersEstimate = {
  downloadBytes: number;
  downloadMb: number;
  outputBytesEstimated: number;
  outputMbEstimated: number;
  timeSecondsEstimated: number;
  completeAssetSizes: boolean;
  assetSizes: Record<string, number | null>;
};

export type CbersScene = {
  id: string;
  collectionId?: string;
  level?: 'L4' | 'L2';
  datetime: string;
  cloudCover: number | null;
  bbox: [number, number, number, number] | null;
  geometry?: CbersGeoJsonGeometry;
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
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
};

export type CbersJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

export type CbersSceneJobState = {
  itemId: string;
  collectionId?: string;
  level?: 'L4' | 'L2';
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
  archiveImageId?: string;
  archiveFilename?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
};

export type CbersHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: CbersJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  itemId?: string;
  itemIds?: string[];
  mode?: 'single' | 'batch';
  collection?: string;
  areaHa?: number;
  estimate?: CbersEstimate;
  scene?: CbersScene | null;
  scenes?: CbersSceneJobState[];
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  archiveImageId?: string;
  archiveFilename?: string;
  wmsLayerName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  alignmentStatus?: 'not_checked' | 'reference_missing' | 'aligned' | 'corrected' | 'failed_private';
  alignmentWarning?: string;
  batchZipUrl?: string;
  batchZipRelativePath?: string;
  batchZipFilename?: string;
  batchZipBytes?: number;
};
