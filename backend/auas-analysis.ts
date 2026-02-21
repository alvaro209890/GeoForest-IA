/**
 * AUAS Analysis — Área de Uso Alternativo do Solo
 *
 * Classifica as áreas do imóvel em:
 *   AC  — Área Consolidada: desmatamento PRODES com ano < 2008
 *   AUAS — desmatamento PRODES com ano >= 2008
 *   AVN — Imóvel menos (AC ∪ AUAS ∪ buffers de rios)
 *   ARL — igual à AVN
 *
 * Fontes:
 *   PRODES: Terrabrasilis / INPE — WFS configurável via PRODES_WFS_URL
 *   Rios:   SFB — WFS configurável via SFB_WFS_URL
 *           Buffer de 2 m para cada lado de todos os rios dentro do imóvel.
 *
 * Endpoints registrados:
 *   POST /api/auas/analyze      — SSE stream de progresso + resultado
 *   GET  /api/auas/download/:id — Download do ZIP de shapefiles
 *
 * Vetorização: usa o mesmo "Arquivo Modelo.zip" do SIMCAR (schema dos shapefiles).
 */
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import archiver from "archiver";
import {
    area as turfArea,
    buffer as turfBuffer,
    difference as turfDifference,
    intersect as turfIntersect,
    union as turfUnion,
    featureCollection as turfFeatureCollection,
    polygon as turfPolygon,
    multiPolygon as turfMultiPolygon,
    lineString as turfLineString,
} from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, LineString, MultiLineString } from "geojson";
import { fileURLToPath } from "url";

import { extractZipEntries } from "./geo-utils";
import { fetchJsonWithTimeout, polygonToWkt, toPolygonOrMultiFeature } from "./wfs-intersection";
import { parseUserShapefile } from "./simcar-clip";
import {
    parseDbfSchema,
    buildShpAndShx,
    buildDbfBuffer,
    geojsonToShpRings,
    type DbfFieldDef,
    type ShpRecord,
} from "./shapefile-writer";
import { adminAuth } from "./firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Configuração ──────────────────────────────────────────────── */

const MODELO_ZIP_PATH = path.resolve(__dirname, "..", "Arquivo Modelo.zip");

// PRODES Terrabrasilis — Legal Amazon (bioma padrão para MT)
// Pode ser sobrescrito via env PRODES_WFS_URL
const DEFAULT_PRODES_WFS_URL =
    process.env.PRODES_WFS_URL ||
    "https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amz-nb/ows";
const PRODES_LAYER = process.env.PRODES_LAYER || "prodes-amz-nb:yearly_deforestation";
const PRODES_YEAR_FIELD = process.env.PRODES_YEAR_FIELD || "year";

// SFB — Serviço Florestal Brasileiro (hidrografia)
// Pode ser sobrescrito via env SFB_WFS_URL
const SFB_WFS_URL = process.env.SFB_WFS_URL || "";
const SFB_RIVER_LAYER = process.env.SFB_RIVER_LAYER || "";

// Buffer de rios: 2 m para cada lado (total 4 m de largura)
const RIVER_BUFFER_METERS = 2;

const WFS_TIMEOUT = 30_000; // 30 s
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_MAX = 20;

/* ─── Cache de jobs ──────────────────────────────────────────────── */
type AuasJob = {
    buffer?: Buffer;
    filename: string;
    expiresAt: number;
};
const auasJobCache = new Map<string, AuasJob>();

function pruneAuasCache() {
    const now = Date.now();
    for (const [k, v] of auasJobCache) {
        if (v.expiresAt <= now) auasJobCache.delete(k);
    }
    while (auasJobCache.size > CACHE_MAX) {
        const oldest = auasJobCache.keys().next().value as string | undefined;
        if (!oldest) break;
        auasJobCache.delete(oldest);
    }
}
setInterval(pruneAuasCache, 10 * 60 * 1000).unref();

