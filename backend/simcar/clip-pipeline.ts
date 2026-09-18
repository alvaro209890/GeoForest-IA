/**
 * Clip Pipeline — orquestrador do recorte SIMCAR: SSE helpers, job cache,
 * leitura WFS, clip de feições e geração do ZIP de saída.
 *
 * Extraído de simcar-clip.ts (Plano 02, Fase 4e).
 */

import type { Response } from "express";
import archiver from "archiver";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
    area as turfArea,
    featureCollection as turfFeatureCollection,
    intersect as turfIntersect,
    polygon as turfPolygon,
    multiPolygon as turfMultiPolygon,
    buffer as turfBuffer,
} from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    Geometry,
    MultiPolygon,
    Polygon,
} from "geojson";
import { isCancelRequested } from "../processing-jobs";
import {
  polygonToWkt,
  normalizePolygonGeometry,
  toPolygonOrMultiFeature,
} from "../wfs-intersection";
import { fetchSigefBoundaryByParcelCode, SIGEF_WFS_TIMEOUT_MS } from "../sigef-client";
import {
    buildShpAndShx,
    buildPointShpAndShx,
    buildDbfBuffer,
    geojsonToPolyRecords,
    type DbfFieldDef,
    type ShpRecord,
} from "../shapefile-writer";
import { extractZipEntries } from "../geo-utils";
import { buildDirectCopyLayerRecords } from "./air-atp-generator";
import {
    uploadBufferToCloudinary,
    uploadRawBufferToCloudinary,
} from "./cloudinary";
import {
    CACHE_CLEANUP_INTERVAL,
    CACHE_MAX_JOBS,
    CACHE_TTL_MS,
    DIRECT_COPY_LAYERS,
    MODELO_ZIP_PATH,
    RIVER_CLIP_EXTENSION_METERS,
    RIVER_CLIP_LAYERS,
    SPRING_LAYER_NAME,
    TEMPLATE_LAYERS,
    WHOLE_FEATURE_BUFFER_LAYERS,
} from "./constants";
import {
    readTemplateSchemas,
    mapAttributes,
    applyLayerAttributeRules,
} from "./attribute-mapper";
import {
    computeAreaHa,
    isPointOrMultiPoint,
    pointInsideAnyPolygon,
    extractPointCoords,
} from "./polygon-ops";
import {
    parseUserShapefile,
    featureBbox,
} from "./shapefile-io";
import { buildQuantitativeXlsx, appendLayerWarning, dedupeWarnings } from "./area-calculator";
import { fetchCarBoundaryByNumber } from "./car-lookup";
import {
    fetchCompleteSimcarSnapshotLayer,
    loadSimcarSnapshotLayerMapping,
    SimcarSnapshotSourceError,
} from "./sema-wfs-source";
import { isExcludedExportEntry, isExcludedFromExport, toPublicApiUrl } from "./constants";
import { snapClippedGeometryToBoundary } from "../simcar-clip-snap";
import {
    CoverageTopologyError,
    LAND_COVER_LAYERS,
    layerPolygonGeometries,
    validateOfficialCoverage,
    type CoverageTopologyStats,
} from "./coverage-topology";
import { buildTopologyAnomaliesZip } from "./topology-zip";
import { clipOfficialFeaturesExactly, ExactClipError } from "./exact-clip";
import type { CachedJob, ClipResult, ClippedPointResult, ClippedPolygonResult, LayerSummary, PersistedClipContextV1, WfsClipFetchResult, WfsFeature } from "./types";

export type { CachedJob, ClipResult, ClippedPointResult, ClippedPolygonResult, LayerSummary, PersistedClipContextV1, WfsClipFetchResult, WfsFeature };

/* ─── Job Cache ─────────────────────────────────────── */

export const jobCache = new Map<string, CachedJob>();

export function pruneJobCache(): void {
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

/* ─── Client Abort ──────────────────────────────────── */

export class ClientAbortError extends Error {
    constructor(message = "Cliente desconectou durante a análise.") {
        super(message);
        this.name = "ClientAbortError";
    }
}

/* ─── SSE Connection ────────────────────────────────── */

export function isSseConnectionClosed(res: Response): boolean {
    const anyRes = res as any;
    return Boolean(
        res.writableEnded ||
        res.destroyed ||
        anyRes?.writableAborted ||
        anyRes?.socket?.destroyed,
    );
}

export function throwIfClientDisconnected(res: Response): void {
    const jobId = String((res as any).__processingJobId || "").trim();
    if (jobId && isCancelRequested(jobId)) {
        throw new ClientAbortError("Cancelamento solicitado pelo usuário.");
    }
    if (isSseConnectionClosed(res)) {
        throw new ClientAbortError("Cliente desconectou.");
    }
}

/* ─── SSE Write ─────────────────────────────────────── */

export function sendSSE(res: Response, data: Record<string, unknown>): void {
    if (isSseConnectionClosed(res)) return;
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
        return;
    }
    if (typeof (res as any).flush === "function") (res as any).flush();
}

export function startSseHeartbeat(
    res: Response,
    intervalMs = 15_000,
): ReturnType<typeof setInterval> {
    return setInterval(() => {
        if (isSseConnectionClosed(res)) return;
        try {
            res.write(": heartbeat\n\n");
            if (typeof (res as any).flush === "function") (res as any).flush();
        } catch {
            // The route finally block will close the interval.
        }
    }, intervalMs);
}

