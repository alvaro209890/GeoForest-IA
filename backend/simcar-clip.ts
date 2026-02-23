/**
 * SIMCAR Clip — Automated clipping of SEMA-MT SIMCAR WFS layers
 * to the geometry of a user-provided property polygon.
 *
 * Registers endpoints:
 *   POST /api/simcar/clip          — SSE stream (progress + result)
 *   GET  /api/simcar/clip/download/:jobId — Download final ZIP
 *   POST /api/simcar/clip/analyze   — SSE stream (AI analysis of clips)
 *   GET  /api/simcar/gemini/config  — Runtime Gemini config (+ optional probe)
 */
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import archiver from "archiver";
import proj4 from "proj4";
import ExcelJS from "exceljs";
import sharp from "sharp";
import {
    area as turfArea,
    featureCollection as turfFeatureCollection,
    intersect as turfIntersect,
    polygon as turfPolygon,
    multiPolygon as turfMultiPolygon,
    union as turfUnion,
    buffer as turfBuffer,
} from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    Geometry,
    MultiPolygon,
    Polygon,
} from "geojson";
import { fileURLToPath } from "url";

// Internal modules
import { extractZipEntries, detectUtmProj } from "./geo-utils";
import {
    buildWfsUrl,
    fetchJsonWithTimeout,
    fetchTextWithTimeout,
    getCapabilitiesCached,
    getGeometryFieldForLayer,
    polygonToWkt,
    normalizePolygonGeometry,
    toPolygonOrMultiFeature,
    WFS_TIMEOUT_MS,
    WFS_PAGE_SIZE,
    type SupportedPolygonGeometry,
} from "./wfs-intersection";
import {
    parseDbfSchema,
    buildShpAndShx,
    buildDbfBuffer,
    geojsonToShpRings,
    type DbfFieldDef,
    type ShpRecord,
} from "./shapefile-writer";
import {
    BillingError,
    buildUsageFromGemini,
    buildUsageFromGroq,
    createRequestId,
    estimateCloudinaryStorageReserve,
    estimateImageTokens,
    estimateReserveForModels,
    estimateTokensFromMessages,
    estimateTokensFromText,
    getBillingUsageSessionRecords,
    recordModelUsage,
    refundReserve,
    reserveCredits,
    runWithBillingUsageSession,
    settleCloudinaryStorageReserve,
    settleReservedCredits,
} from "./billing";
import { adminAuth, isFirebaseConfigError } from "./firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Constants ──────────────────────────────────────────────── */

const MODELO_ZIP_PATH = path.resolve(__dirname, "..", "Arquivo Modelo.zip");
const WFS_MAX_FEATURES = 50000;
const CACHE_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const CACHE_MAX_JOBS = 10;
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/* ——— Dynamic Image Resolution ———————————————————————— */

/**
 * Calculate optimal image dimensions based on property area.
 * Larger properties need more pixels to capture detail;
 * smaller properties can use lower resolution to save bandwidth/tokens.
 *
 * Returns { width, height } capped between 800×600 and 2400×1800.
 */
function calculateDynamicResolution(
    areaHa: number,
    bbox: [number, number, number, number],
): { width: number; height: number } {
    // Compute aspect ratio from bbox
    const bboxWidth = Math.abs(bbox[2] - bbox[0]);
    const bboxHeight = Math.abs(bbox[3] - bbox[1]);
    const aspect = bboxWidth > 0 && bboxHeight > 0 ? bboxWidth / bboxHeight : 4 / 3;

    // Base resolution: scale with log of area
    // < 50 ha → 800×600, ~500 ha → 1200×900, >5000 ha → 2000×1500, >20000 ha → 2400×1800
    let baseWidth: number;
    if (areaHa <= 50) {
        baseWidth = 800;
    } else if (areaHa <= 200) {
        baseWidth = 900;
    } else if (areaHa <= 500) {
        baseWidth = 1200;
    } else if (areaHa <= 2000) {
        baseWidth = 1600;
    } else if (areaHa <= 5000) {
        baseWidth = 2000;
    } else {
        baseWidth = 2400;
    }

    // Adjust height based on aspect ratio
    let height = Math.round(baseWidth / aspect);

    // Clamp to reasonable bounds
    baseWidth = Math.min(2400, Math.max(800, baseWidth));
    height = Math.min(1800, Math.max(600, height));

    return { width: baseWidth, height };
}

/* ——— Dynamic WMS Timeout ————————————————————————————— */

/**
 * Calculate WMS fetch timeout based on image size.
 * Larger images take longer to render server-side.
 * Range: 15s (small) to 90s (very large).
 */
function calculateWmsTimeout(width: number, height: number): number {
    const pixels = width * height;
    if (pixels <= 800 * 600) return 15_000;        // 480K px → 15s
    if (pixels <= 1200 * 900) return 30_000;        // 1.08M px → 30s
    if (pixels <= 1600 * 1200) return 45_000;       // 1.92M px → 45s
    if (pixels <= 2000 * 1500) return 60_000;       // 3.0M px → 60s
    return 90_000;                                   // > 3M px → 90s
}

/* ——— Satellite Metadata ————————————————————————————— */

type SatelliteMetadata = {
    sensor: string;
    spatialResolution: string;
    spectralBands: string;
    revisitDays: number;
    bestUseCase: string;
};

const SATELLITE_METADATA: Record<string, SatelliteMetadata> = {
    spot: {
        sensor: "SPOT HRV",
        spatialResolution: "2.5m (pancromático) / 10m (multiespectral)",
        spectralBands: "Pan, Verde, Vermelho, NIR",
        revisitDays: 26,
        bestUseCase: "Alta resolução para detalhamento de bordas e pequenas feições",
    },
    landsat5: {
        sensor: "Landsat 5 TM",
        spatialResolution: "30m (multiespectral) / 120m (térmico)",
        spectralBands: "Azul, Verde, Vermelho, NIR, SWIR-1, Térmico, SWIR-2",
        revisitDays: 16,
        bestUseCase: "Série histórica longa (1984-2011), ideal para análise multitemporal pré-marco",
    },
    landsat8: {
        sensor: "Landsat 8 OLI/TIRS",
        spatialResolution: "30m (multiespectral) / 15m (pan) / 100m (térmico)",
        spectralBands: "Coastal, Azul, Verde, Vermelho, NIR, SWIR-1, SWIR-2, Pan, Cirrus, TIR-1, TIR-2",
        revisitDays: 16,
        bestUseCase: "Continuidade Landsat com melhor radiometria, pós-2013",
    },
    sentinel2: {
        sensor: "Sentinel-2 MSI",
        spatialResolution: "10m (VNIR) / 20m (Red Edge, SWIR) / 60m (atmosféricos)",
        spectralBands: "13 bandas: Coastal, Azul, Verde, Vermelho, 3×Red Edge, NIR, Water Vapour, SWIR-1, SWIR-2",
        revisitDays: 5,
        bestUseCase: "Melhor resolução espacial e temporal para monitoramento recente (pós-2016)",
    },
};

function getSatelliteFamily(key: string): string {
    if (key.startsWith("sentinel2")) return "sentinel2";
    if (key.startsWith("landsat8")) return "landsat8";
    if (key.startsWith("landsat5")) return "landsat5";
    return "spot";
}

function getSatelliteMetadata(key: string): SatelliteMetadata {
    return SATELLITE_METADATA[getSatelliteFamily(key)] || SATELLITE_METADATA.spot;
}

/* ——— Cloud/Occlusion Detection ————————————————————— */

/**
 * Analyze an image buffer to detect potential cloud cover or occlusion.
 * Uses pixel statistics with spatial analysis: clouds are bright (high luminance),
 * low-contrast, and spatially homogeneous. Also detects cloud shadows.
 * Returns a score 0-1 where >0.5 indicates likely cloud/occlusion.
 */
async function detectCloudCover(imageBuffer: Buffer): Promise<{
    cloudScore: number;
    isLikelyCloudy: boolean;
    brightPixelRatio: number;
    contrastScore: number;
}> {
    try {
        // Resize to small thumbnail for fast analysis
        const { data, info } = await sharp(imageBuffer)
            .resize(100, 75, { fit: "cover" })
            .raw()
            .toBuffer({ resolveWithObject: true });

        const w = info.width;
        const h = info.height;
        const totalPixels = w * h;
        const channels = info.channels;
        let brightCount = 0;
        let darkCount = 0;
        let luminanceSum = 0;
        let luminanceSqSum = 0;

        // Build luminance grid for spatial analysis
        const lumGrid: number[] = new Array(totalPixels);

        for (let i = 0; i < totalPixels; i++) {
            const offset = i * channels;
            const r = data[offset];
            const g = data[offset + 1];
            const b = data[offset + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            lumGrid[i] = lum;
            luminanceSum += lum;
            luminanceSqSum += lum * lum;

            if (lum > 220) brightCount++;  // Very bright → cloud candidate
            if (lum < 30) darkCount++;     // Very dark → shadow/no data
        }

        const meanLum = luminanceSum / totalPixels;
        const variance = (luminanceSqSum / totalPixels) - (meanLum * meanLum);
        const stdDev = Math.sqrt(Math.max(0, variance));

        // Bright pixel ratio — lowered threshold from 0.3 to 0.25 for earlier detection
        const brightPixelRatio = brightCount / totalPixels;
        // Contrast score (low contrast = more likely clouds)
        const contrastScore = Math.min(1, stdDev / 60);
        // Dark pixel ratio (shadows/no-data)
        const darkPixelRatio = darkCount / totalPixels;

        // Spatial homogeneity: compute local variance in 5×5 windows.
        // Clouds tend to have low local variance in contiguous blocks.
        let homogeneousBlockCount = 0;
        let totalBlocks = 0;
        const winSize = 5;
        for (let y = 0; y <= h - winSize; y += winSize) {
            for (let x = 0; x <= w - winSize; x += winSize) {
                let wSum = 0;
                let wSqSum = 0;
                const wPixels = winSize * winSize;
                for (let dy = 0; dy < winSize; dy++) {
                    for (let dx = 0; dx < winSize; dx++) {
                        const l = lumGrid[(y + dy) * w + (x + dx)];
                        wSum += l;
                        wSqSum += l * l;
                    }
                }
                const wMean = wSum / wPixels;
                const wVar = (wSqSum / wPixels) - (wMean * wMean);
                // Bright block with very low variance → likely cloud
                if (wMean > 190 && wVar < 100) homogeneousBlockCount++;
                totalBlocks++;
            }
        }
        const homogeneousRatio = totalBlocks > 0 ? homogeneousBlockCount / totalBlocks : 0;

        // Shadow detection: bright pixels adjacent to very dark pixels may indicate cloud shadows
        let shadowAdjacencyCount = 0;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                if (lumGrid[idx] > 200) {
                    // Check 4-connected neighbors for very dark pixels (shadow)
                    const hasAdjacentDark =
                        lumGrid[idx - 1] < 40 || lumGrid[idx + 1] < 40 ||
                        lumGrid[idx - w] < 40 || lumGrid[idx + w] < 40;
                    if (hasAdjacentDark) shadowAdjacencyCount++;
                }
            }
        }
        const shadowRatio = shadowAdjacencyCount / Math.max(1, totalPixels);

        // Cloud score: high if lots of bright pixels AND low contrast
        let cloudScore = 0;
        if (brightPixelRatio > 0.25) {
            cloudScore += brightPixelRatio * 0.35;
        }
        if (contrastScore < 0.3) {
            cloudScore += (1 - contrastScore) * 0.25;
        }
        if (meanLum > 180) {
            cloudScore += ((meanLum - 180) / 75) * 0.15;
        }
        // Spatial homogeneity bonus — clouds form contiguous bright blocks
        if (homogeneousRatio > 0.15) {
            cloudScore += homogeneousRatio * 0.15;
        }
        // Shadow adjacency bonus — bright-dark transitions indicate cloud edges
        if (shadowRatio > 0.005) {
            cloudScore += Math.min(0.10, shadowRatio * 10);
        }
        // Penalize if too much dark area (shadows dominating, not clouds)
        if (darkPixelRatio > 0.4) {
            cloudScore *= 0.5;
        }

        cloudScore = Math.min(1, Math.max(0, cloudScore));

        return {
            cloudScore: Number(cloudScore.toFixed(3)),
            isLikelyCloudy: cloudScore > 0.45,
            brightPixelRatio: Number(brightPixelRatio.toFixed(3)),
            contrastScore: Number(contrastScore.toFixed(3)),
        };
    } catch {
        // If analysis fails, assume no clouds (don't block analysis)
        return { cloudScore: 0, isLikelyCloudy: false, brightPixelRatio: 0, contrastScore: 1 };
    }
}

/* ——— Geometry Simplification ———————————————————————— */

/**
 * Simplify a polygon geometry if it has too many vertices.
 * Uses Douglas-Peucker with tolerance proportional to polygon extent.
 * This reduces SVG overlay complexity and token usage in prompts.
 */
function simplifyGeometryForOverlay(
    geom: Geometry,
    maxVertices = 500,
): Geometry {
    const countVertices = (g: Geometry): number => {
        if (g.type === "Polygon") {
            return (g.coordinates as number[][][]).reduce((s, r) => s + r.length, 0);
        }
        if (g.type === "MultiPolygon") {
            return (g.coordinates as number[][][][]).reduce(
                (s, poly) => s + poly.reduce((s2, r) => s2 + r.length, 0), 0,
            );
        }
        return 0;
    };

    const vertices = countVertices(geom);
    if (vertices <= maxVertices) return geom;

    // Calculate tolerance from geometry extent
    const simplifyRing = (ring: number[][], tolerance: number): number[][] => {
        if (ring.length <= 4) return ring;
        // Douglas-Peucker simplified
        const simplified = douglasPeucker(ring, tolerance);
        // Ensure ring is closed
        if (simplified.length >= 3) {
            const first = simplified[0];
            const last = simplified[simplified.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                simplified.push([first[0], first[1]]);
            }
        }
        return simplified.length >= 4 ? simplified : ring;
    };

    // Compute a reasonable tolerance
    let allCoords: number[][] = [];
    if (geom.type === "Polygon") {
        allCoords = (geom.coordinates as number[][][]).flat();
    } else if (geom.type === "MultiPolygon") {
        allCoords = (geom.coordinates as number[][][][]).flat(2);
    }
    if (allCoords.length === 0) return geom;

    const xs = allCoords.map(c => c[0]);
    const ys = allCoords.map(c => c[1]);
    const extent = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
    );
    // Tolerance: ~0.01% of extent for light simplification
    const ratio = Math.max(1, vertices / maxVertices);
    const tolerance = extent * 0.0001 * ratio;

    if (geom.type === "Polygon") {
        return {
            type: "Polygon",
            coordinates: (geom.coordinates as number[][][]).map(ring => simplifyRing(ring, tolerance)),
        };
    }
    if (geom.type === "MultiPolygon") {
        return {
            type: "MultiPolygon",
            coordinates: (geom.coordinates as number[][][][]).map(
                poly => poly.map(ring => simplifyRing(ring, tolerance)),
            ),
        };
    }
    return geom;
}

/**
 * Douglas-Peucker line simplification algorithm.
 */
function douglasPeucker(points: number[][], tolerance: number): number[][] {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
        const right = douglasPeucker(points.slice(maxIdx), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

function perpendicularDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const lineLenSq = dx * dx + dy * dy;
    if (lineLenSq === 0) {
        const pdx = point[0] - lineStart[0];
        const pdy = point[1] - lineStart[1];
        return Math.sqrt(pdx * pdx + pdy * pdy);
    }
    const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lineLenSq));
    const projX = lineStart[0] + t * dx;
    const projY = lineStart[1] + t * dy;
    const distX = point[0] - projX;
    const distY = point[1] - projY;
    return Math.sqrt(distX * distX + distY * distY);
}

/* 28 layers from the Arquivo Modelo */
const TEMPLATE_LAYERS = [
    "AIR", "ATP",
    "AREA_CONSOLIDADA", "AREA_USO_RESTRITO", "INTERESSE_SOCIAL", "UTILIDADE_PUBLICA",
    "RIO_ATE_10", "RIO_10_A_50", "RIO_50_A_200", "RIO_200_A_600", "RIO_ACIMA_600",
    "NASCENTE", "RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL",
    "TIPOLOGIA_VEGETAL", "MANGUEZAL", "RESTINGA", "VEREDA",
    "AREA_ALTITUDE_1800", "AREA_DECLIVIDADE", "AREA_TOPO_MORRO", "BORDA_CHAPADA",
    "ARL", "ARLREM", "AUAS", "AURD", "AVN", "AREA_UMIDA",
] as const;

/** Layers that receive the property polygon directly (no WFS query). */
const DIRECT_COPY_LAYERS = new Set(["AIR", "ATP"]);

/* ─── Job Cache ──────────────────────────────────────────────── */

export type CachedJob = {
    buffer?: Buffer;
    expiresAt: number;
    filename: string;
    /** Retained for AI analysis */
    bbox?: [number, number, number, number];
    polygon?: Feature<Polygon | MultiPolygon>;
    layerSummaries?: LayerSummary[];
    areaHa?: number;
    /** Clipped GeoJSON geometries per layer name (for SVG rendering) */
    clippedGeometries?: Map<string, Geometry[]>;
    /** Cloudinary URLs for persisted download */
    inputZipUrl?: string;
    outputZipUrl?: string;
    contextJsonUrl?: string;
};
const jobCache = new Map<string, CachedJob>();

const SIMCAR_OPERATION_BILLING_MODEL = "openai/gpt-oss-20b";

function pruneJobCache() {
    const now = Date.now();
    for (const [key, entry] of jobCache.entries()) {
        if (entry.expiresAt <= now) jobCache.delete(key);
    }
    while (jobCache.size > CACHE_MAX_JOBS) {
        const oldest = jobCache.keys().next().value as string | undefined;
        if (!oldest) break;
        jobCache.delete(oldest);
    }
}

setInterval(pruneJobCache, CACHE_CLEANUP_INTERVAL).unref();

/* ─── SSE Helpers ────────────────────────────────────────────── */

function sendSSE(res: Response, data: Record<string, unknown>) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush if available (for proxied/streamed connections)
    if (typeof (res as any).flush === "function") (res as any).flush();
}

class ClientAbortError extends Error {
    constructor(message = "Cliente desconectou durante a análise.") {
        super(message);
        this.name = "ClientAbortError";
    }
}

function isSseConnectionClosed(res: Response): boolean {
    const anyRes = res as any;
    return Boolean(
        res.writableEnded ||
        res.destroyed ||
        anyRes?.writableAborted ||
        anyRes?.socket?.destroyed,
    );
}

function throwIfClientDisconnected(res: Response): void {
    if (isSseConnectionClosed(res)) {
        throw new ClientAbortError();
    }
}

/* ─── Shapefile Parsing ──────────────────────────────────────── */

/**
 * Read ALL polygon records from a .shp buffer.
 * Returns an array of polygon rings (one per record, outer + holes).
 */
function readFullShapefile(shpBuffer: Buffer): number[][][][] {
    const polygons: number[][][][] = [];
    if (shpBuffer.length < 100) return polygons;

    let offset = 100; // skip header
    while (offset + 12 <= shpBuffer.length) {
        const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
        const contentLengthBytes = contentLengthWords * 2;
        const recStart = offset + 8;
        const recEnd = recStart + contentLengthBytes;
        if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

        const shapeType = shpBuffer.readInt32LE(recStart);
        // Polygon=5, PolygonZ=15, PolygonM=25
        if ((shapeType === 5 || shapeType === 15 || shapeType === 25) && contentLengthBytes >= 44) {
            const numParts = shpBuffer.readInt32LE(recStart + 36);
            const numPoints = shpBuffer.readInt32LE(recStart + 40);
            if (numParts > 0 && numPoints > 2) {
                const partsOffset = recStart + 44;
                const pointsOffset = partsOffset + numParts * 4;
                if (pointsOffset + numPoints * 16 <= recEnd) {
                    const partIndices: number[] = [];
                    for (let p = 0; p < numParts; p++) {
                        partIndices.push(shpBuffer.readInt32LE(partsOffset + p * 4));
                    }
                    partIndices.push(numPoints);

                    const rings: number[][][] = [];
                    for (let p = 0; p < numParts; p++) {
                        const ring: number[][] = [];
                        for (let i = partIndices[p]; i < partIndices[p + 1]; i++) {
                            const pOff = pointsOffset + i * 16;
                            const x = shpBuffer.readDoubleLE(pOff);
                            const y = shpBuffer.readDoubleLE(pOff + 8);
                            if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
                        }
                        if (ring.length >= 3) rings.push(ring);
                    }
                    if (rings.length > 0) polygons.push(rings);
                }
            }
        }
        offset = recEnd;
    }
    return polygons;
}

/**
 * Parse user's shapefile ZIP → single unified polygon in EPSG:4674.
 */
export function parseUserShapefile(zipBuffer: Buffer): {
    polygon: Feature<Polygon | MultiPolygon>;
    geometry: SupportedPolygonGeometry;
    areaHa: number;
} {
    const entries = extractZipEntries(zipBuffer);
    const shpEntry = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
    const prjEntry = entries.find((e) => e.name.toLowerCase().endsWith(".prj"));

    if (!shpEntry) throw new Error("ZIP não contém arquivo .shp válido.");

    const allPolygons = readFullShapefile(shpEntry.data);
    if (!allPolygons.length) throw new Error("Shapefile não contém polígonos válidos.");

    // Detect CRS from .prj and reproject if needed
    let needsReproject = false;
    let projDef: string | null = null;
    if (prjEntry) {
        const prjText = prjEntry.data.toString("utf8");
        projDef = detectUtmProj(prjText);
        if (projDef) {
            needsReproject = true;
        } else {
            // Check if it's already SIRGAS 2000 / EPSG:4674 or WGS84
            const upper = prjText.toUpperCase();
            if (upper.includes("SIRGAS") || upper.includes("4674")) {
                needsReproject = false;
            } else if (upper.includes("WGS") && upper.includes("84")) {
                // WGS84 ≈ EPSG:4674 for practical purposes
                needsReproject = false;
            }
        }
    }

    // Reproject all rings if needed
    let processedPolygons = allPolygons;
    if (needsReproject && projDef) {
        processedPolygons = allPolygons.map((rings) =>
            rings.map((ring) =>
                ring.map(([x, y]) => {
                    const [lon, lat] = proj4(projDef!, "EPSG:4326", [x, y]) as [number, number];
                    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : [x, y];
                }),
            ),
        );
    }

    // Build turf features and union them
    const features: Feature<Polygon | MultiPolygon>[] = [];
    for (const rings of processedPolygons) {
        try {
            // Ensure rings are closed
            const closedRings = rings.map((ring) => {
                if (ring.length < 3) return ring;
                const first = ring[0];
                const last = ring[ring.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) {
                    return [...ring, [first[0], first[1]]];
                }
                return ring;
            });
            if (closedRings[0] && closedRings[0].length >= 4) {
                features.push(turfPolygon(closedRings));
            }
        } catch {
            // Skip invalid polygons
        }
    }

    if (!features.length) throw new Error("Nenhum polígono válido encontrado no Shapefile.");

    // Union all polygons into one
    let unified: Feature<Polygon | MultiPolygon> = features[0];
    for (let i = 1; i < features.length; i++) {
        try {
            const fc = turfFeatureCollection([unified, features[i]]) as FeatureCollection<Polygon | MultiPolygon>;
            const u = turfUnion(fc);
            if (u) unified = u as Feature<Polygon | MultiPolygon>;
        } catch {
            // Keep partial union
        }
    }

    // Fix self-intersections via buffer(0)
    try {
        const buffered = turfBuffer(unified, 0, { units: "meters" });
        if (buffered) unified = buffered as Feature<Polygon | MultiPolygon>;
    } catch {
        // If buffer(0) fails, keep as-is
    }

    const geometry = normalizePolygonGeometry(unified.geometry);
    if (!geometry) throw new Error("Geometria do imóvel não pôde ser validada.");

    const areaHa = Number((turfArea(unified) / 10000).toFixed(4));

    return { polygon: unified, geometry, areaHa };
}

/* ─── Layer Name Mapping (Template → WFS) ────────────────────── */

function discoverLayerMapping(
    templateLayers: readonly string[],
    wfsLayerNames: string[],
): Map<string, string> {
    const mapping = new Map<string, string>();
    const wfsLower = new Map(wfsLayerNames.map((n) => [n.toLowerCase(), n]));

    for (const tmpl of templateLayers) {
        if (DIRECT_COPY_LAYERS.has(tmpl)) continue;

        const lower = tmpl.toLowerCase();

        // SEMA-MT WFS uses "Geoportal:SIMCAR_D_<name>" for SIMCAR Digital layers
        // Also try SIMCAR_CAR_, CAR_, and bare name patterns
        const candidates = [
            `geoportal:simcar_d_${lower}`,       // Most common: SIMCAR Digital layers
            `geoportal:simcar_${lower}`,          // Some layers use SIMCAR_ without D_
            `geoportal:simcar_car_${lower}`,      // Some validated CAR layers
            `geoportal:car_${lower}`,             // CAR namespace
            `geoportal:${lower}`,                 // Bare name
            `semamt:simcar_d_${lower}`,
            `semamt:simcar_${lower}`,
            `semamt:${lower}`,
        ];

        // Handle special template name remappings
        const aliasMap: Record<string, string[]> = {
            "vereda": ["simcar_d_veredas", "simcar_d_vereda"],
            "area_uso_restrito": ["simcar_d_area_uso_restrito", "areas_uso_restrito"],
            "area_altitude_1800": ["simcar_d_area_altitude_1800", "simcar_d_altitude_1800"],
            "rio_acima_600": ["simcar_d_rio_acima_600", "simcar_d_rio_maior_600"],
            "arlrem": ["simcar_d_arlrem", "simcar_arld", "simcar_d_arld"],
        };
        const aliases = aliasMap[lower] || [];
        for (const alias of aliases) {
            candidates.push(`geoportal:${alias}`);
        }

        let matched = false;
        for (const candidate of candidates) {
            const found = wfsLower.get(candidate);
            if (found) {
                mapping.set(tmpl, found);
                matched = true;
                break;
            }
        }

        // Fallback: fuzzy — find a WFS layer whose suffix matches SIMCAR_D_<name> or just <name>
        if (!matched) {
            for (const [wfsLow, wfsOriginal] of wfsLower) {
                const wfsSuffix = (wfsLow.split(":")[1] || wfsLow).toLowerCase();
                if (
                    wfsSuffix === `simcar_d_${lower}` ||
                    wfsSuffix === `simcar_${lower}` ||
                    wfsSuffix === `simcar_car_${lower}` ||
                    wfsSuffix === `car_${lower}` ||
                    wfsSuffix === lower
                ) {
                    mapping.set(tmpl, wfsOriginal);
                    matched = true;
                    break;
                }
            }
        }

        // Last resort: partial match — WFS layer ending with _<TEMPLATE_NAME>
        if (!matched) {
            for (const [wfsLow, wfsOriginal] of wfsLower) {
                const wfsSuffix = (wfsLow.split(":")[1] || wfsLow).toLowerCase();
                if (wfsSuffix.endsWith(`_${lower}`) && wfsSuffix.includes("simcar")) {
                    mapping.set(tmpl, wfsOriginal);
                    break;
                }
            }
        }
    }

    console.log("[SIMCAR CLIP] Layer mapping results:");
    for (const [tmpl, wfs] of mapping) {
        console.log(`  ${tmpl} -> ${wfs}`);
    }

    return mapping;
}

/* ─── WFS Feature Fetching with Attributes ───────────────────── */

type WfsFeature = {
    geometry: Geometry | null;
    properties: Record<string, unknown>;
};

async function fetchWfsClipFeatures(
    wfsLayerName: string,
    polygonWkt: string,
    srsName: string = "EPSG:4674",
): Promise<WfsFeature[]> {
    const geometryField = await getGeometryFieldForLayer(wfsLayerName);
    const cqlFilter = `INTERSECTS(${geometryField},${polygonWkt})`;
    const allFeatures: WfsFeature[] = [];
    let startIndex = 0;
    let usedFallback = false;

    while (allFeatures.length < WFS_MAX_FEATURES) {
        const pageSize = Math.min(WFS_PAGE_SIZE, WFS_MAX_FEATURES - allFeatures.length);
        if (pageSize <= 0) break;

        const url = buildWfsUrl({
            service: "WFS",
            version: "2.0.0",
            request: "GetFeature",
            typeNames: wfsLayerName,
            outputFormat: "application/json",
            srsName,
            startIndex: usedFallback ? undefined : startIndex,
            count: pageSize,
            CQL_FILTER: cqlFilter,
        });

        let page: any;
        try {
            page = await fetchJsonWithTimeout<any>(url, WFS_TIMEOUT_MS);
        } catch (error: any) {
            const msg = String(error?.message || "");
            if (
                (/natural order without a primary key/i.test(msg) || /WFS 400/i.test(msg)) &&
                !usedFallback
            ) {
                // Retry without startIndex
                usedFallback = true;
                const fallbackUrl = buildWfsUrl({
                    service: "WFS",
                    version: "2.0.0",
                    request: "GetFeature",
                    typeNames: wfsLayerName,
                    outputFormat: "application/json",
                    srsName,
                    count: Math.min(WFS_MAX_FEATURES, WFS_PAGE_SIZE),
                    CQL_FILTER: cqlFilter,
                });
                page = await fetchJsonWithTimeout<any>(fallbackUrl, WFS_TIMEOUT_MS);
            } else {
                throw error;
            }
        }

        const features = Array.isArray(page?.features) ? page.features : [];
        if (!features.length) break;

        for (const f of features) {
            allFeatures.push({
                geometry: f.geometry || null,
                properties: f.properties || {},
            });
        }

        startIndex += features.length;
        if (usedFallback) break;
        if (features.length < pageSize) break;
    }

    return allFeatures;
}

/* ─── Feature Clipping ───────────────────────────────────────── */

function clipFeaturesToPolygon(
    features: WfsFeature[],
    userPolygon: Feature<Polygon | MultiPolygon>,
): Array<{ geometry: Geometry; properties: Record<string, unknown> }> {
    const clipped: Array<{ geometry: Geometry; properties: Record<string, unknown> }> = [];

    for (const feature of features) {
        const polygonLike = toPolygonOrMultiFeature(feature.geometry);
        if (!polygonLike) continue;

        try {
            const fc = turfFeatureCollection([userPolygon, polygonLike]) as FeatureCollection<Polygon | MultiPolygon>;
            const intersection = turfIntersect(fc);
            if (intersection && intersection.geometry) {
                clipped.push({
                    geometry: intersection.geometry,
                    properties: feature.properties,
                });
            }
        } catch {
            // Skip features that fail intersection
        }
    }

    return clipped;
}

/* ─── Template Schema Extraction ─────────────────────────────── */

function readTemplateSchemas(
    modeloEntries: Array<{ name: string; data: Buffer }>,
): Map<string, DbfFieldDef[]> {
    const schemas = new Map<string, DbfFieldDef[]>();

    for (const entry of modeloEntries) {
        if (!entry.name.toLowerCase().endsWith(".dbf")) continue;
        const baseName = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
        try {
            const fields = parseDbfSchema(entry.data);
            if (fields.length > 0) {
                schemas.set(baseName, fields);
            }
        } catch {
            // Skip unparseable DBFs
        }
    }

    return schemas;
}

/* ─── Attribute Mapping ──────────────────────────────────────── */

function mapAttributes(
    properties: Record<string, unknown>,
    targetFields: DbfFieldDef[],
): Record<string, string | number | null> {
    const mapped: Record<string, string | number | null> = {};
    const propsLower = new Map(
        Object.entries(properties).map(([k, v]) => [k.toLowerCase(), v]),
    );

    for (const field of targetFields) {
        const value = propsLower.get(field.name.toLowerCase());
        if (value === undefined || value === null) {
            mapped[field.name] = null;
        } else if (field.type === "N" || field.type === "F") {
            const num = Number(value);
            mapped[field.name] = Number.isFinite(num) ? num : null;
        } else if (field.type === "D") {
            mapped[field.name] = String(value);
        } else {
            mapped[field.name] = String(value);
        }
    }

    return mapped;
}

/* ─── ZIP Output Builder ─────────────────────────────────────── */

async function buildOutputZip(
    templateEntries: Array<{ name: string; data: Buffer }>,
    clippedLayers: Map<string, { records: ShpRecord[]; fieldDefs: DbfFieldDef[] }>,
    prjBuffers: Map<string, Buffer>,
    xlsxBuffer?: Buffer,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 6 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve(Buffer.concat(chunks)));

        // Determine which layers have generated data
        const generatedLayers = new Set<string>();
        for (const [layerName] of clippedLayers) {
            generatedLayers.add(layerName.toUpperCase());
        }

        // Add template entries, replacing .shp/.shx/.dbf for layers with data
        const handledFiles = new Set<string>();

        for (const [layerName, layerData] of clippedLayers) {
            const upper = layerName.toUpperCase();
            const { shp, shx } = buildShpAndShx(layerData.records, 5);
            const dbf = buildDbfBuffer(
                layerData.records.map((r) => r.attributes),
                layerData.fieldDefs,
            );

            // Find the directory prefix from template
            let dirPrefix = "";
            for (const entry of templateEntries) {
                const entryBase = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
                if (entryBase === upper) {
                    dirPrefix = path.dirname(entry.name);
                    if (dirPrefix === ".") dirPrefix = "";
                    break;
                }
            }

            const prefix = dirPrefix ? `${dirPrefix}/` : "";
            archive.append(shp, { name: `${prefix}${upper}.shp` });
            archive.append(shx, { name: `${prefix}${upper}.shx` });
            archive.append(dbf, { name: `${prefix}${upper}.dbf` });
            handledFiles.add(`${prefix}${upper}.shp`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.shx`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.dbf`.toLowerCase());

            // .prj from template
            const prjBuf = prjBuffers.get(upper);
            if (prjBuf) {
                archive.append(prjBuf, { name: `${prefix}${upper}.prj` });
                handledFiles.add(`${prefix}${upper}.prj`.toLowerCase());
            }
        }

        // Add remaining template files that haven't been replaced
        for (const entry of templateEntries) {
            if (entry.name.endsWith("/")) continue; // skip directories
            if (handledFiles.has(entry.name.toLowerCase())) continue;
            archive.append(entry.data, { name: entry.name });
        }

        // Add XLSX quantitative report if available
        if (xlsxBuffer) {
            archive.append(xlsxBuffer, { name: "QUANTITATIVOS.xlsx" });
        }

        archive.finalize();
    });
}

