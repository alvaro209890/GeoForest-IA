import { describe, expect, it } from "vitest";

import {
  checkSimcarConformity,
  normalizeLayerName,
  recognizeSimcarLayer,
} from "./simcar-rules";
import { SIRGAS_2000_PRJ, WGS84_PRJ } from "./vertices-proximas";
import { buildDbfBuffer, buildShpAndShx, type ShpRecord } from "./shapefile-writer";

const squareRings: number[][][] = [
  [
    [-55, -12],
    [-55, -11.9],
    [-54.9, -11.9],
    [-54.9, -12],
    [-55, -12],
  ],
];

function polygonShp(count = 1): Buffer {
  const records: ShpRecord[] = Array.from({ length: count }, () => ({
    type: "polygon",
    rings: squareRings,
    attributes: {},
  }));
  return buildShpAndShx(records, 5).shp;
}

function polygonZShp(): Buffer {
  const shp = Buffer.from(polygonShp());
  shp.writeInt32LE(15, 32); // cabeçalho PolygonZ
  return shp;
}

const UTM_PRJ =
  'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]';

describe("normalizeLayerName / recognizeSimcarLayer", () => {
  it("normalizes accents, case and separators", () => {
    expect(normalizeLayerName("Rio_10_até_50")).toBe("RIO_10_ATE_50");
    expect(normalizeLayerName("área consolidada")).toBe("AREA_CONSOLIDADA");
  });

  it("recognizes official names, aliases and suffixed names", () => {
    expect(recognizeSimcarLayer("ATP")).toBe("ATP");
    expect(recognizeSimcarLayer("Área_do_Imóvel_Rural")).toBe("AIR");
    expect(recognizeSimcarLayer("AVN_FAZENDA_BOA_VISTA")).toBe("AVN");
    expect(recognizeSimcarLayer("RESERVA_LEGAL")).toBe("ARL");
    expect(recognizeSimcarLayer("BORDA_DE_CHAPADA")).toBe("BORDA_CHAPADA");
    expect(recognizeSimcarLayer("CAMADA_QUALQUER")).toBeNull();
  });

  it("prefers the longest match", () => {
    expect(recognizeSimcarLayer("AREA_CONSOLIDADA_01")).toBe("AREA_CONSOLIDADA");
  });
});

describe("checkSimcarConformity", () => {
  const airDbf = buildDbfBuffer([{ TIPO: "M", IDENTIFIC: "123" }], [
    { name: "TIPO", type: "C", length: 1, decimals: 0 },
    { name: "IDENTIFIC", type: "C", length: 40, decimals: 0 },
  ]);

  it("accepts a conforming project without rows", () => {
    const rows = checkSimcarConformity([
      { name: "ATP", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ },
      { name: "AIR", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ, dbf: airDbf },
    ]);
    expect(rows).toHaveLength(0);
  });

  it("flags non-SIRGAS CRS (UTM and WGS84) and missing prj", () => {
    const rows = checkSimcarConformity([
      { name: "ATP", shp: polygonShp(1), prjText: UTM_PRJ },
      { name: "AIR", shp: polygonShp(1), prjText: WGS84_PRJ, dbf: airDbf },
      { name: "AVN", shp: polygonShp(1) },
    ]);
    expect(rows.filter((r) => r.tipo === "crs_nao_conforme")).toHaveLength(2);
    expect(rows.filter((r) => r.tipo === "crs_ausente")).toHaveLength(1);
  });

  it("flags PolygonZ as non-2D", () => {
    const rows = checkSimcarConformity([
      { name: "ATP", shp: polygonZShp(), prjText: SIRGAS_2000_PRJ },
      { name: "AIR", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ, dbf: airDbf },
    ]);
    expect(rows.some((r) => r.tipo === "dimensao_nao_2d" && r.camada === "ATP")).toBe(true);
  });

  it("flags ATP with multiple features", () => {
    const rows = checkSimcarConformity([
      { name: "ATP", shp: polygonShp(3), prjText: SIRGAS_2000_PRJ },
      { name: "AIR", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ, dbf: airDbf },
    ]);
    const atp = rows.filter((r) => r.tipo === "atp_multipla");
    expect(atp).toHaveLength(1);
    expect(atp[0].detalhe).toContain("3");
  });

  it("flags missing mandatory dbf attributes and unknown layer names", () => {
    const rows = checkSimcarConformity([
      { name: "ATP", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ },
      { name: "AIR", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ }, // sem dbf
      { name: "MINHA_CAMADA", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ },
    ]);
    expect(rows.some((r) => r.tipo === "atributo_ausente" && r.camada === "AIR")).toBe(true);
    expect(rows.some((r) => r.tipo === "nomenclatura_desconhecida" && r.camada === "MINHA_CAMADA")).toBe(true);
  });

  it("flags missing mandatory features ATP/AIR", () => {
    const rows = checkSimcarConformity([
      { name: "AVN", shp: polygonShp(1), prjText: SIRGAS_2000_PRJ },
    ]);
    const missing = rows.filter((r) => r.tipo === "feicao_obrigatoria_ausente").map((r) => r.camada);
    expect(missing.sort()).toEqual(["AIR", "ATP"]);
  });
});
