import { describe, expect, it } from "vitest";

import { buildShpAndShx } from "./shapefile-writer";
import {
  analyzeLayer,
  findClosestPairsWithinTolerance,
} from "./vertices-proximas";

describe("findClosestPairsWithinTolerance", () => {
  it("returns only pairs inside the configured tolerance", () => {
    const pairs = findClosestPairsWithinTolerance(
      [
        { original: [0, 0], metric: [0, 0], vertexIndex: 1 },
        { original: [0.002, 0], metric: [0.002, 0], vertexIndex: 2 },
        { original: [10, 10], metric: [10, 10], vertexIndex: 3 },
      ],
      10,
      0.005,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.vertexIndex).toBe(1);
    expect(pairs[0].b.vertexIndex).toBe(2);
  });
});

describe("analyzeLayer", () => {
  it("ignores the natural duplicated closing vertex", () => {
    const { shp } = buildShpAndShx([
      {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        attributes: {},
      },
    ]);

    const result = analyzeLayer({
      layerId: "ARL",
      layerName: "ARL",
      shpBuffer: shp,
      prjText: "GEOGCS[\"SIRGAS 2000\"]",
      selection: { id: "ARL", pointCount: 10, toleranceMm: 1 },
      settings: { defaultToleranceMm: 1 },
    });

    expect(result.pairs).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("encontrados 0");
  });

  it("does not compare vertices across different features", () => {
    const { shp } = buildShpAndShx([
      {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        attributes: {},
      },
      {
        type: "polygon",
        rings: [
          [
            [0.000001, 0],
            [2, 0],
            [2, 2],
            [0.000001, 2],
            [0.000001, 0],
          ],
        ],
        attributes: {},
      },
    ]);

    const result = analyzeLayer({
      layerId: "APP",
      layerName: "APP",
      shpBuffer: shp,
      prjText: "GEOGCS[\"SIRGAS 2000\"]",
      selection: { id: "APP", pointCount: 10, toleranceMm: 10 },
      settings: { defaultToleranceMm: 10 },
    });

    expect(result.pairs).toHaveLength(0);
  });

  it("does not compare exterior and interior rings in the same feature", () => {
    const { shp } = buildShpAndShx([
      {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          [
            [0.000001, 0.000001],
            [1, 0.000001],
            [1, 1],
            [0.000001, 1],
            [0.000001, 0.000001],
          ],
        ],
        attributes: {},
      },
    ]);

    const result = analyzeLayer({
      layerId: "AREA_UMIDA",
      layerName: "AREA_UMIDA",
      shpBuffer: shp,
      prjText: "GEOGCS[\"SIRGAS 2000\"]",
      selection: { id: "AREA_UMIDA", pointCount: 10, toleranceMm: 10 },
      settings: { defaultToleranceMm: 10 },
    });

    expect(result.pairs).toHaveLength(0);
  });
});
