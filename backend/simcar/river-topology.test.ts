import { area, featureCollection, intersect, point, polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { eraseRiverOverlap, extendRiverMask } from "./river-topology";
import type { ClipResult } from "./types";

function overlapSquareMeters(left: any, right: any): number {
  const overlap = intersect(featureCollection([left, right]) as any);
  return overlap ? area(overlap) : 0;
}

describe("river topology", () => {
  it("retira a hidrografia de qualquer outra camada poligonal", () => {
    const river = polygon([[[0, 0], [0.0004, 0], [0.0004, 0.001], [0, 0.001], [0, 0]]]);
    const avn = polygon([[[0.0002, 0], [0.001, 0], [0.001, 0.001], [0.0002, 0.001], [0.0002, 0]]]);
    const mask = extendRiverMask(null, [river.geometry]);
    const cleaned = eraseRiverOverlap([
      { kind: "polygon", geometry: avn.geometry, properties: { id: 7 } },
    ], mask);

    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].properties).toEqual({ id: 7 });
    expect(overlapSquareMeters(
      { type: "Feature", properties: {}, geometry: (cleaned[0] as any).geometry },
      river,
    )).toBe(0);
  });

  it("remove também sobreposição entre classes de rio pela prioridade de processamento", () => {
    const firstRiver = polygon([[[0, 0], [0.0005, 0], [0.0005, 0.001], [0, 0.001], [0, 0]]]);
    const secondRiver: ClipResult = {
      kind: "polygon",
      geometry: polygon([[[0.0003, 0], [0.0008, 0], [0.0008, 0.001], [0.0003, 0.001], [0.0003, 0]]]).geometry,
      properties: {},
    };
    const mask = extendRiverMask(null, [firstRiver.geometry]);
    const cleaned = eraseRiverOverlap([secondRiver], mask);

    expect(cleaned).toHaveLength(1);
    expect(overlapSquareMeters(
      { type: "Feature", properties: {}, geometry: (cleaned[0] as any).geometry },
      firstRiver,
    )).toBe(0);
  });

  it("preserva camadas de ponto, que não têm sobreposição de área", () => {
    const river = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]);
    const source: ClipResult = {
      kind: "point",
      pointCoords: [point([0.0005, 0.0005]).geometry.coordinates as [number, number]],
      properties: { id: 3 },
    };
    const mask = extendRiverMask(null, [river.geometry]);

    expect(eraseRiverOverlap([source], mask)).toEqual([source]);
  });
});
