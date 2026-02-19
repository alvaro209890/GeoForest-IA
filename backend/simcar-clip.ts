/**
 * SIMCAR Clip — Automated clipping of SEMA-MT SIMCAR WFS layers
 * to the geometry of a user-provided property polygon.
 *
 * Registers endpoints:
 *   POST /api/simcar/clip          — SSE stream (progress + result)
 *   GET  /api/simcar/clip/download/:jobId — Download final ZIP
 *   POST /api/simcar/clip/analyze   — SSE stream (AI analysis of clips)
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Constants ──────────────────────────────────────────────── */

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

/* ─── Job Cache ──────────────────────────────────────────────── */

type CachedJob = {
    buffer: Buffer;
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

/* ─── SSE Helpers ────────────────────────────────────────────── */

function sendSSE(res: Response, data: Record<string, unknown>) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush if available (for proxied/streamed connections)
    if (typeof (res as any).flush === "function") (res as any).flush();
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
function parseUserShapefile(zipBuffer: Buffer): {
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

type LayerSummary = {
    name: string;
    source: "property" | "wfs";
    features: number;
    areaHa?: number;
    warning?: string;
};

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
        sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile do imóvel." });
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
        sendSSE(res, { type: "error", message: "Arquivo Modelo.zip não encontrado no servidor." });
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
    try {
        sendSSE(res, { type: "progress", layer: "UPLOAD", current: total, total, status: "uploading_cloudinary" });
        const [inUrl, outUrl] = await Promise.all([
            uploadBufferToCloudinary(propertyZip, `simcar_input_${jobId.slice(0, 8)}`),
            uploadBufferToCloudinary(zipBuffer, `simcar_output_${jobId.slice(0, 8)}`),
        ]);
        inputZipUrl = inUrl;
        outputZipUrl = outUrl;
        console.log(`[SIMCAR CLIP] Cloudinary: input=${inUrl}, output=${outUrl}`);
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
    });

    // 8. Send completion event
    const processingTimeMs = Date.now() - startTime;
    const layersWithData = layerSummaries.filter((l) => l.features > 0).length;

    sendSSE(res, {
        type: "complete",
        downloadUrl: `/api/simcar/clip/download/${jobId}`,
        inputZipUrl,
        outputZipUrl,
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

/* ─── AI Analysis Pipeline ───────────────────────────────────── */

const SEMA_WMS_BASE = process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
const SEMA_WMS_AUTHKEY = process.env.SEMA_WMS_AUTHKEY || "541085de-9a2e-454e-bdba-eb3d57a2f492";
const SPOT_LAYER = "Mosaicos:MOSAICO_SPOT_SEPLAN";
const LANDSAT5_2007_LAYER = process.env.WMS_LANDSAT5_2007 || "Mosaicos:MOSAICO_LANDSAT5_2007";
const LANDSAT5_2008_LAYER = process.env.WMS_LANDSAT5_2008 || "Mosaicos:MOSAICO_LANDSAT5_2008";

/** Available satellite base layers for analysis. */
const SATELLITE_LAYERS: Record<string, { wmsLayer: string; label: string; year: number }> = {
    spot_2008: { wmsLayer: SPOT_LAYER, label: "SPOT 2008", year: 2008 },
    landsat5_2007: { wmsLayer: LANDSAT5_2007_LAYER, label: "Landsat 5 (2007)", year: 2007 },
    landsat5_2008: { wmsLayer: LANDSAT5_2008_LAYER, label: "Landsat 5 (2008)", year: 2008 },
};
const ANALYSIS_VISION_MODELS = [
    "openai/gpt-oss-120b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "qwen/qwen3-32b",
];

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

/** Compress image for AI vision analysis: downscale + JPEG to reduce payload. */
async function compressForVision(dataUrl: string): Promise<string> {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    const compressed = await sharp(buf)
        .resize(800, 600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72 })
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

/** Upload a raw Buffer (ZIP etc.) to Cloudinary. Returns secure_url. */
async function uploadBufferToCloudinary(buffer: Buffer, filename: string): Promise<string> {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const folder = process.env.CLOUDINARY_FOLDER;
    if (!apiKey || !apiSecret) throw new Error("Cloudinary não configurado.");

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_");
    const params: Record<string, string> = { timestamp: String(timestamp), public_id: publicId };
    if (folder) params.folder = folder;
    const signature = cloudinarySign(params);

    const b64 = `data:application/zip;base64,${buffer.toString("base64")}`;
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

/**
 * Build content parts for vision API from images.
 * Uses Cloudinary URLs when available, otherwise compressed base64.
 */
function buildVisionContentParts(
    images: Array<{ url?: string; dataUrl?: string; caption: string }>,
    prompt: string,
): any[] {
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
    images: Array<{ url?: string; dataUrl?: string; caption: string }>,
): Array<{ url?: string; dataUrl?: string; caption: string }> {
    return images.filter((img) => img.caption.includes("Visão Geral"));
}

/** Call Groq vision model with images. Multi-model fallback + reduced-image retry. */
async function callVisionAnalysis(
    images: Array<{ url?: string; dataUrl?: string; caption: string }>,
    prompt: string,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const VISION_TIMEOUT_MS = 120_000; // 2 minutes
    const maxTokens = images.length > 3 ? 6000 : 4000;

    // Try full image set first, then reduced set (overview only) on failure
    const imageSets = [images];
    if (images.length > 3) {
        imageSets.push(reduceImageSet(images));
    }

    let lastError = "";
    for (let attempt = 0; attempt < imageSets.length; attempt++) {
        const currentImages = imageSets[attempt];
        const contentParts = buildVisionContentParts(currentImages, prompt);
        const messages = [{ role: "user", content: contentParts }];

        if (attempt > 0) {
            console.log(`[SIMCAR ANALYSIS] Retrying with reduced image set (${currentImages.length} images)...`);
        }

        for (const model of ANALYSIS_VISION_MODELS) {
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
                    // If payload too large (413/400), skip to reduced set immediately
                    if ((response.status === 413 || response.status === 400) && attempt === 0 && imageSets.length > 1) {
                        console.warn(`[SIMCAR ANALYSIS] Payload too large, switching to reduced image set`);
                        break; // break inner model loop, go to next attempt
                    }
                    continue;
                }

                const data = await response.json() as any;
                const content = data?.choices?.[0]?.message?.content;
                if (content) {
                    console.log(`[SIMCAR ANALYSIS] Success with model: ${model} (attempt ${attempt + 1})`);
                    return String(content);
                }
                lastError = `${model}: empty response`;
            } catch (err: any) {
                const isTimeout = err.name === "AbortError";
                lastError = `${model}: ${isTimeout ? "timeout (120s)" : err.message}`;
                console.warn(`[SIMCAR ANALYSIS] Model ${model} ${isTimeout ? "timed out" : "exception"}:`, lastError);
            }
        }
    }
    throw new Error(`Todos os modelos falharam. Último erro: ${lastError}`);
}

/** Call Groq with text-only follow-up message. Multi-model fallback. */
async function callTextFollowUp(
    messages: Array<{ role: string; content: any }>,
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY não configurada.");

    const TEXT_MODELS = [
        "openai/gpt-oss-120b",
        "meta-llama/llama-3.3-70b-versatile",
        "qwen/qwen3-32b",
    ];

    let lastError = "";
    for (const model of TEXT_MODELS) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60_000);
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.1,
                    max_tokens: 2000,
                    messages,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                const text = await response.text();
                lastError = `${model}: ${text.slice(0, 200)}`;
                continue;
            }
            const data = await response.json() as any;
            const content = data?.choices?.[0]?.message?.content;
            if (content) return String(content);
            lastError = `${model}: empty response`;
        } catch (err: any) {
            const isTimeout = err.name === "AbortError";
            lastError = `${model}: ${isTimeout ? "timeout (60s)" : err.message}`;
        }
    }
    throw new Error(`Falha nos modelos de texto. Último erro: ${lastError}`);
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
function buildPropertyContext(areaHa: number, layerSummaries: LayerSummary[]): string {
    const acSummary = layerSummaries.find((l) => l.name === "AREA_CONSOLIDADA");
    const avnSummary = layerSummaries.find((l) => l.name === "AVN");
    const atpSummary = layerSummaries.find((l) => l.name === "ATP");

    const quantRows = layerSummaries
        .filter((l) => l.features > 0)
        .map((l) => {
            const pct = areaHa > 0 ? ((l.areaHa ?? 0) / areaHa * 100).toFixed(1) : "?";
            return `| ${l.name} | ${l.features} | ${l.areaHa?.toFixed(2) ?? '-'} ha | ${pct}% |`;
        });

    return [
        "## Contexto do Imóvel Rural",
        "",
        `| Parâmetro | Valor |`,
        `|-----------|-------|`,
        `| Área Total da Propriedade (ATP) | **${areaHa.toFixed(2)} ha** |`,
        `| Área Consolidada (AC) | ${acSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((acSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) — ${acSummary?.features ?? 0} feições |`,
        `| Vegetação Nativa (AVN) | ${avnSummary?.areaHa?.toFixed(2) ?? '0'} ha (${areaHa > 0 ? ((avnSummary?.areaHa ?? 0) / areaHa * 100).toFixed(1) : '?'}%) — ${avnSummary?.features ?? 0} feições |`,
        atpSummary ? `| ATP (polígono declarado) | ${atpSummary.areaHa?.toFixed(2) ?? '-'} ha |` : "",
        "",
        "### Quantitativos completos (SIMCAR Digital)",
        "| Camada | Feições | Área | % do Imóvel |",
        "|--------|---------|------|-----------|",
        ...quantRows,
    ].join("\n");
}

