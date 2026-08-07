/**
 * Cenas da Fase 3 (vegetação na AC) — F3.3.
 *
 * Uma janela de até 3 imagens por polígono AC: SENTINEL_2_2024 (estado atual),
 * SENTINEL_2_2021 NIR (realce de vegetação; pode cair para 2020) e SPOT 2008
 * (contexto do marco — nunca base para datar). NIR é estilo, não camada
 * (achado do levantamento F0.1): `layers=<mosaico>&styles=<estilo NIR>`.
 */
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
import type { AcVegetacaoScene } from "./types";
import type { AcPotentialPolygon } from "./types";

export type BuildAcVegetacaoSceneDeps = WmsFetchDeps & {
  now?: () => string;
};

export type AcSceneSpec = {
  sceneId: string;
  year: number;
  sensor: string;
  layer: string;
  style?: string;
};

export function buildAcSceneId(polygonId: string, key: string): string {
  return `${polygonId}:${key}`;
}

/**
 * Gera uma cena comparável para um polígono AC (mesmo bbox/dimensão/overlay).
 * Aceita `style` (NIR) — monta `layers=<mosaico>&styles=<estilo>`.
 */
export async function buildAcVegetacaoScene(
  polygon: AcPotentialPolygon,
  spec: AcSceneSpec,
  deps: BuildAcVegetacaoSceneDeps = {}
): Promise<AcVegetacaoScene> {
  const { width, height } = calculateDynamicResolution(polygon.areaHa, polygon.bbox);
  const now = deps.now || (() => new Date().toISOString());
  const layers = [spec.layer];
  const styles = spec.style ? [spec.style] : undefined;

  let usability: AcVegetacaoScene["usability"] = "MISSING";
  let qualityScore: number | null = null;
  let qualityFlags: string[] = [];
  let imageBuffer: Buffer | undefined;
  let storedImageUrl: string | undefined;

  try {
    const { buffer: baseImage, usedResolutionFallback } = await fetchWmsImageBuffer(
      layers,
      polygon.bbox,
      width,
      height,
      { ...deps, styles }
    );
    const overlaySvg = buildAuasPolygonOverlaySvg(width, height, polygon.bbox, polygon.geometry);
    const composited = await compositeOverlay(baseImage, overlaySvg);
    const classification = await classifySceneUsability(composited, { usedResolutionFallback });
    usability = classification.usability;
    qualityScore = classification.qualityScore;
    qualityFlags = classification.qualityFlags;
    imageBuffer = composited;
    storedImageUrl = sanitizeWmsUrl(buildWmsGetMapUrl(layers, polygon.bbox, width, height, "image/png", "EPSG:4326", styles));
  } catch (err) {
    usability = "MISSING";
    qualityFlags = [`fetch_error: ${String((err as any)?.message || err).slice(0, 200)}`];
  }

  return {
    sceneId: spec.sceneId,
    polygonId: polygon.polygonId,
    geometryHash: polygon.geometryHash,
    year: spec.year,
    sensor: spec.sensor,
    layer: spec.layer,
    style: spec.style,
    imageSha256: imageBuffer ? computeImageSha256(imageBuffer) : "",
    width,
    height,
    bbox: polygon.bbox,
    usability,
    qualityScore,
    qualityFlags,
    fetchedAt: now(),
    storedImageUrl,
    imageBuffer,
  };
}

/** URL sanitizada apenas para proveniência (sem authkey). */
function buildWmsMapUrl(
  layers: string[],
  bbox: [number, number, number, number],
  width: number,
  height: number,
  format = "image/png",
  crs = "EPSG:4326",
  styles?: string[]
): string {
  return buildWmsGetMapUrl(layers, bbox, width, height, format, crs, styles);
}