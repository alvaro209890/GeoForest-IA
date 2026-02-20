/**
 * SIMCAR Clip â€” Automated clipping of SEMA-MT SIMCAR WFS layers
 * to the geometry of a user-provided property polygon.
 *
 * Registers endpoints:
 *   POST /api/simcar/clip          â€” SSE stream (progress + result)
 *   GET  /api/simcar/clip/download/:jobId â€” Download final ZIP
 *   POST /api/simcar/clip/analyze   â€” SSE stream (AI analysis of clips)
 *   GET  /api/simcar/gemini/config  â€” Runtime Gemini config (+ optional probe)
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
    estimateReserveForModels,
    estimateTokensFromMessages,
    estimateTokensFromText,
    getBillingUsageSessionRecords,
    recordModelUsage,
    refundReserve,
    reserveCredits,
    runWithBillingUsageSession,
    settleReservedCredits,
} from "./billing";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const MODELO_ZIP_PATH = path.resolve(__dirname, "..", "Arquivo Modelo.zip");
const WFS_MAX_FEATURES = 50000;
const CACHE_TTL_MS = 15 * 60 * 1000;    // 15 minutes
const CACHE_MAX_JOBS = 10;
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

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

/* â”€â”€â”€ Job Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

type CachedJob = {
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

/* â”€â”€â”€ SSE Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function sendSSE(res: Response, data: Record<string, unknown>) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush if available (for proxied/streamed connections)
    if (typeof (res as any).flush === "function") (res as any).flush();
}

/* â”€â”€â”€ Shapefile Parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
 * Parse user's shapefile ZIP â†’ single unified polygon in EPSG:4674.
 */
function parseUserShapefile(zipBuffer: Buffer): {
    polygon: Feature<Polygon | MultiPolygon>;
    geometry: SupportedPolygonGeometry;
    areaHa: number;
} {
    const entries = extractZipEntries(zipBuffer);
    const shpEntry = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
    const prjEntry = entries.find((e) => e.name.toLowerCase().endsWith(".prj"));

    if (!shpEntry) throw new Error("ZIP nÃ£o contÃ©m arquivo .shp vÃ¡lido.");

    const allPolygons = readFullShapefile(shpEntry.data);
    if (!allPolygons.length) throw new Error("Shapefile nÃ£o contÃ©m polÃ­gonos vÃ¡lidos.");

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
                // WGS84 â‰ˆ EPSG:4674 for practical purposes
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

    if (!features.length) throw new Error("Nenhum polÃ­gono vÃ¡lido encontrado no Shapefile.");

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
    if (!geometry) throw new Error("Geometria do imÃ³vel nÃ£o pÃ´de ser validada.");

    const areaHa = Number((turfArea(unified) / 10000).toFixed(4));

    return { polygon: unified, geometry, areaHa };
}

