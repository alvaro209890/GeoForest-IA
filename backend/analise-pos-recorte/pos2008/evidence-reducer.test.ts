import { describe, expect, it } from "vitest";

import { reducePos2008Polygon, type Pos2008ReducerInput } from "./evidence-reducer";
import type { Pos2008WindowObservation } from "./types";
import type { SceneUsability } from "../types";

const SERIES = Array.from({ length: 11 }, (_, i) => 2009 + i);

/** Série inteira utilizável, salvo os anos listados. */
function usability(unusable: number[] = []): Record<number, SceneUsability> {
  const map: Record<number, SceneUsability> = {};
  for (const year of SERIES) {
    map[year] = unusable.includes(year) ? "CLOUD_OR_OCCLUSION" : "USABLE";
  }
  return map;
}

function sceneIds(): Record<number, string> {
  return Object.fromEntries(SERIES.map((year) => [year, `S_${year}`]));
}

/** Observação de janela com estados por ano e uma transição opcional. */
function observation(
  windowId: Pos2008WindowObservation["windowId"],
  states: Array<[number, "NATIVE_VEGETATION" | "ANTHROPIZED"]>,
  transition?: { fromYear: number; toYear: number },
): Pos2008WindowObservation {
  return {
    schemaVersion: 1,
    polygonId: "AUAS-0001",
    windowId,
    inspectedSceneIds: states.map(([year]) => `S_${year}`),
    observations: states.map(([year, state]) => ({
      sceneId: `S_${year}`,
      year,
      state,
      observableFraction: 1,
      confidence: "HIGH" as const,
      evidence: [],
      limitations: [],
    })),
    transitions: transition
      ? [
          {
            fromYear: transition.fromYear,
            toYear: transition.toYear,
            transition: "NATIVE_TO_ANTHROPIZED" as const,
            confidence: "HIGH" as const,
            evidence: [],
          },
        ]
      : [],
    conflicts: [],
  };
}

function input(overrides: Partial<Pos2008ReducerInput> = {}): Pos2008ReducerInput {
  return {
    polygonId: "AUAS-0001",
    geometryHash: "hash",
    areaHa: 10,
    pre2008: { status: "SEM_EVIDENCIA_PRE_2008", pre2008Alert: false },
    sceneUsabilityByYear: usability(),
    sceneIdByYear: sceneIds(),
    windows: [],
    sensorBoundaries: [],
    bridge: { available: false, executed: false, windowId: null, observation: null },
    ...overrides,
  };
}

describe("reducePos2008Polygon — regra 2 (ano exato)", () => {
  it("confirma o ano quando os dois anos são consecutivos, utilizáveis e concordam", () => {
    const result = reducePos2008Polygon(
      input({
        windows: [
          {
            windowId: "W2013_2015",
            observation: observation(
              "W2013_2015",
              [
                [2013, "NATIVE_VEGETATION"],
                [2014, "ANTHROPIZED"],
              ],
              { fromYear: 2013, toYear: 2014 },
            ),
          },
        ],
      }),
    );

    expect(result.status).toBe("CONFIRMADO_ANO");
    expect(result.firstDetectedYear).toBe(2014);
  });

  it("NÃO confirma ano exato quando os anos da transição não são consecutivos", () => {
    // Regressão: a transição 2010→2015 (os intermediários caíram do catálogo)
    // virava "CONFIRMADO_ANO 2015" — precisão que a série não sustenta.
    const result = reducePos2008Polygon(
      input({
        windows: [
          {
            windowId: "W2009_2011",
            observation: observation(
              "W2009_2011",
              [
                [2010, "NATIVE_VEGETATION"],
                [2015, "ANTHROPIZED"],
              ],
              { fromYear: 2010, toYear: 2015 },
            ),
          },
        ],
      }),
    );

    expect(result.status).toBe("CONFIRMADO_INTERVALO");
    expect(result.firstDetectedYear).toBeNull();
    expect(result.observedInterval).toEqual({ fromYear: 2010, toYear: 2015 });
  });

  it("rebaixa para intervalo quando a transição cruza troca de sensor sem ponte", () => {
    const result = reducePos2008Polygon(
      input({
        sensorBoundaries: [{ fromYear: 2018, toYear: 2019 }],
        windows: [
          {
            windowId: "W2017_2019",
            observation: observation(
              "W2017_2019",
              [
                [2018, "NATIVE_VEGETATION"],
                [2019, "ANTHROPIZED"],
              ],
              { fromYear: 2018, toYear: 2019 },
            ),
          },
        ],
      }),
    );

    expect(result.status).toBe("CONFIRMADO_INTERVALO");
    expect(result.crossedSensorBoundary).toBe(true);
  });
});

describe("reducePos2008Polygon — regra 3 (intervalo)", () => {
  it("exige extremos utilizáveis: par nublado não vira intervalo confirmado", () => {
    // Regressão: sem checar os extremos, uma transição relatada sobre cenas não
    // utilizáveis produzia CONFIRMADO_INTERVALO.
    const result = reducePos2008Polygon(
      input({
        sceneUsabilityByYear: usability([2011, 2015]),
        windows: [
          {
            windowId: "W2011_2013",
            observation: observation(
              "W2011_2013",
              [
                [2011, "NATIVE_VEGETATION"],
                [2015, "ANTHROPIZED"],
              ],
              { fromYear: 2011, toYear: 2015 },
            ),
          },
        ],
      }),
    );

    expect(result.status).toBe("INCONCLUSIVO");
    expect(result.observedInterval).toBeNull();
    expect(result.limitations.join(" ")).toContain("sem cena utilizável");
  });

  it("marca a troca de sensor também no intervalo", () => {
    const result = reducePos2008Polygon(
      input({
        sensorBoundaries: [{ fromYear: 2011, toYear: 2013 }],
        windows: [
          {
            windowId: "W2011_2013",
            observation: observation(
              "W2011_2013",
              [
                [2011, "NATIVE_VEGETATION"],
                [2013, "ANTHROPIZED"],
              ],
              { fromYear: 2011, toYear: 2013 },
            ),
          },
        ],
      }),
    );

    expect(result.status).toBe("CONFIRMADO_INTERVALO");
    expect(result.crossedSensorBoundary).toBe(true);
  });
});

describe("reducePos2008Polygon — série incompleta", () => {
  it("ano da série sem cena utilizável impede 'sem mudança'", () => {
    const windows = SERIES.map((year) => ({
      windowId: "W2009_2011" as const,
      observation: observation("W2009_2011", [[year, "NATIVE_VEGETATION"]]),
    }));

    const result = reducePos2008Polygon(
      input({ sceneUsabilityByYear: usability([2016]), windows }),
    );

    expect(result.status).toBe("INCONCLUSIVO");
    expect(result.limitations.join(" ")).toContain("2016");
  });

  it("série inteira observada e sem transição vira SEM_MUDANCA_OBSERVADA", () => {
    const windows = SERIES.map((year) => ({
      windowId: "W2009_2011" as const,
      observation: observation("W2009_2011", [[year, "NATIVE_VEGETATION"]]),
    }));

    const result = reducePos2008Polygon(input({ windows }));

    expect(result.status).toBe("SEM_MUDANCA_OBSERVADA");
  });
});
