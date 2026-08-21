/**
 * SIMCAR Clip — barrel de compatibilidade.
 *
 * O monólito original (10.026 linhas) foi desmembrado nos módulos
 * `backend/simcar/` (Plano 02). Este arquivo mantém re-exports para
 * compatibilidade com imports antigos.
 */

export {
    processClip,
    parsePersistedClipContext,
    mapToObjectGeometry,
    objectToMapGeometry,
    clipFeaturesToPolygon,
    jobCache,
    pruneJobCache,
    ClientAbortError,
    isSseConnectionClosed,
    throwIfClientDisconnected,
    sendSSE,
    startSseHeartbeat,
    sleepMs,
} from "./simcar/clip-pipeline";
export type {
    CachedJob,
    ClipResult,
    ClippedPointResult,
    ClippedPolygonResult,
    LayerSummary,
    PersistedClipContextV1,
    WfsClipFetchResult,
    WfsFeature,
} from "./simcar/clip-pipeline";

export {
    readPersistedSimcarClip,
    hydrateCachedJob,
    persistSimcarClipProcessingState,
    persistSimcarClipArtifacts,
    parseCachedContextFromOutputZip,
} from "./simcar/hydration";

export { generateAndPersistSimcarReport, buildSimcarReportPdfBuffer } from "./simcar/report";
export { buildSimcarReportDocxBuffer } from "./simcar/report-docx";
export type { SimcarReportArtifact, SimcarReportImage } from "./simcar/report";

export {
    getFixedAcAvnSatelliteKeys,
    getSimcarAiRuntimeConfig,
    runAcAvnSatelliteAnalysis,
    getOrderedSatelliteKeys,
    normalizeAssistantContent,
    compactChatMessages,
    callTextFollowUp,
    streamTextFollowUp,
    buildAnalysisPrompt,
    processAuasAnalysis,
    processAuasAnalysisV2,
    handleAuasAnalyzeV2Route,
    sendAcAvnComplete,
    processAnalysis,
    buildEstimatedUsageForFallback,
    attachOptionalAuth,
} from "./simcar/analysis";

export {
    registerSimcarClipRoutes,
} from "./simcar/routes";

export { CLIP_SNAP_TOLERANCE_METERS, snapClippedGeometryToBoundary } from "./simcar-clip-snap";

export {
    parseUserShapefile,
    discoverLayerMapping,
    fetchWfsClipFeatures,
    fetchWfsIntersectsFeatures,
    fetchWfsBboxFeatures,
    fetchCarBoundaryByNumber,
    compressForVision,
    uploadToCloudinary,
    getCloudinaryAiUrl,
    deleteFromCloudinary,
    uploadRawBufferToCloudinary,
    uploadBufferToCloudinary,
    buildVisionContentParts,
    reduceImageSet,
    estimateBytesFromDataUrl,
    isTruncationFinishReason,
    toPublicApiUrl,
} from "./simcar";
