/**
 * Barrel do módulo SIMCAR — re-exporta funções e tipos públicos.
 *
 * Plano 02: conforme submódulos são extraídos, os exports
 * migram de ../simcar-clip para os novos arquivos.
 */

// ── Tipos ──
export type {
    CachedJob,
    LayerSummary,
    AcAvnAnalysisMeta,
    AcAvnAnalysisResult,
    AcAvnAuasContext,
    AcAvnVerdict,
    AcAvnConfidence,
    AcAvnSatelliteInfo,
    AcAvnSatelliteVerdict,
    AuasYearVerdictLabel,
    AuasFinalStatusLabel,
    AuasAvnCrossCheck,
    ClipResult,
    ClippedPolygonResult,
    ClippedPointResult,
    WfsFeature,
    WfsClipFetchResult,
    PersistedClipContextV1,
    LocalSimcarLayerSource,
    SatelliteMetadata,
    AiImage,
    GroqTextCallOptions,
    SimcarReportArtifact,
    SimcarReportImage,
} from "./types";

// ── Constantes ──
export {
    MODELO_ZIP_PATH,
    SIMCAR_LOCAL_SHAPES_ROOT,
    SEMA_CAR_REQUIRED_WFS_LAYER,
    WFS_MAX_FEATURES,
    CACHE_TTL_MS,
    CACHE_MAX_JOBS,
    CACHE_CLEANUP_INTERVAL,
    TEMPLATE_LAYERS,
    DIRECT_COPY_LAYERS,
    RIVER_CLIP_LAYERS,
    SPRING_LAYER_NAME,
    WHOLE_FEATURE_BUFFER_LAYERS,
    RIVER_CLIP_EXTENSION_METERS,
    SIMCAR_OPERATION_BILLING_MODEL,
    SEMA_WMS_BASE,
    SEMA_WMS_AUTHKEY,
    PUBLIC_API_BASE_URL,
    SPOT_LAYER,
    WMS_FETCH_RETRY_ATTEMPTS,
    WMS_RETRY_BASE_DELAY_MS,
    AC_AVN_FIXED_KEYS,
    ANALYSIS_VISION_MODELS,
    GROQ_TEXT_MODELS,
    SIMCAR_ANALYSIS_MODE,
    SIMCAR_CHAT_MAX_MESSAGES,
    SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE,
    SIMCAR_CHAT_MAX_TOTAL_CHARS,
    SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT,
    FORCE_AC_AVN_UNIFIED_ANALYSIS,
    GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS,
    GROQ_RATE_LIMIT_MIN_COOLDOWN_MS,
    GROQ_RATE_LIMIT_MAX_COOLDOWN_MS,
    GROQ_RATE_LIMIT_RETRY_BUFFER_MS,
    PNG_MAGIC,
    JPEG_MAGIC,
    CONTINUATION_INSTRUCTION,
    SIMCAR_REPORT_VERSION,
} from "./constants";

// ── Shapefile I/O ──
export {
    extractZipEntriesByExtension,
    readFullShapefile,
    getDbfRecordCount,
    readDbfRecord,
    bboxIntersects,
    featureBbox,
    ringsToFeature,
    parseUserShapefile,
    discoverLayerMapping,
} from "./shapefile-io";

// ── Polygon Operations ──
export {
    douglasPeucker,
    perpendicularDistance,
    simplifyGeometryForOverlay,
    isPointOrMultiPoint,
    pointInsidePolygon,
    pointInsideAnyPolygon,
    extractPointCoords,
    unionPolygonFeatures,
    unionPolygonGeometries,
    computeAreaHa,
} from "./polygon-ops";

// ── Attribute Mapping ──
export {
    readTemplateSchemas,
    mapAttributes,
    setMappedAttribute,
    applyLayerAttributeRules,
} from "./attribute-mapper";

// ── Area Calculation ──
export {
    dedupeWarnings,
    appendLayerWarning,
    inspectPropertyLayerConsistency,
    buildQuantitativeXlsx,
} from "./area-calculator";

// ── AIR/ATP Generator ──
export {
    applyAirIdentificacao,
    buildDirectCopyLayerRecords,
} from "./air-atp-generator";
export type { DirectCopyLayerResult } from "./air-atp-generator";

// ── Validation ──
export {
    validateShapefileOutput,
    buildLayerSummary,
    validateAreaConsistency,
} from "./validation";

// ── Cloudinary / Storage ──
export {
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
} from "./cloudinary";

// ── CAR Lookup ──
export { fetchCarBoundaryByNumber } from "./car-lookup";

// ── WFS Client ──
export {
    fetchWfsClipFeatures,
    fetchWfsIntersectsFeatures,
    fetchWfsBboxFeatures,
} from "./wfs-client";

// ── Clip Pipeline (SSE, job cache, utilities) ──
export {
    jobCache,
    pruneJobCache,
    ClientAbortError,
    isSseConnectionClosed,
    throwIfClientDisconnected,
    sendSSE,
    startSseHeartbeat,
    sleepMs,
} from "./clip-pipeline";

// ── Funções principais (ainda em ../simcar-clip — migração gradual) ──
export {
    CLIP_SNAP_TOLERANCE_METERS,
    snapClippedGeometryToBoundary,
    getFixedAcAvnSatelliteKeys,
    getSimcarAiRuntimeConfig,
    runAcAvnSatelliteAnalysis,
    registerSimcarClipRoutes,
} from "../simcar-clip";
