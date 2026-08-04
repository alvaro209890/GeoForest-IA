/**
 * Regressão do desmembramento (planos 04–07): os pacotes geográficos precisam
 * registrar EPSG:4674/EPSG:4326 no proj4 ao serem importados.
 *
 * Sem `backend/proj-defs.ts`, qualquer cálculo métrico quebra com
 * "Could not parse to valid json: EPSG:4674" — foi o que aconteceu quando o
 * `proj4.defs(...)` de topo de arquivo ficou de fora do recorte.
 */
import { describe, expect, it } from "vitest";
import proj4 from "proj4";
import type { Polygon } from "geojson";
import { densifiedPlanarAreaM2 } from "./overlap";
import { metricProjDefFor } from "./geometry-errors";
import { estimateUtmProjFromLonLat } from "./vertices-proximas";

/** Quadra de ~0,01° em Mato Grosso (SIRGAS 2000 geográfico). */
const quadra: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-56.0, -12.0],
      [-55.99, -12.0],
      [-55.99, -11.99],
      [-56.0, -11.99],
      [-56.0, -12.0],
    ],
  ],
};

describe("registro global de projeções (proj-defs)", () => {
  it("converte EPSG:4674 → EPSG:4326 sem lançar", () => {
    expect(() => proj4("EPSG:4674", "EPSG:4326", [-56, -12])).not.toThrow();
  });

  it("overlap calcula área métrica de polígono em graus", () => {
    const areaM2 = densifiedPlanarAreaM2(quadra);
    // ~0,01° × 0,01° em MT ≈ 1,2 km²
    expect(areaM2).toBeGreaterThan(1_000_000);
    expect(areaM2).toBeLessThan(1_500_000);
  });

  it("geometry resolve projeção métrica para CRS geográfico", () => {
    const projDef = metricProjDefFor(
      { label: "EPSG:4674", kind: "geographic", projDef: "EPSG:4674", prjText: "", missing: false },
      [{ feature: 1, rings: [quadra.coordinates[0]] } as any],
    );
    expect(projDef).toContain("+proj=utm");
  });

  it("vertices-proximas estima a zona UTM a partir de lon/lat", () => {
    const { projDef } = estimateUtmProjFromLonLat(-56, -12);
    expect(() => proj4("EPSG:4674", projDef, [-56, -12])).not.toThrow();
  });
});
