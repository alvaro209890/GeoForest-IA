import { afterEach, describe, expect, it } from "vitest";

import {
  buildPos2008Windows,
  buildTimelinePlan,
  getPos2008Series,
  POS2008_SERIES_END,
  POS2008_SERIES_START,
  POS2008_WINDOWS,
} from "./timeline";
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

describe("buildPos2008Windows — série configurável", () => {
  it("reproduz exatamente as 5 janelas históricas de 2009–2019", () => {
    const windows = buildPos2008Windows(2009, 2019);
    expect(windows.map((w) => w.windowId)).toEqual([
      "W2009_2011",
      "W2011_2013",
      "W2013_2015",
      "W2015_2017",
      "W2017_2019",
    ]);
    expect(windows[0].sharedWithPrevious).toEqual([]);
    expect(windows[1].sharedWithPrevious).toEqual([2011]);
    expect(POS2008_WINDOWS).toEqual(windows);
  });

  it("estende a série até o mosaico mais recente da SEMA sem furo de ano", () => {
    const windows = buildPos2008Windows(2009, 2025);
    expect(windows.map((w) => w.windowId).slice(-3)).toEqual(["W2019_2021", "W2021_2023", "W2023_2025"]);
    const coberto = new Set(windows.flatMap((w) => w.years));
    for (let year = 2009; year <= 2025; year += 1) expect(coberto.has(year)).toBe(true);
  });

  it("nenhuma janela passa de 3 cenas — é o teto do modelo de visão", () => {
    for (const end of [2019, 2024, 2025, 2030]) {
      for (const window of buildPos2008Windows(2009, end)) {
        expect(window.years.length).toBeLessThanOrEqual(3);
        expect(window.years.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("série de tamanho par fecha com uma janela de 2 anos", () => {
    expect(buildPos2008Windows(2009, 2012).map((w) => w.years)).toEqual([
      [2009, 2010, 2011],
      [2011, 2012],
    ]);
  });
});

describe("getPos2008Series", () => {
  const envKeys = ["SIMCAR_AUAS_POS2008_SERIES_START", "SIMCAR_AUAS_POS2008_SERIES_END"] as const;
  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it("sem env, mantém o default 2009–2019 (fronteira do handoff para o SCCON)", () => {
    expect(getPos2008Series()).toEqual({ startYear: POS2008_SERIES_START, endYear: POS2008_SERIES_END });
  });

  it("respeita o fim configurado por env", () => {
    process.env.SIMCAR_AUAS_POS2008_SERIES_END = "2025";
    expect(getPos2008Series().endYear).toBe(2025);
  });

  it("recusa ano fora do acervo publicado e série invertida", () => {
    process.env.SIMCAR_AUAS_POS2008_SERIES_END = "1999";
    expect(() => getPos2008Series()).toThrow(/inválida/i);
    process.env.SIMCAR_AUAS_POS2008_SERIES_END = "2009";
    expect(() => getPos2008Series()).toThrow(/pelo menos um ano/i);
  });

  it("o plano de janelas segue a série passada por parâmetro", () => {
    const catalog = [2009, 2010, 2011, 2012, 2013].map((year) => ({
      year,
      preferred: { layer: `Mosaicos:LANDSAT_5_${year}`, sensor: "LANDSAT_5" as const, year, nir: false },
      alternates: [],
      missing: false,
      sensorBoundary: false,
    }));
    const plan = buildTimelinePlan(catalog, { startYear: 2009, endYear: 2013 });
    expect(plan.windows.map((w) => w.windowId)).toEqual(["W2009_2011", "W2011_2013"]);
  });
});
