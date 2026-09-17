import { area, featureCollection, intersect, polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
  clipFeaturesToPolygon,
  orderLayersForRiverTopology,
  type WfsFeature,
} from "./clip-pipeline";

function overlapSquareMeters(left: any, right: any): number {
  const overlap = intersect(featureCollection([
    { type: "Feature", properties: {}, geometry: left.geometry },
    { type: "Feature", properties: {}, geometry: right.geometry },
  ]) as any);
  return overlap ? area(overlap) : 0;
}

describe("clipFeaturesToPolygon", () => {
  it("processa todos os rios antes das demais camadas temáticas", () => {
    expect(orderLayersForRiverTopology([
      "AREA_CONSOLIDADA",
      "ATP",
      "AVN",
      "RIO_10_A_50",
      "AIR",
      "RIO_ATE_10",
      "ARL",
    ])).toEqual([
      "ATP",
      "AIR",
      "RIO_10_A_50",
      "RIO_ATE_10",
      "AREA_CONSOLIDADA",
      "AVN",
      "ARL",
    ]);
  });

  it("preserva por padrão a geometria WFS próxima à divisa, sem expandir AVN sobre rio", () => {
    const property = polygon([[
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
      [0, 0],
    ]]);
    const river: WfsFeature = {
      geometry: polygon([[
        [-0.0001, 0],
        [0.000005, 0],
        [0.000005, 0.001],
        [-0.0001, 0.001],
        [-0.0001, 0],
      ]]).geometry,
      properties: {},
    };
    const avn: WfsFeature = {
      geometry: polygon([[
        [0.000007, 0],
        [0.0005, 0],
        [0.0005, 0.001],
        [0.000007, 0.001],
        [0.000007, 0],
      ]]).geometry,
      properties: {},
    };

    const clippedRiver = clipFeaturesToPolygon([river], property, {
      snapToleranceMeters: 0,
    })[0];
    const preservedAvn = clipFeaturesToPolygon([avn], property)[0];
    const snappedAvn = clipFeaturesToPolygon([avn], property, {
      snapToleranceMeters: 1.5,
    })[0];

    expect(overlapSquareMeters(clippedRiver, preservedAvn)).toBe(0);
    expect(overlapSquareMeters(clippedRiver, snappedAvn)).toBeGreaterThan(10);
  });
});