/* â”€â”€â”€ Layer Name Mapping (Template â†’ WFS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

        // Fallback: fuzzy â€” find a WFS layer whose suffix matches SIMCAR_D_<name> or just <name>
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

        // Last resort: partial match â€” WFS layer ending with _<TEMPLATE_NAME>
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

/* â”€â”€â”€ WFS Feature Fetching with Attributes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ Feature Clipping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ Template Schema Extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ Attribute Mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ ZIP Output Builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€â”€ XLSX Quantitative Report Builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

    // â”€â”€ Sheet 1: Resumo â”€â”€
    const resumo = workbook.addWorksheet("Resumo");

    // Title row
    resumo.mergeCells("A1:B1");
    const titleCell = resumo.getCell("A1");
    titleCell.value = "RelatÃ³rio Quantitativo â€” Recorte SIMCAR";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF065F46" } };
    titleCell.alignment = { horizontal: "center" };

    // Summary data
    const summaryData: [string, string | number][] = [
        ["Data do Processamento", new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })],
        ["NÂº IdentificaÃ§Ã£o AIR", airIdentificacao || "â€”"],
        ["Ãrea do ImÃ³vel (ha)", Number(propertyAreaHa.toFixed(4))],
        ["Sistema de ReferÃªncia", "EPSG:4674 (SIRGAS 2000)"],
        ["Total de Camadas", layerSummaries.length],
        ["Camadas com Dados", layerSummaries.filter((l) => l.features > 0).length],
        ["Total de FeiÃ§Ãµes Recortadas", layerSummaries.reduce((s, l) => s + l.features, 0)],
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

    // â”€â”€ Sheet 2: Camadas â”€â”€
    const camadas = workbook.addWorksheet("Camadas");

    // Header row
    const headers = ["Camada", "Origem", "FeiÃ§Ãµes", "Ãrea (ha)", "% do ImÃ³vel", "ObservaÃ§Ãµes"];
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
        row.getCell(2).value = layer.source === "property" ? "ImÃ³vel" : "WFS";
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
    camadas.getColumn(3).width = 10; // FeiÃ§Ãµes
    camadas.getColumn(4).width = 14; // Ãrea (ha)
    camadas.getColumn(5).width = 14; // % do ImÃ³vel
    camadas.getColumn(6).width = 36; // ObservaÃ§Ãµes

    // Auto-filter
    camadas.autoFilter = { from: "A1", to: `F${layerSummaries.length + 1}` };

    // Write to buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}

/* â”€â”€â”€ Main Processing Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

type LayerSummary = {
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
) {
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
        sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile do imÃ³vel." });
        return;
    }

    const { polygon: userPolygon, geometry: userGeometry, areaHa } = userResult;
    const userWkt = polygonToWkt(userGeometry);

    // 2. Read template
    let templateEntries: Array<{ name: string; data: Buffer }>;
    try {
        const modeloBuffer = fs.readFileSync(MODELO_ZIP_PATH);
        templateEntries = extractZipEntries(modeloBuffer);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: "Arquivo Modelo.zip nÃ£o encontrado no servidor." });
        return;
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

    // 4. WFS GetCapabilities â†’ discover layer mapping
    let layerMapping = new Map<string, string>();
    try {
        const caps = await getCapabilitiesCached(false);
        const wfsNames = [...caps.layerNames];
        layerMapping = discoverLayerMapping(TEMPLATE_LAYERS, wfsNames);
        console.log(`[SIMCAR CLIP] Layer mapping: ${layerMapping.size} layers matched`);
    } catch (err: any) {
        console.error("[SIMCAR CLIP] WFS capabilities error:", err.message);
        sendSSE(res, { type: "error", message: "ServiÃ§o WFS da SEMA-MT indisponÃ­vel." });
        return;
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
                warning: "Camada nÃ£o encontrada no WFS",
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
        return;
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
}

/* â”€â”€â”€ AI Analysis Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
    // Landsat 5 (30m) â€” 1984-2011
    ...Object.fromEntries([1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011].map(
        (y) => [`landsat5_${y}`, buildSatLayer("LANDSAT5", y, "LANDSAT_5", "Landsat 5")]
    )),
    // Landsat 8 (30m) â€” 2013-2018
    ...Object.fromEntries([2013, 2014, 2015, 2016, 2017, 2018].map(
        (y) => [`landsat8_${y}`, buildSatLayer("LANDSAT8", y, "LANDSAT_8", "Landsat 8")]
    )),
    // Sentinel-2 (10m) â€” 2016-2024
    ...Object.fromEntries([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024].map(
        (y) => [`sentinel2_${y}`, buildSatLayer("SENTINEL2", y, "SENTINEL_2", "Sentinel-2")]
    )),
};

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
    const timeout = setTimeout(() => controller.abort(), 30_000);
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
        throw new Error(`WMS retornou formato invÃ¡lido (nÃ£o Ã© PNG/JPEG): ${preview.slice(0, 150)}`);
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
    // WMS 1.1.1 with EPSG:4326 uses lon,lat order in bbox â†’ y is inverted
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
 * Downscales to max 800Ã—600 and encodes as JPEG at quality 65 with metadata stripped.
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
    if (!apiSecret) throw new Error("Cloudinary nÃ£o configurado.");
    const base = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
    return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

/** Upload a data URL (image) to Cloudinary. Returns secure_url. */
async function uploadToCloudinary(dataUrl: string, filename: string): Promise<string> {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const folder = process.env.CLOUDINARY_FOLDER;
    if (!apiKey || !apiSecret) throw new Error("Cloudinary nÃ£o configurado.");

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
 * Resizes to max 800Ã—600, converts to JPEG at quality 65, strips metadata.
 * This reduces image token consumption by ~70â€“80% vs. sending the full-res PNG,
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
 * Uses a higher resolution (max 1024Ã—768) and better JPEG quality (82) than the
 * Groq path, taking advantage of Gemini's larger context window and superior image
 * understanding to produce more precise land-use / vegetation analyses.
 */
function getCloudinaryGeminiUrl(url: string): string {
    if (!url.includes("/image/upload/")) return url;
    return url.replace("/image/upload/", "/image/upload/w_1024,h_768,c_limit,q_82,f_jpg,fl_strip_profile/");
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
    if (!apiKey || !apiSecret) throw new Error("Cloudinary nÃ£o configurado.");

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
    /** URL for Groq vision (compressed 800Ã—600 JPEG). */
    url?: string;
    /** Higher-quality URL for Gemini vision (1024Ã—768 JPEG). Falls back to `url` if absent. */
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
    return images.filter((img) => img.caption.includes("VisÃ£o Geral"));
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
        throw new Error("Formato de data URL invÃ¡lido para Gemini.");
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
    "- Nao repita o que ja foi escrito.\n" +
    "- Mantenha o mesmo idioma, formato e nivel tecnico.\n" +
    "- Entregue somente a continuacao a partir da proxima frase.\n" +
    "- Nao invente dados novos fora do contexto ja fornecido.";

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
                    "VocÃª estÃ¡ finalizando um laudo tÃ©cnico de recorte ambiental.\n" +
                    "Mantenha o mesmo estilo tÃ©cnico da resposta original.\n\n" +
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
    if (!apiKey) throw new Error("GEMINI_API_KEY nÃ£o configurada.");

    const contents = toGeminiContents(messages);
    if (contents.length === 0) {
        throw new Error("Sem conteÃºdo textual para sÃ­ntese Gemini.");
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
        throw new Error("GEMINI_API_KEY nÃ£o configurada para sÃ­ntese.");
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

    throw new Error(`Gemini synthesis falhou para ${contextLabel}. Ãšltimo erro: ${lastError}`);
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
    if (!apiKey) throw new Error("GROQ_API_KEY nÃ£o configurada.");

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
                    // Detect Groq rate limit â€” mark and propagate immediately
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
        throw new GroqRateLimitError(`Todos os modelos de visÃ£o Groq estÃ£o em cooldown (~${waitSecs}s).`);
    }
    throw new Error(`Todos os modelos Groq falharam. Ãšltimo erro: ${lastError}`);
}

function buildDualModelMergePrompt(
    contextLabel: string,
    groqAnalysis: string,
    geminiAnalysis: string,
): string {
    return [
        "VocÃª Ã© a GeoForest IA e deve consolidar duas anÃ¡lises tÃ©cnicas da MESMA Ã¡rea e do MESMO perÃ­odo.",
        `Contexto do recorte: ${contextLabel}`,
        "",
        "## AnÃ¡lise Groq",
        groqAnalysis,
        "",
        "## AnÃ¡lise Gemini",
        geminiAnalysis,
        "",
        "## Tarefa",
        "Produza um texto Ãºnico e tÃ©cnico em portuguÃªs com:",
        "1) Consensos principais entre os dois modelos.",
        "2) DivergÃªncias relevantes e a hipÃ³tese mais provÃ¡vel.",
        "3) ConclusÃ£o consolidada para este perÃ­odo.",
        "",
        "Seja objetivo e nÃ£o repita integralmente os textos de origem.",
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
    if (!apiKey) throw new Error("GEMINI_API_KEY nÃ£o configurada.");

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
                                // Gemini 2.5 suporta saÃ­das longas (atÃ© 65k tokens).
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
                        usage.inputTokens = Math.max(
                            Number(usage.inputTokens || 0),
                            estimateTokensFromText(prompt) + currentImages.length * 1800,
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

    throw new Error(`Gemini falhou. Ãšltimo erro: ${lastError}`);
}

async function analyzeWithGroqAndGemini(
    images: AiImage[],
    prompt: string,
    contextLabel: string,
): Promise<string> {
    if (images.length === 0) {
        throw new Error(`Sem imagens para anÃ¡lise (${contextLabel}).`);
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
            `[SIMCAR ANALYSIS] ${contextLabel}: Groq-first â€” sending all ${images.length} images to Groq`,
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
            `[SIMCAR ANALYSIS] ${contextLabel}: modelos Groq de visÃ£o em cooldown (~${waitSecs}s), pulando direto para Gemini`,
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

    throw new Error(`Nenhum provedor disponÃ­vel para ${contextLabel}.`);
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
): Promise<string> {
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasGroq = Boolean(process.env.GROQ_API_KEY);
    let geminiError = "";

    if (hasGemini) {
        try {
            console.log(
                `[SIMCAR ANALYSIS] ${contextLabel}: best-text synthesis via Gemini chain: ${SIMCAR_SYNTHESIS_TEXT_MODELS.join(", ")}`,
            );
            return await callGeminiTextSynthesis(messages, contextLabel, {
                modelChain: SIMCAR_SYNTHESIS_TEXT_MODELS,
                maxOutputTokens: 8192,
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
                throw new Error(`SÃ­ntese falhou. Gemini=${geminiError} | Groq=${groqError}`);
            }
            throw groqErr;
        }
    }

    if (geminiError) {
        throw new Error(`SÃ­ntese falhou com Gemini: ${geminiError}`);
    }
    throw new Error("Nenhum provedor de texto configurado para sÃ­ntese.");
}

async function callTextFollowUp(
    messages: Array<{ role: string; content: any }>,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY nÃ£o configurada.");

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
        throw new GroqRateLimitError(`Todos os modelos de texto Groq estÃ£o em cooldown (~${waitSecs}s).`);
    }
    throw new Error(`Falha nos modelos de texto Groq. Ãšltimo erro: ${lastError}`);
}

async function streamTextFollowUp(
    res: Response,
    messages: Array<{ role: string; content: any }>,
): Promise<void> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY nÃ£o configurada.");

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
            throw new GroqRateLimitError(`Todos os modelos de texto Groq estÃ£o em cooldown (~${waitSecs}s).`);
        }
        throw new Error("Nenhum modelo disponÃ­vel para iniciar resposta.");
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
    const maxRows = Math.max(4, options?.maxRows ?? (compact ? 8 : 28));
    const acSummary = layerSummaries.find((l) => l.name === "AREA_CONSOLIDADA");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN");
    const atpSummary = layerSummaries.find((l) => l.name === "ATP");

    const nonZeroRows = layerSummaries
        .filter((l) => l.features > 0)
        .sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0));

    const alwaysKeep = new Set(["ATP", "AREA_CONSOLIDADA", "AVN"]);
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

    return [
        "## Contexto do ImÃ³vel Rural",
        "",
        `| ParÃ¢metro | Valor |`,
        `|-----------|-------|`,
        `| Ãrea Total da Propriedade (ATP) | **${areaHa.toFixed(2)} ha** |`,
        `| Ãrea Consolidada (AC) | ${acSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((acSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) â€” ${acSummary?.features ?? 0} feiÃ§Ãµes |`,
        `| VegetaÃ§Ã£o Nativa (AVN) | ${avnSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((avnSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) â€” ${avnSummary?.features ?? 0} feiÃ§Ãµes |`,
        atpSummary ? `| ATP (polÃ­gono declarado) | ${atpSummary.areaHa?.toFixed(2) ?? '-'} ha |` : "",
        "",
        compact ? "### Quantitativos-chave (SIMCAR Digital)" : "### Quantitativos completos (SIMCAR Digital)",
        "| Camada | FeiÃ§Ãµes | Ãrea | % do ImÃ³vel |",
        "|--------|---------|------|-----------|",
        ...quantRows,
        compact && nonZeroRows.length > chosenRows.length
            ? `\n*Resumo reduzido para eficiÃªncia de tokens: exibindo ${chosenRows.length} de ${nonZeroRows.length} camadas com feiÃ§Ãµes.*`
            : "",
    ].join("\n");
}

/** Build prompt for a SINGLE satellite analysis (3 images). */
function buildSingleSatellitePrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    satelliteKey: string,
): string {
    const sat = SATELLITE_LAYERS[satelliteKey];
    const sensor = satelliteKey.startsWith("sentinel2") ? "Sentinel-2 MSI (10m de resoluÃ§Ã£o espacial)"
        : satelliteKey.startsWith("landsat8") ? "Landsat 8 OLI (30m de resoluÃ§Ã£o espacial)"
            : satelliteKey.startsWith("landsat5") ? "Landsat 5 TM (30m de resoluÃ§Ã£o espacial)"
                : "SPOT (2.5m de resoluÃ§Ã£o espacial)";

    return [
        "VocÃª Ã© a **GeoForest IA**, especialista em sensoriamento remoto e anÃ¡lise ambiental para imÃ³veis rurais em Mato Grosso.",
        "Analise as 3 imagens do satÃ©lite fornecido comparando com os dados vetoriais do CAR.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 8 }),
        "",
        "---",
        "",
        `## Imagens: ${sat.label} â€” ${sensor}`,
        "",
        "**Legenda dos polÃ­gonos:**",
        "- ðŸŸ¥ **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- ðŸŸª **Roxo semi-transparente**: ÃREA CONSOLIDADA (AC)",
        "- ðŸŸ¨ **Amarelo semi-transparente**: VEGETAÃ‡ÃƒO NATIVA (AVN)",
        "",
        `- Imagem 1: VisÃ£o Geral â€” base ${sat.label} + propriedade + AC + AVN`,
        `- Imagem 2: Ãrea Consolidada â€” base ${sat.label} + propriedade + somente AC`,
        `- Imagem 3: AVN â€” base ${sat.label} + propriedade + somente AVN`,
        "",
        "---",
        "",
        "## InstruÃ§Ãµes",
        "",
        "### AnÃ¡lise da Ãrea Consolidada (AC)",
        "- As Ã¡reas em roxo correspondem a uso antrÃ³pico (pastagem, agricultura, solo exposto)?",
        "- Algum trecho de AC apresenta textura de vegetaÃ§Ã£o nativa?",
        "- Descreva a localizaÃ§Ã£o de trechos discordantes (ex: 'porÃ§Ã£o norte', 'borda leste').",
        "",
        "### AnÃ¡lise da VegetaÃ§Ã£o Nativa (AVN)",
        "- As Ã¡reas em amarelo correspondem a vegetaÃ§Ã£o nativa (floresta, cerrado, mata ciliar)?",
        "- Algum trecho de AVN parece antropizado (pastagem, desmatamento, queimada)?",
        "- Avalie integridade e conectividade da vegetaÃ§Ã£o.",
        "",
        "### ConcordÃ¢ncias e DiscordÃ¢ncias",
        "- **âœ… CONCORDA**: Ã¡reas onde classificaÃ§Ã£o coincide com a imagem.",
        "- **âŒ DISCORDA**: Ã¡reas onde classificaÃ§Ã£o nÃ£o condiz. Indique a classificaÃ§Ã£o mais apropriada.",
        "",
        "### NÃ­vel de ConfianÃ§a",
        "Classifique: **[ALTA]**, **[MÃ‰DIA]** ou **[BAIXA]**.",
        "",
        "---",
        "Responda em **portuguÃªs**, use markdown, seja detalhado e tÃ©cnico.",
        "NÃ£o inclua cadeia de raciocÃ­nio interna nem bloco <think>; entregue sÃ³ a resposta final.",
    ].join("\n");
}

