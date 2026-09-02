/**
 * Cliente do GeoServer local para os vetores SIMCAR já baixados no servidor.
 *
 * O recorte consulta a mesma base publicada no workspace `cbers`; jamais faz
 * request ao WFS da SEMA. O clip geométrico fino continua no pipeline.
 */
import type { WfsClipFetchResult, WfsFeature } from "./types";
import { WFS_MAX_FEATURES } from "./constants";

export const LOCAL_SIMCAR_WFS_BASE = String(
    process.env.SIMCAR_LOCAL_WFS_BASE_URL || "http://127.0.0.1:8081/geoserver/cbers/ows",
).replace(/\/+$/, "");

const LOCAL_LAYER_PREFIX = "cbers:car_digital_simcar_d_simcar_d_";

const LOCAL_LAYER_ALIASES: Record<string, string> = {
    VEREDA: "veredas",
};

export function resolveLocalSimcarWfsLayer(templateLayer: string): string | null {
    const name = String(templateLayer || "").trim().toUpperCase();
    if (!name || name === "AIR" || name === "ATP") return null;
    const suffix = LOCAL_LAYER_ALIASES[name] || name.toLowerCase();
    const unavailable = new Set(["AREA_USO_RESTRITO", "AREA_ALTITUDE_1800", "ARLREM", "RIO_ACIMA_600"]);
    if (unavailable.has(name)) return null;
    return `${LOCAL_LAYER_PREFIX}${suffix}`;
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
        const response = await fetch(url);
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
