/**
 * Tipos do módulo SIMCAR — interfaces, type aliases e enums.
 * Extraídos de simcar-clip.ts (Plano 02).
 */
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

/* ─── Satellite ──────────────────────────────────── */

export type SatelliteMetadata = {
    sensor: string;
    spatialResolution: string;
    spectralBands: string;
    revisitDays: number;
    bestUseCase: string;
};

/* ─── Local shapes ───────────────────────────────── */

export type LocalSimcarLayerSource = {
    /** Nome da camada template (ex: "AREA_CONSOLIDADA") */
    templateLayer: string;
    /** Caminho absoluto do .shp no disco local */
    shpPath: string;
};

/* ─── WFS ────────────────────────────────────────── */

export type WfsFeature = {
    id?: string;
    geometry: Geometry | null;
    properties: Record<string, unknown>;
    bbox?: number[];
};

export type WfsClipFetchResult = {
    features: WfsFeature[];
    warnings: string[];
    partial: boolean;
    totalMatched?: number;
    numberReturned?: number;
};

/* ─── Clip results ───────────────────────────────── */

export type ClippedPolygonResult = {
    kind: "polygon" | "multipolygon";
    geometry: Polygon | MultiPolygon;
    properties: Record<string, unknown>;
};

export type ClippedPointResult = {
    kind: "point" | "multipoint";
    pointCoords: Array<[number, number]>;
    properties: Record<string, unknown>;
};

export type ClipResult = ClippedPolygonResult | ClippedPointResult;

/* ─── Job cache ──────────────────────────────────── */

export type LayerSummary = {
    name: string;
    source: "property" | "wfs";
    features: number;
    areaHa?: number;
    warning?: string;
    partial?: boolean;
};

export type CachedJob = {
    uid?: string;
    buffer?: Buffer;
    expiresAt: number;
    filename: string;
    bbox?: [number, number, number, number];
    polygon?: Feature<Polygon | MultiPolygon>;
    layerSummaries?: LayerSummary[];
    areaHa?: number;
    clippedGeometries?: Map<string, Geometry[]>;
    inputZipUrl?: string;
    outputZipUrl?: string;
    contextJsonUrl?: string;
    warnings?: string[];
    propertySourceLayer?: "ATP" | "AIR";
};

export type PersistedClipContextV1 = {
    version: 1;
    jobId: string;
    savedAtIso: string;
    filename: string;
    bbox: [number, number, number, number];
    polygon: Feature<Polygon | MultiPolygon>;
    layerSummaries: LayerSummary[];
    areaHa: number;
    clippedGeometries: Record<string, Geometry[]>;
    inputZipUrl?: string;
    outputZipUrl?: string;
    warnings?: string[];
    propertySourceLayer?: "ATP" | "AIR";
};

/* ─── AI Image ───────────────────────────────────── */

export type AiImage = {
    /** URL for Groq vision (compressed 800×600 JPEG). */
    url?: string;
    /** Base64 data URL used when Cloudinary is unavailable. */
    dataUrl?: string;
    cloudinaryUrl?: string;
    mimeType?: "image/png" | "image/jpeg";
    caption: string;
};

export type GroqTextCallOptions = {
    model?: string;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    reasoningEffort?: "none" | "low" | "medium" | "high";
};

/* ─── AC/AVN verdicts ────────────────────────────── */

export type AcAvnVerdict = "SIM" | "NAO" | "INCONCLUSIVO" | null;
export type AcAvnConfidence = "ALTA" | "MEDIA" | "BAIXA" | "INCONCLUSIVO";
export type AcAvnSatelliteInfo = { key: string; label: string; year: number; status: "used" | "missing" };

export type AcAvnSatelliteVerdict = {
    key: string;
    label: string;
    year: number;
    status: "used" | "missing";
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    confidence: AcAvnConfidence;
};

export type AcAvnAuasContext = {
    hasAuasLayer: boolean;
    hasAvnLayer: boolean;
    auasAreaHa: number;
    avnAreaHa: number;
    overlapAreaHa: number;
    overlapPctOfAuas: number;
    overlapPctOfAvn: number;
    auasOutsideAvnAreaHa: number;
    auasOutsideAvnPct: number;
};

export type AcAvnAnalysisMeta = {
    globalVerdict: {
        acForaShape: AcAvnVerdict;
        avnDentroShapeAntropizado: AcAvnVerdict;
        avnParcialForaShapeMasEmAuas: AcAvnVerdict;
        confidence: AcAvnConfidence;
    };
    satelliteVerdicts: AcAvnSatelliteVerdict[];
    coherence: {
        isCoherent: boolean;
        notes: string[];
    };
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
    auasContext?: AcAvnAuasContext | null;
    /** Conferência geométrica do achado "uso dentro da AVN": interseção real
     * AC∩AVN e AVN∩reservatório medidas no shape do recorte. Quando a IA diz
     * SIM mas aqui dá 0, o achado visual precisa de revisão (tipicamente
     * confusão com reservatório/água) — o laudo declara isso explicitamente. */
    geometryCrossCheck?: {
        acAvnOverlapHa: number;
        avnAreaHa: number;
        acAreaHa: number;
        reservatorioOverlapAvnHa: number;
        hasReservatorioLayer: boolean;
    } | null;
    /** Análise dos reservatórios artificiais do recorte — lâmina d'água,
     * sobreposição com AC/AUAS/AVN e enquadramento legal (Lei 12.651/2012,
     * art. 4º III, §1º e §4º). */
    reservoirAnalysis?: {
        hasReservoir: boolean;
        totalFeatures: number;
        totalAreaHa: number;
        overlapAcHa: number;
        overlapAuasHa: number;
        overlapAvnHa: number;
        outsideDeclaredHa: number;
        pctOfProperty: number;
        minFeatureHa: number;
        maxFeatureHa: number;
    } | null;
};

export type AcAvnAnalysisResult = {
    analysisText: string;
    cloudinaryUrls: Array<{ url: string; caption: string }>;
    cloudinaryStoredBytes: number;
    usedSatelliteKeys: string[];
    missingSatelliteKeys: string[];
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
    analysisMeta: AcAvnAnalysisMeta;
    layerSummaries: LayerSummary[];
    imageOnly: boolean;
};

/* ─── AUAS ───────────────────────────────────────── */

export type AuasYearVerdictLabel =
    | "CONSOLIDADO"
    | "VEGETACAO_NATIVA_PRESENTE"
    | "DESMATAMENTO_RECENTE"
    | "INCONCLUSIVO";

export type AuasFinalStatusLabel =
    | "AUAS_VALIDA"
    | "AUAS_INVALIDA"
    | "AUAS_PARCIAL";

export type AuasAvnCrossCheck = {
    auasAreaHa: number;
    avnAreaHa: number;
    overlapAreaHa: number;
    overlapPctOfAuas: number;
    overlapPctOfAvn: number;
    hasAuasOverlapAvn: boolean;
};

export type SimcarReportImage = { url: string; caption: string };