/* ─── SSE helpers ────────────────────────────────────────────────── */
function sendSSE(res: Response, data: Record<string, unknown>) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
}

function progress(res: Response, percent: number, step: string, message: string) {
    sendSSE(res, { type: "progress", percent, step, message });
}

/* ─── WFS helpers ────────────────────────────────────────────────── */

/** Busca feições de um WFS GeoJSON usando bbox da propriedade. */
async function fetchWfsGeoJson(
    baseUrl: string,
    typeName: string,
    bboxWkt: string,
    cql?: string,
): Promise<FeatureCollection> {
    const url = new URL(baseUrl);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("version", "2.0.0");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typeNames", typeName);
    url.searchParams.set("outputFormat", "application/json");
    url.searchParams.set("count", "50000");
    if (cql) url.searchParams.set("CQL_FILTER", cql);
    const data = await fetchJsonWithTimeout<FeatureCollection>(url.toString(), WFS_TIMEOUT);
    if (!data || !Array.isArray(data.features)) {
        return { type: "FeatureCollection", features: [] };
    }
    return data;
}

/* ─── Geometria helpers ──────────────────────────────────────────── */

function geometryToFeature(g: Geometry): Feature<Polygon | MultiPolygon> | null {
    if (g.type === "Polygon") return turfPolygon(g.coordinates as any) as Feature<Polygon>;
    if (g.type === "MultiPolygon") return turfMultiPolygon(g.coordinates as any) as Feature<MultiPolygon>;
    return null;
}

/** Une lista de features em um único MultiPolygon/Polygon. Retorna null se lista vazia. */
function unionAll(features: Feature<Polygon | MultiPolygon>[]): Feature<Polygon | MultiPolygon> | null {
    if (!features.length) return null;
    let result: Feature<Polygon | MultiPolygon> = features[0];
    for (let i = 1; i < features.length; i++) {
        try {
            const u = turfUnion(turfFeatureCollection([result, features[i]]));
            if (u) result = u as Feature<Polygon | MultiPolygon>;
        } catch {
            // Se falhar, continuar com o resultado parcial
        }
    }
    return result;
}

/** Converte LineString/MultiLineString em polígono de buffer. */
function lineToBuffer(geom: LineString | MultiLineString, bufferMeters: number): Feature<Polygon | MultiPolygon> | null {
    try {
        const feat = geom.type === "LineString"
            ? turfLineString(geom.coordinates as any)
            : { type: "Feature" as const, geometry: geom, properties: {} };
        const buffered = turfBuffer(feat as any, bufferMeters, { units: "meters" });
        if (!buffered) return null;
        return buffered as Feature<Polygon | MultiPolygon>;
    } catch {
        return null;
    }
}

/** Área em hectares de uma feature. */
function areaHa(f: Feature<Polygon | MultiPolygon> | null): number {
    if (!f) return 0;
    return turfArea(f) / 10_000;
}

