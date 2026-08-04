/**
 * Configuração do pipeline Landsat (STAC USGS/Planetary Computer, acervo, GeoServer).
 */
import path from "node:path";

export const LANDSAT_STAC_ROOT = String(
  process.env.LANDSAT_STAC_ROOT || "https://landsatlook.usgs.gov/stac-server",
).replace(/\/+$/, "");
export const LANDSAT_STAC_COLLECTION = process.env.LANDSAT_STAC_COLLECTION || "landsat-c2l2-sr";
export const LANDSAT_PC_STAC_ROOT = String(
  process.env.LANDSAT_PC_STAC_ROOT || "https://planetarycomputer.microsoft.com/api/stac/v1",
).replace(/\/+$/, "");
export const LANDSAT_PC_COLLECTION = process.env.LANDSAT_PC_COLLECTION || "landsat-c2-l2";
export const LANDSAT_PC_SIGN_ROOT = String(
  process.env.LANDSAT_PC_SIGN_ROOT || "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
).replace(/\/+$/, "");
export const LANDSAT_ARCHIVE_ROOT = path.resolve(
  process.env.LANDSAT_ARCHIVE_ROOT || "/media/server/HD Backup/RASTER/LANDSAT",
);
export const LANDSAT_TMP_ROOT = process.env.LANDSAT_TMP_ROOT || "/tmp/geoforest-landsat";
export const LANDSAT_SEARCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.LANDSAT_SEARCH_LIMIT || 50)));
export const LANDSAT_DOWNLOAD_RETRIES = Math.max(0, Number(process.env.LANDSAT_DOWNLOAD_RETRIES || 3));
export const LANDSAT_MIN_DOWNLOAD_BYTES = Math.max(0, Number(process.env.LANDSAT_MIN_DOWNLOAD_BYTES || 1024 * 1024));
export const LANDSAT_SCALE_MIN = Number(process.env.LANDSAT_SCALE_MIN || 1);
export const LANDSAT_SCALE_MAX = Number(process.env.LANDSAT_SCALE_MAX || 30000);
export const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.LANDSAT_FETCH_TIMEOUT_MS || 120000));
export const GEOSERVER_DATA_DIR = process.env.GEOSERVER_DATA_DIR || "/home/server/geoserver_data";
export const GEOSERVER_BASE_URL = String(
  process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
).replace(/\/+$/, "");
export const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
export const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
export const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
export const GEOSERVER_LANDSAT_STYLE = process.env.GEOSERVER_LANDSAT_STYLE || "landsat_rgb";
export const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE || "https://wms.cursar.space/geoserver/cbers/wms",
).trim();
export const ROOT_RASTER_GROUP = "RASTER";
export const ROOT_LANDSAT_GROUP = "LANDSAT";
