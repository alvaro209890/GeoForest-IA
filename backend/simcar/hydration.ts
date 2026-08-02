/**
 * Hydration & Persistence — retomada de jobs SIMCAR (contexto ZIP/persistido)
 * e persistência de estado/artefatos em storage local + Firestore.
 *
 * Extraído de simcar-clip.ts (Plano 02, Fase 5a).
 */

import fs from "fs";
import path from "path";
import { parsePolygonGeometryFromGml } from "../sigef-client";
import { STORAGE_ROOT, writeDocBySegments } from "../local-storage";
import { normalizePolygonGeometry, polygonToWkt, toPolygonOrMultiFeature } from "../wfs-intersection";
import { extractZipEntries } from "../geo-utils";
import { readFullShapefile } from "./shapefile-io";
import { dedupeWarnings, appendLayerWarning, inspectPropertyLayerConsistency } from "./area-calculator";
import { CACHE_TTL_MS, DIRECT_COPY_LAYERS } from "./constants";
import { parsePersistedClipContext, objectToMapGeometry } from "./clip-pipeline";
import { jobCache } from "./clip-pipeline";
import { toPublicApiUrl } from "./constants";
import { area as turfArea, polygon as turfPolygon } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import type { CachedJob, LayerSummary, PersistedClipContextV1 } from "./types";

export function readPersistedSimcarClip(jobId: string): Record<string, any> | null {
    const safeJobId = String(jobId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safeJobId) return null;
    const usersDir = path.join(STORAGE_ROOT, "users");
    try {
        if (!fs.existsSync(usersDir)) return null;
        for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const docPath = path.join(usersDir, entry.name, "simcar_clips", `${safeJobId}.json`);
            if (!fs.existsSync(docPath)) continue;
            const parsed = JSON.parse(fs.readFileSync(docPath, "utf8"));
            if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
        }
    } catch (error) {
        console.warn("[SIMCAR CLIP] failed to read persisted clip for download:", error);
    }
    return null;
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

export function parseCachedContextFromOutputZip(
    zipBuffer: Buffer,
    filename: string,
    outputZipUrl?: string,
): CachedJob | null {
    const entries = extractZipEntries(zipBuffer);
    const clippedGeometries = new Map<string, Geometry[]>();
    const layerSummaries: LayerSummary[] = [];
    const warnings: string[] = [];

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

    const propertySelection = inspectPropertyLayerConsistency(clippedGeometries);
    warnings.push(...propertySelection.warnings);
    const propertyFeature = propertySelection.feature;
    if (propertySelection.warnings.length > 0) {
        layerSummaries.forEach((layer, index) => {
            if (layer.name !== "ATP" && layer.name !== "AIR") return;
            layerSummaries[index] = appendLayerWarning(layer, propertySelection.warnings);
        });
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
        warnings: dedupeWarnings(warnings),
        propertySourceLayer: propertySelection.sourceLayer,
    };
}

