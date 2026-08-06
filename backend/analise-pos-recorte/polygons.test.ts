/**
 * U-01 e U-02 do plano `docs/planos/analise-pos-recorte/09-testes-e-validacao.md`.
 * A extração genérica precisa ser byte-a-byte igual à da Fase 1 para AUAS e dar
 * espaço de IDs próprio (`AC-0001…`) para a camada da Fase 3.
 */
import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";

import { extractAuasPolygons } from "./auas-polygons";
import {
  computeGeometryHash,
  countLayerPolygons,
  extractPolygonsFromLayer,
  resolveLayerPrefix,
} from "./polygons";

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

describe("extractPolygonsFromLayer", () => {
  it("U-01: em AUAS produz exatamente o mesmo resultado de extractAuasPolygons", () => {
    const map = new Map<string, Geometry[]>([
      ["AUAS", [square(0, 0, 1, 1), squareWithHole(), disjointMultiPolygon()]],
    ]);
    const generic = extractPolygonsFromLayer(map, "AUAS", "AUAS");
    const legacy = extractAuasPolygons(map);
    expect(generic).toEqual(legacy);
    expect(generic.map((p) => p.polygonId)).toEqual(["AUAS-0001", "AUAS-0002", "AUAS-0003"]);
  });

  it("U-01: AREA_CONSOLIDADA ganha espaço de IDs próprio (AC-0001…)", () => {
    const map = new Map<string, Geometry[]>([
      ["AREA_CONSOLIDADA", [square(0, 0, 1, 1), square(2, 2, 3, 3)]],
    ]);
    const polygons = extractPolygonsFromLayer(map, "AREA_CONSOLIDADA");
    expect(polygons.map((p) => p.polygonId)).toEqual(["AC-0001", "AC-0002"]);
    expect(resolveLayerPrefix("AREA_CONSOLIDADA")).toBe("AC");
    expect(resolveLayerPrefix("TIPOLOGIA_VEGETAL")).toBe("TIPOLOGIA_VEGETAL");
  });

  it("U-01: preserva buracos e partes disjuntas, sem unir polígonos", () => {
    const map = new Map<string, Geometry[]>([
      ["AREA_CONSOLIDADA", [squareWithHole(), disjointMultiPolygon()]],
    ]);
    const [comBuraco, multi] = extractPolygonsFromLayer(map, "AREA_CONSOLIDADA");
    expect((comBuraco.geometry as any).coordinates).toHaveLength(2);
    expect(multi.geometry.type).toBe("MultiPolygon");
    expect((multi.geometry as any).coordinates).toHaveLength(2);
  });

  it("U-01: ignora geometria não poligonal mas mantém o sourceIndex do shapefile", () => {
    const map = new Map<string, Geometry[]>([
      [
        "AUAS",
        [
          { type: "Point", coordinates: [0, 0] } as Geometry,
          square(0, 0, 1, 1),
        ],
      ],
    ]);
    const polygons = extractPolygonsFromLayer(map, "AUAS");
    expect(polygons).toHaveLength(1);
    expect(polygons[0].polygonId).toBe("AUAS-0001");
    expect(polygons[0].sourceIndex).toBe(1);
  });

  it("camada ausente ou vazia devolve lista vazia (não é erro)", () => {
    expect(extractPolygonsFromLayer(undefined, "AUAS")).toEqual([]);
    expect(extractPolygonsFromLayer(new Map(), "AREA_CONSOLIDADA")).toEqual([]);
    expect(extractPolygonsFromLayer(new Map([["AUAS", []]]), "AUAS")).toEqual([]);
  });
});

describe("countLayerPolygons", () => {
  it("conta só geometrias poligonais, sem calcular área/hash", () => {
    const map = new Map<string, Geometry[]>([
      [
        "AUAS",
        [square(0, 0, 1, 1), { type: "Point", coordinates: [0, 0] } as Geometry, disjointMultiPolygon()],
      ],
    ]);
    expect(countLayerPolygons(map, "AUAS")).toBe(2);
    expect(countLayerPolygons(map, "AREA_CONSOLIDADA")).toBe(0);
    expect(countLayerPolygons(undefined, "AUAS")).toBe(0);
  });

  it("bate com o tamanho de extractPolygonsFromLayer", () => {
    const map = new Map<string, Geometry[]>([["AUAS", [square(0, 0, 1, 1), squareWithHole()]]]);
    expect(countLayerPolygons(map, "AUAS")).toBe(extractPolygonsFromLayer(map, "AUAS").length);
  });
});

describe("computeGeometryHash", () => {
  it("U-02: é estável entre execuções e independente da ordem das chaves", () => {
    const a = computeGeometryHash(square(0, 0, 1, 1));
    const b = computeGeometryHash(JSON.parse(JSON.stringify(square(0, 0, 1, 1))));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("U-02: muda quando uma coordenada muda", () => {
    expect(computeGeometryHash(square(0, 0, 1, 1))).not.toBe(
      computeGeometryHash(square(0, 0, 1, 1.000001))
    );
  });
});