/** Build the full prompt for single-satellite analysis (original behavior). */
function buildAnalysisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    selectedLayers?: string[],
): string {
    const validLayers = getOrderedSatelliteKeys(selectedLayers || []);
    const isMultiYear = validLayers.length > 1;
    const layerLabels = validLayers.map((k) => SATELLITE_LAYERS[k]?.label || k);
    const layerYears = validLayers.map((k) => SATELLITE_LAYERS[k]?.year || 0).sort();

    const satDescriptions = validLayers.map((k, i) => {
        const sat = SATELLITE_LAYERS[k];
        const imgBase = i * 3 + 1;
        const sensor = k.startsWith("sentinel2") ? "Sentinel-2 MSI (10m de resoluÃ§Ã£o espacial)"
            : k.startsWith("landsat8") ? "Landsat 8 OLI (30m de resoluÃ§Ã£o espacial)"
                : k.startsWith("landsat5") ? "Landsat 5 TM (30m de resoluÃ§Ã£o espacial)"
                    : "SPOT (2.5m de resoluÃ§Ã£o espacial)";
        return [
            `#### ${sat.label} â€” ${sensor}`,
            `- Imagem ${imgBase}: VisÃ£o Geral â€” base ${sat.label} + contorno vermelho (propriedade) + AC (roxo) + AVN (amarelo)`,
            `- Imagem ${imgBase + 1}: Ãrea Consolidada â€” base ${sat.label} + contorno vermelho + somente AC (roxo)`,
            `- Imagem ${imgBase + 2}: AVN â€” base ${sat.label} + contorno vermelho + somente AVN (amarelo)`,
        ].join("\n");
    }).join("\n\n");

    const parts: string[] = [
        "VocÃª Ã© a **GeoForest IA**, especialista em sensoriamento remoto e anÃ¡lise ambiental para imÃ³veis rurais em Mato Grosso.",
        "Realize uma anÃ¡lise tÃ©cnica comparando os dados vetoriais do CAR com as imagens de satÃ©lite.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "---",
        "",
        "## Imagens Fornecidas",
        "",
        `Foram geradas imagens de **${layerLabels.join(", ")}**${isMultiYear ? ` (perÃ­odo ${layerYears[0]}â€“${layerYears[layerYears.length - 1]})` : ""}.`,
        "",
        "**Legenda:**",
        "- ðŸŸ¥ **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- ðŸŸª **Roxo semi-transparente**: ÃREA CONSOLIDADA (AC)",
        "- ðŸŸ¨ **Amarelo semi-transparente**: VEGETAÃ‡ÃƒO NATIVA (AVN)",
        "",
        satDescriptions,
        "",
        "---",
        "",
        "## InstruÃ§Ãµes de AnÃ¡lise",
        "",
        "### 3.1 AnÃ¡lise da Ãrea Consolidada (AC)",
        "- Verifique se AC (roxo) corresponde a uso antrÃ³pico (pastagem, agricultura, solo exposto, construÃ§Ãµes).",
        "- Identifique trechos de AC com textura de vegetaÃ§Ã£o nativa.",
        "- Descreva localizaÃ§Ã£o de trechos discordantes.",
        "",
        "### 3.2 AnÃ¡lise da VegetaÃ§Ã£o Nativa (AVN)",
        "- Verifique se AVN (amarelo) corresponde a vegetaÃ§Ã£o nativa.",
        "- Identifique trechos de AVN antropizados.",
        "- Avalie integridade e conectividade.",
        "",
    ];

    if (isMultiYear) {
        parts.push(
            "### 3.3 AnÃ¡lise Temporal (Multi-perÃ­odo)",
            `Imagens de **${layerLabels.join(" e ")}**. Parte MAIS IMPORTANTE.`,
            "",
            "#### a) MudanÃ§as na cobertura vegetal",
            "- SupressÃ£o (mata â†’ solo/pastagem) ou regeneraÃ§Ã£o entre os anos.",
            "- Estime a Ã¡rea das mudanÃ§as.",
            "",
            "#### b) ConsistÃªncia CAR vs. histÃ³rico",
            "- AC existia na imagem mais antiga?",
            "- AC mostra vegetaÃ§Ã£o nativa na imagem mais antiga (desmatamento posterior)?",
            "- AVN jÃ¡ antropizada na imagem mais antiga?",
            "",
            "#### c) Art. 68 â€” Lei 12.651/2012 (marco: 22/07/2008)",
            "- AC consolidada antes de julho/2008?",
            "- ExpansÃ£o sobre vegetaÃ§Ã£o nativa apÃ³s 2008?",
            "",
            "#### d) DiferenÃ§as entre sensores",
            "- Sentinel-2 10m vs Landsat 30m vs SPOT 2.5m â€” nÃ£o confundir resoluÃ§Ã£o com mudanÃ§a.",
            "",
        );
    }

    const n = isMultiYear ? 4 : 3;
    parts.push(
        `### 3.${n} ConcordÃ¢ncias e DiscordÃ¢ncias`,
        "- **âœ… CONCORDA**: classificaÃ§Ã£o coincide com imagem.",
        "- **âŒ DISCORDA**: classificaÃ§Ã£o nÃ£o condiz. Indique a classificaÃ§Ã£o correta.",
        "",
        `### 3.${n + 1} NÃ­vel de ConfianÃ§a: [ALTA], [MÃ‰DIA] ou [BAIXA]`,
        "",
        `### 3.${n + 2} RecomendaÃ§Ãµes ao Analista`,
        "- AÃ§Ãµes prÃ¡ticas: vistoria, imagens complementares, retificaÃ§Ã£o do CAR.",
        "- Artigos relevantes do CÃ³digo Florestal.",
        "",
        "---",
        "Responda em **portuguÃªs**, use markdown com seÃ§Ãµes e sub-seÃ§Ãµes.",
        "NÃ£o inclua cadeia de raciocÃ­nio interna nem bloco <think>; entregue sÃ³ a resposta final.",
    );

    return parts.join("\n");
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
        `### AnÃ¡lise: ${a.satelliteLabel} (${a.year})`,
        "",
        toSynthesisExcerpt(a.analysis),
    ].join("\n")).join("\n\n---\n\n");

    return [
        "VocÃª Ã© a **GeoForest IA**, especialista em sensoriamento remoto e anÃ¡lise ambiental para imÃ³veis rurais em Mato Grosso.",
        "",
        "VocÃª receberÃ¡ anÃ¡lises individuais feitas por IA para diferentes imagens de satÃ©lite do MESMO imÃ³vel rural.",
        "Sua tarefa Ã© **sintetizar e comparar** essas anÃ¡lises para produzir um **laudo temporal integrado**.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 8 }),
        "",
        "---",
        "",
        `## AnÃ¡lises Individuais Realizadas (${labels.join(", ")})`,
        "",
        analysesBlock,
        "",
        "---",
        "",
        "## Sua Tarefa: Laudo Integrado Multi-temporal",
        "",
        "Produza um laudo ÃšNICO e COMPLETO que integre as anÃ¡lises acima. Seja objetivo e evite repetiÃ§Ãµes.",
        "",
        "### 1. AnÃ¡lise por Ano (obrigatÃ³ria)",
        `Crie um subtÃ­tulo para cada ano em **${years.join(", ")}** e descreva os achados de AC/AVN.`,
        "Em cada ano, inclua: uso antrÃ³pico, integridade da vegetaÃ§Ã£o, pontos de dÃºvida.",
        "",
        "### 2. ConexÃµes Entre os Anos (obrigatÃ³ria)",
        "Explique a linha do tempo conectando os anos entre si:",
        "- O que permaneceu estÃ¡vel ao longo dos anos?",
        "- Onde hÃ¡ indÃ­cio de mudanÃ§a (supressÃ£o ou regeneraÃ§Ã£o)?",
        "- Qual sequÃªncia temporal mais provÃ¡vel para essas mudanÃ§as?",
        "",
        "### 3. ComparaÃ§Ã£o CAR x HistÃ³rico",
        "- A Ãrea Consolidada (AC) jÃ¡ estava consolidada no ano mais antigo?",
        "- HÃ¡ AC com sinal de vegetaÃ§Ã£o nativa no passado?",
        "- HÃ¡ AVN com sinal de uso antrÃ³pico em algum ano?",
        "",
        "### 4. Marco Temporal (Art. 68, Lei 12.651/2012)",
        "- ReferÃªncia: **22/07/2008**.",
        "- Relacione explicitamente os anos anteriores e posteriores a 2008.",
        "",
        "### 5. ConcordÃ¢ncias e DiscordÃ¢ncias Consolidadas",
        "- **âœ… CONCORDA**: quando os anos confirmam a classificaÃ§Ã£o do CAR.",
        "- **âŒ DISCORDA**: quando algum ano contradiz o CAR (cite ano e evidÃªncia).",
        "- **âš ï¸ INCONCLUSIVO**: quando a limitaÃ§Ã£o do sensor impede conclusÃ£o robusta.",
        "",
        "### 6. NÃ­vel de ConfianÃ§a",
        "Classifique: **[ALTA]**, **[MÃ‰DIA]** ou **[BAIXA]** e justifique.",
        "",
        "### 7. ConclusÃ£o Integrada + RecomendaÃ§Ãµes",
        "- SÃ­ntese final da linha do tempo citando todos os anos.",
        "- RecomendaÃ§Ãµes prÃ¡ticas: vistoria, imagens extras, retificaÃ§Ã£o do CAR.",
        "",
        "---",
        "Responda em **portuguÃªs**, use markdown, seja detalhado e tÃ©cnico.",
        "NÃ£o inclua cadeia de raciocÃ­nio interna nem bloco <think>; entregue sÃ³ a resposta final.",
        "NÃƒO repita as anÃ¡lises individuais integralmente â€” sintetize e compare.",
    ].join("\n");
}

