import { describe, expect, it } from "vitest";

import { reduceAuasAggregate, reduceAuasPolygon, type PolygonEvidenceInput } from "./evidence-reducer";
import type { AuasWindowId, AuasYear, GroqWindowObservation } from "./types";

/**
 * Testes do P1 (v2): sinais de dúvida — MIXED, POSSIBLE_CHANGE pré-2008 e
 * tendência de fração antropizada viram SINAL_DE_DUVIDA em vez de sumirem.
 *
 * O redutor exige série completa (2003–2008 observável) antes de classificar;
 * sem cobertura total é INCONCLUSIVO por definição. Os helpers abaixo montam
 * as 3 janelas com todos os anos cobertos e permitem sobrescrever ano/estado.
 */

const ALL_USABLE: PolygonEvidenceInput["sceneUsabilityByYear"] = {
  2003: "USABLE",
  2004: "USABLE",
  2005: "USABLE",
  2006: "USABLE",
  2007: "USABLE",
  2008: "USABLE",
};

const SCENE_ID_BY_YEAR: PolygonEvidenceInput["sceneIdByYear"] = {
  2003: "P:landsat5:2003",
  2004: "P:landsat5:2004",
  2005: "P:landsat5:2005",
  2006: "P:landsat5:2006",
  2007: "P:landsat5:2007",
  2008: "P:spot:2008",
};

type ObsSpec = {
  state: GroqWindowObservation["observations"][number]["state"];
  confidence?: GroqWindowObservation["observations"][number]["confidence"];
  fraction?: number | null;
};

function makeObs(
  year: number,
  spec: ObsSpec,
): GroqWindowObservation["observations"][number] {
  return {
    sceneId: SCENE_ID_BY_YEAR[year as AuasYear] || `P:${year}`,
    year,
    state: spec.state,
    observableFraction: spec.fraction ?? null,
    confidence: spec.confidence ?? "HIGH",
    evidence: [],
    limitations: [],
  };
}

/** Monta as 3 janelas da série completa a partir do estado desejado por ano. */
function fullSeries(
  byYear: Partial<Record<number, ObsSpec>>,
  extraTransitions: GroqWindowObservation["transitions"] = []
): GroqWindowObservation[] {
  const WINDOWS: Array<{ id: AuasWindowId; years: number[] }> = [
    { id: "W2003_2005", years: [2003, 2004, 2005] },
    { id: "W2005_2007", years: [2005, 2006, 2007] },
    { id: "W2007_2008", years: [2007, 2008] },
  ];
  return WINDOWS.map(({ id, years }) => ({
    schemaVersion: 1 as const,
    polygonId: "AUAS-0001",
    windowId: id,
    inspectedSceneIds: years.map((y) => SCENE_ID_BY_YEAR[y as AuasYear] || `P:${y}`),
    observations: years.map((y) => makeObs(y, byYear[y] || { state: "NATIVE_VEGETATION", fraction: 0.02 })),
    transitions: extraTransitions.filter(
      (t) => years.includes(t.fromYear) && years.includes(t.toYear)
    ),
    conflicts: [],
  }));
}

function baseInput(windowsObs: GroqWindowObservation[]): PolygonEvidenceInput {
  return {
    polygonId: "AUAS-0001",
    geometryHash: "hash",
    sourceIndex: 0,
    areaHa: 10,
    bbox: [-56, -12, -55.9, -11.9],
    sceneUsabilityByYear: ALL_USABLE,
    sceneIdByYear: SCENE_ID_BY_YEAR,
    windows: windowsObs.map((observation) => ({ windowId: observation.windowId, observation })),
  };
}

describe("SINAL_DE_DUVIDA — desmate raso/parcial (P1)", () => {
  it("MIXED com confiança MEDIUM em 2005 → SINAL_DE_DUVIDA", () => {
    const result = reduceAuasPolygon(
      baseInput(
        fullSeries({
          2005: { state: "MIXED", confidence: "MEDIUM", fraction: 0.35 },
        })
      )
    );
    expect(result.status).toBe("SINAL_DE_DUVIDA");
    expect(result.evidenceKind).toBe("MIXED_STATE_OBSERVED");
    expect(result.doubtSignals?.length).toBeGreaterThan(0);
    expect(result.doubtSignals?.join(" ")).toContain("2005");
    expect(result.pre2008Alert).toBe(false);
  });

  it("POSSIBLE_CHANGE entre janelas pré-2008 → SINAL_DE_DUVIDA", () => {
    const result = reduceAuasPolygon(
      baseInput(
        fullSeries({}, [
          {
            fromSceneId: "P:landsat5:2005",
            toSceneId: "P:landsat5:2006",
            fromYear: 2005,
            toYear: 2006,
            change: "POSSIBLE_CHANGE",
            confidence: "LOW",
            evidence: ["textura levemente granulada no setor sul"],
          },
        ])
      )
    );
    expect(result.status).toBe("SINAL_DE_DUVIDA");
    expect(result.evidenceKind).toBe("POSSIBLE_CHANGE_PRE_2008");
    expect(result.doubtSignals?.join(" ")).toContain("2005 e 2006");
  });

  it("fração antropizada crescendo ≥15 p.p. entre anos → SINAL_DE_DUVIDA (tendência)", () => {
    const result = reduceAuasPolygon(
      baseInput(
        fullSeries({
          2003: { state: "NATIVE_VEGETATION", fraction: 0.05 },
          2004: { state: "NATIVE_VEGETATION", fraction: 0.08 },
          2005: { state: "NATIVE_VEGETATION", fraction: 0.12 },
          2006: { state: "NATIVE_VEGETATION", fraction: 0.3 },
          2007: { state: "NATIVE_VEGETATION", fraction: 0.32 },
          2008: { state: "NATIVE_VEGETATION", fraction: 0.34 },
        })
      )
    );
    expect(result.status).toBe("SINAL_DE_DUVIDA");
    expect(result.evidenceKind).toBe("FRACTION_TREND_SUSPICIOUS");
    expect(result.doubtSignals?.join(" ")).toMatch(/progress|subiu/i);
    const fractions = Object.values(result.anthropizedFractionByYear || {});
    expect(fractions.length).toBe(6);
  });

  it("vegetação estável com frações baixas → SEM_EVIDENCIA_PRE_2008 (sem falso positivo)", () => {
    const result = reduceAuasPolygon(baseInput(fullSeries({})));
    expect(result.status).toBe("SEM_EVIDENCIA_PRE_2008");
    expect(result.doubtSignals ?? []).toHaveLength(0);
  });
});