/** Build prompt for a SINGLE satellite analysis (3 images). */
function buildSingleSatellitePrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    satelliteKey: string,
): string {
    const sat = SATELLITE_LAYERS[satelliteKey];
    const sensor = satelliteKey.startsWith("landsat")
        ? "Landsat 5 TM (30m de resolução espacial)"
        : "SPOT (2.5m de resolução espacial)";

    return [
        "Você é a **GeoForest IA**, especialista em sensoriamento remoto e análise ambiental para imóveis rurais em Mato Grosso.",
        "Analise as 3 imagens do satélite fornecido comparando com os dados vetoriais do CAR.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries),
        "",
        "---",
        "",
        `## Imagens: ${sat.label} — ${sensor}`,
        "",
        "**Legenda dos polígonos:**",
        "- 🟥 **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- 🟪 **Roxo semi-transparente**: ÁREA CONSOLIDADA (AC)",
        "- 🟨 **Amarelo semi-transparente**: VEGETAÇÃO NATIVA (AVN)",
        "",
        `- Imagem 1: Visão Geral — base ${sat.label} + propriedade + AC + AVN`,
        `- Imagem 2: Área Consolidada — base ${sat.label} + propriedade + somente AC`,
        `- Imagem 3: AVN — base ${sat.label} + propriedade + somente AVN`,
        "",
        "---",
        "",
        "## Instruções",
        "",
        "### Análise da Área Consolidada (AC)",
        "- As áreas em roxo correspondem a uso antrópico (pastagem, agricultura, solo exposto)?",
        "- Algum trecho de AC apresenta textura de vegetação nativa?",
        "- Descreva a localização de trechos discordantes (ex: 'porção norte', 'borda leste').",
        "",
        "### Análise da Vegetação Nativa (AVN)",
        "- As áreas em amarelo correspondem a vegetação nativa (floresta, cerrado, mata ciliar)?",
        "- Algum trecho de AVN parece antropizado (pastagem, desmatamento, queimada)?",
        "- Avalie integridade e conectividade da vegetação.",
        "",
        "### Concordâncias e Discordâncias",
        "- **✅ CONCORDA**: áreas onde classificação coincide com a imagem.",
        "- **❌ DISCORDA**: áreas onde classificação não condiz. Indique a classificação mais apropriada.",
        "",
        "### Nível de Confiança",
        "Classifique: **[ALTA]**, **[MÉDIA]** ou **[BAIXA]**.",
        "",
        "---",
        "Responda em **português**, use markdown, seja detalhado e técnico.",
    ].join("\n");
}

