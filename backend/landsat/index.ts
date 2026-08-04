/**
 * Landsat 8/9 — barrel público do pipeline.
 *
 * Busca STAC (LandsatLook/USGS + Planetary Computer) → download assinado (SAS)
 * → composição RGB (gdalbuildvrt + gdal_translate -scale) → publicação no
 * GeoServer sob a árvore RASTER/LANDSAT, com reaproveitamento do acervo local.
 *
 * Endpoints: /api/landsat/*  (ver `./routes.ts`)
 *
 * NOTA (Plano 06, 03/08/2026): o antigo `backend/landsat.ts` (1.621 linhas) foi
 * desmembrado nesta pasta. `import ... from "./landsat"` resolve para este
 * barrel, então a API pública continua idêntica.
 */
export * from "./types";
export * from "./constants";
export * from "./utils";
export * from "./naming";
export * from "./local-archive";
export * from "./stac-search";
export * from "./composite";
export * from "./geoserver";
export * from "./zip";
export * from "./sse";
export * from "./job";
export * from "./routes";
