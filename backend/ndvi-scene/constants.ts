/**
 * Configuração do pipeline NDVI por cena completa (`backend/ndvi-scene/`).
 *
 * Padrão da aba CBERS: em vez de recortar a cena pelo imóvel, a **cena inteira**
 * (Landsat C2 L2 SR, ~7800×7800 px) é materializada, colorida, arquivada no
 * raster compartilhado e publicada no WMS — uma composição por store/layer.
 *
 * Reusa as constantes do módulo `backend/ndvi/` (acervo, estilo NDVI, overviews,
 * escala radiométrica, máscara QA) e só define o que é específico da cena completa.
 */
import path from "node:path";
import {
  GEOSERVER_RASTER_STYLE,
  GEOSERVER_PUBLIC_WMS_BASE,
  NDVI_ARCHIVE_ROOT,
  NDVI_OVERVIEW_LEVELS,
  NDVI_OVERVIEW_MIN_PIXELS,
  NDVI_OVERVIEW_RESAMPLING_DATA,
  NDVI_OVERVIEW_RESAMPLING_RGB,
  NDVI_QA_CIRRUS_BIT,
  NDVI_QA_MASK_BITS_BASE,
  NDVI_SLD_PATH,
  NDVI_SR_OFFSET,
  NDVI_SR_SCALE,
  NDVI_COLOR_RAMP_PATH,
  NDVI_NODATA,
} from "../ndvi/constants";

// --- Acervo e temporários -------------------------------------------------

/** Raiz do acervo da cena completa — mesma pasta do NDVI pós-recorte, por default. */
export const NDVI_SCENE_ARCHIVE_ROOT = path.resolve(
  process.env.NDVI_SCENE_ARCHIVE_ROOT || NDVI_ARCHIVE_ROOT
);

export const NDVI_SCENE_TMP_ROOT =
  process.env.NDVI_SCENE_TMP_ROOT || "/tmp/geoforest-ndvi-scene";

/** Cenas simultâneas de um lote. */
export const NDVI_SCENE_BATCH_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.NDVI_SCENE_BATCH_CONCURRENCY || 1))
);

// --- Composições ----------------------------------------------------------

/** Composições suportadas para a cena completa. */
export type NdviSceneComposition = "NDVI" | "NDFI" | "SAVI" | "RGB" | "SWIR";

export type NdviSceneCompositionMeta = {
  id: NdviSceneComposition;
  label: string;
  /** Bandas C2 L2 necessárias, na ordem em que entram no cálculo/merge. */
  bands: string[];
  /** Estilo GeoServer aplicado à camada publicada. */
  styleName: string;
  description: string;
};

/** Metadados das composições; `bands` é a fonte única para `bandKeysForComposition`. */
export const NDVI_SCENE_COMPOSITIONS: readonly NdviSceneCompositionMeta[] = [
  {
    id: "NDVI",
    label: "NDVI",
    bands: ["nir08", "red", "qa_pixel"],
    styleName: GEOSERVER_RASTER_STYLE,
    description:
      "Índice de vegetação por diferença normalizada (NIR-RED), com máscara de nuvem/sombra/snow do qa_pixel.",
  },
  {
    id: "NDFI",
    label: "NDFI",
    bands: ["swir16", "nir08", "qa_pixel"],
    styleName: GEOSERVER_RASTER_STYLE,
    description:
      "NDFI = (ρ_NIR − ρ_SWIR16)/(ρ_NIR + ρ_SWIR16): área convertida/solo exposto (SWIR alto, NIR baixo) → negativo; vegetação densa → positivo alto.",
  },
  {
    id: "SAVI",
    label: "SAVI",
    bands: ["nir08", "red", "qa_pixel"],
    styleName: GEOSERVER_RASTER_STYLE,
    description:
      "SAVI = (ρ_NIR − ρ_RED)/(ρ_NIR + ρ_RED + L) × (1 + L), com L = 0,5: índice de vegetação ajustado ao solo, minimiza a influência do solo exposto (útil em áreas com pouca cobertura).",
  },
  {
    id: "RGB",
    label: "RGB",
    bands: ["red", "green", "blue"],
    styleName: GEOSERVER_RASTER_STYLE,
    description:
      "Cor natural 4-3-2 (red, green, blue) em 8 bits com realce de contraste.",
  },
  {
    id: "SWIR",
    label: "SWIR",
    bands: ["swir16", "nir08", "red"],
    styleName: GEOSERVER_RASTER_STYLE,
    description:
      "Falsa-cor 6-5-4 (swir16, nir08, red) em 8 bits com realce de contraste.",
  },
];

/** Composição padrão quando o cliente não pede nenhuma. */
export const NDVI_SCENE_DEFAULT_COMPOSITIONS: readonly NdviSceneComposition[] =
  ["NDVI", "NDFI", "SAVI"];

export function compositionMeta(id: string): NdviSceneCompositionMeta | null {
  return NDVI_SCENE_COMPOSITIONS.find(c => c.id === id) || null;
}

// --- Estilos GeoServer ----------------------------------------------------

/** Estilo NDFI novo, criado/publicado por `ensureNdfiStyle()` do módulo. */
export const GEOSERVER_NDFI_STYLE =
  process.env.GEOSERVER_NDFI_STYLE || "ndfi_ramp";

/** Estilo SAVI novo, criado/publicado por `ensureSaviStyle()` do módulo. */
export const GEOSERVER_SAVI_STYLE =
  process.env.GEOSERVER_SAVI_STYLE || "savi_ramp";

/** Os produtos finais são RGB/RGBA 8 bits e usam o estilo neutro `raster`. */
export { GEOSERVER_RASTER_STYLE, GEOSERVER_PUBLIC_WMS_BASE };

// --- Caminhos dos SLD/CLR -------------------------------------------------

function repoConfigPath(...parts: string[]): string {
  return path.resolve(process.cwd(), "config", ...parts);
}

export const NDFI_SLD_PATH =
  process.env.NDFI_SLD_PATH ||
  repoConfigPath("geoserver-styles", "ndfi_ramp.sld");
export const NDFI_COLOR_RAMP_PATH =
  process.env.NDFI_COLOR_RAMP_PATH ||
  repoConfigPath("geoserver-styles", "ndfi_ramp.clr");

export const SAVI_SLD_PATH =
  process.env.SAVI_SLD_PATH ||
  repoConfigPath("geoserver-styles", "savi_ramp.sld");
export const SAVI_COLOR_RAMP_PATH =
  process.env.SAVI_COLOR_RAMP_PATH ||
  repoConfigPath("geoserver-styles", "savi_ramp.clr");

export {
  NDVI_SLD_PATH,
  NDVI_COLOR_RAMP_PATH,
  NDVI_SR_SCALE,
  NDVI_SR_OFFSET,
  NDVI_NODATA,
  NDVI_QA_MASK_BITS_BASE,
  NDVI_QA_CIRRUS_BIT,
  NDVI_OVERVIEW_LEVELS,
  NDVI_OVERVIEW_MIN_PIXELS,
  NDVI_OVERVIEW_RESAMPLING_DATA,
  NDVI_OVERVIEW_RESAMPLING_RGB,
};
