/**
 * SIMCAR Analysis — pipeline de análise IA (AC/AVN, AUAS) sobre recortes SIMCAR:
 * configuração, WMS, Groq/visão, prompts, veredictos, síntese e persistência.
 *
 * Extraído de simcar-clip.ts (Plano 02, Fase 6a).
 */
import path from "path";
import fs from "fs";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import proj4 from "proj4";
import sharp from "sharp";
import {
  area as turfArea,
  bbox as turfBbox,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
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
import { AC_AUAS_PROMPT_GLOSSARY, FALSE_COLOR_PROMPT_NOTE, MIXED_SOURCE_PROMPT_NOTE, POUSIO_PROMPT_RULE } from "../analise-pos-recorte/groq-vision-core";
import { detectUtmProj, reprojectBbox } from "../geo-utils";
import { toPolygonOrMultiFeature } from "../wfs-intersection";
import { parseDbfSchema } from "../shapefile-writer";
import {
  BillingError,
  applyCancelFloorDebit,
  buildUsageFromGroq,
  createRequestId,
  estimateReserveForModels,
  estimateTokensFromMessages,
  estimateTokensFromText,
  recordModelUsage,
  refundReserve,
  reserveCredits,
  runWithBillingUsageSession,
  settleReservedCredits,
} from "../billing";
import { adminAuth, isFirebaseConfigError } from "../firebase-admin";
import {
  finishJob,
  markDisconnected,
  startJob,
} from "../processing-jobs";
import {
    getAuasV2Config,
    runAuasPre2008Analysis,
    AuasCancelledError,
    AuasTooManyPolygonsError,
    type AuasPre2008AnalysisV2,
    type AuasV2Progress,
} from "../analise-pos-recorte";
import { createFileCheckpointStore } from "../analise-pos-recorte/checkpoint-store";
import {
  ClientAbortError,
  sendSSE,
  sleepMs,
  startSseHeartbeat,
  throwIfClientDisconnected,
  clipFeaturesToPolygon,
} from "./clip-pipeline";
import type { LayerSummary } from "./clip-pipeline";
import {
  hydrateCachedJob,
  persistSimcarClipArtifacts,
} from "./hydration";
import { generateAndPersistSimcarReport } from "./report";
import type { SimcarReportArtifact } from "./report";
import { simplifyGeometryForOverlay } from "./polygon-ops";
import {
  extractZipEntriesByExtension,
  getDbfRecordCount,
  readDbfRecord,
  bboxIntersects,
  ringsToFeature,
} from "./shapefile-io";
import {
  compressForVision,
  uploadToCloudinary,
  getCloudinaryAiUrl,
  buildVisionContentParts,
  reduceImageSet,
  estimateBytesFromDataUrl,
  isTruncationFinishReason,
} from "./cloudinary";
import type { AiImage } from "./types";
import {
    acervoCandidates,
    describeSceneProvenance,
    isMostlyEmptyRender,
    SEMA_SOURCE,
    type WmsCandidate,
    type WmsSource,
} from "./acervo-local";
import {
    calculateDynamicResolution as calculateSensorDynamicResolution,
    expandBboxForContext,
    sensorGroundResolutionM,
} from "../analise-pos-recorte/wms-scenes";
import type { WfsClipFetchResult } from "./wfs-client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Constants ──────────────────────────────────────────────── */

const SIMCAR_LOCAL_SHAPES_ROOT =
    process.env.SIMCAR_LOCAL_SHAPES_ROOT ||
    "/media/server/HD Backup/VETOR/CAR_Digital/current/datasets/simcar_digital";
const SEMA_CAR_REQUIRED_WFS_LAYER =
    process.env.SEMA_CAR_REQUIRED_WFS_LAYER || "Geoportal:MVW_REQUERIMENTO_ATP";
const WFS_MAX_FEATURES = 50000;
const CACHE_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const CACHE_MAX_JOBS = 10;
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SIMCAR_OPERATION_BILLING_MODEL = "openai/gpt-oss-20b";

/* ——— Dynamic Image Resolution ———————————————————————— */

/**
 * Calculate optimal image dimensions based on property area.
 * Larger properties need more pixels to capture detail;
 * smaller properties can use lower resolution to save bandwidth/tokens.
 *
 * Returns { width, height } with a minimum short side of 480 px and
 * a maximum canvas of 2400×1800, preserving aspect ratio.
 */
function calculateDynamicResolution(
    areaHa: number,
    bbox: [number, number, number, number],
): { width: number; height: number } {
    // Compute aspect ratio from bbox
    const bboxWidth = Math.abs(bbox[2] - bbox[0]);
    const bboxHeight = Math.abs(bbox[3] - bbox[1]);
    const aspect = bboxWidth > 0 && bboxHeight > 0 ? bboxWidth / bboxHeight : 4 / 3;
    const MIN_SHORT_SIDE_PX = 480;

    // Use the longest side as the area-driven dimension and preserve aspect ratio.
    let baseLongSide: number;
    if (areaHa <= 50) {
        baseLongSide = 800;
    } else if (areaHa <= 200) {
        baseLongSide = 900;
    } else if (areaHa <= 500) {
        baseLongSide = 1200;
    } else if (areaHa <= 2000) {
        baseLongSide = 1600;
    } else if (areaHa <= 5000) {
        baseLongSide = 2000;
    } else {
        baseLongSide = 2400;
    }

    let width: number;
    let height: number;
    if (aspect >= 1) {
        width = baseLongSide;
        height = Math.max(1, Math.round(width / aspect));
    } else {
        height = baseLongSide;
        width = Math.max(1, Math.round(height * aspect));
    }

    const shortSide = Math.min(width, height);
    if (shortSide < MIN_SHORT_SIDE_PX) {
        const upscale = MIN_SHORT_SIDE_PX / Math.max(shortSide, 1);
        width = Math.max(1, Math.round(width * upscale));
        height = Math.max(1, Math.round(height * upscale));
    }

    const scaleDown = Math.min(2400 / Math.max(width, 1), 1800 / Math.max(height, 1), 1);
    width = Math.max(1, Math.round(width * scaleDown));
    height = Math.max(1, Math.round(height * scaleDown));

    return { width, height };
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
    landsat7: {
        sensor: "Landsat 7 ETM+",
        spatialResolution: "30m (multiespectral) / 15m (pancromático)",
        spectralBands: "Azul, Verde, Vermelho, NIR, SWIR-1, Térmico, SWIR-2, Pan",
        revisitDays: 16,
        bestUseCase: "Único mosaico estadual de 2002 — fecha o vão entre 2000 e 2003 na série pré-marco",
    },
    resourcesat: {
        sensor: "ResourceSat-2 LISS-3",
        spatialResolution: "23,5m (multiespectral)",
        spectralBands: "Verde, Vermelho, NIR, SWIR",
        revisitDays: 24,
        bestUseCase: "Único mosaico estadual de 2012 — evita salto de 2011 para 2013 na datação",
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
    if (key.startsWith("landsat7")) return "landsat7";
    if (key.startsWith("landsat5")) return "landsat5";
    if (key.startsWith("resourcesat")) return "resourcesat";
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

/**
 * Douglas-Peucker line simplification algorithm.
 */

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

/** River layers are fetched and clipped with a small margin beyond the property boundary. */
const RIVER_CLIP_LAYERS = new Set([
    "RIO_ATE_10",
    "RIO_10_A_50",
    "RIO_50_A_200",
    "RIO_200_A_600",
    "RIO_ACIMA_600",
]);
const SPRING_LAYER_NAME = "NASCENTE";
/**
 * Camadas selecionadas pelo MESMO buffer dos rios (500m), porém mantidas
 * INTEIRAS — sem recorte. Se a feição toca o buffer da ATP, ela entra completa,
 * mesmo que ultrapasse o limite da ATP. Usado para reservatórios artificiais e
 * lagoas naturais.
 */
const WHOLE_FEATURE_BUFFER_LAYERS = new Set(["RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL"]);
const RIVER_CLIP_EXTENSION_METERS = Number(process.env.SIMCAR_RIVER_CLIP_EXTENSION_METERS || 500);

type LocalSimcarLayerSource = {
    zipPath: string;
    storeName: string;
};

let localSimcarLayerIndex:
    | { root: string; mtimeMs: number; byStoreName: Map<string, LocalSimcarLayerSource> }
    | null = null;

function normalizeLocalLayerKey(value: string): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^geoportal:/, "")
        .replace(/^semamt:/, "")
        .replace(/^car_digital_/, "")
        .replace(/^simcar_d_/, "")
        .replace(/^simcar_d_/, "")
        .replace(/^simcar_/, "")
        .replace(/^car_/, "");
}

function getLocalLayerCandidateNames(templateLayer: string): string[] {
    const lower = templateLayer.toLowerCase();
    const aliases: Record<string, string[]> = {
        vereda: ["veredas", "vereda"],
        arlrem: ["arlrem", "arld"],
        area_uso_restrito: ["area_uso_restrito", "areas_uso_restrito"],
        area_altitude_1800: ["area_altitude_1800", "altitude_1800"],
        rio_acima_600: ["rio_acima_600", "rio_maior_600"],
    };
    return Array.from(new Set([lower, ...(aliases[lower] || [])]));
}

function buildLocalSimcarLayerIndex(root = SIMCAR_LOCAL_SHAPES_ROOT): Map<string, LocalSimcarLayerSource> {
    const stat = fs.statSync(root);
    if (
        localSimcarLayerIndex &&
        localSimcarLayerIndex.root === root &&
        localSimcarLayerIndex.mtimeMs === stat.mtimeMs
    ) {
        return localSimcarLayerIndex.byStoreName;
    }

    const byStoreName = new Map<string, LocalSimcarLayerSource>();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const zipPath = path.join(dir, `${entry.name}.zip`);
        if (!fs.existsSync(zipPath)) continue;
        byStoreName.set(entry.name.toLowerCase(), {
            zipPath,
            storeName: entry.name,
        });
    }

    localSimcarLayerIndex = {
        root,
        mtimeMs: stat.mtimeMs,
        byStoreName,
    };
    return byStoreName;
}

function resolveLocalSimcarLayer(templateLayer: string): LocalSimcarLayerSource | null {
    const byStoreName = buildLocalSimcarLayerIndex();
    const candidates = getLocalLayerCandidateNames(templateLayer);
    for (const name of candidates) {
        const directStore = `car_digital_simcar_d_simcar_d_${name}`;
        const direct = byStoreName.get(directStore);
        if (direct) return direct;
    }

    for (const [storeName, source] of byStoreName) {
        const normalized = normalizeLocalLayerKey(storeName);
        if (candidates.some((candidate) => normalized === candidate || normalized.endsWith(`_${candidate}`))) {
            return source;
        }
    }
    return null;
}

/* ─── Job Cache ──────────────────────────────────────────────── */

export type CachedJob = {
    uid?: string;
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
    warnings?: string[];
    propertySourceLayer?: "ATP" | "AIR";
};
/* ─── Shapefile Parsing ──────────────────────────────────────── */

/**
 * Read ALL polygon records from a .shp buffer.
 * Returns an array of polygon rings (one per record, outer + holes).
 */

