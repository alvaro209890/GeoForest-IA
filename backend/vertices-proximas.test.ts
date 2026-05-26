import { describe, expect, it } from "vitest";

import { buildShpAndShx } from "./shapefile-writer";
import {
  analyzeLayer,
  findClosestPairsWithinTolerance,
  visibleVerticesLayers,
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

  it("returns closest pairs without a minimum tolerance when tolerance is blank", () => {
    const pairs = findClosestPairsWithinTolerance(
      [
        { original: [0, 0], metric: [0, 0], vertexIndex: 1 },
        { original: [5, 0], metric: [5, 0], vertexIndex: 2 },
        { original: [5.5, 0], metric: [5.5, 0], vertexIndex: 3 },
      ],
      1,
      null,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a.vertexIndex).toBe(2);
    expect(pairs[0].b.vertexIndex).toBe(3);
    expect(pairs[0].distM).toBeCloseTo(0.5);
  });
});

describe("visibleVerticesLayers", () => {
  it("removes empty/ignored layers from the upload table payload", () => {
    const layers = visibleVerticesLayers([
      {
        id: "arl_cerrado_preservada",
        name: "ARL_CERRADO_PRESERVADA",
        path: "arl_cerrado_preservada.shp",
        geometryType: "Polygon",
        featureCount: 0,
        crsLabel: "EPSG:4674",
        missingCrs: false,
        ignoredReason: "Camada vazia ignorada.",
      },
      {
        id: "arl_floresta_preservada",
        name: "ARL_FLORESTA_PRESERVADA",
        path: "arl_floresta_preservada.shp",
        geometryType: "Polygon",
        featureCount: 12,
        crsLabel: "EPSG:4674",
        missingCrs: false,
      },
    ]);

    expect(layers.map((layer) => layer.name)).toEqual(["ARL_FLORESTA_PRESERVADA"]);
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

  it("treats blank layer tolerance as no distance limit even when a default exists", () => {
    const { shp } = buildShpAndShx([
      {
        type: "polygon",
        rings: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [9, 10],
            [8, 10],
            [7, 10],
            [6, 10],
            [5, 10],
            [0, 10],
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
      prjText: "PROJCS[\"UTM\",PROJECTION[\"Transverse_Mercator\"],PARAMETER[\"zone\",21]]",
      selection: { id: "ARL", pointCount: 6 },
      settings: { defaultToleranceMm: 0 },
    });

    expect(result.pairs).toHaveLength(6);
    expect(result.pairs.map((pair) => pair.ranking)).toEqual([1, 2, 3, 4, 5, 6]);
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
