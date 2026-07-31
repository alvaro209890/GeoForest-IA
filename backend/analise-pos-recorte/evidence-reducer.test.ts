import { describe, expect, it } from "vitest";

import { reduceAuasAggregate, reduceAuasPolygon, type PolygonEvidenceInput } from "./evidence-reducer";
import type { AuasYear, GroqWindowObservation } from "./types";

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

function obs(
  year: number,
  state: GroqWindowObservation["observations"][number]["state"],
  confidence: GroqWindowObservation["observations"][number]["confidence"] = "HIGH"
): GroqWindowObservation["observations"][number] {
  return {
    sceneId: `P:${year}`,
    year,
    state,
    observableFraction: 0.9,
    confidence,
    evidence: [],
    limitations: [],
  };
}

function vegetationWindow(
  windowId: GroqWindowObservation["windowId"],
  years: number[]
): GroqWindowObservation {
  return {
    schemaVersion: 1,
    polygonId: "AUAS-0001",
    windowId,
    inspectedSceneIds: years.map((y) => `P:${y}`),
    observations: years.map((y) => obs(y, "NATIVE_VEGETATION")),
    transitions: [],
    conflicts: [],
  };
}

function baseInput(overrides: Partial<PolygonEvidenceInput> = {}): PolygonEvidenceInput {
  return {
    polygonId: "AUAS-0001",
    geometryHash: "hash",
    sourceIndex: 0,
    areaHa: 10,
    bbox: [0, 0, 1, 1],
    sceneUsabilityByYear: { ...ALL_USABLE },
    sceneIdByYear: { ...SCENE_ID_BY_YEAR },
    windows: [
      { windowId: "W2003_2005", observation: vegetationWindow("W2003_2005", [2003, 2004, 2005]) },
      { windowId: "W2005_2007", observation: vegetationWindow("W2005_2007", [2005, 2006, 2007]) },
      { windowId: "W2007_2008", observation: vegetationWindow("W2007_2008", [2007, 2008]) },
    ],
    ...overrides,
  };
}

