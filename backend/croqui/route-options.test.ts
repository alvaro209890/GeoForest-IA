import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { formatDmsPair } from "./coords";
import {
  cardinalOf,
  decimateCoordinates,
  deviationSide,
  labelForOption,
  mostDistinctivePoint,
  perpendicularViaPoints,
  routeOverlapRatio,
  stripOutAndBackSpurs,
  summarizeRoads,
} from "./route-options";
import type { CroquiRoute, RouteWaypoint } from "./routing";

/** Linha reta oeste→leste com `n` pontos, usada como rota de referência. */
function linhaLeste(n: number, lat = -12.5, lon0 = -52.3, lon1 = -52.1): Position[] {
  const out: Position[] = [];
  for (let i = 0; i < n; i++) out.push([lon0 + ((lon1 - lon0) * i) / (n - 1), lat]);
  return out;
}

function waypoint(roadName: string): RouteWaypoint {
  return {
    lon: -52.2,
    lat: -12.5,
    dms: formatDmsPair(-52.2, -12.5),
    distanceToNextM: 1000,
    maneuver: "straight",
    roadName,
    coordIndex: 0,
  };
}

describe("route-options — comparação de traçados", () => {
  it("dá sobreposição total para a mesma rota", () => {
    const linha = linhaLeste(50);
    expect(routeOverlapRatio(linha, linha)).toBe(1);
  });

  it("dá sobreposição baixa para corredores afastados", () => {
    const a = linhaLeste(50, -12.5);
    const b = linhaLeste(50, -12.9);
    expect(routeOverlapRatio(a, b)).toBeLessThan(0.1);
  });

  it("ignora traçados vazios", () => {
    expect(routeOverlapRatio([], linhaLeste(10))).toBe(0);
  });
});

describe("route-options — vai-e-volta", () => {
  it("remove o desvio que sai e retorna pelo mesmo lugar", () => {
    const principal = linhaLeste(40);
    const spurIda: Position[] = [];
    for (let i = 1; i <= 20; i++) spurIda.push([-52.2, -12.5 - i * 0.005]);
    const spurVolta = [...spurIda].reverse();
    const comSpur = [
      ...principal.slice(0, 20),
      ...spurIda,
      ...spurVolta,
      ...principal.slice(20),
    ];
    const limpo = stripOutAndBackSpurs(comSpur);
    expect(limpo.length).toBeLessThan(comSpur.length);
    expect(routeOverlapRatio(limpo, principal)).toBeGreaterThan(0.9);
  });

  it("não mexe numa rota que já é limpa", () => {
    const linha = linhaLeste(60);
    expect(stripOutAndBackSpurs(linha)).toHaveLength(linha.length);
  });

  it("preserva pontas de rota curtas demais para serem desvio", () => {
    const curta: Position[] = [
      [-52.2, -12.5],
      [-52.2001, -12.5],
      [-52.2, -12.5],
    ];
    expect(stripOutAndBackSpurs(curta)).toHaveLength(curta.length);
  });
});

describe("route-options — pontos de passagem", () => {
  it("joga candidatos para os dois lados da rota", () => {
    const linha = linhaLeste(30);
    const vias = perpendicularViaPoints(linha, [0.5], [10, -10]);
    expect(vias).toHaveLength(2);
    const [norte, sul] = vias[0][1] > vias[1][1] ? vias : [vias[1], vias[0]];
    expect(norte[1]).toBeGreaterThan(-12.5);
    expect(sul[1]).toBeLessThan(-12.5);
  });

  it("devolve vazio sem rota de referência", () => {
    expect(perpendicularViaPoints([], [0.5], [10])).toHaveLength(0);
    expect(perpendicularViaPoints([[-52, -12]], [0.5], [10])).toHaveLength(0);
  });
});

describe("route-options — identificação do corredor", () => {
  it("acha o ponto mais afastado da referência", () => {
    const referencia = linhaLeste(30);
    const desvio: Position[] = [
      [-52.3, -12.5],
      [-52.25, -12.6],
      [-52.2, -12.7],
      [-52.15, -12.6],
      [-52.1, -12.5],
    ];
    const ponto = mostDistinctivePoint(desvio, referencia);
    expect(ponto?.position[1]).toBeCloseTo(-12.7, 3);
    expect(ponto?.distanceKm).toBeGreaterThan(15);
  });

  it("nomeia o lado do desvio", () => {
    const referencia = linhaLeste(30);
    const paraSul: Position[] = [
      [-52.3, -12.5],
      [-52.2, -12.8],
      [-52.1, -12.5],
    ];
    expect(deviationSide(paraSul, referencia)).toBe("sul");
  });

  it("não nomeia lado quando o desvio é insignificante", () => {
    const referencia = linhaLeste(30);
    expect(deviationSide(linhaLeste(30, -12.5005), referencia)).toBeNull();
  });

  it("converte azimute em ponto cardeal", () => {
    expect(cardinalOf(0)).toBe("norte");
    expect(cardinalOf(90)).toBe("leste");
    expect(cardinalOf(180)).toBe("sul");
    expect(cardinalOf(270)).toBe("oeste");
    expect(cardinalOf(-90)).toBe("oeste");
    expect(cardinalOf(359)).toBe("norte");
  });
});

describe("route-options — rótulos e resumo", () => {
  it("nomeia a rota principal pela distância", () => {
    expect(labelForOption(0, null, 29400)).toBe("Caminho principal — 29,4 km");
  });

  it("nomeia alternativas pelo lado e desempata com ordinal", () => {
    expect(labelForOption(1, "leste", 33400)).toBe("Caminho pelo leste — 33,4 km");
    expect(labelForOption(2, "leste", 35000, 2)).toBe("Caminho pelo leste (2) — 35,0 km");
    expect(labelForOption(1, null, 40000)).toBe("Caminho alternativo 2 — 40,0 km");
  });

  it("lista as vias sem repetir e sem placeholder", () => {
    const route = {
      waypoints: [waypoint("MT-243"), waypoint("MT-243"), waypoint("-"), waypoint("Estrada R10")],
    } as CroquiRoute;
    expect(summarizeRoads(route)).toEqual(["MT-243", "Estrada R10"]);
  });
});

describe("route-options — traçado leve para o mapinha", () => {
  it("reduz o número de pontos e mantém as pontas", () => {
    const linha = linhaLeste(1000);
    const leve = decimateCoordinates(linha, 100);
    expect(leve.length).toBeLessThanOrEqual(101);
    expect(leve[0]).toEqual([-52.3, -12.5]);
    expect(leve[leve.length - 1]).toEqual([-52.1, -12.5]);
  });

  it("mantém traçados curtos intactos, só arredondados", () => {
    const linha: Position[] = [
      [-52.1234567, -12.1234567],
      [-52.2, -12.2],
    ];
    expect(decimateCoordinates(linha, 160)).toEqual([
      [-52.123457, -12.123457],
      [-52.2, -12.2],
    ]);
  });
});
