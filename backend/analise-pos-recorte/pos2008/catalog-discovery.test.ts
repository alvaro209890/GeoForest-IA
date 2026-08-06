/**
 * W-01 (parte offline) do plano
 * `docs/planos/analise-pos-recorte/09-testes-e-validacao.md`: leitura do
 * GetCapabilities e montagem da série 2009–2019, sem rede.
 *
 * A fixture reproduz os nomes reais publicados pela SEMA em 2026-08-05
 * (levantamento F0.1) — inclusive a ausência de mosaico em 2001 e a troca de
 * sensor em 2012/2013.
 */
import { describe, expect, it } from "vitest";

import {
  buildYearCatalog,
  classifyMosaicLayer,
  computeCatalogVersion,
  listNirStyles,
  parseWmsCapabilities,
  parseWmsLayerNames,
} from "./catalog-discovery";

const CAPABILITIES_FIXTURE = `<?xml version="1.0"?>
<WMS_Capabilities>
  <Layer>
    <Name>Mosaicos</Name>
    <Layer><Name>Mosaicos:LANDSAT_5_2008</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_5_2009</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_5_2010</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_5_2011</Name></Layer>
    <Layer><Name>Mosaicos:RESOURCESAT_2012</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2013</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2014</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2015</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2016</Name></Layer>
    <Layer><Name>Mosaicos:SENTINEL_2_2016</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2017</Name></Layer>
    <Layer><Name>Mosaicos:SENTINEL_2_2017</Name></Layer>
    <Layer><Name>Mosaicos:LANDSAT_8_2018</Name></Layer>
    <Layer><Name>Mosaicos:SENTINEL_2_2018</Name></Layer>
    <Layer><Name>Mosaicos:SENTINEL_2_2019</Name></Layer>
    <Layer><Name>Mosaicos:SENTINEL_2_2024</Name></Layer>
    <Layer><Name>Mosaicos:MOSAICO_SPOT_SEPLAN</Name></Layer>
    <Layer>
      <Name>Mosaicos:SENTINEL_2_2021</Name>
      <Style>
        <Name>Mosaicos:Geoportal_Sentinel_2_2021_NIR</Name>
        <Title>SENTINEL_2_NIR</Title>
      </Style>
    </Layer>
    <Layer>
      <Name>Mosaicos:SENTINEL_2_2018</Name>
      <Style>
        <Name>Mosaicos:Geoportal_Sentinel_2_2018_NIR</Name>
        <Title>SENTINEL_2_NIR</Title>
      </Style>
    </Layer>
  </Layer>
</WMS_Capabilities>`;

const NAMES = parseWmsLayerNames(CAPABILITIES_FIXTURE);

describe("parseWmsLayerNames", () => {
  it("pega só camadas renderizáveis (com workspace) e ignora nomes de grupo", () => {
    expect(NAMES).toContain("Mosaicos:LANDSAT_5_2009");
    expect(NAMES).not.toContain("Mosaicos");
  });

  it("nome dentro de <Style> não vira camada (NIR da SEMA é estilo, não camada)", () => {
    expect(NAMES).not.toContain("Mosaicos:Geoportal_Sentinel_2_2021_NIR");
    expect(NAMES).toContain("Mosaicos:SENTINEL_2_2021");
  });

  it("não duplica nomes repetidos no XML", () => {
    const repetido = parseWmsLayerNames(
      "<Name>Mosaicos:SENTINEL_2_2019</Name><Name>Mosaicos:SENTINEL_2_2019</Name>",
    );
    expect(repetido).toEqual(["Mosaicos:SENTINEL_2_2019"]);
  });
});

describe("classifyMosaicLayer", () => {
  it("reconhece ano e sensor dos mosaicos da SEMA", () => {
    expect(classifyMosaicLayer("Mosaicos:LANDSAT_5_2009")).toEqual({
      layer: "Mosaicos:LANDSAT_5_2009",
      sensor: "LANDSAT_5",
      year: 2009,
      nir: false,
    });
    expect(classifyMosaicLayer("Mosaicos:RESOURCESAT_2012")?.sensor).toBe("RESOURCESAT");
    expect(classifyMosaicLayer("Mosaicos:Geoportal_Sentinel_2_2021_NIR")).toMatchObject({
      sensor: "SENTINEL_2",
      year: 2021,
      nir: true,
    });
  });

  it("nome fora do padrão não vira cena (não inventa ano)", () => {
    expect(classifyMosaicLayer("Mosaicos:MOSAICO_SPOT_SEPLAN")).toBeNull();
    expect(classifyMosaicLayer("Geoportal:DESMATAMENTO_SEMA_2014")).toBeNull();
    expect(classifyMosaicLayer("Mosaicos:LANDSAT_8")).toBeNull();
  });
});

