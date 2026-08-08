import { describe, expect, it } from "vitest";

import { buildTimelinePlan } from "./timeline";
import type { YearCatalogEntry } from "./catalog-discovery";

function entry(
  year: number,
  sensor: NonNullable<YearCatalogEntry["preferred"]>["sensor"],
  alternateLayer?: string,
): YearCatalogEntry {
  return {
    year,
    preferred: { layer: `Mosaicos:${sensor}_${year}`, sensor, year, nir: false },
    alternates: alternateLayer
      ? [{ layer: alternateLayer, sensor: "SENTINEL_2", year, nir: false }]
      : [],
    missing: false,
    sensorBoundary: false,
  };
}

describe("buildTimelinePlan", () => {
  it("associa a ponte ao candidato que realmente tem alternativa", () => {
    const catalog = [
      entry(2009, "LANDSAT_5"),
      entry(2010, "LANDSAT_5"),
      entry(2011, "LANDSAT_5"),
      entry(2012, "RESOURCESAT"),
      entry(2013, "LANDSAT_8"),
      entry(2014, "LANDSAT_8"),
      entry(2015, "LANDSAT_8"),
      entry(2016, "LANDSAT_8"),
      entry(2017, "LANDSAT_8"),
      entry(2018, "LANDSAT_8", "Mosaicos:SENTINEL_2_2018"),
      entry(2019, "SENTINEL_2"),
    ];

    const plan = buildTimelinePlan(catalog);
    expect(plan.bridgeWindow?.years).toEqual([2018, 2019]);
    const bridge = plan.bridgeCandidates.find(
      (candidate) => candidate.boundary.fromYear === plan.bridgeWindow?.years[0]
        && candidate.boundary.toYear === plan.bridgeWindow?.years[1],
    );
    expect(bridge?.alternateLayers[2018]).toEqual(["Mosaicos:SENTINEL_2_2018"]);
  });
});

describe("knownSensorBoundaries com ano reprovado", () => {
  it("mantém a fronteira quando o ano da troca de sensor sai da série", () => {
    // 2012 (ResourceSat) reprovado no GetMap vira `preferred: null` no meio do
    // catálogo. A fronteira real passa a ser 2011 (L5) → 2013 (L8): comparar só
    // vizinhos de array fazia a troca de sensor desaparecer com o ano.
    const catalog = [
      entry(2009, "LANDSAT_5"),
      entry(2010, "LANDSAT_5"),
      entry(2011, "LANDSAT_5"),
      { ...entry(2012, "RESOURCESAT"), preferred: null, alternates: [], missing: true },
      entry(2013, "LANDSAT_8"),
      entry(2014, "LANDSAT_8"),
    ];

    const plan = buildTimelinePlan(catalog);
    expect(plan.boundaries).toContainEqual({ fromYear: 2011, toYear: 2013 });
    expect(plan.missingYears).toEqual([2012]);
    expect(plan.windows.find((w) => w.windowId === "W2011_2013")?.years).toEqual([2011, 2013]);
  });

  it("não inventa fronteira quando o ano removido não trocava de sensor", () => {
    const catalog = [
      entry(2009, "LANDSAT_5"),
      { ...entry(2010, "LANDSAT_5"), preferred: null, alternates: [], missing: true },
      entry(2011, "LANDSAT_5"),
    ];
    expect(buildTimelinePlan(catalog).boundaries).toEqual([]);
  });
});
