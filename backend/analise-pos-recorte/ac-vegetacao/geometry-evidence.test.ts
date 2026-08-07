/**
 * Testes da evidência geométrica da Fase 3 (turf, determinístico) — F3.1.
 * Cobre união, interseção com filtro de sliver e frações sobre a AC.
 *
 * Coordenadas em graus perto do equador; asserta proporções, nunca ha absoluto.
 */
import { describe, expect, it } from "vitest";
import { area as turfArea } from "@turf/turf";
import type { Geometry } from "geojson";

import {
  computeAcGeometricEvidence,
  unionLayerGeometries,
} from "./geometry-evidence";

/** Área em m² de uma geometria, pela mesma regra da implementação. */
function measureM2(geom: Geometry): number {
  return turfArea({ type: "Feature", properties: {}, geometry: geom });
}

/** Box de lado `side` graus com canto em (x0, y0), próximo ao equador. */
function box(x0: number, y0: number, side: number): Geometry {
  return {
    type: "Polygon",
    coordinates: [[[x0, y0], [x0 + side, y0], [x0 + side, y0 + side], [x0, y0 + side], [x0, y0]]],
  };
}

describe("unionLayerGeometries", () => {
  it("retorna null para ausentes ou não poligonais", () => {
    expect(unionLayerGeometries(undefined)).toBeNull();
    expect(unionLayerGeometries([])).toBeNull();
  });

  it("une dois quadrados lado a lado (área dobra)", () => {
    const a = box(0, 0, 0.08);
    const b = box(0.08, 0, 0.08);
    const united = unionLayerGeometries([a, b]);
    expect(united).not.toBeNull();
    const single = 2 * measureM2(box(0, 0, 0.08));
    const doubled = measureM2(united!.geometry);
    expect(Math.abs(doubled - single) / single).toBeLessThan(0.01);
  });
});

describe("computeAcGeometricEvidence", () => {
  const S = 0.08; // lado da AC ~ graus
  const ac = box(0, 0, S);

  it("AC sem camadas → zero declarado e slivers", () => {
    const result = computeAcGeometricEvidence({ acGeometry: ac, layers: {} });
    expect(result.geometric.declaredVegetationAreaHa).toBe(0);
    expect(result.geometric.avnAreaHa).toBe(0);
    expect(result.geometric.sliversDiscardedM2).toBe(0);
    expect(result.geometric.avnFraction).toBe(0);
  });

  it("AVN cobrindo 1/4 da AC (quadrante NE)", () => {
    const avn = [box(S / 2, S / 2, S / 2)]; // quadrante NE
    const result = computeAcGeometricEvidence({ acGeometry: ac, layers: { AVN: avn } });
    expect(result.geometric.avnFraction).toBeCloseTo(0.25, 2);
    expect(result.geometric.avnParts).toBe(1);
    expect(result.geometric.declaredVegetationFraction).toBeCloseTo(0.25, 2);
  });

  it("AVN + TIPOLOGIA com sobreposição não dobra área (união)", () => {
    const avn = [box(0, 0, S / 2)];
    const tip = [box(S / 4, 0, S / 4)]; // metade sobre AVN
    const result = computeAcGeometricEvidence({ acGeometry: ac, layers: { AVN: avn, TIPOLOGIA_VEGETAL: tip } });
    expect(result.geometric.avnFraction).toBeCloseTo(0.25, 2);
    // União ≈ 0.25 + 0.0625 - sobreposição(0.0625) = 0.25
    expect(result.geometric.declaredVegetationFraction).toBeCloseTo(0.25, 2);
  });

  it("descarta slivers menores que o limiar e os contabiliza", () => {
    const acBig = box(0, 0, 0.1);
    const big = measureM2(acBig);
    const thin = box(0, 0, 0.0005); // ~0.5m => sliver
    const thinM2 = measureM2(thin);
    expect(thinM2).toBeLessThan(big * 0.001);
    const result = computeAcGeometricEvidence(
      { acGeometry: acBig, layers: { AVN: [thin] } },
      { sliverThresholdM2: thinM2 * 2 }
    );
    expect(result.geometric.avnAreaHa).toBe(0);
    expect(result.geometric.sliversDiscardedM2).toBeGreaterThan(0);
  });

  it("preserva buracos do polígono na interseção", () => {
    const outer = box(0, 0, S);
    const hole = box(S * 0.25, S * 0.25, S * 0.5);
    const donut: Geometry = {
      type: "Polygon",
      coordinates: [
        outer.coordinates[0] as number[][],
        (hole.coordinates[0] as number[][]).slice().reverse(),
      ],
    };
    const result = computeAcGeometricEvidence({ acGeometry: ac, layers: { AVN: [donut] } });
    expect(result.geometric.avnFraction).toBeCloseTo(0.75, 2);
    expect(result.geometric.declaredVegetationFraction).toBeCloseTo(0.75, 2);
  });

  it("ARL e AUAS são medidos à parte e não disparam alerta", () => {
    const arl = [box(0, S / 2, S / 2)];
    const auas = [box(0, 0, S / 2)];
    const result = computeAcGeometricEvidence({ acGeometry: ac, layers: { ARL: [arl[0]], AUAS: [auas[0]] } });
    expect(result.geometric.arlAreaHa).toBeGreaterThan(0);
    expect(result.geometric.auasAreaHa).toBeGreaterThan(0);
    expect(result.geometric.declaredVegetationAreaHa).toBe(0);
  });
});