/* ─── Utilities ─────────────────────────────────────── */

export function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function orderLayersForRiverTopology(layerNames: string[]): string[] {
    const priority = (layerName: string) => {
        if (DIRECT_COPY_LAYERS.has(layerName)) return 0;
        if (RIVER_CLIP_LAYERS.has(layerName)) return 1;
        return 2;
    };
    return layerNames
        .map((layerName, index) => ({ layerName, index }))
        .sort((left, right) => priority(left.layerName) - priority(right.layerName) || left.index - right.index)
        .map(({ layerName }) => layerName);
}

export function clipFeaturesToPolygon(
    features: WfsFeature[],
    userPolygons:
        | Feature<Polygon | MultiPolygon>
        | Array<Feature<Polygon | MultiPolygon>>,
    options: {
        pointClipPolygons?: Array<Feature<Polygon | MultiPolygon>>;
        /** Snap opcional dos recortes na divisa. O padrão 0 preserva a geometria oficial do WFS. */
        snapToleranceMeters?: number;
    } = {},
): ClipResult[] {
    const clipped: ClipResult[] = [];
    // Cada polígono do imóvel é recortado separadamente (sem unir as feições).
    // Assim, uma feição WFS que cruza a divisa entre dois lotes gera uma peça
    // independente para cada lote, todas reunidas no mesmo shapefile de saída.
    const clipPolygons = Array.isArray(userPolygons) ? userPolygons : [userPolygons];
    const pointClipPolygons = options.pointClipPolygons?.length
        ? options.pointClipPolygons
        : clipPolygons;
    // O recorte oficial precisa manter a topologia recebida do WFS. O antigo
    // padrão de 1,5 m expandia AVN/Área Consolidada sobre rios próximos à
    // divisa do imóvel, criando sobreposições que não existem no WMS.
    const snapTol = options.snapToleranceMeters ?? 0;

    for (const feature of features) {
        if (!feature.geometry) continue;

        // Caso 1: geometria poligonal — interseção contra cada lote separadamente
        const polygonLike = toPolygonOrMultiFeature(feature.geometry);
        if (polygonLike) {
            for (const clipPolygon of clipPolygons) {
                try {
                    const fc = turfFeatureCollection([clipPolygon, polygonLike]) as FeatureCollection<Polygon | MultiPolygon>;
                    const intersection = turfIntersect(fc);
                    if (intersection && intersection.geometry) {
                        const snapped = snapTol > 0
                            ? snapClippedGeometryToBoundary(intersection.geometry, clipPolygon, snapTol)
                            : null;
                        clipped.push({
                            kind: "polygon",
                            geometry: snapped ?? intersection.geometry,
                            properties: feature.properties,
                        });
                    }
                } catch {
                    // Skip features that fail intersection
                }
            }
            continue;
        }

        // Caso 2: geometria de ponto (ex: nascentes) — verifica se está dentro do polígono
        if (!isPointOrMultiPoint(feature.geometry)) continue;

        const coords = extractPointCoords(feature.geometry);
        if (!coords || !coords.length) continue;

        const insideCoords: Array<[number, number]> = [];
        for (const coord of coords) {
            if (pointInsideAnyPolygon(coord, pointClipPolygons)) {
                insideCoords.push(coord);
            }
        }

        if (insideCoords.length > 0) {
            clipped.push({
                kind: "point",
                pointCoords: insideCoords,
                properties: feature.properties,
            });
        }
    }

    return clipped;
}

/**
 * Seleciona feições poligonais que TOCAM a fronteira informada (a fronteira já
 * vem expandida com o buffer dos rios), mas devolve a geometria ORIGINAL inteira,
 * sem recortar. Usado para reservatórios artificiais: se o reservatório está
 * dentro do buffer de 500m da ATP, ele entra completo no shapefile de saída,
 * ainda que parte dele fique fora da ATP.
 */
function selectWholeFeaturesIntersecting(
    features: WfsFeature[],
    boundary: Feature<Polygon | MultiPolygon>,
): ClipResult[] {
    const selected: ClipResult[] = [];
    for (const feature of features) {
        if (!feature.geometry) continue;
        const polygonLike = toPolygonOrMultiFeature(feature.geometry);
        if (!polygonLike) continue;
        try {
            const fc = turfFeatureCollection([boundary, polygonLike]) as FeatureCollection<Polygon | MultiPolygon>;
            const intersection = turfIntersect(fc);
            if (intersection && intersection.geometry) {
                selected.push({
                    kind: "polygon",
                    // Geometria inteira — NÃO usa a interseção, preserva o reservatório completo.
                    geometry: polygonLike.geometry,
                    properties: feature.properties,
                });
            }
        } catch {
            // Ignora feições que falham na verificação de interseção
        }
    }
    return selected;
}

/* ─── Attribute Mapping ──────────────────────────────────────── */

/* ─── ZIP Output Builder ─────────────────────────────────────── */

