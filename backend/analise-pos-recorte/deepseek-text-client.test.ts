import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicFallbackReport,
  requestDeepseekAuasReport,
  POLYGON_SECTION_MAX_WORDS,
  SUMMARY_MAX_WORDS,
  SUMMARY_MIN_WORDS,
} from "./deepseek-text-client";
import type { DeepseekAuasReportInput } from "./types";

function baseInput(): DeepseekAuasReportInput {
  return {
    rulesVersion: "auas-pre2008-v1",
    aggregateStatus: "ALERTA_PRE_2008",
    pre2008Alert: true,
    summary: {
      polygonCount: 2,
      alertCount: 1,
      inconclusiveCount: 0,
      noEvidenceCount: 1,
      totalAuasAreaHa: 15,
      alertAreaHa: 10,
    },
    sources: { required: ["LANDSAT_5_2003"], used: ["LANDSAT_5_2003"], missing: [] },
    polygons: [
      {
        polygonId: "AUAS-0001",
        areaHa: 10,
        status: "ALERTA_PRE_2008",
        evidenceKind: "ANTHROPIZED_BY_2003",
        observedInterval: { fromYear: null, toYear: 2003, wording: "antropização já observável no mosaico de 2003" },
        confidence: "HIGH",
        evidence: ["Antropização já observável em 2003."],
        limitations: [],
      },
      {
        polygonId: "AUAS-0002",
        areaHa: 5,
        status: "SEM_EVIDENCIA_PRE_2008",
        evidenceKind: "NO_PRE2008_CHANGE_OBSERVED",
        observedInterval: null,
        confidence: "MEDIUM",
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

function deepseekBody(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function validReportPayload() {
  return {
    summaryMarkdown: "Resumo executivo válido com aviso de revisão técnica.",
    polygonSections: [
      { polygonId: "AUAS-0001", markdown: "Alerta pré-2008 no polígono 1." },
      { polygonId: "AUAS-0002", markdown: "Sem evidência no polígono 2." },
    ],
    evidenceRefs: ["AUAS-0001", "AUAS-0002"],
  };
}

describe("requestDeepseekAuasReport", () => {
  it("usa deepseek-v4-pro por padrão e envia somente texto (sem image_url)", async () => {
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
      const body = JSON.parse(init.body);
      expect(body.model).toBe("deepseek-v4-pro");
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("image_url");
      expect(raw).not.toMatch(/^data:image/);
      return jsonResponse(deepseekBody(validReportPayload()));
    });
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(true);
  });

  /**
   * Sem teto explicito o modelo escrevia o laudo inteiro em prosa longa e o texto
   * ainda crescia com o numero de poligonos, porque o relatorio e o resumo mais
   * uma secao por poligono. Limitar so o resumo nao segura o total.
   */
  it("manda os limites de tamanho do laudo no system prompt", async () => {
    let system = "";
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      system = body.messages.find((m: any) => m.role === "system")?.content || "";
      return jsonResponse(deepseekBody(validReportPayload()));
    });
    await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k" });

    expect(system).toContain(String(SUMMARY_MIN_WORDS));
    expect(system).toContain(String(SUMMARY_MAX_WORDS));
    expect(system).toContain("summaryMarkdown");
    expect(system).toContain("polygonSections");
    expect(system).toContain(String(POLYGON_SECTION_MAX_WORDS));
  });

  it("rejeita polygonId inventado na saída", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        deepseekBody({
          ...validReportPayload(),
          polygonSections: [{ polygonId: "AUAS-9999", markdown: "inventado" }],
        })
      )
    );
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
  });

  it("rejeita conclusão jurídica no texto", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        deepseekBody({
          ...validReportPayload(),
          summaryMarkdown: "Este polígono configura infração ambiental clara.",
        })
      )
    );
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
  });

  it("timeout e retry finito (duas tentativas no máximo)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k", timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("não retenta erro não transitório (400)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 400));
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("MISSING_KEY quando não há chave configurada", async () => {
    const fetchImpl = vi.fn();
    const result = await requestDeepseekAuasReport(baseInput(), { fetchImpl, apiKey: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("MISSING_KEY");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("buildDeterministicFallbackReport", () => {
  it("preserva todos os status e não chama rede", () => {
    const input = baseInput();
    const report = buildDeterministicFallbackReport(input);
    expect(report.summaryMarkdown).toContain("Alerta pré-2008");
    expect(report.polygonSections).toHaveLength(2);
    expect(report.polygonSections.map((s) => s.polygonId)).toEqual(["AUAS-0001", "AUAS-0002"]);
    expect(report.summaryMarkdown).toContain("revisão por responsável técnico");
  });
});
