import { describe, expect, it } from "vitest";

import {
  analyzeLayerGeometry,
  cleanRecordRings,
  detectDuplicateVertices,
  detectOverlaps,
  detectSelfIntersections,
  fixLayerGeometry,
  recordToGeoJSON,
} from "./geometry-errors";
import { detectCrs } from "./vertices-proximas";
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

// Quadrado com o vértice (10, 14) repetido em sequência.
const squareWithDuplicate: ParsedPolygonRecord = {
  feature: 3,
  rings: [
    [
      [10, 10],
      [10, 14],
      [10, 14],
      [14, 14],
      [14, 10],
      [10, 10],
    ],
  ],
};

// Anel colapsado: só 2 vértices distintos.
const degenerateRing: ParsedPolygonRecord = {
  feature: 4,
  rings: [
    [
      [0, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};

describe("detectDuplicateVertices", () => {
  it("finds consecutive duplicated vertices", () => {
    const rows = detectDuplicateVertices("APP", [squareWithDuplicate]);
    const duplicates = rows.filter((row) => row.tipo === "vertice_duplicado");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].feicao).toBe(3);
    expect(duplicates[0].x).toBeCloseTo(10, 9);
    expect(duplicates[0].y).toBeCloseTo(14, 9);
  });

  it("flags rings with fewer than 3 distinct vertices", () => {
    const rows = detectDuplicateVertices("APP", [degenerateRing]);
    expect(rows.some((row) => row.tipo === "anel_degenerado")).toBe(true);
  });

  it("reports nothing for a clean square", () => {
    expect(detectDuplicateVertices("APP", [square])).toHaveLength(0);
  });
});

describe("cleanRecordRings", () => {
  it("removes consecutive duplicated vertices and keeps ring closed", () => {
    const result = cleanRecordRings(squareWithDuplicate);
    expect(result.removedVertices).toBe(1);
    expect(result.droppedRings).toBe(0);
    const ring = result.record.rings[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5); // quadrado fechado sem o vértice repetido
  });

  it("drops degenerate rings entirely", () => {
    const result = cleanRecordRings(degenerateRing);
    expect(result.droppedRings).toBe(1);
    expect(result.record.rings).toHaveLength(0);
  });
});

describe("fixLayerGeometry with cleanDuplicates", () => {
  it("marks cleaned features as corrigido=S without unkink", () => {
    const result = fixLayerGeometry({
      layerName: "APP",
      records: [squareWithDuplicate, square],
      errorFeatureIds: new Set<number>(),
      cleanDuplicates: true,
    });
    expect(result.fixedFeatures).toBe(1);
    const fixed = result.records.filter((record) => record.attributes.corrigido === "S");
    expect(fixed).toHaveLength(1);
    expect(fixed[0].attributes.feicao).toBe(3);
    // Depois da limpeza, a feição não tem mais vértices duplicados.
    expect(detectDuplicateVertices("APP", [{ feature: 3, rings: fixed[0].rings }])).toHaveLength(0);
  });
});

// CRS projetado (UTM 21S SIRGAS) para as contas de área em metros.
const projectedCrs = detectCrs(undefined, "EPSG:31981");

const squareA: ParsedPolygonRecord = {
  feature: 1,
  rings: [
    [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ],
  ],
};

// Sobrepõe squareA num quadrado de 2×2 m (4 m²).
const squareB: ParsedPolygonRecord = {
  feature: 2,
  rings: [
    [
      [8, 8],
      [8, 18],
      [18, 18],
      [18, 8],
      [8, 8],
    ],
  ],
};

const squareFar: ParsedPolygonRecord = {
  feature: 3,
  rings: [
    [
      [100, 100],
      [100, 110],
      [110, 110],
      [110, 100],
      [100, 100],
    ],
  ],
};

describe("detectOverlaps", () => {
  it("finds overlapping feature pairs with metric area", () => {
    const result = detectOverlaps({
      layerName: "AUAS",
      records: [squareA, squareB, squareFar],
      crs: projectedCrs,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tipo).toBe("sobreposicao");
    expect(result.rows[0].feicao).toBe(1);
    expect(result.rows[0].detalhe).toContain("feição 2");
    expect(result.overlapPolygons).toHaveLength(1);
    expect(result.overlapPolygons[0].areaM2).toBeCloseTo(4, 3);
  });

  it("ignores overlaps below the minimum area threshold", () => {
    const result = detectOverlaps({
      layerName: "AUAS",
      records: [squareA, squareB],
      crs: projectedCrs,
      minOverlapM2: 10,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.overlapPolygons).toHaveLength(0);
  });

  it("reports nothing for disjoint features", () => {
    const result = detectOverlaps({
      layerName: "AUAS",
      records: [squareA, squareFar],
      crs: projectedCrs,
    });
    expect(result.rows).toHaveLength(0);
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
