import { describe, expect, it } from "vitest";
import { bearingDegrees, formatDmsPair, sentidoCardeal } from "./coords";
import type { CroquiLandmark } from "./landmarks";
import { buildCroquiDocxParagraphs, buildCroquiNarrative } from "./narrative";
import type { CroquiRoute, ManeuverKind, RouteWaypoint } from "./routing";

function waypoint(
  lon: number,
  lat: number,
  distanceToNextM: number,
  maneuver: ManeuverKind,
  roadName = "",
): RouteWaypoint {
  return {
    lon,
    lat,
    dms: formatDmsPair(lon, lat),
    distanceToNextM,
    maneuver,
    roadName,
    coordIndex: 0,
  };
}

function route(waypoints: RouteWaypoint[], arrivalSide: CroquiRoute["arrivalSide"]): CroquiRoute {
  const coordinates = waypoints.map((w) => [w.lon, w.lat]);
  return {
    coordinates,
    waypoints,
    totalDistanceM: waypoints.reduce((acc, w) => acc + w.distanceToNextM, 0),
    arrivalSide,
    geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
  };
}

const sedeLandmark: CroquiLandmark = {
  label: "sede de Querência",
  lon: -52.2196222,
  lat: -12.5900389,
  fonte: "sede-ibge",
  introSuffix: "na sede do município de Querência",
};

describe("croqui coords", () => {
  it("calcula o bearing entre dois pontos", () => {
    expect(bearingDegrees(-52.21958333, -12.59903056, -52.21955833, -12.60881111)).toBeGreaterThan(
      170,
    );
    expect(bearingDegrees(-52.21958333, -12.59903056, -52.21955833, -12.60881111)).toBeLessThan(190);
  });

  it("converte bearing em ponto cardeal (8 direções)", () => {
    expect(sentidoCardeal(-52.21958333, -12.59903056, -52.21955833, -12.60881111)).toBe("sul");
    expect(sentidoCardeal(-52.2, -12.6, -52.19, -12.6)).toBe("leste");
    expect(sentidoCardeal(-52.2, -12.6, -52.21, -12.6)).toBe("oeste");
    expect(sentidoCardeal(-52.2, -12.6, -52.2, -12.59)).toBe("norte");
  });
});

