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
import { Timestamp } from "firebase-admin/firestore";
import {
    area as turfArea,
    bbox as turfBbox,
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
import {
    parseUserShapefile,
    runAcAvnSatelliteAnalysis,
    getFixedAcAvnSatelliteKeys,
    type CachedJob,
    type LayerSummary,
} from "./simcar-clip";
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
    createRequestId,
    estimateCloudinaryStorageReserve,
    estimateReserveForModels,
    getBillingUsageSessionRecords,
    refundReserve,
    reserveCredits,
    runWithBillingUsageSession,
    settleCloudinaryStorageReserve,
    settleReservedCredits,
} from "./billing";
import { adminDb } from "./firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Configuração ──────────────────────────────────────────────── */

const MODELO_ZIP_PATH = path.resolve(__dirname, "..", "Arquivo Modelo.zip");

// PRODES Terrabrasilis — Legal Amazon (bioma padrão para MT)
// Pode ser sobrescrito via env PRODES_WFS_URL
const DEFAULT_PRODES_WFS_URL = String(
    process.env.PRODES_WFS_URL || "https://terrabrasilis.dpi.inpe.br/geoserver/ows",
).trim();
const PRODES_WFS_URL_FALLBACKS = [
    "https://terrabrasilis.dpi.inpe.br/geoserver/ows",
    "https://terrabrasilis.dpi.inpe.br/geoserver/prodes-legal-amz/ows",
] as const;
const PRODES_LAYER = String(process.env.PRODES_LAYER || "prodes-legal-amz:yearly_deforestation").trim();
const PRODES_YEAR_FIELD = String(process.env.PRODES_YEAR_FIELD || "year").trim();
const PRODES_GEOM_FIELD = String(process.env.PRODES_GEOM_FIELD || "geom").trim();

// SFB — Serviço Florestal Brasileiro (hidrografia)
// Pode ser sobrescrito via env SFB_WFS_URL
const SFB_WFS_URL = String(process.env.SFB_WFS_URL || "").trim();
const SFB_RIVER_LAYER = String(process.env.SFB_RIVER_LAYER || "").trim();
const SFB_GEOM_FIELD = String(process.env.SFB_GEOM_FIELD || "SHAPE").trim();
const SFB_CLASS_FIELD = String(process.env.SFB_CLASS_FIELD || "CLASSE").trim();
const DEFAULT_SEMA_AUTHKEY = "541085de-9a2e-454e-bdba-eb3d57a2f492";
const SFB_WFS_AUTHKEY =
    process.env.SFB_WFS_AUTHKEY ||
    process.env.WFS_AUTHKEY ||
    process.env.SEMA_WMS_AUTHKEY ||
    DEFAULT_SEMA_AUTHKEY;

// Buffer de rios: 2 m para cada lado (total 4 m de largura)
const RIVER_BUFFER_METERS = 2;

const WFS_TIMEOUT = 30_000; // 30 s
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const CACHE_MAX = 20;
const CLOUDINARY_CLOUD = "da19dwpgk";
const AUAS_BILLING_ENDPOINT = "/api/auas/analyze";
const AUAS_STORAGE_ENDPOINT = "/api/auas/analyze";
const AUAS_BILLING_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-32b",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
] as const;
const AUAS_ESTIMATED_AI_IMAGE_COUNT = 12;
const AUAS_ESTIMATED_BYTES_PER_AI_IMAGE = 900_000;
const AUAS_CLOUDINARY_UPLOAD_RETRY_ATTEMPTS = 3;
const AUAS_FIRESTORE_PERSIST_RETRY_ATTEMPTS = 3;
const AUAS_RETRY_BASE_DELAY_MS = 500;

function cloudinarySign(params: Record<string, string>): string {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) throw new Error("Cloudinary não configurado.");
    const base = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");
    return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

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

    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const form = new FormData();
    form.append("file", dataUrl);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);
    form.append("resource_type", "raw");
    if (folder) form.append("folder", folder);
    form.append("public_id", publicId);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/raw/upload`;
    const response = await fetch(uploadUrl, { method: "POST", body: form });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cloudinary raw error ${response.status}: ${text.slice(0, 200)}`);
    }
    return ((await response.json()) as { secure_url: string }).secure_url;
}

