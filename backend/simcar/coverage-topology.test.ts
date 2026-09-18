import { polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
  CoverageTopologyError,
  validateOfficialCoverage,
} from "./coverage-topology";
import type { ClipResult } from "./types";

function result(geometry: ReturnType<typeof polygon>["geometry"], id: string): ClipResult {
  return { kind: "polygon", geometry, properties: { id } };
}

describe("validateOfficialCoverage", () => {
  it("preserva uma particao oficial exata sem sobrepor a agua", async () => {
    const property = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const water = polygon([[[0.00045, 0], [0.00055, 0], [0.00055, 0.001], [0.00045, 0.001], [0.00045, 0]]]);
    const ac = polygon([[[0, 0], [0.00045, 0], [0.00045, 0.001], [0, 0.001], [0, 0]]]);
    const avn = polygon([[[0.00055, 0], [0.001, 0], [0.001, 0.001], [0.00055, 0.001], [0.00055, 0]]]);
    const input = new Map<string, ClipResult[]>([
      ["RIO_ATE_10", [result(water.geometry, "rio")]],
      ["AREA_CONSOLIDADA", [result(ac.geometry, "ac")]],
      ["AUAS", []],
      ["AVN", [result(avn.geometry, "avn")]],
    ]);

    const original = structuredClone(input);
    const stats = await validateOfficialCoverage({
      layers: input,
      propertyPolygons: [property],
    });

    expect(stats.gapAreaM2).toBeLessThanOrEqual(0.01);
    expect(stats.landCoverOverlapAreaM2).toBeLessThanOrEqual(0.01);
    expect(stats.inundatedOverlapAreaM2).toBe(0);
    expect(input).toEqual(original);
  });

  it("cancela em vez de criar filete para fechar uma fresta estreita", async () => {
    const property = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const water = polygon([[[0.00045, 0], [0.00055, 0], [0.00055, 0.001], [0.00045, 0.001], [0.00045, 0]]]);
    const ac = polygon([[[0, 0], [0.000445, 0], [0.000445, 0.001], [0, 0.001], [0, 0]]]);
    const avn = polygon([[[0.000555, 0], [0.001, 0], [0.001, 0.001], [0.000555, 0.001], [0.000555, 0]]]);
    const input = new Map<string, ClipResult[]>([
      ["RIO_ATE_10", [result(water.geometry, "rio")]],
      ["AREA_CONSOLIDADA", [result(ac.geometry, "ac")]],
      ["AUAS", []],
      ["AVN", [result(avn.geometry, "avn")]],
    ]);

    await expect(validateOfficialCoverage({
      layers: input,
      propertyPolygons: [property],
    })).rejects.toThrow(/nenhum filete foi criado/i);
  });

  it("cancela quando o vazio e largo demais para ser uma fresta cartografica", async () => {
    const property = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const ac = polygon([[[0, 0], [0.0003, 0], [0.0003, 0.001], [0, 0.001], [0, 0]]]);
    const avn = polygon([[[0.0007, 0], [0.001, 0], [0.001, 0.001], [0.0007, 0.001], [0.0007, 0]]]);
    const input = new Map<string, ClipResult[]>([
      ["AREA_CONSOLIDADA", [result(ac.geometry, "ac")]],
      ["AUAS", []],
      ["AVN", [result(avn.geometry, "avn")]],
    ]);

    await expect(validateOfficialCoverage({
      layers: input,
      propertyPolygons: [property],
    })).rejects.toThrow(CoverageTopologyError);
  });

  it("cancela sobreposição em vez de apagar parte de uma classe", async () => {
    const property = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const ac = polygon([[[0, 0], [0.0006, 0], [0.0006, 0.001], [0, 0.001], [0, 0]]]);
    const avn = polygon([[[0.0005, 0], [0.001, 0], [0.001, 0.001], [0.0005, 0.001], [0.0005, 0]]]);
    const input = new Map<string, ClipResult[]>([
      ["AREA_CONSOLIDADA", [result(ac.geometry, "ac")]],
      ["AUAS", []],
      ["AVN", [result(avn.geometry, "avn")]],
    ]);

    await expect(validateOfficialCoverage({
      layers: input,
      propertyPolygons: [property],
    })).rejects.toThrow(/sobreposição entre classes/i);
    expect(input.get("AREA_CONSOLIDADA")?.[0].geometry).toEqual(ac.geometry);
    expect(input.get("AVN")?.[0].geometry).toEqual(avn.geometry);
  });
});