/** Build the full prompt for single-satellite analysis (original behavior). */
function buildAnalysisPrompt(
    areaHa: number,
    layerSummaries: LayerSummary[],
    selectedLayers?: string[],
): string {
    const validLayers = (selectedLayers || []).filter((k) => SATELLITE_LAYERS[k]);
    const isMultiYear = validLayers.length > 1;
    const layerLabels = validLayers.map((k) => SATELLITE_LAYERS[k]?.label || k);
    const layerYears = validLayers.map((k) => SATELLITE_LAYERS[k]?.year || 0).sort();

    const satDescriptions = validLayers.map((k, i) => {
        const sat = SATELLITE_LAYERS[k];
        const imgBase = i * 3 + 1;
        const sensor = k.startsWith("landsat") ? "Landsat 5 TM (30m de resolução espacial)" : "SPOT (2.5m de resolução espacial)";
        return [
            `#### ${sat.label} — ${sensor}`,
            `- Imagem ${imgBase}: Visão Geral — base ${sat.label} + contorno vermelho (propriedade) + AC (roxo) + AVN (amarelo)`,
            `- Imagem ${imgBase + 1}: Área Consolidada — base ${sat.label} + contorno vermelho + somente AC (roxo)`,
            `- Imagem ${imgBase + 2}: AVN — base ${sat.label} + contorno vermelho + somente AVN (amarelo)`,
        ].join("\n");
    }).join("\n\n");

    const parts: string[] = [
        "Você é a **GeoForest IA**, especialista em sensoriamento remoto e análise ambiental para imóveis rurais em Mato Grosso.",
        "Realize uma análise técnica comparando os dados vetoriais do CAR com as imagens de satélite.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries),
        "",
        "---",
        "",
        "## Imagens Fornecidas",
        "",
        `Foram geradas imagens de **${layerLabels.join(", ")}**${isMultiYear ? ` (período ${layerYears[0]}–${layerYears[layerYears.length - 1]})` : ""}.`,
        "",
        "**Legenda:**",
        "- 🟥 **Contorno vermelho**: limite da PROPRIEDADE RURAL (ATP)",
        "- 🟪 **Roxo semi-transparente**: ÁREA CONSOLIDADA (AC)",
        "- 🟨 **Amarelo semi-transparente**: VEGETAÇÃO NATIVA (AVN)",
        "",
        satDescriptions,
        "",
        "---",
        "",
        "## Instruções de Análise",
        "",
        "### 3.1 Análise da Área Consolidada (AC)",
        "- Verifique se AC (roxo) corresponde a uso antrópico (pastagem, agricultura, solo exposto, construções).",
        "- Identifique trechos de AC com textura de vegetação nativa.",
        "- Descreva localização de trechos discordantes.",
        "",
        "### 3.2 Análise da Vegetação Nativa (AVN)",
        "- Verifique se AVN (amarelo) corresponde a vegetação nativa.",
        "- Identifique trechos de AVN antropizados.",
        "- Avalie integridade e conectividade.",
        "",
    ];

    if (isMultiYear) {
        parts.push(
            "### 3.3 Análise Temporal (Multi-período)",
            `Imagens de **${layerLabels.join(" e ")}**. Parte MAIS IMPORTANTE.`,
            "",
            "#### a) Mudanças na cobertura vegetal",
            "- Supressão (mata → solo/pastagem) ou regeneração entre os anos.",
            "- Estime a área das mudanças.",
            "",
            "#### b) Consistência CAR vs. histórico",
            "- AC existia na imagem mais antiga?",
            "- AC mostra vegetação nativa na imagem mais antiga (desmatamento posterior)?",
            "- AVN já antropizada na imagem mais antiga?",
            "",
            "#### c) Art. 68 — Lei 12.651/2012 (marco: 22/07/2008)",
            "- AC consolidada antes de julho/2008?",
            "- Expansão sobre vegetação nativa após 2008?",
            "",
            "#### d) Diferenças entre sensores",
            "- Landsat 30m vs SPOT 2.5m — não confundir resolução com mudança.",
            "",
        );
    }

    const n = isMultiYear ? 4 : 3;
    parts.push(
        `### 3.${n} Concordâncias e Discordâncias`,
        "- **✅ CONCORDA**: classificação coincide com imagem.",
        "- **❌ DISCORDA**: classificação não condiz. Indique a classificação correta.",
        "",
        `### 3.${n + 1} Nível de Confiança: [ALTA], [MÉDIA] ou [BAIXA]`,
        "",
        `### 3.${n + 2} Recomendações ao Analista`,
        "- Ações práticas: vistoria, imagens complementares, retificação do CAR.",
        "- Artigos relevantes do Código Florestal.",
        "",
        "---",
        "Responda em **português**, use markdown com seções e sub-seções.",
    );

    return parts.join("\n");
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
        a.analysis,
    ].join("\n")).join("\n\n---\n\n");

    return [
        "Você é a **GeoForest IA**, especialista em sensoriamento remoto e análise ambiental para imóveis rurais em Mato Grosso.",
        "",
        "Você receberá análises individuais feitas por IA para diferentes imagens de satélite do MESMO imóvel rural.",
        "Sua tarefa é **sintetizar e comparar** essas análises para produzir um **laudo temporal integrado**.",
        "",
        "---",
        "",
        buildPropertyContext(areaHa, layerSummaries),
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
        "Produza um laudo ÚNICO e COMPLETO que integre as análises acima. Estruture assim:",
        "",
        "### 1. Resumo por Satélite",
        "Para cada satélite, resuma em 2-3 frases os achados principais da análise individual (AC e AVN).",
        "",
        "### 2. Análise Temporal Comparativa",
        `Compare sistematicamente as imagens dos anos **${years.join(", ")}**:`,
        "",
        "#### a) Mudanças na Cobertura Vegetal",
        "- Identifique áreas com **supressão** (vegetação → solo/pastagem) entre os anos.",
        "- Identifique áreas com **regeneração** (solo → vegetação secundária).",
        "- Estime áreas das mudanças (em hectares, proporção visual).",
        "",
        "#### b) Consistência do CAR vs. Histórico",
        "- A Área Consolidada (AC) já existia como uso antrópico na imagem mais antiga?",
        "- Alguma AC mostra vegetação nativa na imagem mais antiga (desmatamento posterior)?",
        "- Alguma AVN já estava antropizada na imagem mais antiga?",
        "",
        "#### c) Marco Temporal — Art. 68 da Lei 12.651/2012",
        "- Data de referência: **22/07/2008**.",
        "- As áreas de AC já estavam consolidadas antes de julho/2008?",
        "- Houve expansão agrícola/pecuária sobre vegetação nativa após 2008?",
        "",
        "#### d) Diferenças entre Sensores",
        "- Landsat 5 TM tem 30m; SPOT tem 2.5m. Não confundir resolução com mudança real.",
        "- Onde as análises divergem por diferença de resolução, aponte explicitamente.",
        "",
        "### 3. Concordâncias e Discordâncias (Consolidadas)",
        "- **✅ CONCORDA**: áreas onde TODAS as imagens confirmam a classificação do CAR.",
        "- **❌ DISCORDA**: áreas onde alguma imagem contradiz a classificação. Indique qual ano e o que mostrou.",
        "- **⚠️ INCONCLUSIVO**: áreas onde os satélites divergem por limitação de resolução.",
        "",
        "### 4. Nível de Confiança",
        "Classifique: **[ALTA]**, **[MÉDIA]** ou **[BAIXA]**.",
        "Justifique com base na resolução, cobertura de nuvens, consistência entre sensores.",
        "",
        "### 5. Recomendações ao Analista",
        "- Ações práticas: vistoria em campo, imagens complementares, retificação do CAR.",
        "- Cite artigos do Código Florestal quando aplicável.",
        "",
        "---",
        "Responda em **português**, use markdown, seja detalhado e técnico.",
        "NÃO repita as análises individuais integralmente — sintetize e compare.",
    ].join("\n");
}

