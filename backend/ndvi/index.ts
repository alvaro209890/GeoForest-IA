/**
 * Barrel do módulo NDVI.
 *
 * Pipeline: Landsat C2 L2 SR (Planetary Computer) → recorte remoto por /vsicurl/ →
 * NDVI Float32 → paleta → acervo no HD → biblioteca NDVI do WMS → estatística por
 * polígono → laudo Word.
 *
 * Plano completo: `NDVI/Plano de implementação/` (00-STATUS.md primeiro).
 */
export * from "./constants";
export * from "./types";
export * from "./ndvi-math";
export * from "./naming";
export * from "./scene-select";
export * from "./compute";
export * from "./zonal";
export * from "./archive";
export * from "./geoserver";
export * from "./report-ndvi-docx";
export * from "./job";
export * from "./routes";
