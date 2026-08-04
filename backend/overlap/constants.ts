/**
 * Configuração dos WFS (SEMA/SICAR), tolerâncias e TTL do cache de upload.
 */
import { WFS_TIMEOUT_MS } from "../wfs-intersection";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_BUFFER_METERS = 50;
export const MIN_OVERLAP_M2 = 0.5;


export const SEMA_CAR_ATP_LAYER = process.env.SEMA_CAR_ATP_WFS_LAYER || "Geoportal:CAR_ATP";
export const SEMA_CAR_REQ_LAYER =
  process.env.SEMA_CAR_REQUIRED_WFS_LAYER || "Geoportal:MVW_REQUERIMENTO_ATP";
export const SICAR_WFS_BASE_URL =
  process.env.SICAR_WFS_BASE_URL || "https://geoserver.car.gov.br/geoserver/sicar/ows";
export const SICAR_WFS_LAYER = process.env.SICAR_WFS_LAYER || "sicar:sicar_imoveis_mt";
export const SICAR_WFS_TIMEOUT_MS = Number(process.env.SICAR_WFS_TIMEOUT_MS || Math.max(WFS_TIMEOUT_MS, 90000));