async function uploadZipBufferToCloudinary(buffer: Buffer, filename: string): Promise<string> {
    return uploadRawBufferToCloudinary(buffer, filename, "application/zip");
}

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function withRetry<T>(
    label: string,
    attempts: number,
    fn: (attempt: number) => Promise<T>,
): Promise<T> {
    const maxAttempts = Math.max(1, Math.floor(attempts || 1));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts) break;
            const backoffMs = AUAS_RETRY_BASE_DELAY_MS * attempt;
            console.warn(
                `[AUAS] ${label} falhou na tentativa ${attempt}/${maxAttempts}. Nova tentativa em ${backoffMs}ms.`,
                (error as any)?.message || error,
            );
            await sleepMs(backoffMs);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || `Falha em ${label}`));
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => stripUndefinedDeep(item))
            .filter((item) => item !== undefined);
        return cleaned as unknown as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
            if (raw === undefined) continue;
            const cleaned = stripUndefinedDeep(raw);
            if (cleaned === undefined) continue;
            out[key] = cleaned;
        }
        return out as T;
    }
    return value;
}

type AuasResultData = {
    propertyAreaHa: number;
    acAreaHa: number;
    auasAreaHa: number;
    avnAreaHa: number;
    arlAreaHa: number;
    riverBufferHa: number;
    auasPolygons: Array<{ year: number; areaHa: number }>;
    downloadUrl: string;
    inputZipUrl?: string;
    outputZipUrl?: string;
    contextUrl?: string;
    auasOpeningYear?: number;
    auasOpeningDate?: string;
    auasOpeningSource?: AuasOpeningSource;
    analysis?: string;
    images?: Array<{ url: string; caption: string }>;
    satellitesUsed?: string[];
    satellitesMissing?: string[];
    cloudWarnings?: Array<{ satellite: string; cloudScore: number }>;
    analysisMeta?: unknown;
    analysisRulesVersion?: string;
};

async function persistAuasJobInFirestore(args: {
    uid: string;
    jobId: string;
    inputFilename?: string;
    result: AuasResultData;
}): Promise<void> {
    const uid = String(args.uid || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!uid || !jobId) throw new Error("Nao foi possivel persistir Novo CAR no Firestore (uid/jobId ausente).");

    const docRef = adminDb.doc(`users/${uid}/auas_jobs/${jobId}`);
    const now = Timestamp.now();
    const nowIso = new Date().toISOString();
    const payloadBase = stripUndefinedDeep<Record<string, unknown>>({
        id: jobId,
        jobId,
        kind: "novo_car",
        title: `Novo CAR ${jobId.slice(0, 8)}`,
        filename: `Novo CAR ${jobId.slice(0, 8)}`,
        timestamp: nowIso,
        inputFilename: args.inputFilename || null,
        ...args.result,
        files: {
            inputZipUrl: args.result.inputZipUrl || null,
            outputZipUrl: args.result.outputZipUrl || null,
            contextUrl: args.result.contextUrl || null,
        },
        analysisImageCount: Array.isArray(args.result.images) ? args.result.images.length : 0,
        updatedAt: now,
    });

    await withRetry("firestore_persist_auas_job", AUAS_FIRESTORE_PERSIST_RETRY_ATTEMPTS, async () => {
        await adminDb.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const createdAt = snap.exists
                ? ((snap.get("createdAt") as Timestamp | undefined) || now)
                : now;
            tx.set(docRef, stripUndefinedDeep({ ...payloadBase, createdAt }), { merge: true });
        });
    });
}

/* ─── Cache de jobs ──────────────────────────────────────────────── */
type AuasJob = {
    buffer?: Buffer;
    filename: string;
    inputZipUrl?: string;
    outputZipUrl?: string;
    contextUrl?: string;
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

type AuasOpeningSource = "PRODES" | "AI_FALLBACK";

type AuasOpeningResolution = {
    year: number | null;
    source?: AuasOpeningSource;
};

function normalizeCandidateYear(raw: unknown): number | null {
    const year = Number(raw);
    if (!Number.isFinite(year)) return null;
    const normalized = Math.floor(year);
    if (normalized < 1900 || normalized > 2100) return null;
    return normalized;
}

function extractYearsFromText(text: string): number[] {
    const out = new Set<number>();
    const re = /\b(19\d{2}|20\d{2})\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(String(text || ""))) !== null) {
        const parsed = normalizeCandidateYear(match[1]);
        if (parsed) out.add(parsed);
    }
    return [...out.values()].sort((a, b) => a - b);
}

