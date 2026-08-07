import { describe, expect, it } from "vitest";

import { validateGroqPos2008WindowObservation } from "./schemas";

const expected = {
  polygonId: "AUAS-0001",
  windowId: "W2009_2011",
  sentSceneIds: ["scene-2009", "scene-2010", "scene-2011"],
  sentSceneMetadata: {
    "scene-2009": { year: 2009, sensor: "LANDSAT_5" },
    "scene-2010": { year: 2010, sensor: "LANDSAT_5" },
    "scene-2011": { year: 2011, sensor: "LANDSAT_5" },
  },
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    polygonId: "AUAS-0001",
    windowId: "W2009_2011",
    inspectedSceneIds: expected.sentSceneIds,
    observations: expected.sentSceneIds.map((sceneId, index) => ({
      sceneId,
      year: 2009 + index,
      state: "NATIVE_VEGETATION",
      observableFraction: 1,
      confidence: "HIGH",
      evidence: [],
      limitations: [],
    })),
    transitions: [],
    conflicts: [],
    ...overrides,
  };
}

describe("validateGroqPos2008WindowObservation", () => {
  it("rejeita ano inventado para sceneId válido", () => {
    const raw = response({
      observations: [{
        ...response().observations[0],
        year: 2011,
      }],
    });
    expect(validateGroqPos2008WindowObservation(raw, expected).ok).toBe(false);
  });

  it("rejeita transição entre cenas não consecutivas", () => {
    const raw = response({
      transitions: [{
        fromSceneId: "scene-2009",
        toSceneId: "scene-2011",
        fromYear: 2009,
        toYear: 2011,
        transition: "NATIVE_TO_ANTHROPIZED",
        confidence: "HIGH",
        evidence: [],
      }],
    });
    expect(validateGroqPos2008WindowObservation(raw, expected).ok).toBe(false);
  });
});
