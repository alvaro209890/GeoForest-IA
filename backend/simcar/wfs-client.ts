/**
 * WFS client — busca de features na SEMA-MT (clip por BBOX/INTERSECTS).
 * Extraído de simcar-clip.ts (Plano 02, Fase 4b).
 */

import {
    buildWfsUrl,
    fetchJsonWithTimeout,
    fetchTextWithTimeout,
    getGeometryFieldForLayer,
    WFS_TIMEOUT_MS,
    WFS_PAGE_SIZE,
} from "../wfs-intersection";
import { dedupeWarnings } from "./area-calculator";
import { WFS_MAX_FEATURES } from "./constants";
import type { WfsClipFetchResult, WfsFeature } from "./types";

export type { WfsClipFetchResult };

function parseNumberMatched(xml: string): number | null {
    const match = String(xml || "").match(/numberMatched="([^"]+)"/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? numeric : null;
}

function bboxFromWkt(wkt: string): [number, number, number, number] | null {
    const coords: number[] = [];
    const regex = /[-+]?[0-9]*\.?[0-9]+/g;
    let match;
    while ((match = regex.exec(wkt))) {
        coords.push(Number(match[0]));
    }
    if (coords.length < 6) return null;
    const xs = coords.filter((_, i) => i % 2 === 0);
    const ys = coords.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export async function fetchWfsClipFeatures(
    wfsLayerName: string,
    polygonWkt: string,
    srsName: string = "EPSG:4674",
): Promise<WfsClipFetchResult> {
    // O GeoServer da SEMA-MT tem INTERSECTS não confiável — frequentemente
    // retorna menos features do que o BBOX (ex: 27 vs 75 para AREA_CONSOLIDADA).
    // Usamos BBOX como método primário (mais confiável) e clipamos localmente.
    // Só usamos INTERSECTS quando o WKT é muito grande e otimizar faz diferença.
    const bbox = bboxFromWkt(polygonWkt);
    if (!bbox) {
        // Sem bbox, tenta INTERSECTS como fallback
        return await fetchWfsIntersectsFeatures(wfsLayerName, polygonWkt, srsName);
    }

    // BBOX primeiro (confiável) — o clip fino é feito localmente depois
    const bboxRes = await fetchWfsBboxFeatures(wfsLayerName, bbox, srsName);

    // Se veio vazio, tenta INTERSECTS como complemento (caso raro de BBOX não cobrir)
    if (!bboxRes.features.length && polygonWkt.length <= 4000) {
        try {
            const intersectsRes = await fetchWfsIntersectsFeatures(wfsLayerName, polygonWkt, srsName);
            if (intersectsRes.features.length > 0) {
                bboxRes.features.push(...intersectsRes.features);
                bboxRes.warnings.push(...intersectsRes.warnings);
            }
        } catch {
            // INTERSECTS falhou, usa só BBOX (vazio)
        }
    }

    return bboxRes;
}

export async function fetchWfsIntersectsFeatures(
    wfsLayerName: string,
    polygonWkt: string,
    srsName: string = "EPSG:4674",
): Promise<WfsClipFetchResult> {
    const geometryField = await getGeometryFieldForLayer(wfsLayerName);
    const cqlFilter = `INTERSECTS(${geometryField},${polygonWkt})`;
    const allFeatures: WfsFeature[] = [];
    const warnings: string[] = [];
    let startIndex = 0;
    let usedFallback = false;
    let partial = false;

    let numberMatched: number | null = null;
    try {
        const hitsUrl = buildWfsUrl({
            service: "WFS",
            version: "2.0.0",
            request: "GetFeature",
            typeNames: wfsLayerName,
            resultType: "hits",
            CQL_FILTER: cqlFilter,
        });
        numberMatched = parseNumberMatched(await fetchTextWithTimeout(hitsUrl, WFS_TIMEOUT_MS));
    } catch {
        // Keep going without total count.
    }

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
            const isPagingError =
                /natural order without a primary key/i.test(msg) ||
                /WFS 400/i.test(msg) ||
                /timeout/i.test(msg) ||
                /abort/i.test(msg) ||
                /ETIMEDOUT/i.test(msg) ||
                /ECONNRESET/i.test(msg) ||
                /fetch failed/i.test(msg);
            if (isPagingError && !usedFallback) {
                // Retry without startIndex — GeoServer doesn't support paging
                usedFallback = true;
                const fallbackCount = Math.min(WFS_MAX_FEATURES, WFS_PAGE_SIZE);
                const fallbackUrl = buildWfsUrl({
                    service: "WFS",
                    version: "2.0.0",
                    request: "GetFeature",
                    typeNames: wfsLayerName,
                    outputFormat: "application/json",
                    srsName,
                    count: fallbackCount,
                    CQL_FILTER: cqlFilter,
                });
                page = await fetchJsonWithTimeout<any>(fallbackUrl, WFS_TIMEOUT_MS);
                partial = numberMatched !== null ? numberMatched > fallbackCount : true;
                warnings.push(
                    numberMatched !== null && numberMatched > fallbackCount
                        ? `WFS sem paginacao com startIndex para esta camada; total estimado ${numberMatched} feicoes, calculo limitado a ${fallbackCount}.`
                        : `WFS sem paginacao com startIndex para esta camada; resultado limitado a ate ${fallbackCount} feicoes.`,
                );
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

    if (allFeatures.length >= WFS_MAX_FEATURES && (numberMatched === null || numberMatched > allFeatures.length)) {
        partial = true;
        warnings.push(`Limite de ${WFS_MAX_FEATURES} feicoes atingido; resultado parcial.`);
    }

    return {
        features: allFeatures,
        warnings: dedupeWarnings(warnings),
        partial,
    };
}

function cqlNumber(value: number): string {
    return Number(value.toFixed(8)).toString();
}

export async function fetchWfsBboxFeatures(
    wfsLayerName: string,
    bbox: [number, number, number, number],
    srsName: string = "EPSG:4674",
): Promise<WfsClipFetchResult> {
    const geometryField = await getGeometryFieldForLayer(wfsLayerName);
    const [minX, minY, maxX, maxY] = bbox.map(cqlNumber);
    const cqlFilter = `BBOX(${geometryField},${minX},${minY},${maxX},${maxY})`;
    const allFeatures: WfsFeature[] = [];
    const warnings: string[] = [];
    let startIndex = 0;
    let usedFallback = false;
    let partial = false;

    let numberMatched: number | null = null;
    try {
        const hitsUrl = buildWfsUrl({
            service: "WFS",
            version: "2.0.0",
            request: "GetFeature",
            typeNames: wfsLayerName,
            resultType: "hits",
            CQL_FILTER: cqlFilter,
        });
        numberMatched = parseNumberMatched(await fetchTextWithTimeout(hitsUrl, WFS_TIMEOUT_MS));
    } catch {
        // Keep going without total count.
    }

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
                usedFallback = true;
                const fallbackCount = Math.min(WFS_MAX_FEATURES, WFS_PAGE_SIZE);
                const fallbackUrl = buildWfsUrl({
                    service: "WFS",
                    version: "2.0.0",
                    request: "GetFeature",
                    typeNames: wfsLayerName,
                    outputFormat: "application/json",
                    srsName,
                    count: fallbackCount,
                    CQL_FILTER: cqlFilter,
                });
                page = await fetchJsonWithTimeout<any>(fallbackUrl, WFS_TIMEOUT_MS);
                partial = numberMatched !== null ? numberMatched > fallbackCount : true;
                warnings.push(
                    numberMatched !== null && numberMatched > fallbackCount
                        ? `WFS sem paginacao com startIndex para esta camada; total estimado ${numberMatched} feicoes, calculo limitado a ${fallbackCount}.`
                        : `WFS sem paginacao com startIndex para esta camada; resultado limitado a ate ${fallbackCount} feicoes.`,
                );
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

    if (allFeatures.length >= WFS_MAX_FEATURES && (numberMatched === null || numberMatched > allFeatures.length)) {
        partial = true;
        warnings.push(`Limite de ${WFS_MAX_FEATURES} feicoes atingido; resultado parcial.`);
    }

    return {
        features: allFeatures,
        warnings: dedupeWarnings(warnings),
        partial,
    };
}