function resolveAuasOpeningYear(
    auasPerYear: Map<number, number>,
    aiText?: string,
): AuasOpeningResolution {
    const yearsFromProdes = [...auasPerYear.keys()]
        .map((year) => normalizeCandidateYear(year))
        .filter((year): year is number => year !== null);
    if (yearsFromProdes.length > 0) {
        return {
            year: Math.max(...yearsFromProdes),
            source: "PRODES",
        };
    }

    const yearsFromAi = extractYearsFromText(aiText || "");
    if (yearsFromAi.length > 0) {
        return {
            year: yearsFromAi[yearsFromAi.length - 1],
            source: "AI_FALLBACK",
        };
    }

    return { year: null };
}

function buildAuasAberturaAttrib(
    fieldDefs: DbfFieldDef[],
    openingYear: number | null,
): Record<string, string | number | null> {
    if (!openingYear) return {};
    const field = fieldDefs.find((item) => item.name.toUpperCase() === "ABERTURA");
    if (!field) return {};

    const dateLiteral = `01/01/${openingYear}`;
    if (field.type === "D") {
        return { [field.name]: `${openingYear}0101` };
    }
    if (field.type === "C") {
        return { [field.name]: dateLiteral };
    }
    return {};
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
        model: args.model || "gemini-2.5-pro",
        endpoint: args.endpoint,
        inputTokens: Math.max(1, Math.round(args.inputTokens || 1)),
        outputTokens: Math.max(1, Math.round(args.outputTokens || 1)),
        estimated: true,
    };
}

/* ─── WFS helpers ────────────────────────────────────────────────── */

type FetchWfsGeoJsonOptions = {
    cql?: string;
    extraParams?: Record<string, string>;
    typeNameCandidates?: string[];
};

