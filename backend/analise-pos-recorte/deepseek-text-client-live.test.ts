import { describe, expect, it } from "vitest";

import { requestDeepseekAuasReport } from "./deepseek-text-client";
import type { DeepseekAuasReportInput } from "./types";

const liveEnabled = process.env.DEEPSEEK_LIVE === "1" && Boolean(process.env.DEEPSEEK_API_KEY);

function syntheticInput(): DeepseekAuasReportInput {
  return {
    rulesVersion: "auas-pre2008-v1",
    aggregateStatus: "INCONCLUSIVO",
    pre2008Alert: false,
    summary: {
      polygonCount: 2,
      alertCount: 0,
      inconclusiveCount: 1,
      noEvidenceCount: 1,
      totalAuasAreaHa: 22.5,
      alertAreaHa: 0,
    },
    sources: {
      required: ["LANDSAT_5_2003", "LANDSAT_5_2007", "SPOT_2008"],
      used: ["LANDSAT_5_2003", "LANDSAT_5_2007", "SPOT_2008"],
      missing: [],
    },
    polygons: [
      {
        polygonId: "AUAS-SYN-0001",
        areaHa: 12.5,
        status: "INCONCLUSIVO_NO_MARCO_2008",
        evidenceKind: "ONLY_2007_TO_2008_CHANGE",
        observedInterval: {
          fromYear: 2007,
          toYear: 2008,
          wording: "Mudança observada apenas entre 2007 e o mosaico SPOT de 2008.",
        },
        confidence: "INCONCLUSIVE",
        evidence: ["Mudança visual entre 2007 e SPOT 2008."],
        limitations: ["SPOT 2008 não prova de qual lado de 22/07/2008 a mudança ocorreu."],
      },
      {
        polygonId: "AUAS-SYN-0002",
        areaHa: 10,
        status: "SEM_EVIDENCIA_PRE_2008",
        evidenceKind: "NO_PRE2008_CHANGE_OBSERVED",
        observedInterval: null,
        confidence: "HIGH",
        evidence: ["Vegetação nativa observável em toda a série 2003-2008."],
        limitations: [],
      },
    ],
    limitations: [],
  };
}

/**
 * Teste live opcional (Fase 4 / TESTES.md §9.3). Usa um resultado SINTÉTICO
 * (nunca dados reais de propriedade) só para validar o contrato de rede/JSON
 * do cliente DeepSeek. Não roda na CI comum; exige DEEPSEEK_LIVE=1 + DEEPSEEK_API_KEY.
 */
describe.skipIf(!liveEnabled)("deepseek-text-client (live)", () => {
  it(
    "gera relatório válido a partir de um resultado sintético, preservando status/área/intervalo",
    async () => {
      const input = syntheticInput();
      const result = await requestDeepseekAuasReport(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const text = (result.report.summaryMarkdown + result.report.polygonSections.map((s) => s.markdown).join(" ")).toLowerCase();
        expect(text).not.toMatch(/infra[cç][aã]o|passivo ambiental|ilegal/);
        expect(result.report.polygonSections.every((s) => ["AUAS-SYN-0001", "AUAS-SYN-0002"].includes(s.polygonId))).toBe(true);
      }
    },
    200_000
  );
});