/**
 * Generate composited satellite images for given layers.
 * Returns array of { dataUrl, caption } for each satellite × 3 views.
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

    const validKeys = selectedLayers.filter((k) => SATELLITE_LAYERS[k]);
    if (validKeys.length === 0) validKeys.push("spot_2008"); // fallback

    const totalSteps = validKeys.length * 3;
    let step = 0;

    for (const key of validKeys) {
        const sat = SATELLITE_LAYERS[key];
        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `Baixando imagem ${sat.label}...`,
        });

        let basePng: Buffer;
        try {
            basePng = await fetchWmsImageBuffer([sat.wmsLayer], paddedBbox, IMG_W, IMG_H);
        } catch (err: any) {
            console.warn(`[SIMCAR ANALYSIS] WMS ${sat.label} failed: ${err.message}`);
            sendSSE(res, {
                type: "progress", step: "generating_images",
                percent: 10 + Math.round((step / totalSteps) * 40),
                message: `Aviso: ${sat.label} indisponível, pulando...`,
            });
            step += 3;
            continue;
        }

        // 3 composites per satellite
        // 1: Overview (AC + AVN + property)
        const overviewSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.20)", strokeWidth: 2 },
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.20)", strokeWidth: 2 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, overviewSvg), caption: `${sat.label} — Visão Geral (propriedade + AC + AVN)` });
        step++;

        sendSSE(res, {
            type: "progress", step: "generating_images",
            percent: 10 + Math.round((step / totalSteps) * 40),
            message: `${sat.label}: renderizando Área Consolidada...`,
        });

        // 2: AC only
        const acSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AREA_CONSOLIDADA", stroke: "#9333EA", fill: "rgba(147, 51, 234, 0.25)", strokeWidth: 2.5 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, acSvg), caption: `${sat.label} — Área Consolidada` });
        step++;

        // 3: AVN only
        const avnSvg = buildPolygonOverlaySvg(IMG_W, IMG_H, paddedBbox, propertyPolygon!, layerGeos, [
            { name: "AVN", stroke: "#EAB308", fill: "rgba(234, 179, 8, 0.25)", strokeWidth: 2.5 },
        ]);
        images.push({ dataUrl: await compositeOverlay(basePng, avnSvg), caption: `${sat.label} — AVN` });
        step++;
    }

    return images;
}

/** Main analysis pipeline (called from the SSE endpoint). */
async function processAnalysis(
    res: Response,
    jobId: string,
    selectedLayers: string[] = ["spot_2008"],
    aiAnalysis = true,
) {
    const job = jobCache.get(jobId);
    if (!job || !job.bbox || !job.polygon || !job.layerSummaries) {
        sendSSE(res, { type: "error", message: "Job não encontrado ou expirado. Processe o recorte novamente." });
        return;
    }

    const { layerSummaries, areaHa: propAreaHa } = job;
    const areaHa = propAreaHa ?? 0;

    // Step 1: Generate satellite images with polygon overlays
    sendSSE(res, { type: "progress", step: "generating_images", percent: 10, message: "Iniciando geração de imagens..." });

    let imagesToAnalyze: Array<{ dataUrl: string; caption: string }>;
    try {
        imagesToAnalyze = await generateSatelliteImages(res, job, selectedLayers);
    } catch (err: any) {
        console.error("[SIMCAR ANALYSIS] Image generation error:", err.message);
        sendSSE(res, { type: "error", message: `Erro ao gerar imagens: ${err.message}` });
        return;
    }

    if (imagesToAnalyze.length === 0) {
        sendSSE(res, { type: "error", message: "Nenhuma imagem de satélite foi gerada. Verifique a disponibilidade das camadas WMS." });
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
    sendSSE(res, { type: "progress", step: "analyzing", percent: 62, message: "Preparando imagens para análise IA..." });

    type AiImage = { url?: string; dataUrl?: string; caption: string };
    const aiImages: AiImage[] = [];
    if (cloudinaryUrls.length === imagesToAnalyze.length) {
        for (const cu of cloudinaryUrls) {
            aiImages.push({ url: cu.url, caption: cu.caption });
        }
        console.log(`[SIMCAR ANALYSIS] Using ${aiImages.length} Cloudinary URLs for vision API`);
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

    // Step 4: AI Analysis — strategy depends on number of satellites
    const validKeys = selectedLayers.filter((k) => SATELLITE_LAYERS[k]);
    const isMultiSatellite = validKeys.length > 1;

    let analysisText: string;

    if (isMultiSatellite) {
        // ── MULTI-SATELLITE: analyze each satellite separately, then synthesize ──
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
                const result = await callVisionAnalysis(satImages, prompt);
                perSatelliteResults.push({ satelliteLabel: sat.label, year: sat.year, analysis: result });
                console.log(`[SIMCAR ANALYSIS] ${sat.label} analysis complete (${result.length} chars)`);
            } catch (err: any) {
                console.error(`[SIMCAR ANALYSIS] ${sat.label} analysis failed:`, err.message);
                sendSSE(res, {
                    type: "progress", step: "analyzing", percent: progressPct,
                    message: `Aviso: análise de ${sat.label} falhou, continuando com os demais...`,
                });
            }
            satIdx++;
        }

        if (perSatelliteResults.length === 0) {
            // All individual analyses failed — try legacy single-call as last resort
            console.warn(`[SIMCAR ANALYSIS] All individual analyses failed, trying legacy single-call...`);
            sendSSE(res, { type: "progress", step: "analyzing", percent: 85, message: "Tentando análise unificada como fallback..." });
            try {
                const prompt = buildAnalysisPrompt(areaHa, layerSummaries, selectedLayers);
                analysisText = await callVisionAnalysis(aiImages, prompt);
            } catch (err: any) {
                console.error("[SIMCAR ANALYSIS] Legacy fallback also failed:", err.message);
                sendSSE(res, { type: "error", message: `Erro na análise IA: ${err.message}` });
                return;
            }
        } else if (perSatelliteResults.length === 1) {
            // Only one satellite succeeded — return its analysis directly (no synthesis needed)
            analysisText = perSatelliteResults[0].analysis;
        } else {
            // Multiple results — synthesize with temporal comparison
            sendSSE(res, { type: "progress", step: "analyzing", percent: 88, message: "IA sintetizando análise temporal comparativa..." });
            try {
                const synthesisPrompt = buildSynthesisPrompt(areaHa, layerSummaries, perSatelliteResults);
                analysisText = await callTextFollowUp([{ role: "user", content: synthesisPrompt }]);
                console.log(`[SIMCAR ANALYSIS] Synthesis complete (${analysisText.length} chars)`);
            } catch (err: any) {
                // Synthesis failed — concatenate individual analyses as fallback
                console.error("[SIMCAR ANALYSIS] Synthesis failed, concatenating analyses:", err.message);
                analysisText = perSatelliteResults.map((r) => [
                    `## Análise: ${r.satelliteLabel} (${r.year})`,
                    "",
                    r.analysis,
                ].join("\n")).join("\n\n---\n\n");
            }
        }
    } else {
        // ── SINGLE SATELLITE: direct analysis (original behavior) ──
        sendSSE(res, { type: "progress", step: "analyzing", percent: 65, message: "IA analisando imagens (isso pode levar alguns segundos)..." });
        try {
            const prompt = buildAnalysisPrompt(areaHa, layerSummaries, selectedLayers);
            analysisText = await callVisionAnalysis(aiImages, prompt);
        } catch (err: any) {
            console.error("[SIMCAR ANALYSIS] AI analysis error:", err.message);
            sendSSE(res, { type: "error", message: `Erro na análise IA: ${err.message}` });
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

/* ─── Express Route Registration ─────────────────────────────── */

export function registerSimcarClipRoutes(app: Express) {
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
                error: "Download expirado ou não encontrado. Processe novamente.",
            });
            return;
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${cached.filename}"`);
        res.setHeader("Content-Length", cached.buffer.length.toString());
        res.send(cached.buffer);
    });

    // AI analysis endpoint (SSE stream)
    app.post("/api/simcar/clip/analyze", async (req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
            const { jobId, selectedLayers, imageOnly } = req.body as { jobId?: string; selectedLayers?: string[]; imageOnly?: boolean };
            if (!jobId) {
                sendSSE(res, { type: "error", message: "jobId é obrigatório." });
                res.end();
                return;
            }

            const layers = Array.isArray(selectedLayers) && selectedLayers.length > 0 ? selectedLayers : ["spot_2008"];
            console.log(`[SIMCAR ANALYSIS] Starting analysis for job: ${jobId}, layers: ${layers.join(",")}, aiAnalysis: ${!imageOnly}`);
            await processAnalysis(res, jobId, layers, !imageOnly);
        } catch (err: any) {
            console.error("[SIMCAR ANALYSIS] Unexpected error:", err);
            sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // AI follow-up chat endpoint
    app.post("/api/simcar/clip/analyze/chat", async (req: Request, res: Response) => {
        try {
            const { messages } = req.body as {
                messages?: Array<{ role: string; content: any }>;
            };

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                res.status(400).json({ error: "Mensagens inválidas." });
                return;
            }

            const reply = await callTextFollowUp(messages);
            res.json({ content: reply });
        } catch (err: any) {
            console.error("[SIMCAR ANALYSIS CHAT] Error:", err);
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
        const { imageUrls } = req.body as { imageUrls?: string[] };

        try {
            const cached = jobCache.get(jobId);
            const deletions: Promise<void>[] = [];

            // Delete ZIPs from Cloudinary (raw type)
            if (cached?.inputZipUrl) deletions.push(deleteFromCloudinary(cached.inputZipUrl, "raw"));
            if (cached?.outputZipUrl) deletions.push(deleteFromCloudinary(cached.outputZipUrl, "raw"));

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
