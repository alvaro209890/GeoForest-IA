import { describe, expect, it } from "vitest";
import { esriRingsToGeometry, formatCpfCnpj, normalizeDate } from "./sources";
import { IMAP_LAYERS } from "./constants";

describe("normalizeDate", () => {
  it("aceita epoch em milissegundos (PAMGIA e WFS da IMAP)", () => {
    // 31/05/2012, data do embargo do Lote 124 usado como referência.
    expect(normalizeDate(1338422400000)).toEqual({ iso: "2012-05-31", ano: "2012" });
  });

  it("aceita dd/mm/aaaa (campo DAT_LAVRAT das camadas SEMA)", () => {
    expect(normalizeDate("13/05/2021")).toEqual({ iso: "2021-05-13", ano: "2021" });
  });

  it("aceita ISO com fuso (campo DATA_DO_AU das camadas SIGA)", () => {
    expect(normalizeDate("2023-02-08T03:00:00Z")).toEqual({ iso: "2023-02-08", ano: "2023" });
  });

  it("aceita só o ano (campo ANO_DESMAT)", () => {
    expect(normalizeDate("2016")).toEqual({ iso: "", ano: "2016" });
  });

  it("devolve vazio para nulo ou lixo", () => {
    expect(normalizeDate(null)).toEqual({ iso: "", ano: "" });
    expect(normalizeDate("sem data")).toEqual({ iso: "", ano: "" });
  });
});

describe("formatCpfCnpj", () => {
  it("formata CPF de 11 dígitos", () => {
    expect(formatCpfCnpj("02935669177")).toBe("029.356.691-77");
  });

  it("formata CNPJ de 14 dígitos", () => {
    expect(formatCpfCnpj("15310155000100")).toBe("15.310.155/0001-00");
  });

  it("mantém o que já vem formatado", () => {
    expect(formatCpfCnpj("041.097.229-00")).toBe("041.097.229-00");
  });

  it("não inventa máscara para valor de tamanho inesperado", () => {
    expect(formatCpfCnpj("...")).toBe("...");
    expect(formatCpfCnpj("")).toBe("");
  });
});

describe("esriRingsToGeometry", () => {
  const quadrado = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  it("um anel vira Polygon", () => {
    expect(esriRingsToGeometry([quadrado])).toEqual({
      type: "Polygon",
      coordinates: [quadrado],
    });
  });

  it("vários anéis viram MultiPolygon", () => {
    const geom = esriRingsToGeometry([quadrado, quadrado]);
    expect(geom?.type).toBe("MultiPolygon");
    expect((geom as any).coordinates).toHaveLength(2);
  });

  it("descarta anel degenerado", () => {
    expect(esriRingsToGeometry([[[0, 0], [1, 1]]])).toBeNull();
    expect(esriRingsToGeometry([])).toBeNull();
    expect(esriRingsToGeometry(null)).toBeNull();
  });
});

describe("catálogo de camadas da IMAP", () => {
  it("cobre as 8 camadas de fiscalização, divididas entre SEMA e SIGA", () => {
    expect(IMAP_LAYERS).toHaveLength(8);
    expect(IMAP_LAYERS.filter((l) => l.source === "sema")).toHaveLength(3);
    expect(IMAP_LAYERS.filter((l) => l.source === "siga")).toHaveLength(5);
  });

  it("toda camada declara de onde tira nome, CPF e data", () => {
    for (const layer of IMAP_LAYERS) {
      expect(layer.fieldNome.length, layer.name).toBeGreaterThan(0);
      expect(layer.fieldCpf.length, layer.name).toBeGreaterThan(0);
      expect(layer.fieldData.length, layer.name).toBeGreaterThan(0);
    }
  });
});
