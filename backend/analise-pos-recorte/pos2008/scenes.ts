/**
 * Cenas da Fase 2 (datação 2009–2019) — reuso total de `wms-scenes.ts` e
 * `image-quality.ts`, zero duplicação (tarefa F2.6 do plano).
 *
 * A Fase 1 tem `buildAuasScene` fixa em ano/sensor; aqui o ano, o sensor e a
 * camada vêm do catálogo runtime. Comparabilidade (mesma bbox/dimensão/overlay)
 * é garantida pelos mesmos helpers da Fase 1.
 */
import type { Geometry } from "geojson";

import {
  buildAuasPolygonOverlaySvg,
  calculateDynamicResolution,
  compositeOverlay,
  computeImageSha256,
  fetchWmsImageBuffer,
  sanitizeWmsUrl,
  buildWmsGetMapUrl,
  type WmsFetchDeps,
} from "../wms-scenes";
import { classifySceneUsability } from "../image-quality";
import type { AuasPolygonIdentity } from "../types";
import type { Pos2008Scene, Pos2008Sensor } from "./types";

export type BuildPos2008SceneDeps = WmsFetchDeps & {
  now?: () => string;
};

export type Pos2008SceneSpec = {
  year: number;
  sensor: Pos2008Sensor;
  layer: string;
  /** Janela-ponte em andamento — marca a cena para proveniência. */
  bridge?: boolean;
};

function sensorKey(sensor: Pos2008Sensor): string {
  return sensor.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Gera uma cena comparável (mesma bbox/dimensão/overlay) para um polígono AUAS,
 * um ano e uma camada do catálogo runtime. Não chama IA — apenas WMS + overlay +
 * qualidade.
 */
export async function buildPos2008Scene(
  polygon: AuasPolygonIdentity,
  spec: Pos2008SceneSpec,
  deps: BuildPos2008SceneDeps = {}
): Promise<Pos2008Scene> {
  const { width, height } = calculateDynamicResolution(polygon.areaHa, polygon.bbox);
  const now = deps.now || (() => new Date().toISOString());

  let usability: Pos2008Scene["usability"] = "MISSING";
  let qualityScore: number | null = null;
  let qualityFlags: string[] = [];
  let imageBuffer: Buffer | undefined;
  let storedImageUrl: string | undefined;

  try {
    const { buffer: baseImage, usedResolutionFallback } = await fetchWmsImageBuffer(
      [spec.layer],
      polygon.bbox,
      width,
      height,
      deps
    );
    const overlaySvg = buildAuasPolygonOverlaySvg(width, height, polygon.bbox, polygon.geometry);
    const composited = await compositeOverlay(baseImage, overlaySvg);
    const classification = await classifySceneUsability(composited, { usedResolutionFallback });
    usability = classification.usability;
    qualityScore = classification.qualityScore;
    qualityFlags = classification.qualityFlags;
    imageBuffer = composited;
    storedImageUrl = sanitizeWmsUrl(buildWmsGetMapUrl([spec.layer], polygon.bbox, width, height));
  } catch (err) {
    usability = "MISSING";
    qualityFlags = [`fetch_error: ${String((err as any)?.message || err).slice(0, 200)}`];
  }

  return {
    sceneId: `${polygon.polygonId}:${sensorKey(spec.sensor)}:${spec.year}`,
    polygonId: polygon.polygonId,
    geometryHash: polygon.geometryHash,
    year: spec.year,
    sensor: spec.sensor,
    layer: spec.layer,
    imageSha256: imageBuffer ? computeImageSha256(imageBuffer) : "",
    width,
    height,
    bbox: polygon.bbox,
    usability,
    qualityScore,
    qualityFlags,
    fetchedAt: now(),
    storedImageUrl,
    bridge: spec.bridge,
    imageBuffer,
  };
}