function uniqueNonEmpty(items: Array<string | null | undefined>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
        const value = String(raw || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

function buildTypeNameCandidates(typeName: string): string[] {
    const base = String(typeName || "").trim();
    if (!base.includes(":")) return uniqueNonEmpty([base]);
    const [namespace, layer] = base.split(":", 2);
    return uniqueNonEmpty([
        base,
        `${namespace.toLowerCase()}:${layer}`,
        `${namespace.toUpperCase()}:${layer}`,
        layer,
    ]);
}

function buildWfsBaseUrlCandidates(baseUrl: string): string[] {
    const raw = String(baseUrl || "").trim();
    if (!raw) return [];

    try {
        const parsed = new URL(raw);
        const path = parsed.pathname.replace(/\/+$/g, "");
        const out = [parsed.toString()];

        const withPath = (nextPath: string) => {
            const candidate = new URL(parsed.toString());
            candidate.pathname = nextPath;
            return candidate.toString();
        };

        if (/\/ows$/i.test(path)) {
            out.push(withPath(path.replace(/\/ows$/i, "/wfs")));
        } else if (/\/wfs$/i.test(path)) {
            out.push(withPath(path.replace(/\/wfs$/i, "/ows")));
        } else {
            out.push(withPath(`${path}/ows`));
            out.push(withPath(`${path}/wfs`));
        }

        return uniqueNonEmpty(out);
    } catch {
        const trimmed = raw.replace(/\/+$/g, "");
        return uniqueNonEmpty([raw, `${trimmed}/ows`, `${trimmed}/wfs`]);
    }
}

async function fetchWfsGeoJson(
    baseUrl: string,
    typeName: string,
    options: FetchWfsGeoJsonOptions = {},
): Promise<FeatureCollection> {
    const baseUrls = buildWfsBaseUrlCandidates(baseUrl);
    if (!baseUrls.length) {
        throw new Error("URL base do WFS não informada.");
    }

    const typeNames = uniqueNonEmpty(options.typeNameCandidates?.length
        ? options.typeNameCandidates
        : buildTypeNameCandidates(typeName));
    if (!typeNames.length) return { type: "FeatureCollection", features: [] };

    const versions = [
        { version: "2.0.0", typeParam: "typeNames", limitParam: "count" },
        { version: "1.1.0", typeParam: "typeName", limitParam: "maxFeatures" },
        { version: "1.0.0", typeParam: "typeName", limitParam: "maxFeatures" },
    ] as const;

    let lastError: unknown;
    for (const baseCandidate of baseUrls) {
        for (const cfg of versions) {
            for (const candidate of typeNames) {
                try {
                    const url = new URL(baseCandidate);
                    url.searchParams.set("service", "WFS");
                    url.searchParams.set("version", cfg.version);
                    url.searchParams.set("request", "GetFeature");
                    url.searchParams.set(cfg.typeParam, candidate);
                    url.searchParams.set("outputFormat", "application/json");
                    url.searchParams.set(cfg.limitParam, "50000");
                    if (options.cql) url.searchParams.set("CQL_FILTER", options.cql);
                    for (const [key, value] of Object.entries(options.extraParams || {})) {
                        if (!value) continue;
                        url.searchParams.set(key, value);
                    }
                    const data = await fetchJsonWithTimeout<FeatureCollection>(url.toString(), WFS_TIMEOUT);
                    if (!data || !Array.isArray(data.features)) {
                        return { type: "FeatureCollection", features: [] };
                    }
                    return data;
                } catch (err) {
                    lastError = err;
                }
            }
        }
    }

    throw lastError || new Error("Falha ao consultar WFS.");
}

async function fetchProdesGeoJson(wkt: string): Promise<FeatureCollection> {
    const layerCandidates = uniqueNonEmpty([
        PRODES_LAYER,
        "prodes-legal-amz:yearly_deforestation",
        "yearly_deforestation",
    ]);
    const baseUrlCandidates = uniqueNonEmpty([
        DEFAULT_PRODES_WFS_URL,
        ...PRODES_WFS_URL_FALLBACKS,
    ]);
    const typeNameCandidates = uniqueNonEmpty(layerCandidates.flatMap((item) => buildTypeNameCandidates(item)));
    const geomFields = uniqueNonEmpty([PRODES_GEOM_FIELD, "geom", "GEOMETRY", "the_geom"]);
    let lastError: unknown;
    for (const baseUrl of baseUrlCandidates) {
        for (const geomField of geomFields) {
            try {
                return await fetchWfsGeoJson(baseUrl, PRODES_LAYER, {
                    cql: `INTERSECTS(${geomField},${wkt})`,
                    typeNameCandidates,
                });
            } catch (err: any) {
                const msg = String(err?.message || err || "erro desconhecido");
                lastError = new Error(`PRODES base=${baseUrl} geom=${geomField}: ${msg}`);
            }
        }
    }
    throw lastError || new Error("Falha ao consultar PRODES.");
}

async function fetchSfbRiversGeoJson(wkt: string): Promise<FeatureCollection> {
    const geomFields = uniqueNonEmpty([SFB_GEOM_FIELD, "SHAPE", "geom", "GEOMETRY", "the_geom"]);
    const classFields = uniqueNonEmpty([SFB_CLASS_FIELD, "CLASSE"]);
    const cqlCandidates: Array<{ cql: string; requiresClass: boolean }> = [];
    const seen = new Set<string>();
    for (const geomField of geomFields) {
        for (const field of classFields) {
            const cql = `INTERSECTS(${geomField},${wkt}) AND ${field} = 1`;
            const key = `class|${cql}`;
            if (!seen.has(key)) {
                seen.add(key);
                cqlCandidates.push({ cql, requiresClass: true });
            }
        }
        const noClassCql = `INTERSECTS(${geomField},${wkt})`;
        const noClassKey = `noclass|${noClassCql}`;
        if (!seen.has(noClassKey)) {
            seen.add(noClassKey);
            cqlCandidates.push({ cql: noClassCql, requiresClass: false });
        }
    }

    let lastError: unknown;
    for (const candidate of cqlCandidates) {
        try {
            const data = await fetchWfsGeoJson(SFB_WFS_URL, SFB_RIVER_LAYER, {
                cql: candidate.cql,
                extraParams: SFB_WFS_AUTHKEY ? { authkey: SFB_WFS_AUTHKEY } : undefined,
            });
            if (Array.isArray(data.features) && data.features.length === 0 && candidate.requiresClass) {
                continue;
            }
            return data;
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error("Falha ao consultar hidrografia SFB.");
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
    const { shp, shx } = buildShpAndShx([record]);
    const dbfBuffer = buildDbfBuffer([attribs], fieldDefs);
    const prjBuf = prjForLayer(templateEntries, layerName);

    const out: Array<{ ext: string; data: Buffer }> = [
        { ext: "shp", data: shp },
        { ext: "shx", data: shx },
        { ext: "dbf", data: dbfBuffer },
    ];
    if (prjBuf) out.push({ ext: "prj", data: prjBuf });
    return out;
}

/* ─── Análise principal ──────────────────────────────────────────── */

async function runAuasAnalysis(
    res: Response,
    propertyZip: Buffer,
    options?: { inputFilename?: string; uid?: string },
): Promise<{ completed: boolean; cloudinaryStoredBytes: number }> {
    // 1. Parse shapefile da propriedade
    progress(res, 5, "parse", "Lendo shapefile da propriedade...");
    let userResult: ReturnType<typeof parseUserShapefile>;
    try {
        userResult = parseUserShapefile(propertyZip);
    } catch (err: any) {
        sendSSE(res, { type: "error", message: err.message || "Erro ao processar shapefile." });
        return { completed: false, cloudinaryStoredBytes: 0 };
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
    let prodesFeatures: FeatureCollection = { type: "FeatureCollection", features: [] };
    try {
        prodesFeatures = await fetchProdesGeoJson(wkt);
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
            // Preferir rios de menor classe (<= 10 m), com fallback automático para schemas/campos diferentes.
            const riverGeoJson = await fetchSfbRiversGeoJson(wkt);
            progress(res, 62, "rivers", `SFB: ${riverGeoJson.features.length} rios encontrados. Aplicando buffer...`);

            const riverBuffers: Feature<Polygon | MultiPolygon>[] = [];
            for (const feat of riverGeoJson.features) {
                if (!feat.geometry) continue;
                const g = feat.geometry as Geometry;
                // Apenas linhas recebem buffer — polígonos representam corpos d'água já mais largos que 4 m
                if (g.type !== "LineString" && g.type !== "MultiLineString") continue;
                const buf = lineToBuffer(g as LineString | MultiLineString, RIVER_BUFFER_METERS);
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

    // 9. Análise de IA — mesmo fluxo da aba de recorte com CAR já vetorizado
    const jobId = crypto.randomUUID();
    const zipFilename = `auas_${jobId.slice(0, 8)}.zip`;
    const auasLayerSummaries: LayerSummary[] = [
        { name: "AREA_CONSOLIDADA", source: "wfs", features: acUnion ? 1 : 0, areaHa: acAreaHa },
        { name: "AUAS",             source: "wfs", features: auasUnion ? 1 : 0, areaHa: auasAreaHa },
        { name: "AVN",              source: "wfs", features: avnFeature ? 1 : 0, areaHa: avnAreaHa },
        { name: "ARL",              source: "wfs", features: avnFeature ? 1 : 0, areaHa: arlAreaHa },
    ];

    const propertyBbox = turfBbox(propertyFeature) as [number, number, number, number];
    const clippedGeometries = new Map<string, Geometry[]>();
    if (acUnion?.geometry)   clippedGeometries.set("AREA_CONSOLIDADA", [acUnion.geometry]);
    if (auasUnion?.geometry) clippedGeometries.set("AUAS", [auasUnion.geometry]);
    if (avnFeature?.geometry) {
        clippedGeometries.set("AVN", [avnFeature.geometry]);
        clippedGeometries.set("ARL", [avnFeature.geometry]);
    }

    const aiJob: CachedJob = {
        expiresAt: Date.now() + 3_600_000,
        filename: "auas-ai",
        bbox: propertyBbox,
        polygon: propertyFeature,
        layerSummaries: auasLayerSummaries,
        areaHa: propertyAreaHa,
        clippedGeometries,
    };

    let aiResult: Awaited<ReturnType<typeof runAcAvnSatelliteAnalysis>> = null;
    try {
        const satelliteLayers = getFixedAcAvnSatelliteKeys();
        aiResult = await runAcAvnSatelliteAnalysis(res, aiJob, satelliteLayers, { tag: jobId.slice(0, 8) });
    } catch (err: any) {
        console.warn("[AUAS] AI analysis failed (continuing without it):", err.message);
    }

    const openingResolution = resolveAuasOpeningYear(auasPerYear, aiResult?.analysisText || "");
    if (!openingResolution.year) {
        console.warn("[AUAS] ABERTURA sem ano detectado.");
    }
    const auasOpeningDate = openingResolution.year ? `01/01/${openingResolution.year}` : undefined;
    const auasFieldDefs = readTemplateSchema(templateEntries, "AUAS");
    const auasAberturaAttrib = buildAuasAberturaAttrib(auasFieldDefs, openingResolution.year);

    progress(res, 92, "shapefiles", "Gerando shapefiles de saída...");

    // 10. Gerar ZIP com shapefiles usando o template do Arquivo Modelo
    const layers: Array<{ name: string; feature: Feature<Polygon | MultiPolygon> | null }> = [
        { name: "AREA_CONSOLIDADA", feature: acUnion },
        { name: "AUAS", feature: auasUnion },
        { name: "AVN", feature: avnFeature },
        { name: "ARL", feature: avnFeature }, // ARL = AVN
    ];

    const archive = archiver("zip", { zlib: { level: 6 } });
    const zipChunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => zipChunks.push(chunk));

    for (const { name, feature } of layers) {
        if (!feature) continue;
        const extraAttribs =
            name === "AUAS" && Object.keys(auasAberturaAttrib).length > 0
                ? auasAberturaAttrib
                : {};
        const bufs = buildLayerBuffers(name, feature, templateEntries, extraAttribs);
        for (const { ext, data } of bufs) {
            if (!Buffer.isBuffer(data) || data.length === 0) {
                console.warn(
                    `[AUAS] arquivo inválido ignorado ao montar ZIP: layer=${name} ext=${ext} type=${typeof data}`,
                );
                continue;
            }
            archive.append(data, { name: `${name}.${ext}` });
        }
    }

    await archive.finalize();
    const zipBuffer = Buffer.concat(zipChunks);

    let inputZipUrl: string | undefined;
    let outputZipUrl: string | undefined;
    let contextUrl: string | undefined;
    let cloudinaryStoredBytes = 0;
    progress(res, 96, "cloudinary", "Salvando arquivos do Novo CAR no Cloudinary...");
    const tag = jobId.slice(0, 8);
    const contextPayload = {
        version: 1,
        source: "novo_car_tab",
        jobId,
        savedAtIso: new Date().toISOString(),
        inputFilename: options?.inputFilename || `imovel_${tag}.zip`,
        outputFilename: zipFilename,
        metrics: {
            propertyAreaHa,
            acAreaHa,
            auasAreaHa,
            avnAreaHa,
            arlAreaHa,
            riverBufferHa,
            auasOpeningYear: openingResolution.year,
            auasOpeningSource: openingResolution.source || null,
        },
    };
    const contextBuffer = Buffer.from(JSON.stringify(contextPayload), "utf8");
    const uploadTasks: Array<{
        label: "input_zip" | "output_zip" | "context_json";
        bytes: number;
        run: () => Promise<string>;
        assign: (url: string) => void;
    }> = [
        {
            label: "input_zip",
            bytes: propertyZip.length,
            run: () => uploadZipBufferToCloudinary(propertyZip, `auas_input_${tag}`),
            assign: (url) => { inputZipUrl = url; },
        },
        {
            label: "output_zip",
            bytes: zipBuffer.length,
            run: () => uploadZipBufferToCloudinary(zipBuffer, `auas_output_${tag}`),
            assign: (url) => { outputZipUrl = url; },
        },
        {
            label: "context_json",
            bytes: contextBuffer.length,
            run: () => uploadRawBufferToCloudinary(
                contextBuffer,
                `auas_context_${tag}.json`,
                "application/json",
            ),
            assign: (url) => { contextUrl = url; },
        },
    ];

    for (const task of uploadTasks) {
        const url = await withRetry(
            `cloudinary_${task.label}`,
            AUAS_CLOUDINARY_UPLOAD_RETRY_ATTEMPTS,
            async () => task.run(),
        );
        task.assign(url);
        cloudinaryStoredBytes += Math.max(0, Number(task.bytes) || 0);
    }

    if (!inputZipUrl || !outputZipUrl || !contextUrl) {
        throw new Error("Falha ao persistir todos os arquivos obrigatorios do Novo CAR no Cloudinary.");
    }

    const aiImageBytes = Math.max(0, Number(aiResult?.cloudinaryStoredBytes || 0));
    if (aiImageBytes > 0) {
        cloudinaryStoredBytes += aiImageBytes;
    }

    if (aiResult && !aiResult.imageOnly) {
        const aiImagesSaved = Array.isArray(aiResult.cloudinaryUrls) ? aiResult.cloudinaryUrls.length : 0;
        if (aiImagesSaved === 0) {
            throw new Error("Falha ao salvar as imagens da analise no Cloudinary.");
        }
    }

    // Guardar em cache para download
    pruneAuasCache();
    auasJobCache.set(jobId, {
        buffer: zipBuffer,
        filename: zipFilename,
        inputZipUrl,
        outputZipUrl,
        contextUrl,
        expiresAt: Date.now() + CACHE_TTL,
    });

    const auasPolygons = Array.from(auasPerYear.entries()).map(([year, ha]) => ({ year, areaHa: ha }));
    const resultData: AuasResultData = {
        propertyAreaHa,
        acAreaHa,
        auasAreaHa,
        avnAreaHa,
        arlAreaHa,
        riverBufferHa,
        auasPolygons,
        downloadUrl: outputZipUrl,
        inputZipUrl,
        outputZipUrl,
        contextUrl,
        auasOpeningYear: openingResolution.year || undefined,
        auasOpeningDate,
        auasOpeningSource: openingResolution.source,
        ...(aiResult && !aiResult.imageOnly ? {
            analysis: aiResult.analysisText,
            images: aiResult.cloudinaryUrls,
            satellitesUsed: aiResult.usedSatelliteKeys,
            satellitesMissing: aiResult.missingSatelliteKeys,
            cloudWarnings: aiResult.cloudWarnings.length > 0 ? aiResult.cloudWarnings : undefined,
            analysisMeta: aiResult.analysisMeta,
            analysisRulesVersion: "acavn-fixed-v4",
        } : {}),
    };

    if (options?.uid) {
        progress(res, 98, "firebase", "Salvando historico do Novo CAR no Firebase...");
        await persistAuasJobInFirestore({
            uid: options.uid,
            jobId,
            inputFilename: options.inputFilename,
            result: resultData,
        });
    }

    progress(res, 99, "done", "Processamento concluido. Preparando resultado final...");

    sendSSE(res, {
        type: "result",
        jobId,
        data: resultData,
    });
    return { completed: true, cloudinaryStoredBytes };
}

/* ─── Registro de rotas ──────────────────────────────────────────── */

export function registerAuasRoutes(app: Express) {

    /** POST /api/auas/analyze — SSE stream */
    app.post("/api/auas/analyze", async (req: Request, res: Response) => {
        let billingUid = "";
        let operationRequestId = "";
        let operationReserved = 0;
        let storageRequestId = "";
        let storageReserved = 0;
        let usageInputs: Array<any> = [];
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

            operationRequestId = createRequestId("novo_car");
            operationReserved = await estimateReserveForModels({
                models: [...AUAS_BILLING_MODELS],
                estimatedInputTokens: 90_000,
                estimatedOutputTokens: 8_000,
                imageCount: 12,
                imageWidthPx: 1024,
                imageHeightPx: 768,
                safetyMultiplier: 1.35,
            });
            await reserveCredits({
                uid,
                amountBrl: operationReserved,
                requestId: operationRequestId,
                endpoint: AUAS_BILLING_ENDPOINT,
            });
            storageRequestId = createRequestId("novo_car_storage");
            const estimatedStorageBytes = Math.max(
                zipBuffer.length * 3,
                zipBuffer.length + 320_000,
            ) + (AUAS_ESTIMATED_AI_IMAGE_COUNT * AUAS_ESTIMATED_BYTES_PER_AI_IMAGE);
            storageReserved = await estimateCloudinaryStorageReserve({
                bytesStored: estimatedStorageBytes,
                safetyMultiplier: 1.2,
            });
            if (storageReserved > 0) {
                await reserveCredits({
                    uid,
                    amountBrl: storageReserved,
                    requestId: storageRequestId,
                    endpoint: AUAS_STORAGE_ENDPOINT,
                });
            }

            // Inicia SSE
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();

            let analysisResult: { completed: boolean; cloudinaryStoredBytes: number } = {
                completed: false,
                cloudinaryStoredBytes: 0,
            };
            await runWithBillingUsageSession(async () => {
                try {
                    analysisResult = await runAuasAnalysis(res, zipBuffer, {
                        inputFilename: body.filename,
                        uid,
                    });
                } finally {
                    usageInputs = getBillingUsageSessionRecords();
                }
            });

            if (usageInputs.length > 0 || analysisResult.completed) {
                const usageForSettle = usageInputs.length > 0
                    ? usageInputs
                    : [
                        buildEstimatedUsageForFallback({
                            endpoint: AUAS_BILLING_ENDPOINT,
                            provider: "gemini",
                            model: "gemini-2.5-pro",
                            inputTokens: 90_000,
                            outputTokens: 8_000,
                        }),
                    ];
                const billing = await settleReservedCredits({
                    uid,
                    requestId: operationRequestId,
                    endpoint: AUAS_BILLING_ENDPOINT,
                    reservedBrl: operationReserved,
                    usageInputs: usageForSettle,
                });
                operationReserved = 0;
                sendSSE(res, { type: "billing", billing });
            } else if (operationReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: operationRequestId,
                    amountBrl: operationReserved,
                    endpoint: AUAS_BILLING_ENDPOINT,
                    reason: "no_ai_usage",
                });
                operationReserved = 0;
            }

            if (analysisResult.completed && storageReserved > 0) {
                if (analysisResult.cloudinaryStoredBytes > 0) {
                    const storageBilling = await settleCloudinaryStorageReserve({
                        uid,
                        requestId: storageRequestId,
                        endpoint: AUAS_STORAGE_ENDPOINT,
                        reservedBrl: storageReserved,
                        bytesStored: analysisResult.cloudinaryStoredBytes,
                        assetKind: "novo_car_bundle",
                    });
                    storageReserved = 0;
                    sendSSE(res, { type: "billing", billing: storageBilling });
                } else {
                    await refundReserve({
                        uid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: AUAS_STORAGE_ENDPOINT,
                        reason: "cloudinary_storage_not_persisted",
                    });
                    storageReserved = 0;
                }
            } else if (storageReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: storageRequestId,
                    amountBrl: storageReserved,
                    endpoint: AUAS_STORAGE_ENDPOINT,
                    reason: "auas_failed_or_invalid",
                });
                storageReserved = 0;
            }
        } catch (err: any) {
            console.error("[AUAS] Unhandled error:", err);
            if (billingUid && operationReserved > 0 && operationRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: operationRequestId,
                        amountBrl: operationReserved,
                        endpoint: AUAS_BILLING_ENDPOINT,
                        reason: "exception",
                    });
                    operationReserved = 0;
                } catch (refundErr) {
                    console.error("[AUAS] operation refund error:", refundErr);
                }
            }
            if (billingUid && storageReserved > 0 && storageRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: AUAS_STORAGE_ENDPOINT,
                        reason: "exception",
                    });
                    storageReserved = 0;
                } catch (refundErr) {
                    console.error("[AUAS] storage refund error:", refundErr);
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
            if (!res.writableEnded) {
                if (res.headersSent) {
                    sendSSE(res, { type: "error", message: err.message || "Erro interno na análise AUAS." });
                } else {
                    res.status(500).json({ error: err.message || "Erro interno na análise AUAS." });
                }
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
            if (job?.outputZipUrl) {
                res.redirect(job.outputZipUrl);
                return;
            }
            res.status(404).json({ error: "Arquivo não encontrado ou expirado." });
            return;
        }
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
        res.setHeader("Content-Length", job.buffer.length.toString());
        res.send(job.buffer);
    });
}

