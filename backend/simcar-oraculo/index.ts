/**
 * ============================================================================
 * 🚫 FLUXO DESATIVADO PARA SEMPRE (decisão do Álvaro, 2026-08-05)
 * ============================================================================
 * Este módulo implementa o "oráculo": enviar o ZIP do usuário ao SIMCAR REAL da
 * SEMA usando a CONTA TÉCNICA DO ÁLVARO, importar/processar e devolver o veredito
 * ao GeoForest. Esse produto está DESLIGADO e NÃO SERÁ REATIVADO.
 *
 *   - a aba "Análise de Erros → Processar projeto" foi removida em 2026-07-21;
 *   - as rotas /api/simcar-oraculo/* continuam registradas, mas são inalcançáveis
 *     pelo app e NÃO devem ser religadas nem chamadas por código novo;
 *   - NÃO APAGAR ./client.ts: a aba "Lotes SIMCAR" (viva) depende dele para a
 *     sessão SEMA — lá quem loga é o USUÁRIO com a própria credencial, o que é
 *     outra coisa e continua permitido.
 *
 * Regras completas: docs/FLUXO_ORACULO_SIMCAR_DESATIVADO.md
 * ============================================================================
 */
export { getSimcarOraculoConfig, assertSimcarCredentials, assertTestCarId } from "./config";
export { scramble } from "./scramble";
export { enqueueSimcar, getSimcarQueueLength } from "./queue";
export {
  simcarLogin,
  getSimcarToken,
  simcarGet,
  simcarPost,
  simcarDownload,
  simcarUploadZip,
  simcarBuscar,
  clearSimcarTokenCache,
} from "./client";
export { importZipOnTestProject } from "./import-shape";
export { processGeoOnTestProject } from "./process-geo";
export { extractShapeContext } from "./shape-context";
export {
  prepareTestProject,
  coversShapeBbox,
  expandBboxMeters,
} from "./prepare-project";
export { parseSemaReportPdf, parseSemaReportText } from "./sema-report-parse";
export {
  requestOraculoPipelineCancellation,
  resolveOraculoArtifact,
  startOraculoPipeline,
} from "./pipeline";
export { registerSimcarOraculoRoutes } from "./routes";
export type * from "./types";
