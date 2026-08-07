/**
 * Builder do relatório Markdown da Fase 3 (vegetação na AC) — F3.7.
 *
 * `buildAcVegetacaoReport` monta o texto final a partir de decisões já tomadas
 * pelo redutor. Havendo api de texto (DeepSeek) usa SCCON_ENCAMINHAMENTO, senão
 * fallback determinístico. O formato da flag/estado é neutro e determinístico.
 */
import type { AcPolygonResult, AcVegetacaoAnalysis } from "./types";
import { AC_VEGETATION_RULES_VERSION } from "./types";

export type AcReportInput = {
  polygons: AcPolygonResult[];
  summary: AcVegetacaoAnalysis["summary"];
  windows: AcVegetacaoAnalysis["windows"];
};

export const SCCON_ENCAMINHAMENTO = `Sugere-se validação em campo das Áreas Consolidadas com alerta, e conferência do CAR declarado (CFlor). Enviar somente o material desta análise; nada deve ser tratado como infração ou conclusão.`;

export function buildAcVegetacaoReport(input: AcReportInput): AcVegetacaoAnalysis["report"] {
  const sections: string[] = [];
  sections.push(`# Fase 3 — Vegetação aparente na Área Consolidada`);
  sections.push("");
  sections.push(`Regras: ${AC_VEGETATION_RULES_VERSION} — precedência geométrica: o projeto declara.`);
  sections.push("");
  sections.push(markdownCounts(input.summary));
  sections.push("");
  sections.push(markdownPolygons(input.polygons));
  sections.push("");
  sections.push(markdownWindows(input.windows));
  sections.push("");
  sections.push(SCCON_ENCAMINHAMENTO);

  const markdown = sections.join("\n");
  return { model: "deterministic-fallback", markdown, evidenceRefs: input.polygons.map((p) => `ac:${p.polygonId}`) };
}

function markdownCounts(summary: AcVegetacaoAnalysis["summary"]): string {
  const lines = [
    `| Métrica | Valor |`,
    `|---|---|`,
    `| Polígonos AC analisados | ${summary.polygonCount} |`,
    `| Vegetação declarada dentro da AC | ${summary.declaredVegetationCount} (${summary.declaredVegetationAreaHa.toFixed(1)} ha) |`,
    `| Vegetação aparente (visão) | ${summary.apparentVegetationCount} |`,
    `| Sem vegetação aparente | ${summary.cleanCount} |`,
    `| Inconclusivos | ${summary.inconclusiveCount} |`,
    `| Área total de AC | ${summary.totalAcAreaHa.toFixed(1)} ha |`,
  ];
  return lines.join("\n");
}

function markdownPolygons(polygons: AcPolygonResult[]): string {
  const header = ["| AC | Area (ha) | Alerta | Status | Vegetação (ha) | Confiança |"];
  const rows = polygons.map((p) => {
    return [
      `| ${p.polygonId} | ${p.areaHa.toFixed(2)} | ${p.alertLevel} | ${p.status} | ${p.geometric.declaredVegetationAreaHa.toFixed(2)} | ${p.confidence} |`,
    ].join("");
  });
  return ["## Quadro por AC", "", header.join("\n"), ...rows].join("\n");
}

function markdownWindows(windows: AcVegetacaoAnalysis["windows"]): string {
  const lines: string[] = [];
  for (const w of windows) {
    const obs = w.observation;
    const summary =
      obs && obs.observations.length > 0
        ? obs.observations
            .map((o) => `${o.sceneId}:${o.vegetationInside}(${o.confidence})`)
            .join(", ")
        : w.status;
    lines.push(`- **${w.polygonId}** (${w.windowId}): ${summary}`);
  }
  return `## Janelas de visão\n\n${lines.length > 0 ? lines.join("\n") : "Nenhuma janela de visão executada."}`;
}