function readLocalSimcarClipFeatures(
    source: LocalSimcarLayerSource,
    userPolygon: Feature<Polygon | MultiPolygon>,
    userBbox: [number, number, number, number],
): WfsClipFetchResult {
    const zipBuffer = fs.readFileSync(source.zipPath);
    const entries = extractZipEntriesByExtension(zipBuffer, [".shp", ".dbf", ".prj"]);
    const shpEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".shp"));
    const dbfEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".dbf"));
    const prjEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".prj"));
    if (!shpEntry || !dbfEntry) {
        return {
            features: [],
            warnings: [`Base local ${source.storeName} sem .shp/.dbf valido.`],
            partial: false,
        };
    }

    const dbfFields = parseDbfSchema(dbfEntry.data);
    const dbfRecordCount = getDbfRecordCount(dbfEntry.data);
    const prjText = prjEntry?.data.toString("utf8") || "";
    const projDef = prjText ? detectUtmProj(prjText) : null;
    const compareBbox = projDef ? reprojectBbox(userBbox, projDef) : userBbox;
    const clipped: WfsFeature[] = [];
    const shpBuffer = shpEntry.data;
    const warnings: string[] = [];

    if (shpBuffer.length < 100) {
        return {
            features: [],
            warnings: [`Base local ${source.storeName} com .shp invalido.`],
            partial: false,
        };
    }

    let offset = 100;
    let recordIndex = 0;
    while (offset + 12 <= shpBuffer.length) {
        const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
        const contentLengthBytes = contentLengthWords * 2;
        const recStart = offset + 8;
        const recEnd = recStart + contentLengthBytes;
        if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

        const shapeType = shpBuffer.readInt32LE(recStart);
        if ((shapeType === 5 || shapeType === 15 || shapeType === 25) && contentLengthBytes >= 44) {
            const recordBbox: [number, number, number, number] = [
                shpBuffer.readDoubleLE(recStart + 4),
                shpBuffer.readDoubleLE(recStart + 12),
                shpBuffer.readDoubleLE(recStart + 20),
                shpBuffer.readDoubleLE(recStart + 28),
            ];
            if (bboxIntersects(recordBbox, compareBbox)) {
                const numParts = shpBuffer.readInt32LE(recStart + 36);
                const numPoints = shpBuffer.readInt32LE(recStart + 40);
                if (numParts > 0 && numPoints > 2) {
                    const partsOffset = recStart + 44;
                    const pointsOffset = partsOffset + numParts * 4;
                    if (pointsOffset + numPoints * 16 <= recEnd) {
                        const partIndices: number[] = [];
                        for (let p = 0; p < numParts; p += 1) {
                            partIndices.push(shpBuffer.readInt32LE(partsOffset + p * 4));
                        }
                        partIndices.push(numPoints);

                        const rings: number[][][] = [];
                        for (let p = 0; p < numParts; p += 1) {
                            const ring: number[][] = [];
                            for (let i = partIndices[p]; i < partIndices[p + 1]; i += 1) {
                                const pOff = pointsOffset + i * 16;
                                const x = shpBuffer.readDoubleLE(pOff);
                                const y = shpBuffer.readDoubleLE(pOff + 8);
                                if (Number.isFinite(x) && Number.isFinite(y)) {
                                    if (projDef) {
                                        const [lon, lat] = proj4(projDef, "EPSG:4326", [x, y]) as [number, number];
                                        if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push([lon, lat]);
                                    } else {
                                        ring.push([x, y]);
                                    }
                                }
                            }
                            if (ring.length >= 3) rings.push(ring);
                        }

                        const localFeature = ringsToFeature(rings);
                        if (localFeature) {
                            const intersections = clipFeaturesToPolygon(
                                [
                                    {
                                        geometry: localFeature.geometry,
                                        properties:
                                            recordIndex < dbfRecordCount
                                                ? readDbfRecord(dbfEntry.data, dbfFields, recordIndex)
                                                : {},
                                    },
                                ],
                                userPolygon,
                            );
                            for (const intersection of intersections) {
                                if (intersection.kind === "polygon") {
                                    clipped.push({
                                        geometry: intersection.geometry,
                                        properties: intersection.properties,
                                    });
                                } else if (intersection.kind === "point") {
                                    // Points from local layers: convert to polygons via tiny buffer for pipeline compatibility
                                    for (const coord of intersection.pointCoords) {
                                        const ptFeature = {
                                            type: "Feature" as const,
                                            properties: {} as Record<string, unknown>,
                                            geometry: { type: "Point" as const, coordinates: coord },
                                        };
                                        try {
                                            const buffered = turfBuffer(ptFeature as any, 0.5, { units: "meters" });
                                            if (buffered?.geometry) {
                                                clipped.push({
                                                    geometry: buffered.geometry,
                                                    properties: intersection.properties,
                                                });
                                            }
                                        } catch {
                                            // Skip
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        recordIndex += 1;
        offset = recEnd;
    }

    if (!clipped.length) {
        warnings.push(`Base local ${source.storeName} consultada sem intersecoes.`);
    }

    return {
        features: clipped,
        warnings,
        partial: false,
    };
}

/**
 * Parse user's shapefile ZIP → single unified polygon in EPSG:4674.
 */

/* ─── Layer Name Mapping (Template → WFS) ────────────────────── */

/* ─── WFS Feature Fetching with Attributes ───────────────────── */

type WfsFeature = {
    geometry: Geometry | null;
    properties: Record<string, unknown>;
};

/* ─── Feature Clipping ───────────────────────────────────────── */

/**
 * Checks if a Point feature is inside the given polygon.
 * Boundary points count as inside for clipping purposes.
 */

/**
 * Extract point coordinates from Point/MultiPoint geometry.
 * Returns null if geometry is not a point type.
 */

type ClippedPolygonResult = {
    kind: "polygon";
    geometry: Geometry;
    properties: Record<string, unknown>;
};

type ClippedPointResult = {
    kind: "point";
    pointCoords: Array<[number, number]>;
    properties: Record<string, unknown>;
};

type ClipResult = ClippedPolygonResult | ClippedPointResult;

import {
    CLIP_SNAP_TOLERANCE_METERS,
    snapClippedGeometryToBoundary,
} from "../simcar-clip-snap";
export { CLIP_SNAP_TOLERANCE_METERS, snapClippedGeometryToBoundary };

/* ─── AI Analysis Pipeline ───────────────────────────────────── */

const SPOT_LAYER = "Mosaicos:MOSAICO_SPOT_SEPLAN";
const WMS_FETCH_RETRY_ATTEMPTS = Math.max(1, Number(process.env.WMS_FETCH_RETRY_ATTEMPTS || 2));
const WMS_RETRY_BASE_DELAY_MS = 1200;

/** Helper to generate Landsat 5/8 and Sentinel-2 layer entries. */
function buildSatLayer(sensor: string, year: number, wmsPrefix: string, labelPrefix: string, aliases?: string[]): { wmsLayer: string; wmsAliases?: string[]; label: string; year: number } {
    const envKey = `WMS_${sensor}_${year}`;
    const envAliasKey = `${envKey}_ALIASES`;
    const defaultLayer = `Mosaicos:${wmsPrefix}_${year}`;
    const envAliases = String(process.env[envAliasKey] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const aliasList = Array.from(new Set([defaultLayer, ...(aliases || []), ...envAliases]));
    return {
        wmsLayer: process.env[envKey] || defaultLayer,
        wmsAliases: aliasList,
        label: `${labelPrefix} (${year})`,
        year,
    };
}

/**
 * Camadas-base de satélite disponíveis para análise.
 *
 * A lista espelha o que o GeoServer da SEMA publica de fato (conferido no
 * GetCapabilities de 2026-08-20 — ver `docs/IMAGENS_E_CAMADAS_LAUDO.md`).
 * Buracos reais da série estadual: **2001 e 2002 não têm Landsat 5** (2002 é
 * coberto por Landsat 7) e **2012 não tem Landsat** (é ResourceSat).
 */
export const SATELLITE_LAYERS: Record<string, { wmsLayer: string; wmsAliases?: string[]; label: string; year: number }> = {
    // SPOT (high-res 2.5m) — base oficial do marco de 2008 (Nota Técnica 001/2017 SEMA-MT)
    spot_2008: { wmsLayer: SPOT_LAYER, label: "SPOT 2008", year: 2008 },
    // Landsat 5 (30m) — 1984-2011 (sem 2001 e 2002 no acervo da SEMA)
    ...Object.fromEntries([1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011].map(
        (y) => [`landsat5_${y}`, buildSatLayer("LANDSAT5", y, "LANDSAT_5", "Landsat 5")]
    )),
    // Landsat 7 (30m) — só 2002, fecha o vão entre 2000 e 2003
    ...Object.fromEntries([2002].map(
        (y) => [`landsat7_${y}`, buildSatLayer("LANDSAT7", y, "LANDSAT_7", "Landsat 7")]
    )),
    // ResourceSat (~24m) — só 2012, único mosaico do ano na SEMA
    ...Object.fromEntries([2012].map(
        (y) => [`resourcesat_${y}`, buildSatLayer("RESOURCESAT", y, "RESOURCESAT", "ResourceSat")]
    )),
    // Landsat 8 (30m) — 2013-2018
    ...Object.fromEntries([2013, 2014, 2015, 2016, 2017, 2018].map(
        (y) => [`landsat8_${y}`, buildSatLayer("LANDSAT8", y, "LANDSAT_8", "Landsat 8")]
    )),
    // Sentinel-2 (10m) — 2016-2025
    ...Object.fromEntries([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
        (y) => [`sentinel2_${y}`, buildSatLayer("SENTINEL2", y, "SENTINEL_2", "Sentinel-2")]
    )),
};

/**
 * Janela fixa da análise AC/AVN.
 *
 * Começa em **2003** e termina em **2008** (marco do art. 3º, IV da Lei
 * 12.651/2012), com o SPOT 2,5 m como cena de maior peso.
 *
 * O motivo do 2003 não é haver piso para a consolidação — não há: área aberta
 * em 1990 é tão consolidada quanto uma aberta em 2007. O 2003 é o fim da
 * contagem do **pousio quinquenal** (art. 3º, XXIV): interrupção da atividade
 * por até 5 anos não descaracteriza a AC, mas acima disso descaracteriza, e a
 * vegetação regenerada volta a ser AVN.
 *
 * Por isso a série é **contígua ano a ano** (2003, 2004, 2005, 2006, 2007,
 * 2008): quem decide a classificação é o **ano da última atividade visível**, e
 * um ano faltando pode mover a contagem de um lado ao outro do limite de 5
 * anos. Se nenhum ano da janela mostra atividade, a última é anterior a 2003 —
 * mais de 5 anos — e o trecho é AVN, não AC em descanso.
 *
 * Ajustável por `SIMCAR_ACAVN_SATELLITE_KEYS` (lista separada por vírgula).
 */
const AC_AVN_DEFAULT_KEYS = [
    "landsat5_2003",
    "landsat5_2004",
    "landsat5_2005",
    "landsat5_2006",
    "landsat5_2007",
    "spot_2008",
    "landsat5_2008",
] as const;

export function getFixedAcAvnSatelliteKeys(): string[] {
    const override = String(process.env.SIMCAR_ACAVN_SATELLITE_KEYS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const keys = override.length > 0 ? override : [...AC_AVN_DEFAULT_KEYS];
    const valid = keys.filter((k) => Boolean(SATELLITE_LAYERS[k]));
    if (override.length > 0 && valid.length === 0) {
        console.warn("[SIMCAR] SIMCAR_ACAVN_SATELLITE_KEYS não casou com nenhuma camada; usando a janela padrão.");
        return [...AC_AVN_DEFAULT_KEYS].filter((k) => Boolean(SATELLITE_LAYERS[k]));
    }
    return valid;
}

export function getOrderedSatelliteKeys(selectedLayers: string[] = []): string[] {
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

export const ANALYSIS_VISION_MODELS = (
    process.env.VISION_MODEL || "google/gemini-2.5-flash"
)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
export const GROQ_TEXT_MODELS = [
    "openai/gpt-oss-120b",
    "meta-llama/llama-3.3-70b-versatile",
    "qwen/qwen3-32b",
];
/** Normaliza nome de modelo vindo de env (aspas, espaços, prefixos). */
function normalizeTextModelName(raw: string): string {
    return String(raw || "")
        .trim()
        .replace(/^['"`]+|['"`]+$/g, "")
        .trim();
}

/** Monta a cadeia de modelos de texto a partir de env + backups, sem duplicatas. */
function buildTextModelChain(configValue: string | undefined, backupModels: string[]): string[] {
    const configured = String(configValue || "")
        .split(/[,\n;]+/)
        .map((x) => normalizeTextModelName(x))
        .filter(Boolean);
    const normalizedBackup = backupModels
        .map((x) => normalizeTextModelName(x))
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

const SIMCAR_ANALYSIS_MODE = String(process.env.SIMCAR_ANALYSIS_MODE || "efficient").trim().toLowerCase();
const SIMCAR_CHAT_MAX_MESSAGES = Number(process.env.SIMCAR_CHAT_MAX_MESSAGES || 10);
const SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE = Number(process.env.SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE || 1400);
const SIMCAR_CHAT_MAX_TOTAL_CHARS = Number(process.env.SIMCAR_CHAT_MAX_TOTAL_CHARS || 8500);
const SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT = Number(process.env.SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT || 1800);
export const SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL = normalizeTextModelName(
    process.env.SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || GROQ_TEXT_MODELS[0],
);
const SIMCAR_FINAL_UNIFIED_TEXT_MODEL = normalizeTextModelName(
    process.env.SIMCAR_FINAL_UNIFIED_TEXT_MODEL || GROQ_TEXT_MODELS[0],
);
export const SIMCAR_SYNTHESIS_TEXT_MODELS = (() => {
    const explicit = buildTextModelChain(process.env.SIMCAR_SYNTHESIS_TEXT_MODELS, []);
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string) => {
        const model = normalizeTextModelName(raw);
        if (!model) return;
        const key = model.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(model);
    };
    for (const model of explicit) push(model);
    push(SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL);
    for (const model of GROQ_TEXT_MODELS) push(model);
    return ordered;
})();
export const SIMCAR_FINAL_UNIFIED_TEXT_MODELS = (() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string) => {
        const model = normalizeTextModelName(raw);
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

export function getSimcarAiRuntimeConfig() {
    return {
        hasGroqApiKey: Boolean(process.env.GROQ_API_KEY),
        analysisMode: SIMCAR_ANALYSIS_MODE,
        visionModels: ANALYSIS_VISION_MODELS,
        textModels: GROQ_TEXT_MODELS,
        synthesisPrimaryTextModel: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL,
        synthesisTextModels: SIMCAR_SYNTHESIS_TEXT_MODELS,
        finalUnifiedTextModel: SIMCAR_FINAL_UNIFIED_TEXT_MODEL,
        finalUnifiedTextModels: SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
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
    /** De onde a cena vem. Sem isso, SEMA — é o comportamento histórico. */
    source: WmsSource = SEMA_SOURCE,
): string {
    const url = new URL(source.base);
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
    if (source.authkey) url.searchParams.set("authkey", source.authkey);
    return url.toString();
}

/** PNG magic bytes: 0x89 P N G */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** JPEG magic bytes: 0xFF 0xD8 0xFF */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Fetch a WMS image and return as a PNG Buffer. Validates the response is actually an image. */
async function fetchWmsImageBufferOnce(
    layers: string[],
    bbox: [number, number, number, number],
    width = 1200,
    height = 900,
    source: WmsSource = SEMA_SOURCE,
    timeoutMsOverride?: number,
): Promise<Buffer> {
    const mapUrl = buildWmsGetMapUrl(layers, bbox, width, height, "image/png", "EPSG:4326", source);
    const controller = new AbortController();
    const dynamicTimeout = Math.max(1_000, timeoutMsOverride ?? calculateWmsTimeout(width, height));
    const timeout = setTimeout(() => controller.abort(), dynamicTimeout);
    try {
        const response = await fetch(mapUrl, { signal: controller.signal });

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
    } finally {
        clearTimeout(timeout);
    }
}

function isRetryableWmsError(error: unknown): boolean {
    const msg = String((error as any)?.message || error || "").toLowerCase();
    return (
        msg.includes("fetch failed") ||
        msg.includes("timeout") ||
        msg.includes("aborted") ||
        msg.includes("socket") ||
        msg.includes("econnreset") ||
        msg.includes("econnrefused") ||
        msg.includes("etimedout") ||
        msg.includes("und_err_")
    );
}

function buildWmsResolutionFallbacks(
    width: number,
    height: number,
    factors = [1, 0.85, 0.7, 0.55],
): Array<[number, number]> {
    const seen = new Set<string>();
    const out: Array<[number, number]> = [];
    for (const factor of factors) {
        const w = Math.max(1, Math.round(width * factor));
        const h = Math.max(1, Math.round(height * factor));
        const key = `${w}x${h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([w, h]);
    }
    return out;
}

type WmsFetchOptions = {
    timeoutMs?: number;
    maxDurationMs?: number;
    retryAttempts?: number;
    fallbackFactors?: number[];
};

/** Fetch WMS with retry and resolution fallback. Always returns at target width/height. */
async function fetchWmsImageBuffer(
    layers: string[],
    bbox: [number, number, number, number],
    width = 1200,
    height = 900,
    source: WmsSource = SEMA_SOURCE,
    options: WmsFetchOptions = {},
): Promise<Buffer> {
    const resolutions = buildWmsResolutionFallbacks(width, height, options.fallbackFactors);
    const retryAttempts = Math.max(1, options.retryAttempts ?? WMS_FETCH_RETRY_ATTEMPTS);
    const deadline = Number.isFinite(options.maxDurationMs) && (options.maxDurationMs || 0) > 0
        ? Date.now() + Number(options.maxDurationMs)
        : Number.POSITIVE_INFINITY;
    let lastError: unknown = null;

    for (const [tryW, tryH] of resolutions) {
        if (Date.now() >= deadline) break;
        for (let attempt = 1; attempt <= retryAttempts; attempt++) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) break;
            try {
                const requestTimeout = Math.max(
                    1,
                    Math.min(options.timeoutMs ?? calculateWmsTimeout(tryW, tryH), remainingMs),
                );
                const buf = await fetchWmsImageBufferOnce(layers, bbox, tryW, tryH, source, requestTimeout);
                if (tryW === width && tryH === height) return buf;
                return await sharp(buf).resize(width, height, { fit: "fill" }).png().toBuffer();
            } catch (err) {
                lastError = err;
                const retryable = isRetryableWmsError(err);
                if (retryable && attempt < retryAttempts) {
                    const delay = Math.min(WMS_RETRY_BASE_DELAY_MS * attempt, Math.max(0, deadline - Date.now()));
                    if (delay <= 0) break;
                    await sleepMs(delay);
                    continue;
                }
                break;
            }
        }
    }

    throw lastError || new Error("Falha ao buscar imagem WMS.");
}

export type ResolvedSatelliteImage = {
    png: Buffer;
    candidate: WmsCandidate;
    /** Sufixo de proveniência da figura: `cena 20/07/2008, órbita/ponto 224/069, acervo IMAP`. */
    provenance: string;
};

/**
 * Resolve a imagem de um satélite: **acervo da casa primeiro, SEMA depois.**
 *
 * A ordem não é preferência estética. A cena nativa do acervo tem data de
 * passagem conhecida — o laudo cita "cena de 20/07/2008" no lugar de "mosaico
 * LANDSAT_5_2008" — e não é reamostrada como o mosaico estadual.
 *
 * ⚠️ Candidata do acervo passa por **duas** portas, não uma. Responder HTTP 200
 * com um PNG não prova cobertura: `spot_sema_canarana_mosaico` tem bbox sobre
 * imóveis que ele não cobre e devolve 100% preto; tile de carta devolve 60%
 * branco. Por isso `isMostlyEmptyRender` roda antes de aceitar, e só para o
 * acervo — o mosaico estadual é contínuo e não tem esse modo de falha.
 */
export async function fetchSatelliteImage(
    satelliteKey: string,
    sat: { wmsLayer: string; wmsAliases?: string[]; label: string; year: number },
    bbox: [number, number, number, number],
    width: number,
    height: number,
    logPrefix = "SIMCAR ANALYSIS",
): Promise<ResolvedSatelliteImage | null> {
    const semaLayers = Array.from(new Set([sat.wmsLayer, ...(sat.wmsAliases || [])].filter(Boolean)));
    const candidates: WmsCandidate[] = [
        ...acervoCandidates(satelliteKey, sat.year, bbox),
        ...semaLayers.map((layer) => ({ layer, source: SEMA_SOURCE })),
    ];

    const isSpot = satelliteKey.toLowerCase().startsWith("spot");
    const spotDeadline = isSpot ? Date.now() + 35_000 : Number.POSITIVE_INFINITY;
    let lastError = "unknown";
    for (const candidate of candidates) {
        const remainingSpotMs = spotDeadline - Date.now();
        if (remainingSpotMs <= 0) break;
        try {
            const png = await fetchWmsImageBuffer(
                [candidate.layer],
                bbox,
                width,
                height,
                candidate.source,
                isSpot
                    ? {
                        timeoutMs: 20_000,
                        maxDurationMs: remainingSpotMs,
                        retryAttempts: 1,
                        fallbackFactors: [1, 0.6],
                    }
                    : undefined,
            );
            if (candidate.source.id === "acervo") {
                const { empty, ratio } = await isMostlyEmptyRender(png);
                if (empty) {
                    console.warn(
                        `[ACERVO] ${sat.label}: ${candidate.layer} sem cobertura útil (${Math.round(ratio * 100)}% vazio); próxima candidata.`,
                    );
                    continue;
                }
                if (candidate.scene?.revisar) {
                    console.warn(
                        `[ACERVO] ${sat.label}: ${candidate.layer} está marcada para revisão no catálogo ` +
                        `(outra cena da mesma data com bbox divergente — uma das duas está deslocada).`,
                    );
                }
                console.log(`[ACERVO] ${sat.label} servido pelo acervo: ${candidate.layer}`);
            }
            return { png, candidate, provenance: describeSceneProvenance(candidate.source, candidate.scene) };
        } catch (err: any) {
            lastError = err?.message || String(err);
            console.warn(`[${logPrefix}] WMS ${sat.label} (${candidate.source.id}:${candidate.layer}) failed: ${lastError}`);
        }
    }

    console.warn(
        `[${logPrefix}] WMS ${sat.label} indisponível em ${candidates.length} candidata(s). Último erro: ${lastError}`,
    );
    return null;
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
export function buildPolygonOverlaySvg(
    width: number,
    height: number,
    bbox: [number, number, number, number],
    propertyPolygon: Feature<Polygon | MultiPolygon>,
    layerGeometries: Map<string, Geometry[]>,
    layers: Array<{ name: string; stroke: string; fill: string; strokeWidth: number }>,
    options: { showLegend?: boolean } = {},
): Buffer {
    const showLegend = options.showLegend !== false;
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

    // Always draw property polygon outline (red, no fill, thick stroke)
    svgParts.push(
        `<!-- Propriedade -->`,
        geometriesToSvgPaths(
            [propertyPolygon.geometry],
            bbox, width, height,
            "#FF0000", 3.5, "transparent",
        ),
    );

    // Legend in bottom-left corner
    if (showLegend) {
        const legendItems: Array<{ color: string; label: string }> = [
            { color: "#FF0000", label: "Propriedade" },
        ];
        for (const layer of layers) {
            const geoms = layerGeometries.get(layer.name);
            if (geoms && geoms.length > 0) {
                const labels: Record<string, string> = {
                    AREA_CONSOLIDADA: "Área Consolidada",
                    AVN: "AVN",
                    AUAS: "AUAS",
                    ARL: "ARL",
                    ARLREM: "ARL",
                };
                legendItems.push({ color: layer.stroke, label: labels[layer.name] || layer.name });
            }
        }

        const lineH = 20;
        const padX = 12;
        const padY = 10;
        const boxW = 180;
        const boxH = padY * 2 + legendItems.length * lineH;
        const boxX = 10;
        const boxY = height - boxH - 10;

        svgParts.push(`<!-- Legenda -->`);
        svgParts.push(`<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="rgba(0,0,0,0.75)" />`);

        legendItems.forEach((item, i) => {
            const y = boxY + padY + i * lineH + 12;
            svgParts.push(`<rect x="${boxX + padX}" y="${y - 10}" width="12" height="12" rx="2" fill="${item.color}" />`);
            svgParts.push(`<text x="${boxX + padX + 18}" y="${y}" fill="white" font-family="sans-serif" font-size="13">${item.label}</text>`);
        });
    }

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
        const continuation = await callTextFollowUp(continuationMessages, {
            contextLabel: `continuation-${providerLabel}`,
        });
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

                const visionApiUrl = process.env.VISION_API_URL || "https://api.groq.com/openai/v1/chat/completions";
                const visionApiKey = process.env.VISION_API_KEY || apiKey;
                const response = await fetch(visionApiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${visionApiKey}`,
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

/**
 * Análise de imagens do recorte SIMCAR.
 * Groq é o único provedor de visão: tenta todos os modelos de `ANALYSIS_VISION_MODELS`
 * e, se todos estiverem em cooldown de rate limit, falha com o tempo de espera.
 */
async function analyzeImagesWithVision(
    images: AiImage[],
    prompt: string,
    contextLabel: string,
): Promise<string> {
    if (images.length === 0) {
        throw new Error(`Sem imagens para análise (${contextLabel}).`);
    }
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY não configurada para análise de imagens.");
    }

    if (!hasAvailableGroqModels(ANALYSIS_VISION_MODELS)) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(ANALYSIS_VISION_MODELS) / 1000));
        throw new GroqRateLimitError(
            `Modelos de visão Groq em cooldown para ${contextLabel}. Aguarde ~${waitSecs}s e tente novamente.`,
        );
    }

    console.log(
        `[SIMCAR ANALYSIS] ${contextLabel}: enviando ${images.length} imagens para a visão Groq`,
    );
    try {
        return await callVisionAnalysis(images, prompt);
    } catch (err: any) {
        const isRateLimit = err instanceof GroqRateLimitError;
        const errMsg = String(err?.message || err);
        console.warn(
            `[SIMCAR ANALYSIS] Visão Groq falhou para ${contextLabel}${isRateLimit ? " (RATE LIMITED)" : ""}: ${errMsg}`,
        );
        if (isRateLimit) throw err;
        throw new Error(`Análise de imagens falhou para ${contextLabel}. Erro: ${errMsg}`);
    }
}

/** Call Groq with text-only follow-up message. Multi-model fallback. */
export function normalizeAssistantContent(content: any): string {
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

export function compactChatMessages(
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

type GroqTextCallOptions = {
    /** Rótulo usado apenas em logs. */
    contextLabel?: string;
    /** Cadeia de modelos a tentar; por padrão `GROQ_TEXT_MODELS`. */
    modelChain?: string[];
    /** Teto de tokens de saída por chamada. */
    maxTokens?: number;
};

/**
 * Síntese de melhor qualidade: mesma cadeia Groq, porém com orçamento de saída
 * maior e a ordem definida por `SIMCAR_SYNTHESIS_TEXT_MODELS`.
 */
async function callBestTextSynthesis(
    messages: Array<{ role: string; content: any }>,
    contextLabel = "text-synthesis",
    options?: { modelChain?: string[]; maxOutputTokens?: number },
): Promise<string> {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY não configurada para síntese.");
    }
    const modelChain = Array.isArray(options?.modelChain) && options.modelChain.length > 0
        ? options.modelChain
        : SIMCAR_SYNTHESIS_TEXT_MODELS;
    const maxTokens = Number.isFinite(options?.maxOutputTokens)
        ? Number(options?.maxOutputTokens)
        : 8192;

    console.log(
        `[SIMCAR ANALYSIS] ${contextLabel}: síntese via cadeia Groq: ${modelChain.join(", ")}`,
    );
    return callTextFollowUp(messages, { contextLabel, modelChain, maxTokens });
}

/** Chamada de texto no Groq, com fallback entre modelos e continuação por truncamento. */
export async function callTextFollowUp(
    messages: Array<{ role: string; content: any }>,
    options?: GroqTextCallOptions,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const contextLabel = options?.contextLabel || "text-followup";
    const modelChain = Array.isArray(options?.modelChain) && options.modelChain.length > 0
        ? options.modelChain
        : GROQ_TEXT_MODELS;
    const MAX_TOKENS = Number.isFinite(options?.maxTokens) ? Number(options?.maxTokens) : 2200;
    const MAX_CONTINUATIONS = 2;

    let lastError = "";
    let sawRateLimit = false;
    for (const model of modelChain) {
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
                `[SIMCAR ANALYSIS] ${contextLabel}: text model ${model} ok (finish=${first.finishReason}, chars=${first.content.length})`,
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
                const continuationCandidates = [activeModel, ...modelChain.filter((m) => m !== activeModel)];
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
            console.warn(`[SIMCAR ANALYSIS] ${contextLabel}: text model ${model} failed: ${lastError}`);
        }
    }
    if (sawRateLimit && !hasAvailableGroqModels(modelChain)) {
        const waitSecs = Math.max(1, Math.ceil(getGroqRateLimitRemainingMs(modelChain) / 1000));
        throw new GroqRateLimitError(`Todos os modelos de texto Groq estão em cooldown (~${waitSecs}s).`);
    }
    throw new Error(`Falha nos modelos de texto Groq (${contextLabel}). Último erro: ${lastError}`);
}

export async function streamTextFollowUp(
    res: Response,
    messages: Array<{ role: string; content: any }>,
    options?: { throwIfCancelled?: () => void },
): Promise<void> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const MAX_TOKENS = 2200;
    const MAX_CONTINUATIONS = 2;

    let accumulatedAnswer = "";
    let accumulatedThinking = "";
    let activeModel = "";
    const assertNotCancelled = () => {
        options?.throwIfCancelled?.();
    };

    const writeChunk = (payload: Record<string, any>) => {
        sendSSE(res, payload);
    };

    const streamModelSegment = async (
        segmentModel: string,
        segmentMessages: Array<{ role: string; content: any }>,
    ): Promise<{ finishReason: string; segmentText: string }> => {
        const segmentInputTokens = estimateTokensFromMessages(segmentMessages);
        let segmentRaw = "";
        let usageRecorded = false;
        const recordUsage = () => {
            if (usageRecorded) return;
            usageRecorded = true;
            recordModelUsage({
                provider: "groq",
                model: segmentModel,
                inputTokens: Math.max(1, segmentInputTokens),
                outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
                estimated: true,
            });
        };
        assertNotCancelled();
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

        while (true) {
            try {
                assertNotCancelled();
            } catch {
                recordUsage();
                try {
                    await reader.cancel();
                } catch {
                    // ignore
                }
                throw new ClientAbortError();
            }
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
                    recordUsage();
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

        recordUsage();
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
            if (err instanceof ClientAbortError) throw err;
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
        assertNotCancelled();
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
                if (err instanceof ClientAbortError) throw err;
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

function normalizeRenderBboxAspect(
    bbox: [number, number, number, number],
    maxAspectRatio = 2.5,
): [number, number, number, number] {
    const width = Math.max(0, bbox[2] - bbox[0]);
    const height = Math.max(0, bbox[3] - bbox[1]);
    if (width <= 0 || height <= 0) return bbox;

    const centerX = (bbox[0] + bbox[2]) / 2;
    const centerY = (bbox[1] + bbox[3]) / 2;
    const aspect = width / height;
    const safeMaxAspect = Math.max(1.1, maxAspectRatio);

    if (aspect > safeMaxAspect) {
        const targetHeight = width / safeMaxAspect;
        const halfHeight = targetHeight / 2;
        return [bbox[0], centerY - halfHeight, bbox[2], centerY + halfHeight];
    }

    if (aspect < 1 / safeMaxAspect) {
        const targetWidth = height / safeMaxAspect;
        const halfWidth = targetWidth / 2;
        return [centerX - halfWidth, bbox[1], centerX + halfWidth, bbox[3]];
    }

    return bbox;
}

function buildRenderBbox(
    bbox: [number, number, number, number],
    paddingPercent = 0.10,
    maxAspectRatio = 2.5,
): [number, number, number, number] {
    return normalizeRenderBboxAspect(padBbox(bbox, paddingPercent), maxAspectRatio);
}

type SatelliteSceneFrame = {
    bbox: [number, number, number, number];
    width: number;
    height: number;
};

/**
 * O mosaico SPOT é muito mais pesado que as camadas Landsat. Para ele, usa-se
 * somente a janela local da propriedade, com contexto limitado a 5 km, e não
 * uma resolução artificialmente maior que a informação nativa do sensor.
 */
function buildSatelliteSceneFrame(
    satelliteKey: string,
    areaHa: number,
    propertyBbox: [number, number, number, number],
    defaultBbox: [number, number, number, number],
    defaultWidth: number,
    defaultHeight: number,
): SatelliteSceneFrame {
    if (!satelliteKey.toLowerCase().startsWith("spot")) {
        return { bbox: defaultBbox, width: defaultWidth, height: defaultHeight };
    }

    const groundResolutionM = sensorGroundResolutionM("SPOT");
    const bbox = expandBboxForContext(propertyBbox, groundResolutionM);
    const { width, height } = calculateSensorDynamicResolution(areaHa, bbox, groundResolutionM);
    return { bbox, width, height };
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

/** Build prompt for a SINGLE satellite analysis (1 composite image). */
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
        "Analise a imagem composta do satélite fornecido comparando com os dados vetoriais do CAR.",
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
                "> Áreas ocluídas devem ser classificadas como INCONCLUSIVO, não como uso do solo.",
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
        `> **${FALSE_COLOR_PROMPT_NOTE}**`,
        "",
        `> **${MIXED_SOURCE_PROMPT_NOTE}**`,
        "",
        `> **${AC_AUAS_PROMPT_GLOSSARY}**`,
        "",
        "**Legenda dos polígonos (contorno forte + preenchimento translúcido de 12%, que não esconde o solo):**",
        "- 🟥 **Vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- 🟪 **Magenta Neon**: ÁREA CONSOLIDADA (AC) — uso consolidado declarado (conversão anterior a 22/07/2008)",
        "- 🟦 **Ciano Neon**: VEGETAÇÃO NATIVA (AVN) — vegetação nativa declarada",
        ...(hasAuas ? ["- 🟧 **Laranja Neon**: AUAS — supressão a partir de 22/07/2008 (uso alternativo do solo)"] : []),
        ...(hasArl ? ["- 🟩 **Verde Neon**: RESERVA LEGAL (ARL/ARLREM)"] : []),
        "",
        `**Imagem única (composite):** base ${sat.label} com propriedade + AC + AVN${hasAuas ? " + AUAS" : ""}${hasArl ? " + ARL" : ""} sobrepostos, e a mesma legenda desenhada no canto inferior esquerdo da própria imagem.`,
        "",
        "---",
        "",
        "## Análise da Área Consolidada (AC — contorno magenta)",
        "- As áreas contornadas em magenta correspondem a uso consolidado visível (pastagem limpa, agricultura, solo exposto, benfeitorias, cicatrizes de fogo, estradas)?",
        "- Padrão de textura de uso: pastagem → tonalidade uniforme; agricultura → linhas regulares; solo exposto → tons claros sem estrutura.",
        "- Algum trecho da AC apresenta textura de vegetação nativa (dossel rugoso, gradiente verde-escuro, estrutura de Cerrado/Floresta)?",
        "- **Atenção campo nativo:** em Cerrado, distinguir campo nativo (tonalidade clara com textura variada e manchas arbustivas intercaladas) de pastagem degradada (tonalidade uniforme sem arbustos). Campo nativo NÃO é uso do solo.",
        "- Para cada zona da AC, estimar o percentual (%) relativo de concordância/discordância com a classificação CAR, ao invés de hectares absolutos.",
        "- Indicar localização aproximada dos trechos discordantes: 'porção norte', 'borda leste', 'setor central', etc.",
        ...(isPreMarco
            ? [
                `- **Pousio — o que reportar nesta cena de ${year}:** registre objetivamente se há (a) atividade agrossilvipastoril EM CURSO (solo exposto, lavoura, pasto manejado, maquinário, estrada em uso) ou (b) apenas cobertura vegetal jovem sobre traçado antigo de talhão (bordas retas, estradas remanescentes). **Não decida AC ou AVN a partir desta cena isolada:** o que separa pousio de vegetação nativa é o ANO DA ÚLTIMA ATIVIDADE ao longo da série, e isso só a análise integrada consegue medir.`,
                POUSIO_PROMPT_RULE,
            ]
            : []),
        "",
        "## Análise da Vegetação Nativa (AVN — contorno ciano)",
        "- As áreas contornadas em ciano apresentam textura de vegetação nativa contínua (floresta, cerrado, mata ciliar)?",
        "- Distinguir tipologias: Floresta → dossel denso e contínuo; Cerrado → mosaico arbustivo-herbáceo; Campo nativo → tonalidade mais clara com textura variada.",
        "- Algum trecho de AVN apresenta uso do solo (pastagem limpa, lavoura, estradas rasgadas, solo exposto, cicatriz de fogo)? Nesta janela pré-marco, esse uso é consolidado.",
        "- Avaliar integridade e conectividade: fragmentação, clareiras, bordas com uso do solo.",
        "- **Bordas de transição AC/AVN:** examinar a faixa de transição entre AC e AVN. Se a borda for gradual (buffer de incerteza), reportar como zona de transição com percentual estimado, não como discordância categórica.",
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
        "- **❌ DISCORDA**: áreas onde a classificação não condiz. Indicar: (a) classificação mais apropriada, (b) localização relativa (porção N/NE/S etc.), (c) percentual aproximado do polígono.",
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
export function buildAnalysisPrompt(
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
        const imgBase = i + 1;
        return [
            `### ${sat.label} — ${meta.sensor} (${meta.spatialResolution})`,
            `- Bandas: ${meta.spectralBands}`,
            `- Revisita: ${meta.revisitDays} dias | Uso ideal: ${meta.bestUseCase}`,
            `- Peso da evidência: ${meta.spatialResolution.includes("2.5") ? "ALTO (confirmação isolada suficiente)" : meta.spatialResolution.includes("10") ? "MÉDIO (verificar com outra fonte)" : "BAIXO (requer confirmação cruzada)"}`,
            `- Imagem ${imgBase}: composite único (propriedade + AC + AVN${hasAuas ? " + AUAS" : ""}${hasArl ? " + ARL" : ""}, com legenda desenhada na imagem)`,
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
        `> **${FALSE_COLOR_PROMPT_NOTE}**`,
        "",
        `> **${MIXED_SOURCE_PROMPT_NOTE}**`,
        "",
        `> **${AC_AUAS_PROMPT_GLOSSARY}**`,
        "",
        "### Área Consolidada (AC — contorno magenta)",
        "- AC_FORA_SHAPE = **SIM** somente quando houver EVIDÊNCIA VISUAL CLARA de uso consolidado (pastagem, agricultura, solo exposto, estrada, benfeitorias) em área do imóvel que NÃO está coberta pelo polígono AC. Como toda a janela desta análise é anterior a 22/07/2008, o uso visto aqui é consolidado — constatar isso indica limite de AC subdimensionado, não irregularidade.",
        "- Critério de evidência clara: SPOT 2008 confirmando sozinho É suficiente (2.5m de resolução). Para Landsat, exige concordância de ao menos 2 cenas independentes.",
        POUSIO_PROMPT_RULE,
        "- Antes de decidir AC_FORA_SHAPE em trecho com vegetação jovem, declare explicitamente qual foi o **último ano da série em que houve atividade visível** naquele trecho. É esse ano que aplica a regra acima.",
        "- Distinga regeneração pós-uso (dossel baixo e uniforme, bordas retas herdadas do talhão, estradas remanescentes) de vegetação nativa primária (dossel alto e irregular, bordas sinuosas).",
        "- Padrão de textura de uso do solo: tonalidade uniforme sem gradiente de dossel, estrutura regular de lavoura ou pasto limpo, estradas visíveis ou cicatrizes de fogo.",
        "- Padrão de vegetação nativa: textura rugosa de copas, gradiente de cor verde-escuro, estrutura irregular de dossel (Floresta), ou manchas herbáceas intercaladas com arbustos (Cerrado).",
        "- **Atenção campo nativo:** em Cerrado, distinguir campo nativo (tonalidade clara com textura variada, manchas arbustivas) de pastagem degradada (tonalidade uniforme sem arbustos). Campo nativo NÃO é uso do solo.",
        "- Se a área em questão apresentar textura ambígua (campo nativo, palhada, solo seco), classifique como INCONCLUSIVO.",
        "",
        "### Vegetação Nativa (AVN — contorno ciano)",
        "- AVN_FORA_SHAPE = **IGNORAR** sempre. Não reportar vegetação fora do shape AVN.",
        "- AVN_DENTRO_SHAPE_ANTROPIZADO = **SIM** apenas quando houver área CLARAMENTE em uso do solo DENTRO do polígono AVN. Como a janela é pré-marco, descreva o achado como uso consolidado dentro da AVN — o código do veredito mantém o nome antigo, mas o texto do laudo não.",
        "- Avalie integridade do dossel, continuidade da cobertura e sinais de fragmentação.",
        "- Atenção especial em bordas: áreas de borda podem apresentar transição gradual — só classifique como uso do solo se essa textura for dominante no trecho.",
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
    /** Conferência geométrica do achado "uso dentro da AVN": AC∩AVN e
     * AVN∩reservatório medidos no shape do recorte. Se a IA diz SIM mas aqui
     * dá 0, o achado visual é falso positivo (reservatório/água) — o laudo
     * rebaixa para INCONCLUSIVO com nota.  */
    geometryCrossCheck?: {
        acAvnOverlapHa: number;
        avnAreaHa: number;
        acAreaHa: number;
        reservatorioOverlapAvnHa: number;
        hasReservatorioLayer: boolean;
    } | null;
    /** Análise dos reservatórios artificiais do recorte — lâmina d'água,
     * sobreposição com AC/AUAS/AVN e enquadramento legal (Lei 12.651/2012,
     * art. 4º III, §1º e §4º). Declarada no laudo porque o encarte digital do
     * CAR não transfere a lâmina para a área consolidada/AUAS automaticamente. */
    reservoirAnalysis?: ReservoirAnalysis | null;
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

// `resolveAuasAcAvnMeta` foi removida junto com o encadeamento: ela reconstruía os
// vereditos da AC/AVN garimpando marcadores no texto da análise anterior, que é
// justamente a dependência que a Fase 1 não deve ter.

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
            "- Foram identificadas duas divergencias: uso consolidado fora do shape AC e uso consolidado dentro do shape AVN.",
            hasMissing ? `- ${missingText}` : "",
            "",
            "## Recomendacao Operacional (Ajuste Automatico)",
            "- Revisar e ampliar o shape de AC para incluir as areas com uso consolidado detectadas dentro do imovel.",
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
            "- Revisar o shape AC e incluir os trechos com uso consolidado detectados fora do poligono atual.",
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
            "- Revisar o shape AVN e retirar os trechos com uso consolidado detectados no interior do poligono.",
            "- Confirmar os limites com apoio de imagem de melhor resolucao e validacao tecnica.",
        ].filter(Boolean).join("\n");
    }

    if (acForaShape === "NAO" && avnDentroShapeAntropizado === "NAO") {
        return [
            "## Resumo para o Usuario",
            "- Nao foram identificadas divergencias principais de AC fora do shape ou de uso consolidado dentro de AVN.",
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

function formatAcAvnVerdict(value: AcAvnVerdict | "IGNORAR" | undefined | null): string {
    if (value === "SIM") return "Sim";
    if (value === "NAO") return "Não";
    if (value === "IGNORAR") return "Não aplicável";
    return "Inconclusivo";
}

function formatAcAvnConfidence(value: AcAvnConfidence | undefined | null): string {
    if (value === "ALTA") return "Alta";
    if (value === "MEDIA") return "Média";
    if (value === "BAIXA") return "Baixa";
    return "Inconclusiva";
}

function explainAcVerdict(value: AcAvnVerdict | undefined | null): string {
    if (value === "SIM") return "há indício de uso consolidado fora do polígono AC declarado.";
    if (value === "NAO") return "não há indício consistente de uso consolidado fora do polígono AC declarado.";
    return "as imagens não permitem afirmar se há uso consolidado fora do polígono AC.";
}

function explainAvnVerdict(value: AcAvnVerdict | undefined | null): string {
    if (value === "SIM") return "há indício de trecho com uso consolidado dentro do polígono AVN declarado.";
    if (value === "NAO") return "não há indício consistente de uso consolidado dentro do polígono AVN declarado.";
    return "as imagens não permitem concluir a integridade da AVN com segurança.";
}

function explainAuasBridgeVerdict(value: AcAvnVerdict | undefined | null): string {
    if (value === "SIM") return "há possível vegetação fora do shape AVN, mas inserida na AUAS; a etapa AUAS deve confirmar a coerência temporal.";
    if (value === "NAO") return "não há indício de vegetação nativa fora do shape AVN dentro da AUAS.";
    return "a relação AVN x AUAS ficou inconclusiva para este recorte.";
}

function formatOperationalStatus(value: AcAvnVerdict | undefined | null): string {
    if (value === "SIM") return "Revisar";
    if (value === "NAO") return "Sem ajuste indicado";
    return "Inconclusivo";
}

function buildAcDecisionText(value: AcAvnVerdict): string {
    if (value === "SIM") {
        return "foi detectado uso consolidado fora do polígono AC. Revisar o limite da AC nos trechos apontados.";
    }
    if (value === "NAO") {
        return "não foi detectado uso consolidado relevante fora do polígono AC nas imagens avaliadas.";
    }
    return "não houve segurança suficiente para confirmar ou descartar uso consolidado fora do polígono AC. Tratar como pendência de revisão, não como erro confirmado.";
}

function buildAvnDecisionText(value: AcAvnVerdict): string {
    if (value === "SIM") {
        return "foi detectado trecho com uso consolidado dentro do polígono AVN. Revisar a AVN no setor indicado.";
    }
    if (value === "NAO") {
        return "não foi detectado uso consolidado consistente dentro do polígono AVN declarado.";
    }
    return "não houve segurança suficiente para confirmar a integridade da AVN. Revisar com imagem complementar ou checagem técnica.";
}

function buildAuasBridgeDecisionText(value: AcAvnVerdict, auasContext?: AcAvnAuasContext | null): string {
    if (!auasContext?.hasAuasLayer) return "camada AUAS ausente ou insuficiente neste recorte; executar a rotina AUAS se essa validação for necessária.";
    if (value === "SIM") {
        return "há sinal de vegetação nativa fora da AVN, mas dentro da AUAS. Executar a análise AUAS antes de decidir ajuste.";
    }
    if (value === "NAO") {
        return "não há indicação de conflito visual entre AVN e AUAS para este critério.";
    }
    return "a relação AVN x AUAS não ficou segura; usar a análise AUAS temporal para fechar a decisão.";
}

function buildAcAvnExecutiveSummary(args: {
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    confidence: AcAvnConfidence;
}): string {
    const issues: string[] = [];
    if (args.acForaShape === "SIM") issues.push("AC precisa de revisão");
    if (args.avnDentroShapeAntropizado === "SIM") issues.push("AVN precisa de revisão");
    if (args.acForaShape === "INCONCLUSIVO") issues.push("AC ficou inconclusiva");
    if (args.avnDentroShapeAntropizado === "INCONCLUSIVO") issues.push("AVN ficou inconclusiva");

    if (issues.length === 0) {
        return `As imagens avaliadas não indicam ajuste obrigatório nos shapes AC e AVN. Confiança geral: **${formatAcAvnConfidence(args.confidence)}**.`;
    }
    return `${issues.join("; ")}. Confiança geral: **${formatAcAvnConfidence(args.confidence)}**.`;
}

function buildSatelliteReadableLine(sat: AcAvnSatelliteVerdict): string {
    if (sat.status === "missing") {
        return `- **${sat.label}:** imagem indisponível; não foi usada na decisão.`;
    }
    const ac = sat.acForaShape === "SIM"
        ? "AC fora do shape detectada"
        : sat.acForaShape === "NAO"
            ? "AC fora do shape não detectada"
            : "AC fora do shape inconclusiva";
    const avn = sat.avnDentroShapeAntropizado === "SIM"
        ? "uso consolidado dentro da AVN detectado"
        : sat.avnDentroShapeAntropizado === "NAO"
            ? "uso consolidado dentro da AVN não detectado"
            : "AVN inconclusiva";
    const weight = sat.key.toLowerCase().includes("spot")
        ? "maior peso por melhor resolução"
        : sat.confidence === "BAIXA" || sat.confidence === "INCONCLUSIVO"
            ? "apoio limitado"
            : "apoio válido";
    return `- **${sat.label}:** ${ac}; ${avn}. Confiança ${formatAcAvnConfidence(sat.confidence).toLowerCase()} (${weight}).`;
}

function buildAcAvnConclusion(args: {
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    avnParcialForaShapeMasEmAuas: AcAvnVerdict;
    missingSatellites: string[];
    coherenceNotes: string[];
}): string {
    const lines: string[] = [];
    if (args.acForaShape === "SIM" || args.avnDentroShapeAntropizado === "SIM") {
        lines.push("Há indicação de ajuste vetorial. Priorize os trechos onde a imagem mostra uso consolidado fora da AC ou dentro da AVN.");
    } else if (args.acForaShape === "NAO" && args.avnDentroShapeAntropizado === "NAO") {
        lines.push("Não foi identificado ajuste obrigatório para AC ou AVN com base no conjunto de imagens analisado.");
    } else {
        lines.push("O resultado principal é parcialmente inconclusivo. Isso significa que a análise não confirmou erro vetorial, mas também não descartou totalmente a dúvida nas áreas ambíguas.");
    }
    if (args.avnParcialForaShapeMasEmAuas === "SIM") {
        lines.push("A relação AVN x AUAS exige validação temporal específica antes de qualquer alteração no shape.");
    }
    if (args.coherenceNotes.length > 0) {
        lines.push("Há divergência entre cenas; por isso a conclusão deve ser tratada com cautela técnica.");
    }
    if (args.missingSatellites.length > 0) {
        lines.push(`Imagens indisponíveis: ${args.missingSatellites.join(", ")}.`);
    }
    return lines.map((line) => `- ${line}`).join("\n");
}

function buildAcAvnRecommendation(args: {
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    avnParcialForaShapeMasEmAuas: AcAvnVerdict;
}): string {
    const lines: string[] = [];
    if (args.acForaShape === "SIM") {
        lines.push("Revisar e, se confirmado, ampliar o shape AC nos trechos com uso consolidado fora do polígono atual.");
    } else if (args.acForaShape === "INCONCLUSIVO") {
        lines.push("Revisar manualmente as bordas AC/AVN com imagem de maior resolução antes de alterar o shape AC.");
    }
    if (args.avnDentroShapeAntropizado === "SIM") {
        lines.push("Revisar o shape AVN e excluir trechos com uso consolidado evidente, mantendo registro da evidência visual.");
    } else if (args.avnDentroShapeAntropizado === "INCONCLUSIVO") {
        lines.push("Validar a AVN com imagem complementar ou checagem de campo nos setores de textura ambígua.");
    }
    if (args.avnParcialForaShapeMasEmAuas === "SIM" || args.avnParcialForaShapeMasEmAuas === "INCONCLUSIVO") {
        lines.push("Executar a análise AUAS temporal para confirmar a coerência entre AUAS e vegetação remanescente.");
    }
    if (lines.length === 0) {
        lines.push("Manter os shapes AC e AVN como estão, salvo se houver nova evidência ou ajuste cadastral externo.");
    }
    return lines.map((line) => `- ${line}`).join("\n");
}

function extractMarkdownSection(text: string, title: string): string {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
    return String(text || "").match(re)?.[2]?.trim() || "";
}

function buildReadableAcAvnReport(args: {
    originalText: string;
    acForaShape: AcAvnVerdict;
    avnDentroShapeAntropizado: AcAvnVerdict;
    avnParcialForaShapeMasEmAuas: AcAvnVerdict;
    confidence: AcAvnConfidence;
    satelliteVerdicts: AcAvnSatelliteVerdict[];
    coherenceNotes: string[];
    missingSatellites: string[];
    auasContext?: AcAvnAuasContext | null;
}): string {
    const original = String(args.originalText || "");
    const evidences = extractMarkdownSection(original, "Evidências por Imagem");
    const context = args.auasContext?.hasAuasLayer
        ? [
            `AUAS declarada: ${args.auasContext.auasAreaHa.toFixed(2)} ha.`,
            `AVN declarada: ${args.auasContext.avnAreaHa.toFixed(2)} ha.`,
            `Interseção AUAS x AVN: ${args.auasContext.overlapAreaHa.toFixed(2)} ha (${args.auasContext.overlapPctOfAuas.toFixed(1)}% da AUAS).`,
            `AUAS fora do AVN: ${args.auasContext.auasOutsideAvnAreaHa.toFixed(2)} ha (${args.auasContext.auasOutsideAvnPct.toFixed(1)}% da AUAS).`,
        ]
        : [];
    const satelliteLines = args.satelliteVerdicts.map(buildSatelliteReadableLine);
    const coherent = args.coherenceNotes.length === 0;

    return [
        "## Parecer Técnico AC/AVN",
        buildAcAvnExecutiveSummary({
            acForaShape: args.acForaShape,
            avnDentroShapeAntropizado: args.avnDentroShapeAntropizado,
            confidence: args.confidence,
        }),
        "",
        "## Decisão por Tema",
        `- **AC fora do shape:** ${formatOperationalStatus(args.acForaShape)} — ${buildAcDecisionText(args.acForaShape)}`,
        `- **Antropização dentro da AVN:** ${formatOperationalStatus(args.avnDentroShapeAntropizado)} — ${buildAvnDecisionText(args.avnDentroShapeAntropizado)}`,
        `- **Relação AVN x AUAS:** ${formatOperationalStatus(args.avnParcialForaShapeMasEmAuas)} — ${buildAuasBridgeDecisionText(args.avnParcialForaShapeMasEmAuas, args.auasContext)}`,
        "",
        ...(context.length ? ["## Contexto AUAS x AVN", ...context.map((item) => `- ${item}`), ""] : []),
        "## Imagens Avaliadas",
        ...(satelliteLines.length ? satelliteLines : ["- Nenhuma imagem válida foi registrada para esta etapa."]),
        "",
        "## Coerência Técnica",
        coherent
            ? "- Os vereditos globais estão coerentes com os vereditos por imagem."
            : "- Há divergência entre imagens; a decisão final foi conservadora.",
        ...args.coherenceNotes.map((note) => `- ${note}`),
        ...(args.missingSatellites.length > 0
            ? [`- Imagens indisponíveis: ${args.missingSatellites.join(", ")}.`]
            : []),
        "",
        "## Evidências por Imagem",
        evidences || "- A IA não detalhou evidências suficientes por imagem; recomenda-se revisar visualmente os painéis gerados.",
        "",
        "## Conclusão Técnica",
        buildAcAvnConclusion({
            acForaShape: args.acForaShape,
            avnDentroShapeAntropizado: args.avnDentroShapeAntropizado,
            avnParcialForaShapeMasEmAuas: args.avnParcialForaShapeMasEmAuas,
            missingSatellites: args.missingSatellites,
            coherenceNotes: args.coherenceNotes,
        }),
        "",
        "## Próximas Ações Recomendadas",
        buildAcAvnRecommendation({
            acForaShape: args.acForaShape,
            avnDentroShapeAntropizado: args.avnDentroShapeAntropizado,
            avnParcialForaShapeMasEmAuas: args.avnParcialForaShapeMasEmAuas,
        }),
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
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

    void canonicalSatLines;

    text = buildReadableAcAvnReport({
        originalText: text,
        acForaShape: resolvedAc,
        avnDentroShapeAntropizado: resolvedAvn,
        avnParcialForaShapeMasEmAuas: resolvedAvnAuasBridge,
        confidence: resolvedConfidence,
        satelliteVerdicts,
        coherenceNotes: coherenceCheck.notes,
        missingSatellites: options.satellitesMissing.map((sat) => sat.label),
        auasContext,
    });

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

function computeAcAvnGeometryCrossCheck(job: CachedJob): AcAvnAnalysisMeta["geometryCrossCheck"] {
    const acFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AREA_CONSOLIDADA");
    const avnFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AVN");
    if (!acFeature || !avnFeature) return null;
    const acAreaHa = turfArea(acFeature) / 10000;
    const avnAreaHa = turfArea(avnFeature) / 10000;
    let acAvnOverlapHa = 0;
    try {
        const overlap = turfIntersect(
            turfFeatureCollection([acFeature, avnFeature]) as FeatureCollection<Polygon | MultiPolygon>,
        ) as Feature<Polygon | MultiPolygon> | null;
        if (overlap) acAvnOverlapHa = turfArea(overlap) / 10000;
    } catch {
        acAvnOverlapHa = 0;
    }
    let reservatorioOverlapAvnHa = 0;
    let hasReservatorioLayer = false;
    const reservFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "RESERVATORIO_ARTIFICIAL");
    if (reservFeature) {
        hasReservatorioLayer = true;
        try {
            const overlap = turfIntersect(
                turfFeatureCollection([reservFeature, avnFeature]) as FeatureCollection<Polygon | MultiPolygon>,
            ) as Feature<Polygon | MultiPolygon> | null;
            if (overlap) reservatorioOverlapAvnHa = turfArea(overlap) / 10000;
        } catch {
            reservatorioOverlapAvnHa = 0;
        }
    }
    return {
        acAvnOverlapHa: Number(acAvnOverlapHa.toFixed(4)),
        avnAreaHa: Number(avnAreaHa.toFixed(4)),
        acAreaHa: Number(acAreaHa.toFixed(4)),
        reservatorioOverlapAvnHa: Number(reservatorioOverlapAvnHa.toFixed(4)),
        hasReservatorioLayer,
    };
}

/**
 * Análise dos reservatórios artificiais do recorte.
 *
 * O encarte digital do CAR/SICAR (de onde o recorte sai) NÃO soma a lâmina
 * d'água do reservatório à área consolidada/AUAS automaticamente. Pela Lei
 * 12.651/2012, art. 4º, III e §1º, reservatório artificial que NÃO decorre de
 * barramento/represamento de curso d'água natural NÃO gera APP de entorno —
 * a lâmina fica como uso antrópico (AUAS/consolidada), e §4º dispensa faixa
 * de APP para acumulações naturais/artificiais com superfície < 1 ha.
 */
export type ReservoirAnalysis = {
    hasReservoir: boolean;
    totalFeatures: number;
    totalAreaHa: number;
    /** Área do reservatório que cai sobre AREA_CONSOLIDADA declarada. */
    overlapAcHa: number;
    /** Área do reservatório que cai sobre AUAS declarada. */
    overlapAuasHa: number;
    /** Área do reservatório sobre AVN (conflito — precisa de revisão). */
    overlapAvnHa: number;
    /** Área do reservatório fora de AC/AUAS/AVN (lâmina "solta"). */
    outsideDeclaredHa: number;
    /** Percentual da área total do imóvel ocupado por reservatórios. */
    pctOfProperty: number;
    /** Menor e maior feição, para dimensionar a narrativa. */
    minFeatureHa: number;
    maxFeatureHa: number;
};

export function computeReservoirAnalysis(job: CachedJob, propertyAreaHa = 0): ReservoirAnalysis {
    const reservGeoms = job.clippedGeometries?.get("RESERVATORIO_ARTIFICIAL") || [];
    if (reservGeoms.length === 0) {
        return {
            hasReservoir: false,
            totalFeatures: 0,
            totalAreaHa: 0,
            overlapAcHa: 0,
            overlapAuasHa: 0,
            overlapAvnHa: 0,
            outsideDeclaredHa: 0,
            pctOfProperty: 0,
            minFeatureHa: 0,
            maxFeatureHa: 0,
        };
    }
    const merged = mergeLayerGeometriesAsFeature(job.clippedGeometries, "RESERVATORIO_ARTIFICIAL");
    const totalAreaHa = merged ? turfArea(merged) / 10000 : 0;

    const overlapWith = (layerName: string): number => {
        const other = mergeLayerGeometriesAsFeature(job.clippedGeometries, layerName);
        if (!other || !merged) return 0;
        try {
            const overlap = turfIntersect(
                turfFeatureCollection([merged, other]) as FeatureCollection<Polygon | MultiPolygon>,
            ) as Feature<Polygon | MultiPolygon> | null;
            return overlap ? turfArea(overlap) / 10000 : 0;
        } catch {
            return 0;
        }
    };

    const overlapAcHa = overlapWith("AREA_CONSOLIDADA");
    const overlapAuasHa = overlapWith("AUAS");
    const overlapAvnHa = overlapWith("AVN");
    const outsideDeclaredHa = Math.max(0, totalAreaHa - (overlapAcHa + overlapAuasHa + overlapAvnHa));

    let minFeatureHa = Infinity;
    let maxFeatureHa = 0;
    for (const geom of reservGeoms) {
        const polyLike = toPolygonOrMultiFeature(geom);
        if (!polyLike) continue;
        const a = turfArea(polyLike) / 10000;
        if (a > 0) {
            minFeatureHa = Math.min(minFeatureHa, a);
            maxFeatureHa = Math.max(maxFeatureHa, a);
        }
    }

    return {
        hasReservoir: true,
        totalFeatures: reservGeoms.length,
        totalAreaHa: Number(totalAreaHa.toFixed(4)),
        overlapAcHa: Number(overlapAcHa.toFixed(4)),
        overlapAuasHa: Number(overlapAuasHa.toFixed(4)),
        overlapAvnHa: Number(overlapAvnHa.toFixed(4)),
        outsideDeclaredHa: Number(outsideDeclaredHa.toFixed(4)),
        pctOfProperty: propertyAreaHa > 0 ? Number(((totalAreaHa / propertyAreaHa) * 100).toFixed(2)) : 0,
        minFeatureHa: Number((minFeatureHa === Infinity ? 0 : minFeatureHa).toFixed(4)),
        maxFeatureHa: Number(maxFeatureHa.toFixed(4)),
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
        "Em cada ano, inclua: uso do solo observado, integridade da vegetação, pontos de dúvida.",
        "",
        "### 2. Conexões Entre os Anos (obrigatória)",
        "Explique a linha do tempo conectando os anos entre si:",
        "- O que permaneceu estável ao longo dos anos?",
        "- Onde há indício de mudança (supressão ou regeneração)?",
        "- Qual sequência temporal mais provável para essas mudanças?",
        "",
        "### 3. Comparação CAR x Histórico",
        "- A Área Consolidada (AC) já estava consolidada no ano mais antigo?",
        "- Há AC com sinal de vegetação nativa no passado? Para cada trecho de AC coberto por vegetação, informe o **último ano da série com atividade visível** e aplique a regra do pousio abaixo.",
        "- Há AVN com sinal de uso do solo em algum ano?",
        "",
        POUSIO_PROMPT_RULE,
        "- **Reserva Legal:** se ARL estiver presente, há evidência de uso antrópico dentro da ARL em algum ano?",
        "",
        "### 4. Marco Temporal (art. 3º, IV e art. 61-A da Lei 12.651/2012)",
        "- Referência: **22/07/2008** — conversão anterior a essa data caracteriza área rural consolidada.",
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
/**
 * Série temporal da rotina AUAS: do marco (2008) até o ano mais recente
 * publicado pela SEMA, **sem buraco de ano**. O 2012 é ResourceSat porque o
 * acervo estadual não tem Landsat nesse ano, e 2019+ é Sentinel-2.
 */
export const AUAS_SATELLITE_KEYS: string[] = [
    "spot_2008",
    "landsat5_2008",
    "landsat5_2009",
    "landsat5_2010",
    "landsat5_2011",
    "resourcesat_2012",
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
    "sentinel2_2025",
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
    const paddedBbox = buildRenderBbox(bbox!, 0.10);

    // Dynamic resolution based on property size
    const areaHa = job.areaHa ?? 0;
    const { width: IMG_W, height: IMG_H } = calculateDynamicResolution(areaHa, paddedBbox);
    console.log(`[AUAS ANALYSIS] Dynamic resolution: ${IMG_W}×${IMG_H} for ${areaHa.toFixed(1)} ha property`);

    // Simplify geometries for overlay
    const rawLayerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map(g => simplifyGeometryForOverlay(g, 1200)));
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
        const frame = buildSatelliteSceneFrame(key, areaHa, bbox!, paddedBbox, IMG_W, IMG_H);

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `Baixando imagem ${sat.label} para AUAS...`,
        });

        const resolved = await fetchSatelliteImage(key, sat, frame.bbox, frame.width, frame.height, "AUAS ANALYSIS");
        throwIfClientDisconnected(res);
        const basePng = resolved?.png || null;
        const provenance = resolved?.provenance || "";

        if (!basePng) {
            missingKeys.push(key);
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
            const outlineSvg = buildPolygonOverlaySvg(frame.width, frame.height, frame.bbox, propertyPolygon!, layerGeos, [
                { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.05)", strokeWidth: 3.0 },
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.00)", strokeWidth: 1.4 },
                { name: "AREA_CONSOLIDADA", stroke: "#A855F7", fill: "rgba(168, 85, 247, 0.00)", strokeWidth: 1.4 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, outlineSvg),
                caption: `${sat.label} — AUAS contorno` + (provenance ? ` · ${provenance}` : ""),
            });

            // View 2: contextual overlays to improve discrimination between AC/AVN/AUAS
            const contextSvg = buildPolygonOverlaySvg(frame.width, frame.height, frame.bbox, propertyPolygon!, layerGeos, [
                { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.20)", strokeWidth: 2.2 },
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.14)", strokeWidth: 1.3 },
                { name: "AREA_CONSOLIDADA", stroke: "#A855F7", fill: "rgba(168, 85, 247, 0.12)", strokeWidth: 1.3 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, contextSvg),
                caption: `${sat.label} — AUAS contexto` + (provenance ? ` · ${provenance}` : ""),
            });
        } else {
            const propertySvg = buildPolygonOverlaySvg(frame.width, frame.height, frame.bbox, propertyPolygon!, layerGeos, [
                { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.20)", strokeWidth: 1.8 },
            ]);
            images.push({
                dataUrl: await compositeOverlay(basePng, propertySvg),
                caption: `${sat.label} — Propriedade (AUAS nao vetorizada)` + (provenance ? ` · ${provenance}` : ""),
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
            ? `Avalie SOMENTE a área delimitada pelo polígono AUAS (contorno laranja) na imagem ${sat.label}.`
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
        "- Padrão antrópico: tonalidade uniforme (pastagem), linhas regulares (agricultura), tons claros (solo exposto), presença de estradas ou cicatrizes de fogo.",
        "- **Campo nativo × pastagem degradada:** em Cerrado, campo nativo apresenta tonalidade clara com textura variada e manchas arbustivas intercaladas. Pastagem degradada tem tonalidade uniforme sem arbustos. Campo nativo NÃO é supressão.",
        "- **Bordas de transição:** quando a transição entre vegetação nativa e uso antrópico for gradual, reportar como zona de incerteza com percentual da área estimado, não em hectares.",
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

type AuasFinalStatusLabel =
    | "AUAS_VALIDA"
    | "AUAS_INVALIDA"
    | "AUAS_PARCIAL";

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

function extractAuasFinalStatus(text: string): AuasFinalStatusLabel | null {
    const match = String(text || "").match(/STATUS_FINAL\s*=\s*(AUAS_VALIDA|AUAS_INVALIDA|AUAS_PARCIAL)/i);
    const token = String(match?.[1] || "").toUpperCase();
    if (token === "AUAS_VALIDA" || token === "AUAS_INVALIDA" || token === "AUAS_PARCIAL") {
        return token as AuasFinalStatusLabel;
    }
    return null;
}

function extractAuasPassivoAmbiental(text: string): boolean {
    const normalized = String(text || "");
    if (/PASSIVO_AMBIENTAL\s*=\s*IDENTIFICADO/i.test(normalized)) return true;
    return /(passivo\s+ambiental|supress[aã]o\s+p[oó]s-marco|supress[aã]o\s+ap[oó]s\s*2008|desmatamento\s+recente)/i.test(normalized);
}

function deriveAuasFinalStatus(args: {
    hasAuasLayer: boolean;
    yearVerdicts: Array<{ year: number; verdict: AuasYearVerdictLabel }>;
    firstDeforestationYear: number | null;
    crossCheck?: AuasAvnCrossCheck | null;
}): AuasFinalStatusLabel {
    const hasPost2008Evidence =
        (Number.isFinite(args.firstDeforestationYear as number) && Number(args.firstDeforestationYear) > 2008) ||
        args.yearVerdicts.some((item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE");
    const allInconclusive = args.yearVerdicts.length > 0 && args.yearVerdicts.every((item) => item.verdict === "INCONCLUSIVO");
    const relevantAuasAvnOverlap = Boolean(args.crossCheck && args.crossCheck.overlapPctOfAuas >= 5);

    if (allInconclusive) return "AUAS_PARCIAL";
    if (!args.hasAuasLayer && hasPost2008Evidence) return "AUAS_PARCIAL";
    if (relevantAuasAvnOverlap) return "AUAS_PARCIAL";
    return "AUAS_VALIDA";
}

function buildAuasQualityFlags(args: {
    hasAuasLayer: boolean;
    yearVerdicts: Array<{ satelliteLabel: string; year: number; verdict: AuasYearVerdictLabel }>;
    firstDeforestationYear: number | null;
    crossCheck?: AuasAvnCrossCheck | null;
    cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
}): string[] {
    const flags: string[] = [];
    const hasBaseline2008 = args.yearVerdicts.some((item) => item.year === 2008 && item.verdict !== "INCONCLUSIVO");
    const post2008Desmate = args.yearVerdicts
        .filter((item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE")
        .map((item) => `${item.satelliteLabel} ${item.year}`);

    if (!hasBaseline2008) {
        flags.push("Referência de 2008 insuficiente ou inconclusiva; confiança temporal reduzida.");
    }
    if (post2008Desmate.length > 0) {
        flags.push(`Indício de supressão pós-2008 detectado em: ${post2008Desmate.slice(0, 5).join(", ")}.`);
    }
    if (!args.hasAuasLayer) {
        flags.push("Camada AUAS ausente no ZIP; a conclusão usa inferência temporal sobre a propriedade.");
    }
    if (args.crossCheck && args.crossCheck.overlapPctOfAuas >= 5) {
        flags.push(`Sobreposição AUAS x AVN relevante: ${args.crossCheck.overlapAreaHa.toFixed(2)} ha (${args.crossCheck.overlapPctOfAuas.toFixed(1)}% da AUAS).`);
    }
    const cloudy = (args.cloudWarnings || []).filter((item) => item.cloudScore >= 0.35);
    if (cloudy.length > 0) {
        flags.push(`Cenas com possível nebulosidade/oclusão: ${cloudy.map((item) => `${item.satellite} ${Math.round(item.cloudScore * 100)}%`).join(", ")}.`);
    }
    if (Number.isFinite(args.firstDeforestationYear as number) && Number(args.firstDeforestationYear) > 2008) {
        flags.push(`Ano provável inicial de supressão: ${Number(args.firstDeforestationYear)}.`);
    }

    return flags;
}

function buildAuasTechnicalSummaryMarkdown(args: {
    finalStatus: AuasFinalStatusLabel;
    confidence: AcAvnConfidence;
    passivoAmbiental: boolean;
    hasAuasLayer: boolean;
    firstDeforestationYear: number | null;
    qualityFlags: string[];
    crossCheck?: AuasAvnCrossCheck | null;
}): string {
    const statusText =
        args.finalStatus === "AUAS_VALIDA"
            ? "AUAS válida ou coerente com a série temporal"
            : args.finalStatus === "AUAS_INVALIDA"
                ? "AUAS inválida por inconsistência técnica relevante"
                : "AUAS parcialmente consistente ou dependente de revisão";
    const lines = [
        "## Síntese Técnica Automática",
        `- Status estruturado: ${statusText}.`,
        `- Confiança geral: ${args.confidence}.`,
        `- Passivo ambiental pós-2008: ${args.passivoAmbiental ? "identificado" : "não identificado com segurança"}.`,
        `- Camada AUAS vetorizada no ZIP: ${args.hasAuasLayer ? "sim" : "não"}.`,
    ];
    if (Number.isFinite(args.firstDeforestationYear as number)) {
        lines.push(`- Ano provável inicial de supressão: ${Number(args.firstDeforestationYear)}.`);
    }
    if (args.crossCheck) {
        lines.push(
            `- Cruzamento AUAS x AVN: ${args.crossCheck.overlapAreaHa.toFixed(2)} ha de sobreposição (${args.crossCheck.overlapPctOfAuas.toFixed(1)}% da AUAS).`,
        );
    }
    if (args.qualityFlags.length > 0) {
        lines.push("- Alertas técnicos:");
        for (const flag of args.qualityFlags.slice(0, 6)) {
            lines.push(`  - ${flag}`);
        }
    }
    return lines.join("\n");
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
        "Não usar tabela. Não usar emoji. Não incluir bloco <think>. Tamanho: entre 150 e 250 palavras.",
        "Seja enxuto: o laudo é lido junto do painel, que já mostra áreas, anos e cenas. Cite um número só quando ele sustentar a conclusão.",
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

    // O texto da análise AC/AVN não entra mais aqui: a Fase 1 é independente das
    // outras duas e conclui apenas pela própria série temporal.

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
        // Quatro seções, não sete: com o teto de 150-250 palavras cada seção a mais
        // vira título com uma frase solta embaixo. 'Achados por Período' repetia a
        // progressão temporal, que agora entra no próprio resumo.
        "## Formato Obrigatório de Saída",
        "## Resumo Executivo",
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
        "Em 'Resumo Executivo': em um parágrafo, a cobertura em 2008 (referência), o que mudou depois e a situação atual.",
        "Em 'Não Conformidades': citar intervalo de anos, localização aproximada (porção N/NE/S etc.) e área estimada em hectares quando identificada supressão irregular.",
        "Em 'Próximas Ações': máximo 2 ações, priorizadas e específicas para o caso.",
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
            if (/^[-*•]?\s*(AC_FORA_SHAPE|AVN_FORA_SHAPE|AVN_DENTRO_SHAPE_ANTROPIZADO|AVN_PARCIAL_FORA_SHAPE_MAS_EM_AUAS|CONFIANCA_GERAL)\s*=/i.test(trimmed)) return false;
            if (/AC_FORA_SHAPE\s*=.*AVN_DENTRO_SHAPE_ANTROPIZADO\s*=.*CONFIANCA\s*=/i.test(trimmed)) return false;
            return true;
        })
        .join("\n")
        .replace(/##\s*Veredito Objetivo\s*(?=\n##\s+|$)/gi, "")
        .replace(/##\s*Vereditos por Sat[eé]lite(?:\s*\(Normalizado\))?\s*(?=\n##\s+|$)/gi, "")
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

/**
 * Main AUAS analysis pipeline (called from the SSE endpoint).
 *
 * `previousAnalysis` segue no contrato porque o frontend ainda o envia, mas é
 * **ignorado de propósito**: esta análise é independente das outras duas do painel
 * pós-recorte. Não volte a ligá-lo ao prompt — era por ele que o laudo herdava as
 * conclusões que a AC/AVN havia escrito no chat.
 */
export async function processAuasAnalysis(
    res: Response,
    jobId: string,
    previousAnalysis?: string,
    contextUrl?: string,
    outputZipUrl?: string,
    acAvnMeta?: any,
    uid?: string,
): Promise<{
    analysisText: string;
    images: Array<{ url: string; caption: string }>;
    auasMeta: any;
    layerSummaries: LayerSummary[];
    cloudWarnings: Array<{ satellite: string; cloudScore: number }>;
} | null> {
    throwIfClientDisconnected(res);
    const job = await hydrateCachedJob(jobId, contextUrl, outputZipUrl, uid);
    if (!job || !job.bbox || !job.polygon || !job.layerSummaries) {
        sendSSE(res, {
            type: "error",
            message: "Job não encontrado. O servidor não localizou contexto ou ZIP persistido para reidratar o recorte.",
        });
        return null;
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
        return null;
    }

    if (imagesToAnalyze.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem AUAS foi gerada. Verifique a disponibilidade das camadas WMS." });
        return null;
    }

    // Step 2: Upload to Cloudinary
    sendSSE(res, { type: "progress", step: "uploading_images", percent: 50, message: "Salvando imagens AUAS no Cloudinary..." });

    const cloudinaryUrls: Array<{ url: string; caption: string }> = [];
    try {
        for (let i = 0; i < imagesToAnalyze.length; i++) {
            throwIfClientDisconnected(res);
            const img = imagesToAnalyze[i];
            const filename = `simcar_auas_${jobId.slice(0, 8)}_img${i + 1}`;
            const url = await uploadToCloudinary(img.dataUrl, filename, job.uid || "anonymous");
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
            const result = await analyzeImagesWithVision(
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
        return null;
    }

    // Step 5: síntese final, só da AUAS. Esta análise não lê nem incorpora o texto
    // das outras duas — o cruzamento AUAS×AVN abaixo vem da geometria do próprio
    // recorte, não de outra análise.
    sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA redigindo laudo da AUAS..." });
    throwIfClientDisconnected(res);

    let auasSynthesisText: string;
    const crossCheck = computeAuasAvnCrossCheck(job);
    const resolvedAcAvnMeta = acAvnMeta && typeof acAvnMeta === "object" ? acAvnMeta : undefined;
    try {
        const synthesisPrompt = buildAuasFinalSynthesisPrompt(
            areaHa,
            layerSummaries,
            perSatResults,
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
    const synthesisFinalStatus = extractAuasFinalStatus(auasSynthesisText);
    const synthesisConfidence = extractAcAvnConfidence(auasSynthesisText);
    const synthesisPassivoAmbiental = extractAuasPassivoAmbiental(auasSynthesisText);

    // A 2ª passada de IA que fundia AC/AVN + AUAS num texto único foi removida:
    // ela tornava o laudo desta análise dependente do que as outras escreveram no
    // chat. O texto final é o da própria AUAS, sem as linhas de marcador que só
    // servem para o parse acima.
    let analysisText = stripRoboticVerdictLines(auasSynthesisText);

    const inferredAuasNotVectorized = !hasAuasLayer && (
        (Number.isFinite(firstDeforestationYear as number) && Number(firstDeforestationYear) > 2008) ||
        yearVerdicts.some((item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE")
    );
    const finalStatus =
        synthesisFinalStatus ||
        extractAuasFinalStatus(analysisText) ||
        deriveAuasFinalStatus({ hasAuasLayer, yearVerdicts, firstDeforestationYear, crossCheck });
    const confidence = synthesisConfidence || extractAcAvnConfidence(analysisText);
    const passivoAmbiental =
        synthesisPassivoAmbiental ||
        extractAuasPassivoAmbiental(analysisText) ||
        inferredAuasNotVectorized ||
        yearVerdicts.some((item) => item.year > 2008 && item.verdict === "DESMATAMENTO_RECENTE");
    const qualityFlags = buildAuasQualityFlags({
        hasAuasLayer,
        yearVerdicts,
        firstDeforestationYear,
        crossCheck,
        cloudWarnings,
    });
    const auasMeta = {
        yearVerdicts,
        firstDeforestationYear,
        finalStatus,
        confidence,
        passivoAmbiental,
        qualityFlags,
        auasAvnCrossCheck: crossCheck,
        acAvnContextSource: resolvedAcAvnMeta ? "provided" : "none",
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
    const technicalSummary = buildAuasTechnicalSummaryMarkdown({
        finalStatus,
        confidence,
        passivoAmbiental,
        hasAuasLayer,
        firstDeforestationYear,
        qualityFlags,
        crossCheck,
    });
    if (!/##\s*S[ií]ntese T[eé]cnica Autom[aá]tica/i.test(analysisText)) {
        analysisText = [technicalSummary, analysisText].filter(Boolean).join("\n\n");
    }

    // The route sends the final SSE event only after billing, persistence and
    // job finalization succeed, so the frontend never sees a completed result
    // before the saved card is durable.
    return {
        analysisText,
        images: cloudinaryUrls,
        auasMeta,
        layerSummaries,
        cloudWarnings,
    };
}

/**
 * V2 do analista pós-recorte AUAS (pré-2008, Landsat 5 2003-2007 + SPOT 2008).
 * Analisa cada polígono AUAS individualmente via backend/analise-pos-recorte.
 * Atrás do feature flag SIMCAR_AUAS_V2_ENABLED — backend/simcar-clip.ts continua
 * sendo o adaptador de SSE/persistência/billing/PDF para este fluxo, conforme
 * Analise_pos_recorte/README.md.
 */
export async function processAuasAnalysisV2(
    res: Response,
    jobId: string,
    contextUrl?: string,
    outputZipUrl?: string,
    acAvnMeta?: any,
    uid?: string,
): Promise<{ auasMeta: AuasPre2008AnalysisV2; layerSummaries: LayerSummary[] } | null> {
    throwIfClientDisconnected(res);
    const job = await hydrateCachedJob(jobId, contextUrl, outputZipUrl, uid);
    if (!job || !job.layerSummaries) {
        sendSSE(res, {
            type: "error",
            message: "Job não encontrado. O servidor não localizou contexto ou ZIP persistido para reidratar o recorte.",
        });
        return null;
    }

    // `acAvnMeta` chega da análise AC/AVN e NÃO é repassado de propósito: a Fase 1
    // é independente das outras duas e redige o laudo só com a própria geometria
    // e as cenas que ela mesma inspecionou. Antes ele entrava no prompt do laudo
    // e o texto da Fase 1 herdava conclusões que não eram dela.

    try {
        const analysis = await runAuasPre2008Analysis(jobId, job.clippedGeometries, {
            checkpointStore: createFileCheckpointStore(jobId),
            uid: uid || job.uid || "anonymous",
            onProgress: (progress: AuasV2Progress) => {
                throwIfClientDisconnected(res);
                sendSSE(res, { type: "progress", ...progress });
            },
        });
        return { auasMeta: analysis, layerSummaries: job.layerSummaries };
    } catch (err) {
        if (err instanceof AuasTooManyPolygonsError) {
            sendSSE(res, { type: "error", message: err.message, code: "TOO_MANY_POLYGONS" });
            return null;
        }
        if (err instanceof AuasCancelledError) {
            throw new ClientAbortError(err.message);
        }
        throw err;
    }
}

/**
 * Handler completo da rota /api/simcar/clip/analyze-auas quando
 * SIMCAR_AUAS_V2_ENABLED=true: billing (no-op local), SSE, persistência e PDF,
 * chamando processAuasAnalysisV2 em vez do fluxo legado 2008–2024.
 */
export async function handleAuasAnalyzeV2Route(
    req: Request,
    res: Response,
    sendSseHeaders: (res: Response) => void,
): Promise<void> {
    let billingUid = "";
    let billingRequestId = "";
    let billingReserved = 0;
    let chargedBrl = 0;
    let processingJobId = "";
    let sseHeartbeat: ReturnType<typeof setInterval> | null = null;
    try {
        const uid = String(req.authUid || "");
        if (!uid) {
            res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
            return;
        }
        billingUid = uid;

        const { jobId, acAvnMeta, contextUrl, outputZipUrl } = req.body as {
            jobId?: string;
            acAvnMeta?: any;
            contextUrl?: string;
            outputZipUrl?: string;
        };
        if (!jobId) {
            res.status(400).json({ error: "jobId é obrigatório." });
            return;
        }

        billingRequestId = createRequestId("simcar_auas_v2");
        const cfg = getAuasV2Config();
        billingReserved = await estimateReserveForModels({
            models: [cfg.visionModel, cfg.textModel],
            estimatedInputTokens: 6_000,
            estimatedOutputTokens: 4_000,
            safetyMultiplier: 1.3,
            endpoint: "/api/simcar/clip/analyze-auas",
        });
        await reserveCredits({
            uid,
            amountBrl: billingReserved,
            requestId: billingRequestId,
            endpoint: "/api/simcar/clip/analyze-auas",
        });

        sendSseHeaders(res);
        sseHeartbeat = startSseHeartbeat(res);
        const processingJob = startJob({
            uid,
            endpoint: "/api/simcar/clip/analyze-auas",
            metadata: { clipJobId: jobId, schemaVersion: 2 },
        });
        processingJobId = processingJob.jobId;
        (res as any).__processingJobId = processingJobId;
        req.on("close", () => markDisconnected(processingJobId));
        sendSSE(res, { type: "job_started", jobId: processingJobId });

        let usageInputs: Array<any> = [];
        const result = await runWithBillingUsageSession(async () => {
            const outcome = await processAuasAnalysisV2(res, jobId, contextUrl, outputZipUrl, acAvnMeta, String(req.authUid || ""));
            if (outcome) {
                usageInputs = outcome.auasMeta.windows
                    .filter((w) => w.status === "COMPLETED")
                    .map((w) => ({
                        provider: "groq" as const,
                        model: w.model,
                        inputTokens: w.inputTokens || 0,
                        outputTokens: w.outputTokens || 0,
                        endpoint: "/api/simcar/clip/analyze-auas",
                    }));
                if (outcome.auasMeta.report.model === "deepseek-v4-pro") {
                    usageInputs.push({
                        provider: "groq" as const,
                        model: "deepseek-v4-pro",
                        inputTokens: 0,
                        outputTokens: 0,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        estimated: true,
                    });
                }
            }
            return outcome;
        });

        if (!result) {
            if (billingReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: billingRequestId,
                    amountBrl: billingReserved,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reason: "analysis_failed_before_usage",
                });
                billingReserved = 0;
            }
            finishJob({ jobId: processingJobId, status: "failed", error: "auas_v2_analysis_failed" });
            return;
        }

        const billing = await settleReservedCredits({
            uid,
            requestId: billingRequestId,
            endpoint: "/api/simcar/clip/analyze-auas",
            reservedBrl: billingReserved,
            usageInputs,
        });
        billingReserved = 0;
        chargedBrl = Number(billing.chargedBrl || 0);
        sendSSE(res, { type: "billing", billing });

        await persistSimcarClipArtifacts({
            uid,
            jobId,
            patch: {
                auasAnalysisImages: [],
                auasAnalysisMessages: [{ role: "ai", text: result.auasMeta.report.markdown, images: [] }],
                auasMeta: result.auasMeta,
            },
        });

        let reportArtifact: SimcarReportArtifact | undefined;
        try {
            sendSSE(res, { type: "progress", step: "generating_report", percent: 99, message: "Gerando PDF técnico da análise..." });
            reportArtifact = await generateAndPersistSimcarReport({
                uid,
                jobId,
                contextUrl,
                outputZipUrl,
                auasText: result.auasMeta.report.markdown,
                auasImages: [],
                auasMeta: result.auasMeta,
                phase: "PRE_2008",
            });
        } catch (reportErr: any) {
            console.warn("[SIMCAR REPORT] AUAS V2 report generation failed:", reportErr?.message || reportErr);
            sendSSE(res, { type: "report_error", message: reportErr?.message || "Falha ao gerar PDF técnico." });
        }

        finishJob({
            jobId: processingJobId,
            status: "completed",
            billingSummary: { chargedBrl: Number(chargedBrl.toFixed(4)) },
        });

        sendSSE(res, {
            type: "complete",
            percent: 100,
            analysis: result.auasMeta.report.markdown,
            images: [],
            layerSummaries: result.layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
            auasAreaHa: result.auasMeta.summary.totalAuasAreaHa,
            auasMeta: result.auasMeta,
            ...(reportArtifact || {}),
        });
    } catch (err: any) {
        if (err instanceof ClientAbortError) {
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        reason: "client_abort_without_usage",
                    });
                    billingReserved = 0;
                    const cancelFloor = await applyCancelFloorDebit({
                        uid: billingUid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        chargedBrl,
                    });
                    chargedBrl = cancelFloor.finalChargedBrl;
                } catch (billingErr) {
                    console.error("[AUAS V2 ANALYSIS] client-abort billing error:", billingErr);
                }
            }
            finishJob({
                jobId: processingJobId,
                status: "cancelled",
                billingSummary: { chargedBrl: Number(chargedBrl.toFixed(4)) },
                error: "cancel_requested",
            });
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
                console.error("[AUAS V2 ANALYSIS] refund error:", refundErr);
            }
        }
        if (err instanceof BillingError) {
            finishJob({ jobId: processingJobId, status: "failed", error: err.message });
            if (!res.headersSent) {
                res.status(err.statusCode).json({ error: err.message, code: err.code });
            } else {
                sendSSE(res, { type: "error", message: err.message, code: err.code });
            }
            return;
        }
        console.error("[AUAS V2 ANALYSIS] Unexpected error:", err);
        finishJob({ jobId: processingJobId, status: "failed", error: err?.message || "unexpected_error" });
        if (res.headersSent) {
            sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
        } else {
            res.status(500).json({ error: err.message || "Erro interno inesperado." });
        }
    } finally {
        if (sseHeartbeat) clearInterval(sseHeartbeat);
        if (!res.writableEnded) res.end();
    }
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
    const paddedBbox = buildRenderBbox(bbox!, 0.10);

    // Dynamic resolution based on property size
    const areaHa = job.areaHa ?? 0;
    const { width: IMG_W, height: IMG_H } = calculateDynamicResolution(areaHa, paddedBbox);
    console.log(`[SIMCAR ANALYSIS] Dynamic resolution: ${IMG_W}×${IMG_H} for ${areaHa.toFixed(1)} ha property`);

    // Simplify geometries for overlay if complex
    const rawLayerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map(g => simplifyGeometryForOverlay(g, 1200)));
    }

    const images: Array<{ dataUrl: string; caption: string }> = [];
    const usedKeys: string[] = [];
    const missingKeys: string[] = [];
    const cloudWarnings: Array<{ satellite: string; cloudScore: number }> = [];

    const validKeys = getOrderedSatelliteKeys(selectedLayers);

    const totalSteps = validKeys.length;
    let step = 0;

    for (const key of validKeys) {
        throwIfClientDisconnected(res);
        const sat = SATELLITE_LAYERS[key];
        if (!sat) { step++; continue; }
        const frame = buildSatelliteSceneFrame(key, areaHa, bbox!, paddedBbox, IMG_W, IMG_H);
        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `Baixando imagem ${sat.label}...`,
        });

        const resolved = await fetchSatelliteImage(key, sat, frame.bbox, frame.width, frame.height, "SIMCAR ANALYSIS");
        throwIfClientDisconnected(res);
        const basePng = resolved?.png || null;
        const provenance = resolved?.provenance || "";

        if (!basePng) {
            missingKeys.push(key);
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponivel, pulando...`,
            });
            step += 1;
            continue;
        }
        usedKeys.push(key);

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

        // 1 composite per satellite — all layers + legend
        const compositeLayers: Array<{ name: string; stroke: string; fill: string; strokeWidth: number }> = [
            { name: "AREA_CONSOLIDADA", stroke: "#FF00FF", fill: "rgba(255,0,255,0.12)", strokeWidth: 3.5 }, // Neon Magenta
            { name: "AVN", stroke: "#00FFFF", fill: "rgba(0,255,255,0.12)", strokeWidth: 3.5 }, // Neon Cyan
            { name: "AUAS", stroke: "#FF5500", fill: "rgba(255,85,0,0.12)", strokeWidth: 2.5 }, // Neon Orange
        ];
        // Add ARL/ARLREM overlay if present
        if (layerGeos.has("ARL") || layerGeos.has("ARLREM")) {
            compositeLayers.push({ name: "ARL", stroke: "#00FF00", fill: "rgba(0,255,0,0.12)", strokeWidth: 2.5 }); // Neon Green
            compositeLayers.push({ name: "ARLREM", stroke: "#32CD32", fill: "rgba(50,205,50,0.12)", strokeWidth: 2.5 });
        }
        const compositeSvg = buildPolygonOverlaySvg(frame.width, frame.height, frame.bbox, propertyPolygon!, layerGeos, compositeLayers);
        const hasArl = layerGeos.has("ARL") || layerGeos.has("ARLREM");
        // ⚠️ A proveniência é SUFIXO, nunca prefixo: `selectPrincipalReportImages`
        // e `reduceImageSet` ordenam lendo o começo da legenda (SPOT, ano). Mexer
        // na frente da string quebra a seleção do anexo em silêncio — já custou o
        // SPOT 2008 sumir de um laudo (CHANGELOG_2026-08-21_ANEXO_SPOT_SUMIA.md).
        images.push({
            dataUrl: await compositeOverlay(basePng, compositeSvg),
            caption: `${sat.label} — Visão Geral (AC + AVN + AUAS${hasArl ? " + ARL" : ""})`
                + (provenance ? ` · ${provenance}` : ""),
        });
        step++;
    }

    return { images, usedKeys, missingKeys, cloudWarnings, resolution: { width: IMG_W, height: IMG_H } };
}

/**
 * Core satellite image + AI analysis pipeline.
 * Generates images, uploads to Cloudinary, runs the full AC/AVN analysis, and
 * returns the result. Sends intermediate SSE events (progress, model_thinking, error)
 * but does NOT send the final complete/result event — the caller is responsible.
 *
 * @returns AcAvnAnalysisResult or null if a fatal error occurred (error SSE was already sent).
 */
/**
 * Gera a imagem de DESTAQUE do achado "área consolidada dentro da AVN":
 * zoom no trecho da interseção AC∩AVN (ou na AVN), no satélite de maior peso
 * (SPOT 2008 se usado), para vir como PRIMEIRA figura do anexo do laudo.
 * Retorna null se o achado não tiver suporte geométrico/WMS utilizável —
 * nunca falha a análise (o chamador trata como não-fatal).
 */
export async function buildAvnHighlightImage(
    res: Response,
    job: CachedJob,
    usedKeys: string[],
): Promise<{ dataUrl: string; caption: string } | null> {
    const acFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AREA_CONSOLIDADA");
    const avnFeature = mergeLayerGeometriesAsFeature(job.clippedGeometries, "AVN");
    if (!acFeature || !avnFeature) return null;

    // Bbox do foco: interseção AC∩AVN quando existir; senão a própria AVN.
    let focusBbox: [number, number, number, number];
    try {
        const overlap = turfIntersect(
            turfFeatureCollection([acFeature, avnFeature]) as FeatureCollection<Polygon | MultiPolygon>,
        ) as Feature<Polygon | MultiPolygon> | null;
        focusBbox = overlap
            ? (turfBbox(overlap) as [number, number, number, number])
            : (turfBbox(avnFeature) as [number, number, number, number]);
    } catch {
        focusBbox = turfBbox(avnFeature) as [number, number, number, number];
    }
    const zoomBbox = normalizeRenderBboxAspect(padBbox(focusBbox, 0.12), 2.5);
    const areaHa = job.areaHa ?? 0;
    const baseRes = calculateDynamicResolution(areaHa, zoomBbox);
    const width = Math.max(baseRes.width, 900);
    const height = Math.max(baseRes.height, 600);

    // Satélite de maior peso probatório: SPOT 2008 (marco 22/07/2008) se usado; senão o primeiro.
    const key = (usedKeys.includes("spot_2008") ? "spot_2008" : usedKeys[0]);
    if (!key) return null;
    const sat = SATELLITE_LAYERS[key];
    if (!sat) return null;

    sendSSE(res, {
        type: "progress",
        step: "generating_images",
        percent: 61,
        message: "Gerando destaque do achado AVN (área consolidada dentro do polígono AVN)...",
    });
    const resolved = await fetchSatelliteImage(key, sat, zoomBbox, width, height, "SIMCAR ANALYSIS");
    if (!resolved?.png) return null;

    // Overlay só com AC + AVN + propriedade, no zoom do trecho destacado.
    const rawLayerGeos: Map<string, Geometry[]> = job.clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map((g: Geometry) => simplifyGeometryForOverlay(g, 1200)));
    }
    const svg = buildPolygonOverlaySvg(width, height, zoomBbox, job.polygon!, layerGeos, [
        { name: "AREA_CONSOLIDADA", stroke: "#FF00FF", fill: "rgba(255,0,255,0.12)", strokeWidth: 3.5 },
        { name: "AVN", stroke: "#00FFFF", fill: "rgba(0,255,255,0.12)", strokeWidth: 4 },
    ]);
    const dataUrl = await compositeOverlay(resolved.png, svg);
    const provenance = resolved.provenance ? ` · ${resolved.provenance}` : "";
    return {
        dataUrl,
        // A substring "Destaque AVN" garante peso -1 no anexo (reportImageWeight);
        // o rótulo do satélite fica no início para a leitura por sensor continuar funcionando.
        caption: `${sat.label} — Destaque AVN (Área Consolidada dentro do polígono AVN)${provenance}`,
    };
}

/**
 * Gera a imagem de DESTAQUE do(s) reservatório(s) artificial(is) do recorte:
 * zoom no bbox do reservatório (ou no imóvel inteiro se o reservatório for
 * pontual demais), na cena de maior peso (SPOT 2008), com overlay
 * AC+AUAS+RESERVATÓRIO+propriedade — vira a PRIMEIRA figura do anexo quando o
 * laudo tem reservatório, deixando explícita a lâmina d'água (regressão real:
 * Lote 81, 21/08/2026 — a visão confundiu reservatório com "uso na AVN").
 */
export async function buildReservoirHighlightImage(
    res: Response,
    job: CachedJob,
    usedKeys: string[],
): Promise<{ dataUrl: string; caption: string } | null> {
    const reservoirGeoms = job.clippedGeometries?.get("RESERVATORIO_ARTIFICIAL") || [];
    if (reservoirGeoms.length === 0) return null;

    // Bbox do reservatório com padding. Se o reservatório for menor que ~0,5 ha
    // (pontual), expande para caber um contexto útil da propriedade.
    const feats: number[][] = [];
    for (const g of reservoirGeoms) {
        if (g.type === "Polygon") { for (const ring of g.coordinates) for (const c of ring) feats.push(c); }
        else if (g.type === "MultiPolygon") { for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) feats.push(c); }
    }
    if (feats.length === 0) return null;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of feats) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    let focusBbox: [number, number, number, number] = [minX, minY, maxX, maxY];
    const wSpan = maxX - minX, hSpan = maxY - minY;
    const isTiny = wSpan < 0.003 || hSpan < 0.003; // ~ <300m de lado em graus
    if (isTiny) {
        // Expande para o imóvel inteiro, preservando o contexto.
        const polyGeom = job.polygon?.geometry;
        const pFeats: number[][] = [];
        if (polyGeom?.type === "Polygon") for (const ring of polyGeom.coordinates) for (const c of ring) pFeats.push(c);
        else if (polyGeom?.type === "MultiPolygon") for (const gp of polyGeom.coordinates) for (const ring of gp) for (const c of ring) pFeats.push(c);
        if (pFeats.length > 0) {
            let [px, py, qx, qy] = [Infinity, Infinity, -Infinity, -Infinity];
            for (const [x, y] of pFeats) { px = Math.min(px, x); py = Math.min(py, y); qx = Math.max(qx, x); qy = Math.max(qy, y); }
            focusBbox = [px, py, qx, qy];
        }
    }
    const zoomBbox = normalizeRenderBboxAspect(padBbox(focusBbox, 0.12), 2.5);
    const areaHa = job.areaHa ?? 0;
    const baseRes = calculateDynamicResolution(areaHa, zoomBbox);
    const width = Math.max(baseRes.width, 900);
    const height = Math.max(baseRes.height, 600);

    const key = (usedKeys.includes("spot_2008") ? "spot_2008" : usedKeys[0]);
    if (!key) return null;
    const sat = SATELLITE_LAYERS[key];
    if (!sat) return null;

    sendSSE(res, {
        type: "progress",
        step: "generating_images",
        percent: 61,
        message: "Gerando destaque visual dos reservatórios artificiais do recorte...",
    });
    const resolved = await fetchSatelliteImage(key, sat, zoomBbox, width, height, "SIMCAR ANALYSIS");
    if (!resolved?.png) return null;

    const rawLayerGeos: Map<string, Geometry[]> = job.clippedGeometries ?? new Map<string, Geometry[]>();
    const layerGeos = new Map<string, Geometry[]>();
    for (const [name, geoms] of rawLayerGeos) {
        layerGeos.set(name, geoms.map((g: Geometry) => simplifyGeometryForOverlay(g, 1200)));
    }
    const svg = buildPolygonOverlaySvg(width, height, zoomBbox, job.polygon!, layerGeos, [
        { name: "RESERVATORIO_ARTIFICIAL", stroke: "#0044FF", fill: "rgba(0,0,255,0.35)", strokeWidth: 4 },
        { name: "AREA_CONSOLIDADA", stroke: "#FF00FF", fill: "rgba(255,0,255,0.12)", strokeWidth: 3.5 },
        { name: "AUAS", stroke: "#FFA500", fill: "rgba(255,165,0,0.14)", strokeWidth: 3.5 },
        { name: "AVN", stroke: "#00FFFF", fill: "rgba(0,255,255,0.14)", strokeWidth: 3.5 },
    ]);
    const dataUrl = await compositeOverlay(resolved.png, svg);
    const provenance = resolved.provenance ? ` · ${resolved.provenance}` : "";
    return {
        dataUrl,
        // "Destaque Reservatório" também recebe peso -1 no anexo (reportImageWeight)
        // para vir antes das demais cenas; o rótulo do satélite fica no início.
        caption: `${sat.label} — Destaque Reservatório Artificial (lâmina d'água do recorte)${provenance}`,
    };
}

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
    let cloudinaryStoredBytes = 0;
    try {
        for (let i = 0; i < imagesToAnalyze!.length; i++) {
            throwIfClientDisconnected(res);
            const img = imagesToAnalyze![i];
            const filename = `simcar_analysis_${tag}_img${i + 1}`;
            const url = await uploadToCloudinary(img.dataUrl, filename, job.uid || "anonymous");
            cloudinaryUrls.push({ url, caption: img.caption });
            cloudinaryStoredBytes += estimateBytesFromDataUrl(img.dataUrl);
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
            cloudinaryStoredBytes,
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
                caption: cu.caption,
            });
        }
        console.log(`[SIMCAR ANALYSIS] Using ${aiImages.length} Cloudinary URLs (1024x768 q80) for vision API`);
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
                const result = await analyzeImagesWithVision(satImages, prompt, `${sat.label} (${sat.year})`);
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
                analysisText = await analyzeImagesWithVision(aiImages, prompt, "Analise unificada multitemporal");
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
            analysisText = await analyzeImagesWithVision(aiImages, prompt, singleContext || "Analise de um unico satelite");
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

    // ─── Conferência geométrica do achado AVN ────────────────────────────────
    // A visão pode confundir reservatório/água com "uso consolidado dentro da
    // AVN" (falso positivo). Medimos AC∩AVN e AVN∩reservatório no shape real:
    // se a IA diz SIM mas não há sobreposição geométrica, o achado é rebaixado
    // para INCONCLUSIVO com nota explicativa — e o destaque não entra.
    const geometryCrossCheck = computeAcAvnGeometryCrossCheck(job);
    if (geometryCrossCheck) {
        normalizedAcAvn.meta.geometryCrossCheck = geometryCrossCheck;
        const avnVerdict = normalizedAcAvn.meta.globalVerdict?.avnDentroShapeAntropizado;
        const noGeometricOverlap =
            geometryCrossCheck.acAvnOverlapHa <= 0.0001 && geometryCrossCheck.avnAreaHa > 0.0001;
        if (avnVerdict === "SIM" && noGeometricOverlap) {
            console.warn(
                "[SIMCAR ANALYSIS] Achado visual AVN sem suporte geométrico (AC∩AVN = 0). Rebaixando para INCONCLUSIVO.",
            );
            normalizedAcAvn.meta.globalVerdict.avnDentroShapeAntropizado = "INCONCLUSIVO";
            const reservNote = geometryCrossCheck.hasReservatorioLayer && geometryCrossCheck.reservatorioOverlapAvnHa > 0.0001
                ? `Há ${geometryCrossCheck.reservatorioOverlapAvnHa.toFixed(4)} ha de reservatório artificial sobreposto à AVN — a feição apontada como uso pode ser reservatório/água.`
                : "A área apontada como uso pode ser reservatório artificial, lâmina d'água ou sombra de relevo.";
            normalizedAcAvn.text += [
                "",
                "## Conferência Geométrica do Achado AVN",
                `- Interseção AC∩AVN no shape do recorte: ${geometryCrossCheck.acAvnOverlapHa.toFixed(4)} ha.`,
                `- AVN total: ${geometryCrossCheck.avnAreaHa.toFixed(4)} ha | AC total: ${geometryCrossCheck.acAreaHa.toFixed(4)} ha.`,
                `- ${reservNote}`,
                "- Veredito visual rebaixado para INCONCLUSIVO: sem suporte geométrico de sobreposição AC∩AVN; revisão manual do setor recomendada.",
            ].join("\n");
            sendSSE(res, {
                type: "progress",
                step: "finalizing",
                percent: 97,
                message: "Conferência geométrica: achado visual AVN sem suporte no shape — rebaixado para inconclusivo.",
            });
        }
    }

    // ─── Reservatórios artificiais: narrativa explícita ──────────────────────
    // O encarte digital do CAR não soma a lâmina d'água à área consolidada/AUAS
    // automaticamente. Medimos e declaramos no laudo: área total, nº de feições,
    // sobreposição com AC/AUAS/AVN e o enquadramento legal (Lei 12.651/2012).
    const reservoirAnalysis = computeReservoirAnalysis(job, areaHa);
    if (reservoirAnalysis.hasReservoir) {
        normalizedAcAvn.meta.reservoirAnalysis = reservoirAnalysis;
        normalizedAcAvn.text += [
            "",
            "## Reservatórios Artificiais — Enquadramento Legal",
            `- ${reservoirAnalysis.totalFeatures} feição(ões), total de ${reservoirAnalysis.totalAreaHa.toFixed(4)} ha (${reservoirAnalysis.pctOfProperty.toFixed(2)}% do imóvel).`,
            `- Sobre AC declarada: ${reservoirAnalysis.overlapAcHa.toFixed(4)} ha | Sobre AUAS declarada: ${reservoirAnalysis.overlapAuasHa.toFixed(4)} ha | Sobre AVN: ${reservoirAnalysis.overlapAvnHa.toFixed(4)} ha | Fora de camada declarada: ${reservoirAnalysis.outsideDeclaredHa.toFixed(4)} ha.`,
            "- Lei 12.651/2012, art. 4º, III e §1º: reservatório artificial que NÃO decorre de barramento/represamento de curso d'água natural NÃO gera APP de entorno — a lâmina d'água enquadra-se como uso antrópico (área consolidada/AUAS).",
            "- Art. 4º, §4º: acumulações naturais ou artificiais com superfície inferior a 1 ha ficam dispensadas da faixa de APP de entorno (vedada nova supressão de vegetação nativa).",
            "- Manual de Elaboração do Projeto Geográfico do SIMCAR (SEMA-MT, atual. 07/11/2018), seção 8.9: 'AUAS – Área de Uso ANTROPIZADO do Solo: áreas cujas características originais (solo, vegetação, relevo e regime hídrico) foram alteradas por consequência de atividade humana' (estradas, lavouras, mineração) — a lâmina d'água de reservatório sem barramento enquadra-se nessa categoria.",
            "- Manual do SIMCAR, seção 8.14: 'São reservatórios d'água artificiais, decorrentes de barramento ou represamento de cursos d'água naturais dentro do imóvel' — e o Anexo 01 (Validações GEO) marca sobreposição de ÁREA INUNDADA com AUAS/AVN/AREA CONSOLIDADA como VALIDAÇÃO IMPEDITIVA.",
            "- Lei 12.651/2012, art. 4º, §1º e §4º + Decreto 7.830/2012: reservatório artificial sem barramento não é APP de entorno; acumulação < 1 ha dispensa faixa de APP.",
            "- O encarte digital do CAR, de onde o recorte é extraído, NÃO transfere automaticamente a lâmina d'água para a área consolidada/AUAS — a validação impeditiva do SIMCAR impede a sobreposição, então a adequação do perímetro no CAR/SIMCAR deve ser feita pelo responsável técnico.",
            "- Recomendação: conferir a titularidade/outorga do reservatório e o cruzamento com a área consolidada declarada; ajustar o shape do CAR se a lâmina estiver sobre uso consolidado/AUAS não declarado.",
        ].join("\n");
    }

    // ─── Destaque do achado "área consolidada dentro da AVN" ────────────────
    // Quando a IA confirma o achado (avnDentroShapeAntropizado = SIM), gera uma
    // imagem em zoom no trecho AC∩AVN e a insere como PRIMEIRA figura no anexo.
    // Fallback silencioso: se o WMS falhar, o laudo segue com as cenas normais.
    if (normalizedAcAvn.meta?.globalVerdict?.avnDentroShapeAntropizado === "SIM") {
        try {
            const highlight = await buildAvnHighlightImage(res, job, usedSatelliteKeys);
            if (highlight) {
                const url = await uploadToCloudinary(
                    highlight.dataUrl,
                    `simcar_analysis_${tag}_destaque_avn`,
                    job.uid || "anonymous",
                );
                cloudinaryUrls.unshift({ url, caption: highlight.caption });
                cloudinaryStoredBytes += estimateBytesFromDataUrl(highlight.dataUrl);
                console.log(`[SIMCAR ANALYSIS] Destaque AVN adicionado como primeira figura: ${url}`);
                sendSSE(res, {
                    type: "progress",
                    step: "finalizing",
                    percent: 97,
                    message: "Destaque do achado AVN anexado ao laudo.",
                });
            }
        } catch (highlightErr: any) {
            console.warn("[SIMCAR ANALYSIS] Destaque AVN não gerado (não-fatal):", highlightErr?.message || highlightErr);
        }
    }

    // ─── Destaque dos reservatórios artificiais ──────────────────────────────
    // Quando o recorte tem reservatório artificial, gera uma imagem em zoom na
    // lâmina d'água e a insere como PRIMEIRA figura do anexo (peso -1 no
    // report). Deixa explícita a realidade física que a visão pode confundir
    // com "uso consolidado dentro da AVN" (regressão real Lote 81).
    if (reservoirAnalysis.hasReservoir) {
        try {
            const reservHighlight = await buildReservoirHighlightImage(res, job, usedSatelliteKeys);
            if (reservHighlight) {
                const url = await uploadToCloudinary(
                    reservHighlight.dataUrl,
                    `simcar_analysis_${tag}_destaque_reservatorio`,
                    job.uid || "anonymous",
                );
                cloudinaryUrls.unshift({ url, caption: reservHighlight.caption });
                cloudinaryStoredBytes += estimateBytesFromDataUrl(reservHighlight.dataUrl);
                console.log(`[SIMCAR ANALYSIS] Destaque Reservatório adicionado como primeira figura: ${url}`);
            }
        } catch (reservHighlightErr: any) {
            console.warn(
                "[SIMCAR ANALYSIS] Destaque Reservatório não gerado (não-fatal):",
                reservHighlightErr?.message || reservHighlightErr,
            );
        }
    }

    return {
        analysisText: normalizedAcAvn.text,
        cloudinaryUrls,
        cloudinaryStoredBytes,
        usedSatelliteKeys,
        missingSatelliteKeys,
        cloudWarnings,
        analysisMeta: normalizedAcAvn.meta,
        layerSummaries: layerSummaries!,
        imageOnly: false,
    };
}

export function sendAcAvnComplete(res: Response, result: AcAvnAnalysisResult, report?: Partial<SimcarReportArtifact>) {
    sendSSE(res, {
        type: "complete",
        percent: 100,
        ...(!result.imageOnly && { analysis: result.analysisText, analysisMeta: result.analysisMeta }),
        images: result.cloudinaryUrls,
        layerSummaries: result.layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
        analysisRulesVersion: "acavn-fixed-v5",
        satellitesUsed: result.usedSatelliteKeys,
        satellitesMissing: result.missingSatelliteKeys,
        cloudWarnings: result.cloudWarnings.length > 0 ? result.cloudWarnings : undefined,
        ...(report || {}),
    });
}

/** Main analysis pipeline (called from the SSE endpoint). */
export async function processAnalysis(
    res: Response,
    jobId: string,
    selectedLayers: string[] = ["spot_2008"],
    aiAnalysis = true,
    contextUrl?: string,
    outputZipUrl?: string,
    uid?: string,
): Promise<AcAvnAnalysisResult | null> {
    throwIfClientDisconnected(res);
    const job = await hydrateCachedJob(jobId, contextUrl, outputZipUrl, uid);
    if (!job || !job.bbox || !job.polygon || !job.layerSummaries) {
        sendSSE(res, {
            type: "error",
            message:
                "Job não encontrado. O servidor não localizou contexto ou ZIP persistido para reidratar o recorte.",
        });
        return null;
    }

    const result = await runAcAvnSatelliteAnalysis(res, job, selectedLayers, { tag: jobId.slice(0, 8), aiAnalysis });
    if (!result) return null;

    return result;
}

export function buildEstimatedUsageForFallback(args: {
    endpoint: string;
    model?: string;
    provider: "groq";
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

export async function attachOptionalAuth(req: Request, _res: Response, next: any) {
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