async function buildOutputZip(
    templateEntries: Array<{ name: string; data: Buffer }>,
    clippedLayers: Map<string, { records: ShpRecord[]; fieldDefs: DbfFieldDef[] }>,
    clippedPointLayers: Map<string, { records: Array<{ coordinates: [number, number]; attributes: Record<string, string | number | null> }>; fieldDefs: DbfFieldDef[] }>,
    prjBuffers: Map<string, Buffer>,
    xlsxBuffer?: Buffer,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 6 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve(Buffer.concat(chunks)));

        // Find directory prefix helper
        function getDirPrefix(upper: string): string {
            for (const entry of templateEntries) {
                const entryBase = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
                if (entryBase === upper) {
                    const dir = path.dirname(entry.name);
                    return dir === "." ? "" : `${dir}/`;
                }
            }
            return "";
        }

        const handledFiles = new Set<string>();

        // Add polygon layers (original behavior)
        for (const [layerName, layerData] of clippedLayers) {
            if (isExcludedFromExport(layerName)) continue;
            const upper = layerName.toUpperCase();
            const prefix = getDirPrefix(upper);
            const { shp, shx } = buildShpAndShx(layerData.records, 5);
            const dbf = buildDbfBuffer(
                layerData.records.map((r) => r.attributes),
                layerData.fieldDefs,
            );

            archive.append(shp, { name: `${prefix}${upper}.shp` });
            archive.append(shx, { name: `${prefix}${upper}.shx` });
            archive.append(dbf, { name: `${prefix}${upper}.dbf` });
            handledFiles.add(`${prefix}${upper}.shp`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.shx`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.dbf`.toLowerCase());

            const prjBuf = prjBuffers.get(upper);
            if (prjBuf) {
                archive.append(prjBuf, { name: `${prefix}${upper}.prj` });
                handledFiles.add(`${prefix}${upper}.prj`.toLowerCase());
            }
        }

        // Add point layers (ex: NASCENTE)
        for (const [layerName, layerData] of clippedPointLayers) {
            if (isExcludedFromExport(layerName)) continue;
            const upper = layerName.toUpperCase();
            const prefix = getDirPrefix(upper);

            const pointRecords = layerData.records.map((r) => ({
                coordinates: r.coordinates,
                attributes: r.attributes,
            }));

            const { shp, shx } = buildPointShpAndShx(pointRecords, 1);
            const dbf = buildDbfBuffer(
                layerData.records.map((r) => r.attributes),
                layerData.fieldDefs,
            );

            archive.append(shp, { name: `${prefix}${upper}.shp` });
            archive.append(shx, { name: `${prefix}${upper}.shx` });
            archive.append(dbf, { name: `${prefix}${upper}.dbf` });
            handledFiles.add(`${prefix}${upper}.shp`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.shx`.toLowerCase());
            handledFiles.add(`${prefix}${upper}.dbf`.toLowerCase());

            const prjBuf = prjBuffers.get(upper);
            if (prjBuf) {
                archive.append(prjBuf, { name: `${prefix}${upper}.prj` });
                handledFiles.add(`${prefix}${upper}.prj`.toLowerCase());
            }
        }

        // Add remaining template files that haven't been replaced.
        // O passthrough é o motivo de a exclusão precisar existir aqui: sem
        // recorte, os arquivos VAZIOS da camada excluída entrariam mesmo assim.
        for (const entry of templateEntries) {
            if (entry.name.endsWith("/")) continue;
            if (handledFiles.has(entry.name.toLowerCase())) continue;
            if (isExcludedExportEntry(entry.name)) continue;
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

/* ─── Main Processing Pipeline ───────────────────────────────── */

export function mapToObjectGeometry(value: Map<string, Geometry[]>): Record<string, Geometry[]> {
    const out: Record<string, Geometry[]> = {};
    for (const [key, arr] of value.entries()) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        out[key] = arr;
    }
    return out;
}

export function objectToMapGeometry(value: Record<string, Geometry[]> | null | undefined): Map<string, Geometry[]> {
    const out = new Map<string, Geometry[]>();
    if (!value || typeof value !== "object") return out;
    for (const [key, arr] of Object.entries(value)) {
        if (!Array.isArray(arr)) continue;
        const cleaned = arr.filter((g) => g && typeof g === "object") as Geometry[];
        if (cleaned.length > 0) out.set(key, cleaned);
    }
    return out;
}

function getClippedRiverFeatures(
    clippedGeometries: Map<string, Geometry[]>,
): Array<Feature<Polygon | MultiPolygon>> {
    const features: Array<Feature<Polygon | MultiPolygon>> = [];
    for (const layerName of RIVER_CLIP_LAYERS) {
        const geometries = clippedGeometries.get(layerName);
        if (!geometries?.length) continue;
        for (const geometry of geometries) {
            const feature = toPolygonOrMultiFeature(geometry);
            if (feature) features.push(feature);
        }
    }
    return features;
}

function buildExpandedClipBoundary(
    feature: Feature<Polygon | MultiPolygon>,
    distanceMeters: number,
): {
    polygon: Feature<Polygon | MultiPolygon>;
    wkt: string;
    distanceMeters: number;
} {
    const fallbackGeometry = normalizePolygonGeometry(feature.geometry);
    if (!fallbackGeometry) {
        throw new Error("Geometria do imóvel não pôde ser validada para recorte.");
    }

    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        return {
            polygon: feature,
            wkt: polygonToWkt(fallbackGeometry),
            distanceMeters: 0,
        };
    }

    try {
        const buffered = turfBuffer(feature, distanceMeters, { units: "meters" });
        const bufferedGeometry = normalizePolygonGeometry(buffered?.geometry);
        if (bufferedGeometry) {
            return {
                polygon: {
                    type: "Feature",
                    properties: {},
                    geometry: bufferedGeometry,
                },
                wkt: polygonToWkt(bufferedGeometry),
                distanceMeters,
            };
        }
    } catch (error) {
        console.warn("[SIMCAR CLIP] Falha ao criar buffer de recorte para rios:", error);
    }

    return {
        polygon: feature,
        wkt: polygonToWkt(fallbackGeometry),
        distanceMeters: 0,
    };
}

export function parsePersistedClipContext(raw: unknown): PersistedClipContextV1 | null {
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
                partial: row?.partial === true,
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
        warnings: Array.isArray(data.warnings) ? dedupeWarnings(data.warnings) : undefined,
        propertySourceLayer:
            data.propertySourceLayer === "ATP" || data.propertySourceLayer === "AIR"
                ? data.propertySourceLayer
                : undefined,
    };
}

export async function processClip(
    res: Response,
    uid: string,
    propertyZip: Buffer | null,
    carNumber: string | null,
    sigefParcelCode: string | null,
    requestedLayers: string[] | null,
    airIdentificacao?: string,
    forcedJobId?: string,
): Promise<{
    ok: boolean;
    cloudinaryStoredBytes: number;
    jobId?: string;
    filename?: string;
    downloadUrl?: string;
    topologyDownloadUrl?: string;
    inputZipUrl?: string;
    outputZipUrl?: string;
    topologyZipUrl?: string;
    contextUrl?: string;
    topologyZipBuffer?: Buffer;
    summary?: {
        propertyAreaHa: number;
        crs: string;
        layersProcessed: number;
        layersWithData: number;
        totalFeaturesClipped: number;
        processingTimeMs: number;
        layers: LayerSummary[];
        warnings?: string[];
        topologyDownloadUrl?: string;
        topologyStats?: {
            gapAreaM2: number;
            landCoverOverlapAreaM2: number;
            inundatedOverlapAreaM2: number;
        };
    };
}> {
    const startTime = Date.now();
    const layerNames = requestedLayers && requestedLayers.length > 0
        ? requestedLayers.filter((l) => (TEMPLATE_LAYERS as readonly string[]).includes(l))
        : [...TEMPLATE_LAYERS];

    const processingLayerNames = layerNames;
    const total = processingLayerNames.length;
    const layerSummaries: LayerSummary[] = [];
    const jobWarnings: string[] = [];
    let totalFeaturesClipped = 0;
    throwIfClientDisconnected(res);

    // 1. Get user property boundary (via ZIP or WFS CAR)
    let userPolygon: any;
    // Lista de polígonos individuais do imóvel (lotes). O recorte WFS é feito
    // contra cada lote separadamente; `userPolygon` (unificado) só é usado para
    // bbox, área total e consulta WFS.
    let userPolygons: Feature<Polygon | MultiPolygon>[];
    let areaHa: number;

    if (sigefParcelCode) {
        sendSSE(res, { type: "progress", layer: "SIGEF", stage: `Buscando parcela certificada no WFS do INCRA (pode levar até ${Math.round(SIGEF_WFS_TIMEOUT_MS / 1000)}s)...`, percent: 2 });
        try {
            const feature = await fetchSigefBoundaryByParcelCode(sigefParcelCode);
            userPolygon = feature;
            userPolygons = [feature];
            areaHa = computeAreaHa(feature);
            sendSSE(res, { type: "progress", layer: "SIGEF", stage: `Parcela SIGEF localizada — ${areaHa.toFixed(2)} ha`, percent: 5 });
        } catch (err: any) {
            const message = err?.message || "Erro ao buscar certificação SIGEF no WFS do INCRA.";
            console.error("[SIMCAR CLIP] SIGEF boundary lookup failed:", {
                sigefParcelCode,
                message,
            });
            sendSSE(res, { type: "error", message });
            return { ok: false, cloudinaryStoredBytes: 0 };
        }
    } else if (carNumber) {
        sendSSE(res, { type: "progress", layer: "WFS", stage: "Buscando limite do CAR no SEMA WFS...", percent: 2 });
        try {
            const feature = await fetchCarBoundaryByNumber(carNumber);
            userPolygon = feature;
            userPolygons = [feature];
            areaHa = computeAreaHa(feature);
            sendSSE(res, { type: "progress", layer: "WFS", stage: `CAR localizado — ${areaHa.toFixed(2)} ha`, percent: 5 });
        } catch (err: any) {
            const message = err?.message || "Erro ao buscar CAR no WFS da SEMA.";
            console.error("[SIMCAR CLIP] CAR boundary lookup failed:", {
                carNumber,
                message,
            });
            sendSSE(res, { type: "error", message });
            return { ok: false, cloudinaryStoredBytes: 0 };
        }
    } else if (propertyZip) {
        let userResult: ReturnType<typeof parseUserShapefile>;
        try {
            userResult = parseUserShapefile(propertyZip);
        } catch (err: any) {
            sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile do imóvel." });
            return { ok: false, cloudinaryStoredBytes: 0 };
        }
        userPolygon = userResult.polygon;
        userPolygons = userResult.polygons;
        areaHa = userResult.areaHa;
    } else {
        sendSSE(res, { type: "error", message: "Nenhum limite territorial fornecido (ZIP ou CAR)." });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }
    throwIfClientDisconnected(res);

    const riverClipBoundary = buildExpandedClipBoundary(userPolygon, RIVER_CLIP_EXTENSION_METERS);
    if (riverClipBoundary.distanceMeters > 0) {
        console.log(
            `[SIMCAR CLIP] River layers will use property boundary expanded by ${riverClipBoundary.distanceMeters}m.`,
        );
    }

    // 2. Read template
    let templateEntries: Array<{ name: string; data: Buffer }>;
    try {
        const modeloBuffer = fs.readFileSync(MODELO_ZIP_PATH);
        templateEntries = extractZipEntries(modeloBuffer);
    } catch (err: any) {
        sendSSE(res, {
            type: "error",
            message: `Arquivo Modelo.zip não encontrado no servidor (${MODELO_ZIP_PATH}).`,
        });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }

    // 3. Extract template schemas and .prj files
    const templateSchemas = readTemplateSchemas(templateEntries);
    const prjBuffers = new Map<string, Buffer>();
    const templateShapeTypes = new Map<string, number>();
    for (const entry of templateEntries) {
        if (entry.name.toLowerCase().endsWith(".prj")) {
            const base = path.basename(entry.name, ".prj").toUpperCase();
            prjBuffers.set(base, entry.data);
        } else if (entry.name.toLowerCase().endsWith(".shp")) {
            const base = path.basename(entry.name, ".shp").toUpperCase();
            if (entry.data.length >= 36) {
                const shapeType = entry.data.readInt32LE(32);
                templateShapeTypes.set(base, shapeType);
            }
        }
    }
    throwIfClientDisconnected(res);

    // 4. O recorte automático usa exclusivamente o snapshot mensal oficial da
    // SEMA-MT. A base precisa estar validada, atualizada e publicada no
    // GeoServer local; não há fallback para consultas remotas ou cópias parciais.
    sendSSE(res, {
        type: "progress",
        layer: "SIMCAR Digital mensal",
        current: 0,
        total,
        status: "checking_snapshot",
    });
    let layerMapping: Map<string, string>;
    try {
        const snapshotMapping = await loadSimcarSnapshotLayerMapping(TEMPLATE_LAYERS);
        layerMapping = snapshotMapping.layers;
        console.log(
            `[SIMCAR CLIP] Snapshot ${snapshotMapping.snapshot.snapshot}: ${layerMapping.size} camadas; idade ${snapshotMapping.snapshot.ageDays.toFixed(1)} dias`,
        );
    } catch (err: any) {
        const sourceError = err instanceof SimcarSnapshotSourceError
            ? err
            : new SimcarSnapshotSourceError(
                "A cópia mensal oficial do SIMCAR Digital está indisponível. O recorte foi cancelado e nenhum ZIP parcial foi gerado.",
                "unavailable",
                undefined,
                { cause: err },
            );
        console.error("[SIMCAR CLIP] Snapshot validation error:", err?.message || err);
        sendSSE(res, { type: "error", code: sourceError.code, message: sourceError.message });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }
    throwIfClientDisconnected(res);

    // 5. Process each layer
    const clippedLayers = new Map<string, { records: ShpRecord[]; fieldDefs: DbfFieldDef[] }>();
    const clippedPointLayers = new Map<string, { records: Array<{ coordinates: [number, number]; attributes: Record<string, string | number | null> }>; fieldDefs: DbfFieldDef[] }>();
    const clippedGeometries = new Map<string, Geometry[]>();
    // Os resultados do snapshot ficam em GeoJSON até todas as camadas estarem
    // disponíveis. A validação final é somente leitura e nunca corrige shapes.
    const wfsLayerOutputs = new Map<string, { clipped: ClipResult[]; wfsFetch: WfsClipFetchResult }>();

    for (let i = 0; i < processingLayerNames.length; i++) {
        throwIfClientDisconnected(res);
        const layerName = processingLayerNames[i];
        const current = i + 1;
        if (DIRECT_COPY_LAYERS.has(layerName)) {
            sendSSE(res, {
                type: "progress",
                layer: layerName,
                current,
                total,
                status: "copying_property",
            });

            const templateFieldDefs = templateSchemas.get(layerName) || [
                { name: "ID", type: "N" as const, length: 10, decimals: 0 },
            ];

            const result = buildDirectCopyLayerRecords(
                layerName,
                userPolygons,
                templateFieldDefs,
                airIdentificacao,
            );

            if (!result) {
                layerSummaries.push({
                    name: layerName,
                    source: "property",
                    features: 0,
                    warning: "Camada de cópia direta não reconhecida.",
                });
                continue;
            }

            if (!result.records.length) {
                layerSummaries.push(result.summary);
                continue;
            }

            clippedLayers.set(layerName, {
                records: result.records,
                fieldDefs: result.fieldDefs,
            });

            layerSummaries.push(result.summary);
            totalFeaturesClipped += result.records.length;
            throwIfClientDisconnected(res);
            continue;
        }

        // Category 2: snapshot oficial mensal + interseção exata com a ATP.
        const isRiverLayer = RIVER_CLIP_LAYERS.has(layerName);
        const isSpringLayer = layerName === SPRING_LAYER_NAME;
        // Reservatórios usam o MESMO buffer dos rios para seleção, mas são mantidos
        // inteiros (sem recorte na divisa da ATP).
        const isWholeFeatureBufferLayer = WHOLE_FEATURE_BUFFER_LAYERS.has(layerName);
        const clippedRiverFeatures = isSpringLayer ? getClippedRiverFeatures(clippedGeometries) : [];
        // Rios usam a fronteira expandida (única). Demais camadas recortam contra
        // cada lote do imóvel separadamente, reunindo as peças no mesmo shapefile.
        const clipBoundaries = isRiverLayer
            ? [riverClipBoundary.polygon]
            : userPolygons;
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
                warning: "Camada não disponível no snapshot mensal oficial do SIMCAR Digital.",
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

        let wfsFetch: WfsClipFetchResult;
        try {
            wfsFetch = await fetchCompleteSimcarSnapshotLayer({
                layerName,
                typeName: wfsTypeName,
                bbox: isRiverLayer || isSpringLayer || isWholeFeatureBufferLayer
                    ? featureBbox(riverClipBoundary.polygon)
                    : featureBbox(userPolygon),
            });
        } catch (err: any) {
            if (err instanceof ClientAbortError) throw err;
            const sourceError = err instanceof SimcarSnapshotSourceError
                ? err
                : new SimcarSnapshotSourceError(
                    "A cópia mensal oficial do SIMCAR Digital está indisponível. O recorte foi cancelado e nenhum ZIP parcial foi gerado.",
                    "unavailable",
                    layerName,
                    { cause: err },
                );
            console.error(`[SIMCAR CLIP] Snapshot fetch error for ${layerName}:`, err?.message || err);
            sendSSE(res, {
                type: "error",
                code: sourceError.code,
                layer: layerName,
                message: sourceError.message,
            });
            return { ok: false, cloudinaryStoredBytes: 0 };
        }
        throwIfClientDisconnected(res);

        const wfsFeatures = wfsFetch.features;
        if (!wfsFeatures.length) {
            const summary = appendLayerWarning({
                name: layerName,
                source: "wfs",
                features: 0,
            }, wfsFetch.warnings, wfsFetch.partial);
            if (summary.warning) jobWarnings.push(`${layerName}: ${summary.warning}`);
            layerSummaries.push(summary);
            continue;
        }

        let clipped: ClipResult[];
        try {
            clipped = isWholeFeatureBufferLayer
                ? selectWholeFeaturesIntersecting(wfsFeatures, riverClipBoundary.polygon)
                : await clipOfficialFeaturesExactly(wfsFeatures, clipBoundaries, {
                    pointClipPolygons: isSpringLayer && clippedRiverFeatures.length > 0
                        ? [...userPolygons, ...clippedRiverFeatures]
                        : undefined,
                    layerName,
                });
        } catch (error) {
            const topologyError = error instanceof ExactClipError
                ? error
                : new ExactClipError(
                    "Não foi possível recortar a geometria oficial sem alterá-la. O recorte foi cancelado e nenhum ZIP foi gerado.",
                    { cause: error },
                );
            console.error(`[SIMCAR CLIP] Exact clip error for ${layerName}:`, error);
            sendSSE(res, {
                type: "error",
                code: topologyError.code,
                layer: layerName,
                message: topologyError.message,
            });
            return { ok: false, cloudinaryStoredBytes: 0 };
        }
        throwIfClientDisconnected(res);

        if (!clipped.length) {
            const summary = appendLayerWarning({
                name: layerName,
                source: "wfs",
                features: 0,
            }, wfsFetch.warnings, wfsFetch.partial);
            if (summary.warning) jobWarnings.push(`${layerName}: ${summary.warning}`);
            layerSummaries.push(summary);
            continue;
        }

        sendSSE(res, {
            type: "progress",
            layer: layerName,
            current,
            total,
            status: "clipping",
            features: clipped.length,
        });
        wfsLayerOutputs.set(layerName, { clipped, wfsFetch });
        const geometries = layerPolygonGeometries(clipped);
        if (geometries.length > 0) clippedGeometries.set(layerName, geometries);
    }
    throwIfClientDisconnected(res);

    // 5b. AVN/AUAS/AREA_CONSOLIDADA e a água precisam formar a mesma partição
    // mostrada na base oficial. Esta etapa apenas mede: nunca dissolve, subtrai,
    // preenche vazio, cria filete ou move vértice.
    const coverageLayersRequested = LAND_COVER_LAYERS.every((layerName) =>
        processingLayerNames.includes(layerName)
    );
    let topologyStats: CoverageTopologyStats | undefined;
    try {
        if (!coverageLayersRequested) {
            console.log("[SIMCAR CLIP] Full land-cover topology skipped for an explicit partial-layer request.");
        } else {
        const layerResults = new Map<string, ClipResult[]>();
        for (const [layerName, output] of wfsLayerOutputs) {
            layerResults.set(layerName, output.clipped);
        }
        topologyStats = await validateOfficialCoverage({
            layers: layerResults,
            propertyPolygons: userPolygons,
            strict: Boolean(process.env.SIMCAR_STRICT_COVERAGE),
        });
        console.log("[SIMCAR CLIP] Official coverage validated without edits:", topologyStats);
        if (topologyStats.gapAreaM2 > 0.05 || topologyStats.landCoverOverlapAreaM2 > 0.05 || topologyStats.inundatedOverlapAreaM2 > 0.05) {
            const warningMsg = `Topologia oficial preservada sem alterações: vazios originais (${topologyStats.gapAreaM2.toFixed(1)} m²), sobreposição entre classes (${topologyStats.landCoverOverlapAreaM2.toFixed(1)} m²) e sobreposição com água (${topologyStats.inundatedOverlapAreaM2.toFixed(1)} m²). Nenhum filete foi criado.`;
            jobWarnings.push(warningMsg);
            console.log(`[SIMCAR CLIP] ${warningMsg}`);
        }
        }
    } catch (error) {
        const topologyError = error instanceof CoverageTopologyError
            ? error
            : new CoverageTopologyError(
                "Não foi possível validar a cobertura oficial sem alterar os shapes. O recorte foi cancelado e nenhum ZIP foi gerado.",
                { cause: error },
            );
        console.error("[SIMCAR CLIP] Coverage topology error:", error);
        sendSSE(res, {
            type: "error",
            code: topologyError.code,
            message: topologyError.message,
        });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }
    throwIfClientDisconnected(res);

    // 5c. Somente depois da validacao global as geometrias sao serializadas.
    // Assim nenhum SHP parcial pode escapar antes de a cobertura ser provada.
    for (const layerName of processingLayerNames) {
        if (DIRECT_COPY_LAYERS.has(layerName)) continue;
        const output = wfsLayerOutputs.get(layerName);
        if (!output) continue; // camada sem match ou WFS vazio ja resumida acima
        const { clipped, wfsFetch } = output;

        if (!clipped.length) {
            const summary = appendLayerWarning({
                name: layerName,
                source: "wfs",
                features: 0,
            }, wfsFetch.warnings, wfsFetch.partial);
            if (summary.warning) jobWarnings.push(`${layerName}: ${summary.warning}`);
            layerSummaries.push(summary);
            continue;
        }

        const fieldDefs = templateSchemas.get(layerName) || [
            { name: "ID", type: "N" as const, length: 10, decimals: 0 },
        ];
        const expectedShapeType = templateShapeTypes.get(layerName.toUpperCase()) ?? 5;
        const isPointLayer = expectedShapeType === 1 || expectedShapeType === 8;
        const records: ShpRecord[] = [];
        const pointRecords: Array<{ coordinates: [number, number]; attributes: Record<string, string | number | null> }> = [];
        let layerAreaHa = 0;

        for (let featIndex = 0; featIndex < clipped.length; featIndex += 1) {
            if (featIndex % 50 === 0) throwIfClientDisconnected(res);
            const feat = clipped[featIndex];
            if (feat.kind === "polygon" && !isPointLayer) {
                const polyRecords = geojsonToPolyRecords(feat.geometry as any);
                if (!polyRecords.length) continue;
                for (const polyRec of polyRecords) {
                    const attributes = applyLayerAttributeRules(
                        layerName,
                        mapAttributes(feat.properties, fieldDefs),
                        fieldDefs,
                        records.length + 1,
                    );
                    records.push({ type: "polygon", rings: polyRec.rings, attributes });
                }
                try {
                    const geom = normalizePolygonGeometry(feat.geometry);
                    if (geom) {
                        const feature = geom.type === "Polygon"
                            ? turfPolygon(geom.coordinates)
                            : turfMultiPolygon(geom.coordinates);
                        layerAreaHa += turfArea(feature) / 10000;
                    }
                } catch {
                    // A validacao topologica ja ocorreu; area e apenas resumo.
                }
            } else if (feat.kind === "point" && isPointLayer) {
                for (const coord of feat.pointCoords) {
                    const attributes = applyLayerAttributeRules(
                        layerName,
                        mapAttributes(feat.properties, fieldDefs),
                        fieldDefs,
                        pointRecords.length + 1,
                    );
                    pointRecords.push({ coordinates: coord, attributes: { ...attributes } });
                }
            }
        }

        if (records.length > 0) clippedLayers.set(layerName, { records, fieldDefs });
        if (pointRecords.length > 0) {
            clippedPointLayers.set(layerName, { records: pointRecords, fieldDefs });
        }
        totalFeaturesClipped += records.length + pointRecords.length;
        const featureCount = records.length + pointRecords.length;
        const summary = appendLayerWarning({
            name: layerName,
            source: "wfs",
            features: featureCount,
            areaHa: Number(layerAreaHa.toFixed(4)),
        }, wfsFetch.warnings, wfsFetch.partial);
        if (summary.warning) jobWarnings.push(`${layerName}: ${summary.warning}`);
        layerSummaries.push(summary);
    }
    throwIfClientDisconnected(res);

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
        xlsxBuffer = await buildQuantitativeXlsx(
            layerSummaries.filter((l) => !isExcludedFromExport(l.name)),
            areaHa,
            airIdentificacao,
        );
    } catch (err: any) {
        console.error("[SIMCAR CLIP] XLSX build error:", err.message);
        // Non-fatal: continue without XLSX
    }
    throwIfClientDisconnected(res);

    let zipBuffer: Buffer;
    try {
        zipBuffer = await buildOutputZip(templateEntries, clippedLayers, clippedPointLayers, prjBuffers, xlsxBuffer);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: `Erro ao montar ZIP: ${err.message}` });
        return { ok: false, cloudinaryStoredBytes: 0 };
    }
    throwIfClientDisconnected(res);

    // 6c. Build topology anomalies ZIP (vazios e sobreposições da base oficial)
    let topologyZipBuffer: Buffer | undefined;
    const currentTopologyStats = topologyStats;
    const hasTopologyAnomalies = currentTopologyStats && (
        currentTopologyStats.gapAreaM2 > 0.01 ||
        currentTopologyStats.landCoverOverlapAreaM2 > 0.01 ||
        currentTopologyStats.inundatedOverlapAreaM2 > 0.01
    );
    if (hasTopologyAnomalies && currentTopologyStats) {
        try {
            topologyZipBuffer = await buildTopologyAnomaliesZip({
                topologyStats: currentTopologyStats,
                propertyAreaHa: areaHa,
                airIdentificacao,
                crs: "EPSG:4674",
            });
            console.log(`[SIMCAR CLIP] Topology anomalies ZIP built: ${topologyZipBuffer.length} bytes`);
        } catch (err: any) {
            console.error("[SIMCAR CLIP] Error building topology anomalies ZIP:", err?.message || err);
        }
    }
    throwIfClientDisconnected(res);

    // 7. Cache the result (including geometry for AI analysis)
    const jobId = String(forcedJobId || "").trim() || crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `SIMCAR_Recorte_${timestamp}.zip`;
    const topologyFilename = `SIMCAR_Inconsistencias_Topologicas_${timestamp}.zip`;

    // Compute bbox from user polygon for WMS snapshots
    const polyCoords = userPolygon.geometry.type === "Polygon"
        ? userPolygon.geometry.coordinates[0]
        : userPolygon.geometry.coordinates.flatMap((p: number[][][]) => p[0]);
    const lngs = polyCoords.map((c: number[]) => c[0]);
    const lats = polyCoords.map((c: number[]) => c[1]);
    const jobBbox: [number, number, number, number] = [
        Math.min(...lngs), Math.min(...lats),
        Math.max(...lngs), Math.max(...lats),
    ];

    pruneJobCache();

    // 7b. Upload ZIPs to Cloudinary for persistence
    let inputZipUrl: string | undefined;
    let outputZipUrl: string | undefined;
    let topologyZipUrl: string | undefined;
    let contextJsonUrl: string | undefined;
    let cloudinaryStoredBytes = 0;
    try {
        sendSSE(res, { type: "progress", layer: "UPLOAD", current: total, total, status: "uploading_cloudinary" });
        const [inUrl, outUrl, topUrl] = await Promise.all([
            propertyZip
                ? uploadBufferToCloudinary(propertyZip, `simcar_input_${jobId.slice(0, 8)}`, uid)
                : Promise.resolve(""),
            uploadBufferToCloudinary(zipBuffer, `simcar_output_${jobId.slice(0, 8)}`, uid),
            topologyZipBuffer
                ? uploadBufferToCloudinary(topologyZipBuffer, `simcar_topologia_${jobId.slice(0, 8)}`, uid)
                : Promise.resolve(""),
        ]);
        inputZipUrl = inUrl || undefined;
        outputZipUrl = outUrl;
        topologyZipUrl = topUrl || undefined;
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
            inputZipUrl: inUrl || undefined,
            outputZipUrl: outUrl,
            topologyZipUrl,
            warnings: dedupeWarnings(jobWarnings),
        };
        const contextBuffer = Buffer.from(JSON.stringify(persistedContext), "utf8");
        contextJsonUrl = await uploadRawBufferToCloudinary(
            contextBuffer,
            `simcar_context_${jobId.slice(0, 8)}.json`,
            "application/json",
            uid,
        );
        cloudinaryStoredBytes = (propertyZip?.length || 0) + zipBuffer.length + (topologyZipBuffer?.length || 0) + contextBuffer.length;
        console.log(`[SIMCAR CLIP] Cloudinary: input=${inUrl}, output=${outUrl}, topologia=${topUrl}, context=${contextJsonUrl}`);
    } catch (err: any) {
        console.error("[SIMCAR CLIP] Cloudinary ZIP upload error:", err.message);
        // Non-fatal: continue without Cloudinary URLs
    }

    jobCache.set(jobId, {
        uid,
        buffer: zipBuffer,
        topologyZipBuffer,
        topologyZipUrl,
        topologyFilename,
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
        warnings: dedupeWarnings(jobWarnings),
    });

    // 8. Send completion event
    const processingTimeMs = Date.now() - startTime;
    const layersWithData = layerSummaries.filter((l) => l.features > 0).length;

    const topologyDownloadUrl = (topologyZipBuffer || topologyZipUrl)
        ? toPublicApiUrl(`/api/simcar/clip/download/${jobId}/topologia`)
        : undefined;

    const summaryPayload = {
        propertyAreaHa: areaHa,
        crs: "EPSG:4674",
        layersProcessed: layerNames.length,
        layersWithData,
        totalFeaturesClipped,
        processingTimeMs,
        layers: layerSummaries,
        warnings: dedupeWarnings(jobWarnings),
        topologyDownloadUrl,
        topologyStats: topologyStats ? {
            gapAreaM2: topologyStats.gapAreaM2,
            landCoverOverlapAreaM2: topologyStats.landCoverOverlapAreaM2,
            inundatedOverlapAreaM2: topologyStats.inundatedOverlapAreaM2,
        } : undefined,
    };
    const downloadUrl = toPublicApiUrl(`/api/simcar/clip/download/${jobId}`);
    sendSSE(res, {
        type: "complete",
        jobId,
        downloadUrl,
        topologyDownloadUrl,
        inputZipUrl,
        outputZipUrl,
        topologyZipUrl,
        contextUrl: contextJsonUrl,
        summary: summaryPayload,
    });
    return {
        ok: true,
        cloudinaryStoredBytes,
        jobId,
        filename,
        downloadUrl,
        topologyDownloadUrl,
        inputZipUrl,
        outputZipUrl,
        topologyZipUrl,
        contextUrl: contextJsonUrl,
        summary: summaryPayload,
        topologyZipBuffer,
    };
}