/* ─── XLSX Quantitative Report Builder ───────────────────────── */

async function buildQuantitativeXlsx(
    layerSummaries: LayerSummary[],
    propertyAreaHa: number,
    airIdentificacao?: string,
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "GeoForest IA";
    workbook.created = new Date();

    const headerFill: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF10B981" }, // emerald-500
    };
    const headerFont: Partial<ExcelJS.Font> = {
        bold: true,
        color: { argb: "FFFFFFFF" },
        size: 11,
    };
    const thinBorder: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD1D5DB" } };
    const allBorders: Partial<ExcelJS.Borders> = {
        top: thinBorder,
        left: thinBorder,
        bottom: thinBorder,
        right: thinBorder,
    };

    // ── Sheet 1: Resumo ──
    const resumo = workbook.addWorksheet("Resumo");

    // Title row
    resumo.mergeCells("A1:B1");
    const titleCell = resumo.getCell("A1");
    titleCell.value = "Relatório Quantitativo — Recorte SIMCAR";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF065F46" } };
    titleCell.alignment = { horizontal: "center" };

    // Summary data
    const summaryData: [string, string | number][] = [
        ["Data do Processamento", new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })],
        ["Nº Identificação AIR", airIdentificacao || "—"],
        ["Área do Imóvel (ha)", Number(propertyAreaHa.toFixed(4))],
        ["Sistema de Referência", "EPSG:4674 (SIRGAS 2000)"],
        ["Total de Camadas", layerSummaries.length],
        ["Camadas com Dados", layerSummaries.filter((l) => l.features > 0).length],
        ["Total de Feições Recortadas", layerSummaries.reduce((s, l) => s + l.features, 0)],
    ];

    summaryData.forEach(([label, value], idx) => {
        const row = resumo.getRow(idx + 3);
        row.getCell(1).value = label;
        row.getCell(1).font = { bold: true, size: 11 };
        row.getCell(2).value = value;
        row.getCell(2).alignment = { horizontal: "left" };
        row.getCell(1).border = allBorders;
        row.getCell(2).border = allBorders;
    });

    resumo.getColumn(1).width = 32;
    resumo.getColumn(2).width = 40;

    // ── Sheet 2: Camadas ──
    const camadas = workbook.addWorksheet("Camadas");

    // Header row
    const headers = ["Camada", "Origem", "Feições", "Área (ha)", "% do Imóvel", "Observações"];
    const headerRow = camadas.getRow(1);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = headerFont;
        cell.fill = headerFill;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = allBorders;
    });
    headerRow.height = 24;

    // Data rows
    layerSummaries.forEach((layer, idx) => {
        const row = camadas.getRow(idx + 2);
        const pct = propertyAreaHa > 0 && layer.areaHa
            ? Number(((layer.areaHa / propertyAreaHa) * 100).toFixed(2))
            : 0;

        row.getCell(1).value = layer.name;
        row.getCell(2).value = layer.source === "property" ? "Imóvel" : "WFS";
        row.getCell(3).value = layer.features;
        row.getCell(4).value = layer.areaHa ?? 0;
        row.getCell(5).value = pct;
        row.getCell(6).value = layer.warning || (layer.features === 0 ? "Sem dados" : "OK");

        // Formatting
        row.getCell(3).alignment = { horizontal: "center" };
        row.getCell(4).numFmt = "#,##0.0000";
        row.getCell(5).numFmt = "#,##0.00";
        for (let c = 1; c <= 6; c++) row.getCell(c).border = allBorders;

        // Alternate row shading
        if (idx % 2 === 1) {
            for (let c = 1; c <= 6; c++) {
                row.getCell(c).fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF0FDF4" }, // emerald-50
                };
            }
        }
    });

    // Auto-fit columns
    camadas.getColumn(1).width = 28; // Camada
    camadas.getColumn(2).width = 12; // Origem
    camadas.getColumn(3).width = 10; // Feições
    camadas.getColumn(4).width = 14; // Área (ha)
    camadas.getColumn(5).width = 14; // % do Imóvel
    camadas.getColumn(6).width = 36; // Observações

    // Auto-filter
    camadas.autoFilter = { from: "A1", to: `F${layerSummaries.length + 1}` };

    // Write to buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}

/* ─── Main Processing Pipeline ───────────────────────────────── */

export type LayerSummary = {
    name: string;
    source: "property" | "wfs";
    features: number;
    areaHa?: number;
    warning?: string;
};

type PersistedClipContextV1 = {
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
};

function mapToObjectGeometry(value: Map<string, Geometry[]>): Record<string, Geometry[]> {
    const out: Record<string, Geometry[]> = {};
    for (const [key, arr] of value.entries()) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        out[key] = arr;
    }
    return out;
}

function objectToMapGeometry(value: Record<string, Geometry[]> | null | undefined): Map<string, Geometry[]> {
    const out = new Map<string, Geometry[]>();
    if (!value || typeof value !== "object") return out;
    for (const [key, arr] of Object.entries(value)) {
        if (!Array.isArray(arr)) continue;
        const cleaned = arr.filter((g) => g && typeof g === "object") as Geometry[];
        if (cleaned.length > 0) out.set(key, cleaned);
    }
    return out;
}

function parsePersistedClipContext(raw: unknown): PersistedClipContextV1 | null {
    if (!raw || typeof raw !== "object") return null;
    const data = raw as any;
    if (Number(data.version) !== 1) return null;
    if (typeof data.jobId !== "string" || !data.jobId) return null;
    if (!Array.isArray(data.bbox) || data.bbox.length !== 4) return null;
    const bbox = data.bbox.map((v: unknown) => Number(v));
    if (!bbox.every(Number.isFinite)) return null;
    const polygonGeom = normalizePolygonGeometry(data.polygon?.geometry || data.polygon);
    if (!polygonGeom) return null;
    const polygon: Feature<Polygon | MultiPolygon> = {
        type: "Feature",
        properties: {},
        geometry: polygonGeom,
    };
    const layerSummaries = Array.isArray(data.layerSummaries)
        ? data.layerSummaries
            .map((row: any) => ({
                name: String(row?.name || ""),
                source: row?.source === "property" ? "property" : "wfs",
                features: Number(row?.features || 0),
                areaHa:
                    row?.areaHa === undefined || row?.areaHa === null
                        ? undefined
                        : Number(row.areaHa),
                warning: row?.warning ? String(row.warning) : undefined,
            }))
            .filter((row: LayerSummary) => Boolean(row.name))
        : [];
    if (!layerSummaries.length) return null;
    return {
        version: 1,
        jobId: data.jobId,
        savedAtIso: typeof data.savedAtIso === "string" ? data.savedAtIso : new Date().toISOString(),
        filename: typeof data.filename === "string" && data.filename ? data.filename : `SIMCAR_Recorte_${data.jobId}.zip`,
        bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
        polygon,
        layerSummaries,
        areaHa: Number(data.areaHa || 0),
        clippedGeometries: mapToObjectGeometry(objectToMapGeometry(data.clippedGeometries)),
        inputZipUrl: typeof data.inputZipUrl === "string" ? data.inputZipUrl : undefined,
        outputZipUrl: typeof data.outputZipUrl === "string" ? data.outputZipUrl : undefined,
    };
}

async function processClip(
    res: Response,
    propertyZip: Buffer,
    requestedLayers: string[] | null,
    airIdentificacao?: string,
): Promise<{ ok: boolean; cloudinaryStoredBytes: number }> {
    const startTime = Date.now();
    const layerNames = requestedLayers && requestedLayers.length > 0
        ? requestedLayers.filter((l) => (TEMPLATE_LAYERS as readonly string[]).includes(l))
        : [...TEMPLATE_LAYERS];

    const total = layerNames.length;
    const layerSummaries: LayerSummary[] = [];
    let totalFeaturesClipped = 0;

    // 1. Parse user shapefile
    let userResult: ReturnType<typeof parseUserShapefile>;
    try {
        userResult = parseUserShapefile(propertyZip);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile do imóvel." });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }

    const { polygon: userPolygon, geometry: userGeometry, areaHa } = userResult;
    const userWkt = polygonToWkt(userGeometry);

    // 2. Read template
    let templateEntries: Array<{ name: string; data: Buffer }>;
    try {
        const modeloBuffer = fs.readFileSync(MODELO_ZIP_PATH);
        templateEntries = extractZipEntries(modeloBuffer);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: "Arquivo Modelo.zip não encontrado no servidor." });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }

    // 3. Extract template schemas and .prj files
    const templateSchemas = readTemplateSchemas(templateEntries);
    const prjBuffers = new Map<string, Buffer>();
    for (const entry of templateEntries) {
        if (entry.name.toLowerCase().endsWith(".prj")) {
            const base = path.basename(entry.name, ".prj").toUpperCase();
            prjBuffers.set(base, entry.data);
        }
    }

    // 4. WFS GetCapabilities → discover layer mapping
    let layerMapping = new Map<string, string>();
    try {
        const caps = await getCapabilitiesCached(false);
        const wfsNames = [...caps.layerNames];
        layerMapping = discoverLayerMapping(TEMPLATE_LAYERS, wfsNames);
        console.log(`[SIMCAR CLIP] Layer mapping: ${layerMapping.size} layers matched`);
    } catch (err: any) {
        console.error("[SIMCAR CLIP] WFS capabilities error:", err.message);
        sendSSE(res, { type: "error", message: "Serviço WFS da SEMA-MT indisponível." });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }

    // 5. Process each layer
    const clippedLayers = new Map<string, { records: ShpRecord[]; fieldDefs: DbfFieldDef[] }>();
    const clippedGeometries = new Map<string, Geometry[]>();

    for (let i = 0; i < layerNames.length; i++) {
        const layerName = layerNames[i];
        const current = i + 1;

        if (DIRECT_COPY_LAYERS.has(layerName)) {
            // Category 1: Direct copy of property polygon
            sendSSE(res, {
                type: "progress",
                layer: layerName,
                current,
                total,
                status: "copying_property",
            });

            const rings = geojsonToShpRings(userGeometry);
            const fieldDefs = templateSchemas.get(layerName) || [
                { name: "ID", type: "N" as const, length: 10, decimals: 0 },
            ];
            const attributes: Record<string, string | number | null> = {};
            for (const f of fieldDefs) attributes[f.name] = null;
            if (attributes["ID"] !== undefined) attributes["ID"] = 1;

            // Fill AIR IDENTIFIC field with user-provided identification number
            if (layerName === "AIR" && airIdentificacao) {
                // Ensure IDENTIFIC field exists in schema
                if (!fieldDefs.some((f) => f.name === "IDENTIFIC")) {
                    fieldDefs.push({ name: "IDENTIFIC", type: "C" as const, length: 50, decimals: 0 });
                }
                attributes["IDENTIFIC"] = airIdentificacao;
            }

            clippedLayers.set(layerName, {
                records: [{ rings, attributes }],
                fieldDefs,
            });

            layerSummaries.push({
                name: layerName,
                source: "property",
                features: 1,
            });
            totalFeaturesClipped += 1;
            continue;
        }

        // Category 2: WFS query + clip
        const wfsTypeName = layerMapping.get(layerName);
        if (!wfsTypeName) {
            sendSSE(res, {
                type: "progress",
                layer: layerName,
                current,
                total,
                status: "no_wfs_match",
            });
            layerSummaries.push({
                name: layerName,
                source: "wfs",
                features: 0,
                warning: "Camada não encontrada no WFS",
            });
            continue;
        }

        // Fetch
        sendSSE(res, {
            type: "progress",
            layer: layerName,
            current,
            total,
            status: "fetching",
        });

        let wfsFeatures: WfsFeature[];
        try {
            wfsFeatures = await fetchWfsClipFeatures(wfsTypeName, userWkt, "EPSG:4674");
        } catch (err: any) {
            console.error(`[SIMCAR CLIP] WFS fetch error for ${layerName}:`, err.message);
            layerSummaries.push({
                name: layerName,
                source: "wfs",
                features: 0,
                warning: `Erro WFS: ${err.message?.slice(0, 100)}`,
            });
            continue;
        }

        if (!wfsFeatures.length) {
            layerSummaries.push({
                name: layerName,
                source: "wfs",
                features: 0,
            });
            continue;
        }

        // Clip
        sendSSE(res, {
            type: "progress",
            layer: layerName,
            current,
            total,
            status: "clipping",
            features: wfsFeatures.length,
        });

        const clipped = clipFeaturesToPolygon(wfsFeatures, userPolygon);

        if (!clipped.length) {
            layerSummaries.push({
                name: layerName,
                source: "wfs",
                features: 0,
            });
            continue;
        }

        // Build shapefile records
        const fieldDefs = templateSchemas.get(layerName) || [
            { name: "ID", type: "N" as const, length: 10, decimals: 0 },
        ];

        const records: ShpRecord[] = [];
        let layerAreaHa = 0;

        for (const feat of clipped) {
            const rings = geojsonToShpRings(feat.geometry as any);
            if (!rings.length) continue;

            const attributes = mapAttributes(feat.properties, fieldDefs);
            records.push({ rings, attributes });

            try {
                const geom = normalizePolygonGeometry(feat.geometry);
                if (geom) {
                    const f = geom.type === "Polygon"
                        ? turfPolygon(geom.coordinates)
                        : turfMultiPolygon(geom.coordinates);
                    layerAreaHa += turfArea(f) / 10000;
                }
            } catch {
                // Ignore area calculation errors
            }
        }

        if (records.length > 0) {
            clippedLayers.set(layerName, { records, fieldDefs });
        }

        // Store clipped GeoJSON geometries for AI analysis rendering
        const geoJsonGeoms = clipped
            .map((f) => f.geometry)
            .filter((g): g is Geometry => !!g);
        if (geoJsonGeoms.length > 0) {
            clippedGeometries.set(layerName, geoJsonGeoms);
        }

        totalFeaturesClipped += records.length;
        layerSummaries.push({
            name: layerName,
            source: "wfs",
            features: records.length,
            areaHa: Number(layerAreaHa.toFixed(4)),
        });
    }

    // 6. Build output ZIP
    sendSSE(res, {
        type: "progress",
        layer: "ZIP",
        current: total,
        total,
        status: "building_zip",
    });

    // 6b. Build XLSX quantitative report
    let xlsxBuffer: Buffer | undefined;
    try {
        xlsxBuffer = await buildQuantitativeXlsx(layerSummaries, areaHa, airIdentificacao);
    } catch (err: any) {
        console.error("[SIMCAR CLIP] XLSX build error:", err.message);
        // Non-fatal: continue without XLSX
    }

    let zipBuffer: Buffer;
    try {
        zipBuffer = await buildOutputZip(templateEntries, clippedLayers, prjBuffers, xlsxBuffer);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: `Erro ao montar ZIP: ${err.message}` });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }

    // 7. Cache the result (including geometry for AI analysis)
    const jobId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `SIMCAR_Recorte_${timestamp}.zip`;

    // Compute bbox from user polygon for WMS snapshots
    const polyCoords = userPolygon.geometry.type === "Polygon"
        ? userPolygon.geometry.coordinates[0]
        : userPolygon.geometry.coordinates.flatMap((p) => p[0]);
    const lngs = polyCoords.map((c) => c[0]);
    const lats = polyCoords.map((c) => c[1]);
    const jobBbox: [number, number, number, number] = [
        Math.min(...lngs), Math.min(...lats),
        Math.max(...lngs), Math.max(...lats),
    ];

    pruneJobCache();

    // 7b. Upload ZIPs to Cloudinary for persistence
    let inputZipUrl: string | undefined;
    let outputZipUrl: string | undefined;
    let contextJsonUrl: string | undefined;
    let cloudinaryStoredBytes = 0;
    try {
        sendSSE(res, { type: "progress", layer: "UPLOAD", current: total, total, status: "uploading_cloudinary" });
        const [inUrl, outUrl] = await Promise.all([
            uploadBufferToCloudinary(propertyZip, `simcar_input_${jobId.slice(0, 8)}`),
            uploadBufferToCloudinary(zipBuffer, `simcar_output_${jobId.slice(0, 8)}`),
        ]);
        inputZipUrl = inUrl;
        outputZipUrl = outUrl;
        const persistedContext: PersistedClipContextV1 = {
            version: 1,
            jobId,
            savedAtIso: new Date().toISOString(),
            filename,
            bbox: jobBbox,
            polygon: userPolygon,
            layerSummaries,
            areaHa,
            clippedGeometries: mapToObjectGeometry(clippedGeometries),
            inputZipUrl: inUrl,
            outputZipUrl: outUrl,
        };
        const contextBuffer = Buffer.from(JSON.stringify(persistedContext), "utf8");
        contextJsonUrl = await uploadRawBufferToCloudinary(
            contextBuffer,
            `simcar_context_${jobId.slice(0, 8)}.json`,
            "application/json",
        );
        cloudinaryStoredBytes = propertyZip.length + zipBuffer.length + contextBuffer.length;
        console.log(`[SIMCAR CLIP] Cloudinary: input=${inUrl}, output=${outUrl}, context=${contextJsonUrl}`);
    } catch (err: any) {
        console.error("[SIMCAR CLIP] Cloudinary ZIP upload error:", err.message);
        // Non-fatal: continue without Cloudinary URLs
    }

    jobCache.set(jobId, {
        buffer: zipBuffer,
        expiresAt: Date.now() + CACHE_TTL_MS,
        filename,
        bbox: jobBbox,
        polygon: userPolygon,
        layerSummaries,
        areaHa,
        clippedGeometries,
        inputZipUrl,
        outputZipUrl,
        contextJsonUrl,
    });

    // 8. Send completion event
    const processingTimeMs = Date.now() - startTime;
    const layersWithData = layerSummaries.filter((l) => l.features > 0).length;

    sendSSE(res, {
        type: "complete",
        jobId,
        downloadUrl: `/api/simcar/clip/download/${jobId}`,
        inputZipUrl,
        outputZipUrl,
        contextUrl: contextJsonUrl,
        summary: {
            propertyAreaHa: areaHa,
            crs: "EPSG:4674",
            layersProcessed: layerNames.length,
            layersWithData,
            totalFeaturesClipped,
            processingTimeMs,
            layers: layerSummaries,
        },
    });
    return { ok: true, cloudinaryStoredBytes };
}

/* ─── AI Analysis Pipeline ───────────────────────────────────── */

const SEMA_WMS_BASE = process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
const SEMA_WMS_AUTHKEY = process.env.SEMA_WMS_AUTHKEY || "541085de-9a2e-454e-bdba-eb3d57a2f492";
const SPOT_LAYER = "Mosaicos:MOSAICO_SPOT_SEPLAN";

/** Helper to generate Landsat 5/8 and Sentinel-2 layer entries. */
function buildSatLayer(sensor: string, year: number, wmsPrefix: string, labelPrefix: string, aliases?: string[]): { wmsLayer: string; wmsAliases?: string[]; label: string; year: number } {
    const envKey = `WMS_${sensor}_${year}`;
    const defaultLayer = `Mosaicos:${wmsPrefix}_${year}`;
    return {
        wmsLayer: process.env[envKey] || defaultLayer,
        wmsAliases: aliases || [`Mosaicos:${wmsPrefix}_${year}`, `Mosaicos:MOSAICO_${wmsPrefix}${year}`],
        label: `${labelPrefix} (${year})`,
        year,
    };
}

/** Available satellite base layers for analysis. */
const SATELLITE_LAYERS: Record<string, { wmsLayer: string; wmsAliases?: string[]; label: string; year: number }> = {
    // SPOT (high-res 2.5m)
    spot_2008: { wmsLayer: SPOT_LAYER, label: "SPOT 2008", year: 2008 },
    // Landsat 5 (30m) — 1984-2011
    ...Object.fromEntries([1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011].map(
        (y) => [`landsat5_${y}`, buildSatLayer("LANDSAT5", y, "LANDSAT_5", "Landsat 5")]
    )),
    // Landsat 8 (30m) — 2013-2018
    ...Object.fromEntries([2013, 2014, 2015, 2016, 2017, 2018].map(
        (y) => [`landsat8_${y}`, buildSatLayer("LANDSAT8", y, "LANDSAT_8", "Landsat 8")]
    )),
    // Sentinel-2 (10m) — 2016-2024
    ...Object.fromEntries([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024].map(
        (y) => [`sentinel2_${y}`, buildSatLayer("SENTINEL2", y, "SENTINEL_2", "Sentinel-2")]
    )),
};

const AC_AVN_FIXED_KEYS = [
    "landsat5_2006",
    "landsat5_2007",
    "spot_2008",
    "landsat5_2008",
] as const;

export function getFixedAcAvnSatelliteKeys(): string[] {
    return AC_AVN_FIXED_KEYS.filter((k) => Boolean(SATELLITE_LAYERS[k]));
}

function getOrderedSatelliteKeys(selectedLayers: string[] = []): string[] {
    const unique = Array.from(new Set(selectedLayers.filter((k) => SATELLITE_LAYERS[k])));
    if (unique.length === 0) return ["spot_2008"];
    return unique.sort((a, b) => {
        const satA = SATELLITE_LAYERS[a];
        const satB = SATELLITE_LAYERS[b];
        const yearDiff = satA.year - satB.year;
        if (yearDiff !== 0) return yearDiff;
        return satA.label.localeCompare(satB.label);
    });
}

const ANALYSIS_VISION_MODELS = [
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
];
const GROQ_TEXT_MODELS = [
    "openai/gpt-oss-120b",
    "meta-llama/llama-3.3-70b-versatile",
    "qwen/qwen3-32b",
];
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_VISION_FALLBACK_MODELS = [
    "gemini-3-pro",
    "gemini-2.5-flash",
    "gemini-3-flash",
    "nano-banana-pro",
];
const GEMINI_TEXT_FALLBACK_MODELS = [
    "gemini-3-pro",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
];

function normalizeGeminiModelName(raw: string): string {
    return String(raw || "")
        .trim()
        .replace(/^['"`]+|['"`]+$/g, "")
        .replace(/^models\//i, "")
        .replace(/:generateContent$/i, "")
        .trim();
}

function buildGeminiModelChain(configValue: string | undefined, backupModels: string[]): string[] {
    const configured = String(configValue || "")
        .split(/[,\n;]+/)
        .map((x) => normalizeGeminiModelName(x))
        .filter(Boolean);
    const normalizedBackup = backupModels
        .map((x) => normalizeGeminiModelName(x))
        .filter(Boolean);
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const model of [...configured, ...normalizedBackup]) {
        const key = model.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(model);
    }
    return merged;
}

const GEMINI_VISION_MODELS = buildGeminiModelChain(
    process.env.GEMINI_VISION_MODELS || process.env.GEMINI_MODELS,
    GEMINI_VISION_FALLBACK_MODELS,
);
const GEMINI_TEXT_SYNTHESIS_MODELS = buildGeminiModelChain(
    process.env.GEMINI_TEXT_SYNTHESIS_MODELS || process.env.GEMINI_MODELS,
    GEMINI_TEXT_FALLBACK_MODELS,
);
const GEMINI_IMAGE_SHARE_INPUT = String(process.env.GEMINI_IMAGE_SHARE || "1.0").replace(",", ".");
const GEMINI_IMAGE_SHARE_RAW = Number(GEMINI_IMAGE_SHARE_INPUT);
const GEMINI_IMAGE_SHARE = Number.isFinite(GEMINI_IMAGE_SHARE_RAW)
    ? Math.min(1.0, Math.max(0.55, GEMINI_IMAGE_SHARE_RAW))
    : 1.0;
const SIMCAR_REQUIRE_GEMINI = String(process.env.SIMCAR_REQUIRE_GEMINI || "true").toLowerCase() !== "false";
const SIMCAR_ANALYSIS_MODE = String(process.env.SIMCAR_ANALYSIS_MODE || "efficient").trim().toLowerCase();
const SIMCAR_CHAT_MAX_MESSAGES = Number(process.env.SIMCAR_CHAT_MAX_MESSAGES || 10);
const SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE = Number(process.env.SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE || 1400);
const SIMCAR_CHAT_MAX_TOTAL_CHARS = Number(process.env.SIMCAR_CHAT_MAX_TOTAL_CHARS || 8500);
const SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT = Number(process.env.SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT || 1800);
const SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL = normalizeGeminiModelName(
    process.env.SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || "gemini-2.5-pro",
);
const SIMCAR_FINAL_UNIFIED_TEXT_MODEL = normalizeGeminiModelName(
    process.env.SIMCAR_FINAL_UNIFIED_TEXT_MODEL || "gemini-3-pro",
);
const SIMCAR_SYNTHESIS_TEXT_MODELS = (() => {
    const explicit = buildGeminiModelChain(process.env.SIMCAR_SYNTHESIS_TEXT_MODELS, []);
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string) => {
        const model = normalizeGeminiModelName(raw);
        if (!model) return;
        const key = model.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(model);
    };
    for (const model of explicit) push(model);
    push(SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL);
    for (const model of GEMINI_TEXT_SYNTHESIS_MODELS) push(model);
    return ordered;
})();
const SIMCAR_FINAL_UNIFIED_TEXT_MODELS = (() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string) => {
        const model = normalizeGeminiModelName(raw);
        if (!model) return;
        const key = model.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(model);
    };
    push(SIMCAR_FINAL_UNIFIED_TEXT_MODEL);
    for (const model of SIMCAR_SYNTHESIS_TEXT_MODELS) push(model);
    return ordered;
})();
const FORCE_AC_AVN_UNIFIED_ANALYSIS = true;

/**
 * Groq rate-limit tracker PER MODEL.
 * Each Groq model has independent limits; when a model returns 429 we put only
 * that model in cooldown and continue trying other Groq models.
 */
const GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS = 60_000;
const GROQ_RATE_LIMIT_MIN_COOLDOWN_MS = 8_000;
const GROQ_RATE_LIMIT_MAX_COOLDOWN_MS = 180_000;
const GROQ_RATE_LIMIT_RETRY_BUFFER_MS = 3_000;
const groqModelRateLimitedUntil = new Map<string, number>();

function getGroqModelRateLimitRemainingMs(model: string): number {
    const key = String(model || "").trim().toLowerCase();
    if (!key) return 0;
    const until = groqModelRateLimitedUntil.get(key) || 0;
    return Math.max(0, until - Date.now());
}

function isGroqModelRateLimited(model: string): boolean {
    const key = String(model || "").trim().toLowerCase();
    if (!key) return false;
    const remaining = getGroqModelRateLimitRemainingMs(model);
    if (remaining <= 0) {
        groqModelRateLimitedUntil.delete(key);
        return false;
    }
    return true;
}

function hasAvailableGroqModels(models: string[]): boolean {
    return models.some((model) => !isGroqModelRateLimited(model));
}

function getGroqRateLimitRemainingMs(models: string[]): number {
    const waits = models
        .map((model) => getGroqModelRateLimitRemainingMs(model))
        .filter((ms) => ms > 0);
    if (!waits.length) return 0;
    return Math.min(...waits);
}

function extractRetryAfterMs(headers: Headers | undefined, body: string): number | null {
    const header = headers?.get("retry-after");
    if (header) {
        const numeric = Number(header);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric * 1000;
        }
        const parsedDate = Date.parse(header);
        if (Number.isFinite(parsedDate)) {
            const diff = parsedDate - Date.now();
            if (diff > 0) return diff;
        }
    }

    const normalized = String(body || "");
    const tryAgainMatch = normalized.match(/try again in\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
    if (tryAgainMatch) {
        const seconds = Number(tryAgainMatch[1]);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.ceil(seconds * 1000);
        }
    }
    return null;
}

function markGroqModelRateLimited(model: string, retryAfterMs?: number | null): void {
    const suggested = Number.isFinite(retryAfterMs as number) ? Number(retryAfterMs) + GROQ_RATE_LIMIT_RETRY_BUFFER_MS : 0;
    const cooldownMs = Math.min(
        GROQ_RATE_LIMIT_MAX_COOLDOWN_MS,
        Math.max(
            GROQ_RATE_LIMIT_MIN_COOLDOWN_MS,
            suggested > 0 ? suggested : GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS,
        ),
    );
    const key = String(model || "").trim().toLowerCase();
    if (!key) return;
    groqModelRateLimitedUntil.set(key, Date.now() + cooldownMs);
    console.warn(
        `[SIMCAR ANALYSIS] Groq model ${model} rate-limited. Cooling down this model for ~${Math.ceil(cooldownMs / 1000)}s.`,
    );
}

function isRateLimitError(status: number, body: string): boolean {
    return status === 429 || body.includes("rate_limit_exceeded") || body.includes("rate limit");
}

class GroqRateLimitError extends Error {
    model?: string;
    retryAfterMs?: number;
    constructor(message: string, model?: string, retryAfterMs?: number) {
        super(message);
        this.name = "GroqRateLimitError";
        this.model = model;
        this.retryAfterMs = retryAfterMs;
    }
}

export function getSimcarGeminiRuntimeConfig() {
    return {
        hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
        requireGemini: SIMCAR_REQUIRE_GEMINI,
        analysisMode: SIMCAR_ANALYSIS_MODE,
        geminiApiBase: GEMINI_API_BASE,
        geminiVisionModels: GEMINI_VISION_MODELS,
        geminiTextSynthesisModels: GEMINI_TEXT_SYNTHESIS_MODELS,
        synthesisPrimaryTextModel: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL,
        finalUnifiedTextModel: SIMCAR_FINAL_UNIFIED_TEXT_MODEL,
        finalUnifiedTextModels: SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
        geminiImageShare: GEMINI_IMAGE_SHARE,
    };
}

/** Generate a WMS GetMap URL for a given layer + bbox. */
function buildWmsGetMapUrl(
    layers: string[],
    bbox: [number, number, number, number],
    width = 1200,
    height = 800,
    format = "image/png",
    crs = "EPSG:4326",
): string {
    const url = new URL(SEMA_WMS_BASE);
    url.searchParams.set("service", "WMS");
    url.searchParams.set("request", "GetMap");
    url.searchParams.set("version", "1.1.1");
    url.searchParams.set("layers", layers.join(","));
    url.searchParams.set("styles", layers.map(() => "").join(","));
    url.searchParams.set("format", format);
    url.searchParams.set("transparent", "false");
    url.searchParams.set("srs", crs);
    url.searchParams.set("bbox", `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`);
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    if (SEMA_WMS_AUTHKEY) url.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
    return url.toString();
}

/** PNG magic bytes: 0x89 P N G */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** JPEG magic bytes: 0xFF 0xD8 0xFF */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Fetch a WMS image and return as a PNG Buffer. Validates the response is actually an image. */
async function fetchWmsImageBuffer(
    layers: string[],
    bbox: [number, number, number, number],
    width = 1200,
    height = 900,
): Promise<Buffer> {
    const mapUrl = buildWmsGetMapUrl(layers, bbox, width, height);
    const controller = new AbortController();
    const dynamicTimeout = calculateWmsTimeout(width, height);
    const timeout = setTimeout(() => controller.abort(), dynamicTimeout);
    const response = await fetch(mapUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`WMS error ${response.status}: ${text.slice(0, 200)}`);
    }

    // Check Content-Type header
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("xml") || contentType.includes("html") || contentType.includes("text")) {
        const text = await response.text();
        throw new Error(`WMS retornou ${contentType} em vez de imagem: ${text.slice(0, 200)}`);
    }

    const arr = await response.arrayBuffer();
    const buf = Buffer.from(arr);

    // Validate buffer starts with PNG or JPEG magic bytes
    if (buf.length < 4) {
        throw new Error(`WMS retornou buffer muito pequeno (${buf.length} bytes)`);
    }
    const isPng = buf.subarray(0, 4).equals(PNG_MAGIC);
    const isJpeg = buf.subarray(0, 3).equals(JPEG_MAGIC);
    if (!isPng && !isJpeg) {
        // Likely an XML/text error response with 200 status
        const preview = buf.toString("utf8", 0, Math.min(200, buf.length));
        throw new Error(`WMS retornou formato inválido (não é PNG/JPEG): ${preview.slice(0, 150)}`);
    }

    return buf;
}

/** Convert GeoJSON coordinates to SVG path data. */
function geoToPixel(
    lon: number,
    lat: number,
    bbox: [number, number, number, number],
    width: number,
    height: number,
): [number, number] {
    const x = ((lon - bbox[0]) / (bbox[2] - bbox[0])) * width;
    // WMS 1.1.1 with EPSG:4326 uses lon,lat order in bbox → y is inverted
    const y = ((bbox[3] - lat) / (bbox[3] - bbox[1])) * height;
    return [x, y];
}