describe("reduceAuasPolygon", () => {
  it("antropizado já em 2003 → ALERTA_PRE_2008", () => {
    const anthropizedWindow = (windowId: GroqWindowObservation["windowId"], years: number[]): GroqWindowObservation => ({
      schemaVersion: 1,
      polygonId: "AUAS-0001",
      windowId,
      inspectedSceneIds: years.map((y) => `P:${y}`),
      observations: years.map((y) => obs(y, "ANTHROPIZED")),
      transitions: [],
      conflicts: [],
    });
    const input = baseInput({
      windows: [
        { windowId: "W2003_2005", observation: anthropizedWindow("W2003_2005", [2003, 2004, 2005]) },
        { windowId: "W2005_2007", observation: anthropizedWindow("W2005_2007", [2005, 2006, 2007]) },
        { windowId: "W2007_2008", observation: anthropizedWindow("W2007_2008", [2007, 2008]) },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("ALERTA_PRE_2008");
    expect(result.pre2008Alert).toBe(true);
    expect(result.evidenceKind).toBe("ANTHROPIZED_BY_2003");
    expect(result.observedInterval?.wording).toContain("não datável por esta série");
  });

  it("transição 2003→2004 → ALERTA_PRE_2008", () => {
    const input = baseInput({
      windows: [
        {
          windowId: "W2003_2005",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2003_2005",
            inspectedSceneIds: ["P:2003", "P:2004", "P:2005"],
            observations: [obs(2003, "NATIVE_VEGETATION"), obs(2004, "ANTHROPIZED"), obs(2005, "ANTHROPIZED")],
            transitions: [
              {
                fromSceneId: "P:2003",
                toSceneId: "P:2004",
                fromYear: 2003,
                toYear: 2004,
                change: "ANTHROPIZATION_APPEARED",
                confidence: "HIGH",
                evidence: [],
              },
            ],
            conflicts: [],
          },
        },
        {
          windowId: "W2005_2007",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2005_2007",
            inspectedSceneIds: ["P:2005", "P:2006", "P:2007"],
            observations: [obs(2005, "ANTHROPIZED"), obs(2006, "ANTHROPIZED"), obs(2007, "ANTHROPIZED")],
            transitions: [],
            conflicts: [],
          },
        },
        {
          windowId: "W2007_2008",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2007_2008",
            inspectedSceneIds: ["P:2007", "P:2008"],
            observations: [obs(2007, "ANTHROPIZED"), obs(2008, "ANTHROPIZED")],
            transitions: [],
            conflicts: [],
          },
        },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("ALERTA_PRE_2008");
    expect(result.evidenceKind).toBe("TRANSITION_BEFORE_2008");
    expect(result.observedInterval).toEqual({
      fromYear: 2003,
      toYear: 2004,
      wording: expect.stringContaining("2003 e 2004"),
    });
  });

  it("transição 2006→2007 → ALERTA_PRE_2008", () => {
    const input = baseInput({
      windows: [
        { windowId: "W2003_2005", observation: vegetationWindow("W2003_2005", [2003, 2004, 2005]) },
        {
          windowId: "W2005_2007",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2005_2007",
            inspectedSceneIds: ["P:2005", "P:2006", "P:2007"],
            observations: [obs(2005, "NATIVE_VEGETATION"), obs(2006, "NATIVE_VEGETATION"), obs(2007, "ANTHROPIZED")],
            transitions: [
              {
                fromSceneId: "P:2006",
                toSceneId: "P:2007",
                fromYear: 2006,
                toYear: 2007,
                change: "ANTHROPIZATION_APPEARED",
                confidence: "MEDIUM",
                evidence: [],
              },
            ],
            conflicts: [],
          },
        },
        {
          windowId: "W2007_2008",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2007_2008",
            inspectedSceneIds: ["P:2007", "P:2008"],
            observations: [obs(2007, "ANTHROPIZED"), obs(2008, "ANTHROPIZED")],
            transitions: [],
            conflicts: [],
          },
        },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("ALERTA_PRE_2008");
    expect(result.evidenceKind).toBe("TRANSITION_BEFORE_2008");
  });

  it("apenas transição 2007→SPOT 2008 → INCONCLUSIVO_NO_MARCO_2008", () => {
    const input = baseInput({
      windows: [
        { windowId: "W2003_2005", observation: vegetationWindow("W2003_2005", [2003, 2004, 2005]) },
        { windowId: "W2005_2007", observation: vegetationWindow("W2005_2007", [2005, 2006, 2007]) },
        {
          windowId: "W2007_2008",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2007_2008",
            inspectedSceneIds: ["P:2007", "P:2008"],
            observations: [obs(2007, "NATIVE_VEGETATION"), obs(2008, "ANTHROPIZED")],
            transitions: [
              {
                fromSceneId: "P:2007",
                toSceneId: "P:2008",
                fromYear: 2007,
                toYear: 2008,
                change: "ANTHROPIZATION_APPEARED",
                confidence: "MEDIUM",
                evidence: [],
              },
            ],
            conflicts: [],
          },
        },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("INCONCLUSIVO_NO_MARCO_2008");
    expect(result.pre2008Alert).toBe(false);
    expect(result.evidenceKind).toBe("ONLY_2007_TO_2008_CHANGE");
    expect(result.observedInterval?.wording).toContain("22/07/2008");
  });

  it("vegetação observável em toda a série → SEM_EVIDENCIA_PRE_2008", () => {
    const result = reduceAuasPolygon(baseInput());
    expect(result.status).toBe("SEM_EVIDENCIA_PRE_2008");
    expect(result.pre2008Alert).toBe(false);
    expect(result.evidenceKind).toBe("NO_PRE2008_CHANGE_OBSERVED");
  });

  it("uma cena obrigatória ausente → INCONCLUSIVO", () => {
    const input = baseInput({
      sceneUsabilityByYear: { ...ALL_USABLE, 2004: "MISSING" },
      windows: [
        {
          windowId: "W2003_2005",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2003_2005",
            inspectedSceneIds: ["P:2003", "P:2005"],
            observations: [obs(2003, "NATIVE_VEGETATION"), obs(2005, "NATIVE_VEGETATION")],
            transitions: [],
            conflicts: [],
          },
        },
        { windowId: "W2005_2007", observation: vegetationWindow("W2005_2007", [2005, 2006, 2007]) },
        { windowId: "W2007_2008", observation: vegetationWindow("W2007_2008", [2007, 2008]) },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("INCONCLUSIVO");
    expect(result.evidenceKind).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.limitations.some((l) => l.includes("2004"))).toBe(true);
  });

  it("conflito W2003_2005 × W2005_2007 → INCONCLUSIVO", () => {
    const input = baseInput({
      windows: [
        {
          windowId: "W2003_2005",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2003_2005",
            inspectedSceneIds: ["P:2003", "P:2004", "P:2005"],
            observations: [obs(2003, "NATIVE_VEGETATION"), obs(2004, "NATIVE_VEGETATION"), obs(2005, "NATIVE_VEGETATION")],
            transitions: [],
            conflicts: [],
          },
        },
        {
          windowId: "W2005_2007",
          observation: {
            schemaVersion: 1,
            polygonId: "AUAS-0001",
            windowId: "W2005_2007",
            inspectedSceneIds: ["P:2005", "P:2006", "P:2007"],
            observations: [obs(2005, "ANTHROPIZED"), obs(2006, "NATIVE_VEGETATION"), obs(2007, "NATIVE_VEGETATION")],
            transitions: [],
            conflicts: [],
          },
        },
        { windowId: "W2007_2008", observation: vegetationWindow("W2007_2008", [2007, 2008]) },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("INCONCLUSIVO");
    expect(result.evidenceKind).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("todas as cenas ocluídas → INCONCLUSIVO", () => {
    const occludedYears: AuasYear[] = [2003, 2004, 2005, 2006, 2007, 2008];
    const input = baseInput({
      sceneUsabilityByYear: Object.fromEntries(occludedYears.map((y) => [y, "CLOUD_OR_OCCLUSION"])),
      windows: [
        { windowId: "W2003_2005", observation: null },
        { windowId: "W2005_2007", observation: null },
        { windowId: "W2007_2008", observation: null },
      ],
    });
    const result = reduceAuasPolygon(input);
    expect(result.status).toBe("INCONCLUSIVO");
  });
});

describe("reduceAuasAggregate", () => {
  function polygonWithStatus(status: "ALERTA_PRE_2008" | "SEM_EVIDENCIA_PRE_2008" | "INCONCLUSIVO" | "INCONCLUSIVO_NO_MARCO_2008", areaHa = 1) {
    return reduceAuasPolygonMock(status, areaHa);
  }

  function reduceAuasPolygonMock(
    status: "ALERTA_PRE_2008" | "SEM_EVIDENCIA_PRE_2008" | "INCONCLUSIVO" | "INCONCLUSIVO_NO_MARCO_2008",
    areaHa: number
  ) {
    return {
      polygonId: "AUAS-X",
      geometryHash: "h",
      sourceIndex: 0,
      areaHa,
      bbox: [0, 0, 1, 1] as [number, number, number, number],
      status,
      pre2008Alert: status === "ALERTA_PRE_2008",
      evidenceKind: "NO_PRE2008_CHANGE_OBSERVED" as const,
      observedInterval: null,
      confidence: "HIGH" as const,
      sceneIds: [],
      windowIds: [],
      evidence: [],
      limitations: [],
    };
  }

  it("um polígono alerta em dez → agregado ALERTA_PRE_2008", () => {
    const polys = [
      polygonWithStatus("ALERTA_PRE_2008"),
      ...Array.from({ length: 9 }, () => polygonWithStatus("SEM_EVIDENCIA_PRE_2008")),
    ];
    const agg = reduceAuasAggregate(polys);
    expect(agg.status).toBe("ALERTA_PRE_2008");
    expect(agg.pre2008Alert).toBe(true);
    expect(agg.alertCount).toBe(1);
  });

  it("nenhum alerta e um inconclusivo → agregado INCONCLUSIVO", () => {
    const polys = [
      polygonWithStatus("INCONCLUSIVO"),
      polygonWithStatus("SEM_EVIDENCIA_PRE_2008"),
      polygonWithStatus("SEM_EVIDENCIA_PRE_2008"),
    ];
    const agg = reduceAuasAggregate(polys);
    expect(agg.status).toBe("INCONCLUSIVO");
    expect(agg.pre2008Alert).toBe(false);
  });

  it("todos conclusivos e sem alerta → agregado SEM_EVIDENCIA_PRE_2008", () => {
    const polys = [
      polygonWithStatus("SEM_EVIDENCIA_PRE_2008"),
      polygonWithStatus("SEM_EVIDENCIA_PRE_2008"),
    ];
    const agg = reduceAuasAggregate(polys);
    expect(agg.status).toBe("SEM_EVIDENCIA_PRE_2008");
    expect(agg.pre2008Alert).toBe(false);
  });

  it("soma áreas de alerta e total corretamente", () => {
    const polys = [polygonWithStatus("ALERTA_PRE_2008", 5), polygonWithStatus("SEM_EVIDENCIA_PRE_2008", 3)];
    const agg = reduceAuasAggregate(polys);
    expect(agg.alertAreaHa).toBe(5);
    expect(agg.totalAuasAreaHa).toBe(8);
  });
});