/* â”€â”€â”€ AUAS Analysis Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** Satellite keys used for AUAS analysis: only 2007 onwards, in chronological order. */
const AUAS_SATELLITE_KEYS: string[] = [
    "landsat5_2007",
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
 * For each satellite, generates 1 image: AUAS (white) + property (red) overlay.
 */
async function generateAuasSatelliteImages(
    res: Response,
    job: CachedJob,
): Promise<Array<{ dataUrl: string; caption: string }>> {
    const { bbox, polygon: propertyPolygon, clippedGeometries } = job;
    const paddedBbox = padBbox(bbox!, 0.10);
    const IMG_W = 1200;
    const IMG_H = 900;
    const layerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const images: Array<{ dataUrl: string; caption: string }> = [];

    const totalSteps = AUAS_SATELLITE_KEYS.length;
    let step = 0;

    for (const key of AUAS_SATELLITE_KEYS) {
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
            try {
                basePng = await fetchWmsImageBuffer([layerName], paddedBbox, IMG_W, IMG_H);
                break;
            } catch (err: any) {
                lastLayerError = err.message || String(err);
                console.warn(`[AUAS ANALYSIS] WMS ${sat.label} (${layerName}) failed: ${lastLayerError}`);
            }
        }

        if (!basePng) {
            console.warn(`[AUAS ANALYSIS] WMS ${sat.label} unavailable. Last error: ${lastLayerError}`);
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponÃ­vel, pulando...`,
            });
            step++;
            continue;
        }

        // AUAS overlay: white fill + property outline
        const auasSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AUAS", stroke: "#FFFFFF", fill: "rgba(255, 255, 255, 0.30)", strokeWidth: 2.5 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, auasSvg), caption: `${sat.label} â€” AUAS` });
        step++;

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `${sat.label}: imagem AUAS gerada âœ“`,
        });
    }

    return images;
}

/** Build prompt for a SINGLE satellite AUAS analysis (1 image per satellite). */
function buildAuasSingleSatPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    satelliteKey: string,
): string {
    const sat = SATELLITE_LAYERS[satelliteKey];
    const sensorInfo: Record<string, { name: string; res: string; bandTips: string }> = {
        sentinel2: {
            name: "Sentinel-2 MSI",
            res: "10m de resoluÃ§Ã£o espacial",
            bandTips: "ResoluÃ§Ã£o alta (10m) permite identificar com clareza limites de desmatamento, bordas de vegetaÃ§Ã£o nativa remanescente, e padrÃµes de pasto/agricultura. Preste atenÃ§Ã£o a diferenÃ§as de textura e tonalidade entre vegetaÃ§Ã£o densa (escura e homogÃªnea) e uso antrÃ³pico (mais clara, padrÃµes geomÃ©tricos).",
        },
        landsat8: {
            name: "Landsat 8 OLI",
            res: "30m de resoluÃ§Ã£o espacial",
            bandTips: "ResoluÃ§Ã£o de 30m â€” confiÃ¡vel para manchas de desmatamento maiores que ~1 ha. VegetaÃ§Ã£o nativa aparece como textura rugosa e verde-escura; Ã¡reas de pasto/recÃ©m-desmatadas aparecem mais homogÃªneas e claras. Solo exposto apresenta tons avermelhados ou amarelados.",
        },
        landsat5: {
            name: "Landsat 5 TM",
            res: "30m de resoluÃ§Ã£o espacial",
            bandTips: "Sensor histÃ³rico fundamental â€” mesma resoluÃ§Ã£o do L8 (30m). Por ser imagem mais antiga, pode ter maior presenÃ§a de nuvens ou ruÃ­do atmosfÃ©rico. Foque em padrÃµes claros: verde-escuro homogÃªneo = mata nativa; padrÃµes geomÃ©tricos com tons mais claros = uso consolidado (pastagem, lavoura).",
        },
        spot: {
            name: "SPOT",
            res: "2.5m de resoluÃ§Ã£o espacial",
            bandTips: "ResoluÃ§Ã£o MUITO ALTA (2.5m) â€” permite individualizar Ã¡rvores, cercas, estradas internas, corpos d'Ã¡gua pequenos. Esta Ã© a melhor imagem de referÃªncia para 2008 (ano do marco). Use-a como baseline detalhado: identifique com precisÃ£o quais parcelas da AUAS jÃ¡ estavam convertidas e quais mantinham vegetaÃ§Ã£o nativa.",
        },
    };
    const sensorKey = satelliteKey.startsWith("sentinel2") ? "sentinel2"
        : satelliteKey.startsWith("landsat8") ? "landsat8"
            : satelliteKey.startsWith("landsat5") ? "landsat5" : "spot";
    const sensor = sensorInfo[sensorKey];

    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    const acSummary = layerSummaries.find((l) => l.name === "AC" || l.name === "Consolidada");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN" || /vegeta/i.test(l.name));

    const isPreMarco = sat.year <= 2008;
    const yearsAfterMarco = sat.year - 2008;

    return [
        "VocÃª Ã© a **GeoForest IA**, perita em sensoriamento remoto e anÃ¡lise ambiental forense para imÃ³veis rurais em Mato Grosso.",
        `Sua especialidade Ã© identificar mudanÃ§as de uso e cobertura do solo (LULC) usando imagens de satÃ©lite e correlacionar com as declaraÃ§Ãµes do CAR.`,
        "",
        "---",
        "",
        "## Contexto do ImÃ³vel",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "| Camada | InformaÃ§Ã£o |",
        "| --- | --- |",
        auasSummary ? `| **AUAS** (Uso Alternativo do Solo) | ${auasSummary.areaHa?.toFixed(2) ?? '0'} ha â€” ${auasSummary.features ?? 0} feiÃ§Ãµes |` : "",
        acSummary ? `| **AC** (Ãrea Consolidada) | ${acSummary.areaHa?.toFixed(2) ?? '0'} ha â€” ${acSummary.features ?? 0} feiÃ§Ãµes |` : "",
        avnSummary ? `| **AVN** (VegetaÃ§Ã£o Nativa) | ${avnSummary.areaHa?.toFixed(2) ?? '0'} ha â€” ${avnSummary.features ?? 0} feiÃ§Ãµes |` : "",
        "",
        "---",
        "",
        `## Imagem Analisada: ${sat.label} â€” ${sensor.name} (${sensor.res})`,
        "",
        `**Dicas de interpretaÃ§Ã£o para este sensor:** ${sensor.bandTips}`,
        "",
        "**Legenda visual dos polÃ­gonos na imagem:**",
        "- ðŸŸ¥ **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP/AIR do CAR)",
        "- â¬œ **Branco semi-transparente (preenchimento)**: **AUAS** â€” Ãrea de Uso Alternativo do Solo declarada no CAR",
        "",
        "---",
        "",
        "## Marco Legal de ReferÃªncia",
        "",
        "O **Art. 68 da Lei 12.651/2012** (CÃ³digo Florestal) estabelece que Ã¡reas rurais que jÃ¡ estavam consolidadas " +
        "com atividades agrossilvipastoris atÃ© **22/07/2008** podem ser mantidas nessa condiÃ§Ã£o, desde que corretamente " +
        "declaradas no CAR. A AUAS Ã© a camada do CAR que delimita essas Ã¡reas de uso alternativo.",
        "",
        `â±ï¸ **Ano desta imagem: ${sat.year}** â€” ` + (isPreMarco
            ? `Esta imagem Ã© **${sat.year === 2008 ? 'DO' : 'ANTERIOR AO'}** marco temporal (22/07/2008). Serve como PROVA BASELINE do estado da terra antes/no marco.`
            : `Esta imagem Ã© **${yearsAfterMarco} ano(s) APÃ“S** o marco temporal. Qualquer supressÃ£o de vegetaÃ§Ã£o nativa dentro da AUAS detectada NESTE ano indica irregularidade.`),
        "",
        "---",
        "",
        "## InstruÃ§Ãµes de AnÃ¡lise",
        "",
        "### 1. Estado da AUAS neste ano",
        "Observe EXCLUSIVAMENTE a Ã¡rea demarcada em branco (AUAS) e descreva:",
        "- **Cobertura predominante**: vegetaÃ§Ã£o nativa densa, vegetaÃ§Ã£o nativa rala/degradada, pasto, lavoura, solo exposto, Ã¡rea construÃ­da, espelho d'Ã¡gua, ou mista?",
        "- **ProporÃ§Ã£o estimada**: qual % da AUAS estÃ¡ sob cada tipo de uso? (ex: 70% pasto, 20% vegetaÃ§Ã£o nativa, 10% solo exposto)",
        "- **PadrÃµes geogrÃ¡ficos**: as Ã¡reas de uso antrÃ³pico estÃ£o concentradas em qual parte? (norte, sul, centro, bordas)",
        "",
        "### 2. Indicadores de Desmatamento",
        "Procure evidÃªncias visuais de supressÃ£o recente:",
        "- Solo exposto de formato geomÃ©trico (indicando corte raso)",
        "- Bordas abruptas entre vegetaÃ§Ã£o nativa e Ã¡rea desmatada",
        "- Queimadas (tons pretos/cinza com padrÃ£o de fogo)",
        "- Estradas novas cortando vegetaÃ§Ã£o",
        "- VegetaÃ§Ã£o secundÃ¡ria (capoeira) â€” indica desmatamento anterior com regeneraÃ§Ã£o parcial",
        "",
        "### 3. ConclusÃ£o Parcial para este ano",
        "Use OBRIGATORIAMENTE um dos seguintes vereditos:",
        "- **âœ… USO ANTRÃ“PICO CONSOLIDADO**: A AUAS mostra uso antrÃ³pico neste ano â€” coerente com a declaraÃ§Ã£o do CAR.",
        "- **âŒ VEGETAÃ‡ÃƒO NATIVA PRESENTE**: A AUAS mostra vegetaÃ§Ã£o nativa significativa (>30%) â€” a declaraÃ§Ã£o de AUAS nesta Ã¡rea Ã© questionÃ¡vel.",
        "- **ðŸ”´ DESMATAMENTO RECENTE DETECTADO**: EvidÃªncia clara de supressÃ£o recente dentro da AUAS (solo exposto, queimada, corte).",
        "- **âš ï¸ INCONCLUSIVO**: ResoluÃ§Ã£o do sensor, cobertura de nuvens ou outros fatores impedem determinaÃ§Ã£o confiÃ¡vel.",
        "",
        "---",
        "Responda em **portuguÃªs**, use markdown, seja OBJETIVO e TÃ‰CNICO (250â€“400 palavras).",
        "NÃ£o inclua cadeia de raciocÃ­nio interna nem bloco <think>; entregue sÃ³ a resposta final.",
    ].join("\n");
}

/**
 * Build the final synthesis prompt for AUAS analysis â€” produces a
 * professional environmental forensics report combining per-satellite
 * observations with previous AC/AVN analysis.
 */
function buildAuasFinalSynthesisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    perSatelliteAnalyses: Array<{ satelliteLabel: string; year: number; analysis: string }>,
    previousAcAvnAnalysis?: string,
): string {
    const labels = perSatelliteAnalyses.map((a) => a.satelliteLabel);
    const years = perSatelliteAnalyses.map((a) => a.year).sort();
    const preMarco = years.filter((y) => y <= 2008);
    const postMarco = years.filter((y) => y > 2008);

    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    const acSummary = layerSummaries.find((l) => l.name === "AC" || l.name === "Consolidada");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN" || /vegeta/i.test(l.name));

    const analysesBlock = perSatelliteAnalyses.map((a) => [
        `### ${a.satelliteLabel} (${a.year})`,
        "",
        toSynthesisExcerpt(a.analysis),
    ].join("\n")).join("\n\n---\n\n");

    const parts: string[] = [
        "VocÃª Ã© a **GeoForest IA**, perita em sensoriamento remoto e anÃ¡lise ambiental forense, especializada em imÃ³veis rurais de Mato Grosso.",
        "",
        "Sua tarefa: produzir um **Laudo TÃ©cnico de AnÃ¡lise da AUAS** profissional e impactante, " +
        "combinando as anÃ¡lises por satÃ©lite individuais com o contexto legal e ambiental do imÃ³vel.",
        "",
        "---",
        "",
        "## Dados do ImÃ³vel",
        "",
        buildPropertyContext(areaHa, layerSummaries, { compact: true, maxRows: 10 }),
        "",
        "### Camadas do CAR relevantes para esta anÃ¡lise:",
        "| Camada | Ãrea | FeiÃ§Ãµes |",
        "| --- | --- | --- |",
        auasSummary ? `| **AUAS** (Uso Alternativo do Solo) | ${auasSummary.areaHa?.toFixed(2) ?? 'â€”'} ha | ${auasSummary.features ?? 0} |` : "",
        acSummary ? `| **AC** (Ãrea Consolidada) | ${acSummary.areaHa?.toFixed(2) ?? 'â€”'} ha | ${acSummary.features ?? 0} |` : "",
        avnSummary ? `| **AVN** (VegetaÃ§Ã£o Nativa) | ${avnSummary.areaHa?.toFixed(2) ?? 'â€”'} ha | ${avnSummary.features ?? 0} |` : "",
        "",
        "---",
        "",
        `## AnÃ¡lises AUAS por SatÃ©lite (${labels.length} imagens: ${years[0]}â€“${years[years.length - 1]})`,
        "",
        `**Imagens prÃ©-marco (â‰¤2008):** ${preMarco.length > 0 ? preMarco.join(", ") : "nenhuma"} | **Imagens pÃ³s-marco (>2008):** ${postMarco.length > 0 ? postMarco.join(", ") : "nenhuma"}`,
        "",
        analysesBlock,
        "",
    ];

    if (previousAcAvnAnalysis) {
        parts.push(
            "---",
            "",
            "## ðŸ“‹ AnÃ¡lise Anterior â€” Ãrea Consolidada (AC) e VegetaÃ§Ã£o Nativa (AVN)",
            "",
            "**A IA jÃ¡ analisou as camadas AC e AVN deste imÃ³vel usando as mesmas imagens de satÃ©lite.**",
            "Use este resultado como referÃªncia cruzada â€” as conclusÃµes da AUAS devem ser COERENTES com as da AC:",
            "",
            toSynthesisExcerpt(previousAcAvnAnalysis, 4000),
            "",
        );
    }

    parts.push(
        "---",
        "",
        "## ðŸ“ PRODUZA O LAUDO TÃ‰CNICO COM A SEGUINTE ESTRUTURA:",
        "",
        "### ðŸ”° Resumo Executivo",
        "Comece com um resumo impactante de 3â€“4 linhas: a AUAS declarada estÃ¡ correta, incorreta ou parcialmente correta?",
        "Inclua a Ã¡rea total analisada, o perÃ­odo de cobertura e o veredito principal.",
        "",
        "### ðŸ“… Linha do Tempo",
        `Crie uma tabela temporal com colunas: **Ano** | **Sensor** | **Cobertura da AUAS** | **Veredito** | **ObservaÃ§Ãµes**`,
        `Os vereditos devem usar: âœ… Consolidado | âŒ Veg. Nativa | ðŸ”´ Desmatamento | âš ï¸ Inconclusivo`,
        "",
        `Para cada ano analisado (${years.join(", ")}), indique:`,
        "- Qual era a cobertura predominante dentro da AUAS (pasto, lavoura, mata, misto)",
        "- Se houve alguma mudanÃ§a visÃ­vel em relaÃ§Ã£o ao ano anterior",
        "- Se hÃ¡ evidÃªncia de supressÃ£o recente de vegetaÃ§Ã£o nativa",
        "",
        "### ðŸ” DetecÃ§Ã£o de Desmatamentos Irregulares",
        "",
        "**Marco legal**: Art. 68 da Lei 12.651/2012 â€” Ã¡reas de uso alternativo consolidadas atÃ© 22/07/2008.",
        "",
        "Se a AUAS continha vegetaÃ§Ã£o nativa nas imagens de 2007â€“2008 (baseline) e essa vegetaÃ§Ã£o",
        "foi suprimida em anos posteriores, identifique COM PRECISÃƒO:",
        "- **Em qual intervalo de anos** ocorreu cada supressÃ£o (ex: \"entre 2013 e 2014\")",
        "- **Em qual parte do polÃ­gono** (norte, sul, centro, porÃ§Ã£o X ha)",
        "- **Qual a Ã¡rea aproximada** afetada pela supressÃ£o irregular",
        "- **Tipo de evidÃªncia**: solo exposto geomÃ©trico, queimada, remoÃ§Ã£o parcial, etc.",
        "",
        "Se NÃƒO houve desmatamento irregular, declare explicitamente: \"Nenhum desmatamento irregular detectado.\"",
        "",
    );

    if (previousAcAvnAnalysis) {
        parts.push(
            "### ðŸ”— IntegraÃ§Ã£o com AnÃ¡lise AC/AVN",
            "",
            "Este Ã© um dos pontos mais importantes â€” cruze os dados:",
            "- A **AC** (Ãrea Consolidada) e a **AUAS** se sobrepÃµem? SÃ£o coerentes?",
            "- Se a AC foi considerada \"concordante\" na anÃ¡lise anterior, a AUAS na mesma regiÃ£o tambÃ©m deve ser?",
            "- Se houve discordÃ¢ncia na AC (vegetaÃ§Ã£o nativa onde deveria ser consolidada), a AUAS na mesma Ã¡rea confirma essa discordÃ¢ncia?",
            "- A **AVN** estÃ¡ Ã­ntegra nas Ã¡reas fora da AUAS? HÃ¡ invasÃ£o de uso antrÃ³pico em Ã¡reas de AVN?",
            "- Identifique CONTRADIÃ‡Ã•ES entre a anÃ¡lise AC/AVN e a AUAS (ex: AC diz consolidada, mas AUAS mostra mata)",
            "",
        );
    }

    const nextNum = previousAcAvnAnalysis ? 5 : 4;
    parts.push(
        `### ðŸŽ¯ Veredito Final sobre a AUAS`,
        "",
        "Use OBRIGATORIAMENTE um destes:",
        "- **âœ… AUAS VÃLIDA**: Todo o polÃ­gono declarado como AUAS jÃ¡ era de uso antrÃ³pico consolidado em julho/2008. A declaraÃ§Ã£o do CAR estÃ¡ correta.",
        "- **âŒ AUAS INVÃLIDA**: O polÃ­gono declarado como AUAS continha vegetaÃ§Ã£o nativa que foi ilegalmente suprimida apÃ³s julho/2008.",
        "- **âš ï¸ AUAS PARCIALMENTE VÃLIDA**: Parte do polÃ­gono estÃ¡ correta (uso consolidado prÃ©-2008), mas [X] ha apresentam supressÃ£o irregular pÃ³s-2008.",
        "",
        `### ðŸ“Š NÃ­vel de ConfianÃ§a`,
        "Classifique a confianÃ§a global: **[ALTA]**, **[MÃ‰DIA]** ou **[BAIXA]**.",
        "Justifique com base na qualidade das imagens, cobertura temporal e consistÃªncia entre sensores.",
        "",
        `### ðŸ’¡ RecomendaÃ§Ãµes`,
        "Liste aÃ§Ãµes concretas e priorizadas:",
        "- Necessidade de vistoria em campo?",
        "- Imagens adicionais (RapidEye, Planet, drones) para confirmar?",
        "- RetificaÃ§Ã£o do CAR necessÃ¡ria?",
        "- NotificaÃ§Ã£o ou autuaÃ§Ã£o cabÃ­vel?",
        "- AnÃ¡lise de sobreposiÃ§Ã£o com Terras IndÃ­genas, UCs, APPs?",
        "",
        "---",
        "",
        "âš¡ **REGRAS DE FORMATAÃ‡ÃƒO:**",
        "- Responda em **portuguÃªs**, use markdown rico (tabelas, emojis, negrito, listas)",
        "- Seja **tÃ©cnico, detalhado e persuasivo** â€” imagine que este laudo serÃ¡ lido por um promotor do MP-MT",
        "- NÃƒO repita as anÃ¡lises individuais na Ã­ntegra â€” sintetize, compare e conclua",
        "- Use dados quantitativos sempre que possÃ­vel (Ã¡reas em ha, percentuais, intervalos de anos)",
        "- O laudo deve ter entre 600 e 1200 palavras",
        "- NÃ£o inclua cadeia de raciocÃ­nio interna nem bloco <think>; entregue sÃ³ a resposta final",
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
) {
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
            message: "Job nÃ£o encontrado. Envie contextUrl ou gere o recorte novamente.",
        });
        return;
    }

    const { layerSummaries, areaHa: propAreaHa } = job;
    const areaHa = propAreaHa ?? 0;

    // Check if AUAS exists in clipped geometries
    const auasGeoms = job.clippedGeometries?.get("AUAS");
    if (!auasGeoms || auasGeoms.length === 0) {
        sendSSE(res, {
            type: "error",
            message: "Camada AUAS nÃ£o encontrada no recorte. Verifique se o imÃ³vel possui AUAS declarada no CAR.",
        });
        return;
    }

    // Step 1: Generate satellite images with AUAS overlay
    sendSSE(res, { type: "progress", step: "generating_images", percent: 5, message: "Iniciando geraÃ§Ã£o de imagens AUAS..." });

    let imagesToAnalyze: Array<{ dataUrl: string; caption: string }>;
    try {
        imagesToAnalyze = await generateAuasSatelliteImages(res, job);
    } catch (err: any) {
        console.error("[AUAS ANALYSIS] Image generation error:", err.message);
        sendSSE(res, { type: "error", message: `Erro ao gerar imagens AUAS: ${err.message}` });
        return;
    }

    if (imagesToAnalyze.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem AUAS foi gerada. Verifique a disponibilidade das camadas WMS." });
        return;
    }

    // Step 2: Upload to Cloudinary
    sendSSE(res, { type: "progress", step: "uploading_images", percent: 50, message: "Salvando imagens AUAS no Cloudinary..." });

    const cloudinaryUrls: Array<{ url: string; caption: string }> = [];
    try {
        for (let i = 0; i < imagesToAnalyze.length; i++) {
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
    sendSSE(res, { type: "progress", step: "analyzing", percent: 62, message: "Preparando imagens AUAS para anÃ¡lise IA..." });

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

    // Step 4: Per-satellite AI analysis
    const perSatResults: Array<{ satelliteLabel: string; year: number; analysis: string }> = [];
    const validKeys = AUAS_SATELLITE_KEYS.filter((k) => SATELLITE_LAYERS[k]);
    let satIdx = 0;

    for (const key of validKeys) {
        const sat = SATELLITE_LAYERS[key];
        if (!sat) continue;

        const satImages = aiImages.filter((img) => img.caption.startsWith(sat.label));
        if (satImages.length === 0) { satIdx++; continue; }

        const progressPct = 65 + Math.round((satIdx / validKeys.length) * 20);
        sendSSE(res, {
            type: "progress", step: "analyzing", percent: progressPct,
            message: `IA analisando AUAS em ${sat.label} (${satIdx + 1}/${validKeys.length})...`,
        });

        try {
            const prompt = buildAuasSingleSatPrompt(areaHa, layerSummaries, key);
            const result = await analyzeWithGroqAndGemini(satImages, prompt, `AUAS ${sat.label} (${sat.year})`);
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
                message: `Aviso: anÃ¡lise AUAS de ${sat.label} falhou, continuando...`,
            });
        }
        satIdx++;
    }

    perSatResults.sort((a, b) => a.year - b.year || a.satelliteLabel.localeCompare(b.satelliteLabel));

    if (perSatResults.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma anÃ¡lise AUAS individual foi concluÃ­da com sucesso." });
        return;
    }

    // Step 5: Final synthesis (combines AUAS + previous AC/AVN analysis)
    sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA sintetizando laudo integrado de AUAS..." });

    let analysisText: string;
    try {
        const synthesisPrompt = buildAuasFinalSynthesisPrompt(areaHa, layerSummaries, perSatResults, previousAnalysis);
        analysisText = await callBestTextSynthesis(
            [{ role: "user", content: synthesisPrompt }],
            "sintese AUAS final",
        );
        const split = splitThinkProgress(analysisText);
        if (split.thinkingText) {
            sendSSE(res, { type: "model_thinking", source: "SÃ­ntese AUAS", thinkingText: split.thinkingText });
        }
        console.log(`[AUAS ANALYSIS] Final synthesis complete (${analysisText.length} chars)`);
    } catch (err: any) {
        console.error("[AUAS ANALYSIS] Synthesis failed, concatenating:", err.message);
        analysisText = perSatResults.map((r) => [
            `## AUAS: ${r.satelliteLabel} (${r.year})`,
            "",
            r.analysis,
        ].join("\n")).join("\n\n---\n\n");
    }

    // Step 6: Complete
    const auasSummary = layerSummaries.find((l) => l.name === "AUAS");
    sendSSE(res, {
        type: "complete",
        percent: 100,
        analysis: analysisText,
        images: cloudinaryUrls,
        layerSummaries: layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
        auasAreaHa: auasSummary?.areaHa ?? 0,
    });
}

