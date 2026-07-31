/**
 * Validation helpers for SIMCAR clip pipeline.
 * Thin wrappers around common post-processing checks.
 *
 * Extraído de simcar-clip.ts (Plano 02, Passo 6).
 */

import fs from "fs";
import type { LayerSummary } from "./types";

/* ─── Shapefile Output Validation ───────────────────── */

/**
 * Checks that a shapefile output path exists and is non-empty.
 * Returns a human-readable warning or null if valid.
 */
export function validateShapefileOutput(
    shpPath: string | undefined,
    layerName: string,
): string | null {
    if (!shpPath) {
        return `${layerName}: caminho de saída não definido.`;
    }
    if (!fs.existsSync(shpPath)) {
        return `${layerName}: arquivo de saída não encontrado (${shpPath}).`;
    }
    const stat = fs.statSync(shpPath);
    if (stat.size === 0) {
        return `${layerName}: shapefile de saída vazio.`;
    }
    return null;
}

/* ─── Layer Summary Validation ──────────────────────── */

/**
 * Validates that a processed layer produced features.
 * Returns a LayerSummary with appropriate warning if empty.
 */
export function buildLayerSummary(
    name: string,
    source: "property" | "wfs",
    features: number,
    areaHa?: number,
    emptyWarning?: string,
): LayerSummary {
    const summary: LayerSummary = { name, source, features };
    if (areaHa !== undefined) summary.areaHa = Number(areaHa.toFixed(4));
    if (features === 0 && emptyWarning) summary.warning = emptyWarning;
    return summary;
}

/* ─── Area Consistency ──────────────────────────────── */

/**
 * Checks if output areas are consistent with the input area.
 * Returns a warning string or null if consistent.
 */
export function validateAreaConsistency(
    propertyAreaHa: number,
    outputAreaHa: number,
    layerName: string,
    maxRatio = 2.0,
): string | null {
    if (outputAreaHa <= 0) {
        return `${layerName}: área de saída zerada (${outputAreaHa.toFixed(4)} ha).`;
    }
    if (outputAreaHa > propertyAreaHa * maxRatio) {
        return `${layerName}: área de saída (${outputAreaHa.toFixed(2)} ha) excede ${maxRatio}x a área do imóvel (${propertyAreaHa.toFixed(2)} ha).`;
    }
    return null;
}
