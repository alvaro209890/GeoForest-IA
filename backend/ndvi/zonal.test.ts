import { describe, expect, it } from 'vitest';

import { zonalCoverage } from './zonal';

describe('zonalCoverage', () => {
  it('não confunde nodata fora de polígono irregular com nuvem', () => {
    // Retângulo 100 px; geometria ocupa 50 px e todos os 50 são válidos.
    const coverage = zonalCoverage({
      rasterPixels: 100,
      gdalValidPercent: 50,
      geometryAreaM2: 45_000,
      pixelAreaM2: 900,
    });
    expect(coverage).toEqual({ validPixels: 50, totalPixels: 50, validPct: 1 });
  });

  it('mede a perda real de pixels dentro da geometria', () => {
    const coverage = zonalCoverage({
      rasterPixels: 100,
      gdalValidPercent: 25,
      geometryAreaM2: 45_000,
      pixelAreaM2: 900,
    });
    expect(coverage.validPixels).toBe(25);
    expect(coverage.totalPixels).toBe(50);
    expect(coverage.validPct).toBe(0.5);
  });
});
