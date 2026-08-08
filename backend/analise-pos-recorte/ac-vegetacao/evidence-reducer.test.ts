/**
 * Testes do redutor determinístico da Fase 3 (vegetação na AC) — F3.5.
 * Precedência: geométrica > visão > inconclusivo.
 */
import { describe, expect, it } from "vitest";

import type { AcVegetacaoWindowObservation, AcPolygonResult } from "./types";
import { areaToBand, reduceAcVegetacao, type AcReducerInput } from "./evidence-reducer";

type ObsKind = AcVegetacaoWindowObservation["observations"][0]["vegetationInside"];

function geometric(overrides: Partial<AcPolygonResult["geometric"]> = {}): AcPolygonResult["geometric"] {
  return {
    avnAreaHa: 0,
    avnFraction: 0,
    avnParts: 0,
    tipologiaAreaHa: 0,
    tipologiaFraction: 0,
    tipologias: [],
    arlAreaHa: 0,
    auasAreaHa: 0,
    sliversDiscardedM2: 0,
    declaredVegetationAreaHa: 0,
    declaredVegetationFraction: 0,
    declaredSources: ["AVN"],
    tipologiaCoversWholeAc: false,
    ...overrides,
  };
}

function observationOf(
  sceneId: string,
  vegetationInside: ObsKind,
  confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH",
  estimatedFraction = 1
): AcVegetacaoWindowObservation {
  return {
    observations: [
      {
        sceneId,
        vegetationInside,
        confidence,
        estimatedFraction,
        distribution: vegetationInside === "NONE" ? null : ("uniform" as const),
      },
    ],
    conflicts: [],
  };
}

