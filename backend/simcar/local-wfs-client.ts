/** Cliente do GeoServer local que publica o snapshot mensal oficial do SIMCAR. */
import fs from "node:fs";
import type { WfsClipFetchResult, WfsFeature } from "./types";
import { WFS_MAX_FEATURES } from "./constants";

export const LOCAL_SIMCAR_WFS_BASE = String(
    process.env.SIMCAR_LOCAL_WFS_BASE_URL || "http://127.0.0.1:8081/geoserver/cbers/ows",
).replace(/\/+$/, "");

const LOCAL_LAYER_PREFIX = "cbers:car_digital_simcar_d_simcar_d_";

const LOCAL_LAYER_ALIASES: Record<string, string> = {
    VEREDA: "veredas",
};

export const SIMCAR_SNAPSHOT_MANIFEST_PATH = String(
    process.env.SIMCAR_SNAPSHOT_MANIFEST_PATH ||
    "/media/server/HD Backup/VETOR/CAR_Digital/current/manifest.json",
);

export const SIMCAR_SNAPSHOT_MAX_AGE_DAYS = Math.max(
    1,
    Number(process.env.SIMCAR_SNAPSHOT_MAX_AGE_DAYS || 45),
);

export type SimcarSnapshotInfo = {
    snapshot: string;
    generatedAt: string;
    ageDays: number;
    storeNames: Set<string>;
};

export class LocalSimcarSourceError extends Error {
    readonly code = "SIMCAR_SNAPSHOT_UNAVAILABLE";

    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "LocalSimcarSourceError";
    }
}

export function readValidatedSimcarSnapshot(
    manifestPath = SIMCAR_SNAPSHOT_MANIFEST_PATH,
    nowMs = Date.now(),
): SimcarSnapshotInfo {
    let raw: any;
    try {
        raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        throw new LocalSimcarSourceError(
            "A cópia mensal oficial do SIMCAR Digital não está disponível. O recorte foi cancelado; tente novamente após a atualização da base.",
            { cause: error },
        );
    }

    const snapshot = String(raw?.snapshot || "").trim();
    const generatedAt = String(raw?.generated_at || "").trim();
    const generatedMs = Date.parse(generatedAt);
    const layers = Array.isArray(raw?.groups)
        ? raw.groups.flatMap((group: any) => Array.isArray(group?.layers) ? group.layers : [])
        : [];
    const storeNames = new Set<string>(
        layers
            .map((layer: any) => String(layer?.store_name || "").trim())
            .filter(Boolean),
    );
    const ageDays = (nowMs - generatedMs) / 86_400_000;
    if (
        !snapshot ||
        !Number.isFinite(generatedMs) ||
        generatedMs > nowMs + 86_400_000 ||
        ageDays > SIMCAR_SNAPSHOT_MAX_AGE_DAYS ||
        storeNames.size === 0
    ) {
        throw new LocalSimcarSourceError(
            `A cópia mensal oficial do SIMCAR Digital está ausente, inválida ou desatualizada (limite ${SIMCAR_SNAPSHOT_MAX_AGE_DAYS} dias). O recorte foi cancelado e nenhum ZIP foi gerado.`,
        );
    }

    return { snapshot, generatedAt, ageDays, storeNames };
}

export function resolveLocalSimcarWfsLayer(templateLayer: string): string | null {
    const name = String(templateLayer || "").trim().toUpperCase();
    if (!name || name === "AIR" || name === "ATP") return null;
    const suffix = LOCAL_LAYER_ALIASES[name] || name.toLowerCase();
    const unavailable = new Set(["AREA_USO_RESTRITO", "AREA_ALTITUDE_1800", "ARLREM", "RIO_ACIMA_600"]);
    if (unavailable.has(name)) return null;
    return `${LOCAL_LAYER_PREFIX}${suffix}`;
}

export async function getLocalSimcarLayerNames(): Promise<Set<string>> {
    const url = buildLocalWfsUrl({
        service: "WFS",
        version: "2.0.0",
        request: "GetCapabilities",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`GeoServer local ${response.status}`);
        const xml = await response.text();
        const names = new Set<string>();
        for (const match of xml.matchAll(/<FeatureType\b[\s\S]*?<Name>\s*([^<]+)\s*<\/Name>[\s\S]*?<\/FeatureType>/gi)) {
            const name = String(match[1] || "").trim();
            if (name) names.add(name);
        }
        if (names.size === 0) throw new Error("GetCapabilities local sem camadas");
        return names;
    } catch (error) {
        throw new LocalSimcarSourceError(
            "A cópia mensal oficial do SIMCAR Digital está temporariamente indisponível. O recorte foi cancelado e nenhum ZIP parcial foi gerado.",
            { cause: error },
        );
    } finally {
        clearTimeout(timeout);
    }
}

function buildLocalWfsUrl(params: Record<string, string | number>): string {
    const url = new URL(LOCAL_SIMCAR_WFS_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url.toString();
}

function formatBbox(bbox: [number, number, number, number]): string {
    return `${bbox.map((value) => Number(value.toFixed(8))).join(",")},EPSG:4674`;
}

export async function fetchLocalSimcarBboxFeatures(
    typeName: string,
    bbox: [number, number, number, number],
): Promise<WfsClipFetchResult> {
    const features: WfsFeature[] = [];
    const pageSize = 2000;
    let startIndex = 0;
    let totalMatched: number | undefined;

    while (features.length < WFS_MAX_FEATURES) {
        const count = Math.min(pageSize, WFS_MAX_FEATURES - features.length);
        const url = buildLocalWfsUrl({
            service: "WFS",
            version: "2.0.0",
            request: "GetFeature",
            typeNames: typeName,
            outputFormat: "application/json",
            srsName: "EPSG:4674",
            bbox: formatBbox(bbox),
            count,
            startIndex,
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        let response: Response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } catch (error) {
            throw new LocalSimcarSourceError(
                "A cópia mensal oficial do SIMCAR Digital está temporariamente indisponível. O recorte foi cancelado e nenhum ZIP parcial foi gerado.",
                { cause: error },
            );
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`WFS local ${response.status}: ${detail.slice(0, 180)}`);
        }
        const page = await response.json() as any;
        const pageFeatures = Array.isArray(page?.features) ? page.features : [];
        const matched = Number(page?.numberMatched ?? page?.totalFeatures);
        if (Number.isFinite(matched) && matched >= 0) totalMatched = matched;
        for (const feature of pageFeatures) {
            features.push({
                id: typeof feature?.id === "string" ? feature.id : undefined,
                geometry: feature?.geometry || null,
                properties: feature?.properties || {},
                bbox: Array.isArray(feature?.bbox) ? feature.bbox : undefined,
            });
        }
        if (pageFeatures.length < count) break;
        startIndex += pageFeatures.length;
    }

    const partial = features.length >= WFS_MAX_FEATURES && (totalMatched === undefined || totalMatched > features.length);
    return {
        features,
        warnings: partial ? [`Base local limitada a ${WFS_MAX_FEATURES} feições para esta camada.`] : [],
        partial,
        totalMatched,
        numberReturned: features.length,
    };
}
