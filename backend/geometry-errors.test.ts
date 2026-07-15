import { describe, expect, it } from "vitest";

import {
  analyzeLayerGeometry,
  cleanRecordRings,
  detectAirAtpAreaConsistency,
  detectDuplicateVertices,
  detectGaps,
  detectOverlaps,
  detectSelfIntersections,
  detectSimcarContainment,
  detectSimcarForbiddenOverlaps,
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

describe("detectSimcarContainment", () => {
  const atp: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 100],
        [100, 100],
        [100, 0],
        [0, 0],
      ],
    ],
  };
  // AIR parcialmente fora da ATP: metade direita (100→150) sobra.
  const airOutside: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [50, 20],
        [50, 40],
        [150, 40],
        [150, 20],
        [50, 20],
      ],
    ],
  };
  const airInside: ParsedPolygonRecord = {
    feature: 2,
    rings: [
      [
        [10, 60],
        [10, 80],
        [40, 80],
        [40, 60],
        [10, 60],
      ],
    ],
  };

  it("reports the part of AIR outside ATP with metric area", () => {
    const result = detectSimcarContainment({
      layers: [
        { name: "ATP", records: [atp], crs: projectedCrs },
        { name: "AIR_MATRICULA_1", records: [airOutside, airInside], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tipo).toBe("fora_do_continente");
    expect(result.rows[0].feicao).toBe(1);
    expect(result.rows[0].detalhe).toContain("AIR");
    expect(result.rows[0].detalhe).toContain("ATP");
    expect(result.violations).toHaveLength(1);
    // Sobra: 50 m × 20 m = 1000 m²
    expect(result.violations[0].areaM2).toBeCloseTo(1000, 1);
    expect(result.violations[0].regra).toBe("contencao");
  });

  it("reports nothing when the child is fully contained", () => {
    const result = detectSimcarContainment({
      layers: [
        { name: "ATP", records: [atp], crs: projectedCrs },
        { name: "AIR", records: [airInside], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(0);
  });

  it("skips rules whose layers are absent and ignores unknown layer names", () => {
    const result = detectSimcarContainment({
      layers: [
        { name: "CAMADA_QUALQUER", records: [airOutside], crs: projectedCrs },
        { name: "AVN", records: [airInside], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(0);
  });
});

describe("detectSimcarForbiddenOverlaps", () => {
  // AVN 100×100 sobrepondo AUAS num retângulo 20×10 = 200 m².
  const avn: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 100],
        [100, 100],
        [100, 0],
        [0, 0],
      ],
    ],
  };
  const auasOverlapping: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [90, 40],
        [90, 50],
        [110, 50],
        [110, 40],
        [90, 40],
      ],
    ],
  };
  const auasDisjoint: ParsedPolygonRecord = {
    feature: 2,
    rings: [
      [
        [200, 200],
        [200, 210],
        [210, 210],
        [210, 200],
        [200, 200],
      ],
    ],
  };

  it("reports the AVN × AUAS forbidden overlap with metric area", () => {
    const result = detectSimcarForbiddenOverlaps({
      layers: [
        { name: "AVN", records: [avn], crs: projectedCrs },
        { name: "AUAS", records: [auasOverlapping, auasDisjoint], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tipo).toBe("sobreposicao_proibida");
    expect(result.rows[0].detalhe).toContain("AVN");
    expect(result.rows[0].detalhe).toContain("AUAS");
    expect(result.violations).toHaveLength(1);
    // Interseção: 10 m × 10 m = 100 m² (AVN vai até x=100)
    expect(result.violations[0].areaM2).toBeCloseTo(100, 1);
    expect(result.violations[0].regra).toBe("sobreposicao");
  });

  it("ignores pairs not listed as forbidden (ex.: AVN × ARL pode)", () => {
    const result = detectSimcarForbiddenOverlaps({
      layers: [
        { name: "AVN", records: [avn], crs: projectedCrs },
        { name: "ARL", records: [auasOverlapping], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(0);
  });

  it("respects the minimum area threshold", () => {
    const result = detectSimcarForbiddenOverlaps({
      layers: [
        { name: "AVN", records: [avn], crs: projectedCrs },
        { name: "AUAS", records: [auasOverlapping], crs: projectedCrs },
      ],
      minAreaM2: 500,
    });
    expect(result.rows).toHaveLength(0);
  });
});

describe("detectGaps", () => {
  // Dois retângulos 4×10 m separados por um vão de 2 m → gap 2×10 = 20 m².
  const left: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 10],
        [4, 10],
        [4, 0],
        [0, 0],
      ],
    ],
  };
  const right: ParsedPolygonRecord = {
    feature: 2,
    rings: [
      [
        [6, 0],
        [6, 10],
        [10, 10],
        [10, 0],
        [6, 0],
      ],
    ],
  };
  // Polígono único com buraco interior intencional (não é gap entre feições).
  const withHole: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 20],
        [20, 20],
        [20, 0],
        [0, 0],
      ],
      [
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ],
    ],
  };

  it("finds the gap between two adjacent polygons with metric area", () => {
    const result = detectGaps({
      layerName: "AIR",
      records: [left, right],
      crs: projectedCrs,
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].tipo).toBe("vazio");
    expect(result.rows[0].detalhe).toMatch(/feição|feições/i);
    expect(result.gapPolygons.length).toBeGreaterThanOrEqual(1);
    // Vão 2 m × 10 m = 20 m² (derivado da geometria de entrada).
    const totalGap = result.gapPolygons.reduce((sum, g) => sum + g.areaM2, 0);
    expect(totalGap).toBeCloseTo(20, 1);
    expect(result.gapPolygons[0].feicoes.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores gaps below the minimum area threshold", () => {
    const result = detectGaps({
      layerName: "AIR",
      records: [left, right],
      crs: projectedCrs,
      minGapM2: 100,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.gapPolygons).toHaveLength(0);
  });

  it("does not flag an intentional hole of a single feature as a gap", () => {
    const result = detectGaps({
      layerName: "AVN",
      records: [withHole],
      crs: projectedCrs,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.gapPolygons).toHaveLength(0);
  });

  it("reports nothing for a continuous pair without gap", () => {
    const touching: ParsedPolygonRecord = {
      feature: 2,
      rings: [
        [
          [4, 0],
          [4, 10],
          [10, 10],
          [10, 0],
          [4, 0],
        ],
      ],
    };
    const result = detectGaps({
      layerName: "AIR",
      records: [left, touching],
      crs: projectedCrs,
    });
    expect(result.rows).toHaveLength(0);
  });
});

describe("detectAirAtpAreaConsistency", () => {
  // ATP 100×100 = 10_000 m².
  const atp: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 100],
        [100, 100],
        [100, 0],
        [0, 0],
      ],
    ],
  };
  // Duas AIRs que somam 80×50 + 20×50 = 5_000 m² (metade da ATP).
  const airA: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 50],
        [80, 50],
        [80, 0],
        [0, 0],
      ],
    ],
  };
  const airB: ParsedPolygonRecord = {
    feature: 2,
    rings: [
      [
        [80, 0],
        [80, 50],
        [100, 50],
        [100, 0],
        [80, 0],
      ],
    ],
  };
  // AIRs que preenchem a ATP (mesma geometria decomposta).
  const airFullA: ParsedPolygonRecord = {
    feature: 1,
    rings: [
      [
        [0, 0],
        [0, 100],
        [50, 100],
        [50, 0],
        [0, 0],
      ],
    ],
  };
  const airFullB: ParsedPolygonRecord = {
    feature: 2,
    rings: [
      [
        [50, 0],
        [50, 100],
        [100, 100],
        [100, 0],
        [50, 0],
      ],
    ],
  };

  it("reports when sum(AIR) differs from ATP area", () => {
    const result = detectAirAtpAreaConsistency({
      layers: [
        { name: "ATP", records: [atp], crs: projectedCrs },
        { name: "AIR", records: [airA, airB], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tipo).toBe("air_atp_area");
    expect(result.rows[0].detalhe).toMatch(/AIR/i);
    expect(result.rows[0].detalhe).toMatch(/ATP/i);
    // Áreas derivadas das geometrias de entrada (não hardcoded no detalhe além da conta).
    expect(result.atpAreaM2).toBeCloseTo(10000, 0);
    expect(result.airAreaM2).toBeCloseTo(5000, 0);
    expect(Math.abs(result.airAreaM2 - result.atpAreaM2)).toBeCloseTo(5000, 0);
  });

  it("reports nothing when sum(AIR) matches ATP within tolerance", () => {
    const result = detectAirAtpAreaConsistency({
      layers: [
        { name: "ATP", records: [atp], crs: projectedCrs },
        { name: "AIR", records: [airFullA, airFullB], crs: projectedCrs },
      ],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.airAreaM2).toBeCloseTo(result.atpAreaM2, 0);
  });

  it("skips when AIR or ATP layer is absent", () => {
    const result = detectAirAtpAreaConsistency({
      layers: [{ name: "ATP", records: [atp], crs: projectedCrs }],
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