describe("reduceAuasAggregate v2 — contagem de dúvida", () => {
  function baseMock(status: "ALERTA_PRE_2008" | "SINAL_DE_DUVIDA" | "SEM_EVIDENCIA_PRE_2008") {
    return {
      polygonId: "X",
      geometryHash: "h",
      sourceIndex: 0,
      areaHa: status === "SINAL_DE_DUVIDA" ? 10 : 2,
      bbox: [-56, -12, -55.9, -11.9] as [number, number, number, number],
      pre2008Alert: status === "ALERTA_PRE_2008",
      evidenceKind: "INSUFFICIENT_EVIDENCE" as const,
      observedInterval: null,
      confidence: "HIGH" as const,
      sceneIds: [] as string[],
      windowIds: ["W2003_2005"] as AuasWindowId[],
      evidence: [],
      limitations: [],
      status,
    };
  }

  it("dúvida sem alerta → agregado SINAL_DE_DUVIDA com doubtCount/doubtAreaHa", () => {
    const agg = reduceAuasAggregate([baseMock("SEM_EVIDENCIA_PRE_2008"), baseMock("SINAL_DE_DUVIDA")]);
    expect(agg.status).toBe("SINAL_DE_DUVIDA");
    expect(agg.pre2008Alert).toBe(false);
    expect(agg.doubtCount).toBe(1);
    expect(agg.doubtAreaHa).toBeCloseTo(10, 5);
  });

  it("alerta tem prioridade sobre dúvida no agregado", () => {
    const agg = reduceAuasAggregate([baseMock("SINAL_DE_DUVIDA"), baseMock("ALERTA_PRE_2008")]);
    expect(agg.status).toBe("ALERTA_PRE_2008");
    expect(agg.pre2008Alert).toBe(true);
    expect(agg.doubtCount).toBe(1);
  });
});

describe("o laudo determinístico conta o sinal de dúvida", () => {
  it("rotula SINAL_DE_DUVIDA e lista os sinais na seção do polígono", async () => {
    // Regressão: o STATUS_LABEL não conhecia SINAL_DE_DUVIDA, então o laudo
    // imprimia o enum cru — e os sinais (que dizem EM QUE polígono a vegetação
    // foi mexida) só existiam na seção visual, nunca no corpo do texto.
    const { buildDeterministicFallbackReport } = await import("./deepseek-text-client");
    const report = buildDeterministicFallbackReport({
      rulesVersion: "auas-pre2008-v2",
      aggregateStatus: "SINAL_DE_DUVIDA",
      pre2008Alert: false,
      summary: {
        polygonCount: 1,
        alertCount: 0,
        doubtCount: 1,
        doubtAreaHa: 3.5,
        inconclusiveCount: 0,
        noEvidenceCount: 0,
        totalAuasAreaHa: 3.5,
        alertAreaHa: 0,
      } as any,
      sources: { required: [], used: [], missing: [] },
      polygons: [
        {
          polygonId: "AUAS-0007",
          areaHa: 3.5,
          status: "SINAL_DE_DUVIDA",
          evidenceKind: "PARTIAL_CLEARING_SIGNAL" as any,
          observedInterval: null,
          confidence: "MEDIUM",
          evidence: [],
          doubtSignals: ["Estado MISTO observado em 2005 (~40% com sinal de uso/solo exposto)."],
          limitations: [],
        },
      ],
      limitations: [],
    });

    const secao = report.polygonSections.find((s) => s.polygonId === "AUAS-0007")!;
    expect(secao.markdown).toContain("Sinal de dúvida (área passível de discussão)");
    expect(secao.markdown).not.toContain("SINAL_DE_DUVIDA");
    expect(secao.markdown).toContain("Estado MISTO observado em 2005");
    expect(report.summaryMarkdown).toContain("Com sinal de dúvida: 1");
  });
});