/** Convert a ring (array of [lon, lat]) to SVG path commands. */
function ringToSvgPath(
    ring: number[][],
    bbox: [number, number, number, number],
    width: number,
    height: number,
): string {
    return ring
        .map((coord, i) => {
            const [px, py] = geoToPixel(coord[0], coord[1], bbox, width, height);
            return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
        })
        .join(" ") + " Z";
}

/** Build SVG overlay for a set of GeoJSON geometries with given color. */
function geometriesToSvgPaths(
    geometries: Geometry[],
    bbox: [number, number, number, number],
    width: number,
    height: number,
    stroke: string,
    strokeWidth: number,
    fill: string,
): string {
    const paths: string[] = [];
    for (const geom of geometries) {
        let rings: number[][][] = [];
        if (geom.type === "Polygon") {
            rings = geom.coordinates as number[][][];
        } else if (geom.type === "MultiPolygon") {
            for (const poly of (geom as any).coordinates) {
                rings.push(...poly);
            }
        }
        for (const ring of rings) {
            const d = ringToSvgPath(ring, bbox, width, height);
            paths.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`);
        }
    }
    return paths.join("\n");
}

/** Build a complete SVG overlay with all polygon layers. */
function buildPolygonOverlaySvg(
    width: number,
    height: number,
    bbox: [number, number, number, number],
    propertyPolygon: Feature<Polygon | MultiPolygon>,
    layerGeometries: Map<string, Geometry[]>,
    layers: Array<{ name: string; stroke: string; fill: string; strokeWidth: number }>,
): Buffer {
    const svgParts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ];

    // Draw each layer
    for (const layer of layers) {
        const geoms = layerGeometries.get(layer.name);
        if (geoms && geoms.length > 0) {
            svgParts.push(
                `<!-- ${layer.name} -->`,
                geometriesToSvgPaths(geoms, bbox, width, height, layer.stroke, layer.strokeWidth, layer.fill),
            );
        }
    }

    // Always draw property polygon outline (red, no fill)
    svgParts.push(
        `<!-- Propriedade -->`,
        geometriesToSvgPaths(
            [propertyPolygon.geometry],
            bbox, width, height,
            "#EF4444", 3, "none",
        ),
    );

    svgParts.push("</svg>");
    return Buffer.from(svgParts.join("\n"));
}

/** Composite SVG overlay onto a WMS base image using sharp. Returns data URL. */
async function compositeOverlay(
    basePngBuffer: Buffer,
    svgOverlay: Buffer,
): Promise<string> {
    const composited = await sharp(basePngBuffer)
        .composite([{ input: svgOverlay, top: 0, left: 0 }])
        .png()
        .toBuffer();
    return `data:image/png;base64,${composited.toString("base64")}`;
}

/**
 * Compress image for AI vision analysis (base64 fallback path, used when Cloudinary is unavailable).
 * Downscales to max 800×600 and encodes as JPEG at quality 65 with metadata stripped.
 * Keeps enough detail for vegetation/land-use classification while minimising token cost.
 */
async function compressForVision(dataUrl: string): Promise<string> {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    const compressed = await sharp(buf)
        .resize(800, 600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer();
    return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}

/** Cloudinary commons */
const CLOUDINARY_CLOUD = "da19dwpgk";

function cloudinarySign(params: Record<string, string>): string {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) throw new Error("Cloudinary não configurado.");
    const base = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
    return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

/** Upload a data URL (image) to Cloudinary. Returns secure_url. */
async function uploadToCloudinary(dataUrl: string, filename: string): Promise<string> {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const folder = process.env.CLOUDINARY_FOLDER;
    if (!apiKey || !apiSecret) throw new Error("Cloudinary não configurado.");

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_");
    const params: Record<string, string> = { timestamp: String(timestamp), public_id: publicId };
    if (folder) params.folder = folder;
    const signature = cloudinarySign(params);

    const form = new FormData();
    form.append("file", dataUrl);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);
    if (folder) form.append("folder", folder);
    form.append("public_id", publicId);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
    const response = await fetch(uploadUrl, { method: "POST", body: form });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cloudinary error ${response.status}: ${text.slice(0, 200)}`);
    }
    return ((await response.json()) as { secure_url: string }).secure_url;
}

/** Extract Cloudinary public_id from a secure_url. */
function extractCloudinaryPublicId(url: string): string | null {
    // e.g. https://res.cloudinary.com/da19dwpgk/image/upload/v123/folder/public_id.ext
    //   or https://res.cloudinary.com/da19dwpgk/raw/upload/v123/folder/public_id.zip
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
    return match ? match[1] : null;
}

/**
 * Returns a Cloudinary URL with on-the-fly transformations optimized for AI vision APIs.
 * Resizes to max 800×600, converts to JPEG at quality 65, strips metadata.
 * This reduces image token consumption by ~70–80% vs. sending the full-res PNG,
 * while preserving enough detail for land-use / vegetation classification.
 * The original full-resolution URL is kept intact for user display.
 */
function getCloudinaryAiUrl(url: string): string {
    // Only transform Cloudinary image URLs (not raw resources).
    if (!url.includes("/image/upload/")) return url;
    // Insert transformation string right after /image/upload/
    return url.replace("/image/upload/", "/image/upload/w_800,h_600,c_limit,q_65,f_jpg,fl_strip_profile/");
}

/**
 * Returns a Cloudinary URL optimized for Gemini vision analysis.
 * Uses a higher resolution (max 1280×960) and better JPEG quality (88) than the
 * Groq path, taking advantage of Gemini's larger context window and superior image
 * understanding to produce more precise land-use / vegetation analyses.
 * The increased resolution preserves texture details critical for distinguishing
 * native vegetation (Cerrado/Forest) from degraded pasture.
 */
function getCloudinaryGeminiUrl(url: string): string {
    if (!url.includes("/image/upload/")) return url;
    return url.replace("/image/upload/", "/image/upload/w_1280,h_960,c_limit,q_88,f_jpg,fl_strip_profile/");
}

/** Delete a resource from Cloudinary by its secure_url. */
async function deleteFromCloudinary(secureUrl: string, resourceType: "image" | "raw" = "image"): Promise<void> {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiKey || !apiSecret) return;

    const publicId = extractCloudinaryPublicId(secureUrl);
    if (!publicId) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string> = { public_id: publicId, timestamp: String(timestamp) };
    const signature = cloudinarySign(params);

    const form = new FormData();
    form.append("public_id", publicId);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);

    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/destroy`;
    try {
        await fetch(url, { method: "POST", body: form });
    } catch (err: any) {
        console.warn(`[CLOUDINARY DELETE] Failed for ${publicId}: ${err.message}`);
    }
}

/** Upload a raw Buffer (ZIP/JSON etc.) to Cloudinary. Returns secure_url. */
async function uploadRawBufferToCloudinary(
    buffer: Buffer,
    filename: string,
    mimeType: string,
): Promise<string> {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const folder = process.env.CLOUDINARY_FOLDER;
    if (!apiKey || !apiSecret) throw new Error("Cloudinary não configurado.");

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_");
    const params: Record<string, string> = { timestamp: String(timestamp), public_id: publicId };
    if (folder) params.folder = folder;
    const signature = cloudinarySign(params);

    const b64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const form = new FormData();
    form.append("file", b64);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);
    if (folder) form.append("folder", folder);
    form.append("public_id", publicId);
    form.append("resource_type", "raw");

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`;
    const response = await fetch(uploadUrl, { method: "POST", body: form });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cloudinary raw error ${response.status}: ${text.slice(0, 200)}`);
    }
    return ((await response.json()) as { secure_url: string }).secure_url;
}

async function uploadBufferToCloudinary(buffer: Buffer, filename: string): Promise<string> {
    return uploadRawBufferToCloudinary(buffer, filename, "application/zip");
}

type AiImage = {
    /** URL for Groq vision (compressed 800×600 JPEG). */
    url?: string;
    /** Higher-quality URL for Gemini vision (1024×768 JPEG). Falls back to `url` if absent. */
    geminiUrl?: string;
    /** Base64 data URL used when Cloudinary is unavailable. */
    dataUrl?: string;
    caption: string;
};

/**
 * Build content parts for vision API from images.
 * Uses Cloudinary URLs when available, otherwise compressed base64.
 */
function buildVisionContentParts(images: AiImage[], prompt: string): any[] {
    const contentParts: any[] = [
        { type: "text", text: prompt },
    ];
    for (const img of images) {
        const imageUrl = img.url || img.dataUrl;
        if (!imageUrl) continue;
        contentParts.push({
            type: "image_url",
            image_url: { url: imageUrl },
        });
        contentParts.push({ type: "text", text: `[Legenda: ${img.caption}]` });
    }
    return contentParts;
}

/**
 * Reduce image set for retry: keep only overview images (1 per satellite)
 * instead of all 3 views per satellite.
 */
function reduceImageSet(
    images: AiImage[],
): AiImage[] {
    return images.filter((img) => img.caption.includes("Visão Geral"));
}

/** Split images by provider weight, giving Gemini priority (all images by default). */
function splitImagesByProviderWeight(images: AiImage[]): { groqImages: AiImage[]; geminiImages: AiImage[] } {
    const groqImages: AiImage[] = [];
    const geminiImages: AiImage[] = [];

    // When share is 1.0, send ALL images to Gemini (legacy split config).
    if (GEMINI_IMAGE_SHARE >= 1.0) {
        return { groqImages: [], geminiImages: images.slice() };
    }

    if (images.length <= 1) {
        // Single image always goes to Gemini (priority provider).
        return { groqImages: [], geminiImages: images.slice() };
    }

    const total = images.length;
    let targetGemini = Math.round(total * GEMINI_IMAGE_SHARE);
    targetGemini = Math.min(total, Math.max(1, targetGemini));

    images.forEach((img, idx) => {
        // Proportional distribution along the sequence to avoid clustering.
        const desiredGeminiByNow = Math.round((idx + 1) * (targetGemini / total));
        if (geminiImages.length < desiredGeminiByNow) {
            geminiImages.push(img);
        } else {
            groqImages.push(img);
        }
    });

    // Safety rebalance.
    while (geminiImages.length < targetGemini && groqImages.length > 1) {
        const moved = groqImages.shift();
        if (moved) geminiImages.push(moved);
    }

    return { groqImages, geminiImages };
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new Error("Formato de data URL inválido para Gemini.");
    }
    return { mimeType: match[1], base64: match[2] };
}

function isTruncationFinishReason(reason: unknown): boolean {
    const normalized = String(reason || "").trim().toLowerCase();
    return (
        normalized === "length" ||
        normalized === "max_tokens" ||
        normalized === "max_output_tokens" ||
        normalized === "token_limit"
    );
}

const CONTINUATION_INSTRUCTION =
    "Sua resposta anterior foi cortada. Continue EXATAMENTE de onde parou.\n" +
    "Regras:\n" +
    "- Não repita o que já foi escrito.\n" +
    "- Mantenha o mesmo idioma, formato e nível técnico.\n" +
    "- Entregue somente a continuação a partir da próxima frase.\n" +
    "- Não invente dados novos fora do contexto já fornecido.";

async function continueTruncatedAnalysisText(
    baseText: string,
    prompt: string,
    providerLabel: string,
    finishReason: unknown,
): Promise<string> {
    const currentText = String(baseText || "").trim();
    if (!currentText || !isTruncationFinishReason(finishReason)) {
        return currentText;
    }

    try {
        console.warn(
            `[SIMCAR ANALYSIS] ${providerLabel} response truncated (finish=${String(finishReason)}). Requesting continuation...`,
        );
        const continuationMessages = [
            {
                role: "user" as const,
                content:
                    "Você está finalizando um laudo técnico de recorte ambiental.\n" +
                    "Mantenha o mesmo estilo técnico da resposta original.\n\n" +
                    `Prompt original:\n${prompt}`,
            },
            { role: "assistant" as const, content: trimForContinuation(currentText) || currentText },
            { role: "user" as const, content: CONTINUATION_INSTRUCTION },
        ];
        const continuation = await callTextFollowUpGroqFirst(continuationMessages, `continuation-${providerLabel}`);
        const merged = mergeContinuationText(currentText, continuation).trim();
        console.log(
            `[SIMCAR ANALYSIS] ${providerLabel} continuation merged (chars=${merged.length})`,
        );
        return merged || currentText;
    } catch (err: any) {
        console.warn(
            `[SIMCAR ANALYSIS] ${providerLabel} continuation failed: ${err?.message || String(err)}`,
        );
        return currentText;
    }
}

function toGeminiContents(
    messages: Array<{ role: string; content: any }>,
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    for (const msg of messages) {
        const text = normalizeAssistantContent(msg?.content).trim();
        if (!text) continue;
        const role = msg?.role === "assistant" ? "model" : "user";
        contents.push({ role, parts: [{ text }] });
    }
    return contents;
}

async function callGeminiTextOnce(
    model: string,
    messages: Array<{ role: string; content: any }>,
    maxOutputTokens = 8192,
): Promise<{ content: string; finishReason: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const contents = toGeminiContents(messages);
    if (contents.length === 0) {
        throw new Error("Sem conteúdo textual para síntese Gemini.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
        const response = await fetch(
            `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents,
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: maxOutputTokens,
                    },
                }),
                signal: controller.signal,
            },
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`${model}: ${response.status} - ${text.slice(0, 320)}`);
        }

        const data = await response.json() as any;
        const candidate = data?.candidates?.[0];
        const content = (candidate?.content?.parts || [])
            .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n")
            .trim();
        if (!content) {
            const finish = String(candidate?.finishReason || "");
            const blockReason = String(data?.promptFeedback?.blockReason || "");
            throw new Error(`${model}: empty response${finish ? ` (finish=${finish})` : ""}${blockReason ? ` (block=${blockReason})` : ""}`);
        }
        const usage = buildUsageFromGemini(model, data?.usageMetadata, "/api/simcar/clip/analyze/chat");
        if (usage.estimated) {
            usage.inputTokens = Math.max(
                Number(usage.inputTokens || 0),
                estimateTokensFromMessages(messages),
            );
            usage.outputTokens = Math.max(
                Number(usage.outputTokens || 0),
                estimateTokensFromText(content),
            );
        }
        recordModelUsage({
            provider: "gemini",
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimated: usage.estimated,
        });

        return {
            content,
            finishReason: String(candidate?.finishReason || "STOP"),
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function callGeminiTextSynthesis(
    messages: Array<{ role: string; content: any }>,
    contextLabel: string,
    options?: { modelChain?: string[]; maxOutputTokens?: number },
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY não configurada para síntese.");
    }

    const MAX_CONTINUATIONS = 2;
    const modelChain = Array.isArray(options?.modelChain) && options?.modelChain?.length
        ? options.modelChain
        : GEMINI_TEXT_SYNTHESIS_MODELS;
    const maxOutputTokens = Number.isFinite(options?.maxOutputTokens)
        ? Number(options?.maxOutputTokens)
        : 8192;
    let lastError = "";

    for (const model of modelChain) {
        try {
            const first = await callGeminiTextOnce(model, messages, maxOutputTokens);
            let merged = first.content.trim();
            let finishReason = first.finishReason;
            let continuationsUsed = 0;
            console.log(
                `[SIMCAR ANALYSIS] Gemini synthesis ${contextLabel}: model=${model} finish=${finishReason} chars=${merged.length}`,
            );

            while (isTruncationFinishReason(finishReason) && continuationsUsed < MAX_CONTINUATIONS) {
                continuationsUsed += 1;
                const continuationMessages = [
                    ...messages,
                    { role: "assistant" as const, content: trimForContinuation(merged) || merged },
                    { role: "user" as const, content: CONTINUATION_INSTRUCTION },
                ];
                const cont = await callGeminiTextOnce(model, continuationMessages, maxOutputTokens);
                merged = mergeContinuationText(merged, cont.content).trim();
                finishReason = cont.finishReason;
                console.log(
                    `[SIMCAR ANALYSIS] Gemini synthesis continuation ${continuationsUsed}: model=${model} finish=${finishReason} chars=${merged.length}`,
                );
            }

            if (merged) return merged;
            lastError = `${model}: empty response`;
        } catch (err: any) {
            const isTimeout = err?.name === "AbortError";
            lastError = `${model}: ${isTimeout ? "timeout (90s)" : (err?.message || String(err))}`;
            console.warn(`[SIMCAR ANALYSIS] Gemini synthesis model failed (${model}): ${lastError}`);
        }
    }

    throw new Error(`Gemini synthesis falhou para ${contextLabel}. Último erro: ${lastError}`);
}

async function probeGeminiModel(model: string): Promise<{ ok: boolean; error?: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { ok: false, error: "GEMINI_API_KEY ausente" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch(
            `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: "Responda somente OK." }] }],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 16,
                    },
                }),
                signal: controller.signal,
            },
        );

        if (!response.ok) {
            const text = await response.text();
            return { ok: false, error: `${response.status}: ${text.slice(0, 180)}` };
        }

        const data = await response.json() as any;
        const candidate = data?.candidates?.[0];
        const content = (candidate?.content?.parts || [])
            .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n")
            .trim();

        if (!content) {
            const finish = candidate?.finishReason ? ` finish=${candidate.finishReason}` : "";
            const block = data?.promptFeedback?.blockReason ? ` block=${data.promptFeedback.blockReason}` : "";
            return { ok: false, error: `empty_response${finish}${block}` };
        }

        return { ok: true };
    } catch (err: any) {
        const isAbort = err?.name === "AbortError";
        return { ok: false, error: isAbort ? "timeout (20s)" : (err?.message || String(err)) };
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveImageDataUrlForGemini(image: AiImage): Promise<string> {
    if (image.dataUrl) return image.dataUrl;
    // Prefer the Gemini-optimised URL (higher res) over the Groq-compressed one.
    const fetchUrl = image.geminiUrl ?? image.url;
    if (!fetchUrl) throw new Error(`Imagem sem URL/dataUrl: ${image.caption}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Falha ao baixar imagem para Gemini (${response.status}): ${text.slice(0, 180)}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arr = await response.arrayBuffer();
    const b64 = Buffer.from(arr).toString("base64");
    return `data:${contentType};base64,${b64}`;
}

/** Call Groq vision model with images. Multi-model fallback + reduced-image retry. */
async function callVisionAnalysis(
    images: AiImage[],
    prompt: string,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const VISION_TIMEOUT_MS = 120_000; // 2 minutes
    // Smaller images (post-compression) need fewer output tokens; cap output to reduce cost.
    const maxTokens = images.length > 3 ? 4500 : 3500;

    // Try full image set first, then reduced set (overview only) on failure
    const imageSets = [images];
    if (images.length > 3) {
        imageSets.push(reduceImageSet(images));
    }

    let lastError = "";
    let sawRateLimit = false;
    for (let attempt = 0; attempt < imageSets.length; attempt++) {
        const currentImages = imageSets[attempt];
        const contentParts = buildVisionContentParts(currentImages, prompt);
        const messages = [{ role: "user", content: contentParts }];

        if (attempt > 0) {
            console.log(`[SIMCAR ANALYSIS] Retrying with reduced image set (${currentImages.length} images)...`);
        }

        for (const model of ANALYSIS_VISION_MODELS) {
            if (isGroqModelRateLimited(model)) {
                const waitSecs = Math.max(1, Math.ceil(getGroqModelRateLimitRemainingMs(model) / 1000));
                sawRateLimit = true;
                lastError = `${model}: rate-limited (~${waitSecs}s)`;
                console.warn(`[SIMCAR ANALYSIS] Skipping Groq model ${model} (cooldown ~${waitSecs}s).`);
                continue;
            }
            try {
                console.log(`[SIMCAR ANALYSIS] Trying model: ${model} (${currentImages.length} images, attempt ${attempt + 1})`);

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.1,
                        max_tokens: maxTokens,
                        messages,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!response.ok) {
                    const text = await response.text();
                    lastError = `${model}: ${response.status} - ${text.slice(0, 300)}`;
                    console.warn(`[SIMCAR ANALYSIS] Model ${model} failed:`, lastError);
                    // Detect Groq rate limit — mark and propagate immediately
                    if (isRateLimitError(response.status, text)) {
                        sawRateLimit = true;
                        const retryAfterMs = extractRetryAfterMs(response.headers, text);
                        markGroqModelRateLimited(model, retryAfterMs);
                        continue;
                    }
                    // If payload too large (413/400), skip to reduced set immediately
                    if ((response.status === 413 || response.status === 400) && attempt === 0 && imageSets.length > 1) {
                        console.warn(`[SIMCAR ANALYSIS] Payload too large, switching to reduced image set`);
                        break; // break inner model loop, go to next attempt
                    }
                    continue;
                }

                const data = await response.json() as any;
                const choice = data?.choices?.[0];
                const content = normalizeAssistantContent(choice?.message?.content).trim();
                if (content) {
                    const usage = buildUsageFromGroq(model, data?.usage, "/api/simcar/clip/analyze");
                    if (usage.estimated) {
                        usage.inputTokens = Math.max(
                            Number(usage.inputTokens || 0),
                            estimateTokensFromText(prompt) + currentImages.length * 1400,
                        );
                        usage.outputTokens = Math.max(
                            Number(usage.outputTokens || 0),
                            estimateTokensFromText(content),
                        );
                    }
                    recordModelUsage({
                        provider: "groq",
                        model,
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        estimated: usage.estimated,
                    });
                    const finishReason = String(choice?.finish_reason || "stop");
                    const finalized = await continueTruncatedAnalysisText(
                        content,
                        prompt,
                        `Groq/${model}`,
                        finishReason,
                    );
                    console.log(`[SIMCAR ANALYSIS] Success with model: ${model} (attempt ${attempt + 1})`);
                    return finalized;
                }
                lastError = `${model}: empty response`;
            } catch (err: any) {
                const isTimeout = err.name === "AbortError";
                lastError = `${model}: ${isTimeout ? "timeout (120s)" : err.message}`;
                console.warn(`[SIMCAR ANALYSIS] Model ${model} ${isTimeout ? "timed out" : "exception"}:`, lastError);
            }
        }
    }
    if (sawRateLimit && !hasAvailableGroqModels(ANALYSIS_VISION_MODELS)) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(ANALYSIS_VISION_MODELS) / 1000));
        throw new GroqRateLimitError(`Todos os modelos de visão Groq estão em cooldown (~${waitSecs}s).`);
    }
    throw new Error(`Todos os modelos Groq falharam. Último erro: ${lastError}`);
}

function buildDualModelMergePrompt(
    contextLabel: string,
    groqAnalysis: string,
    geminiAnalysis: string,
): string {
    return [
        "Você é a GeoForest IA e deve consolidar duas análises técnicas da MESMA área e do MESMO período.",
        `Contexto do recorte: ${contextLabel}`,
        "",
        "## Análise Groq",
        groqAnalysis,
        "",
        "## Análise Gemini",
        geminiAnalysis,
        "",
        "## Tarefa",
        "Produza um texto único e técnico em português com:",
        "1) Consensos principais entre os dois modelos.",
        "2) Divergências relevantes e a hipótese mais provável.",
        "3) Conclusão consolidada para este período.",
        "",
        "Seja objetivo e não repita integralmente os textos de origem.",
    ].join("\n");
}

function splitThinkProgress(raw: string) {
    let visible = "";
    const thinkParts: string[] = [];
    let cursor = 0;

    while (cursor < raw.length) {
        const start = raw.indexOf("<think>", cursor);
        if (start === -1) {
            visible += raw.slice(cursor);
            break;
        }
        visible += raw.slice(cursor, start);
        const thinkStart = start + "<think>".length;
        const end = raw.indexOf("</think>", thinkStart);
        if (end === -1) {
            thinkParts.push(raw.slice(thinkStart));
            break;
        }
        thinkParts.push(raw.slice(thinkStart, end));
        cursor = end + "</think>".length;
    }

    return {
        thinkingText: thinkParts.join("\n\n").trim(),
        answerText: visible.trim(),
    };
}