describe("buildYearCatalog 2009–2019", () => {
  const catalog = buildYearCatalog(NAMES, { startYear: 2009, endYear: 2019 });

  it("cobre os 11 anos, sem lacuna", () => {
    expect(catalog).toHaveLength(11);
    expect(catalog.filter((entry) => entry.missing)).toEqual([]);
    expect(catalog.map((entry) => entry.year)).toEqual([
      2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019,
    ]);
  });

  it("escolhe um mosaico por ano e mantém o outro como alternativo (decisão A2 em aberto)", () => {
    const dois2016 = catalog.find((entry) => entry.year === 2016)!;
    expect(dois2016.preferred?.layer).toBe("Mosaicos:LANDSAT_8_2016");
    expect(dois2016.alternates.map((alt) => alt.layer)).toEqual(["Mosaicos:SENTINEL_2_2016"]);
  });

  it("marca as trocas de sensor da série (2012, 2013 e 2019)", () => {
    const fronteiras = catalog.filter((entry) => entry.sensorBoundary).map((entry) => entry.year);
    expect(fronteiras).toEqual([2012, 2013, 2019]);
  });

  it("ano sem mosaico publicado vira missing, nunca é pulado em silêncio", () => {
    const comLacuna = buildYearCatalog(NAMES, { startYear: 2019, endYear: 2021 });
    expect(comLacuna.map((entry) => ({ ano: entry.year, missing: entry.missing }))).toEqual([
      { ano: 2019, missing: false },
      { ano: 2020, missing: true },
      { ano: 2021, missing: false },
    ]);
  });

  it("override por ano tem precedência sobre a preferência de sensor", () => {
    const comOverride = buildYearCatalog(NAMES, {
      startYear: 2016,
      endYear: 2016,
      overrides: { 2016: "Mosaicos:SENTINEL_2_2016" },
    });
    expect(comOverride[0].preferred?.layer).toBe("Mosaicos:SENTINEL_2_2016");
    expect(comOverride[0].alternates.map((alt) => alt.layer)).toEqual(["Mosaicos:LANDSAT_8_2016"]);
  });

  it("mosaico NIR não entra na série RGB", () => {
    const todos = catalog.flatMap((entry) => [entry.preferred, ...entry.alternates]);
    expect(todos.every((ref) => ref === null || !ref.nir)).toBe(true);
  });
});

describe("parseWmsCapabilities", () => {
  it("associa cada estilo à camada que o publica", () => {
    const { styles } = parseWmsCapabilities(CAPABILITIES_FIXTURE);
    expect(styles).toContainEqual({
      style: "Mosaicos:Geoportal_Sentinel_2_2021_NIR",
      layer: "Mosaicos:SENTINEL_2_2021",
      year: 2021,
    });
  });
});

describe("listNirStyles", () => {
  it("lista os NIR do mais recente para o mais antigo, com a camada de cada um", () => {
    expect(listNirStyles(CAPABILITIES_FIXTURE)).toEqual([
      { style: "Mosaicos:Geoportal_Sentinel_2_2021_NIR", layer: "Mosaicos:SENTINEL_2_2021", year: 2021 },
      { style: "Mosaicos:Geoportal_Sentinel_2_2018_NIR", layer: "Mosaicos:SENTINEL_2_2018", year: 2018 },
    ]);
  });
});

describe("computeCatalogVersion", () => {
  const catalog = buildYearCatalog(NAMES, { startYear: 2009, endYear: 2019 });

  it("é estável para o mesmo catálogo", () => {
    expect(computeCatalogVersion(catalog)).toBe(computeCatalogVersion(catalog));
    expect(computeCatalogVersion(catalog)).toMatch(/^wms-[a-f0-9]{12}$/);
  });

  it("muda quando a SEMA troca o mosaico de um ano", () => {
    const trocado = buildYearCatalog(NAMES, {
      startYear: 2009,
      endYear: 2019,
      overrides: { 2016: "Mosaicos:SENTINEL_2_2016" },
    });
    expect(computeCatalogVersion(trocado)).not.toBe(computeCatalogVersion(catalog));
  });
});
