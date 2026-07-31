/**
 * AIR/ATP Generator — direct-copy layer processing for SIMCAR clip.
 * Handles layers that are direct copies of the property polygon (AIR, ATP),
 * including AIR-specific IDENTIFIC field assignment.
 *
 * Extraído de simcar-clip.ts (Plano 02, Passo 5).
 */

import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizePolygonGeometry } from "../wfs-intersection";
import { geojsonToShpRecords } from "../shapefile-writer";
import type { DbfFieldDef, ShpRecord } from "../shapefile-writer";
import { DIRECT_COPY_LAYERS } from "./constants";
import type { LayerSummary } from "./types";

/* ─── Types ───────────────────────────────────────────── */

export interface DirectCopyLayerResult {
    records: ShpRecord[];
    fieldDefs: DbfFieldDef[];
    summary: LayerSummary;
}

/* ─── AIR Identificacao ────────────────────────────────── */

/**
 * Ensure the AIR IDENTIFIC field exists and is populated when
 * processing the AIR layer. Returns new fieldDefs and attributes
 * without mutating the inputs.
 */
export function applyAirIdentificacao(
    layerName: string,
    fieldDefs: readonly DbfFieldDef[],
    attributes: Readonly<Record<string, string | number | null>>,
    airIdentificacao?: string,
): { fieldDefs: DbfFieldDef[]; attributes: Record<string, string | number | null> } {
    if (layerName !== "AIR" || !airIdentificacao) {
        return { fieldDefs: [...fieldDefs], attributes: { ...attributes } };
    }

    const newFieldDefs = [...fieldDefs];
    if (!newFieldDefs.some((f) => f.name === "IDENTIFIC")) {
        newFieldDefs.push({ name: "IDENTIFIC", type: "C", length: 50, decimals: 0 });
    }

    const newAttributes = { ...attributes };
    newAttributes["IDENTIFIC"] = airIdentificacao;

    return { fieldDefs: newFieldDefs, attributes: newAttributes };
}

/* ─── Direct Copy Layer Records ────────────────────────── */

/**
 * Build shapefile records for a DIRECT_COPY_LAYERS entry (AIR, ATP, etc.).
 * Generates one record per property polygon lot, preserving MultiPolygon splits
 * from `geojsonToShpRecords`.
 *
 * @returns The records, field definitions, and layer summary.
 *          Returns null if the layer is not a direct-copy layer.
 *          The summary.warning is set when polygon→shapefile conversion fails.
 */
export function buildDirectCopyLayerRecords(
    layerName: string,
    userPolygons: Feature<Polygon | MultiPolygon>[],
    templateFieldDefs: readonly DbfFieldDef[],
    airIdentificacao?: string,
): DirectCopyLayerResult | null {
    if (!DIRECT_COPY_LAYERS.has(layerName)) {
        return null;
    }

    let fieldDefs: DbfFieldDef[] = templateFieldDefs.length > 0
        ? [...templateFieldDefs]
        : [{ name: "ID", type: "N" as const, length: 10, decimals: 0 }];

    const baseAttributes: Record<string, string | number | null> = {};
    for (const f of fieldDefs) baseAttributes[f.name] = null;
    if (baseAttributes["ID"] !== undefined) baseAttributes["ID"] = 1;

    // AIR-specific: fill IDENTIFIC field
    const updated = applyAirIdentificacao(layerName, fieldDefs, baseAttributes, airIdentificacao);
    fieldDefs = updated.fieldDefs;
    const finalAttributes = updated.attributes;

    // Generate one record per property lot (preserves MultiPolygon splits)
    const records: ShpRecord[] = [];
    for (const poly of userPolygons) {
        const polyGeometry = normalizePolygonGeometry(poly.geometry);
        if (!polyGeometry) continue;
        records.push(...geojsonToShpRecords(polyGeometry, finalAttributes));
    }

    if (!records.length) {
        return {
            records: [],
            fieldDefs,
            summary: {
                name: layerName,
                source: "property",
                features: 0,
                warning: "Geometria do imóvel não pôde ser convertida para shapefile.",
            },
        };
    }

    return {
        records,
        fieldDefs,
        summary: {
            name: layerName,
            source: "property",
            features: records.length,
        },
    };
}
