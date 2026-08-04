/**
 * Configuração do pipeline CBERS (STAC, coleções, timeouts, realce, GeoServer).
 */
import { CbersCollectionConfig, CbersCollectionLevel } from "./types";

export const STAC_ROOT = String(
  process.env.CBERS_STAC_ROOT || "https://data.inpe.br/bdc/stac/v1",
).replace(/\/+$/, "");
export const CBERS_GENERATION_LEVEL: CbersCollectionLevel = "L4";
export const CBERS_COLLECTIONS: CbersCollectionConfig[] = [
  {
    level: CBERS_GENERATION_LEVEL,
    collectionId: process.env.CBERS_COLLECTION_L4 || "CB4A-WPM-L4-DN-1",
    priority: 1,
  },
];
export const CBERS_REQUIRED_ASSETS = ["BAND3", "BAND4", "BAND2", "BAND0"] as const;
export const CBERS_TMP_ROOT = process.env.CBERS_TMP_ROOT || "/tmp/geoforest-cbers-wpm";
export const CBERS_SEARCH_LIMIT = Math.max(1, Number(process.env.CBERS_SEARCH_LIMIT || 50));
export const CBERS_ORBIT_POINT_SEARCH_MAX_PAGES = Math.max(
  1,
  Number(process.env.CBERS_ORBIT_POINT_SEARCH_MAX_PAGES || 30),
);
export const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.CBERS_FETCH_TIMEOUT_MS || 120000));
export const CBERS_BATCH_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CBERS_BATCH_CONCURRENCY || 2)));
export const CBERS_DOWNLOAD_RETRIES = Math.max(0, Number(process.env.CBERS_DOWNLOAD_RETRIES || 3));
export const CBERS_DOWNLOAD_RETRY_DELAY_MS = Math.max(1000, Number(process.env.CBERS_DOWNLOAD_RETRY_DELAY_MS || 3000));
export const CBERS_DOWNLOAD_STALL_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.CBERS_DOWNLOAD_STALL_TIMEOUT_MS || 180000),
);
export const CBERS_TMP_CLEANUP_MAX_AGE_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.CBERS_TMP_CLEANUP_MAX_AGE_MS || 2 * 60 * 60 * 1000),
);
export const CBERS_PANSHARPEN_ESTIMATE_MS = Math.max(
  60000,
  Number(process.env.CBERS_PANSHARPEN_ESTIMATE_MS || 8 * 60 * 1000),
);
export const CBERS_TRANSLATE_ESTIMATE_MS = Math.max(
  30000,
  Number(process.env.CBERS_TRANSLATE_ESTIMATE_MS || 3 * 60 * 1000),
);
// CBERS generation is intentionally L4-only. L2 is kept in a few read paths only so old
// archive metadata can still be displayed/downloaded without creating new L2 products.
// We trust INPE's native georeferencing and only refuse to publish a scene whose
// georeferencing is grossly broken, measured against the scene's OWN STAC footprint.
export const CBERS_GEOREF_SANITY_MAX_M = Math.max(
  3000,
  Number(process.env.CBERS_GEOREF_SANITY_MAX_M || 20000),
);
// Contrast stretch applied when converting the 16-bit pansharpened scene to the 8-bit RGB
// GeoTIFF that GeoServer renders. A plain `gdal_translate -scale` stretches each band over
// its absolute min..max, so a handful of saturated/cloud pixels flatten the whole image to
// a dark, washed-out look (e.g. a band with min 49 / max 1023 / mean 158 maps the mean to
// DN ~28). We instead clip the bright tail at mean + N*stdDev. Modes:
//   "global"  (default) one shared [lo, hi] for the 3 bands -> brightens and adds contrast
//             WITHOUT shifting the colour balance (preserves the familiar 342 look).
//   "perband" / "sigma" independent [lo, hi] per band -> maximum contrast and an automatic
//             white balance, but it visibly changes the hue (shifts to the magenta/green
//             false-colour). Use only if that look is wanted.
//   "minmax"  legacy absolute min..max behaviour.
// Border pixels stay 0 (nodata/transparent): the output floor is 0 and the low cut is >= 0.
export const CBERS_STRETCH_MODE = String(process.env.CBERS_STRETCH_MODE || "global").toLowerCase();
export const CBERS_STRETCH_SIGMA = (() => {
  const value = Number(process.env.CBERS_STRETCH_SIGMA || 2.5);
  return Number.isFinite(value) && value > 0 ? value : 2.5;
})();
// Approximate stats subsample the raster (via overviews/decimation) instead of a full read,
// so the extra gdalinfo pass before the byte conversion stays cheap on full-orbit scenes.
export const CBERS_STRETCH_APPROX = String(process.env.CBERS_STRETCH_APPROX ?? "1") !== "0";
export const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
export const GEOSERVER_DATA_DIR = process.env.GEOSERVER_DATA_DIR || "/home/server/geoserver_data";
export const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE ||
    "https://wms.cursar.space/geoserver/cbers/wms",
).trim();