describe("croqui narrative", () => {
  it("reproduz o roteiro do croqui modelo Fazenda Irmãos Sebald", () => {
    // Croquis/Fazenda Irmaos Sebald-lote 121B.pdf
    const texto = buildCroquiNarrative({
      municipioNome: "Querência",
      propertyName: "Fazenda Irmãos Sebald",
      landmark: sedeLandmark,
      route: route(
        [
          waypoint(-52.21958333, -12.59903056, 1100, "depart", "MT-243"),
          waypoint(-52.21955833, -12.60881111, 5100, "right"),
          waypoint(-52.255225, -12.62880278, 0, "arrive"),
        ],
        "esquerda",
      ),
    });

    expect(texto).toBe(
      `O presente croqui se inicia na cidade Querência no ponto (12°35'56.51"S, 52°13'10.50"O) ` +
        `seguindo pela MT-243 no sentido sul. ` +
        `Siga em frente por 1,1 km até o ponto (12°36'31.72"S, 52°13'10.41"O). ` +
        `Vire à direita e siga por 5,1 km até o ponto (12°37'43.69"S, 52°15'18.81"O). ` +
        `O destino estará à esquerda.`,
    );
  });

  it("casa a distância de cada trecho com o DMS do ponto de chegada", () => {
    // O texto antigo repetia o DMS do ponto de partida do trecho.
    const wps = [
      waypoint(-51.8, -12.9, 13300, "depart", "BR-158"),
      waypoint(-51.7, -12.95, 23700, "right"),
      waypoint(-51.6, -13.08, 0, "arrive"),
    ];
    const texto = buildCroquiNarrative({
      municipioNome: "Ribeirão Cascalheira",
      propertyName: "Fazenda Aruanã I",
      landmark: sedeLandmark,
      route: route(wps, null),
    });
    expect(texto).toContain(`por 13,3 km até o ponto ${wps[1].dms}`);
    expect(texto).toContain(`por 23,7 km até o ponto ${wps[2].dms}`);
    expect(texto).not.toContain(`por 13,3 km até o ponto ${wps[0].dms}`);
  });

  it("fecha com 'onde se encontra a propriedade' quando o OSRM não informa o lado", () => {
    const texto = buildCroquiNarrative({
      municipioNome: "Ribeirão Cascalheira",
      propertyName: "Fazenda Aruanã I",
      landmark: sedeLandmark,
      route: route(
        [
          waypoint(-51.8, -12.9, 706, "depart", "MT-242"),
          waypoint(-51.7, -12.95, 0, "arrive"),
        ],
        null,
      ),
    });
    expect(texto).toMatch(/, onde se encontra a propriedade\.$/);
    expect(texto).not.toContain("O destino estará");
  });

  it("fecha na sede da propriedade quando a rota termina nela", () => {
    const rota = route(
      [
        waypoint(-51.8, -12.9, 706, "depart", "MT-242"),
        waypoint(-51.7, -12.95, 0, "arrive"),
      ],
      null,
    );
    const texto = buildCroquiNarrative({
      municipioNome: "Ribeirão Cascalheira",
      propertyName: "Fazenda Aruanã I",
      landmark: sedeLandmark,
      route: { ...rota, destinationLabel: "sede da propriedade" },
    });
    expect(texto).toMatch(/, onde se encontra a sede da propriedade\.$/);
    expect(texto).not.toContain("O destino estará");
  });

  it("inicia com o template fixo de abertura com cidade, ponto, via e sentido", () => {
    const texto = buildCroquiNarrative({
      municipioNome: "Querência",
      propertyName: "Fazenda Teste",
      landmark: sedeLandmark,
      route: route(
        [
          waypoint(-52.2, -12.6, 3000, "depart", "MT-242"),
          waypoint(-52.21, -12.61, 0, "arrive"),
        ],
        null,
      ),
    });
    expect(texto).toMatch(
      /^O presente croqui se inicia na cidade Querência no ponto \(.+\) seguindo pela MT-242 no sentido sudoeste\./,
    );
    expect(texto).toContain("Siga em frente por 3 km");
    expect(texto).not.toContain("pela MT-242 por");
  });

  it("usa o landmark curado como referência quando a rota não traz via", () => {
    const curado: CroquiLandmark = {
      label: "rotatória entre a Av. Norte e a MT-109",
      lon: -52.2196222,
      lat: -12.5900389,
      fonte: "curado",
      introSuffix: "na rotatória entre a Av. Norte e a MT-109",
    };
    const texto = buildCroquiNarrative({
      municipioNome: "Querência",
      propertyName: "Chacará 02",
      landmark: curado,
      route: route(
        [
          waypoint(-52.2, -12.6, 3000, "depart", ""),
          waypoint(-52.21, -12.61, 600, "left", "MT-243"),
          waypoint(-52.22, -12.62, 0, "arrive"),
        ],
        null,
      ),
    });
    expect(texto).toMatch(
      /^O presente croqui se inicia na cidade Querência no ponto \(.+\) seguindo na rotatória entre a Av\. Norte e a MT-109/,
    );
    expect(texto).toContain("Siga em frente por 3 km");
    expect(texto).toContain("Vire à esquerda e siga em frente pela MT-243 por 600 m");
  });

  it("cai para o município quando não há via nem landmark curado", () => {
    const texto = buildCroquiNarrative({
      municipioNome: "Ribeirão Cascalheira",
      propertyName: "Fazenda Aruanã I",
      landmark: { label: "centro", lon: -51.7, lat: -12.8, fonte: "centroide" },
      route: route(
        [waypoint(-51.7, -12.8, 5000, "depart"), waypoint(-51.6, -12.9, 0, "arrive")],
        null,
      ),
    });
    expect(texto).toMatch(
      /^O presente croqui se inicia na cidade Ribeirão Cascalheira no ponto \(.+\) seguindo no município de Ribeirão Cascalheira/,
    );
  });

  it("gera o DOCX como parágrafo único", () => {
    expect(buildCroquiDocxParagraphs("Uma frase.  Outra frase.")).toEqual([
      "Uma frase. Outra frase.",
    ]);
  });
});
