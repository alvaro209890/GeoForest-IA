/**
 * Barrel do módulo NDVI por cena completa (padrão da aba CBERS).
 *
 * Pipeline: Landsat C2 L2 SR (Planetary Computer) → materialização da cena inteira
 * (~30 m, ~7800×7800 px) → composições (NDVI/NDFI/RGB/SWIR) → acervo no raster
 * compartilhado → publicação no WMS (RASTER → NDVI → órbita → ano).
 */
export * from "./types";
export * from "./errors";
export * from "./constants";
export * from "./scene-select";
export * from "./compositions";
export * from "./archive";
export * from "./geoserver";
export * from "./pipeline";
export * from "./job";
export * from "./routes";
