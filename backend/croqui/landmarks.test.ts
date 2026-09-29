import { describe, expect, it } from "vitest";
import { findSedeMunicipal, listarMunicipiosMt, resolveLandmark } from "./landmarks";

describe("croqui landmarks e municípios de partida", () => {
  it("lista os 142 municípios de MT ordenados em ordem alfabética", () => {
    const lista = listarMunicipiosMt();
    expect(lista.length).toBeGreaterThanOrEqual(140);
    expect(lista[0].nome).toBe("Acorizal");
    expect(lista.some((m) => m.nome === "Canarana")).toBe(true);
    expect(lista.some((m) => m.nome === "Querência")).toBe(true);
  });

  it("encontra sede municipal por IBGE e por nome (com e sem acento)", () => {
    const canarana = findSedeMunicipal("Canarana");
    expect(canarana).not.toBeNull();
    expect(canarana?.ibge).toBe("5102702");
    expect(canarana?.nome).toBe("Canarana");
    expect(Number.isFinite(canarana?.lon)).toBe(true);
    expect(Number.isFinite(canarana?.lat)).toBe(true);

    const querenciaComAcento = findSedeMunicipal("Querência");
    const querenciaSemAcento = findSedeMunicipal("Querencia");
    expect(querenciaComAcento?.ibge).toBe("5107065");
    expect(querenciaSemAcento?.ibge).toBe("5107065");

    const porIbge = findSedeMunicipal("5100201");
    expect(porIbge?.nome).toBe("Água Boa");
  });

  it("resolve landmark a partir do nome do município", () => {
    const lmCanarana = resolveLandmark("Canarana", null);
    expect(lmCanarana.fonte).toBe("sede-ibge");
    expect(lmCanarana.label).toContain("Canarana");
    expect(lmCanarana.introSuffix).toContain("Canarana");
    expect(Number.isFinite(lmCanarana.lon)).toBe(true);
    expect(Number.isFinite(lmCanarana.lat)).toBe(true);

    const lmQuerencia = resolveLandmark("Querência", null);
    expect(lmQuerencia.fonte).toBe("curado");
    expect(lmQuerencia.label).toContain("rotatória");

    const lmAguaBoa = resolveLandmark("Água Boa", null);
    expect(lmAguaBoa.fonte).toBe("sede-ibge");
    expect(lmAguaBoa.label).toContain("Água Boa");

    const lmSinop = resolveLandmark("Sinop", "5107909");
    expect(lmSinop.fonte).toBe("sede-ibge");
    expect(lmSinop.label).toContain("Sinop");
  });
});
