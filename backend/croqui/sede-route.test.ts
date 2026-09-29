import { describe, expect, it } from "vitest";
import type { Polygon, Position } from "geojson";
import { formatDmsPair } from "./coords";
import { buildCroquiNarrative } from "./narrative";
import type { CroquiRoute, RouteWaypoint } from "./routing";
import {
  SEDE_LABEL,
  buildRouteFromEditedLine,
  extendThroughInternalRoad,
  finalizeCroquiRoute,
  markPropertyEntrance,
  simplifyForEditing,
} from "./sede-route";

// Imóvel quadrado de ~2,2 km de lado; a estrada chega pelo oeste.
const imovel: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-52.4, -12.64],
      [-52.38, -12.64],
      [-52.38, -12.62],
      [-52.4, -12.62],
      [-52.4, -12.64],
    ],
  ],
};
const sede = { lon: -52.385, lat: -12.625 };

function wp(lon: number, lat: number, distanceToNextM: number, maneuver: RouteWaypoint["maneuver"], coordIndex: number, roadName = ""): RouteWaypoint {
  return { lon, lat, dms: formatDmsPair(lon, lat), distanceToNextM, maneuver, roadName, coordIndex };
}

function rota(coordinates: Position[], waypoints: RouteWaypoint[]): CroquiRoute {
  return {
    coordinates,
    waypoints,
    totalDistanceM: 0,
    arrivalSide: null,
    geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
  };
}

/** Chega pela MT-109 vindo do oeste, vira à esquerda e para na divisa oeste. */
function rotaAteDivisa(): CroquiRoute {
  const coords: Position[] = [
    [-52.45, -12.65],
    [-52.42, -12.65],
    [-52.42, -12.63],
    [-52.4, -12.63],
  ];
  return rota(coords, [
    wp(-52.45, -12.65, 3260, "depart", 0, "MT-109"),
    wp(-52.42, -12.65, 2210 + 2170, "left", 1),
    wp(-52.4, -12.63, 0, "arrive", 3),
  ]);
}

describe("croqui com sede", () => {
  it("marca a entrada na divisa e junta o trecho interno num ponto só", () => {
    const coords: Position[] = [...rotaAteDivisa().coordinates, [-52.39, -12.63], [-52.39, -12.625], sede.lon !== undefined ? [sede.lon, sede.lat] : [0, 0]];
    const base = rota(coords, [
      wp(-52.45, -12.65, 3260, "depart", 0, "MT-109"),
      wp(-52.42, -12.65, 4380, "left", 1),
      wp(-52.39, -12.63, 500, "right", 4),
      wp(sede.lon, sede.lat, 0, "arrive", coords.length - 1),
    ]);
    const marked = markPropertyEntrance({ ...base, destinationLabel: SEDE_LABEL }, imovel);
    const entradas = marked.waypoints.filter((w) => w.entrance);
    expect(entradas).toHaveLength(1);
    const entrada = entradas[0];
    expect(entrada.lon).toBeCloseTo(-52.4, 5);
    expect(entrada.lat).toBeCloseTo(-12.63, 5);
    // depois da entrada só sobra a sede
    const idx = marked.waypoints.indexOf(entrada);
    expect(marked.waypoints.slice(idx + 1)).toHaveLength(1);
    expect(marked.waypoints[marked.waypoints.length - 1].maneuver).toBe("arrive");
  });

  it("escreve a frase da estrada interna até a sede", () => {
    const final = finalizeCroquiRoute(rotaAteDivisa(), imovel, sede);
    const texto = buildCroquiNarrative({
      municipioNome: "Querência",
      propertyName: "Fazenda Teste",
      landmark: { label: "centro", lon: -52.45, lat: -12.65, fonte: "centroide" },
      route: final,
    });
    expect(texto).toMatch(/, na entrada da propriedade\. Dali, siga pela estrada interna por .+ até a sede da propriedade, localizada no ponto \(.+\)\.$/);
    expect(texto).toContain(formatDmsPair(sede.lon, sede.lat));
    expect(final.coordinates[final.coordinates.length - 1]).toEqual([sede.lon, sede.lat]);
  });

  it("sem sede termina no interior e nunca fala em sede", () => {
    const comRotulo = { ...rotaAteDivisa(), destinationLabel: SEDE_LABEL };
    const final = finalizeCroquiRoute(comRotulo, imovel, null);
    const texto = buildCroquiNarrative({
      municipioNome: "Querência",
      propertyName: "Fazenda Teste",
      landmark: { label: "centro", lon: -52.45, lat: -12.65, fonte: "centroide" },
      route: final,
    });
    expect(texto).not.toMatch(/sede/i);
    expect(texto).toMatch(/onde se encontra a propriedade\.$/);
  });

  it("segue a estrada interna do OSM quando ela anda por dentro e chega perto da sede", async () => {
    const interna: Position[] = [
      [-52.4, -12.63],
      [-52.39, -12.63],
      [-52.39, -12.625],
      [-52.3852, -12.6251],
    ];
    const fake = async () => [{ ...rota(interna, []), totalDistanceM: 2200 }];
    const out = await extendThroughInternalRoad(rotaAteDivisa(), imovel, sede, fake as any);
    expect(out).not.toBeNull();
    expect(out!.coordinates).toEqual(expect.arrayContaining([[-52.39, -12.63], [-52.39, -12.625]]));
    expect(out!.coordinates[out!.coordinates.length - 1]).toEqual([sede.lon, sede.lat]);
    expect(out!.destinationLabel).toBe(SEDE_LABEL);
  });

  it("recusa 'estrada interna' que dá a volta por fora do imóvel", async () => {
    const porFora: Position[] = [
      [-52.4, -12.63],
      [-52.41, -12.61],
      [-52.37, -12.61],
      [-52.385, -12.625],
    ];
    const fake = async () => [{ ...rota(porFora, []), totalDistanceM: 6000 }];
    expect(await extendThroughInternalRoad(rotaAteDivisa(), imovel, sede, fake as any)).toBeNull();
  });
});

describe("caminho editado no site", () => {
  it("passa exatamente pelos vértices e vira curva onde o usuário dobrou", () => {
    const base = rotaAteDivisa();
    // usuário desviou: sobe antes de chegar em -52.42 e entra pelo norte
    const editado: Position[] = [
      [-52.45, -12.65],
      [-52.43, -12.65],
      [-52.43, -12.625],
      [-52.4, -12.625],
    ];
    const route = buildRouteFromEditedLine(editado, base);
    expect(route.coordinates).toEqual(editado);
    expect(route.waypoints[0].maneuver).toBe("depart");
    expect(route.waypoints[0].roadName).toBe("MT-109");
    expect(route.waypoints.some((w) => w.maneuver === "left")).toBe(true);
    expect(route.waypoints[route.waypoints.length - 1].maneuver).toBe("arrive");
    const soma = route.waypoints.reduce((acc, w) => acc + w.distanceToNextM, 0);
    expect(soma).toBeCloseTo(route.totalDistanceM, 0);
  });

  it("recusa caminho com menos de dois pontos", () => {
    expect(() => buildRouteFromEditedLine([[-52.4, -12.6]], null)).toThrow(/dois pontos/);
  });

  it("simplifica o traçado sem perder a forma", () => {
    const reta: Position[] = Array.from({ length: 1000 }, (_, i) => [-52.4 + i * 0.00001, -12.6]);
    const out = simplifyForEditing(reta);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual([-52.4, -12.6]);
  });
});
