export { getAuasV2Config, AUAS_RULES_VERSION, AUAS_REQUIRED_SOURCES } from "./config";
export { extractAuasPolygons, computeGeometryHash } from "./auas-polygons";
export { reduceAuasPolygon, reduceAuasAggregate } from "./evidence-reducer";
export { buildAuasScene } from "./wms-scenes";
export { requestGroqVisionWindow } from "./groq-vision-client";
export { requestDeepseekAuasReport, buildDeterministicFallbackReport } from "./deepseek-text-client";
export { buildAuasReport } from "./report-builder";
export {
  runAuasPre2008Analysis,
  createInMemoryCheckpointStore,
  buildCheckpointKey,
  AuasCancelledError,
  AuasTooManyPolygonsError,
  type CheckpointStore,
  type OrchestratorDeps,
} from "./orchestrator";
export type {
  AuasPolygonIdentity,
  AuasScene,
  AuasPolygonResult,
  AuasPre2008AnalysisV2,
  AuasV2Progress,
  AuasV2JobState,
  PolygonPre2008Status,
  PropertyPre2008Status,
} from "./types";

export {
  runPos2008Analysis,
  type Pos2008CheckpointStore,
  type Pos2008OrchestratorDeps,
  type Pos2008RunInput,
} from "./pos2008/orchestrator";
export {
  resolvePos2008Catalog,
  clearPos2008CatalogCache,
  type PosCatalog,
} from "./pos2008/catalog";
export type {
  AuasPos2008Analysis,
  AuasPos2008PolygonResult,
  Pos2008WindowId,
  Pos2008Scene,
  Pos2008WindowRun,
  Pos2008WindowObservation,
} from "./pos2008/types";
export {
  runAcVegetacaoAnalysis,
  type AcVegetacaoOrchestratorDeps,
  type AcVegetacaoRunInput,
} from "./ac-vegetacao/orchestrator";
export type { AcVegetacaoAnalysis, AcPolygonResult, AcPotentialPolygon, AcVegetacaoWindowRun } from "./ac-vegetacao/types";