/** Subtrai b de a. Retorna null se resultado vazio. */
function subtract(
    a: Feature<Polygon | MultiPolygon> | null,
    b: Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon> | null {
    if (!a) return null;
    if (!b) return a;
    try {
        const d = turfDifference(turfFeatureCollection([a, b]));
        if (!d) return null;
        return d as Feature<Polygon | MultiPolygon>;
    } catch {
        return a;
    }
}

/** Intersecta a com b. Retorna null se sem interseção. */
function clip(
    a: Feature<Polygon | MultiPolygon> | null,
    b: Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon> | null {
    if (!a || !b) return null;
    try {
        const i = turfIntersect(turfFeatureCollection([a, b]));
        if (!i) return null;
        return i as Feature<Polygon | MultiPolygon>;
    } catch {
        return null;
    }
}

/* ─── Shapefile output helpers ───────────────────────────────────── */

function readTemplateSchema(
    templateEntries: Array<{ name: string; data: Buffer }>,
    layerName: string,
): DbfFieldDef[] {
    const dbfEntry = templateEntries.find(
        (e) => path.basename(e.name, path.extname(e.name)).toUpperCase() === layerName &&
            e.name.toLowerCase().endsWith(".dbf"),
    );
    if (!dbfEntry) return [{ name: "ID", type: "N" as const, length: 10, decimals: 0 }];
    try {
        return parseDbfSchema(dbfEntry.data);
    } catch {
        return [{ name: "ID", type: "N" as const, length: 10, decimals: 0 }];
    }
}

function prjForLayer(
    templateEntries: Array<{ name: string; data: Buffer }>,
    layerName: string,
): Buffer | null {
    const entry = templateEntries.find(
        (e) => path.basename(e.name, path.extname(e.name)).toUpperCase() === layerName &&
            e.name.toLowerCase().endsWith(".prj"),
    );
    return entry?.data || null;
}

/** Gera arquivos .shp, .shx, .dbf, .prj para uma feature. */
function buildLayerBuffers(
    layerName: string,
    feature: Feature<Polygon | MultiPolygon> | null,
    templateEntries: Array<{ name: string; data: Buffer }>,
    extraAttribs: Record<string, string | number | null> = {},
): Array<{ ext: string; data: Buffer }> {
    if (!feature) return [];
    const geom = feature.geometry as Polygon | MultiPolygon;
    const rings = geojsonToShpRings(geom);
    if (!rings.length) return [];

    const fieldDefs = readTemplateSchema(templateEntries, layerName);
    const attribs: Record<string, string | number | null> = {};
    for (const f of fieldDefs) attribs[f.name] = null;
    if (attribs["ID"] !== undefined) attribs["ID"] = 1;
    Object.assign(attribs, extraAttribs);

    const record: ShpRecord = { rings, attributes: attribs };
    const { shpBuffer, shxBuffer } = buildShpAndShx([record]);
    const dbfBuffer = buildDbfBuffer([record], fieldDefs);
    const prjBuf = prjForLayer(templateEntries, layerName);

    const out: Array<{ ext: string; data: Buffer }> = [
        { ext: "shp", data: shpBuffer },
        { ext: "shx", data: shxBuffer },
        { ext: "dbf", data: dbfBuffer },
    ];
    if (prjBuf) out.push({ ext: "prj", data: prjBuf });
    return out;
}

/* ─── Análise principal ──────────────────────────────────────────── */

async function runAuasAnalysis(
    res: Response,
    propertyZip: Buffer,
): Promise<void> {
    // 1. Parse shapefile da propriedade
    progress(res, 5, "parse", "Lendo shapefile da propriedade...");
    let userResult: ReturnType<typeof parseUserShapefile>;
    try {
        userResult = parseUserShapefile(propertyZip);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile." });
        return;
    }
    const { polygon: propertyFeature, geometry: propertyGeom, areaHa: propertyAreaHa } = userResult;
    const wkt = polygonToWkt(propertyGeom);

    // 2. Ler template (Arquivo Modelo.zip) para schemas dos shapefiles de saída
    progress(res, 10, "template", "Carregando template de shapefiles...");
    let templateEntries: Array<{ name: string; data: Buffer }> = [];
    try {
        const modeloBuf = fs.readFileSync(MODELO_ZIP_PATH);
        templateEntries = extractZipEntries(modeloBuf);
    } catch {
        // Template opcional — prosseguir sem schema personalizado
    }

    // 3. Buscar desmatamento PRODES dentro do imóvel
    progress(res, 20, "prodes", "Consultando PRODES (desmatamento)...");
    const prodesCql = `INTERSECTS(geom,${wkt})`;
    let prodesFeatures: FeatureCollection = { type: "FeatureCollection", features: [] };
    try {
        prodesFeatures = await fetchWfsGeoJson(DEFAULT_PRODES_WFS_URL, PRODES_LAYER, wkt, prodesCql);
    } catch (err: any) {
        console.warn("[AUAS] PRODES WFS error:", err.message);
        // Continuar sem dados PRODES — AC e AUAS ficarão zerados
    }
    progress(res, 35, "prodes", `PRODES: ${prodesFeatures.features.length} feições encontradas.`);

    // 4. Separar AC (< 2008) e AUAS (>= 2008), clipar ao imóvel
    const acFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const auasFeatures: Feature<Polygon | MultiPolygon>[] = [];
    const auasPerYear = new Map<number, number>(); // year → area acumulada ha

    for (const feat of prodesFeatures.features) {
        if (!feat.geometry) continue;
        const base = geometryToFeature(feat.geometry as Geometry);
        if (!base) continue;
        const clipped = clip(base, propertyFeature as Feature<Polygon | MultiPolygon>);
        if (!clipped) continue;

        const year = Number(feat.properties?.[PRODES_YEAR_FIELD] ?? 0);
        if (year > 0 && year < 2008) {
            acFeatures.push(clipped);
        } else if (year >= 2008) {
            auasFeatures.push(clipped);
            const ha = areaHa(clipped);
            auasPerYear.set(year, (auasPerYear.get(year) || 0) + ha);
        }
    }

    progress(res, 45, "classify", `AC: ${acFeatures.length} polígonos | AUAS: ${auasFeatures.length} polígonos`);

    // 5. Buffer de rios SFB (2 m cada lado)
    progress(res, 55, "rivers", "Consultando base de rios SFB...");
    let riverBufferUnion: Feature<Polygon | MultiPolygon> | null = null;
    let riverBufferHa = 0;

    if (SFB_WFS_URL && SFB_RIVER_LAYER) {
        try {
            const riverCql = `INTERSECTS(geom,${wkt})`;
            const riverGeoJson = await fetchWfsGeoJson(SFB_WFS_URL, SFB_RIVER_LAYER, wkt, riverCql);
            progress(res, 62, "rivers", `SFB: ${riverGeoJson.features.length} rios encontrados. Aplicando buffer...`);

            const riverBuffers: Feature<Polygon | MultiPolygon>[] = [];
            for (const feat of riverGeoJson.features) {
                if (!feat.geometry) continue;
                let buf: Feature<Polygon | MultiPolygon> | null = null;
                const g = feat.geometry as Geometry;
                if (g.type === "LineString" || g.type === "MultiLineString") {
                    buf = lineToBuffer(g as LineString | MultiLineString, RIVER_BUFFER_METERS);
                } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
                    // Já é polígono — aplicar buffer de expansão
                    const base = geometryToFeature(g);
                    if (base) {
                        buf = turfBuffer(base, RIVER_BUFFER_METERS, { units: "meters" }) as Feature<Polygon | MultiPolygon> | null;
                    }
                }
                if (!buf) continue;
                const clippedRiver = clip(buf, propertyFeature as Feature<Polygon | MultiPolygon>);
                if (clippedRiver) riverBuffers.push(clippedRiver);
            }

            if (riverBuffers.length > 0) {
                riverBufferUnion = unionAll(riverBuffers);
                riverBufferHa = areaHa(riverBufferUnion);
            }
        } catch (err: any) {
            console.warn("[AUAS] SFB WFS error:", err.message);
            // Continuar sem buffer de rios
        }
    } else {
        progress(res, 62, "rivers", "Base SFB não configurada — rios ignorados.");
    }

    progress(res, 70, "geometry", "Calculando AC, AUAS e AVN...");

    // 6. União das features
    let acUnion = unionAll(acFeatures);
    let auasUnion = unionAll(auasFeatures);

    // 7. Subtrair buffer de rios de AC e AUAS (nenhum shape sobrepõe rios)
    if (riverBufferUnion) {
        acUnion = subtract(acUnion, riverBufferUnion);
        auasUnion = subtract(auasUnion, riverBufferUnion);
    }

    // 8. Calcular AVN = imóvel − (AC ∪ AUAS ∪ rios)
    let occupied: Feature<Polygon | MultiPolygon> | null = null;
    if (acUnion && auasUnion) {
        occupied = turfUnion(turfFeatureCollection([acUnion, auasUnion])) as Feature<Polygon | MultiPolygon> | null;
    } else {
        occupied = acUnion || auasUnion;
    }
    if (riverBufferUnion) {
        occupied = occupied ? subtract(occupied, riverBufferUnion) : null;
        // Adicionar rios ao occupied para subtrair do imóvel
        const unido = occupied
            ? turfUnion(turfFeatureCollection([occupied, riverBufferUnion])) as Feature<Polygon | MultiPolygon> | null
            : riverBufferUnion;
        occupied = unido;
    }

    let avnFeature: Feature<Polygon | MultiPolygon> | null = subtract(
        propertyFeature as Feature<Polygon | MultiPolygon>,
        occupied,
    );

    const acAreaHa = areaHa(acUnion);
    const auasAreaHa = areaHa(auasUnion);
    const avnAreaHa = areaHa(avnFeature);
    // ARL = AVN
    const arlAreaHa = avnAreaHa;

    progress(res, 80, "shapefiles", "Gerando shapefiles de saída...");

    // 9. Gerar ZIP com shapefiles usando o template do Arquivo Modelo
    const layers: Array<{ name: string; feature: Feature<Polygon | MultiPolygon> | null }> = [
        { name: "AREA_CONSOLIDADA", feature: acUnion },
        { name: "AUAS", feature: auasUnion },
        { name: "AVN", feature: avnFeature },
        { name: "ARL", feature: avnFeature }, // ARL = AVN
    ];

    const jobId = crypto.randomUUID();
    const zipFilename = `auas_${jobId.slice(0, 8)}.zip`;

    const archive = archiver("zip", { zlib: { level: 6 } });
    const zipChunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => zipChunks.push(chunk));

    for (const { name, feature } of layers) {
        if (!feature) continue;
        const bufs = buildLayerBuffers(name, feature, templateEntries);
        for (const { ext, data } of bufs) {
            archive.append(data, { name: `${name}.${ext}` });
        }
    }

    await archive.finalize();
    const zipBuffer = Buffer.concat(zipChunks);

    // Guardar em cache para download
    pruneAuasCache();
    auasJobCache.set(jobId, {
        buffer: zipBuffer,
        filename: zipFilename,
        expiresAt: Date.now() + CACHE_TTL,
    });

    progress(res, 95, "done", "Análise concluída.");

    // 10. Retornar resultado
    const auasPolygons = Array.from(auasPerYear.entries()).map(([year, ha]) => ({ year, areaHa: ha }));

    sendSSE(res, {
        type: "result",
        jobId,
        data: {
            propertyAreaHa,
            acAreaHa,
            auasAreaHa,
            avnAreaHa,
            arlAreaHa,
            riverBufferHa,
            auasPolygons,
            downloadUrl: `/api/auas/download/${jobId}`,
        },
    });
}

/* ─── Registro de rotas ──────────────────────────────────────────── */

export function registerAuasRoutes(app: Express) {

    /** POST /api/auas/analyze — SSE stream */
    app.post("/api/auas/analyze", async (req: Request, res: Response) => {
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }

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

            // Inicia SSE
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();

            await runAuasAnalysis(res, zipBuffer);
        } catch (err: any) {
            console.error("[AUAS] Unhandled error:", err);
            if (!res.writableEnded) {
                sendSSE(res, { type: "error", message: err.message || "Erro interno na análise AUAS." });
            }
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    /** GET /api/auas/download/:jobId — Download do ZIP */
    app.get("/api/auas/download/:jobId", (req: Request, res: Response) => {
        const { jobId } = req.params as { jobId: string };
        const job = auasJobCache.get(jobId);
        if (!job?.buffer) {
            res.status(404).json({ error: "Arquivo não encontrado ou expirado." });
            return;
        }
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
        res.setHeader("Content-Length", job.buffer.length.toString());
        res.send(job.buffer);
    });
}
