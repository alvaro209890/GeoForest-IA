import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";

import { computeGeometryHash, extractAuasPolygons } from "./auas-polygons";

function square(x0: number, y0: number, x1: number, y1: number): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  };
}

function squareWithHole(): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [2, 4],
        [4, 4],
        [4, 2],
        [2, 2],
      ],
    ],
  };
}

function disjointMultiPolygon(): Geometry {
  return {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [5, 5],
          [6, 5],
          [6, 6],
          [5, 6],
          [5, 5],
        ],
      ],
    ],
  };
}

describe("extractAuasPolygons", () => {
  it("retorna vazio quando a camada AUAS não existe", () => {
    const map = new Map<string, Geometry[]>();
    expect(extractAuasPolygons(map)).toEqual([]);
    expect(extractAuasPolygons(undefined)).toEqual([]);
  });

  it("lê somente a chave literal AUAS, ignorando outras camadas", () => {
    const map = new Map<string, Geometry[]>([
      ["AVN", [square(0, 0, 1, 1)]],
    ]);
    expect(extractAuasPolygons(map)).toEqual([]);
  });

  it("preserva um Polygon com buraco sem alterar a geometria", () => {
    const geom = squareWithHole();
    const map = new Map<string, Geometry[]>([["AUAS", [geom]]]);
    const result = extractAuasPolygons(map);
    expect(result).toHaveLength(1);
    expect(result[0].geometry).toEqual(geom);
    expect((result[0].geometry as any).coordinates).toHaveLength(2); // anel externo + buraco
  });

  it("preserva MultiPolygon com partes disjuntas sem unir", () => {
    const geom = disjointMultiPolygon();
    const map = new Map<string, Geometry[]>([["AUAS", [geom]]]);
    const result = extractAuasPolygons(map);
    expect(result).toHaveLength(1);
    expect(result[0].geometry.type).toBe("MultiPolygon");
    expect((result[0].geometry as any).coordinates).toHaveLength(2);
  });

  it("não une dois polígonos distintos da lista", () => {
    const map = new Map<string, Geometry[]>([
      ["AUAS", [square(0, 0, 1, 1), square(5, 5, 6, 6)]],
    ]);
    const result = extractAuasPolygons(map);
    expect(result).toHaveLength(2);
    expect(result[0].polygonId).toBe("AUAS-0001");
    expect(result[1].polygonId).toBe("AUAS-0002");
    expect(result[0].sourceIndex).toBe(0);
    expect(result[1].sourceIndex).toBe(1);
  });

  it("rejeita geometria não poligonal (ex.: LineString/Point)", () => {
    const line: Geometry = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    const point: Geometry = { type: "Point", coordinates: [0, 0] };
    const map = new Map<string, Geometry[]>([
      ["AUAS", [line, square(0, 0, 1, 1), point]],
    ]);
    const result = extractAuasPolygons(map);
    expect(result).toHaveLength(1);
    expect(result[0].sourceIndex).toBe(1);
  });

  it("calcula área e bbox coerentes", () => {
    const map = new Map<string, Geometry[]>([["AUAS", [square(0, 0, 0.01, 0.01)]]]);
    const result = extractAuasPolygons(map);
    expect(result[0].areaHa).toBeGreaterThan(0);
    expect(result[0].bbox).toEqual([0, 0, 0.01, 0.01]);
  });

  it("gera IDs determinísticos na ordem de entrada", () => {
    const map = new Map<string, Geometry[]>([
      ["AUAS", [square(0, 0, 1, 1), square(2, 2, 3, 3), square(4, 4, 5, 5)]],
    ]);
    const result = extractAuasPolygons(map);
    expect(result.map((p) => p.polygonId)).toEqual([
      "AUAS-0001",
      "AUAS-0002",
      "AUAS-0003",
    ]);
  });
});

describe("computeGeometryHash", () => {
  it("gera o mesmo hash para GeoJSON canônico equivalente (ordem de chaves diferente)", () => {
    const a: Geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const b = { coordinates: a.coordinates, type: "Polygon" } as Geometry;
    expect(computeGeometryHash(a)).toBe(computeGeometryHash(b));
  });

  it("gera hash diferente quando a geometria muda", () => {
    const a = square(0, 0, 1, 1);
    const b = square(0, 0, 2, 2);
    expect(computeGeometryHash(a)).not.toBe(computeGeometryHash(b));
  });
});
