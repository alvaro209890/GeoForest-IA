/**
 * Tipos do pipeline NDVI por cena completa (aba CBERS) — `backend/ndvi-scene/`.
 *
 * Contrato entre busca STAC, orquestração, composições, acervo e rotas. Segue o
 * mesmo espírito do `backend/ndvi/types.ts` e do `backend/cbers/types.ts`:
 * quando não dá para medir, o job **declara** o motivo — nunca estima.
 */
import type { MultiPolygon, Polygon } from "geojson";
import type { NdviSceneComposition } from "./constants";
import type { NdviSceneArchiveRecord } from "./archive";

/** Estado terminal de um job. */
export type NdviSceneJobStatus = "processing" | "completed" | "failed" | "cancelled";

/** Área do usuário, resolvida a partir do corpo da requisição (ZIP base64 ou CAR). */
export type NdviSceneAreaContext = {
  geometry?: Polygon | MultiPolygon;
  geometryHash?: string | null;
  areaHa: number;
};

/** Estado de UMA composição dentro de uma cena do job. */
export type NdviSceneCompositionState = {
  composition: NdviSceneComposition;
  status: NdviSceneJobStatus;
  stage: string;
  percent: number;
  message?: string;
  error?: string;
  archiveFilename?: string;
  archiveHdPath?: string;
  wmsLayerName?: string;
  wmsStoreName?: string;
  wmsUrl?: string;
  bytes?: number;
  completedAt?: string;
};

/** Estado de UMA cena do job (um item Landsat C2 L2). */
export type NdviSceneJobScene = {
  itemId: string;
  status: NdviSceneJobStatus;
  stage: string;
  percent: number;
  message?: string;
  error?: string;
  sceneRef?: {
    itemId: string;
    collection: string;
    platform: string;
    platformLabel: string;
    path: string;
    row: string;
    acquiredAt: string;
    year: number;
    cloudCoverPct: number | null;
  } | null;
  compositions?: NdviSceneCompositionState[];
  archive?: NdviSceneArchiveRecord;
  wmsLayerNames?: string[];
  bytes?: number;
  completedAt?: string;
};

/** Estado completo persistido do job (`users/<uid>/ndvi_scene_jobs/<jobId>.json`). */
export type NdviSceneJobState = {
  jobId: string;
  uid: string;
  status: NdviSceneJobStatus;
  mode?: "single" | "batch";
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  filename?: string;
  itemId?: string;
  itemIds?: string[];
  compositions?: NdviSceneComposition[];
  areaHa?: number;
  propertyGeometry?: Polygon | MultiPolygon;
  scenes?: NdviSceneJobScene[];
  outputUrls?: string[];
  wmsLayerNames?: string[];
  wmsUrl?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedAtMs?: number;
};

/** Patch de progresso propagado por SSE e persistência. */
export type NdviSceneProgressPatch = {
  status?: NdviSceneJobStatus;
  mode?: "single" | "batch";
  stage?: string;
  percent?: number;
  message?: string;
  error?: string | null;
  scenes?: NdviSceneJobScene[];
  outputUrls?: string[];
  wmsLayerNames?: string[];
  wmsUrl?: string;
  completedAt?: string;
};

/** Erro de cancelamento lançado dentro do pipeline. */
export class NdviSceneCancelError extends Error {
  constructor(message = "Cancelamento solicitado pelo usuário.") {
    super(message);
    this.name = "NdviSceneCancelError";
  }
}
