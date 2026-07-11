import { describe, expect, it } from "vitest";

import {
  analyzeLayerGeometry,
  detectSelfIntersections,
  fixLayerGeometry,
  recordToGeoJSON,
} from "./geometry-errors";
import type { ParsedPolygonRecord } from "./vertices-proximas";

// Polígono "gravata borboleta": a borda se cruza em (1, 1).
const bowtie: ParsedPolygonRecord = {
  feature: 1,
  rings: [
    [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0],
    ],
  ],
};

// Quadrado simples, sem erros.
const square: ParsedPolygonRecord = {
  feature: 2,
  rings: [
    [
      [10, 10],
      [10, 14],
      [14, 14],
      [14, 10],
      [10, 10],
    ],
  ],
};

describe("detectSelfIntersections", () => {
  it("finds the crossing point of a bowtie polygon", () => {
    const rows = detectSelfIntersections("AREA_TESTE", [bowtie]);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].tipo).toBe("borda_se_cruza");
    expect(rows[0].feicao).toBe(1);
    expect(rows[0].x).toBeCloseTo(1, 6);
    expect(rows[0].y).toBeCloseTo(1, 6);
  });

  it("reports nothing for a simple square", () => {
    expect(detectSelfIntersections("AREA_TESTE", [square])).toHaveLength(0);
  });

  it("keeps camada/feicao metadata for every error row", () => {
    const rows = detectSelfIntersections("APP", [square, bowtie]);
    expect(rows.every((row) => row.camada === "APP")).toBe(true);
    expect(rows.every((row) => row.feicao === 1)).toBe(true);
  });
});

describe("analyzeLayerGeometry", () => {
  it("runs self-intersection by default", () => {
    const rows = analyzeLayerGeometry({ layerName: "AVN", records: [bowtie], checks: {} });
    expect(rows.some((row) => row.tipo === "borda_se_cruza")).toBe(true);
  });

  it("skips the check when explicitly disabled", () => {
    const rows = analyzeLayerGeometry({
      layerName: "AVN",
      records: [bowtie],
      checks: { selfIntersection: false },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("fixLayerGeometry", () => {
  it("splits a bowtie into simple polygons and keeps clean features untouched", () => {
    const result = fixLayerGeometry({
      layerName: "AVN",
      records: [bowtie, square],
      errorFeatureIds: new Set([1]),
    });

    expect(result.fixedFeatures).toBe(1);
    const fixed = result.records.filter((record) => record.attributes.corrigido === "S");
    const untouched = result.records.filter((record) => record.attributes.corrigido === "N");
    // O unkink divide a gravata em 2 triângulos simples.
    expect(fixed.length).toBeGreaterThanOrEqual(2);
    expect(fixed.every((record) => record.attributes.feicao === 1)).toBe(true);
    expect(untouched).toHaveLength(1);
    expect(untouched[0].attributes.feicao).toBe(2);

    // Nenhuma peça corrigida pode continuar com auto-interseção.
    for (const [index, record] of fixed.entries()) {
      const rows = detectSelfIntersections("AVN", [{ feature: index + 1, rings: record.rings }]);
      expect(rows).toHaveLength(0);
    }
  });
});

describe("recordToGeoJSON", () => {
  it("builds a closed Polygon from raw rings", () => {
    const geom = recordToGeoJSON(square);
    expect(geom?.type).toBe("Polygon");
    const ring = (geom as any).coordinates[0] as number[][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