function baseInput(overrides: Partial<AcReducerInput> = {}): AcReducerInput {
  return {
    polygonId: "ac-1",
    geometryHash: "h1",
    areaHa: 10,
    geometric: geometric(),
    window: { observation: null },
    flags: [],
    pos2008CompletedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("reduceAcVegetacao", () => {
  it("declaração geométrica vence sempre (≥1% da AC)", () => {
    const input = baseInput({
      geometric: geometric({ declaredVegetationAreaHa: 0.6, declaredVegetationFraction: 0.06 }),
      window: { observation: observationOf("S2_2024", "NONE") },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("VEGETACAO_DECLARADA_DENTRO_DA_AC");
    expect(result.alertLevel).toBe("ALTO");
    expect(result.confidence).toBe("HIGH");
  });

  it("declaração por área (≥0.5ha) mesmo com fração pequena", () => {
    const input = baseInput({
      geometric: geometric({ declaredVegetationAreaHa: 1.2, declaredVegetationFraction: 0.004 }),
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("VEGETACAO_DECLARADA_DENTRO_DA_AC");
    expect(result.alertLevel).toBe("ALTO");
  });

  it("visão com ≥2 cenas LARGE_BLOCK → APARENTE ALTO", () => {
    const input = baseInput({
      window: {
        observation: {
          observations: [
            { sceneId: "S2_2024", vegetationInside: "LARGE_BLOCK", confidence: "HIGH", estimatedFraction: 0.7, distribution: "lumpy" },
            { sceneId: "S2_2021", vegetationInside: "LARGE_BLOCK", confidence: "HIGH", estimatedFraction: 0.65, distribution: "lumpy" },
          ],
          conflicts: [],
        },
      },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("VEGETACAO_APARENTE_DENTRO_DA_AC");
    expect(result.alertLevel).toBe("ALTO");
  });

  it("visão com 2 cenas PATCHES → APARENTE MEDIO", () => {
    const input = baseInput({
      window: {
        observation: {
          observations: [
            { sceneId: "S2_2024", vegetationInside: "PATCHES", confidence: "MEDIUM", estimatedFraction: 0.3, distribution: "patchy" },
            { sceneId: "S2_2021", vegetationInside: "PATCHES", confidence: "MEDIUM", estimatedFraction: 0.25, distribution: "patchy" },
          ],
          conflicts: [],
        },
      },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("VEGETACAO_APARENTE_DENTRO_DA_AC");
    expect(result.alertLevel).toBe("MEDIO");
  });

  it("visão com ≥2 cenas NONE → SEM_VEGETACAO_APARENTE", () => {
    const input = baseInput({
      window: {
        observation: {
          observations: [
            { sceneId: "S2_2024", vegetationInside: "NONE", confidence: "HIGH", estimatedFraction: 0, distribution: null },
            { sceneId: "S2_2021", vegetationInside: "NONE", confidence: "HIGH", estimatedFraction: 0, distribution: null },
          ],
          conflicts: [],
        },
      },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("SEM_VEGETACAO_APARENTE");
    expect(result.alertLevel).toBe("NENHUM");
  });

  it("cenas insuficientes → INCONCLUSIVO", () => {
    const input = baseInput({
      window: { observation: observationOf("S2_2024", "NOT_OBSERVABLE") },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("INCONCLUSIVO");
    expect(result.alertLevel).toBe("INDETERMINADO");
  });

  it("não alerta por uma única cena PATCHES nem por SPARSE", () => {
    const input = baseInput({
      window: {
        observation: {
          observations: [
            { sceneId: "S2_2024", vegetationInside: "PATCHES", confidence: "MEDIUM", estimatedFraction: 0.3, distribution: "INTERIOR" },
            { sceneId: "S2_2021", vegetationInside: "NONE", confidence: "MEDIUM", estimatedFraction: 0, distribution: null },
          ],
          conflicts: [],
        },
      },
    });
    expect(reduceAcVegetacao(input).status).toBe("INCONCLUSIVO");

    const sparse = baseInput({
      window: {
        observation: {
          observations: [
            { sceneId: "S2_2024", vegetationInside: "SPARSE", confidence: "HIGH", estimatedFraction: 0.02, distribution: "SCATTERED" },
            { sceneId: "S2_2021", vegetationInside: "SPARSE", confidence: "HIGH", estimatedFraction: 0.01, distribution: "SCATTERED" },
          ],
          conflicts: [],
        },
      },
    });
    expect(reduceAcVegetacao(sparse).status).toBe("SEM_VEGETACAO_APARENTE");
  });

  it("conflito explícito entre cenas não vira alerta visual", () => {
    const result = reduceAcVegetacao(
      baseInput({
        window: {
          observation: {
            observations: [
              { sceneId: "S2_2024", vegetationInside: "PATCHES", confidence: "HIGH", estimatedFraction: 0.3, distribution: "INTERIOR" },
              { sceneId: "S2_2021", vegetationInside: "PATCHES", confidence: "HIGH", estimatedFraction: 0.3, distribution: "INTERIOR" },
            ],
            conflicts: ["Cenas discordantes"],
          },
        },
      }),
    );
    expect(result.status).toBe("INCONCLUSIVO");
  });

  it("flags AC_SOBREPOE_* entram na evidência com a nomenclatura correta", () => {
    // O texto antigo chamava ARL de "área de preservação permanente" e AUAS de
    // "área de uso restrito". ARL é Área de Reserva Legal e AUAS é Área de Uso
    // Alternativo do Solo — nomes errados num laudo técnico do SIMCAR.
    const input = baseInput({
      geometric: geometric({ declaredVegetationAreaHa: 0.6, declaredVegetationFraction: 0.06 }),
      flags: ["AC_SOBREPOE_ARL", "AC_SOBREPOE_AUAS"],
    });
    const result = reduceAcVegetacao(input);
    const evidence = result.evidence.join(" ");
    expect(evidence).toContain("Área de Reserva Legal (ARL/ARLREM)");
    expect(evidence).toContain("Área de Uso Alternativo do Solo (AUAS)");
    expect(evidence).not.toContain("preservação permanente");
    expect(evidence).not.toContain("uso restrito");
  });

  it("ausência de vegetação não carimba confiança HIGH sobre cenas MEDIUM", () => {
    const input = baseInput({
      window: {
        observation: {
          schemaVersion: 1,
          polygonId: "AC-0001",
          windowId: "WAVAC_ATUAL",
          inspectedSceneIds: ["S2_2024", "S2_2021"],
          observations: [
            { sceneId: "S2_2024", year: 2024, vegetationInside: "NONE", confidence: "MEDIUM", estimatedFraction: 0, distribution: null, evidence: [], limitations: [] },
            { sceneId: "S2_2021", year: 2021, vegetationInside: "NONE", confidence: "HIGH", estimatedFraction: 0, distribution: null, evidence: [], limitations: [] },
          ],
          conflicts: [],
        },
      },
    });
    const result = reduceAcVegetacao(input);
    expect(result.status).toBe("SEM_VEGETACAO_APARENTE");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("tipologia de cobertura total vira limitação explícita no resultado", () => {
    const input = baseInput({
      geometric: geometric({
        tipologiaFraction: 1,
        tipologiaAreaHa: 10,
        tipologiaCoversWholeAc: true,
      }),
    });
    const result = reduceAcVegetacao(input);
    expect(result.limitations.join(" ")).toContain("camada de cobertura do imóvel");
  });
});

describe("areaToBand", () => {
  it("classifica bandas", () => {
    expect(areaToBand(null)).toBeNull();
    expect(areaToBand(0.2)).toBe("<0.5ha");
    expect(areaToBand(1)).toBe("0.5-2ha");
    expect(areaToBand(5)).toBe("2-10ha");
    expect(areaToBand(30)).toBe(">10ha");
  });
});

describe("contexto geométrico no laudo (CAR 6816)", () => {
  it("registra a sobreposição com ARL mesmo quando não há vegetação aparente", () => {
    // A AC do CAR 6816 está 100% dentro da Reserva Legal declarada. Antes esse
    // fato só aparecia no ramo de alerta ALTO; nos demais a evidência saía vazia.
    const result = reduceAcVegetacao(
      baseInput({
        areaHa: 9.82,
        flags: ["AC_SOBREPOE_ARL"],
        geometric: geometric({ arlAreaHa: 9.82 }),
        window: {
          observation: {
            observations: [
              { sceneId: "S2_2024", vegetationInside: "NONE", confidence: "HIGH", estimatedFraction: 0, distribution: null },
              { sceneId: "S2_2025", vegetationInside: "NONE", confidence: "HIGH", estimatedFraction: 0, distribution: null },
            ],
            conflicts: [],
          },
        },
      }),
    );
    expect(result.status).toBe("SEM_VEGETACAO_APARENTE");
    const texto = result.evidence.join(" ");
    expect(texto).toMatch(/Reserva Legal/);
    expect(texto).toMatch(/9\.82 ha/);
    expect(texto).not.toMatch(/preservação permanente/);
  });
});
