/**
 * Tipos do pipeline Landsat.
 */
import path from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import { compositionLabel } from "./naming";

export type LandsatJobStatus = "processing" | "completed" | "failed" | "cancelled";
export type LandsatComposition = "false_color" | "natural_color";
export type LandsatSource = "local_wms" | "usgs_stac";
export type PlainObject = Record<string, any>;

export type LandsatScene = {
  id: string;
  source: LandsatSource;
  collectionId?: string;
  platform?: string;
  sensor?: string;
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  datetime: string;
  cloudCover: number | null;
  composition: LandsatComposition;
  compositionLabel: string;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon | MultiPolygon;
  thumbnailUrl?: string;
  coveragePercent?: number;
  coversArea?: boolean;
  assetKeys?: string[];
  downloadBytes?: number | null;
  wmsAvailable?: boolean;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
  sourcePath?: string;
  outputFilename?: string;
};

export type LandsatJobState = {
  sceneId: string;
  scene?: LandsatScene | null;
  status: LandsatJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  outputUrl?: string;
  outputRelativePath?: string;
  outputFilename?: string;
  outputBytes?: number;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  wmsDownloadUrl?: string;
};

export type LandsatAreaContext = {
  geometry?: Polygon | MultiPolygon;
  geometryHash?: string | null;
  areaHa: number;
};

export type LandsatProgressPatch = Partial<LandsatJobState> & {
  filename?: string;
  completedAt?: string;
  mode?: "single";
};

export type LandsatLocalRecord = {
  layerName: string;
  storeName: string;
  title: string;
  sourcePath: string;
  bytes: number;
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
  composition: LandsatComposition;
  compositionLabel: string;
  bbox: [number, number, number, number] | null;
  geometry?: Polygon;
};

export type LandsatWmsZipFile = {
  absolutePath: string;
  name: string;
};
