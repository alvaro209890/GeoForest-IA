/**
 * CAR lookup — busca a fronteira do imóvel na camada CAR requerida da SEMA.
 * Extraído de simcar-clip.ts (Plano 02, Fase 3).
 */

import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
    buildWfsUrl,
    fetchJsonWithTimeout,
    fetchTextWithTimeout,
    normalizePolygonGeometry,
    WFS_TIMEOUT_MS,
} from "../wfs-intersection";
import { parsePolygonGeometryFromGml } from "../sigef-client";
import { SEMA_CAR_REQUIRED_WFS_LAYER } from "./constants";

function cqlString(value: string): string {
    return `'${String(value || "").replace(/'/g, "''")}'`;
}

function normalizeCarLookupValues(raw: string): string[] {
    const compact = String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
    const alnum = compact.replace(/[^A-Z0-9]/g, "");
    const withoutCarPrefix = compact.replace(/^CAR[_-]?/i, "");
    const withoutCarPrefixAlnum = withoutCarPrefix.replace(/[^A-Z0-9]/g, "");
    return Array.from(
        new Set([compact, alnum, withoutCarPrefix, withoutCarPrefixAlnum].filter(Boolean)),
    );
}

async function fetchCarBoundaryFromWfs(
    fieldName: string,
    fieldValue: string,
): Promise<Feature<Polygon | MultiPolygon> | null> {
    const cqlFilter = `${fieldName}=${cqlString(fieldValue)}`;
    const jsonUrl = buildWfsUrl({
        service: "WFS",
        version: "1.0.0",
        request: "GetFeature",
        typeName: SEMA_CAR_REQUIRED_WFS_LAYER,
        outputFormat: "application/json",
        srsName: "EPSG:4674",
        maxFeatures: 1,
        CQL_FILTER: cqlFilter,
    });

    try {
        const featureCollection = await fetchJsonWithTimeout<any>(jsonUrl, WFS_TIMEOUT_MS);
        const feature = Array.isArray(featureCollection?.features) ? featureCollection.features[0] : null;
        if (feature?.geometry) {
            const geom = normalizePolygonGeometry(feature.geometry);
            if (geom) {
                return {
                    type: "Feature",
                    properties: feature.properties || {},
                    geometry: geom,
                };
            }
        }
    } catch (error) {
        const msg = String((error as any)?.message || "");
        if (!/ECONNRESET|timeout|WFS \d+|Unexpected token <|not valid JSON|JSON/i.test(msg)) {
            throw error;
        }
    }

    const gmlUrl = buildWfsUrl({
        service: "WFS",
        version: "1.0.0",
        request: "GetFeature",
        typeName: SEMA_CAR_REQUIRED_WFS_LAYER,
        srsName: "EPSG:4674",
        maxFeatures: 1,
        CQL_FILTER: cqlFilter,
    });

    const xml = await fetchTextWithTimeout(gmlUrl, WFS_TIMEOUT_MS);
    const geometry = parsePolygonGeometryFromGml(xml);
    if (!geometry) return null;
    return {
        type: "Feature",
        properties: { [fieldName]: fieldValue },
        geometry,
    };
}

export async function fetchCarBoundaryByNumber(carNumber: string): Promise<Feature<Polygon | MultiPolygon>> {
    const values = normalizeCarLookupValues(carNumber);
    if (!values.length) throw new Error("Número do CAR inválido.");

    const fields = ["NUMEROESTADUAL", "CODIGO_CAR_FEDERAL", "PROTOCOLO"];
    const errors: string[] = [];

    for (const fieldName of fields) {
        for (const value of values) {
            try {
                const feature = await fetchCarBoundaryFromWfs(fieldName, value);
                if (feature) return feature;
            } catch (error: any) {
                const msg = String(error?.message || error || "");
                errors.push(`${fieldName}=${value}: ${msg}`);
            }
        }
    }

    throw new Error(
        `Nenhum imóvel encontrado na camada CAR requerido da SEMA (${SEMA_CAR_REQUIRED_WFS_LAYER}) para o CAR: ${values.join(" / ")}.` +
        (errors.length > 0 ? ` Detalhes: ${errors.slice(0, 3).join(" | ")}` : ""),
    );
}
