/**
 * Barrel do módulo SIMCAR — re-exporta tudo de simcar-clip.ts.
 * Migração gradual (plano 02): conforme os submódulos forem extraídos,
 * os exports serão redirecionados para os novos arquivos.
 */
export {
  parseUserShapefile,
  CLIP_SNAP_TOLERANCE_METERS,
  snapClippedGeometryToBoundary,
  getFixedAcAvnSatelliteKeys,
  getSimcarAiRuntimeConfig,
  runAcAvnSatelliteAnalysis,
  fetchCarBoundaryByNumber,
  registerSimcarClipRoutes,
} from "../simcar-clip";

export type {
  CachedJob,
  LayerSummary,
  AcAvnAnalysisMeta,
  AcAvnAnalysisResult,
  AcAvnAuasContext,
} from "../simcar-clip";
