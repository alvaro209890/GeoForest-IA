import { area, polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { clipOfficialFeaturesExactly } from "./exact-clip";

describe("clipOfficialFeaturesExactly", () => {
  it("faz somente a interseção e preserva uma feição inteiramente dentro da ATP", async () => {
    const property = polygon([[[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]]]);
    const official = polygon([[[0.0005, 0.0005], [0.0015, 0.0005], [0.0015, 0.0015], [0.0005, 0.0015], [0.0005, 0.0005]]]);

    const output = await clipOfficialFeaturesExactly([{
      geometry: official.geometry,
      properties: { ID: 7 },
    }], property, { layerName: "AVN" });

    expect(output).toHaveLength(1);
    expect(output[0].properties).toEqual({ ID: 7 });
    expect(output[0].kind).toBe("polygon");
    if (output[0].kind === "polygon") {
      expect(area({ type: "Feature", properties: {}, geometry: output[0].geometry }))
        .toBeCloseTo(area(official), 6);
    }
  });

  it("não preenche a fresta existente entre duas feições oficiais", async () => {
    const property = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const left = polygon([[[0, 0], [0.00049, 0], [0.00049, 0.001], [0, 0.001], [0, 0]]]);
    const right = polygon([[[0.00051, 0], [0.001, 0], [0.001, 0.001], [0.00051, 0.001], [0.00051, 0]]]);

    const output = await clipOfficialFeaturesExactly([
      { geometry: left.geometry, properties: { ID: "L" } },
      { geometry: right.geometry, properties: { ID: "R" } },
    ], property, { layerName: "AVN" });

    expect(output).toHaveLength(2);
    const outputArea = output.reduce((total, item) => {
      if (item.kind !== "polygon") return total;
      return total + area({ type: "Feature", properties: {}, geometry: item.geometry });
    }, 0);
    expect(area(property) - outputArea).toBeGreaterThan(200);
  });
});