/**
 * Generate composited satellite images for given layers.
 * Returns array of { dataUrl, caption } for each satellite Ã— 3 views.
 */
async function generateSatelliteImages(
    res: Response,
    job: CachedJob,
    selectedLayers: string[],
): Promise<Array<{ dataUrl: string; caption: string }>> {
    const { bbox, polygon: propertyPolygon, clippedGeometries } = job;
    const paddedBbox = padBbox(bbox!, 0.10);
    const IMG_W = 1200;
    const IMG_H = 900;
    const layerGeos = clippedGeometries ?? new Map<string, Geometry[]>();
    const images: Array<{ dataUrl: string; caption: string }> = [];

    const validKeys = getOrderedSatelliteKeys(selectedLayers);

    const totalSteps = validKeys.length * 3;
    let step = 0;

    for (const key of validKeys) {
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
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponÃ­vel, pulando...`,
            });
            step += 3;
            continue;
        }
        if (resolvedLayer && resolvedLayer !== sat.wmsLayer) {
            console.log(`[SIMCAR ANALYSIS] ${sat.label} using fallback layer ${resolvedLayer} (primary=${sat.wmsLayer})`);
        }

        // 3 composites per satellite
        // 1: Overview (AC + AVN + property)
        const overviewSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.20)", strokeWidth: 2 },
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.20)", strokeWidth: 2 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, overviewSvg), caption: `${sat.label} â€” VisÃ£o Geral (propriedade + AC + AVN)` });
        step++;

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `${sat.label}: renderizando Ãrea Consolidada...`,
        });

        // 2: AC only
        const acSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.25)", strokeWidth: 2.5 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, acSvg), caption: `${sat.label} â€” Ãrea Consolidada` });
        step++;

        // 3: AVN only
        const avnSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.25)", strokeWidth: 2.5 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, avnSvg), caption: `${sat.label} â€” AVN` });
        step++;
    }

    return images;
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
            throw new Error("NÃ£o foi possÃ­vel reconstruir contexto pelo ZIP");
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
            throw new Error("Formato de contexto invÃ¡lido");
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

/** Main analysis pipeline (called from the SSE endpoint). */
async function processAnalysis(
    res: Response,
    jobId: string,
    selectedLayers: string[] = ["spot_2008"],
    aiAnalysis = true,
    contextUrl?: string,
    outputZipUrl?: string,
) {
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
                "Job nÃ£o encontrado no cache do servidor. Envie contextUrl salvo no Firebase/Cloudinary para reidratar ou gere o recorte novamente.",
        });
        return;
    }

    const { layerSummaries, areaHa: propAreaHa } = job;
    const areaHa = propAreaHa ?? 0;

    // Step 1: Generate satellite images with polygon overlays
    sendSSE(res, { type: "progress", step: "generating_images", percent: 10, message: "Iniciando geraÃ§Ã£o de imagens..." });

    let imagesToAnalyze: Array<{ dataUrl: string; caption: string }>;
    try {
        imagesToAnalyze = await generateSatelliteImages(res, job, selectedLayers);
    } catch (err: any) {
        console.error("[SIMCAR ANALYSIS] Image generation error:", err.message);
        sendSSE(res, { type: "error", message: `Erro ao gerar imagens: ${err.message}` });
        return;
    }

    if (imagesToAnalyze.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem de satÃ©lite foi gerada. Verifique a disponibilidade das camadas WMS." });
        return;
    }

    // Step 2: Upload to Cloudinary (full quality for user viewing)
    sendSSE(res, { type: "progress", step: "uploading_images", percent: 50, message: "Salvando imagens no Cloudinary..." });

    const cloudinaryUrls: Array<{ url: string; caption: string }> = [];
    try {
        for (let i = 0; i < imagesToAnalyze.length; i++) {
            const img = imagesToAnalyze[i];
            const filename = `simcar_analysis_${jobId.slice(0, 8)}_img${i + 1}`;
            const url = await uploadToCloudinary(img.dataUrl, filename);
            cloudinaryUrls.push({ url, caption: img.caption });
            console.log(`[SIMCAR ANALYSIS] Uploaded image ${i + 1}: ${url}`);
            sendSSE(res, {
                type: "progress", step: "uploading_images",
                percent: 50 + Math.round(((i + 1) / imagesToAnalyze.length) * 10),
                message: `Upload ${i + 1}/${imagesToAnalyze.length}...`,
            });
        }
    } catch (err: any) {
        console.error("[SIMCAR ANALYSIS] Cloudinary upload error:", err.message);
        sendSSE(res, { type: "progress", step: "uploading_images", percent: 60, message: "Aviso: falha ao salvar no Cloudinary. Continuando..." });
    }

    if (!aiAnalysis) {
        // Image-only mode: return images without AI analysis
        sendSSE(res, {
            type: "complete",
            percent: 100,
            images: cloudinaryUrls,
            layerSummaries: layerSummaries.filter((l) => ["AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
        });
        return;
    }

    // Step 3: Prepare images for AI (use Cloudinary URLs or compress base64 as fallback)
    sendSSE(res, { type: "progress", step: "analyzing", percent: 62, message: "Preparando imagens para anÃ¡lise IA..." });

    const aiImages: AiImage[] = [];
    if (cloudinaryUrls.length === imagesToAnalyze.length) {
        for (const cu of cloudinaryUrls) {
            // url      â†’ Groq vision: 800Ã—600 JPEG q65 (fewer input tokens)
            // geminiUrl â†’ Gemini vision: 1024Ã—768 JPEG q82 (more detail for precise analysis)
            // Both derived via Cloudinary on-the-fly transformations from the original full-res PNG.
            aiImages.push({
                url: getCloudinaryAiUrl(cu.url),
                geminiUrl: getCloudinaryGeminiUrl(cu.url),
                caption: cu.caption,
            });
        }
        console.log(`[SIMCAR ANALYSIS] Using ${aiImages.length} Cloudinary URLs (Groq: 800Ã—600 q65 / Gemini: 1024Ã—768 q82) for vision API`);
    } else {
        console.log(`[SIMCAR ANALYSIS] Cloudinary partial/failed, compressing ${imagesToAnalyze.length} images for vision API`);
        for (const img of imagesToAnalyze) {
            try {
                const compressed = await compressForVision(img.dataUrl);
                aiImages.push({ dataUrl: compressed, caption: img.caption });
            } catch {
                aiImages.push({ dataUrl: img.dataUrl, caption: img.caption });
            }
        }
    }

    // Step 4: AI Analysis â€” strategy depends on number of satellites
    const validKeys = getOrderedSatelliteKeys(selectedLayers);
    const isMultiSatellite = validKeys.length > 1;

    let analysisText: string;

    if (isMultiSatellite && SIMCAR_ANALYSIS_MODE !== "detailed") {
        console.log(
            `[SIMCAR ANALYSIS] Multi-satellite mode using efficient strategy (single unified call). ` +
            `Set SIMCAR_ANALYSIS_MODE=detailed to enable per-satellite synthesis.`,
        );
    }

    if (isMultiSatellite && SIMCAR_ANALYSIS_MODE === "detailed") {
        // â”€â”€ MULTI-SATELLITE (detailed mode): analyze each satellite separately, then synthesize â”€â”€
        console.log(`[SIMCAR ANALYSIS] Multi-satellite mode: ${validKeys.length} satellites, analyzing individually...`);

        const perSatelliteResults: Array<{ satelliteLabel: string; year: number; analysis: string }> = [];
        let satIdx = 0;

        for (const key of validKeys) {
            const sat = SATELLITE_LAYERS[key];
            if (!sat) continue;

            // Extract the 3 images for this satellite (based on caption containing the label)
            const satImages = aiImages.filter((img) => img.caption.startsWith(sat.label));
            if (satImages.length === 0) {
                console.warn(`[SIMCAR ANALYSIS] No images found for ${sat.label}, skipping individual analysis`);
                satIdx++;
                continue;
            }

            const progressPct = 65 + Math.round((satIdx / validKeys.length) * 20);
            sendSSE(res, {
                type: "progress", step: "analyzing", percent: progressPct,
                message: `IA analisando ${sat.label} (${satIdx + 1}/${validKeys.length})...`,
            });

            try {
                const prompt = buildSingleSatellitePrompt(areaHa, layerSummaries, key);
                const result = await analyzeWithGroqAndGemini(
                    satImages,
                    prompt,
                    `${sat.label} (${sat.year})`,
                );
                const split = splitThinkProgress(result);
                if (split.thinkingText) {
                    sendSSE(res, {
                        type: "model_thinking",
                        source: `${sat.label} (${sat.year})`,
                        thinkingText: split.thinkingText,
                    });
                }
                perSatelliteResults.push({ satelliteLabel: sat.label, year: sat.year, analysis: result });
                console.log(`[SIMCAR ANALYSIS] ${sat.label} analysis complete (${result.length} chars)`);
            } catch (err: any) {
                console.error(`[SIMCAR ANALYSIS] ${sat.label} analysis failed:`, err.message);
                sendSSE(res, {
                    type: "progress", step: "analyzing", percent: progressPct,
                    message: `Aviso: anÃ¡lise de ${sat.label} falhou, continuando com os demais...`,
                });
            }
            satIdx++;
        }

        perSatelliteResults.sort((a, b) => (a.year - b.year) || a.satelliteLabel.localeCompare(b.satelliteLabel));

        if (perSatelliteResults.length === 0) {
            // All individual analyses failed â€” try legacy single-call as last resort
            console.warn(`[SIMCAR ANALYSIS] All individual analyses failed, trying legacy single-call...`);
            sendSSE(res, { type: "progress", step: "analyzing", percent: 85, message: "Tentando anÃ¡lise unificada como fallback..." });
            try {
                const prompt = buildAnalysisPrompt(areaHa, layerSummaries, selectedLayers);
                analysisText = await analyzeWithGroqAndGemini(
                    aiImages,
                    prompt,
                    "AnÃ¡lise unificada multitemporal",
                );
            } catch (err: any) {
                console.error("[SIMCAR ANALYSIS] Legacy fallback also failed:", err.message);
                sendSSE(res, { type: "error", message: `Erro na anÃ¡lise IA: ${err.message}` });
                return;
            }
        } else if (perSatelliteResults.length === 1) {
            // Only one satellite succeeded â€” return its analysis directly (no synthesis needed)
            analysisText = perSatelliteResults[0].analysis;
        } else {
            // Multiple results â€” synthesize with temporal comparison
            sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA sintetizando anÃ¡lise temporal comparativa..." });
            try {
                const synthesisPrompt = buildSynthesisPrompt(areaHa, layerSummaries, perSatelliteResults);
                analysisText = await callBestTextSynthesis(
                    [{ role: "user", content: synthesisPrompt }],
                    "sintese temporal final",
                );
                const split = splitThinkProgress(analysisText);
                if (split.thinkingText) {
                    sendSSE(res, {
                        type: "model_thinking",
                        source: "Sintese temporal",
                        thinkingText: split.thinkingText,
                    });
                }
                console.log(`[SIMCAR ANALYSIS] Synthesis complete (${analysisText.length} chars)`);
            } catch (err: any) {
                // Synthesis failed â€” concatenate individual analyses as fallback
                console.error("[SIMCAR ANALYSIS] Synthesis failed, concatenating analyses:", err.message);
                analysisText = perSatelliteResults.map((r) => [
                    `## AnÃ¡lise: ${r.satelliteLabel} (${r.year})`,
                    "",
                    r.analysis,
                ].join("\n")).join("\n\n---\n\n");
            }
        }
    } else {
        // â”€â”€ EFFICIENT MODE (default) OR SINGLE SATELLITE: one unified call â”€â”€
        const isUnifiedMulti = isMultiSatellite && SIMCAR_ANALYSIS_MODE !== "detailed";
        sendSSE(res, {
            type: "progress",
            step: "analyzing",
            percent: 65,
            message: isUnifiedMulti
                ? "IA analisando recorte multitemporal em chamada Ãºnica (modo eficiente)..."
                : "IA analisando imagens...",
        });
        try {
            const prompt = buildAnalysisPrompt(areaHa, layerSummaries, selectedLayers);
            const singleContext = validKeys
                .map((k) => `${SATELLITE_LAYERS[k]?.label || k} (${SATELLITE_LAYERS[k]?.year || "?"})`)
                .join(" / ");
            analysisText = await analyzeWithGroqAndGemini(
                aiImages,
                prompt,
                singleContext || "AnÃ¡lise de um Ãºnico satÃ©lite",
            );
            const split = splitThinkProgress(analysisText);
            if (split.thinkingText) {
                sendSSE(res, {
                    type: "model_thinking",
                    source: singleContext || "Analise unica",
                    thinkingText: split.thinkingText,
                });
            }
        } catch (err: any) {
            console.error("[SIMCAR ANALYSIS] AI analysis error:", err.message);
            sendSSE(res, { type: "error", message: `Erro na anÃ¡lise IA: ${err.message}` });
            return;
        }
    }

    // Step 5: Complete
    sendSSE(res, {
        type: "complete",
        percent: 100,
        analysis: analysisText,
        images: cloudinaryUrls,
        layerSummaries: layerSummaries.filter((l) => ["AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
    });
}

/* â”€â”€â”€ Express Route Registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
    app.post("/api/simcar/clip", async (req: Request, res: Response) => {
        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
            const body = req.body as {
                propertyZip?: string;
                filename?: string;
                layerNames?: string[];
                airIdentificacao?: string;
            };

            if (!body.propertyZip) {
                sendSSE(res, { type: "error", message: "Campo propertyZip (base64) Ã© obrigatÃ³rio." });
                res.end();
                return;
            }

            let zipBuffer: Buffer;
            try {
                zipBuffer = Buffer.from(body.propertyZip, "base64");
            } catch {
                sendSSE(res, { type: "error", message: "Base64 do ZIP invÃ¡lido." });
                res.end();
                return;
            }

            if (zipBuffer.length < 22) {
                sendSSE(res, { type: "error", message: "ZIP muito pequeno para ser vÃ¡lido." });
                res.end();
                return;
            }

            console.log(
                `[SIMCAR CLIP] Processing: ${body.filename || "unknown"}, ` +
                `size=${zipBuffer.length}, layers=${body.layerNames?.length || "all"}`,
            );

            await processClip(res, zipBuffer, body.layerNames || null, body.airIdentificacao || undefined);
        } catch (err: any) {
            console.error("[SIMCAR CLIP] Unexpected error:", err);
            sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // Download endpoint
    app.get("/api/simcar/clip/download/:jobId", (req: Request, res: Response) => {
        const { jobId } = req.params;
        const cached = jobCache.get(jobId);

        if (!cached || cached.expiresAt <= Date.now()) {
            if (cached) jobCache.delete(jobId);
            res.status(404).json({
                error: "Download expirado ou nÃ£o encontrado. Processe novamente.",
            });
            return;
        }
        if (!cached.buffer) {
            if (cached.outputZipUrl) {
                res.redirect(cached.outputZipUrl);
                return;
            }
            res.status(404).json({ error: "Arquivo do recorte nÃ£o disponÃ­vel no cache." });
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
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { jobId, previousAnalysis, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                previousAnalysis?: string;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }

            billingRequestId = createRequestId("simcar_auas");
            billingReserved = await estimateReserveForModels({
                models: simcarBillingModels,
                estimatedInputTokens: 900_000,
                estimatedOutputTokens: 48_000,
                safetyMultiplier: 1.8,
            });
            await reserveCredits({
                uid,
                amountBrl: billingReserved,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze-auas",
            });

            sendSseHeaders(res);
            console.log(`[AUAS ANALYSIS] Starting AUAS analysis for job: ${jobId}`);
            await runWithBillingUsageSession(async () => {
                await processAuasAnalysis(res, jobId, previousAnalysis, contextUrl, outputZipUrl);
            });
            const usageInputs = getBillingUsageSessionRecords();
            if (usageInputs.length > 0) {
                const billing = await settleReservedCredits({
                    uid,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reservedBrl: billingReserved,
                    usageInputs,
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

            const layers = Array.isArray(selectedLayers) && selectedLayers.length > 0 ? selectedLayers : ["spot_2008"];
            const aiAnalysis = !imageOnly;

            if (aiAnalysis) {
                const satelliteFactor = Math.max(1, layers.length + 1);
                billingRequestId = createRequestId("simcar_analyze");
                billingReserved = await estimateReserveForModels({
                    models: simcarBillingModels,
                    estimatedInputTokens: 180_000 * satelliteFactor,
                    estimatedOutputTokens: 12_000 * satelliteFactor,
                    safetyMultiplier: 1.8,
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
                await runWithBillingUsageSession(async () => {
                    await processAnalysis(res, jobId, layers, true, contextUrl, outputZipUrl);
                });
                const usageInputs = getBillingUsageSessionRecords();
                if (usageInputs.length > 0) {
                    const billing = await settleReservedCredits({
                        uid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze",
                        reservedBrl: billingReserved,
                        usageInputs,
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
                safetyMultiplier: 1.5,
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
                if (usageInputs.length > 0) {
                    const billing = await settleReservedCredits({
                        uid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze/chat",
                        reservedBrl: billingReserved,
                        usageInputs,
                    });
                    billingReserved = 0;
                    sendSSE(res, { type: "billing", billing });
                } else if (billingReserved > 0) {
                    await refundReserve({
                        uid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze/chat",
                        reason: "no_ai_usage",
                    });
                    billingReserved = 0;
                }
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
        const { imageUrls, inputZipUrl, outputZipUrl, contextUrl } = req.body as {
            imageUrls?: string[];
            inputZipUrl?: string;
            outputZipUrl?: string;
            contextUrl?: string;
        };

        try {
            const cached = jobCache.get(jobId);
            const deletions: Promise<void>[] = [];

            // Delete ZIPs from Cloudinary (raw type)
            if (cached?.inputZipUrl || inputZipUrl) {
                deletions.push(deleteFromCloudinary((cached?.inputZipUrl || inputZipUrl) as string, "raw"));
            }
            if (cached?.outputZipUrl || outputZipUrl) {
                deletions.push(deleteFromCloudinary((cached?.outputZipUrl || outputZipUrl) as string, "raw"));
            }
            if (cached?.contextJsonUrl || contextUrl) {
                deletions.push(deleteFromCloudinary((cached?.contextJsonUrl || contextUrl) as string, "raw"));
            }

            // Delete analysis images from Cloudinary (image type)
            if (Array.isArray(imageUrls)) {
                for (const url of imageUrls) {
                    deletions.push(deleteFromCloudinary(url, "image"));
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