async function callGeminiVisionAnalysis(
    images: AiImage[],
    prompt: string,
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const VISION_TIMEOUT_MS = 120_000;
    const imageSets = [images];
    if (images.length > 3) {
        imageSets.push(reduceImageSet(images));
    }

    let lastError = "";
    for (let attempt = 0; attempt < imageSets.length; attempt++) {
        const currentImages = imageSets[attempt];
        const parts: any[] = [{ text: prompt }];
        for (const img of currentImages) {
            const dataUrl = await resolveImageDataUrlForGemini(img);
            const parsed = parseDataUrl(dataUrl);
            parts.push({
                inline_data: {
                    mime_type: parsed.mimeType,
                    data: parsed.base64,
                },
            });
            parts.push({ text: `[Legenda: ${img.caption}]` });
        }

        for (const model of GEMINI_VISION_MODELS) {
            try {
                console.log(`[SIMCAR ANALYSIS] Trying Gemini model: ${model} (${currentImages.length} images, attempt ${attempt + 1})`);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

                const response = await fetch(
                    `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ role: "user", parts }],
                            generationConfig: {
                                temperature: 0.1,
                                // Gemini 2.5 suporta saídas longas (até 65k tokens).
                                // 8192 permite laudos detalhados sem corte artificial.
                                maxOutputTokens: 8192,
                            },
                        }),
                        signal: controller.signal,
                    },
                );
                clearTimeout(timeout);

                if (!response.ok) {
                    const text = await response.text();
                    lastError = `${model}: ${response.status} - ${text.slice(0, 280)}`;
                    console.warn(`[SIMCAR ANALYSIS] Gemini model ${model} failed:`, lastError);
                    continue;
                }

                const data = await response.json() as any;
                const candidate = data?.candidates?.[0];
                const content = (candidate?.content?.parts || [])
                    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
                    .filter(Boolean)
                    .join("\n")
                    .trim();

                if (content) {
                    const usage = buildUsageFromGemini(model, data?.usageMetadata, "/api/simcar/clip/analyze");
                    if (usage.estimated) {
                        // Use tile-based formula for Gemini (1024x768 = 2 tiles wide, 1 tile tall = 2*258=516 tokens/image)
                        const geminiImageTokensPerImg = estimateImageTokens(1024, 768);
                        usage.inputTokens = Math.max(
                            Number(usage.inputTokens || 0),
                            estimateTokensFromText(prompt) + currentImages.length * geminiImageTokensPerImg,
                        );
                        usage.outputTokens = Math.max(
                            Number(usage.outputTokens || 0),
                            estimateTokensFromText(content),
                        );
                    }
                    recordModelUsage({
                        provider: "gemini",
                        model,
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        estimated: usage.estimated,
                    });
                    const finalized = await continueTruncatedAnalysisText(
                        content,
                        prompt,
                        `Gemini/${model}`,
                        candidate?.finishReason,
                    );
                    console.log(`[SIMCAR ANALYSIS] Success with Gemini model: ${model} (attempt ${attempt + 1})`);
                    return finalized;
                }
                const blockReason = data?.promptFeedback?.blockReason;
                lastError = `${model}: empty response${blockReason ? ` (${blockReason})` : ""}`;
            } catch (err: any) {
                const isTimeout = err.name === "AbortError";
                lastError = `${model}: ${isTimeout ? "timeout (120s)" : err.message}`;
                console.warn(`[SIMCAR ANALYSIS] Gemini model ${model} ${isTimeout ? "timed out" : "exception"}:`, lastError);
            }
        }
    }

    throw new Error(`Gemini falhou. Último erro: ${lastError}`);
}

async function analyzeWithGroqAndGemini(
    images: AiImage[],
    prompt: string,
    contextLabel: string,
): Promise<string> {
    if (images.length === 0) {
        throw new Error(`Sem imagens para análise (${contextLabel}).`);
    }

    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasGroq = Boolean(process.env.GROQ_API_KEY);

    if (!hasGemini && !hasGroq) {
        throw new Error("Nenhuma API key configurada (GEMINI_API_KEY / GROQ_API_KEY).");
    }

    // -- Groq-first approach: always try Groq first (free tier), only fall back to Gemini --
    // This avoids wasting Groq tokens by sending ALL images to a single provider.

    const groqAvailable = hasGroq && hasAvailableGroqModels(ANALYSIS_VISION_MODELS);

    if (groqAvailable) {
        console.log(
            `[SIMCAR ANALYSIS] ${contextLabel}: Groq-first — sending all ${images.length} images to Groq`,
        );

        try {
            return await callVisionAnalysis(images, prompt);
        } catch (err: any) {
            const isRateLimit = err instanceof GroqRateLimitError;
            const errMsg = String(err?.message || err);
            console.warn(
                `[SIMCAR ANALYSIS] Groq primary failed for ${contextLabel}${isRateLimit ? " (RATE LIMITED)" : ""}: ${errMsg}`,
            );

            // If Groq failed but NOT rate-limited and no Gemini, throw
            if (!hasGemini) {
                throw new Error(`Groq falhou para ${contextLabel} e GEMINI_API_KEY ausente. Erro: ${errMsg}`);
            }

            // Fall through to Gemini fallback
            console.log(
                `[SIMCAR ANALYSIS] ${contextLabel}: Groq failed${isRateLimit ? " (rate limit)" : ""}, falling back to Gemini`,
            );
        }
    } else if (hasGroq) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(ANALYSIS_VISION_MODELS) / 1000));
        console.log(
            `[SIMCAR ANALYSIS] ${contextLabel}: modelos Groq de visão em cooldown (~${waitSecs}s), pulando direto para Gemini`,
        );
    }

    // -- Gemini fallback: Groq failed or is rate-limited --
    if (hasGemini) {
        try {
            return await callGeminiVisionAnalysis(images, prompt);
        } catch (gemErr: any) {
            const gemErrMsg = String(gemErr?.message || gemErr);
            console.warn(`[SIMCAR ANALYSIS] Gemini fallback also failed for ${contextLabel}: ${gemErrMsg}`);

            // Last resort: if Groq was rate-limited but cooldown may have passed, retry Groq
            if (hasGroq && !groqAvailable && hasAvailableGroqModels(ANALYSIS_VISION_MODELS)) {
                console.log(`[SIMCAR ANALYSIS] ${contextLabel}: Groq cooldown expired, retrying Groq as last resort`);
                try {
                    return await callVisionAnalysis(images, prompt);
                } catch (retryErr: any) {
                    throw new Error(
                        `Groq e Gemini falharam para ${contextLabel}. Groq=${retryErr?.message || retryErr} | Gemini=${gemErrMsg}`,
                    );
                }
            }

            throw new Error(`Gemini falhou para ${contextLabel}. Erro: ${gemErrMsg}`);
        }
    }

    // Only Groq available (no Gemini key) and Groq is rate-limited
    if (!hasGemini && hasGroq) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(ANALYSIS_VISION_MODELS) / 1000));
        throw new Error(
            `Groq rate-limited e GEMINI_API_KEY ausente para ${contextLabel}. ` +
            `Aguarde ~${waitSecs}s e tente novamente.`,
        );
    }

    throw new Error(`Nenhum provedor disponível para ${contextLabel}.`);
}

/** Call Groq with text-only follow-up message. Multi-model fallback. */
function normalizeAssistantContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part.text === "string") return part.text;
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    return content == null ? "" : String(content);
}

function trimForContinuation(text: string): string {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    const regex = /([.!?])(?=\s|$)|\n{2,}/g;
    let lastBoundary = -1;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalized)) !== null) {
        lastBoundary = match.index + match[0].length;
    }
    if (lastBoundary <= 0) {
        return normalized;
    }
    return normalized.slice(0, lastBoundary).trim();
}

function mergeContinuationText(current: string, addition: string): string {
    const base = String(current || "").trimEnd();
    const next = String(addition || "").trim();
    if (!next) return base;
    if (!base) return next;
    if (base.includes(next)) return base;
    if (next.includes(base)) return next;

    // Remove overlap when continuation repeats a fragment from the end.
    const maxOverlap = Math.min(800, base.length, next.length);
    for (let size = maxOverlap; size >= 40; size--) {
        if (base.slice(-size) === next.slice(0, size)) {
            return `${base}${next.slice(size)}`.trim();
        }
    }
    return `${base}\n${next}`.trim();
}

function clampTextMiddle(text: string, maxChars: number): string {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    if (normalized.length <= maxChars) return normalized;
    const head = Math.max(120, Math.floor(maxChars * 0.72));
    const tail = Math.max(80, maxChars - head - 22);
    return `${normalized.slice(0, head)}\n...[conteudo resumido]...\n${normalized.slice(-tail)}`;
}

function compactChatMessages(
    rawMessages: Array<{ role: string; content: any }>,
): Array<{ role: "user" | "assistant"; content: string }> {
    const maxMessages = Math.max(4, SIMCAR_CHAT_MAX_MESSAGES);
    const maxCharsPerMessage = Math.max(300, SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE);
    const maxTotalChars = Math.max(1800, SIMCAR_CHAT_MAX_TOTAL_CHARS);

    const prepared: Array<{ role: "user" | "assistant"; content: string }> = rawMessages
        .map((msg): { role: "user" | "assistant"; content: string } => {
            const role: "user" | "assistant" = msg?.role === "assistant" ? "assistant" : "user";
            const content = clampTextMiddle(normalizeAssistantContent(msg?.content), maxCharsPerMessage);
            return { role, content };
        })
        .filter((msg) => Boolean(msg.content));

    if (prepared.length === 0) return [];

    const kept: Array<{ role: "user" | "assistant"; content: string }> = [];
    let totalChars = 0;
    for (let idx = prepared.length - 1; idx >= 0; idx--) {
        const msg = prepared[idx];
        const nextSize = totalChars + msg.content.length;
        if (kept.length >= maxMessages || nextSize > maxTotalChars) break;
        kept.push(msg);
        totalChars = nextSize;
    }
    kept.reverse();

    // Ensure at least one user turn survives (latest if needed).
    if (!kept.some((m) => m.role === "user")) {
        const fallbackUser = [...prepared].reverse().find((m) => m.role === "user");
        if (fallbackUser) {
            kept.push(fallbackUser);
        }
    }

    return kept;
}

async function callGroqTextOnce(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: any }>,
    maxTokens: number,
): Promise<{ content: string; finishReason: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.1,
                max_tokens: maxTokens,
                messages,
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text();
            if (isRateLimitError(response.status, text)) {
                const retryAfterMs = extractRetryAfterMs(response.headers, text);
                markGroqModelRateLimited(model, retryAfterMs);
                throw new GroqRateLimitError(
                    `Groq rate-limited: ${model}: ${response.status} - ${text.slice(0, 240)}`,
                    model,
                    retryAfterMs ?? undefined,
                );
            }
            throw new Error(`${model}: ${response.status} - ${text.slice(0, 240)}`);
        }
        const data = await response.json() as any;
        const choice = data?.choices?.[0];
        const content = normalizeAssistantContent(choice?.message?.content).trim();
        const finishReason = String(choice?.finish_reason || "stop");
        if (!content) {
            throw new Error(`${model}: empty response`);
        }
        const usage = buildUsageFromGroq(model, data?.usage, "/api/simcar/clip/analyze/chat");
        if (usage.estimated) {
            usage.inputTokens = Math.max(
                Number(usage.inputTokens || 0),
                estimateTokensFromMessages(messages),
            );
            usage.outputTokens = Math.max(
                Number(usage.outputTokens || 0),
                estimateTokensFromText(content),
            );
        }
        recordModelUsage({
            provider: "groq",
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimated: usage.estimated,
        });
        return { content, finishReason };
    } finally {
        clearTimeout(timeout);
    }
}

/** Groq-first text call: tries Groq text models, falls back to Gemini synthesis if rate-limited. */
async function callTextFollowUpGroqFirst(
    messages: Array<{ role: string; content: any }>,
    contextLabel = "text-followup",
): Promise<string> {
    const hasGroq = Boolean(process.env.GROQ_API_KEY);
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const groqAvailable = hasGroq && hasAvailableGroqModels(GROQ_TEXT_MODELS);

    if (groqAvailable) {
        try {
            return await callTextFollowUp(messages);
        } catch (err: any) {
            const isRateLimit = err instanceof GroqRateLimitError;
            console.warn(`[SIMCAR ANALYSIS] Groq text failed for ${contextLabel}${isRateLimit ? " (RATE LIMITED)" : ""}: ${err?.message || err}`);
            if (!hasGemini) throw err;
            // Fall through to Gemini
        }
    }

    if (hasGemini) {
        try {
            return await callGeminiTextSynthesis(messages, contextLabel);
        } catch (gemErr: any) {
            console.warn(`[SIMCAR ANALYSIS] Gemini text fallback failed for ${contextLabel}: ${gemErr?.message || gemErr}`);
            // Last resort: if Groq cooldown expired, retry
            if (hasGroq && !groqAvailable && hasAvailableGroqModels(GROQ_TEXT_MODELS)) {
                return callTextFollowUp(messages);
            }
            throw gemErr;
        }
    }

    return callTextFollowUp(messages); // Groq-only path (no Gemini key)
}

/**
 * Best-quality synthesis path:
 * 1) Prefer Gemini with an explicit best-text chain.
 * 2) Fallback to Groq text models only if Gemini fails/unavailable.
 */
async function callBestTextSynthesis(
    messages: Array<{ role: string; content: any }>,
    contextLabel = "text-synthesis",
    options?: { modelChain?: string[]; maxOutputTokens?: number },
): Promise<string> {
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasGroq = Boolean(process.env.GROQ_API_KEY);
    const modelChain = Array.isArray(options?.modelChain) && options.modelChain.length > 0
        ? options.modelChain
        : SIMCAR_SYNTHESIS_TEXT_MODELS;
    const maxOutputTokens = Number.isFinite(options?.maxOutputTokens)
        ? Number(options?.maxOutputTokens)
        : 8192;
    let geminiError = "";

    if (hasGemini) {
        try {
            console.log(
                `[SIMCAR ANALYSIS] ${contextLabel}: best-text synthesis via Gemini chain: ${modelChain.join(", ")}`,
            );
            return await callGeminiTextSynthesis(messages, contextLabel, {
                modelChain,
                maxOutputTokens,
            });
        } catch (err: any) {
            geminiError = err?.message || String(err);
            console.warn(`[SIMCAR ANALYSIS] Best-text Gemini failed for ${contextLabel}: ${geminiError}`);
        }
    }

    if (hasGroq) {
        try {
            if (!hasAvailableGroqModels(GROQ_TEXT_MODELS)) {
                const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(GROQ_TEXT_MODELS) / 1000));
                console.warn(
                    `[SIMCAR ANALYSIS] ${contextLabel}: Groq in cooldown (~${waitSecs}s), tentando fallback mesmo assim.`,
                );
            }
            return await callTextFollowUp(messages);
        } catch (groqErr: any) {
            const groqError = groqErr?.message || String(groqErr);
            if (geminiError) {
                throw new Error(`Síntese falhou. Gemini=${geminiError} | Groq=${groqError}`);
            }
            throw groqErr;
        }
    }

    if (geminiError) {
        throw new Error(`Síntese falhou com Gemini: ${geminiError}`);
    }
    throw new Error("Nenhum provedor de texto configurado para síntese.");
}

async function callTextFollowUp(
    messages: Array<{ role: string; content: any }>,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const MAX_TOKENS = 2200;
    const MAX_CONTINUATIONS = 2;

    let lastError = "";
    let sawRateLimit = false;
    for (const model of GROQ_TEXT_MODELS) {
        if (isGroqModelRateLimited(model)) {
            const waitSecs = Math.max(1, Math.ceil(getGroqModelRateLimitRemainingMs(model) / 1000));
            sawRateLimit = true;
            lastError = `${model}: rate-limited (~${waitSecs}s)`;
            console.warn(`[SIMCAR ANALYSIS] Skipping text model ${model} (cooldown ~${waitSecs}s).`);
            continue;
        }
        try {
            const first = await callGroqTextOnce(apiKey, model, messages, MAX_TOKENS);
            console.log(
                `[SIMCAR ANALYSIS] Text model ${model} ok (finish=${first.finishReason}, chars=${first.content.length})`,
            );

            let activeModel = model;
            let mergedContent = first.content;
            let finishReason = first.finishReason;
            let continuationsUsed = 0;

            while (finishReason === "length" && continuationsUsed < MAX_CONTINUATIONS) {
                continuationsUsed += 1;
                const assistantSoFar = trimForContinuation(mergedContent);
                const continuationMessages = [
                    ...messages,
                    { role: "assistant" as const, content: assistantSoFar || mergedContent },
                    { role: "user" as const, content: CONTINUATION_INSTRUCTION },
                ];

                let continuationObtained = false;
                const continuationCandidates = [activeModel, ...GROQ_TEXT_MODELS.filter((m) => m !== activeModel)];
                for (const candidate of continuationCandidates) {
                    if (isGroqModelRateLimited(candidate)) {
                        const waitSecs = Math.max(1, Math.ceil(getGroqModelRateLimitRemainingMs(candidate) / 1000));
                        sawRateLimit = true;
                        lastError = `${candidate}: rate-limited (~${waitSecs}s)`;
                        continue;
                    }
                    try {
                        const cont = await callGroqTextOnce(apiKey, candidate, continuationMessages, MAX_TOKENS);
                        mergedContent = mergeContinuationText(mergedContent, cont.content);
                        finishReason = cont.finishReason;
                        activeModel = candidate;
                        continuationObtained = true;
                        console.log(
                            `[SIMCAR ANALYSIS] Continuation ${continuationsUsed} via ${candidate} (finish=${finishReason}, chars=${mergedContent.length})`,
                        );
                        break;
                    } catch (err: any) {
                        if (err instanceof GroqRateLimitError) {
                            sawRateLimit = true;
                            lastError = err?.message || `${candidate}: rate-limited`;
                            continue;
                        }
                        const detail = err?.name === "AbortError" ? "timeout (60s)" : (err?.message || String(err));
                        lastError = `${candidate}: ${detail}`;
                        console.warn(`[SIMCAR ANALYSIS] Continuation failed (${candidate}): ${detail}`);
                    }
                }

                if (!continuationObtained) {
                    console.warn("[SIMCAR ANALYSIS] Continuation unavailable; retornando resposta parcial melhor-esforco.");
                    break;
                }
            }

            return mergedContent.trim();
        } catch (err: any) {
            if (err instanceof GroqRateLimitError) {
                sawRateLimit = true;
                lastError = err?.message || `${model}: rate-limited`;
                continue;
            }
            const isTimeout = err.name === "AbortError";
            lastError = `${model}: ${isTimeout ? "timeout (60s)" : err.message}`;
            console.warn(`[SIMCAR ANALYSIS] Text model ${model} failed: ${lastError}`);
        }
    }
    if (sawRateLimit && !hasAvailableGroqModels(GROQ_TEXT_MODELS)) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(GROQ_TEXT_MODELS) / 1000));
        throw new GroqRateLimitError(`Todos os modelos de texto Groq estão em cooldown (~${waitSecs}s).`);
    }
    throw new Error(`Falha nos modelos de texto Groq. Último erro: ${lastError}`);
}

async function streamTextFollowUp(
    res: Response,
    messages: Array<{ role: string; content: any }>,
): Promise<void> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const MAX_TOKENS = 2200;
    const MAX_CONTINUATIONS = 2;

    let accumulatedAnswer = "";
    let accumulatedThinking = "";
    let activeModel = "";

    const writeChunk = (payload: Record<string, any>) => {
        sendSSE(res, payload);
    };

    const streamModelSegment = async (
        segmentModel: string,
        segmentMessages: Array<{ role: string; content: any }>,
    ): Promise<{ finishReason: string; segmentText: string }> => {
        const segmentInputTokens = estimateTokensFromMessages(segmentMessages);
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: segmentModel,
                temperature: 0.1,
                max_tokens: MAX_TOKENS,
                stream: true,
                messages: segmentMessages,
            }),
        });

        if (!upstream.ok || !upstream.body) {
            const text = await upstream.text();
            if (isRateLimitError(upstream.status, text)) {
                const retryAfterMs = extractRetryAfterMs(upstream.headers, text);
                markGroqModelRateLimited(segmentModel, retryAfterMs);
                throw new GroqRateLimitError(
                    `groq ${segmentModel} ${upstream.status}: ${text.slice(0, 320)}`,
                    segmentModel,
                    retryAfterMs ?? undefined,
                );
            }
            throw new Error(`groq ${segmentModel} ${upstream.status}: ${text.slice(0, 320)}`);
        }

        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        let buffer = "";
        let finishReason = "";
        let segmentRaw = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data) continue;
                if (data === "[DONE]") {
                    recordModelUsage({
                        provider: "groq",
                        model: segmentModel,
                        inputTokens: Math.max(1, segmentInputTokens),
                        outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
                        estimated: true,
                    });
                    return { finishReason: finishReason || "stop", segmentText: segmentRaw };
                }
                try {
                    const parsed = JSON.parse(data);
                    const choice = parsed?.choices?.[0];
                    const delta = choice?.delta?.content;
                    const fr = choice?.finish_reason;
                    if (typeof fr === "string" && fr) finishReason = fr;
                    if (typeof delta === "string" && delta.length > 0) {
                        segmentRaw += delta;
                        const segSplit = splitThinkProgress(segmentRaw);
                        writeChunk({
                            type: "delta",
                            model: segmentModel,
                            thinkingText: mergeContinuationText(accumulatedThinking, segSplit.thinkingText),
                            answerText: mergeContinuationText(accumulatedAnswer, segSplit.answerText),
                        });
                    }
                } catch {
                    // ignore malformed upstream chunks
                }
            }
        }

        recordModelUsage({
            provider: "groq",
            model: segmentModel,
            inputTokens: Math.max(1, segmentInputTokens),
            outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
            estimated: true,
        });
        return { finishReason: finishReason || "stop", segmentText: segmentRaw };
    };

    let firstResult: { finishReason: string; segmentText: string } | null = null;
    for (const candidate of GROQ_TEXT_MODELS) {
        if (isGroqModelRateLimited(candidate)) {
            continue;
        }
        try {
            firstResult = await streamModelSegment(candidate, messages);
            activeModel = candidate;
            break;
        } catch (err) {
            console.warn(`[SIMCAR ANALYSIS CHAT] startup model failed (${candidate})`, err);
        }
    }
    if (!firstResult) {
        if (!hasAvailableGroqModels(GROQ_TEXT_MODELS)) {
            const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(GROQ_TEXT_MODELS) / 1000));
            throw new GroqRateLimitError(`Todos os modelos de texto Groq estão em cooldown (~${waitSecs}s).`);
        }
        throw new Error("Nenhum modelo disponível para iniciar resposta.");
    }

    const firstSplit = splitThinkProgress(firstResult.segmentText);
    accumulatedAnswer = mergeContinuationText(accumulatedAnswer, firstSplit.answerText);
    accumulatedThinking = mergeContinuationText(accumulatedThinking, firstSplit.thinkingText);

    let continuationsUsed = 0;
    let lastFinishReason = firstResult.finishReason;

    while (lastFinishReason === "length" && continuationsUsed < MAX_CONTINUATIONS) {
        continuationsUsed += 1;
        const assistantSoFar = trimForContinuation(accumulatedAnswer);
        const continuationMessages = [
            ...messages,
            { role: "assistant" as const, content: assistantSoFar || accumulatedAnswer },
            { role: "user" as const, content: CONTINUATION_INSTRUCTION },
        ];

        let contResult: { finishReason: string; segmentText: string } | null = null;
        const candidates = [activeModel, ...GROQ_TEXT_MODELS.filter((m) => m !== activeModel)];
        for (const candidate of candidates) {
            if (isGroqModelRateLimited(candidate)) continue;
            try {
                contResult = await streamModelSegment(candidate, continuationMessages);
                activeModel = candidate;
                break;
            } catch (err) {
                console.warn(`[SIMCAR ANALYSIS CHAT] continuation failed (${candidate})`, err);
            }
        }
        if (!contResult) break;

        const contSplit = splitThinkProgress(contResult.segmentText);
        accumulatedAnswer = mergeContinuationText(accumulatedAnswer, contSplit.answerText);
        accumulatedThinking = mergeContinuationText(accumulatedThinking, contSplit.thinkingText);
        lastFinishReason = contResult.finishReason;
    }

    const finalThinking = accumulatedThinking.trim();
    const finalAnswer = accumulatedAnswer.trim();
    const finalContent = finalThinking
        ? `<think>\n${finalThinking}\n</think>\n\n${finalAnswer}`
        : finalAnswer;

    writeChunk({
        type: "complete",
        model: activeModel || GROQ_TEXT_MODELS[0],
        thinkingText: finalThinking,
        answerText: finalAnswer,
        content: finalContent,
    });
}

/** Pad bbox by a percentage to give visual margin. */
function padBbox(
    bbox: [number, number, number, number],
    paddingPercent = 0.15,
): [number, number, number, number] {
    const dx = (bbox[2] - bbox[0]) * paddingPercent;
    const dy = (bbox[3] - bbox[1]) * paddingPercent;
    return [
        bbox[0] - dx,
        bbox[1] - dy,
        bbox[2] + dx,
        bbox[3] + dy,
    ];
}

/** Build shared context block (property info + quantitative table). */
function buildPropertyContext(
    areaHa: number,
    layerSummaries: LayerSummary[],
    options?: { compact?: boolean; maxRows?: number },
): string {
    const compact = Boolean(options?.compact);
    const maxRows = Math.max(4, options?.maxRows ?? (compact ? 10 : 28));
    const acSummary = layerSummaries.find((l) => l.name === "AREA_CONSOLIDADA");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN");
    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    const atpSummary = layerSummaries.find((l) => l.name === "ATP");
    const arlSummary = layerSummaries.find((l) => l.name === "ARL");
    const arlremSummary = layerSummaries.find((l) => l.name === "ARLREM");

    const nonZeroRows = layerSummaries
        .filter((l) => l.features > 0)
        .sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0));

    const alwaysKeep = new Set(["ATP", "AREA_CONSOLIDADA", "AVN", "AUAS", "ARL", "ARLREM"]);
    const chosenRows = compact
        ? [
            ...nonZeroRows.filter((l) => alwaysKeep.has(l.name)),
            ...nonZeroRows.filter((l) => !alwaysKeep.has(l.name)),
        ]
            .filter((l, idx, arr) => arr.findIndex((x) => x.name === l.name) === idx)
            .slice(0, maxRows)
        : nonZeroRows;

    const quantRows = chosenRows
        .map((l) => {
            const pct = areaHa > 0 ? ((l.areaHa ?? 0) / areaHa * 100).toFixed(1) : "?";
            return `| ${l.name} | ${l.features} | ${l.areaHa?.toFixed(2) ?? '-'} ha | ${pct}% |`;
        });

    // ARL/ARLREM legal compliance context
    const arlTotalHa = (arlSummary?.areaHa ?? 0) + (arlremSummary?.areaHa ?? 0);
    const arlPct = areaHa > 0 ? (arlTotalHa / areaHa * 100).toFixed(1) : "?";
    const hasArl = arlTotalHa > 0;

    return [
        "## Contexto do Imóvel Rural",
        "",
        `| Parâmetro | Valor |`,
        `|-----------|-------|`,
        `| Área Total da Propriedade (ATP) | **${areaHa.toFixed(2)} ha** |`,
        `| Área Consolidada (AC) | ${acSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((acSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) — ${acSummary?.features ?? 0} feições |`,
        `| Vegetação Nativa (AVN) | ${avnSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((avnSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) — ${avnSummary?.features ?? 0} feições |`,
        `| AUAS (uso alternativo) | ${auasSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((auasSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) - ${auasSummary?.features ?? 0} feições |`,
        hasArl ? `| Reserva Legal (ARL+ARLREM) | ${arlTotalHa.toFixed(2)} ha (${arlPct}% do imóvel) — ARL: ${arlSummary?.areaHa?.toFixed(2) ?? '0'} ha, ARLREM: ${arlremSummary?.areaHa?.toFixed(2) ?? '0'} ha |` : "",
        atpSummary ? `| ATP (polígono declarado) | ${atpSummary.areaHa?.toFixed(2) ?? '-'} ha |` : "",
        "",
        compact ? "### Quantitativos-chave (SIMCAR Digital)" : "### Quantitativos completos (SIMCAR Digital)",
        "| Camada | Feições | Área | % do Imóvel |",
        "|--------|---------|------|-----------|",
        ...quantRows,
        compact && nonZeroRows.length > chosenRows.length
            ? `\n*Resumo reduzido para eficiência de tokens: exibindo ${chosenRows.length} de ${nonZeroRows.length} camadas com feições.*`
            : "",
    ].join("\n");
}

/** Build prompt for a SINGLE satellite analysis (3 images). */
function buildSingleSatellitePrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    satelliteKey: string,
    cloudWarning?: { satellite: string; cloudScore: number },
    acAvnAuasContext?: AcAvnAuasContext | null,
): string {
    const sat = SATELLITE_LAYERS[satelliteKey];
    const meta = getSatelliteMetadata(satelliteKey);
    const sensor = `${meta.sensor} (${meta.spatialResolution})`;
    const hasAuas = Boolean(acAvnAuasContext?.hasAuasLayer);
    const auasContext = hasAuas && acAvnAuasContext ? acAvnAuasContext : null;
    const year = Number(sat?.year || 0);
    const isPreMarco = year <= 2008;
    const arlSummary = layerSummaries.find((l) => l.name === "ARL");
    const arlremSummary = layerSummaries.find((l) => l.name === "ARLREM");
    const hasArl = ((arlSummary?.areaHa ?? 0) + (arlremSummary?.areaHa ?? 0)) > 0;

    return [
        "Você é a **GeoForest IA**, especialista em sensoriamento remoto e análise ambiental para imóveis rurais em Mato Grosso.",
        "Analise as 3 imagens do satélite fornecido comparando com os dados vetoriais do CAR.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "---",
        "",
        `## Imagens: ${sat.label} — ${sensor}`,
        `**Referência temporal:** esta cena é ${isPreMarco ? "pré-marco ou marco temporal (≤ 2008)" : "pós-marco temporal (> 2008)"} — referência legal: 22/07/2008 (Art. 68, Lei 12.651/2012).`,
        `**Peso da evidência deste sensor:** resolução ${meta.spatialResolution}${meta.spatialResolution.includes("2.5") ? " (alta — suficiente para confirmação isolada)" : meta.spatialResolution.includes("10") ? " (média — verificar com outra fonte se possível)" : " (baixa — requer confirmação cruzada com sensor de maior resolução)"}.`,
        "",
        `- **Bandas espectrais**: ${meta.spectralBands}`,
        `- **Revisita**: a cada ${meta.revisitDays} dias`,
        `- **Resolução espacial**: ${meta.spatialResolution}`,
        `- **Uso ideal**: ${meta.bestUseCase}`,
        "",
        ...(cloudWarning
            ? [
                `> ⚠️ **Atenção: Cobertura de nuvens detectada** (score: ${(cloudWarning.cloudScore * 100).toFixed(0)}%).`,
                "> Áreas ocluídas devem ser classificadas como INCONCLUSIVO, não como uso antrópico.",
                "",
            ]
            : []),
        ...(hasAuas
            ? [
                "**Contexto vetorial AUAS × AVN:**",
                `- AUAS declarada: **${auasContext?.auasAreaHa.toFixed(2)} ha**`,
                `- AVN declarada: **${auasContext?.avnAreaHa.toFixed(2)} ha**`,
                `- Sobreposição AUAS∩AVN: ${auasContext?.overlapAreaHa.toFixed(2)} ha (${auasContext?.overlapPctOfAuas.toFixed(1)}% da AUAS)`,
                `- AUAS fora do AVN: ${auasContext?.auasOutsideAvnAreaHa.toFixed(2)} ha — verifique cobertura nessa zona`,
                "",
            ]
            : []),
        "**Legenda dos polígonos:**",
        "- 🟥 **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- 🟪 **Roxo semi-transparente**: ÁREA CONSOLIDADA (AC) — uso antrópico declarado",
        "- 🟨 **Amarelo semi-transparente**: VEGETAÇÃO NATIVA (AVN) — vegetação nativa declarada",
        ...(hasAuas ? ["- ⬜ **Branco semi-transparente**: AUAS — uso alternativo do solo"] : []),
        ...(hasArl ? ["- 🟩 **Verde tracejado**: RESERVA LEGAL (ARL/ARLREM)"] : []),
        "",
        `- Imagem 1: Visão Geral — base ${sat.label} + propriedade + AC + AVN${hasAuas ? " + AUAS" : ""}${hasArl ? " + ARL" : ""}`,
        `- Imagem 2: Área Consolidada — base ${sat.label} + propriedade + somente AC`,
        `- Imagem 3: AVN — base ${sat.label} + propriedade + somente AVN`,
        "",
        "---",
        "",
        "## Análise da Área Consolidada (AC — polígono roxo)",
        "- As áreas em roxo correspondem a uso antrópico visível (pastagem limpa, agricultura, solo exposto, benfeitorias)?",
        "- Padrão de textura antrópica: pastagem → tonalidade uniforme; agricultura → linhas regulares; solo exposto → tons claros sem estrutura.",
        "- Algum trecho de AC apresenta textura de vegetação nativa (dossel rugoso, gradiente verde-escuro, estrutura de Cerrado/Floresta)?",
        "- **Atenção campo nativo:** em Cerrado, distinguir campo nativo (tonalidade clara com textura variada e manchas arbustivas intercaladas) de pastagem degradada (tonalidade uniforme sem arbustos). Campo nativo NÃO é uso antrópico.",
        "- Para cada zona da AC, estimar percentual de concordância/discordância com a classificação CAR.",
        "- Indicar localização aproximada dos trechos discordantes: 'porção norte', 'borda leste', 'setor central', etc., e estimar área em hectares quando viável.",
        "",
        "## Análise da Vegetação Nativa (AVN — polígono amarelo)",
        "- As áreas em amarelo apresentam textura de vegetação nativa contínua (floresta, cerrado, mata ciliar)?",
        "- Distinguir tipologias: Floresta → dossel denso e contínuo; Cerrado → mosaico arbustivo-herbáceo; Campo nativo → tonalidade mais clara com textura variada.",
        "- Algum trecho de AVN parece antropizado (pastagem, desmatamento, queimada recente, cicatriz de fogo)?",
        "- Avaliar integridade e conectividade: fragmentação, clareiras, bordas antropizadas.",
        "- **Bordas de transição AC/AVN:** examinar a faixa de transição entre AC e AVN. Se a borda for gradual (buffer de incerteza), reportar como zona de transição com largura estimada, não como discordância categórica.",
        ...(hasAuas
            ? [
                "- Verificar se existe vegetação nativa aparente fora do AVN, porém dentro do shape AUAS (contorno branco).",
            ]
            : []),
        "",
        ...(hasArl
            ? [
                "## Análise da Reserva Legal (ARL — polígono verde)",
                "- A vegetação dentro da ARL apresenta integridade? (dossel contínuo, sem clareiras, sem sinais de degradação)",
                "- Há uso antrópico dentro da ARL declarada? (pastagem, lavoura, solo exposto, estrada interna)",
                "- Se houver uso antrópico dentro da ARL, estimar porcentagem afetada e localização.",
                "",
            ]
            : []),
        "## Concordâncias e Discordâncias",
        "- **✅ CONCORDA**: áreas onde a classificação CAR coincide com o uso visível.",
        "- **❌ DISCORDA**: áreas onde a classificação não condiz. Indicar: (a) classificação mais apropriada, (b) localização relativa (porção N/NE/S etc.), (c) área estimada em hectares.",
        "- **⚠️ INCONCLUSIVO**: quando resolução, nuvem ou sazonalidade impedem conclusão segura.",
        "",
        "## Nível de Confiança",
        "Classifique: **[ALTA]** (evidência clara em imagem de qualidade, ≥2 fontes concordando), **[MÉDIA]** (evidência presente mas com limitação técnica), **[BAIXA]** (nuvem >30%, resolução insuficiente ou imagem única degradada) ou **[INCONCLUSIVO]** (nuvem, sombra ou ausência de imagem impedem qualquer avaliação confiável).",
        "",
        "## Veredito deste Satélite",
        "Forneça obrigatoriamente no formato exato:",
        `- ${sat.label} (${year}) | AC_FORA_SHAPE=SIM|NAO|INCONCLUSIVO | AVN_DENTRO_SHAPE_ANTROPIZADO=SIM|NAO|INCONCLUSIVO${hasAuas ? " | AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS=SIM|NAO|INCONCLUSIVO" : ""} | CONFIANCA=ALTA|MEDIA|BAIXA|INCONCLUSIVO`,
        "",
        "---",
        "Responda em **português**, use markdown, seja detalhado e técnico.",
        "Não inclua cadeia de raciocínio interna nem bloco <think>; entregue só a resposta final.",
    ].join("\n");
}

/** Build the full prompt for single-satellite analysis (original behavior). */
function buildAnalysisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    selectedLayers?: string[],
    options?: { acAvnAuasContext?: AcAvnAuasContext | null },
): string {
    const rawAuasContext = options?.acAvnAuasContext || null;
    const hasAuas = Boolean(rawAuasContext?.hasAuasLayer);
    const auasContext = hasAuas && rawAuasContext ? rawAuasContext : null;
    const validLayers = getOrderedSatelliteKeys(selectedLayers || []);
    const arlSummary = layerSummaries.find((l) => l.name === "ARL");
    const arlremSummary = layerSummaries.find((l) => l.name === "ARLREM");
    const hasArl = ((arlSummary?.areaHa ?? 0) + (arlremSummary?.areaHa ?? 0)) > 0;
    const satDescriptions = validLayers.map((k, i) => {
        const sat = SATELLITE_LAYERS[k];
        const meta = getSatelliteMetadata(k);
        const imgBase = i * 3 + 1;
        return [
            `### ${sat.label} — ${meta.sensor} (${meta.spatialResolution})`,
            `- Bandas: ${meta.spectralBands}`,
            `- Revisita: ${meta.revisitDays} dias | Uso ideal: ${meta.bestUseCase}`,
            `- Peso da evidência: ${meta.spatialResolution.includes("2.5") ? "ALTO (confirmação isolada suficiente)" : meta.spatialResolution.includes("10") ? "MÉDIO (verificar com outra fonte)" : "BAIXO (requer confirmação cruzada)"}`,
            `- Imagem ${imgBase}: visão geral (propriedade + AC + AVN${hasAuas ? " + AUAS" : ""}${hasArl ? " + ARL" : ""})`,
            `- Imagem ${imgBase + 1}: foco AC (polígono roxo)`,
            `- Imagem ${imgBase + 2}: foco AVN (polígono amarelo)`,
        ].join("\n");
    }).join("\n\n");

    return [
        "Você é a **GeoForest IA**, perita em interpretação de imagens de satélite para validação de CAR em imóveis rurais de Mato Grosso.",
        "Analise **somente** o que está dentro do polígono da propriedade (contorno vermelho).",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 12 }),
        "",
        ...(hasAuas
            ? [
                "## Contexto Vetorial AUAS × AVN",
                `- AUAS declarada: **${auasContext?.auasAreaHa.toFixed(2)} ha**`,
                `- AVN declarada: **${auasContext?.avnAreaHa.toFixed(2)} ha**`,
                `- Sobreposição AUAS∩AVN: ${auasContext?.overlapAreaHa.toFixed(2)} ha (${auasContext?.overlapPctOfAuas.toFixed(1)}% da AUAS, ${auasContext?.overlapPctOfAvn.toFixed(1)}% da AVN)`,
                `- AUAS fora do AVN: ${auasContext?.auasOutsideAvnAreaHa.toFixed(2)} ha (${auasContext?.auasOutsideAvnPct.toFixed(1)}% da AUAS) — área de uso alternativo do solo não coincidente com vegetação nativa declarada`,
                "- Use este contexto como referência quantitativa; a decisão final deve seguir a evidência visual das imagens.",
                "",
            ]
            : []),
        "## Regras Técnicas Obrigatórias",
        "",
        "### Área Consolidada (AC — polígono roxo)",
        "- AC_FORA_SHAPE = **SIM** somente quando houver EVIDÊNCIA VISUAL CLARA de uso antrópico (pastagem, agricultura, solo exposto, estrada, benfeitorias) em área do imóvel que NÃO está coberta pelo polígono AC.",
        "- Critério de evidência clara: SPOT 2008 confirmando sozinho É suficiente (2.5m de resolução). Para Landsat, exige concordância de ao menos 2 cenas independentes.",
        "- Padrão de textura antrópica: tonalidade uniforme sem gradiente de dossel, estrutura regular de lavoura ou pasto limpo, cicatrizes de fogo.",
        "- Padrão de vegetação nativa: textura rugosa de copas, gradiente de cor verde-escuro, estrutura irregular de dossel (Floresta), ou manchas herbáceas intercaladas com arbustos (Cerrado).",
        "- **Atenção campo nativo:** em Cerrado, distinguir campo nativo (tonalidade clara com textura variada, manchas arbustivas) de pastagem degradada (tonalidade uniforme sem arbustos). Campo nativo NÃO é uso antrópico.",
        "- Se a área em questão apresentar textura ambígua (campo nativo, palhada, solo seco), classifique como INCONCLUSIVO.",
        "",
        "### Vegetação Nativa (AVN — polígono amarelo)",
        "- AVN_FORA_SHAPE = **IGNORAR** sempre. Não reportar vegetação fora do shape AVN.",
        "- AVN_DENTRO_SHAPE_ANTROPIZADO = **SIM** apenas quando houver área CLARAMENTE antropizada DENTRO do polígono AVN.",
        "- Avalie integridade do dossel, continuidade da cobertura e sinais de fragmentação.",
        "- Atenção especial em bordas: áreas de borda podem apresentar transição gradual — só classifique como antropizado se a textura antrópica for dominante no trecho.",
        "- **Bordas de transição AC/AVN:** se a transição for gradual, reportar como zona de incerteza; não classificar automaticamente como discordância.",
        ...(hasAuas
            ? [
                "",
                "### AUAS (polígono branco)",
                "- AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = **SIM** quando houver evidência visual de vegetação nativa fora do AVN mas dentro do shape AUAS.",
                "- Se AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = SIM, manter AVN_FORA_SHAPE como IGNORAR e sinalizar necessidade de validação no fluxo AUAS.",
                `- Área de AUAS fora do AVN: ${auasContext?.auasOutsideAvnAreaHa.toFixed(2)} ha — verifique se há vegetação nativa remanescente nessa porção.`,
            ]
            : [
                "- Como AUAS não está disponível no recorte, use AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = INCONCLUSIVO.",
            ]),
        "",
        ...(hasArl
            ? [
                "### Reserva Legal (ARL — polígono verde)",
                "- Avaliar integridade da vegetação dentro da ARL. Há uso antrópico (pastagem, lavoura, solo exposto) dentro da ARL?",
                "- Se houver uso antrópico na ARL, estimar porcentagem e localizar espacialmente.",
                "- Este dado é informativo e não altera os vereditos AC/AVN, mas deve constar na Conclusão Técnica.",
                "",
            ]
            : []),
        "### Critérios de Confiança",
        "- **ALTA**: evidência direta e inequívoca em ao menos 2 imagens de qualidade, sem nuvem ou sombra relevante.",
        "- **MEDIA**: evidência presente mas com limitação de resolução, sazonalidade (palhada, campo seco), ou discordância entre cenas.",
        "- **BAIXA**: cobertura de nuvens >30%, resolução insuficiente para distinção, ou única fonte disponível com imagem degradada.",
        "- Se nuvem, sombra, queimada recente ou ausência de imagem impedir certeza, use INCONCLUSIVO.",
        "",
        "### Derivação do Veredito Global",
        "**O veredito global DEVE ser derivado dos vereditos individuais por satélite.** Regras:",
        "- Se 2+ satélites concordam SIM, o global **deve** ser SIM (salvo se satélite com peso ALTO discordar).",
        "- Se 2+ satélites concordam NAO, o global **deve** ser NAO.",
        "- Se há discordância entre satélites (SIM vs. NAO), o global **deve** ser INCONCLUSIVO.",
        "- Quando SPOT (2.5m) discorda de Landsat (30m), dar preferência ao SPOT na justificativa.",
        "",
        "## Imagens Disponíveis",
        satDescriptions,
        "",
        "## Formato Obrigatório da Resposta",
        "Use EXATAMENTE estes títulos de seção (não invente outros):",
        "",
        "## Veredito Objetivo",
        "## Vereditos por Satélite",
        "## Validação de Coerência AC/AVN",
        "## Evidências por Imagem",
        "## Conclusão Técnica",
        "## Recomendação Operacional",
        "",
        "**Veredito Objetivo** — incluir obrigatoriamente:",
        "- AC_FORA_SHAPE = SIM | NAO | INCONCLUSIVO",
        "- AVN_FORA_SHAPE = IGNORAR",
        "- AVN_DENTRO_SHAPE_ANTROPIZADO = SIM | NAO | INCONCLUSIVO",
        "- AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = SIM | NAO | INCONCLUSIVO",
        "- CONFIANCA_GERAL = ALTA | MEDIA | BAIXA | INCONCLUSIVO",
        "",
        "**Vereditos por Satélite** — uma linha por satélite no formato EXATO:",
        "- <NOME_SATELITE> (AAAA) | AC_FORA_SHAPE=SIM|NAO|INCONCLUSIVO | AVN_DENTRO_SHAPE_ANTROPIZADO=SIM|NAO|INCONCLUSIVO | CONFIANCA=ALTA|MEDIA|BAIXA|INCONCLUSIVO",
        "",
        "**Validação de Coerência AC/AVN** — indicar se o veredito global é coerente com os vereditos individuais. Se houver conflito, declarar explicitamente e usar INCONCLUSIVO no item conflitante.",
        "",
        "**Evidências por Imagem** — descrever os achados por satélite com localização geográfica aproximada (ex.: 'porção nordeste', 'borda sul'). Citar textura, tonalidade e padrão observado. Estimar área em hectares quando possível.",
        "",
        "**Comunicação da conclusão:**",
        "- Linguagem clara, direta e sem jargão desnecessário.",
        "- Se AC_FORA_SHAPE = SIM ou AVN_DENTRO_SHAPE_ANTROPIZADO = SIM, inicie a conclusão com alerta objetivo e indique localização aproximada.",
        "- Se AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = SIM, inclua: 'Área de AVN parcialmente não inserida no shape AVN, porém inserida no shape AUAS. Execute a análise de AUAS para confirmar a vetorização.'",
        "- Recomendações práticas: especifique o que revisar no shape e em qual região da propriedade.",
        "",
        "Não use tabela. Não inclua cadeia de raciocínio interna nem bloco <think>.",
    ].join("\n");
}

type AcAvnVerdict = "SIM" | "NAO" | "INCONCLUSIVO" | null;
type AcAvnConfidence = "ALTA" | "MEDIA" | "BAIXA" | "INCONCLUSIVO";
type AcAvnSatelliteInfo = { key: string; label: string; year: number; status: "used" | "missing" };
type AcAvnSatelliteVerdict = {
    key: string;
    label: string;
    year: number;
    status: "used" | "missing";
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    confidence: AcAvnConfidence;
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
};

export type AcAvnAnalysisResult = {
    analysisText: string;
    cloudinaryUrls: Array<{ url: string; caption: string }>;
    usedSatelliteKeys: string[];
    missingSatelliteKeys: string[];
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
    analysisMeta: AcAvnAnalysisMeta;
    layerSummaries: LayerSummary[];
    /** true when aiAnalysis=false (image-only mode, no analysisText/analysisMeta) */
    imageOnly: boolean;
};

function parseAcAvnConfidenceToken(raw: string): AcAvnConfidence {
    const upper = String(raw || "").toUpperCase().trim();
    if (upper === "ALTA" || upper === "MEDIA" || upper === "BAIXA" || upper === "INCONCLUSIVO") {
        return upper;
    }
    return "INCONCLUSIVO";
}

function extractAcAvnConfidence(text: string): AcAvnConfidence {
    const re = /CONFIANCA_GERAL\s*=\s*(ALTA|MEDIA|BAIXA|INCONCLUSIVO)/i;
    const match = String(text || "").match(re);
    return parseAcAvnConfidenceToken(match?.[1] || "");
}

function normalizeLooseLabel(value: string): string {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function replaceOrAppendVerdictLine(
    text: string,
    field: "AC_FORA_SHAPE" | "AVN_DENTRO_SHAPE_ANTROPIZADO" | "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS",
    verdict: Exclude<AcAvnVerdict, null>,
): string {
    const re = new RegExp(`(${field}\\s*=\\s*)(SIM|NAO|INCONCLUSIVO)`, "i");
    if (re.test(text)) {
        return text.replace(re, `$1${verdict}`);
    }
    return `${text.trim()}\n- ${field} = ${verdict}`;
}

function extractSatelliteVerdictsFromText(
    text: string,
    satellites: AcAvnSatelliteInfo[],
): AcAvnSatelliteVerdict[] {
    const parsedByKey = new Map<string, AcAvnSatelliteVerdict>();
    const lineRe =
        /(?:^|\n)\s*[-*]\s*([^|\n]+?)\s*\|\s*AC_FORA_SHAPE\s*=\s*(SIM|NAO|INCONCLUSIVO)\s*\|\s*AVN_DENTRO_SHAPE_ANTROPIZADO\s*=\s*(SIM|NAO|INCONCLUSIVO)\s*\|\s*CONFIANCA\s*=\s*(ALTA|MEDIA|BAIXA|INCONCLUSIVO)\s*$/gim;
    const candidates = satellites.map((sat) => ({
        ...sat,
        norm: normalizeLooseLabel(`${sat.label} ${sat.year}`),
    }));

    let match: RegExpExecArray | null;
    while ((match = lineRe.exec(String(text || ""))) !== null) {
        const rawLabel = String(match[1] || "").trim();
        const normLabel = normalizeLooseLabel(rawLabel);
        const byYear = rawLabel.match(/\b(19|20)\d{2}\b/)?.[0] || "";
        const target =
            candidates.find((sat) => normLabel.includes(normalizeLooseLabel(sat.label))) ||
            candidates.find((sat) => byYear && String(sat.year) === byYear) ||
            null;
        if (!target) continue;
        parsedByKey.set(target.key, {
            key: target.key,
            label: target.label,
            year: target.year,
            status: target.status,
            acForaShape: String(match[2] || "").toUpperCase() as AcAvnVerdict,
            avnDentroShapeAntropizado: String(match[3] || "").toUpperCase() as AcAvnVerdict,
            confidence: parseAcAvnConfidenceToken(String(match[4] || "")),
        });
    }

    return satellites.map((sat) => {
        const parsed = parsedByKey.get(sat.key);
        if (parsed) return parsed;
        return {
            key: sat.key,
            label: sat.label,
            year: sat.year,
            status: sat.status,
            acForaShape: "INCONCLUSIVO",
            avnDentroShapeAntropizado: "INCONCLUSIVO",
            confidence: sat.status === "missing" ? "INCONCLUSIVO" : "BAIXA",
        };
    });
}

function validateAcAvnCoherence(
    globalAc: AcAvnVerdict,
    globalAvn: AcAvnVerdict,
    satelliteVerdicts: AcAvnSatelliteVerdict[],
): { acVerdict: Exclude<AcAvnVerdict, null>; avnVerdict: Exclude<AcAvnVerdict, null>; notes: string[] } {
    const notes: string[] = [];
    let acVerdict: Exclude<AcAvnVerdict, null> = globalAc || "INCONCLUSIVO";
    let avnVerdict: Exclude<AcAvnVerdict, null> = globalAvn || "INCONCLUSIVO";

    const used = satelliteVerdicts.filter((sat) => sat.status === "used");
    const usedAc = used.map((sat) => sat.acForaShape).filter((v): v is Exclude<AcAvnVerdict, null> => Boolean(v));
    const usedAvn = used
        .map((sat) => sat.avnDentroShapeAntropizado)
        .filter((v): v is Exclude<AcAvnVerdict, null> => Boolean(v));

    // Helper: check if satellite is high-resolution (SPOT 2.5m)
    const isHighRes = (sat: AcAvnSatelliteVerdict) =>
        sat.label.toLowerCase().includes("spot") || sat.key.toLowerCase().includes("spot");

    // === AC coherence rules ===
    const acHasSim = usedAc.includes("SIM");
    const acHasNao = usedAc.includes("NAO");
    const acSimCount = usedAc.filter(v => v === "SIM").length;
    const acNaoCount = usedAc.filter(v => v === "NAO").length;

    // Check if SPOT has high-resolution data that should take precedence
    const spotAcVerdict = used.find(s => isHighRes(s))?.acForaShape;
    const hasSpotData = spotAcVerdict && spotAcVerdict !== "INCONCLUSIVO";

    if (acHasSim && acHasNao) {
        // Conflict between satellites
        if (hasSpotData) {
            // Prefer SPOT's verdict (2.5m resolution)
            notes.push(`Conflito AC_FORA_SHAPE entre satélites — SPOT (2.5m) indica ${spotAcVerdict}, prevale por maior resolução.`);
            acVerdict = spotAcVerdict as Exclude<AcAvnVerdict, null>;
        } else {
            notes.push("Conflito entre satélites para AC_FORA_SHAPE (há SIM e NAO).");
            acVerdict = "INCONCLUSIVO";
        }
    } else if (acVerdict !== "INCONCLUSIVO") {
        // Majority rule: if most satellites agree, verify global is coherent
        if (acSimCount >= 2 && acVerdict !== "SIM") {
            notes.push(`Maioria dos satélites (${acSimCount}/${usedAc.length}) indica AC_FORA_SHAPE=SIM, mas global era ${acVerdict}. Corrigido para SIM.`);
            acVerdict = "SIM";
        } else if (acNaoCount >= 2 && acVerdict !== "NAO") {
            notes.push(`Maioria dos satélites (${acNaoCount}/${usedAc.length}) indica AC_FORA_SHAPE=NAO, mas global era ${acVerdict}. Corrigido para NAO.`);
            acVerdict = "NAO";
        } else if (acVerdict === "NAO" && acHasSim) {
            notes.push("Veredito global AC_FORA_SHAPE=NAO conflita com satélite indicando SIM.");
            acVerdict = "INCONCLUSIVO";
        } else if (acVerdict === "SIM" && acHasNao) {
            notes.push("Veredito global AC_FORA_SHAPE=SIM conflita com satélite indicando NAO.");
            acVerdict = "INCONCLUSIVO";
        }
    }

    // === AVN coherence rules ===
    const avnHasSim = usedAvn.includes("SIM");
    const avnHasNao = usedAvn.includes("NAO");
    const avnSimCount = usedAvn.filter(v => v === "SIM").length;
    const avnNaoCount = usedAvn.filter(v => v === "NAO").length;

    const spotAvnVerdict = used.find(s => isHighRes(s))?.avnDentroShapeAntropizado;
    const hasSpotAvnData = spotAvnVerdict && spotAvnVerdict !== "INCONCLUSIVO";

    if (avnHasSim && avnHasNao) {
        if (hasSpotAvnData) {
            notes.push(`Conflito AVN entre satélites — SPOT (2.5m) indica ${spotAvnVerdict}, prevale por maior resolução.`);
            avnVerdict = spotAvnVerdict as Exclude<AcAvnVerdict, null>;
        } else {
            notes.push("Conflito entre satélites para AVN_DENTRO_SHAPE_ANTROPIZADO (há SIM e NAO).");
            avnVerdict = "INCONCLUSIVO";
        }
    } else if (avnVerdict !== "INCONCLUSIVO") {
        if (avnSimCount >= 2 && avnVerdict !== "SIM") {
            notes.push(`Maioria dos satélites (${avnSimCount}/${usedAvn.length}) indica AVN_DENTRO_SHAPE_ANTROPIZADO=SIM, mas global era ${avnVerdict}. Corrigido para SIM.`);
            avnVerdict = "SIM";
        } else if (avnNaoCount >= 2 && avnVerdict !== "NAO") {
            notes.push(`Maioria dos satélites (${avnNaoCount}/${usedAvn.length}) indica AVN_DENTRO_SHAPE_ANTROPIZADO=NAO, mas global era ${avnVerdict}. Corrigido para NAO.`);
            avnVerdict = "NAO";
        } else if (avnVerdict === "NAO" && avnHasSim) {
            notes.push("Veredito global AVN_DENTRO_SHAPE_ANTROPIZADO=NAO conflita com satélite indicando SIM.");
            avnVerdict = "INCONCLUSIVO";
        } else if (avnVerdict === "SIM" && avnHasNao) {
            notes.push("Veredito global AVN_DENTRO_SHAPE_ANTROPIZADO=SIM conflita com satélite indicando NAO.");
            avnVerdict = "INCONCLUSIVO";
        }
    }

    // === Temporal consistency check ===
    // If older satellites (pre-2008) say NAO but newer ones say SIM, flag it
    const preMarcoSats = used.filter(s => s.year <= 2008);
    const postMarcoSats = used.filter(s => s.year > 2008);
    if (preMarcoSats.length > 0 && postMarcoSats.length > 0) {
        const preMarcoAc = preMarcoSats.some(s => s.acForaShape === "SIM");
        const postMarcoAc = postMarcoSats.every(s => s.acForaShape === "NAO" || !s.acForaShape);
        if (preMarcoAc && postMarcoAc) {
            notes.push("Satélite(s) pré-marco indicam AC_FORA_SHAPE=SIM, mas pós-marco não confirmam — possível regeneração ou mudança de uso.");
        }
    }

    return { acVerdict, avnVerdict, notes };
}

function extractAcAvnVerdict(
    text: string,
    field: "AC_FORA_SHAPE" | "AVN_DENTRO_SHAPE_ANTROPIZADO" | "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS",
): AcAvnVerdict {
    const re = new RegExp(`${field}\\s*=\\s*(SIM|NAO|INCONCLUSIVO)`, "i");
    const match = String(text || "").match(re);
    if (!match) return null;
    const value = String(match[1] || "").toUpperCase();
    if (value === "SIM" || value === "NAO" || value === "INCONCLUSIVO") return value;
    return null;
}

function inferAvnParcialForaShapeMasEmAuas(text: string): AcAvnVerdict {
    const normalized = normalizeLooseLabel(text);
    const hasForaAvn =
        /\bfora\b.*\bshape\b.*\bavn\b/.test(normalized) ||
        /\bfora\b.*\bavn\b/.test(normalized) ||
        /\bnao\b.*\binserid\w*\b.*\bavn\b/.test(normalized);
    const hasDentroAuas =
        /\bdentro\b.*\bauas\b/.test(normalized) ||
        /\binserid\w*\b.*\bauas\b/.test(normalized) ||
        /\bsobreposic\w*\b.*\bauas\b/.test(normalized);
    if (hasForaAvn && hasDentroAuas) return "SIM";
    return null;
}

function resolveAuasAcAvnMeta(previousAnalysis?: string, acAvnMeta?: any): any {
    if (acAvnMeta && typeof acAvnMeta === "object") {
        return acAvnMeta;
    }
    const text = splitThinkProgress(String(previousAnalysis || "")).answerText || String(previousAnalysis || "");
    if (!text.trim()) return undefined;

    const acForaShape = extractAcAvnVerdict(text, "AC_FORA_SHAPE") || "INCONCLUSIVO";
    const avnDentroShapeAntropizado = extractAcAvnVerdict(text, "AVN_DENTRO_SHAPE_ANTROPIZADO") || "INCONCLUSIVO";
    const avnParcialForaShapeMasEmAuas =
        extractAcAvnVerdict(text, "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS")
        || inferAvnParcialForaShapeMasEmAuas(text)
        || "INCONCLUSIVO";
    const confidence = extractAcAvnConfidence(text);

    const hasSignal =
        /AC_FORA_SHAPE\s*=|AVN_DENTRO_SHAPE_ANTROPIZADO\s*=|AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS\s*=/i.test(text);
    if (!hasSignal) return undefined;

    return {
        globalVerdict: {
            acForaShape,
            avnDentroShapeAntropizado,
            avnParcialForaShapeMasEmAuas,
            confidence,
        },
        source: "derived_from_previous_analysis",
    };
}

function buildUserFriendlyAcAvnGuidance(
    acForaShape: AcAvnVerdict,
    avnDentroShapeAntropizado: AcAvnVerdict,
    avnParcialForaShapeMasEmAuas: AcAvnVerdict,
    missingSatellites: string[],
): string {
    const hasMissing = missingSatellites.length > 0;
    const missingText = hasMissing ? `Imagens indisponiveis: ${missingSatellites.join(", ")}.` : "";

    if (avnParcialForaShapeMasEmAuas === "SIM") {
        return [
            "## Resumo para o Usuario",
            "- Area de AVN parcialmente nao inserida no shape de AVN, porem inserida no shape de AUAS.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Para confirmar se essa vetorizacao esta correta, execute a analise de AUAS.",
            "- Se a analise de AUAS confirmar coerencia temporal, manter o shape AUAS e revisar o AVN apenas no trecho de divergencia.",
        ].filter(Boolean).join("\n");
    }

    if (acForaShape === "SIM" && avnDentroShapeAntropizado === "SIM") {
        return [
            "## Resumo para o Usuario",
            "- Foram identificadas duas inconformidades: area consolidada fora do shape AC e area antropizada dentro do shape AVN.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Revisar e ampliar o shape de AC para incluir as areas antropizadas detectadas dentro do imovel.",
            "- Revisar o shape de AVN e excluir os trechos sem mata detectados dentro do poligono declarado.",
            "- Priorizar conferencia visual nos setores com maior contraste entre satelites (bordas e porcoes centrais).",
        ].filter(Boolean).join("\n");
    }

    if (acForaShape === "SIM") {
        return [
            "## Resumo para o Usuario",
            "- A analise indica area consolidada dentro do imovel que ficou fora do shape AC.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Revisar o shape AC e incluir os trechos antropizados detectados fora do poligono atual.",
            "- Manter o criterio AVN como esta, salvo verificacao adicional em campo.",
        ].filter(Boolean).join("\n");
    }

    if (avnDentroShapeAntropizado === "SIM") {
        return [
            "## Resumo para o Usuario",
            "- A analise indica trecho sem mata dentro do shape AVN.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Revisar o shape AVN e retirar os trechos antropizados detectados no interior do poligono.",
            "- Confirmar os limites com apoio de imagem de melhor resolucao e validacao tecnica.",
        ].filter(Boolean).join("\n");
    }

    if (acForaShape === "NAO" && avnDentroShapeAntropizado === "NAO") {
        return [
            "## Resumo para o Usuario",
            "- Nao foram identificadas inconformidades principais de AC fora do shape ou de area antropizada dentro de AVN.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Manter os shapes atuais e registrar a analise como consistente com as imagens avaliadas.",
            "- Reavaliar apenas se houver nova imagem com mudanca relevante.",
        ].filter(Boolean).join("\n");
    }

    return [
        "## Resumo para o Usuario",
        "- Resultado parcialmente inconclusivo para uma ou mais regras principais de AC/AVN.",
        hasMissing ? `- ${missingText}` : "",
        "",
        "## Recomendacao Operacional (Ajuste Automatico)",
        "- Tratar os pontos sem certeza como INCONCLUSIVO e solicitar nova verificacao com imagem complementar.",
    ].filter(Boolean).join("\n");
}

function normalizeAcAvnAnalysisOutput(
    rawText: string,
    options: {
        satellitesUsed: Array<{ key: string; label: string; year: number }>;
        satellitesMissing: Array<{ key: string; label: string; year: number }>;
        cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
        auasContext?: AcAvnAuasContext | null;
    },
): { text: string; meta: AcAvnAnalysisMeta } {
    const visible = splitThinkProgress(String(rawText || "")).answerText || String(rawText || "");
    let text = visible.trim();
    const satellites = [
        ...options.satellitesUsed.map((sat) => ({ ...sat, status: "used" as const })),
        ...options.satellitesMissing.map((sat) => ({ ...sat, status: "missing" as const })),
    ];
    const used = options.satellitesUsed.length > 0
        ? options.satellitesUsed.map((sat) => sat.label).join(", ")
        : "nenhum";
    const missing = options.satellitesMissing.length > 0
        ? options.satellitesMissing.map((sat) => sat.label).join(", ")
        : "nenhum";

    if (!text) {
        text = [
            "## Veredito Objetivo",
            "- AC_FORA_SHAPE = INCONCLUSIVO",
            "- AVN_FORA_SHAPE = IGNORAR",
            "- AVN_DENTRO_SHAPE_ANTROPIZADO = INCONCLUSIVO",
            "- AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = INCONCLUSIVO",
            "- CONFIANCA_GERAL = BAIXA",
            "",
            "## Vereditos por Satélite",
            ...satellites.map(
                (sat) =>
                    `- ${sat.label} | AC_FORA_SHAPE=INCONCLUSIVO | AVN_DENTRO_SHAPE_ANTROPIZADO=INCONCLUSIVO | CONFIANCA=INCONCLUSIVO`,
            ),
            "",
            "## Validação de Coerência AC/AVN",
            "- Coerência: INCONCLUSIVO por ausência de conteúdo analisável.",
            "",
            "## Evidências por Imagem",
            `- Imagens utilizadas: ${used}.`,
            `- Imagens indisponíveis: ${missing}.`,
            "- Texto da IA ausente; impossível concluir com segurança.",
            "",
            "## Conclusão Técnica",
            "- Resultado inconclusivo por ausência de conteúdo analisável.",
            "",
            "## Recomendação Operacional",
            "- Reprocessar o recorte e validar disponibilidade das imagens obrigatórias.",
        ].join("\n");
    }

    const requiredSections = [
        "## Veredito Objetivo",
        "## Vereditos por Satélite",
        "## Validação de Coerência AC/AVN",
        "## Evidências por Imagem",
        "## Conclusão Técnica",
        "## Recomendação Operacional",
    ];
    for (const section of requiredSections) {
        if (!text.toLowerCase().includes(section.toLowerCase())) {
            if (section === "## Veredito Objetivo") {
                text += [
                    "",
                    "## Veredito Objetivo",
                    "- AC_FORA_SHAPE = INCONCLUSIVO",
                    "- AVN_FORA_SHAPE = IGNORAR",
                    "- AVN_DENTRO_SHAPE_ANTROPIZADO = INCONCLUSIVO",
                    "- AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = INCONCLUSIVO",
                    "- CONFIANCA_GERAL = BAIXA",
                ].join("\n");
                continue;
            }
            if (section === "## Evidências por Imagem") {
                text += [
                    "",
                    "## Evidências por Imagem",
                    `- Imagens utilizadas: ${used}.`,
                    `- Imagens indisponíveis: ${missing}.`,
                ].join("\n");
                continue;
            }
            if (section === "## Vereditos por Satélite") {
                text += [
                    "",
                    "## Vereditos por Satélite",
                    ...satellites.map(
                        (sat) =>
                            `- ${sat.label} | AC_FORA_SHAPE=INCONCLUSIVO | AVN_DENTRO_SHAPE_ANTROPIZADO=INCONCLUSIVO | CONFIANCA=INCONCLUSIVO`,
                    ),
                ].join("\n");
                continue;
            }
            if (section === "## Validação de Coerência AC/AVN") {
                text += [
                    "",
                    "## Validação de Coerência AC/AVN",
                    "- Coerência preliminar: INCONCLUSIVO (seção ausente na resposta original).",
                ].join("\n");
                continue;
            }
            if (section === "## Conclusão Técnica") {
                text += [
                    "",
                    "## Conclusão Técnica",
                    "- Resultado complementado automaticamente por falta de seção obrigatória.",
                ].join("\n");
                continue;
            }
            if (section === "## Recomendação Operacional") {
                text += [
                    "",
                    "## Recomendação Operacional",
                    "- Revisar manualmente os pontos indicados e, se necessário, gerar novas cenas.",
                ].join("\n");
            }
        }
    }

    const auasContext = options.auasContext || null;
    if (auasContext?.hasAuasLayer && !/##\s*Contexto Vetorial AUAS/i.test(text)) {
        text += [
            "",
            "## Contexto Vetorial AUAS (Complemento Automático)",
            `- AUAS total: ${auasContext.auasAreaHa.toFixed(2)} ha.`,
            `- AVN total: ${auasContext.avnAreaHa.toFixed(2)} ha.`,
            `- Interseção AUAS∩AVN: ${auasContext.overlapAreaHa.toFixed(2)} ha (${auasContext.overlapPctOfAuas.toFixed(2)}% da AUAS).`,
            `- AUAS fora do AVN: ${auasContext.auasOutsideAvnAreaHa.toFixed(2)} ha (${auasContext.auasOutsideAvnPct.toFixed(2)}% da AUAS).`,
            "- Esse contexto foi adicionado para apoiar a validação de AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS.",
        ].join("\n");
    }

    const hasAc = /AC_FORA_SHAPE\s*=/i.test(text);
    const hasAvnOut = /AVN_FORA_SHAPE\s*=/i.test(text);
    const hasAvnIn = /AVN_DENTRO_SHAPE_ANTROPIZADO\s*=/i.test(text);
    const hasAvnAuasBridge = /AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS\s*=/i.test(text);
    if (!hasAc || !hasAvnOut || !hasAvnIn || !hasAvnAuasBridge) {
        text += [
            "",
            "## Veredito Objetivo (Complemento Automático)",
            `- AC_FORA_SHAPE = ${hasAc ? "INFORMADO" : "INCONCLUSIVO"}`,
            `- AVN_FORA_SHAPE = ${hasAvnOut ? "INFORMADO" : "IGNORAR"}`,
            `- AVN_DENTRO_SHAPE_ANTROPIZADO = ${hasAvnIn ? "INFORMADO" : "INCONCLUSIVO"}`,
            `- AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS = ${hasAvnAuasBridge ? "INFORMADO" : "INCONCLUSIVO"}`,
        ].join("\n");
    }

    const satelliteVerdicts = extractSatelliteVerdictsFromText(text, satellites);
    const globalAc = extractAcAvnVerdict(text, "AC_FORA_SHAPE");
    const globalAvn = extractAcAvnVerdict(text, "AVN_DENTRO_SHAPE_ANTROPIZADO");
    let globalAvnAuasBridge =
        extractAcAvnVerdict(text, "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS")
        || inferAvnParcialForaShapeMasEmAuas(text)
        || "INCONCLUSIVO";
    if (!auasContext?.hasAuasLayer) {
        globalAvnAuasBridge = "INCONCLUSIVO";
    }
    const coherenceCheck = validateAcAvnCoherence(globalAc, globalAvn, satelliteVerdicts);
    text = replaceOrAppendVerdictLine(text, "AC_FORA_SHAPE", coherenceCheck.acVerdict);
    text = replaceOrAppendVerdictLine(text, "AVN_DENTRO_SHAPE_ANTROPIZADO", coherenceCheck.avnVerdict);
    text = replaceOrAppendVerdictLine(text, "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS", globalAvnAuasBridge);

    if (options.satellitesMissing.length > 0 && !/inconclusivo/i.test(text)) {
        text += [
            "",
            "## Conclusão Técnica (Ajuste por Imagem Ausente)",
            `- Imagens indisponíveis: ${missing}.`,
            "- Se a ausência dessas imagens impactar a certeza do diagnóstico, trate os pontos afetados como INCONCLUSIVO.",
        ].join("\n");
    }

    const resolvedAc = extractAcAvnVerdict(text, "AC_FORA_SHAPE");
    const resolvedAvn = extractAcAvnVerdict(text, "AVN_DENTRO_SHAPE_ANTROPIZADO");
    const resolvedAvnAuasBridge = extractAcAvnVerdict(text, "AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS");
    const resolvedConfidence = extractAcAvnConfidence(text);
    const canonicalSatLines = satelliteVerdicts.map(
        (sat) =>
            `- ${sat.label} | AC_FORA_SHAPE=${sat.acForaShape || "INCONCLUSIVO"} | AVN_DENTRO_SHAPE_ANTROPIZADO=${sat.avnDentroShapeAntropizado || "INCONCLUSIVO"} | CONFIANCA=${sat.confidence}`,
    );

    text += [
        "",
        "## Vereditos por Satélite (Normalizado)",
        ...canonicalSatLines,
        "",
        "## Validação de Coerência AC/AVN (Normalizado)",
        coherenceCheck.notes.length > 0
            ? "- Coerência: NÃO, com ajustes para INCONCLUSIVO no veredito global."
            : "- Coerência: SIM, sem conflitos relevantes entre veredito global e satélites.",
        ...coherenceCheck.notes.map((note) => `- ${note}`),
    ].join("\n");

    text += [
        "",
        buildUserFriendlyAcAvnGuidance(
            resolvedAc,
            resolvedAvn,
            resolvedAvnAuasBridge,
            options.satellitesMissing.map((sat) => sat.label),
        ),
    ].join("\n");

    return {
        text: text.trim(),
        meta: {
            globalVerdict: {
                acForaShape: resolvedAc,
                avnDentroShapeAntropizado: resolvedAvn,
                avnParcialForaShapeMasEmAuas: resolvedAvnAuasBridge,
                confidence: resolvedConfidence,
            },
            satelliteVerdicts,
            coherence: {
                isCoherent: coherenceCheck.notes.length === 0,
                notes: coherenceCheck.notes,
            },
            cloudWarnings: options.cloudWarnings || [],
            auasContext,
        },
    };
}

function toSynthesisExcerpt(text: string, maxChars = SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT): string {
    const visible = splitThinkProgress(String(text || "")).answerText || String(text || "");
    return clampTextMiddle(visible, Math.max(700, maxChars));
}

/**
 * Build the synthesis prompt for multi-satellite temporal comparison.
 * Receives the individual per-satellite analyses as input.
 */
function buildSynthesisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    perSatelliteAnalyses: Array<{ satelliteLabel: string; year: number; analysis: string }>,
): string {
    const labels = perSatelliteAnalyses.map((a) => a.satelliteLabel);
    const years = perSatelliteAnalyses.map((a) => a.year).sort();

    const analysesBlock = perSatelliteAnalyses.map((a) => [
        `### Análise: ${a.satelliteLabel} (${a.year})`,
        "",
        toSynthesisExcerpt(a.analysis),
    ].join("\n")).join("\n\n---\n\n");

    return [
        "Você é a **GeoForest IA**, especialista em sensoriamento remoto e análise ambiental para imóveis rurais em Mato Grosso.",
        "",
        "Você receberá análises individuais feitas por IA para diferentes imagens de satélite do MESMO imóvel rural.",
        "Sua tarefa é **sintetizar e comparar** essas análises para produzir um **laudo temporal integrado**.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "---",
        "",
        `## Análises Individuais Realizadas (${labels.join(", ")})`,
        "",
        analysesBlock,
        "",
        "---",
        "",
        "## Sua Tarefa: Laudo Integrado Multi-temporal",
        "",
        "Produza um laudo ÚNICO e COMPLETO que integre as análises acima. Seja objetivo e evite repetições.",
        "",
        "### 1. Análise por Ano (obrigatória)",
        `Crie um subtítulo para cada ano em **${years.join(", ")}** e descreva os achados de AC/AVN.`,
        "Em cada ano, inclua: uso antrópico, integridade da vegetação, pontos de dúvida.",
        "",
        "### 2. Conexões Entre os Anos (obrigatória)",
        "Explique a linha do tempo conectando os anos entre si:",
        "- O que permaneceu estável ao longo dos anos?",
        "- Onde há indício de mudança (supressão ou regeneração)?",
        "- Qual sequência temporal mais provável para essas mudanças?",
        "",
        "### 3. Comparação CAR x Histórico",
        "- A Área Consolidada (AC) já estava consolidada no ano mais antigo?",
        "- Há AC com sinal de vegetação nativa no passado?",
        "- Há AVN com sinal de uso antrópico em algum ano?",
        "- **Reserva Legal:** se ARL estiver presente, há evidência de uso antrópico dentro da ARL em algum ano?",
        "",
        "### 4. Marco Temporal (Art. 68, Lei 12.651/2012)",
        "- Referência: **22/07/2008**.",
        "- Relacione explicitamente os anos anteriores e posteriores a 2008.",
        "",
        "### 5. Concordâncias e Discordâncias Consolidadas",
        "- **✅ CONCORDA**: quando os anos confirmam a classificação do CAR.",
        "- **❌ DISCORDA**: quando algum ano contradiz o CAR (cite ano, evidência, e área estimada em ha).",
        "- **⚠️ INCONCLUSIVO**: quando a limitação do sensor impede conclusão robusta.",
        "",
        "### 6. Vereditos por Satélite",
        "Uma linha por satélite no formato EXATO:",
        "- <NOME_SATELITE> (AAAA) | AC_FORA_SHAPE=SIM|NAO|INCONCLUSIVO | AVN_DENTRO_SHAPE_ANTROPIZADO=SIM|NAO|INCONCLUSIVO | CONFIANCA=ALTA|MEDIA|BAIXA|INCONCLUSIVO",
        "",
        "### 7. Nível de Confiança",
        "Classifique: **[ALTA]**, **[MÉDIA]** ou **[BAIXA]** e justifique.",
        "",
        "### 8. Conclusão Integrada + Recomendações",
        "- Síntese final da linha do tempo citando todos os anos.",
        "- Recomendações práticas: vistoria, imagens extras, retificação do CAR.",
        "",
        "---",
        "Responda em **português**, use markdown, seja detalhado e técnico.",
        "Não inclua cadeia de raciocínio interna nem bloco <think>; entregue só a resposta final.",
        "NÃO repita as análises individuais integralmente — sintetize e compare.",
    ].join("\n");
}

/* ─── AUAS Analysis Pipeline ─────────────────────────────────── */

/** Satellite keys used for AUAS analysis: starts at 2008, then chronological order. */
const AUAS_SATELLITE_KEYS: string[] = [
    "spot_2008",
    "landsat5_2008",
    "landsat5_2009",
    "landsat5_2010",
    "landsat5_2011",
    "landsat8_2013",
    "landsat8_2014",
    "landsat8_2015",
    "landsat8_2016",
    "landsat8_2017",
    "landsat8_2018",
    "sentinel2_2016",
    "sentinel2_2017",
    "sentinel2_2018",
    "sentinel2_2019",
    "sentinel2_2020",
    "sentinel2_2021",
    "sentinel2_2022",
    "sentinel2_2023",
    "sentinel2_2024",
].filter((k) => !!SATELLITE_LAYERS[k]);

/**
 * Generate composited satellite images for AUAS analysis.
 * For each satellite:
 * - with AUAS layer: generates 2 images (AUAS outline + contextual AC/AVN/AUAS overlay)
 * - without AUAS layer: generates 1 property-context image for temporal inference mode.
 */
async function generateAuasSatelliteImages(
    res: Response,
    job: CachedJob,
    hasAuasLayer = true,
): Promise<{
    images: Array<{ dataUrl: string; caption: string }>;
    usedKeys: string[];
    missingKeys: string[];
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
    resolution: { width: number; height: number };
}> {
    throwIfClientDisconnected(res);
    const { bbox, polygon: propertyPolygon, clippedGeometries } = job;
    const paddedBbox = padBbox(bbox!, 0.10);

    // Dynamic resolution based on property size
    const areaHa = job.areaHa ?? 0;
    const { width: IMG_W, height: IMG_H } = calculateDynamicResolution(areaHa, paddedBbox);
    console.log(`[AUAS ANALYSIS] Dynamic resolution: ${IMG_W}×${IMG_H} for ${areaHa.toFixed(1)} ha property`);

    // Simplify geometries for overlay
    const rawLayerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map(g => simplifyGeometryForOverlay(g, 500)));
    }
    const images: Array<{ dataUrl: string; caption: string }> = [];
    const usedKeys: string[] = [];
    const missingKeys: string[] = [];
    const cloudWarnings: Array<{ satellite: string; cloudScore: number }> = [];

    const totalSteps = AUAS_SATELLITE_KEYS.length;
    let step = 0;

    for (const key of AUAS_SATELLITE_KEYS) {
        throwIfClientDisconnected(res);
        const sat = SATELLITE_LAYERS[key];
        if (!sat) { step++; continue; }

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `Baixando imagem ${sat.label} para AUAS...`,
        });

        const candidateLayers = Array.from(new Set([sat.wmsLayer, ...(sat.wmsAliases || [])].filter(Boolean)));
        let basePng: Buffer | null = null;
        let lastLayerError = "unknown";

        for (const layerName of candidateLayers) {
            throwIfClientDisconnected(res);
            try {
                basePng = await fetchWmsImageBuffer([layerName], paddedBbox, IMG_W, IMG_H);
                break;
            } catch (err: any) {
                lastLayerError = err.message || String(err);
                console.warn(`[AUAS ANALYSIS] WMS ${sat.label} (${layerName}) failed: ${lastLayerError}`);
            }
        }

        if (!basePng) {
            missingKeys.push(key);
            console.warn(`[AUAS ANALYSIS] WMS ${sat.label} unavailable. Last error: ${lastLayerError}`);
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponível, pulando...`,
            });
            step++;
            continue;
        }
        usedKeys.push(key);

        try {
            const cloudResult = await detectCloudCover(basePng);
            if (cloudResult.isLikelyCloudy) {
                cloudWarnings.push({ satellite: sat.label, cloudScore: cloudResult.cloudScore });
                sendSSE(res, {
                    type: "progress",
                    step: "generating_images",
                    percent: 10 + Math.round((step / totalSteps) * 40),
                    message: `⚠ ${sat.label}: possível cobertura de nuvens (${Math.round(cloudResult.cloudScore * 100)}%)`,
                });
            }
        } catch {
            // non-fatal
        }

        // AUAS overlay when available; otherwise analyze full property for potential non-vectorized AUAS
        if (hasAuasLayer) {
            // View 1: AUAS outline with very light fill to preserve texture for visual reading
            const outlineSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
                { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.05)", strokeWidth: 3.0 },
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.00)", strokeWidth: 1.4 },
                { name: "AREA_CONSOLIDADA", stroke: "#A855F7", fill: "rgba(168, 85, 247, 0.00)", strokeWidth: 1.4 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, outlineSvg),
                caption: `${sat.label} — AUAS contorno`,
            });

            // View 2: contextual overlays to improve discrimination between AC/AVN/AUAS
            const contextSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
                { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.20)", strokeWidth: 2.2 },
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.14)", strokeWidth: 1.3 },
                { name: "AREA_CONSOLIDADA", stroke: "#A855F7", fill: "rgba(168, 85, 247, 0.12)", strokeWidth: 1.3 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, contextSvg),
                caption: `${sat.label} — AUAS contexto`,
            });
        } else {
            const propertySvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.20)", strokeWidth: 1.8 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, propertySvg),
                caption: `${sat.label} — Propriedade (AUAS nao vetorizada)`,
            });
        }
        step++;

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `${sat.label}: imagem AUAS gerada ✓`,
        });
    }

    return { images, usedKeys, missingKeys, cloudWarnings, resolution: { width: IMG_W, height: IMG_H } };
}

/** Build prompt for a SINGLE satellite AUAS analysis (1 image per satellite). */
function buildAuasSingleSatPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    satelliteKey: string,
    cloudWarning?: { satellite: string; cloudScore: number },
    options?: { hasAuasLayer?: boolean; baselineReferenceLabel?: string | null },
): string {
    const sat = SATELLITE_LAYERS[satelliteKey];
    const meta = getSatelliteMetadata(satelliteKey);
    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    const hasAuasLayer = options?.hasAuasLayer !== false;
    const baselineReferenceLabel = String(options?.baselineReferenceLabel || "").trim();
    const year = Number(sat?.year || 0);
    const isPreMarco = year <= 2008;
    const baselineHint =
        year > 2008
            ? (baselineReferenceLabel
                ? `Compare diretamente com a imagem de referência de 2008 (${baselineReferenceLabel}) para detectar mudanças de cobertura após o marco temporal.`
                : "Compare com 2008 como referência de linha base para detectar supressão após o marco temporal.")
            : "";
    const sensorWeight = meta.spatialResolution.includes("2.5")
        ? "ALTO (confirmação isolada suficiente)"
        : meta.spatialResolution.includes("10")
            ? "MÉDIO (verificar com outra fonte se possível)"
            : "BAIXO (requer confirmação cruzada)";

    return [
        "Você é analista técnica de AUAS para validação de CAR em imóvel rural de Mato Grosso.",
        hasAuasLayer
            ? `Avalie SOMENTE a área delimitada pelo polígono AUAS (contorno branco) na imagem ${sat.label}.`
            : `Não há shape AUAS vetorizado no ZIP. Avalie toda a propriedade buscando supressão pós-2008 que caracterize AUAS não vetorizada.`,
        ...(baselineHint ? [baselineHint] : []),
        "",
        `**Metadados:** sensor=${meta.sensor}; resolução=${meta.spatialResolution}; revisita=${meta.revisitDays} dias; bandas=${meta.spectralBands}.`,
        `**Limitação operacional:** ${meta.bestUseCase}`,
        `**Peso da evidência:** ${sensorWeight}`,
        "",
        ...(cloudWarning
            ? [
                `⚠️ Nebulosidade/oclusão detectada (${Math.round(cloudWarning.cloudScore * 100)}%). Se impactar área analisada, classifique o trecho como INCONCLUSIVO — não como uso antrópico.`,
                "",
            ]
            : []),
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        `**Referência legal:** marco temporal em 22/07/2008. Esta cena é ${isPreMarco ? "pré-marco ou marco (≤ 2008)" : "pós-marco (> 2008)"}.`,
        hasAuasLayer
            ? (auasSummary ? `**AUAS declarada:** ${auasSummary.areaHa?.toFixed(2) ?? "0"} ha.` : "**AUAS declarada:** sem quantitativo disponível.")
            : "**AUAS vetorizada:** AUSENTE neste ZIP. Use 2008 como referência e identifique supressão nos anos subsequentes.",
        "",
        "**Critérios de análise:**",
        hasAuasLayer
            ? "- Avalie somente mudanças DENTRO do shape AUAS. Mudanças fora do shape não alteram o veredito da AUAS."
            : "- Sem shape AUAS, mapeie toda a área da propriedade em busca de supressão.",
        "- Solo exposto sazonal (palhada, pastagem seca) ≠ desmatamento: confirme persistência temporal antes de classificar.",
        "- Padrão de vegetação nativa: dossel rugoso/contínuo (Floresta) ou mosaico arbustivo-herbáceo (Cerrado). Tonalidade verde-escuro irregular.",
        "- Padrão antrópico: tonalidade uniforme (pastagem), linhas regulares (agricultura), tons claros (solo exposto).",
        "- **Campo nativo × pastagem degradada:** em Cerrado, campo nativo apresenta tonalidade clara com textura variada e manchas arbustivas intercaladas. Pastagem degradada tem tonalidade uniforme sem arbustos. Campo nativo NÃO é supressão.",
        "- **Bordas de transição:** quando a transição entre vegetação nativa e uso antrópico for gradual, reportar como zona de incerteza com largura estimada.",
        "",
        "**Resposta em até 400 palavras, sem tabela, sem emoji e sem bloco <think>.**",
        "Estrutura obrigatória:",
        "## Cena Avaliada",
        hasAuasLayer ? "## Cobertura Dentro da AUAS" : "## Cobertura na Propriedade",
        "## Indicadores de Supressão",
        "## Comparação com Marco Temporal (2008)",
        "## Veredito do Ano",
        "",
        "No veredito, usar apenas um rótulo com justificativa de 2-3 frases:",
        "- CONSOLIDADO — supressão claramente anterior a 22/07/2008",
        "- VEGETACAO_NATIVA_PRESENTE — vegetação nativa dominante, sem evidência de supressão",
        "- DESMATAMENTO_RECENTE — supressão após 22/07/2008 com evidência visual confirmada",
        "- INCONCLUSIVO — qualidade da imagem, resolução ou sazonalidade impede conclusão segura",
    ].join("\n");
}

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

type AuasYearVerdictLabel =
    | "CONSOLIDADO"
    | "VEGETACAO_NATIVA_PRESENTE"
    | "DESMATAMENTO_RECENTE"
    | "INCONCLUSIVO";

type AuasAvnCrossCheck = {
    auasAreaHa: number;
    avnAreaHa: number;
    overlapAreaHa: number;
    overlapPctOfAuas: number;
    overlapPctOfAvn: number;
    hasAuasOverlapAvn: boolean;
};

function mergeLayerGeometriesAsFeature(
    layerGeoms: Map<string, Geometry[]> | undefined,
    layerName: string,
): Feature<Polygon | MultiPolygon> | null {
    const geoms = layerGeoms?.get(layerName) || [];
    let merged: Feature<Polygon | MultiPolygon> | null = null;
    for (const geom of geoms) {
        const polygonLike = toPolygonOrMultiFeature(geom);
        if (!polygonLike) continue;
        if (!merged) {
            merged = polygonLike;
            continue;
        }
        try {
            const unioned = turfUnion(
                turfFeatureCollection([merged, polygonLike]) as FeatureCollection<Polygon | MultiPolygon>,
            ) as Feature<Polygon | MultiPolygon> | null;
            if (unioned) merged = unioned;
        } catch {
            // keep partial union
        }
    }
    return merged;
}

function computeAuasAvnCrossCheck(job: CachedJob): AuasAvnCrossCheck | null {
    const auasFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AUAS");
    const avnFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AVN");
    if (!auasFeature || !avnFeature) return null;
    const auasAreaHa = turfArea(auasFeature) / 10000;
    const avnAreaHa = turfArea(avnFeature) / 10000;
    let overlapAreaHa = 0;
    try {
        const overlap = turfIntersect(
            turfFeatureCollection([auasFeature, avnFeature]) as FeatureCollection<Polygon | MultiPolygon>,
        ) as Feature<Polygon | MultiPolygon> | null;
        if (overlap) {
            overlapAreaHa = turfArea(overlap) / 10000;
        }
    } catch {
        overlapAreaHa = 0;
    }

    const overlapPctOfAuas = auasAreaHa > 0 ? (overlapAreaHa / auasAreaHa) * 100 : 0;
    const overlapPctOfAvn = avnAreaHa > 0 ? (overlapAreaHa / avnAreaHa) * 100 : 0;
    return {
        auasAreaHa: Number(auasAreaHa.toFixed(4)),
        avnAreaHa: Number(avnAreaHa.toFixed(4)),
        overlapAreaHa: Number(overlapAreaHa.toFixed(4)),
        overlapPctOfAuas: Number(overlapPctOfAuas.toFixed(2)),
        overlapPctOfAvn: Number(overlapPctOfAvn.toFixed(2)),
        hasAuasOverlapAvn: overlapAreaHa > 0.01,
    };
}

function computeAcAvnAuasContext(job: CachedJob): AcAvnAuasContext | null {
    const auasFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AUAS");
    const avnFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AVN");
    if (!auasFeature && !avnFeature) return null;

    const auasAreaHa = auasFeature ? turfArea(auasFeature) / 10000 : 0;
    const avnAreaHa = avnFeature ? turfArea(avnFeature) / 10000 : 0;
    let overlapAreaHa = 0;
    if (auasFeature && avnFeature) {
        try {
            const overlap = turfIntersect(
                turfFeatureCollection([auasFeature, avnFeature]) as FeatureCollection<Polygon | MultiPolygon>,
            ) as Feature<Polygon | MultiPolygon> | null;
            if (overlap) overlapAreaHa = turfArea(overlap) / 10000;
        } catch {
            overlapAreaHa = 0;
        }
    }

    const overlapPctOfAuas = auasAreaHa > 0 ? (overlapAreaHa / auasAreaHa) * 100 : 0;
    const overlapPctOfAvn = avnAreaHa > 0 ? (overlapAreaHa / avnAreaHa) * 100 : 0;
    const auasOutsideAvnAreaHa = Math.max(0, auasAreaHa - overlapAreaHa);
    const auasOutsideAvnPct = auasAreaHa > 0 ? (auasOutsideAvnAreaHa / auasAreaHa) * 100 : 0;

    return {
        hasAuasLayer: Boolean(auasFeature),
        hasAvnLayer: Boolean(avnFeature),
        auasAreaHa: Number(auasAreaHa.toFixed(4)),
        avnAreaHa: Number(avnAreaHa.toFixed(4)),
        overlapAreaHa: Number(overlapAreaHa.toFixed(4)),
        overlapPctOfAuas: Number(overlapPctOfAuas.toFixed(2)),
        overlapPctOfAvn: Number(overlapPctOfAvn.toFixed(2)),
        auasOutsideAvnAreaHa: Number(auasOutsideAvnAreaHa.toFixed(4)),
        auasOutsideAvnPct: Number(auasOutsideAvnPct.toFixed(2)),
    };
}

function extractAuasYearVerdict(text: string): AuasYearVerdictLabel {
    const clean = String(text || "");
    const section =
        clean.match(/##\s*Veredito do Ano[\s\S]{0,220}/i)?.[0] || clean.slice(0, 260);
    const match = section.match(/\b(CONSOLIDADO|VEGETACAO_NATIVA_PRESENTE|DESMATAMENTO_RECENTE|INCONCLUSIVO)\b/i);
    const verdict = String(match?.[1] || "").toUpperCase();
    if (
        verdict === "CONSOLIDADO" ||
        verdict === "VEGETACAO_NATIVA_PRESENTE" ||
        verdict === "DESMATAMENTO_RECENTE" ||
        verdict === "INCONCLUSIVO"
    ) {
        return verdict as AuasYearVerdictLabel;
    }
    return "INCONCLUSIVO";
}

function extractFirstDeforestationYearFromText(text: string): number | null {
    const match = String(text || "").match(/ANO_PROVAVEL_INICIO_DESMATE\s*=\s*(\d{4}|INCONCLUSIVO)/i);
    if (!match) return null;
    const token = String(match[1] || "").toUpperCase();
    if (token === "INCONCLUSIVO") return null;
    const year = Number(token);
    return Number.isFinite(year) ? year : null;
}

/**
 * Build the final synthesis prompt for AUAS analysis — produces a
 * professional environmental forensics report combining per-satellite
 * observations with previous AC/AVN analysis.
 */
function buildAuasFinalSynthesisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    perSatelliteAnalyses: Array<{ satelliteLabel: string; year: number; analysis: string }>,
    previousAcAvnAnalysis?: string,
    options?: {
        acAvnMeta?: any;
        crossCheck?: AuasAvnCrossCheck | null;
        cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
        hasAuasLayer?: boolean;
    },
): string {
    const years = perSatelliteAnalyses.map((a) => a.year).sort();
    const preMarco = years.filter((y) => y <= 2008);
    const postMarco = years.filter((y) => y > 2008);
    const hasAuasLayer = options?.hasAuasLayer !== false;

    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN");
    const acSummary = layerSummaries.find((l) => l.name === "AREA_CONSOLIDADA");

    // Per-satellite analyses with year ordering
    const analysesBlock = perSatelliteAnalyses
        .sort((a, b) => a.year - b.year)
        .map((a) => `### ${a.satelliteLabel} (${a.year})\n${toSynthesisExcerpt(a.analysis, 700)}`)
        .join("\n\n");

    const parts: string[] = [
        "Você é a **GeoForest IA**, responsável por produzir um laudo AUAS técnico e juridicamente preciso.",
        "Sintetize as análises por satélite em um relatório coerente, com foco na progressão temporal da cobertura.",
        "Não usar tabela. Não usar emoji. Não incluir bloco <think>. Tamanho: entre 500 e 800 palavras.",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "## Dados da AUAS",
        hasAuasLayer
            ? (auasSummary ? `- AUAS vetorizada: **${auasSummary.areaHa?.toFixed(2) ?? "0"} ha**` : "- AUAS vetorizada: presente (sem quantitativo)")
            : "- AUAS vetorizada: **AUSENTE** — análise inferencial pela série temporal",
        avnSummary ? `- AVN declarada: ${avnSummary.areaHa?.toFixed(2) ?? "0"} ha` : "",
        acSummary ? `- AC declarada: ${acSummary.areaHa?.toFixed(2) ?? "0"} ha` : "",
        `- Série temporal: ${years.length} satélites (${years[0]}–${years[years.length - 1]})`,
        `- Anos pré-marco (≤2008): ${preMarco.length ? preMarco.join(", ") : "nenhum"}`,
        `- Anos pós-marco (>2008): ${postMarco.length ? postMarco.join(", ") : "nenhum"}`,
        "",
    ];

    if (options?.crossCheck) {
        const cc = options.crossCheck;
        parts.push(
            "## Cruzamento Geométrico AUAS × AVN",
            `- AUAS: ${cc.auasAreaHa.toFixed(2)} ha | AVN: ${cc.avnAreaHa.toFixed(2)} ha`,
            `- Sobreposição AUAS∩AVN: ${cc.overlapAreaHa.toFixed(2)} ha (${cc.overlapPctOfAuas.toFixed(1)}% da AUAS, ${cc.overlapPctOfAvn.toFixed(1)}% da AVN)`,
            `- AUAS fora do AVN: ${(cc.auasAreaHa - cc.overlapAreaHa).toFixed(2)} ha — zona de uso alternativo sem vegetação nativa declarada`,
            `- Sobreposição relevante (>5% da AUAS): ${cc.hasAuasOverlapAvn ? "SIM — verificar se há vegetação nativa persistente nessa porção" : "NAO"}`,
            "- Interprete: AUAS∩AVN indica porção da AUAS que está sobre vegetação declarada; AUAS fora do AVN é a área efetivamente de uso alternativo.",
            "",
        );
    }

    if (options?.cloudWarnings && options.cloudWarnings.length > 0) {
        parts.push(
            "## Limitações por Nebulosidade",
            ...options.cloudWarnings.map((item) => `- ${item.satellite}: ${Math.round(item.cloudScore * 100)}% de cobertura de nuvens — trechos impactados classificados como INCONCLUSIVO`),
            "",
        );
    }

    parts.push(
        "## Análises por Satélite",
        analysesBlock,
        "",
    );

    if (previousAcAvnAnalysis) {
        parts.push(
            "## Referência Cruzada AC/AVN",
            toSynthesisExcerpt(previousAcAvnAnalysis, 2000),
            "",
        );
    }

    if (options?.acAvnMeta) {
        parts.push(
            "## Metadados AC/AVN (Estruturado)",
            clampTextMiddle(JSON.stringify(options.acAvnMeta), 1000),
            "- Se AC/AVN indica AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS=SIM: validar explicitamente se o shape AUAS delimita corretamente essa vegetação.",
            "- Se AC_FORA_SHAPE=SIM: verificar sobreposição com shape AUAS — pode indicar erro de delimitação ou passivo dentro da AUAS.",
            "",
        );
    }

    parts.push(
        hasAuasLayer
            ? "AUAS vetorizada PRESENTE — valide se o limite do shape AUAS é consistente com a progressão temporal observada."
            : "AUAS vetorizada AUSENTE — se houver evidência de supressão pós-2008, declarar AUAS não vetorizada.",
        hasAuasLayer
            ? "Proibido afirmar ausencia de AUAS vetorizada, AUAS nao vetorizada ou AUAS nao declarada neste caso."
            : "Quando a AUAS estiver ausente, declarar explicitamente a ausencia apenas se o ZIP realmente nao contiver a camada AUAS.",
        "",
        "## Critérios de Classificação do Veredito Final",
        "- **AUAS_VALIDA**: o shape AUAS mapeia corretamente área com uso alternativo do solo consolidado até 22/07/2008 OU passivo ambiental pós-2008 adequadamente registrado como tal.",
        "- **AUAS_INVALIDA**: há inconsistência técnica grave na delimitação ou cronologia da AUAS (ex.: AUAS em área com vegetação nativa contínua sem nenhuma supressão temporal; AUAS em área claramente consolidada antes de 2008 sem evidência de uso alternativo).",
        "- **AUAS_PARCIAL**: parte da AUAS é válida e parte apresenta inconsistências; ou AUAS ausente com evidências parciais de supressão pós-marco.",
        "",
        "**Regra para supressão pós-2008 dentro da AUAS vetorizada:**",
        "- NÃO invalida automaticamente a AUAS. Trata-se de passivo ambiental mapeado — a AUAS registra uso alternativo do solo (desmate pós-marco) que requer regularização.",
        "- Use AUAS_INVALIDA somente quando a delimitação espacial ou temporal da AUAS for tecnicamente incorreta (ex.: AUAS cobrindo vegetação nativa intacta desde 2008).",
        "- Use AUAS_VALIDA quando o shape AUAS reflete fielmente a realidade temporal observada, mesmo que haja passivo.",
        "",
        "## Formato Obrigatório de Saída",
        "## Resumo Executivo",
        "## Progressão Temporal da Cobertura",
        "## Achados por Período",
        "## Não Conformidades Detectadas",
        "## Veredito Final AUAS",
        "## Próximas Ações Recomendadas",
        "",
        "No bloco 'Veredito Final AUAS', incluir obrigatoriamente:",
        "- STATUS_FINAL = AUAS_VALIDA | AUAS_INVALIDA | AUAS_PARCIAL",
        "- ANO_PROVAVEL_INICIO_DESMATE = YYYY | INCONCLUSIVO",
        "- CONFIANCA_GERAL = ALTA | MEDIA | BAIXA | INCONCLUSIVO",
        "- Se há supressão confirmada pós-2008 dentro da AUAS, adicionar: PASSIVO_AMBIENTAL = IDENTIFICADO",
        "",
        "Em 'Não Conformidades': citar intervalo de anos, localização aproximada (porção N/NE/S etc.) e área estimada em hectares quando identificada supressão irregular.",
        "Em 'Progressão Temporal': descrever cobertura em 2008 (referência), mudanças em períodos intermediários e situação atual.",
        "Em 'Próximas Ações': máximo 4 ações, priorizadas e específicas para o caso.",
    );

    return parts.join("\n");
}

function stripRoboticVerdictLines(text: string): string {
    const cleaned = String(text || "")
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            if (/^[-*•]?\s*STATUS_FINAL\s*=/i.test(trimmed)) return false;
            if (/^[-*•]?\s*ANO_PROVAVEL_INICIO_DESMATE\s*=/i.test(trimmed)) return false;
            return true;
        })
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return cleaned;
}

function normalizeAuasPassivoNarrative(text: string): string {
    let normalized = String(text || "");
    const hasPostMarcoSignal =
        /\b(2009|2010|2011|2012|2013|2014|2015|2016|2017|2018|2019|2020|2021|2022|2023|2024|2025|2026)\b/.test(normalized) &&
        /(ap[oó]s\s*2008|p[oó]s-marco|passivo ambiental|supress[aã]o)/i.test(normalized);

    if (hasPostMarcoSignal) {
        normalized = normalized.replace(
            /(an[aá]lise\s+multitemporal\s+invalida\s+a\s+declara[cç][aã]o\s+da\s+[áa]rea\s+de\s+uso\s+alternativo\s+do\s+solo[^.]*\.)/gi,
            "A análise multitemporal indica que a AUAS mapeia área com supressão após 2008, caracterizando passivo ambiental que requer regularização.",
        );
        normalized = normalized.replace(
            /(invalida\s+a\s+declara[cç][aã]o\s+da\s+[áa]rea\s+de\s+uso\s+alternativo\s+do\s+solo)/gi,
            "identifica passivo ambiental na área AUAS",
        );
    }

    return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

function enforceAuasDeclaredVectorizationConsistency(
    text: string,
    hasAuasLayer: boolean,
): string {
    let normalized = String(text || "").trim();
    if (!normalized || !hasAuasLayer) return normalized;

    const contradictionSentencePatterns: RegExp[] = [
        /[^\n.]*\b(n[aã]o\s+foi\s+apresentad[oa]\s+(um\s+)?pol[ií]gono\s+de\s+auas\s+vetorizad[oa]|n[aã]o\s+h[aá]\s+shape\s+auas|auas\s+vetorizad[ao]?\s*:\s*ausente|auas\s+n[aã]o\s+vetorizad[ao]|auas\s+n[aã]o\s+declarad[ao])\b[^\n.]*(?:[.]|$)/gi,
    ];

    let removedAny = false;
    for (const pattern of contradictionSentencePatterns) {
        normalized = normalized.replace(pattern, () => {
            removedAny = true;
            return "";
        });
    }

    // Defensive phrase-level cleanup for short fragments that may survive sentence removal.
    normalized = normalized
        .replace(/\bAUAS\s+n[aã]o\s+vetorizad[ao]\b/gi, "AUAS declarada")
        .replace(/\bAUAS\s+n[aã]o\s+declarad[ao]\b/gi, "AUAS declarada")
        .replace(/\bAUAS\s+vetorizada\s*:\s*AUSENTE\b/gi, "AUAS vetorizada: presente");

    const hasConsistencyNote = /shape\s+AUAS\s+vetorizad[oa]\s+no\s+ZIP/i.test(normalized);
    if (removedAny && !hasConsistencyNote) {
        normalized = [
            normalized,
            "",
            "Observacao tecnica obrigatoria: ha shape AUAS vetorizado no ZIP. Se houver supressao pos-2008, isso representa passivo ambiental dentro da AUAS declarada, e nao ausencia de declaracao da AUAS.",
        ]
            .filter(Boolean)
            .join("\n");
    }

    return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

function enforceAuasMissingVectorizationGuidance(
    text: string,
    hasAuasLayer: boolean,
    yearVerdicts: Array<{ year: number; verdict: AuasYearVerdictLabel }>,
    firstDeforestationYear: number | null,
): string {
    if (hasAuasLayer) return String(text || "");

    const base = String(text || "").trim();
    const hasPost2008Verdict = yearVerdicts.some(
        (item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE",
    );
    const hasPost2008Year = Number.isFinite(firstDeforestationYear as number) && Number(firstDeforestationYear) > 2008;
    const hasPost2008Text = /(ap[oó]s\s*2008|p[oó]s-marco|desmat|supress[aã]o)/i.test(base) && /\b(2009|20[1-2]\d)\b/.test(base);
    const hasEvidence = Boolean(hasPost2008Verdict || hasPost2008Year || hasPost2008Text);
    const alreadyMentionsMissingVectorization = /(n[aã]o\s+vetorizad|aus[eê]ncia\s+de\s+auas\s+vetorizad|auas\s+vetorizada:\s+ausente)/i.test(base);

    if (alreadyMentionsMissingVectorization) return base;

    const mandatoryNote = hasEvidence
        ? "Observação técnica obrigatória: o ZIP não possui shape AUAS vetorizado. A série temporal indica supressão após 2008 na propriedade, portanto há indício de AUAS não vetorizada (passivo ambiental a regularizar)."
        : "Observação técnica obrigatória: o ZIP não possui shape AUAS vetorizado e, nesta análise, não houve indício consistente de supressão pós-2008 que confirme AUAS não vetorizada.";

    return [base, "", mandatoryNote].filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildIntegratedAcAvnAuasPrompt(
    previousAcAvnAnalysis: string,
    auasSynthesisText: string,
    options?: {
        acAvnMeta?: any;
        crossCheck?: AuasAvnCrossCheck | null;
        firstDeforestationYear?: number | null;
        hasAuasLayer?: boolean;
    },
): string {
    const acText = toSynthesisExcerpt(previousAcAvnAnalysis, 2600);
    const auasText = toSynthesisExcerpt(auasSynthesisText, 2600);
    const parts: string[] = [
        "Você é a revisora final de um laudo técnico ambiental.",
        "Unifique os resultados de AC/AVN e AUAS em um único parecer claro, natural e objetivo.",
        "Não use linguagem robótica, não repita blocos longos e não copie os textos integralmente.",
        "",
        "## Base AC/AVN",
        acText,
        "",
        "## Base AUAS",
        auasText,
        "",
    ];

    if (options?.acAvnMeta) {
        parts.push(
            "Metadados AC/AVN (apoio):",
            clampTextMiddle(JSON.stringify(options.acAvnMeta), 900),
            "",
        );
    }
    if (options?.crossCheck) {
        const cc = options.crossCheck;
        parts.push(
            "Cruzamento geométrico AUAS x AVN:",
            `- AUAS total: ${cc.auasAreaHa.toFixed(2)} ha`,
            `- AVN total: ${cc.avnAreaHa.toFixed(2)} ha`,
            `- Interseção AUAS∩AVN: ${cc.overlapAreaHa.toFixed(2)} ha`,
            "",
        );
    }
    if (Number.isFinite(options?.firstDeforestationYear as number)) {
        parts.push(
            `Ano provável inicial de supressão já identificado: ${Number(options?.firstDeforestationYear)}.`,
            "",
        );
    }
    if (options?.hasAuasLayer === false) {
        parts.push(
            "Contexto adicional: o ZIP não possui shape AUAS vetorizado.",
            "Se houver evidência de supressão pós-2008, declarar que há AUAS não vetorizada (passivo ambiental).",
            "",
        );
    } else {
        parts.push(
            "Contexto adicional: o ZIP possui shape AUAS vetorizado.",
            "Nao afirmar AUAS ausente, AUAS nao vetorizada ou AUAS nao declarada neste caso.",
            "",
        );
    }

    parts.push(
        "Formato obrigatório:",
        "## Resumo Geral",
        "## Pontos Críticos (AC/AVN e AUAS)",
        "## Veredito Integrado",
        "## Próximas Ações",
        "",
        "Regras obrigatórias:",
        "- Escrever em português técnico claro, em frases naturais.",
        "- Não usar linhas no formato STATUS_FINAL = ...",
        "- Não usar linhas no formato ANO_PROVAVEL_INICIO_DESMATE = ...",
        "- Quando citar ano provável de desmate, escrever em frase corrida.",
        "- Se AUAS indicar supressão pós-2008, descrever como passivo ambiental identificado na área AUAS (não como invalidação automática da AUAS).",
        "- Quando AUAS vetorizada estiver ausente e houver supressão pós-2008, afirmar explicitamente que há AUAS não vetorizada.",
        "- Quando AUAS vetorizada estiver presente, nunca afirmar AUAS ausente/não vetorizada/não declarada.",
        "- Só usar linguagem de 'AUAS inválida' quando houver incoerência técnica de vetorização/delimitação, não apenas por existir passivo pós-marco.",
        "- Limite de tamanho: 260 a 420 palavras.",
        "- Sem tabelas e sem bloco <think>.",
    );

    return parts.join("\n");
}

/** Main AUAS analysis pipeline (called from the SSE endpoint). */
async function processAuasAnalysis(
    res: Response,
    jobId: string,
    previousAnalysis?: string,
    contextUrl?: string,
    outputZipUrl?: string,
    acAvnMeta?: any,
): Promise<boolean> {
    throwIfClientDisconnected(res);
    let job = jobCache.get(jobId);
    if ((!job || !job.bbox || !job.polygon || !job.layerSummaries) && contextUrl) {
        job = (await hydrateJobFromPersistedContext(jobId, contextUrl)) ?? undefined;
    }
    if ((!job || !job.bbox || !job.polygon || !job.layerSummaries) && outputZipUrl) {
        job = (await hydrateJobFromOutputZipUrl(jobId, outputZipUrl)) ?? undefined;
    }
    if (!job || !job.bbox || !job.polygon || !job.layerSummaries) {
        sendSSE(res, {
            type: "error",
            message: "Job não encontrado. Envie contextUrl ou gere o recorte novamente.",
        });
        return false;
    }

    const { layerSummaries, areaHa: propAreaHa } = job;
    const areaHa = propAreaHa ?? 0;

    // AUAS can be absent in imported ZIP; in this case infer AUAS from temporal change after 2008.
    const auasGeoms = job.clippedGeometries?.get("AUAS");
    const hasAuasLayer = Boolean(auasGeoms && auasGeoms.length > 0);
    if (!hasAuasLayer) {
        console.warn(`[AUAS ANALYSIS] AUAS layer absent for job ${jobId}; running temporal inference mode.`);
        sendSSE(res, {
            type: "progress",
            step: "generating_images",
            percent: 4,
            message: "AUAS nao vetorizada no ZIP. Analise temporal sera executada na propriedade para detectar supressao pos-2008.",
        });
    }

    // Step 1: Generate satellite images with AUAS overlay
    sendSSE(res, { type: "progress", step: "generating_images", percent: 5, message: "Iniciando geração de imagens AUAS..." });
    throwIfClientDisconnected(res);

    let imagesToAnalyze: Array<{ dataUrl: string; caption: string }>;
    let usedSatelliteKeys: string[] = [];
    let missingSatelliteKeys: string[] = [];
    let cloudWarnings: Array<{ satellite: string; cloudScore: number }> = [];
    try {
        const generated = await generateAuasSatelliteImages(res, job, hasAuasLayer);
        imagesToAnalyze = generated.images;
        usedSatelliteKeys = generated.usedKeys;
        missingSatelliteKeys = generated.missingKeys;
        cloudWarnings = generated.cloudWarnings;
    } catch (err: any) {
        console.error("[AUAS ANALYSIS] Image generation error:", err.message);
        sendSSE(res, { type: "error", message: `Erro ao gerar imagens AUAS: ${err.message}` });
        return false;
    }

    if (imagesToAnalyze.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem AUAS foi gerada. Verifique a disponibilidade das camadas WMS." });
        return false;
    }

    // Step 2: Upload to Cloudinary
    sendSSE(res, { type: "progress", step: "uploading_images", percent: 50, message: "Salvando imagens AUAS no Cloudinary..." });

    const cloudinaryUrls: Array<{ url: string; caption: string }> = [];
    try {
        for (let i = 0; i < imagesToAnalyze.length; i++) {
            throwIfClientDisconnected(res);
            const img = imagesToAnalyze[i];
            const filename = `simcar_auas_${jobId.slice(0, 8)}_img${i + 1}`;
            const url = await uploadToCloudinary(img.dataUrl, filename);
            cloudinaryUrls.push({ url, caption: img.caption });
            sendSSE(res, {
                type: "progress", step: "uploading_images",
                percent: 50 + Math.round(((i + 1) / imagesToAnalyze.length) * 10),
                message: `Upload AUAS ${i + 1}/${imagesToAnalyze.length}...`,
            });
        }
    } catch (err: any) {
        console.error("[AUAS ANALYSIS] Cloudinary upload error:", err.message);
    }

    // Step 3: Prepare images for AI
    sendSSE(res, { type: "progress", step: "analyzing", percent: 62, message: "Preparando imagens AUAS para análise IA..." });
    throwIfClientDisconnected(res);

    const aiImages: AiImage[] = [];
    if (cloudinaryUrls.length === imagesToAnalyze.length) {
        for (const cu of cloudinaryUrls) {
            aiImages.push({
                url: getCloudinaryAiUrl(cu.url),
                geminiUrl: getCloudinaryGeminiUrl(cu.url),
                caption: cu.caption,
            });
        }
    } else {
        for (const img of imagesToAnalyze) {
            try {
                const compressed = await compressForVision(img.dataUrl);
                aiImages.push({ dataUrl: compressed, caption: img.caption });
            } catch {
                aiImages.push({ dataUrl: img.dataUrl, caption: img.caption });
            }
        }
    }

    const spot2008Label = SATELLITE_LAYERS.spot_2008?.label;
    const landsat2008Label = SATELLITE_LAYERS.landsat5_2008?.label;
    const pickBaselineImage = (label?: string) => {
        if (!label) return undefined;
        return (
            aiImages.find((img) => img.caption.startsWith(label) && /contexto/i.test(img.caption)) ||
            aiImages.find((img) => img.caption.startsWith(label))
        );
    };
    const spot2008ReferenceImage = pickBaselineImage(spot2008Label);
    const landsat2008ReferenceImage = pickBaselineImage(landsat2008Label);
    const baselineReferenceImage = spot2008ReferenceImage || landsat2008ReferenceImage;
    const baselineReferenceLabel =
        baselineReferenceImage?.caption || spot2008Label || landsat2008Label || null;

    // Step 4: Per-satellite AI analysis
    const perSatResults: Array<{ satelliteLabel: string; year: number; analysis: string }> = [];
    const validKeys = AUAS_SATELLITE_KEYS.filter((k) => SATELLITE_LAYERS[k]);
    const cloudBySatellite = new Map<string, { satellite: string; cloudScore: number }>();
    for (const item of cloudWarnings) {
        cloudBySatellite.set(item.satellite, item);
    }
    let satIdx = 0;

    for (const key of validKeys) {
        throwIfClientDisconnected(res);
        const sat = SATELLITE_LAYERS[key];
        if (!sat) continue;

        const satImages = aiImages.filter((img) => img.caption.startsWith(sat.label));
        if (satImages.length === 0) { satIdx++; continue; }
        let imagesForModel = satImages;
        if (sat.year > 2008 && baselineReferenceImage) {
            const hasBaselineAlready = satImages.some((img) => img.caption === baselineReferenceImage.caption);
            imagesForModel = hasBaselineAlready ? satImages : [baselineReferenceImage, ...satImages];
        }

        const progressPct = 65 + Math.round((satIdx / validKeys.length) * 20);
        sendSSE(res, {
            type: "progress", step: "analyzing", percent: progressPct,
            message: `IA analisando AUAS em ${sat.label} (${satIdx + 1}/${validKeys.length})...`,
        });

        try {
            const prompt = buildAuasSingleSatPrompt(
                areaHa,
                layerSummaries,
                key,
                cloudBySatellite.get(sat.label),
                { hasAuasLayer, baselineReferenceLabel },
            );
            const result = await analyzeWithGroqAndGemini(
                imagesForModel,
                prompt,
                `${hasAuasLayer ? "AUAS" : "AUAS inferida"} ${sat.label} (${sat.year})`,
            );
            const split = splitThinkProgress(result);
            if (split.thinkingText) {
                sendSSE(res, { type: "model_thinking", source: `AUAS ${sat.label}`, thinkingText: split.thinkingText });
            }
            perSatResults.push({ satelliteLabel: sat.label, year: sat.year, analysis: result });
            console.log(`[AUAS ANALYSIS] ${sat.label} analysis complete (${result.length} chars)`);
        } catch (err: any) {
            console.error(`[AUAS ANALYSIS] ${sat.label} failed:`, err.message);
            sendSSE(res, {
                type: "progress", step: "analyzing", percent: progressPct,
                message: `Aviso: análise AUAS de ${sat.label} falhou, continuando...`,
            });
        }
        satIdx++;
    }

    perSatResults.sort((a, b) => a.year - b.year || a.satelliteLabel.localeCompare(b.satelliteLabel));

    if (perSatResults.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma análise AUAS individual foi concluída com sucesso." });
        return false;
    }

    // Step 5: Final synthesis (combines AUAS + previous AC/AVN analysis)
    sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA sintetizando laudo integrado de AUAS..." });
    throwIfClientDisconnected(res);

    let auasSynthesisText: string;
    const truncatedPreviousAnalysis = clampTextMiddle(previousAnalysis || "", 4200);
    const crossCheck = computeAuasAvnCrossCheck(job);
    const resolvedAcAvnMeta = resolveAuasAcAvnMeta(previousAnalysis, acAvnMeta);
    try {
        const synthesisPrompt = buildAuasFinalSynthesisPrompt(
            areaHa,
            layerSummaries,
            perSatResults,
            truncatedPreviousAnalysis,
            {
                acAvnMeta: resolvedAcAvnMeta,
                crossCheck,
                cloudWarnings,
                hasAuasLayer,
            },
        );
        auasSynthesisText = await callBestTextSynthesis(
            [{ role: "user", content: synthesisPrompt }],
            "sintese AUAS final",
        );
        const split = splitThinkProgress(auasSynthesisText);
        if (split.thinkingText) {
            sendSSE(res, { type: "model_thinking", source: "Síntese AUAS", thinkingText: split.thinkingText });
        }
        console.log(`[AUAS ANALYSIS] Final synthesis complete (${auasSynthesisText.length} chars)`);
    } catch (err: any) {
        console.error("[AUAS ANALYSIS] Synthesis failed, concatenating:", err.message);
        auasSynthesisText = perSatResults.map((r) => [
            `## AUAS: ${r.satelliteLabel} (${r.year})`,
            "",
            r.analysis,
        ].join("\n")).join("\n\n---\n\n");
    }

    const yearVerdicts = perSatResults.map((item) => ({
        satelliteLabel: item.satelliteLabel,
        year: item.year,
        verdict: extractAuasYearVerdict(item.analysis),
    }));
    let firstDeforestationYear = extractFirstDeforestationYearFromText(auasSynthesisText);
    if (!firstDeforestationYear) {
        const inferred = yearVerdicts
            .filter((item) => item.verdict === "DESMATAMENTO_RECENTE")
            .map((item) => item.year)
            .sort((a, b) => a - b);
        firstDeforestationYear = inferred.length > 0 ? inferred[0] : null;
    }

    let analysisText = auasSynthesisText;
    if (truncatedPreviousAnalysis.trim()) {
        throwIfClientDisconnected(res);
        sendSSE(res, {
            type: "progress",
            step: "analyzing",
            percent: 94,
            message: "IA unificando conclusoes de AC/AVN e AUAS em resumo final...",
        });
        try {
            const unifiedPrompt = buildIntegratedAcAvnAuasPrompt(
                truncatedPreviousAnalysis,
                auasSynthesisText,
                {
                    acAvnMeta: resolvedAcAvnMeta,
                    crossCheck,
                    firstDeforestationYear,
                    hasAuasLayer,
                },
            );
            const unified = await callBestTextSynthesis(
                [{ role: "user", content: unifiedPrompt }],
                "sintese final integrada AC_AVN_AUAS",
                {
                    modelChain: SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
                    maxOutputTokens: 4096,
                },
            );
            const splitUnified = splitThinkProgress(unified);
            if (splitUnified.thinkingText) {
                sendSSE(res, {
                    type: "model_thinking",
                    source: "Sintese integrada final",
                    thinkingText: splitUnified.thinkingText,
                });
            }
            analysisText = stripRoboticVerdictLines(splitUnified.answerText || unified);
            if (!analysisText.trim()) {
                analysisText = stripRoboticVerdictLines(auasSynthesisText);
            }
            console.log(`[AUAS ANALYSIS] Integrated synthesis complete (${analysisText.length} chars)`);
        } catch (err: any) {
            console.warn(`[AUAS ANALYSIS] Integrated synthesis fallback to AUAS text: ${err?.message || err}`);
            analysisText = stripRoboticVerdictLines(auasSynthesisText);
        }
    } else {
        analysisText = stripRoboticVerdictLines(auasSynthesisText);
    }

    const inferredAuasNotVectorized = !hasAuasLayer && (
        (Number.isFinite(firstDeforestationYear as number) && Number(firstDeforestationYear) > 2008) ||
        yearVerdicts.some((item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE")
    );
    const auasMeta = {
        yearVerdicts,
        firstDeforestationYear,
        auasAvnCrossCheck: crossCheck,
        acAvnContextSource:
            resolvedAcAvnMeta?.source === "derived_from_previous_analysis" ? "derived_from_previous_analysis" : "provided",
        integratedSummaryModelChain: SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
        hasAuasVectorizedLayer: hasAuasLayer,
        inferredAuasNotVectorized,
        cloudWarnings,
        satellitesUsed: usedSatelliteKeys,
        satellitesMissing: missingSatelliteKeys,
    };
    analysisText = normalizeAuasPassivoNarrative(analysisText);
    analysisText = enforceAuasDeclaredVectorizationConsistency(analysisText, hasAuasLayer);
    analysisText = enforceAuasMissingVectorizationGuidance(
        analysisText,
        hasAuasLayer,
        yearVerdicts,
        firstDeforestationYear,
    );

    // Step 6: Complete
    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    sendSSE(res, {
        type: "complete",
        percent: 100,
        analysis: analysisText,
        images: cloudinaryUrls,
        layerSummaries: layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
        auasAreaHa: auasSummary?.areaHa ?? 0,
        auasMeta,
        cloudWarnings: cloudWarnings.length > 0 ? cloudWarnings : undefined,
    });
    return true;
}

/**
 * Generate composited satellite images for given layers.
 * Returns array of { dataUrl, caption } for each satellite x 3 views.
 */
async function generateSatelliteImages(
    res: Response,
    job: CachedJob,
    selectedLayers: string[],
): Promise<{
    images: Array<{ dataUrl: string; caption: string }>;
    usedKeys: string[];
    missingKeys: string[];
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
    resolution: { width: number; height: number };
}> {
    throwIfClientDisconnected(res);
    const { bbox, polygon: propertyPolygon, clippedGeometries } = job;
    const paddedBbox = padBbox(bbox!, 0.10);

    // Dynamic resolution based on property size
    const areaHa = job.areaHa ?? 0;
    const { width: IMG_W, height: IMG_H } = calculateDynamicResolution(areaHa, paddedBbox);
    console.log(`[SIMCAR ANALYSIS] Dynamic resolution: ${IMG_W}×${IMG_H} for ${areaHa.toFixed(1)} ha property`);

    // Simplify geometries for overlay if complex
    const rawLayerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map(g => simplifyGeometryForOverlay(g, 500)));
    }

    const images: Array<{ dataUrl: string; caption: string }> = [];
    const usedKeys: string[] = [];
    const missingKeys: string[] = [];
    const cloudWarnings: Array<{ satellite: string; cloudScore: number }> = [];

    const validKeys = getOrderedSatelliteKeys(selectedLayers);

    const totalSteps = validKeys.length * 3;
    let step = 0;

    for (const key of validKeys) {
        throwIfClientDisconnected(res);
        const sat = SATELLITE_LAYERS[key];
        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `Baixando imagem ${sat.label}...`,
        });

        const candidateLayers = Array.from(new Set([sat.wmsLayer, ...(sat.wmsAliases || [])].filter(Boolean)));
        let basePng: Buffer | null = null;
        let resolvedLayer = "";
        let lastLayerError = "unknown";

        for (const layerName of candidateLayers) {
            throwIfClientDisconnected(res);
            try {
                basePng = await fetchWmsImageBuffer([layerName], paddedBbox, IMG_W, IMG_H);
                resolvedLayer = layerName;
                break;
            } catch (err: any) {
                lastLayerError = err.message || String(err);
                console.warn(`[SIMCAR ANALYSIS] WMS ${sat.label} (${layerName}) failed: ${lastLayerError}`);
            }
        }

        if (!basePng) {
            console.warn(`[SIMCAR ANALYSIS] WMS ${sat.label} unavailable across candidates: ${candidateLayers.join(", ")}. Last error: ${lastLayerError}`);
            missingKeys.push(key);
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponivel, pulando...`,
            });
            step += 3;
            continue;
        }
        usedKeys.push(key);
        if (resolvedLayer && resolvedLayer !== sat.wmsLayer) {
            console.log(`[SIMCAR ANALYSIS] ${sat.label} using fallback layer ${resolvedLayer} (primary=${sat.wmsLayer})`);
        }

        // Cloud detection on base image
        try {
            const cloudResult = await detectCloudCover(basePng);
            if (cloudResult.isLikelyCloudy) {
                cloudWarnings.push({ satellite: sat.label, cloudScore: cloudResult.cloudScore });
                console.warn(
                    `[SIMCAR ANALYSIS] ⚠ ${sat.label}: possible cloud/occlusion detected ` +
                    `(score=${cloudResult.cloudScore}, bright=${cloudResult.brightPixelRatio}, contrast=${cloudResult.contrastScore})`,
                );
                sendSSE(res, {
                    type: "progress", step: "generating_images",
                    percent: 10 + Math.round((step / totalSteps) * 40),
                    message: `⚠ ${sat.label}: possível cobertura de nuvens detectada (${Math.round(cloudResult.cloudScore * 100)}%)`,
                });
            }
        } catch {
            // Cloud detection is non-fatal
        }

        // 3 composites per satellite
        // 1: Overview (AC + AVN + AUAS + ARL + property)
        const overviewLayers: Array<{ name: string; stroke: string; fill: string; strokeWidth: number }> = [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.22)", strokeWidth: 2.5 },
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.22)", strokeWidth: 2.5 },
            { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.10)", strokeWidth: 2 },
        ];
        // Add ARL/ARLREM overlay if present
        if (layerGeos.has("ARL") || layerGeos.has("ARLREM")) {
            overviewLayers.push({ name: "ARL", stroke: "#22C55E", fill: "rgba(34, 197, 94, 0.12)", strokeWidth: 2 });
            overviewLayers.push({ name: "ARLREM", stroke: "#16A34A", fill: "rgba(22, 163, 74, 0.10)", strokeWidth: 1.8 });
        }
        const overviewSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, overviewLayers);
        const hasArl = layerGeos.has("ARL") || layerGeos.has("ARLREM");
        images.push({ dataUrl: await compositeOverlay(basePng, overviewSvg), caption: `${sat.label} - Visao Geral (propriedade + AC + AVN + AUAS${hasArl ? " + ARL" : ""})` });
        step++;

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `${sat.label}: renderizando Area Consolidada...`,
        });

        // 2: AC only (increased stroke width for clarity)
        const acSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.28)", strokeWidth: 3 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, acSvg), caption: `${sat.label} - Area Consolidada` });
        step++;

        // 3: AVN only (increased stroke width for clarity)
        const avnSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.28)", strokeWidth: 3 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, avnSvg), caption: `${sat.label} - AVN` });
        step++;
    }

    return { images, usedKeys, missingKeys, cloudWarnings, resolution: { width: IMG_W, height: IMG_H } };
}

function getFeatureBbox(feature: Feature<Polygon | MultiPolygon>): [number, number, number, number] | null {
    const coords = feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates.flat()
        : feature.geometry.coordinates.flat(2);
    if (!coords.length) return null;
    const lngs = coords.map((c: any) => Number(c[0])).filter(Number.isFinite);
    const lats = coords.map((c: any) => Number(c[1])).filter(Number.isFinite);
    if (!lngs.length || !lats.length) return null;
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function ringClosed(ring: number[][]): number[][] {
    if (ring.length < 3) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring;
    return [...ring, [first[0], first[1]]];
}

function parseCachedContextFromOutputZip(
    zipBuffer: Buffer,
    filename: string,
    outputZipUrl?: string,
): CachedJob | null {
    const entries = extractZipEntries(zipBuffer);
    const clippedGeometries = new Map<string, Geometry[]>();
    const layerSummaries: LayerSummary[] = [];

    for (const entry of entries) {
        if (!entry.name.toLowerCase().endsWith(".shp")) continue;
        const layerName = path.basename(entry.name, ".shp").toUpperCase();
        const polygons = readFullShapefile(entry.data);
        const geometries: Geometry[] = [];
        let areaHa = 0;
        for (const rings of polygons) {
            const closed = rings.map((ring) => ringClosed(ring));
            if (!closed.length || closed[0].length < 4) continue;
            try {
                const feat = turfPolygon(closed as any);
                geometries.push(feat.geometry as Geometry);
                areaHa += turfArea(feat) / 10000;
            } catch {
                // ignore malformed polygon
            }
        }
        if (geometries.length > 0) clippedGeometries.set(layerName, geometries);
        layerSummaries.push({
            name: layerName,
            source: DIRECT_COPY_LAYERS.has(layerName as any) ? "property" : "wfs",
            features: geometries.length,
            areaHa: Number(areaHa.toFixed(4)),
        });
    }

    const propertyCandidates = ["ATP", "AIR"];
    let propertyFeature: Feature<Polygon | MultiPolygon> | null = null;
    for (const key of propertyCandidates) {
        const geoms = clippedGeometries.get(key);
        if (!geoms || geoms.length === 0) continue;
        for (const geom of geoms) {
            const polygonLike = toPolygonOrMultiFeature(geom);
            if (!polygonLike) continue;
            if (!propertyFeature) {
                propertyFeature = polygonLike;
                continue;
            }
            try {
                const merged = turfUnion(turfFeatureCollection([propertyFeature, polygonLike]) as any) as
                    | Feature<Polygon | MultiPolygon>
                    | null;
                if (merged) propertyFeature = merged;
            } catch {
                // keep partial
            }
        }
        if (propertyFeature) break;
    }

    if (!propertyFeature) return null;
    const bbox = getFeatureBbox(propertyFeature);
    if (!bbox) return null;
    const areaHa = Number((turfArea(propertyFeature) / 10000).toFixed(4));

    return {
        expiresAt: Date.now() + CACHE_TTL_MS,
        filename,
        bbox,
        polygon: propertyFeature,
        layerSummaries,
        areaHa,
        clippedGeometries,
        outputZipUrl,
    };
}

async function hydrateJobFromOutputZipUrl(jobId: string, outputZipUrl?: string): Promise<CachedJob | null> {
    if (!outputZipUrl) return null;
    try {
        const response = await fetch(outputZipUrl);
        if (!response.ok) {
            throw new Error(`ZIP ${response.status}`);
        }
        const arr = await response.arrayBuffer();
        const zipBuffer = Buffer.from(arr);
        const hydrated = parseCachedContextFromOutputZip(
            zipBuffer,
            `SIMCAR_Recorte_${jobId}.zip`,
            outputZipUrl,
        );
        if (!hydrated) {
            throw new Error("Não foi possível reconstruir contexto pelo ZIP");
        }
        jobCache.set(jobId, hydrated);
        return hydrated;
    } catch (err: any) {
        console.warn(`[SIMCAR ANALYSIS] zip hydrate failed for ${jobId}:`, err?.message || err);
        return null;
    }
}

async function hydrateJobFromPersistedContext(
    jobId: string,
    contextUrl?: string,
): Promise<CachedJob | null> {
    if (!contextUrl) return null;
    try {
        const response = await fetch(contextUrl);
        if (!response.ok) {
            throw new Error(`Contexto ${response.status}`);
        }
        const parsed = parsePersistedClipContext(await response.json());
        if (!parsed) {
            throw new Error("Formato de contexto inválido");
        }
        const clipMap = objectToMapGeometry(parsed.clippedGeometries);
        const hydrated: CachedJob = {
            expiresAt: Date.now() + CACHE_TTL_MS,
            filename: parsed.filename,
            bbox: parsed.bbox,
            polygon: parsed.polygon,
            layerSummaries: parsed.layerSummaries,
            areaHa: parsed.areaHa,
            clippedGeometries: clipMap,
            inputZipUrl: parsed.inputZipUrl,
            outputZipUrl: parsed.outputZipUrl,
            contextJsonUrl: contextUrl,
        };
        jobCache.set(jobId, hydrated);
        return hydrated;
    } catch (err: any) {
        console.warn(`[SIMCAR ANALYSIS] context hydrate failed for ${jobId}:`, err?.message || err);
        return null;
    }
}

/**
 * Core satellite image + AI analysis pipeline.
 * Generates images, uploads to Cloudinary, runs the full AC/AVN analysis, and
 * returns the result. Sends intermediate SSE events (progress, model_thinking, error)
 * but does NOT send the final complete/result event — the caller is responsible.
 *
 * @returns AcAvnAnalysisResult or null if a fatal error occurred (error SSE was already sent).
 */
export async function runAcAvnSatelliteAnalysis(
    res: Response,
    job: CachedJob,
    selectedLayers: string[],
    options: { tag?: string; aiAnalysis?: boolean } = {},
): Promise<AcAvnAnalysisResult | null> {
    const tag = options.tag ?? crypto.randomUUID().slice(0, 8);
    const aiAnalysis = options.aiAnalysis !== false;

    const { layerSummaries, areaHa: propAreaHa } = job;
    const areaHa = propAreaHa ?? 0;
    const acAvnAuasContext = computeAcAvnAuasContext(job);

    // Step 1: Generate satellite images with polygon overlays
    sendSSE(res, { type: "progress", step: "generating_images", percent: 10, message: "Iniciando geracao de imagens..." });
    throwIfClientDisconnected(res);

    let imagesToAnalyze: Array<{ dataUrl: string; caption: string }>;
    let usedSatelliteKeys: string[] = [];
    let missingSatelliteKeys: string[] = [];
    let cloudWarnings: Array<{ satellite: string; cloudScore: number }> = [];
    try {
        const generated = await generateSatelliteImages(res, job, selectedLayers);
        imagesToAnalyze = generated.images;
        usedSatelliteKeys = generated.usedKeys;
        missingSatelliteKeys = generated.missingKeys;
        cloudWarnings = generated.cloudWarnings;
        console.log(
            `[SIMCAR ANALYSIS] Fixed AC/AVN set: requested=${selectedLayers.join(", ")}; used=${usedSatelliteKeys.join(", ") || "none"}; missing=${missingSatelliteKeys.join(", ") || "none"}` +
            (cloudWarnings.length > 0 ? `; cloudWarnings=${cloudWarnings.map(c => `${c.satellite}(${Math.round(c.cloudScore * 100)}%)`).join(", ")}` : ""),
        );
    } catch (err: any) {
        console.error("[SIMCAR ANALYSIS] Image generation error:", err.message);
        sendSSE(res, { type: "error", message: `Erro ao gerar imagens: ${err.message}` });
        return null;
    }

    if (imagesToAnalyze!.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem de satelite foi gerada. Verifique a disponibilidade das camadas WMS." });
        return null;
    }

    // Step 2: Upload to Cloudinary (full quality for user viewing)
    sendSSE(res, { type: "progress", step: "uploading_images", percent: 50, message: "Salvando imagens no Cloudinary..." });
    const cloudinaryUrls: Array<{ url: string; caption: string }> = [];
    try {
        for (let i = 0; i < imagesToAnalyze!.length; i++) {
            throwIfClientDisconnected(res);
            const img = imagesToAnalyze![i];
            const filename = `simcar_analysis_${tag}_img${i + 1}`;
            const url = await uploadToCloudinary(img.dataUrl, filename);
            cloudinaryUrls.push({ url, caption: img.caption });
            console.log(`[SIMCAR ANALYSIS] Uploaded image ${i + 1}: ${url}`);
            sendSSE(res, {
                type: "progress", step: "uploading_images",
                percent: 50 + Math.round(((i + 1) / imagesToAnalyze!.length) * 10),
                message: `Upload ${i + 1}/${imagesToAnalyze!.length}...`,
            });
        }
    } catch (err: any) {
        console.error("[SIMCAR ANALYSIS] Cloudinary upload error:", err.message);
        sendSSE(res, { type: "progress", step: "uploading_images", percent: 60, message: "Aviso: falha ao salvar no Cloudinary. Continuando..." });
    }

    if (!aiAnalysis) {
        return {
            analysisText: "",
            cloudinaryUrls,
            usedSatelliteKeys,
            missingSatelliteKeys,
            cloudWarnings,
            analysisMeta: {} as AcAvnAnalysisMeta,
            layerSummaries: layerSummaries!,
            imageOnly: true,
        };
    }

    // Step 3: Prepare images for AI (use Cloudinary URLs or compress base64 as fallback)
    sendSSE(res, { type: "progress", step: "analyzing", percent: 62, message: "Preparando imagens para analise IA..." });
    throwIfClientDisconnected(res);

    const aiImages: AiImage[] = [];
    if (cloudinaryUrls.length === imagesToAnalyze!.length) {
        for (const cu of cloudinaryUrls) {
            aiImages.push({
                url: getCloudinaryAiUrl(cu.url),
                geminiUrl: getCloudinaryGeminiUrl(cu.url),
                caption: cu.caption,
            });
        }
        console.log(`[SIMCAR ANALYSIS] Using ${aiImages.length} Cloudinary URLs (Groq: 800x600 q65 / Gemini: 1024x768 q82) for vision API`);
    } else {
        console.log(`[SIMCAR ANALYSIS] Cloudinary partial/failed, compressing ${imagesToAnalyze!.length} images for vision API`);
        for (const img of imagesToAnalyze!) {
            try {
                const compressed = await compressForVision(img.dataUrl);
                aiImages.push({ dataUrl: compressed, caption: img.caption });
            } catch {
                aiImages.push({ dataUrl: img.dataUrl, caption: img.caption });
            }
        }
    }

    // Step 4: AI Analysis - strategy depends on number of satellites
    const validKeys = getOrderedSatelliteKeys(selectedLayers);
    const isMultiSatellite = validKeys.length > 1;

    if (isMultiSatellite && SIMCAR_ANALYSIS_MODE !== "detailed") {
        console.log(
            `[SIMCAR ANALYSIS] Multi-satellite mode using efficient strategy (single unified call). ` +
            `Set SIMCAR_ANALYSIS_MODE=detailed to enable per-satellite synthesis.`,
        );
    }
    if (isMultiSatellite && SIMCAR_ANALYSIS_MODE === "detailed" && FORCE_AC_AVN_UNIFIED_ANALYSIS) {
        console.log("[SIMCAR ANALYSIS] Detailed mode requested, but AC/AVN is forced to unified mode for token efficiency.");
    }

    let analysisText: string;

    if (isMultiSatellite && SIMCAR_ANALYSIS_MODE === "detailed" && !FORCE_AC_AVN_UNIFIED_ANALYSIS) {
        console.log(`[SIMCAR ANALYSIS] Multi-satellite mode: ${validKeys.length} satellites, analyzing individually...`);
        const perSatelliteResults: Array<{ satelliteLabel: string; year: number; analysis: string }> = [];
        const cloudBySatellite = new Map<string, { satellite: string; cloudScore: number }>();
        for (const item of cloudWarnings) cloudBySatellite.set(item.satellite, item);
        let satIdx = 0;

        for (const key of validKeys) {
            throwIfClientDisconnected(res);
            const sat = SATELLITE_LAYERS[key];
            if (!sat) continue;
            const satImages = aiImages.filter((img) => img.caption.startsWith(sat.label));
            if (satImages.length === 0) { satIdx++; continue; }

            const progressPct = 65 + Math.round((satIdx / validKeys.length) * 20);
            sendSSE(res, { type: "progress", step: "analyzing", percent: progressPct, message: `IA analisando ${sat.label} (${satIdx + 1}/${validKeys.length})...` });

            try {
                const prompt = buildSingleSatellitePrompt(areaHa, layerSummaries!, key, cloudBySatellite.get(sat.label), acAvnAuasContext);
                const result = await analyzeWithGroqAndGemini(satImages, prompt, `${sat.label} (${sat.year})`);
                const split = splitThinkProgress(result);
                if (split.thinkingText) sendSSE(res, { type: "model_thinking", source: `${sat.label} (${sat.year})`, thinkingText: split.thinkingText });
                perSatelliteResults.push({ satelliteLabel: sat.label, year: sat.year, analysis: result });
                console.log(`[SIMCAR ANALYSIS] ${sat.label} analysis complete (${result.length} chars)`);
            } catch (err: any) {
                console.error(`[SIMCAR ANALYSIS] ${sat.label} analysis failed:`, err.message);
                sendSSE(res, { type: "progress", step: "analyzing", percent: progressPct, message: `Aviso: analise de ${sat.label} falhou, continuando com os demais...` });
            }
            satIdx++;
        }

        perSatelliteResults.sort((a, b) => (a.year - b.year) || a.satelliteLabel.localeCompare(b.satelliteLabel));

        if (perSatelliteResults.length === 0) {
            sendSSE(res, { type: "progress", step: "analyzing", percent: 85, message: "Tentando analise unificada como fallback..." });
            try {
                const prompt = buildAnalysisPrompt(areaHa, layerSummaries!, selectedLayers, { acAvnAuasContext });
                analysisText = await analyzeWithGroqAndGemini(aiImages, prompt, "Analise unificada multitemporal");
            } catch (err: any) {
                console.error("[SIMCAR ANALYSIS] Legacy fallback also failed:", err.message);
                sendSSE(res, { type: "error", message: `Erro na analise IA: ${err.message}` });
                return null;
            }
        } else if (perSatelliteResults.length === 1) {
            analysisText = perSatelliteResults[0].analysis;
        } else {
            sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA sintetizando analise temporal comparativa..." });
            try {
                const synthesisPrompt = buildSynthesisPrompt(areaHa, layerSummaries!, perSatelliteResults);
                analysisText = await callBestTextSynthesis([{ role: "user", content: synthesisPrompt }], "sintese temporal final");
                const split = splitThinkProgress(analysisText);
                if (split.thinkingText) sendSSE(res, { type: "model_thinking", source: "Sintese temporal", thinkingText: split.thinkingText });
                console.log(`[SIMCAR ANALYSIS] Synthesis complete (${analysisText.length} chars)`);
            } catch (err: any) {
                console.error("[SIMCAR ANALYSIS] Synthesis failed, concatenating analyses:", err.message);
                analysisText = perSatelliteResults.map((r) => [`## Analise: ${r.satelliteLabel} (${r.year})`, "", r.analysis].join("\n")).join("\n\n---\n\n");
            }
        }
    } else {
        const isUnifiedMulti = isMultiSatellite && SIMCAR_ANALYSIS_MODE !== "detailed";
        sendSSE(res, {
            type: "progress", step: "analyzing", percent: 65,
            message: isUnifiedMulti ? "IA analisando recorte multitemporal em chamada unica (modo eficiente)..." : "IA analisando imagens...",
        });
        try {
            throwIfClientDisconnected(res);
            const prompt = buildAnalysisPrompt(areaHa, layerSummaries!, selectedLayers, { acAvnAuasContext });
            const singleContext = validKeys.map((k) => `${SATELLITE_LAYERS[k]?.label || k} (${SATELLITE_LAYERS[k]?.year || "?"})`).join(" / ");
            analysisText = await analyzeWithGroqAndGemini(aiImages, prompt, singleContext || "Analise de um unico satelite");
            const split = splitThinkProgress(analysisText);
            if (split.thinkingText) sendSSE(res, { type: "model_thinking", source: singleContext || "Analise unica", thinkingText: split.thinkingText });
        } catch (err: any) {
            console.error("[SIMCAR ANALYSIS] AI analysis error:", err.message);
            sendSSE(res, { type: "error", message: `Erro na analise IA: ${err.message}` });
            return null;
        }
    }

    const normalizedAcAvn = normalizeAcAvnAnalysisOutput(analysisText!, {
        satellitesUsed: usedSatelliteKeys.map((k) => ({ key: k, label: SATELLITE_LAYERS[k]?.label || k, year: Number(SATELLITE_LAYERS[k]?.year || 0) })),
        satellitesMissing: missingSatelliteKeys.map((k) => ({ key: k, label: SATELLITE_LAYERS[k]?.label || k, year: Number(SATELLITE_LAYERS[k]?.year || 0) })),
        cloudWarnings,
        auasContext: acAvnAuasContext,
    });

    return {
        analysisText: normalizedAcAvn.text,
        cloudinaryUrls,
        usedSatelliteKeys,
        missingSatelliteKeys,
        cloudWarnings,
        analysisMeta: normalizedAcAvn.meta,
        layerSummaries: layerSummaries!,
        imageOnly: false,
    };
}

/** Main analysis pipeline (called from the SSE endpoint). */
async function processAnalysis(
    res: Response,
    jobId: string,
    selectedLayers: string[] = ["spot_2008"],
    aiAnalysis = true,
    contextUrl?: string,
    outputZipUrl?: string,
): Promise<boolean> {
    throwIfClientDisconnected(res);
    let job = jobCache.get(jobId);
    if ((!job || !job.bbox || !job.polygon || !job.layerSummaries) && contextUrl) {
        job = (await hydrateJobFromPersistedContext(jobId, contextUrl)) ?? undefined;
    }
    if ((!job || !job.bbox || !job.polygon || !job.layerSummaries) && outputZipUrl) {
        job = (await hydrateJobFromOutputZipUrl(jobId, outputZipUrl)) ?? undefined;
    }
    if (!job || !job.bbox || !job.polygon || !job.layerSummaries) {
        sendSSE(res, {
            type: "error",
            message:
                "Job nao encontrado no cache do servidor. Envie contextUrl salvo no Firebase/Cloudinary para reidratar ou gere o recorte novamente.",
        });
        return false;
    }

    const result = await runAcAvnSatelliteAnalysis(res, job, selectedLayers, { tag: jobId.slice(0, 8), aiAnalysis });
    if (!result) return false;

    sendSSE(res, {
        type: "complete",
        percent: 100,
        ...(!result.imageOnly && { analysis: result.analysisText, analysisMeta: result.analysisMeta }),
        images: result.cloudinaryUrls,
        layerSummaries: result.layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
        analysisRulesVersion: "acavn-fixed-v4",
        satellitesUsed: result.usedSatelliteKeys,
        satellitesMissing: result.missingSatelliteKeys,
        cloudWarnings: result.cloudWarnings.length > 0 ? result.cloudWarnings : undefined,
    });
    return true;
}

function buildEstimatedUsageForFallback(args: {
    endpoint: string;
    model?: string;
    provider: "groq" | "gemini";
    inputTokens: number;
    outputTokens: number;
}) {
    return {
        provider: args.provider,
        model: args.model || SIMCAR_OPERATION_BILLING_MODEL,
        endpoint: args.endpoint,
        inputTokens: Math.max(1, Math.round(args.inputTokens || 1)),
        outputTokens: Math.max(1, Math.round(args.outputTokens || 1)),
        estimated: true,
    };
}

/* ─── Express Route Registration ─────────────────────────────── */

async function attachOptionalAuth(req: Request, _res: Response, next: any) {
    try {
        const header = String(req.headers.authorization || "").trim();
        const match = header.match(/^Bearer\s+(.+)$/i);
        const token = match?.[1]?.trim();
        if (!token) {
            next();
            return;
        }
        const decoded = await adminAuth.verifyIdToken(token);
        req.authUid = decoded.uid;
    } catch (error) {
        if (isFirebaseConfigError(error)) {
            console.warn("[AUTH] Firebase não configurado para auth opcional (simcar-clip).");
        } else {
            console.warn("[AUTH] Token opcional inválido em /api/simcar/clip.");
        }
    }
    next();
}

export function registerSimcarClipRoutes(app: Express) {
    const sendSseHeaders = (res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
    };
    const simcarBillingModels = Array.from(
        new Set([
            ...ANALYSIS_VISION_MODELS,
            ...GEMINI_VISION_MODELS,
            ...GROQ_TEXT_MODELS,
            ...SIMCAR_SYNTHESIS_TEXT_MODELS,
            ...SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
        ]),
    );

    app.get("/api/simcar/gemini/config", async (req: Request, res: Response) => {
        const probe = String((req.query as any)?.probe || "").toLowerCase() === "1";
        const runtime = getSimcarGeminiRuntimeConfig();

        if (!probe) {
            res.json({
                ok: true,
                ...runtime,
                note: "Use ?probe=1 para testar chamada real em cada modelo Gemini configurado.",
            });
            return;
        }

        const modelsToProbe = Array.from(
            new Set([...runtime.geminiVisionModels, ...runtime.geminiTextSynthesisModels]),
        );
        const modelChecks: Array<{ model: string; ok: boolean; error?: string }> = [];
        for (const model of modelsToProbe) {
            const check = await probeGeminiModel(model);
            modelChecks.push({
                model,
                ok: check.ok,
                error: check.error,
            });
        }
        const okModels = modelChecks.filter((m) => m.ok).length;

        res.json({
            ok: okModels > 0,
            ...runtime,
            probe: true,
            checkedAt: new Date().toISOString(),
            totalModels: modelChecks.length,
            okModels,
            failedModels: modelChecks.length - okModels,
            models: modelChecks,
        });
    });

    // SSE endpoint for clip processing
    app.post("/api/simcar/clip", attachOptionalAuth, async (req: Request, res: Response) => {
        let billingUid = "";
        let operationRequestId = "";
        let operationReserved = 0;
        let storageRequestId = "";
        let storageReserved = 0;
        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
            const uid = String(req.authUid || "");
            const billingEnabled = Boolean(uid);
            billingUid = uid;
            if (!billingEnabled) {
                console.warn("[SIMCAR CLIP] Sem token válido; processando sem cobrança.");
            }
            const body = req.body as {
                propertyZip?: string;
                filename?: string;
                layerNames?: string[];
                airIdentificacao?: string;
            };

            if (!body.propertyZip) {
                sendSSE(res, { type: "error", message: "Campo propertyZip (base64) é obrigatório." });
                res.end();
                return;
            }

            let zipBuffer: Buffer;
            try {
                zipBuffer = Buffer.from(body.propertyZip, "base64");
            } catch {
                sendSSE(res, { type: "error", message: "Base64 do ZIP inválido." });
                res.end();
                return;
            }

            if (zipBuffer.length < 22) {
                sendSSE(res, { type: "error", message: "ZIP muito pequeno para ser válido." });
                res.end();
                return;
            }

            console.log(
                `[SIMCAR CLIP] Processing: ${body.filename || "unknown"}, ` +
                `size=${zipBuffer.length}, layers=${body.layerNames?.length || "all"}`,
            );

            if (billingEnabled) {
                operationRequestId = createRequestId("simcar_clip");
                operationReserved = await estimateReserveForModels({
                    models: [SIMCAR_OPERATION_BILLING_MODEL],
                    estimatedInputTokens: 2200,
                    estimatedOutputTokens: 700,
                    safetyMultiplier: 1.15,
                });
                await reserveCredits({
                    uid,
                    amountBrl: operationReserved,
                    requestId: operationRequestId,
                    endpoint: "/api/simcar/clip",
                });

                storageRequestId = createRequestId("simcar_clip_storage");
                const estimatedStorageBytes = Math.max(
                    zipBuffer.length * 3,
                    zipBuffer.length + 320_000,
                );
                storageReserved = await estimateCloudinaryStorageReserve({
                    bytesStored: estimatedStorageBytes,
                    safetyMultiplier: 1.2,
                });
                if (storageReserved > 0) {
                    await reserveCredits({
                        uid,
                        amountBrl: storageReserved,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip",
                    });
                }
            }

            const clipResult = await processClip(res, zipBuffer, body.layerNames || null, body.airIdentificacao || undefined);
            if (billingEnabled && clipResult.ok && operationReserved > 0) {
                const fallbackUsage = buildEstimatedUsageForFallback({
                    endpoint: "/api/simcar/clip",
                    provider: "groq",
                    model: SIMCAR_OPERATION_BILLING_MODEL,
                    inputTokens: 1800 + Math.max(0, (body.layerNames?.length || TEMPLATE_LAYERS.length) * 25),
                    outputTokens: 250,
                });
                const billing = await settleReservedCredits({
                    uid,
                    requestId: operationRequestId,
                    endpoint: "/api/simcar/clip",
                    reservedBrl: operationReserved,
                    usageInputs: [fallbackUsage],
                });
                operationReserved = 0;
                sendSSE(res, { type: "billing", billing });
            } else if (billingEnabled && operationReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: operationRequestId,
                    amountBrl: operationReserved,
                    endpoint: "/api/simcar/clip",
                    reason: "clip_failed_or_invalid",
                });
                operationReserved = 0;
            }

            if (billingEnabled && clipResult.ok && storageReserved > 0) {
                if (clipResult.cloudinaryStoredBytes > 0) {
                    const storageBilling = await settleCloudinaryStorageReserve({
                        uid,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip",
                        reservedBrl: storageReserved,
                        bytesStored: clipResult.cloudinaryStoredBytes,
                        assetKind: "simcar_zip_bundle",
                    });
                    storageReserved = 0;
                    sendSSE(res, { type: "billing", billing: storageBilling });
                } else {
                    await refundReserve({
                        uid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "cloudinary_storage_not_persisted",
                    });
                    storageReserved = 0;
                }
            } else if (billingEnabled && storageReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: storageRequestId,
                    amountBrl: storageReserved,
                    endpoint: "/api/simcar/clip",
                    reason: "clip_failed_or_invalid",
                });
                storageReserved = 0;
            }
        } catch (err: any) {
            if (billingUid && operationReserved > 0 && operationRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: operationRequestId,
                        amountBrl: operationReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR CLIP] refund error:", refundErr);
                }
            }
            if (billingUid && storageReserved > 0 && storageRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR CLIP] storage refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                sendSSE(res, { type: "error", message: err.message, code: err.code });
                return;
            }
            console.error("[SIMCAR CLIP] Unexpected error:", err);
            sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // Import endpoint for pre-vectorized ZIP (no WFS clipping)
    app.post("/api/simcar/clip/import-vectorized", async (req: Request, res: Response) => {
        let billingUid = "";
        let storageRequestId = "";
        let storageReserved = 0;
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const body = req.body as { propertyZip?: string; filename?: string };
            if (!body.propertyZip || typeof body.propertyZip !== "string") {
                res.status(400).json({ error: "Campo propertyZip (base64) é obrigatório." });
                return;
            }

            let zipBuffer: Buffer;
            try {
                zipBuffer = Buffer.from(body.propertyZip, "base64");
            } catch {
                res.status(400).json({ error: "Base64 do ZIP inválido." });
                return;
            }
            if (zipBuffer.length < 22) {
                res.status(400).json({ error: "ZIP muito pequeno para ser válido." });
                return;
            }

            const baseName = String(body.filename || `simcar_vectorizado_${Date.now()}.zip`).trim();
            const safeFilename = baseName.toLowerCase().endsWith(".zip") ? baseName : `${baseName}.zip`;
            const jobId = crypto.randomUUID();

            const parsed = parseCachedContextFromOutputZip(zipBuffer, safeFilename);
            if (!parsed || !parsed.bbox || !parsed.polygon || !parsed.layerSummaries) {
                res.status(400).json({
                    error:
                        "ZIP vetorizado inválido. É obrigatório conter camadas com geometria e ATP/AIR para reconstrução da propriedade.",
                });
                return;
            }

            storageRequestId = createRequestId("simcar_vectorized_storage");
            const estimatedStorageBytes = Math.max(zipBuffer.length + 220_000, Math.round(zipBuffer.length * 1.5));
            storageReserved = await estimateCloudinaryStorageReserve({
                bytesStored: estimatedStorageBytes,
                safetyMultiplier: 1.2,
            });
            if (storageReserved > 0) {
                await reserveCredits({
                    uid,
                    amountBrl: storageReserved,
                    requestId: storageRequestId,
                    endpoint: "/api/simcar/clip/import-vectorized",
                });
            }

            let outputZipUrl: string | undefined;
            let contextJsonUrl: string | undefined;
            let cloudinaryStoredBytes = 0;
            try {
                outputZipUrl = await uploadBufferToCloudinary(
                    zipBuffer,
                    `simcar_vectorized_${jobId.slice(0, 8)}`,
                );

                const persistedContext: PersistedClipContextV1 = {
                    version: 1,
                    jobId,
                    savedAtIso: new Date().toISOString(),
                    filename: safeFilename,
                    bbox: parsed.bbox,
                    polygon: parsed.polygon!,
                    layerSummaries: parsed.layerSummaries,
                    areaHa: Number(parsed.areaHa || 0),
                    clippedGeometries: mapToObjectGeometry(parsed.clippedGeometries || new Map<string, Geometry[]>()),
                    outputZipUrl,
                };
                const contextBuffer = Buffer.from(JSON.stringify(persistedContext), "utf8");
                contextJsonUrl = await uploadRawBufferToCloudinary(
                    contextBuffer,
                    `simcar_vectorized_context_${jobId.slice(0, 8)}.json`,
                    "application/json",
                );
                cloudinaryStoredBytes = zipBuffer.length + contextBuffer.length;
            } catch (uploadErr: any) {
                console.warn("[SIMCAR VECTOR IMPORT] Cloudinary persist failed:", uploadErr?.message || uploadErr);
            }

            pruneJobCache();
            jobCache.set(jobId, {
                ...parsed,
                buffer: zipBuffer,
                expiresAt: Date.now() + CACHE_TTL_MS,
                outputZipUrl,
                contextJsonUrl,
            });

            let billing: Awaited<ReturnType<typeof settleCloudinaryStorageReserve>> | null = null;
            if (storageReserved > 0) {
                if (cloudinaryStoredBytes > 0) {
                    billing = await settleCloudinaryStorageReserve({
                        uid,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reservedBrl: storageReserved,
                        bytesStored: cloudinaryStoredBytes,
                        assetKind: "simcar_vectorized_zip",
                    });
                } else {
                    await refundReserve({
                        uid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reason: "cloudinary_storage_not_persisted",
                    });
                }
                storageReserved = 0;
            }

            const layerSummaries = parsed.layerSummaries || [];
            const totalFeaturesClipped = layerSummaries.reduce((sum, layer) => sum + Number(layer.features || 0), 0);
            const layersWithData = layerSummaries.filter((layer) => Number(layer.features || 0) > 0).length;

            res.json({
                jobId,
                downloadUrl: `/api/simcar/clip/download/${jobId}`,
                outputZipUrl,
                contextUrl: contextJsonUrl,
                summary: {
                    propertyAreaHa: Number(parsed.areaHa || 0),
                    crs: "EPSG:4674",
                    layersProcessed: layerSummaries.length,
                    layersWithData,
                    totalFeaturesClipped,
                    layers: layerSummaries,
                    processingTimeMs: 0,
                },
                billing: billing || undefined,
            });
        } catch (err: any) {
            if (billingUid && storageReserved > 0 && storageRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR VECTOR IMPORT] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                res.status(err.statusCode).json({ error: err.message, code: err.code });
                return;
            }
            console.error("[SIMCAR VECTOR IMPORT] Error:", err);
            res.status(500).json({ error: err?.message || "Erro interno ao importar ZIP vetorizado." });
        }
    });

    // Download endpoint
    app.get("/api/simcar/clip/download/:jobId", (req: Request, res: Response) => {
        const { jobId } = req.params;
        const cached = jobCache.get(jobId);

        if (!cached || cached.expiresAt <= Date.now()) {
            if (cached) jobCache.delete(jobId);
            res.status(404).json({
                error: "Download expirado ou não encontrado. Processe novamente.",
            });
            return;
        }
        if (!cached.buffer) {
            if (cached.outputZipUrl) {
                res.redirect(cached.outputZipUrl);
                return;
            }
            res.status(404).json({ error: "Arquivo do recorte não disponível no cache." });
            return;
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${cached.filename}"`);
        res.setHeader("Content-Length", cached.buffer.length.toString());
        res.send(cached.buffer);
    });

    // AUAS analysis endpoint (SSE stream)
    app.post("/api/simcar/clip/analyze-auas", async (req: Request, res: Response) => {
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        let usageInputs: Array<any> = [];
        let clientDisconnected = false;
        req.on("close", () => {
            clientDisconnected = true;
        });
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { jobId, previousAnalysis, acAvnMeta, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                previousAnalysis?: string;
                acAvnMeta?: any;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }

            billingRequestId = createRequestId("simcar_auas");
            // AUAS analysis: uses up to ~16 satellite images (8 satellites × 2 views each),
            // plus per-satellite prompts (~4k tokens each) and synthesis call (~8k output tokens)
            const auasSatCount = AUAS_SATELLITE_KEYS.length;
            const auasImagesPerSat = 2; // outline + context views
            billingReserved = await estimateReserveForModels({
                models: simcarBillingModels,
                estimatedInputTokens: 4_500 * auasSatCount,
                estimatedOutputTokens: 800 * auasSatCount + 8_000, // per-sat (~800) + synthesis (~8000)
                safetyMultiplier: 1.3,
                imageCount: auasSatCount * auasImagesPerSat,
                imageWidthPx: 1024,
                imageHeightPx: 768,
            });
            await reserveCredits({
                uid,
                amountBrl: billingReserved,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze-auas",
            });

            sendSseHeaders(res);
            console.log(`[AUAS ANALYSIS] Starting AUAS analysis for job: ${jobId}`);
            let completed = false;
            await runWithBillingUsageSession(async () => {
                try {
                    completed = await processAuasAnalysis(res, jobId, previousAnalysis, contextUrl, outputZipUrl, acAvnMeta);
                } finally {
                    usageInputs = getBillingUsageSessionRecords();
                }
            });
            if (clientDisconnected || isSseConnectionClosed(res)) {
                throw new ClientAbortError();
            }
            if (usageInputs.length > 0 || completed) {
                const usageForSettle = usageInputs.length > 0
                    ? usageInputs
                    : [
                        buildEstimatedUsageForFallback({
                            endpoint: "/api/simcar/clip/analyze-auas",
                            provider: "gemini",
                            model: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || "gemini-2.5-pro",
                            inputTokens: 120_000,
                            outputTokens: 5200,
                        }),
                    ];
                const billing = await settleReservedCredits({
                    uid,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reservedBrl: billingReserved,
                    usageInputs: usageForSettle,
                });
                billingReserved = 0;
                sendSSE(res, { type: "billing", billing });
            } else if (billingReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: billingRequestId,
                    amountBrl: billingReserved,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reason: "no_ai_usage",
                });
                billingReserved = 0;
            }
        } catch (err: any) {
            if (err instanceof ClientAbortError) {
                if (billingUid && billingReserved > 0 && billingRequestId) {
                    try {
                        if (usageInputs.length > 0) {
                            await settleReservedCredits({
                                uid: billingUid,
                                requestId: billingRequestId,
                                endpoint: "/api/simcar/clip/analyze-auas",
                                reservedBrl: billingReserved,
                                usageInputs,
                            });
                            billingReserved = 0;
                        } else {
                            await refundReserve({
                                uid: billingUid,
                                requestId: billingRequestId,
                                amountBrl: billingReserved,
                                endpoint: "/api/simcar/clip/analyze-auas",
                                reason: "client_abort_without_usage",
                            });
                            billingReserved = 0;
                        }
                    } catch (billingErr) {
                        console.error("[AUAS ANALYSIS] client-abort billing error:", billingErr);
                    }
                }
                return;
            }
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[AUAS ANALYSIS] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                }
                return;
            }
            console.error("[AUAS ANALYSIS] Unexpected error:", err);
            if (res.headersSent) {
                sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
            } else {
                res.status(500).json({ error: err.message || "Erro interno inesperado." });
            }
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // AI analysis endpoint (SSE stream)
    app.post("/api/simcar/clip/analyze", async (req: Request, res: Response) => {
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        let usageInputs: Array<any> = [];
        let clientDisconnected = false;
        req.on("close", () => {
            clientDisconnected = true;
        });
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { jobId, selectedLayers, imageOnly, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                selectedLayers?: string[];
                imageOnly?: boolean;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }

            const requestedLayers = Array.isArray(selectedLayers) ? selectedLayers : [];
            const layers = getFixedAcAvnSatelliteKeys();
            if (requestedLayers.length > 0) {
                console.log(
                    `[SIMCAR ANALYSIS] Ignoring user-selected layers (${requestedLayers.join(", ")}). Using fixed AC/AVN set (${layers.join(", ")}).`,
                );
            }
            const aiAnalysis = !imageOnly;

            if (aiAnalysis) {
                const satelliteFactor = Math.max(1, layers.length + 1);
                // More accurate reserve: account for 3 images/satellite at Gemini resolution (1024x768)
                // plus prompt text tokens and output tokens
                const imagesPerSat = 3;
                const totalImages = layers.length * imagesPerSat;
                const promptTextTokens = 4_500; // buildAnalysisPrompt generates ~4.5k tokens
                const outputTokensPerCall = 6_000;
                billingRequestId = createRequestId("simcar_analyze");
                billingReserved = await estimateReserveForModels({
                    models: simcarBillingModels,
                    estimatedInputTokens: promptTextTokens * satelliteFactor,
                    estimatedOutputTokens: outputTokensPerCall * satelliteFactor,
                    safetyMultiplier: 1.3,
                    imageCount: totalImages,
                    imageWidthPx: 1024,
                    imageHeightPx: 768,
                });
                await reserveCredits({
                    uid,
                    amountBrl: billingReserved,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze",
                });
            }

            sendSseHeaders(res);
            console.log(`[SIMCAR ANALYSIS] Starting analysis for job: ${jobId}, layers: ${layers.join(",")}, aiAnalysis: ${aiAnalysis}`);

            if (aiAnalysis) {
                let completed = false;
                await runWithBillingUsageSession(async () => {
                    try {
                        completed = await processAnalysis(res, jobId, layers, true, contextUrl, outputZipUrl);
                    } finally {
                        usageInputs = getBillingUsageSessionRecords();
                    }
                });
                if (clientDisconnected || isSseConnectionClosed(res)) {
                    throw new ClientAbortError();
                }
                if (usageInputs.length > 0 || completed) {
                    const usageForSettle = usageInputs.length > 0
                        ? usageInputs
                        : [
                            buildEstimatedUsageForFallback({
                                endpoint: "/api/simcar/clip/analyze",
                                provider: "gemini",
                                model: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || "gemini-2.5-pro",
                                inputTokens: 90_000 + Math.max(1, layers.length) * 26_000,
                                outputTokens: 4200,
                            }),
                        ];
                    const billing = await settleReservedCredits({
                        uid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze",
                        reservedBrl: billingReserved,
                        usageInputs: usageForSettle,
                    });
                    billingReserved = 0;
                    sendSSE(res, { type: "billing", billing });
                } else if (billingReserved > 0) {
                    await refundReserve({
                        uid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze",
                        reason: "no_ai_usage",
                    });
                    billingReserved = 0;
                }
            } else {
                await processAnalysis(res, jobId, layers, false, contextUrl, outputZipUrl);
            }
        } catch (err: any) {
            if (err instanceof ClientAbortError) {
                if (billingUid && billingReserved > 0 && billingRequestId) {
                    try {
                        if (usageInputs.length > 0) {
                            await settleReservedCredits({
                                uid: billingUid,
                                requestId: billingRequestId,
                                endpoint: "/api/simcar/clip/analyze",
                                reservedBrl: billingReserved,
                                usageInputs,
                            });
                            billingReserved = 0;
                        } else {
                            await refundReserve({
                                uid: billingUid,
                                requestId: billingRequestId,
                                amountBrl: billingReserved,
                                endpoint: "/api/simcar/clip/analyze",
                                reason: "client_abort_without_usage",
                            });
                            billingReserved = 0;
                        }
                    } catch (billingErr) {
                        console.error("[SIMCAR ANALYSIS] client-abort billing error:", billingErr);
                    }
                }
                return;
            }
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR ANALYSIS] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                }
                return;
            }
            console.error("[SIMCAR ANALYSIS] Unexpected error:", err);
            if (res.headersSent) {
                sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
            } else {
                res.status(500).json({ error: err.message || "Erro interno inesperado." });
            }
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // AI follow-up chat endpoint
    app.post("/api/simcar/clip/analyze/chat", async (req: Request, res: Response) => {
        const streamMode = String((req.query as any)?.stream || "").toLowerCase() === "1";
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { messages } = req.body as {
                messages?: Array<{ role: string; content: any }>;
            };

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                if (streamMode) {
                    sendSseHeaders(res);
                    sendSSE(res, { type: "error", message: "Mensagens inválidas." });
                    if (!res.writableEnded) res.end();
                    return;
                }
                res.status(400).json({ error: "Mensagens inválidas." });
                return;
            }

            const incomingChars = messages.reduce(
                (acc, msg) => acc + normalizeAssistantContent((msg as any)?.content).length,
                0,
            );
            const compactedMessages = compactChatMessages(messages);
            const compactedChars = compactedMessages.reduce((acc, msg) => acc + msg.content.length, 0);
            if (compactedMessages.length === 0) {
                if (streamMode) {
                    sendSseHeaders(res);
                    sendSSE(res, { type: "error", message: "Sem contexto textual válido para análise." });
                    if (!res.writableEnded) res.end();
                    return;
                }
                res.status(400).json({ error: "Sem contexto textual válido para análise." });
                return;
            }
            if (compactedMessages.length !== messages.length || compactedChars !== incomingChars) {
                console.log(
                    `[SIMCAR ANALYSIS CHAT] Context compacted: msgs ${messages.length} -> ${compactedMessages.length}, ` +
                    `chars ${incomingChars} -> ${compactedChars}`,
                );
            }
            const optimizedMessages = [
                {
                    role: "system",
                    content:
                        "Responda de forma objetiva e técnica. " +
                        "Nao inclua bloco <think>, cadeia de raciocinio interna ou repeticoes longas.",
                },
                ...compactedMessages,
            ];

            billingRequestId = createRequestId(streamMode ? "simcar_chat_stream" : "simcar_chat");
            billingReserved = await estimateReserveForModels({
                models: Array.from(new Set([...GROQ_TEXT_MODELS, ...SIMCAR_SYNTHESIS_TEXT_MODELS])),
                estimatedInputTokens: estimateTokensFromMessages(optimizedMessages),
                estimatedOutputTokens: 6600,
                safetyMultiplier: 1.2,
            });
            await reserveCredits({
                uid,
                amountBrl: billingReserved,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze/chat",
            });

            if (streamMode) {
                sendSseHeaders(res);
                await runWithBillingUsageSession(async () => {
                    await streamTextFollowUp(res, optimizedMessages);
                });
                const usageInputs = getBillingUsageSessionRecords();
                const usageForSettle = usageInputs.length > 0
                    ? usageInputs
                    : [
                        buildEstimatedUsageForFallback({
                            endpoint: "/api/simcar/clip/analyze/chat",
                            provider: "groq",
                            model: GROQ_TEXT_MODELS[0] || "openai/gpt-oss-120b",
                            inputTokens: Math.max(1, estimateTokensFromMessages(optimizedMessages)),
                            outputTokens: 1800,
                        }),
                    ];
                const billing = await settleReservedCredits({
                    uid,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze/chat",
                    reservedBrl: billingReserved,
                    usageInputs: usageForSettle,
                });
                billingReserved = 0;
                sendSSE(res, { type: "billing", billing });
                if (!res.writableEnded) res.end();
                return;
            }

            const reply = await runWithBillingUsageSession(async () =>
                callTextFollowUpGroqFirst(optimizedMessages, "chat"),
            );
            const usageInputs = getBillingUsageSessionRecords();
            const usageForSettle = usageInputs.length > 0
                ? usageInputs
                : [
                    {
                        provider: "groq" as const,
                        model: GROQ_TEXT_MODELS[0] || "openai/gpt-oss-120b",
                        inputTokens: Math.max(1, estimateTokensFromMessages(optimizedMessages)),
                        outputTokens: Math.max(1, estimateTokensFromText(reply)),
                        estimated: true,
                    },
                ];
            const billing = await settleReservedCredits({
                uid,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze/chat",
                reservedBrl: billingReserved,
                usageInputs: usageForSettle,
            });
            billingReserved = 0;
            res.json({ content: reply, billing });
        } catch (err: any) {
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze/chat",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR ANALYSIS CHAT] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                    if (!res.writableEnded) res.end();
                }
                return;
            }
            console.error("[SIMCAR ANALYSIS CHAT] Error:", err);
            if (streamMode) {
                if (res.headersSent) {
                    sendSSE(res, { type: "error", message: err.message || "Erro interno." });
                    if (!res.writableEnded) res.end();
                } else {
                    res.status(500).json({ error: err.message || "Erro interno." });
                }
                return;
            }
            res.status(500).json({ error: err.message || "Erro interno." });
        }
    });

    // Layer list endpoint (for frontend checkbox list)
    app.get("/api/simcar/layers", (_req: Request, res: Response) => {
        res.json({
            layers: TEMPLATE_LAYERS.map((name) => ({
                name,
                category: DIRECT_COPY_LAYERS.has(name) ? "property" : "wfs",
            })),
        });
    });

    // Delete clip endpoint: removes Cloudinary resources + cache
    app.delete("/api/simcar/clip/:jobId", async (req: Request, res: Response) => {
        const { jobId } = req.params;
        const { imageUrls, auasImageUrls, inputZipUrl, outputZipUrl, contextUrl } = req.body as {
            imageUrls?: string[];
            auasImageUrls?: string[];
            inputZipUrl?: string;
            outputZipUrl?: string;
            contextUrl?: string;
        };

        try {
            const cached = jobCache.get(jobId);
            const deletions: Promise<void>[] = [];
            const seen = new Set<string>();

            const queueDelete = (url: string | undefined, forcedType?: "raw" | "image") => {
                const clean = String(url || "").trim();
                if (!clean) return;
                const inferredType: "raw" | "image" =
                    forcedType
                    || (/\/raw\/upload\//i.test(clean) || /\.(zip|json)(\?|$)/i.test(clean) ? "raw" : "image");
                const key = `${inferredType}:${clean}`;
                if (seen.has(key)) return;
                seen.add(key);
                deletions.push(deleteFromCloudinary(clean, inferredType));
            };

            // Delete ZIPs from Cloudinary (raw type)
            queueDelete(cached?.inputZipUrl || inputZipUrl, "raw");
            queueDelete(cached?.outputZipUrl || outputZipUrl, "raw");
            queueDelete(cached?.contextJsonUrl || contextUrl, "raw");

            // Delete analysis images from Cloudinary (image type)
            if (Array.isArray(imageUrls)) {
                for (const url of imageUrls) {
                    queueDelete(url, "image");
                }
            }
            if (Array.isArray(auasImageUrls)) {
                for (const url of auasImageUrls) {
                    queueDelete(url, "image");
                }
            }

            await Promise.allSettled(deletions);
            jobCache.delete(jobId);

            console.log(`[SIMCAR CLIP] Deleted job ${jobId} + ${deletions.length} Cloudinary resources`);
            res.json({ ok: true, deleted: deletions.length });
        } catch (err: any) {
            console.error("[SIMCAR CLIP DELETE] Error:", err);
            res.status(500).json({ error: err.message });
        }
    });
}





