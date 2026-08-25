/**
 * Configuração do pipeline NDVI (Landsat C2 L2 SR → GDAL → GeoServer → laudo).
 *
 * Plano: `NDVI/Plano de implementação/` (STATUS primeiro).
 *
 * ⚠️ `NDVI_SR_SCALE`/`NDVI_SR_OFFSET` são os coeficientes radiométricos do produto
 * Collection 2 Level-2 (`ρ = DN * 0.0000275 - 0.2`). Existem como env para o dia em que
 * a USGS publicar coleção com outros coeficientes — **não** para "ajustar" resultado.
 * O offset NÃO cancela na razão do NDVI; ver `ndvi-math.ts`.
 */
import path from "node:path";

// --- Acervo e temporários -------------------------------------------------

export const NDVI_ARCHIVE_ROOT = path.resolve(
  process.env.NDVI_ARCHIVE_ROOT || "/media/server/HD Backup/RASTER/NDVI",
);
export const NDVI_TMP_ROOT = process.env.NDVI_TMP_ROOT || "/tmp/geoforest-ndvi";

// --- Escolha de cena ------------------------------------------------------

/** Miolo da seca em MT: mesma lógica do acervo local (data mais próxima de 22/07). */
export const NDVI_SEASON_START = process.env.NDVI_SEASON_START || "06-01";
export const NDVI_SEASON_END = process.env.NDVI_SEASON_END || "09-30";
export const NDVI_MAX_CLOUD_PCT = Math.max(
  0,
  Math.min(100, Number(process.env.NDVI_MAX_CLOUD_PCT || 40)),
);
/** Marco legal (Lei 12.651/2012, art. 3º, IV) e miolo da seca. */
export const NDVI_TARGET_MONTH_DAY = "07-22";

// --- Cálculo --------------------------------------------------------------

export const NDVI_SR_SCALE = Number(process.env.NDVI_SR_SCALE || 0.0000275);
export const NDVI_SR_OFFSET = Number(process.env.NDVI_SR_OFFSET || -0.2);
export const NDVI_NODATA = Number(process.env.NDVI_NODATA || -9999);

/**
 * Bits do `qa_pixel` que viram nodata.
 *   bit 0 fill · 1 dilated cloud · 2 cirrus (L8/9) · 3 cloud · 4 shadow · 5 snow
 * Água (bit 7) NÃO entra: água é informação (NDVI < 0).
 */
export const NDVI_QA_MASK_BITS_BASE = Number(process.env.NDVI_QA_MASK_BITS || 0b111011); // 59 = fill(1)+dilated(2)+cloud(8)+shadow(16)+snow(32)
export const NDVI_QA_CIRRUS_BIT = 0b100; // 4

// --- Estatística zonal ----------------------------------------------------

export const NDVI_ZONAL_MAX_FEATURES = Math.max(
  1,
  Number(process.env.NDVI_ZONAL_MAX_FEATURES || 50),
);
export const NDVI_MIN_VALID_PCT = Math.max(
  0,
  Math.min(1, Number(process.env.NDVI_MIN_VALID_PCT || 0.6)),
);
export const NDVI_MIN_PIXELS = Math.max(1, Number(process.env.NDVI_MIN_PIXELS || 10));

/** Camadas do recorte que ganham estatística zonal, na ordem em que saem no laudo. */
export const NDVI_ZONAL_LAYERS = ["AREA_CONSOLIDADA", "AVN", "AUAS", "ARL"] as const;

// --- Publicação -----------------------------------------------------------

export const GEOSERVER_BASE_URL = String(
  process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
).replace(/\/+$/, "");
export const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
export const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
export const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
export const GEOSERVER_NDVI_STYLE = process.env.GEOSERVER_NDVI_STYLE || "ndvi_ramp";
export const GEOSERVER_RASTER_STYLE = process.env.GEOSERVER_RASTER_STYLE || "raster";
export const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE || "https://wms.cursar.space/geoserver/cbers/wms",
).trim();

export const ROOT_RASTER_GROUP = "RASTER";
/** A biblioteca própria do NDVI, irmã de CBERS-4A-Apos_2019, LANDSAT e SPOT. */
export const ROOT_NDVI_GROUP = "NDVI";

export const GEOSERVER_PUBLISH_RETRIES = Math.max(
  0,
  Number(process.env.GEOSERVER_PUBLISH_RETRIES || 4),
);
export const GEOSERVER_PUBLISH_RETRY_DELAY_MS = Math.max(
  100,
  Number(process.env.GEOSERVER_PUBLISH_RETRY_DELAY_MS || 4000),
);
export const GEOSERVER_READY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.GEOSERVER_READY_TIMEOUT_MS || 60000),
);

/**
 * ⚠️ Float32 com nodata usa `nearest`: `average` mistura -9999 com dado válido e
 * inventa valor no zoom-out. Só o RGB pode usar `average`.
 */
export const NDVI_OVERVIEW_RESAMPLING_DATA =
  process.env.NDVI_OVERVIEW_RESAMPLING_DATA || "nearest";
export const NDVI_OVERVIEW_RESAMPLING_RGB =
  process.env.NDVI_OVERVIEW_RESAMPLING_RGB || "average";
export const NDVI_OVERVIEW_LEVELS = (process.env.NDVI_OVERVIEW_LEVELS || "2 4 8 16 32")
  .split(/\s+/)
  .filter(Boolean);
/** Abaixo disso não vale gerar overview. */
export const NDVI_OVERVIEW_MIN_PIXELS = Math.max(
  0,
  Number(process.env.NDVI_OVERVIEW_MIN_PIXELS || 512),
);

// --- Estilo versionado ----------------------------------------------------

function repoConfigPath(...parts: string[]): string {
  return path.resolve(process.cwd(), "config", ...parts);
}

export const NDVI_SLD_PATH =
  process.env.NDVI_SLD_PATH || repoConfigPath("geoserver-styles", "ndvi_ramp.sld");
export const NDVI_COLOR_RAMP_PATH =
  process.env.NDVI_COLOR_RAMP_PATH || repoConfigPath("geoserver-styles", "ndvi_ramp.clr");

// --- Habilitação ----------------------------------------------------------

export const SIMCAR_NDVI_ENABLED =
  String(process.env.SIMCAR_NDVI_ENABLED || "").toLowerCase() === "true";

// --- Progresso ------------------------------------------------------------

export const NDVI_WARP_ESTIMATE_MS = Math.max(
  1000,
  Number(process.env.NDVI_WARP_ESTIMATE_MS || 90_000),
);
export const NDVI_CALC_ESTIMATE_MS = Math.max(
  1000,
  Number(process.env.NDVI_CALC_ESTIMATE_MS || 45_000),
);
