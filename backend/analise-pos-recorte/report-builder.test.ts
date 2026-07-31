import { describe, expect, it, vi } from "vitest";

import { buildAuasReport, type BuildAuasReportInput } from "./report-builder";

function baseInput(): BuildAuasReportInput {
  return {
    rulesVersion: "auas-pre2008-v1",
    aggregateStatus: "SEM_EVIDENCIA_PRE_2008",
    pre2008Alert: false,
    summary: {
      polygonCount: 1,
      alertCount: 0,
      inconclusiveCount: 0,
      noEvidenceCount: 1,
      totalAuasAreaHa: 5,
      alertAreaHa: 0,
    },
    sources: { required: ["LANDSAT_5_2003"], used: ["LANDSAT_5_2003"], missing: [] },
    polygons: [
      {
        polygonId: "AUAS-0001",
        geometryHash: "h",
        sourceIndex: 0,
        areaHa: 5,
        bbox: [0, 0, 1, 1],
        status: "SEM_EVIDENCIA_PRE_2008",
        pre2008Alert: false,
        evidenceKind: "NO_PRE2008_CHANGE_OBSERVED",
        observedInterval: null,
        confidence: "HIGH",
        sceneIds: [],
        windowIds: [],
        evidence: [],
        limitations: [],
      },
    ],
    limitations: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("buildAuasReport", () => {
  it("usa o laudo do DeepSeek quando ele responde com sucesso", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summaryMarkdown: "Resumo válido com aviso de revisão técnica.",
                polygonSections: [{ polygonId: "AUAS-0001", markdown: "Sem evidência pré-2008." }],
                evidenceRefs: ["AUAS-0001"],
              }),
            },
          },
        ],
      })
    );
    const report = await buildAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(report.model).toBe("deepseek-v4-pro");
    expect(report.markdown).toContain("Resumo válido");
    expect(report.markdown).toContain("### AUAS-0001");
    expect(report.evidenceRefs).toEqual(["AUAS-0001"]);
  });

  it("cai para o relatório determinístico quando o DeepSeek falha, preservando o status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const report = await buildAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(report.model).toBe("deterministic-fallback");
    expect(report.markdown).toContain("Sem evidência pré-2008");
    expect(report.evidenceRefs).toEqual(["AUAS-0001"]);
  });

  it("cai para o relatório determinístico quando não há chave configurada (sem chamar rede)", async () => {
    const fetchImpl = vi.fn();
    const report = await buildAuasReport(baseInput(), { fetchImpl, apiKey: "" });
    expect(report.model).toBe("deterministic-fallback");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