async function hydrateJobFromOutputZipUrl(jobId: string, outputZipUrl?: string): Promise<CachedJob | null> {
    if (!outputZipUrl) return null;
    const zipUrl = toPublicApiUrl(outputZipUrl);
    try {
        const response = await fetch(zipUrl);
        if (!response.ok) {
            throw new Error(`ZIP ${response.status}`);
        }
        const arr = await response.arrayBuffer();
        const zipBuffer = Buffer.from(arr);
        const hydrated = parseCachedContextFromOutputZip(
            zipBuffer,
            `SIMCAR_Recorte_${jobId}.zip`,
            zipUrl,
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
    const contextFetchUrl = toPublicApiUrl(contextUrl);
    try {
        const response = await fetch(contextFetchUrl);
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
            contextJsonUrl: contextFetchUrl,
            warnings: parsed.warnings,
            propertySourceLayer: parsed.propertySourceLayer,
        };
        jobCache.set(jobId, hydrated);
        return hydrated;
    } catch (err: any) {
        console.warn(`[SIMCAR ANALYSIS] context hydrate failed for ${jobId}:`, err?.message || err);
        return null;
    }
}

function getPersistedHydrationUrls(jobId: string, contextUrl?: string, outputZipUrl?: string): {
    contextUrl?: string;
    outputZipUrl?: string;
} {
    const persisted = readPersistedSimcarClip(jobId);
    const persistedDownloadUrl = String(persisted?.downloadUrl || "").trim();
    const safeDownloadUrl =
        persistedDownloadUrl && !persistedDownloadUrl.includes(`/api/simcar/clip/download/${jobId}`)
            ? persistedDownloadUrl
            : "";
    const resolvedContextUrl = String(
        contextUrl ||
        persisted?.contextUrl ||
        persisted?.files?.contextUrl ||
        "",
    ).trim();
    const resolvedOutputZipUrl = String(
        outputZipUrl ||
        persisted?.outputZipUrl ||
        persisted?.files?.outputZipUrl ||
        safeDownloadUrl ||
        "",
    ).trim();
    return {
        contextUrl: resolvedContextUrl ? toPublicApiUrl(resolvedContextUrl) : undefined,
        outputZipUrl: resolvedOutputZipUrl ? toPublicApiUrl(resolvedOutputZipUrl) : undefined,
    };
}

export async function hydrateCachedJob(
    jobId: string,
    contextUrl?: string,
    outputZipUrl?: string,
): Promise<CachedJob | undefined> {
    let job = jobCache.get(jobId);
    if (job?.bbox && job.polygon && job.layerSummaries) return job;

    const urls = getPersistedHydrationUrls(jobId, contextUrl, outputZipUrl);
    if (urls.contextUrl) {
        job = (await hydrateJobFromPersistedContext(jobId, urls.contextUrl)) ?? undefined;
        if (job?.bbox && job.polygon && job.layerSummaries) return job;
    }
    if (urls.outputZipUrl) {
        job = (await hydrateJobFromOutputZipUrl(jobId, urls.outputZipUrl)) ?? undefined;
        if (job?.bbox && job.polygon && job.layerSummaries) return job;
    }
    return undefined;
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .map((item) => stripUndefinedDeep(item))
            .filter((item) => item !== undefined) as unknown as T;
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

export async function persistSimcarClipProcessingState(args: {
    uid: string;
    jobId: string;
    filename?: string;
    sourceMode?: "auto-clip" | "vectorized-analysis";
    status: "processing" | "completed" | "cancelled" | "failed";
    result?: {
        downloadUrl?: string;
        inputZipUrl?: string;
        outputZipUrl?: string;
        contextUrl?: string;
        summary?: {
            propertyAreaHa: number;
            crs: string;
            layersProcessed: number;
            layersWithData: number;
            totalFeaturesClipped: number;
            processingTimeMs: number;
            layers: LayerSummary[];
            warnings?: string[];
        };
        filename?: string;
    };
    error?: string;
}): Promise<void> {
    const uid = String(args.uid || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!uid || !jobId) return;
    const sourceMode = args.sourceMode || "auto-clip";
    const summary = args.result?.summary;
    const safeFilename = String(args.filename || args.result?.filename || `Recorte ${jobId.slice(0, 8)}`).trim();
    const payload = stripUndefinedDeep({
        id: jobId,
        jobId,
        kind: "simcar_recorte",
        sourceMode,
        status: args.status,
        title: safeFilename,
        filename: safeFilename,
        downloadUrl: args.result?.downloadUrl || null,
        inputZipUrl: args.result?.inputZipUrl || null,
        outputZipUrl: args.result?.outputZipUrl || null,
        contextUrl: args.result?.contextUrl || null,
        files: {
            inputZipUrl: args.result?.inputZipUrl || null,
            outputZipUrl: args.result?.outputZipUrl || null,
            contextUrl: args.result?.contextUrl || null,
        },
        totalFeatures: Number(summary?.totalFeaturesClipped || 0),
        propertyAreaHa: Number(summary?.propertyAreaHa || 0),
        layersWithData: Number(summary?.layersWithData || 0),
        totalLayers: Number(summary?.layersProcessed || 0),
        processingTimeMs: Number(summary?.processingTimeMs || 0),
        summary: summary || null,
        error: args.error || null,
        timestamp: new Date().toISOString(),
    });
    try {
        writeDocBySegments(["users", uid, "simcar_clips", jobId], payload, { merge: true });
    } catch (error) {
        console.warn("[SIMCAR CLIP] failed to persist processing state:", error);
    }
}

export async function persistSimcarClipArtifacts(args: {
    uid: string;
    jobId: string;
    patch: Record<string, unknown>;
}): Promise<void> {
    const uid = String(args.uid || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!uid || !jobId || !args.patch || typeof args.patch !== "object") return;
    try {
        writeDocBySegments(["users", uid, "simcar_clips", jobId], stripUndefinedDeep(args.patch), { merge: true });
    } catch (error) {
        console.warn("[SIMCAR CLIP] failed to persist analysis artifacts:", error);
    }
}
