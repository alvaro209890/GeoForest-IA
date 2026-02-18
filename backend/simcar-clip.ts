/**
 * SIMCAR Clip — Automated clipping of SEMA-MT SIMCAR WFS layers
 * to the geometry of a user-provided property polygon.
 *
 * Registers two Express endpoints:
 *   POST /api/simcar/clip       — SSE stream (progress + result)
 *   GET  /api/simcar/clip/download/:jobId — Download final ZIP
 */
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import archiver from "archiver";
import proj4 from "proj4";
import ExcelJS from "exceljs";
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

type CachedJob = { buffer: Buffer; expiresAt: number; filename: string };
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

    // 7. Cache the result
    const jobId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `SIMCAR_Recorte_${timestamp}.zip`;

    pruneJobCache();
    jobCache.set(jobId, {
        buffer: zipBuffer,
        expiresAt: Date.now() + CACHE_TTL_MS,
        filename,
    });

    // 8. Send completion event
    const processingTimeMs = Date.now() - startTime;
    const layersWithData = layerSummaries.filter((l) => l.features > 0).length;

    sendSSE(res, {
        type: "complete",
        downloadUrl: `/api/simcar/clip/download/${jobId}`,
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

    // Layer list endpoint (for frontend checkbox list)
    app.get("/api/simcar/layers", (_req: Request, res: Response) => {
        res.json({
            layers: TEMPLATE_LAYERS.map((name) => ({
                name,
                category: DIRECT_COPY_LAYERS.has(name) ? "property" : "wfs",
            })),
        });
    });
}
