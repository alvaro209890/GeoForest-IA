import { describe, expect, it } from "vitest";
import {
  buildNdviFilename,
  buildNdviStoreName,
  cleanLayerName,
  dateCompactFromItemId,
  isoFromCompact,
  isSlcOff,
  jobSuffix,
  orbitKey,
  pathRowFromItemId,
  platformFromText,
  platformLabel,
  platformShort,
} from "./naming";

const ITEM_L5 = "LT05_L2SP_224069_20080720_20200829_02_T1_SR";
const ITEM_L8 = "LC08_L2SP_224069_20200907_20200918_02_T1_SR";
const ITEM_L7 = "LE07_L2SP_224069_20030715_20200916_02_T1_SR";

describe("detecção de plataforma", () => {
  it("lê o id STAC", () => {
    expect(platformFromText(ITEM_L5)).toBe("LANDSAT_5");
    expect(platformFromText(ITEM_L8)).toBe("LANDSAT_8");
    expect(platformFromText(ITEM_L7)).toBe("LANDSAT_7");
    expect(platformFromText("LC09_L2SP_224069_20230101_x")).toBe("LANDSAT_9");
    expect(platformFromText("LT04_L2SP_224069_19890101_x")).toBe("LANDSAT_4");
  });

  it("⚠️ casa plataforma cercada por underscore — `\\b` falharia aqui", () => {
    // `_` é caractere de palavra em JS: /\bl7\b/ NUNCA casa em "..._l7_etm_...".
    // Este é o bug que já premiou a cena riscada no acervo Landsat.
    expect(platformFromText("l7_etm_224069_20030715_c543")).toBe("LANDSAT_7");
    expect(platformFromText("landsat_224_069_2004_landsat_5_20041229")).toBe("LANDSAT_5");
    expect(platformFromText("cena_l8_oli_20200907")).toBe("LANDSAT_8");
  });

  it("aceita texto livre com hífen e espaço", () => {
    expect(platformFromText("landsat-5")).toBe("LANDSAT_5");
    expect(platformFromText("Landsat 8")).toBe("LANDSAT_8");
  });

  it("não confunde número solto no meio de palavra", () => {
    expect(platformFromText("mosaico2008")).toBe("DESCONHECIDA");
    expect(platformFromText("")).toBe("DESCONHECIDA");
    expect(platformFromText(null)).toBe("DESCONHECIDA");
  });

  it("rótulo e sigla batem com a plataforma", () => {
    expect(platformLabel("LANDSAT_5")).toBe("Landsat 5 TM");
    expect(platformLabel("LANDSAT_8")).toBe("Landsat 8 OLI");
    expect(platformShort("LANDSAT_5")).toBe("L5");
    expect(platformShort("DESCONHECIDA")).toBe("LX");
  });
});

describe("SLC-off do Landsat 7", () => {
  it("cena posterior a 31/05/2003 é degradada", () => {
    expect(isSlcOff("LANDSAT_7", "2003-07-15")).toBe(true);
    expect(isSlcOff("LANDSAT_7", "2012-08-01")).toBe(true);
  });
  it("cena anterior à falha não é", () => {
    expect(isSlcOff("LANDSAT_7", "2001-08-01")).toBe(false);
  });
  it("outras plataformas nunca são SLC-off", () => {
    expect(isSlcOff("LANDSAT_5", "2008-07-20")).toBe(false);
    expect(isSlcOff("LANDSAT_8", "2020-09-07")).toBe(false);
  });
});

describe("órbita/ponto e data do item STAC", () => {
  it("extrai path e row", () => {
    expect(pathRowFromItemId(ITEM_L5)).toEqual({ path: "224", row: "069" });
    expect(pathRowFromItemId(ITEM_L8)).toEqual({ path: "224", row: "069" });
  });
  it("extrai a data de aquisição, não a de processamento", () => {
    expect(dateCompactFromItemId(ITEM_L5)).toBe("20080720");
    expect(dateCompactFromItemId(ITEM_L8)).toBe("20200907");
  });
  it("converte compacto para ISO", () => {
    expect(isoFromCompact("20080720")).toBe("2008-07-20");
    expect(isoFromCompact("lixo")).toBeNull();
  });
  it("devolve null quando não reconhece", () => {
    expect(pathRowFromItemId("qualquer_coisa")).toBeNull();
  });
});

describe("nomes de arquivo", () => {
  it("segue a convenção da reunião: órbita/ponto, data, plataforma, composição", () => {
    expect(
      buildNdviFilename({ path: "224", row: "069", dateCompact: "20080720", platform: "LANDSAT_5", kind: "NDVI" }),
    ).toBe("NDVI_224_069_20080720_L5_NDVI.TIF");
  });

  it("acrescenta o sufixo do job no acervo", () => {
    const nome = buildNdviFilename({
      path: "224", row: "069", dateCompact: "20080720", platform: "LANDSAT_5",
      kind: "RGB", jobId: "47fa5471-abcd-ef01-2345-6789abcdef01",
    });
    expect(nome).toBe("NDVI_224_069_20080720_L5_RGB_J47FA5471.TIF");
  });

  it("o sufixo do job tem 8 caracteres e é maiúsculo", () => {
    expect(jobSuffix("47fa5471-abcd")).toBe("J47FA5471");
    expect(jobSuffix("abc")).toBe("JABC");
  });

  it("NDVI e RGB não colidem", () => {
    const base = { path: "224", row: "069", dateCompact: "20080720", platform: "LANDSAT_5" as const, jobId: "abc12345" };
    expect(buildNdviFilename({ ...base, kind: "NDVI" })).not.toBe(buildNdviFilename({ ...base, kind: "RGB" }));
  });
});

describe("nomes de layer/store", () => {
  it("é minúsculo e sem caractere especial", () => {
    const store = buildNdviStoreName({
      path: "224", row: "069", year: 2008,
      filename: "NDVI_224_069_20080720_L5_NDVI_J47FA5471.TIF",
    });
    expect(store).toBe("ndvi_224_069_2008_ndvi_224_069_20080720_l5_ndvi_j47fa5471");
    expect(store).toMatch(/^[a-z0-9_]+$/);
  });

  it("cleanLayerName remove acento, espaço e pontuação", () => {
    expect(cleanLayerName("NDVI Área 2008.TIF")).toBe("ndvi_rea_2008_tif");
    expect(cleanLayerName("__a--b__")).toBe("a_b");
  });

  it("orbitKey monta a chave dos grupos do WMS", () => {
    expect(orbitKey("224", "069")).toBe("224_069");
  });
});
