import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";
import { cobreImovel, daysFromTarget, pickBest, scoreCandidate, seasonWindow, toSceneRef, type NdviCandidate } from "./scene-select";

const IMOVEL: Geometry = {
  type: "Polygon",
  coordinates: [[[-52.30, -12.62], [-52.22, -12.62], [-52.22, -12.55], [-52.30, -12.55], [-52.30, -12.62]]],
};

/** Footprint largo, cobrindo o imóvel com folga (como uma cena Landsat real). */
const CENA_COBRE: Geometry = {
  type: "Polygon",
  coordinates: [[[-53.5, -13.5], [-51.0, -13.5], [-51.0, -11.5], [-53.5, -11.5], [-53.5, -13.5]]],
};

/** Footprint deslocado: pega só um pedaço do imóvel. */
const CENA_PARCIAL: Geometry = {
  type: "Polygon",
  coordinates: [[[-52.26, -13.5], [-51.0, -13.5], [-51.0, -11.5], [-52.26, -11.5], [-52.26, -13.5]]],
};

function candidato(over: Partial<NdviCandidate> = {}): Omit<NdviCandidate, "score"> {
  return {
    itemId: "LT05_L2SP_224069_20080720_02_T1",
    item: {},
    platform: "LANDSAT_5",
    acquiredAt: "2008-07-20",
    cloudCoverPct: 5,
    path: "224",
    row: "069",
    slcOff: false,
    cobreImovel: true,
    ...over,
  } as Omit<NdviCandidate, "score">;
}

const comScore = (over: Partial<NdviCandidate> = {}): NdviCandidate => {
  const base = candidato(over);
  return { ...base, score: scoreCandidate(base) } as NdviCandidate;
};

describe("janela sazonal", () => {
  it("cobre o miolo da seca em MT", () => {
    expect(seasonWindow(2008)).toEqual({ start: "2008-06-01", end: "2008-09-30" });
  });
});

describe("distância do marco de 22/07", () => {
  it("zero no próprio dia", () => {
    expect(daysFromTarget("2008-07-22")).toBe(0);
  });
  it("conta dias para os dois lados", () => {
    expect(daysFromTarget("2008-07-20")).toBeCloseTo(2, 0);
    expect(daysFromTarget("2008-08-21")).toBeCloseTo(30, 0);
  });
  it("data inválida vai para o fim da fila", () => {
    expect(daysFromTarget("nao-e-data")).toBe(9999);
  });
});

describe("cobertura do imóvel", () => {
  it("footprint largo cobre", () => {
    expect(cobreImovel(CENA_COBRE, IMOVEL)).toBe(true);
  });
  it("footprint deslocado não cobre", () => {
    expect(cobreImovel(CENA_PARCIAL, IMOVEL)).toBe(false);
  });
  it("sem footprint não cobre", () => {
    expect(cobreImovel(null, IMOVEL)).toBe(false);
  });
});

describe("ranqueamento", () => {
  it("menos nuvem ganha", () => {
    const limpa = scoreCandidate(candidato({ cloudCoverPct: 0 }));
    const nublada = scoreCandidate(candidato({ cloudCoverPct: 40 }));
    expect(limpa).toBeLessThan(nublada);
  });

  it("cena que não cobre o imóvel perde de qualquer cena que cobre", () => {
    const cobreRuim = scoreCandidate(candidato({ cloudCoverPct: 39, cobreImovel: true }));
    const naoCobreOtima = scoreCandidate(candidato({ cloudCoverPct: 0, cobreImovel: false }));
    expect(cobreRuim).toBeLessThan(naoCobreOtima);
  });

  it("Landsat 7 SLC-off perde de qualquer sensor íntegro razoável", () => {
    // caso real medido: LE07 20080930 tem 3% de nuvem, LT05 20080906 tem 13%.
    // O SLC-off tem que perder mesmo com muito menos nuvem.
    const l7 = scoreCandidate(
      candidato({ platform: "LANDSAT_7", slcOff: true, cloudCoverPct: 3, acquiredAt: "2008-09-30" }),
    );
    const l5 = scoreCandidate(
      candidato({ platform: "LANDSAT_5", slcOff: false, cloudCoverPct: 13, acquiredAt: "2008-09-06" }),
    );
    expect(l5).toBeLessThan(l7);
  });

  it("empatada a nuvem, ganha a mais perto de 22/07", () => {
    const perto = scoreCandidate(candidato({ acquiredAt: "2008-07-20" }));
    const longe = scoreCandidate(candidato({ acquiredAt: "2008-09-28" }));
    expect(perto).toBeLessThan(longe);
  });

  it("cena real de 21/08 com 0% ganha da de 06/09 com 13% — caso medido no STAC", () => {
    const a = scoreCandidate(candidato({ acquiredAt: "2008-08-21", cloudCoverPct: 0 }));
    const b = scoreCandidate(candidato({ acquiredAt: "2008-09-06", cloudCoverPct: 13 }));
    expect(a).toBeLessThan(b);
  });

  it("nuvem desconhecida é penalizada, mas não descartada", () => {
    const semInfo = scoreCandidate(candidato({ cloudCoverPct: null }));
    const limpa = scoreCandidate(candidato({ cloudCoverPct: 0 }));
    expect(semInfo).toBeGreaterThan(limpa);
    expect(semInfo).toBeLessThan(1000);
  });
});

describe("escolha final", () => {
  it("descarta acima do teto de nuvem", () => {
    const escolhida = pickBest([
      comScore({ cloudCoverPct: 80, acquiredAt: "2008-07-22" }),
      comScore({ cloudCoverPct: 10, acquiredAt: "2008-08-15" }),
    ]);
    expect(escolhida.cloudCoverPct).toBe(10);
  });

  it("se TODAS passam do teto, ainda devolve a melhor — com o aviso vindo do validPct", () => {
    const escolhida = pickBest([
      comScore({ cloudCoverPct: 90 }),
      comScore({ cloudCoverPct: 60 }),
    ]);
    expect(escolhida.cloudCoverPct).toBe(60);
  });

  it("lista vazia falha declarando, nunca estimando", () => {
    expect(() => pickBest([])).toThrowError(/sem cena|NIR/i);
  });
});

describe("referência da cena para o laudo", () => {
  it("declara tudo que o laudo precisa citar sobre a origem", () => {
    const ref = toSceneRef(comScore());
    expect(ref.platformLabel).toBe("Landsat 5 TM");
    expect(ref.path).toBe("224");
    expect(ref.row).toBe("069");
    expect(ref.acquiredAt).toBe("2008-07-20");
    expect(ref.year).toBe(2008);
    expect(ref.collection).toContain("landsat-c2");
    expect(ref.coberturaParcial).toBe(false);
    expect(ref.sensorDegradado).toBe(false);
  });

  it("marca cobertura parcial e sensor degradado", () => {
    const ref = toSceneRef(comScore({ cobreImovel: false, slcOff: true, platform: "LANDSAT_7" }));
    expect(ref.coberturaParcial).toBe(true);
    expect(ref.sensorDegradado).toBe(true);
  });
});
