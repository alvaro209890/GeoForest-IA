/**
 * Análise de sobreposição SIGEF × CAR (estadual/federal) e CAR estadual × CAR estadual.
 *
 * Gera até 3 planilhas ExcelJS no formato das referências Joelise:
 *   - SIGEF × CAR estadual
 *   - SIGEF × CAR federal (SICAR)
 *   - CAR estadual × CAR estadual (didática)
 *
 * Endpoints:
 *   POST /api/overlap/upload
 *   POST /api/overlap/process
 *   GET  /api/overlap/jobs/:id/status
 *   GET  /api/overlap/jobs/:id/events
 *   GET  /api/overlap/download/:id
 *   DELETE /api/overlap/jobs/:id
 *   GET  /api/overlap/sources/health
  *
 * NOTA (Plano 07, 03/08/2026): o monolito de 1.364 linhas foi desmembrado nesta pasta.
 */
export * from "./types";
export * from "./constants";
export * from "./utils";
export * from "./sse";
export * from "./car-intersection";
export * from "./excel-builder";
export * from "./pipeline";
export * from "./routes";
