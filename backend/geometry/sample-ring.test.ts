/**
 * Regressão: `sampleRingEveryMeters` projetava SEMPRE de WGS84, ignorando o CRS
 * da camada. Num anel UTM (coordenadas já em metros) a re-projeção tratava
 * metros como lon/lat e `steps` explodia (~953k pontos num anel de 4 segmentos)
 * — o job de geometria nunca terminava. Agora segue a mesma regra de
 * `candidateWidthM` (gaps.ts): só projeta se `crs.kind === "geographic"`.
 */
import { describe, expect, it } from "vitest";
import { detectCrs } from "../vertices-proximas/shapefile-io";
import { sampleRingEveryMeters } from "./utils";

const GEO = detectCrs(undefined, "EPSG:4326");
const UTM = detectCrs(undefined, "EPSG:31981");
const UTM_PROJ = "+proj=utm +zone=21 +south +ellps=GRS80 +units=m +no_defs";

// Retângulo de 1 km × 1 km em UTM (anel fechado de 5 vértices).
const KM_RING = [
  [300000, 8000000],
  [300000, 8001000],
  [301000, 8001000],
  [301000, 8000000],
  [300000, 8000000],
];

describe("sampleRingEveryMeters", () => {
  it("em camada UTM não re-projeta: ~1 km / 20 m ≈ 51 pontos, não milhões", () => {
    const samples = sampleRingEveryMeters(KM_RING, UTM, UTM_PROJ, 20);
    // 4 lados de 1000 m + vértices compartilhados ≈ 4×50 + 1
    expect(samples.length).toBeLessThanOrEqual(4 * 51 + 1);
    expect(samples.length).toBeGreaterThan(4 * 49);
    // amostras interpoladas na mesma faixa UTM (não "vazam" para valores absurdos)
    for (const [x, y] of samples) {
      expect(x).toBeGreaterThan(299000);
      expect(x).toBeLessThan(302000);
      expect(y).toBeGreaterThan(7999000);
      expect(y).toBeLessThan(8002000);
    }
  });

  it("em camada geográfica projeta e amostra na mesma ordem de grandeza", () => {
    const ring: number[][] = [
      [-51.5, -13.0],
      [-51.5, -13.009],
      [-51.49, -13.009],
      [-51.49, -13.0],
      [-51.5, -13.0],
    ];
    const samples = sampleRingEveryMeters(ring, GEO, UTM_PROJ, 20);
    // ~1 km de perímetro → poucas centenas de pontos, nunca milhões
    expect(samples.length).toBeLessThan(500);
    expect(samples.length).toBeGreaterThan(20);
  });
});
