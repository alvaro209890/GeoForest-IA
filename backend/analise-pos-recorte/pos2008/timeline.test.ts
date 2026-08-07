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
