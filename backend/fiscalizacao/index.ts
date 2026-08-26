/**
 * Análise de fiscalização de uma ATP contra as três bases de autuação/embargo.
 *
 * Fontes:
 *   - IBAMA  → PAMGIA (ArcGIS REST), embargos federais
 *   - SEMA   → GeoServer da IMAP, embargos/desembargos/autos estaduais
 *   - SIGA   → GeoServer da IMAP, embargos/desembargos/autos do SIGA
 *
 * Saída (ZIP): um mapa PDF por fonte com imagem de satélite, uma planilha com
 * todas as ocorrências e os shapefiles das feições encontradas.
 *
 * Endpoints:
 *   GET    /api/fiscalizacao/sources
 *   POST   /api/fiscalizacao/upload
 *   POST   /api/fiscalizacao/process
 *   GET    /api/fiscalizacao/jobs/:id/status
 *   GET    /api/fiscalizacao/jobs/:id/events
 *   GET    /api/fiscalizacao/download/:id
 *   DELETE /api/fiscalizacao/jobs/:id
 */
export * from "./types";
export * from "./constants";
export * from "./sources";
export * from "./analysis";
export * from "./shapefiles";
export * from "./excel-builder";
export * from "./render-map";
export * from "./sse";
export * from "./pipeline";
export * from "./routes";
