/**
 * Cálculo de áreas e validação de consistência geométrica entre camadas.
 * Inclui geração de relatório XLSX quantitativo.
 * Extraído de simcar-clip.ts (Plano 02, Passo 4).
 */
import ExcelJS from "exceljs";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import {
    featureCollection as turfFeatureCollection,
    intersect as turfIntersect,
    union as turfUnion,
} from "@turf/turf";
import { unionPolygonGeometries, computeAreaHa } from "./polygon-ops";
import type { LayerSummary } from "./types";

/* ─── Warning Helpers ────────────────────────────────────── */

export function dedupeWarnings(values: Array<string | undefined | null>): string[] {
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function appendLayerWarning(layer: LayerSummary, warnings: Array<string | undefined | null>, partial = false): LayerSummary {
    const merged = dedupeWarnings([layer.warning, ...warnings]);
    return {
        ...layer,
        warning: merged.length > 0 ? merged.join(" | ") : undefined,
        partial: partial || layer.partial || merged.some((item) => /parcial/i.test(item)),
    };
}

/* ─── Layer Consistency Check ────────────────────────────── */

/**
 * Validate geometric consistency between ATP and AIR layers.
 * Returns the best perimeter feature, source layer, and any warnings.
 */
export function inspectPropertyLayerConsistency(
    clippedGeometries: Map<string, Geometry[]>,
): {
    feature: Feature<Polygon | MultiPolygon> | null;
    sourceLayer?: "ATP" | "AIR";
    warnings: string[];
} {
    const atpFeature = unionPolygonGeometries(clippedGeometries.get("ATP"));
    const airFeature = unionPolygonGeometries(clippedGeometries.get("AIR"));
    const warnings: string[] = [];

    const chosen = atpFeature
        ? { feature: atpFeature, sourceLayer: "ATP" as const }
        : airFeature
            ? { feature: airFeature, sourceLayer: "AIR" as const }
            : { feature: null, sourceLayer: undefined };

    if (!atpFeature || !airFeature) {
        if (chosen.sourceLayer) {
            warnings.push(`Perimetro reconstruido a partir de ${chosen.sourceLayer}; camada complementar ausente ou invalida no ZIP.`);
        }
        return { feature: chosen.feature, sourceLayer: chosen.sourceLayer, warnings };
    }

    try {
        const intersection = turfIntersect(turfFeatureCollection([atpFeature, airFeature]) as any) as
            | Feature<Polygon | MultiPolygon>
            | null;
        const unioned = turfUnion(turfFeatureCollection([atpFeature, airFeature]) as any) as
            | Feature<Polygon | MultiPolygon>
            | null;
        const atpAreaHa = computeAreaHa(atpFeature);
        const airAreaHa = computeAreaHa(airFeature);
        const unionAreaHa = computeAreaHa(unioned);
        const overlapAreaHa = computeAreaHa(intersection);
        const areaDeltaHa = Math.abs(atpAreaHa - airAreaHa);
        const overlapPctOfUnion = unionAreaHa > 0 ? (overlapAreaHa / unionAreaHa) * 100 : 100;
        const warnDeltaThresholdHa = Math.max(0.25, unionAreaHa * 0.005);
        const failDeltaThresholdHa = Math.max(1, unionAreaHa * 0.02);

        if (overlapPctOfUnion < 98 || areaDeltaHa > failDeltaThresholdHa) {
            throw new Error(
                `ZIP vetorizado inconsistente: ATP e AIR divergem (${overlapPctOfUnion.toFixed(2)}% de sobreposicao, delta ${areaDeltaHa.toFixed(2)} ha). Revise o perimetro antes da analise.`,
            );
        }

        if (overlapPctOfUnion < 99.5 || areaDeltaHa > warnDeltaThresholdHa) {
            warnings.push(
                `ATP e AIR divergem levemente (${overlapPctOfUnion.toFixed(2)}% de sobreposicao, delta ${areaDeltaHa.toFixed(2)} ha). O perimetro da analise foi ancorado em ATP.`,
            );
        }
    } catch (error) {
        if (error instanceof Error && /ZIP vetorizado inconsistente/i.test(error.message)) {
            throw error;
        }
        warnings.push("Nao foi possivel validar totalmente a consistencia geometrica entre ATP e AIR; ATP foi usado como perimetro principal.");
    }

    return { feature: chosen.feature, sourceLayer: chosen.sourceLayer, warnings };
}

/* ─── XLSX Quantitative Report ───────────────────────────── */

/**
 * Build an Excel workbook with two sheets:
 *  1. Resumo — summary data (date, area, layers, feature count)
 *  2. Camadas — per-layer breakdown (name, source, features, area, %, notes)
 */
export async function buildQuantitativeXlsx(
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
        fgColor: { argb: "FF10B981" },
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

    resumo.mergeCells("A1:B1");
    const titleCell = resumo.getCell("A1");
    titleCell.value = "Relatório Quantitativo — Recorte SIMCAR";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF065F46" } };
    titleCell.alignment = { horizontal: "center" };

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

        row.getCell(3).alignment = { horizontal: "center" };
        row.getCell(4).numFmt = "#,##0.0000";
        row.getCell(5).numFmt = "#,##0.00";
        for (let c = 1; c <= 6; c++) row.getCell(c).border = allBorders;

        if (idx % 2 === 1) {
            for (let c = 1; c <= 6; c++) {
                row.getCell(c).fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF0FDF4" },
                };
            }
        }
    });

    camadas.getColumn(1).width = 28;
    camadas.getColumn(2).width = 12;
    camadas.getColumn(3).width = 10;
    camadas.getColumn(4).width = 14;
    camadas.getColumn(5).width = 14;
    camadas.getColumn(6).width = 36;

    camadas.autoFilter = { from: "A1", to: `F${layerSummaries.length + 1}` };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
}
