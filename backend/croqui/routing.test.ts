import { describe, expect, it } from "vitest";
import {
  booleanPointInPolygon,
  length as turfLength,
  lineString,
  point,
} from "@turf/turf";
import type { Polygon } from "geojson";
import { formatDmsPair } from "./coords";
import {
  classifyManeuver,
  destinationOnPolygonBoundary,
  ensureRouteEndsInsidePolygon,
  ensureRouteReachesPolygon,
  extendRouteToInsidePoint,
  extendRouteToPolygon,
  interiorDestination,
  primaryRoadRef,
  resolveRoadLabel,
  simplifyRouteSteps,
  trimRouteAtPolygon,
} from "./routing";
import type { CroquiRoute, ManeuverKind, RouteWaypoint } from "./routing";

function waypoint(
  lon: number,
  lat: number,
  distanceToNextM: number,
  maneuver: ManeuverKind,
  roadName = "",
  coordIndex = 0,
): RouteWaypoint {
  return {
    lon,
    lat,
    dms: formatDmsPair(lon, lat),
    distanceToNextM,
    maneuver,
    roadName,
    coordIndex,
  };
}

describe("croqui routing", () => {
  it("usa a primeira sigla quando o OSRM devolve várias", () => {
    expect(primaryRoadRef("BR-158 | BR-242")).toBe("BR-158");
    expect(primaryRoadRef("BR-158; BR-242")).toBe("BR-158");
    expect(primaryRoadRef("")).toBe("");
    expect(primaryRoadRef(undefined)).toBe("");
  });

  it("cai para a sigla da rodovia quando a via não tem nome", () => {
    // No rural de MT o OSRM devolve name vazio e ref preenchido.
    expect(resolveRoadLabel("", "BR-158 | BR-242")).toBe("BR-158");
    expect(resolveRoadLabel("Avenida Padre João Bosco", "BR-158")).toBe(
      "Avenida Padre João Bosco",
    );
    expect(resolveRoadLabel("-", "MT-020")).toBe("MT-020");
    expect(resolveRoadLabel("", "")).toBe("");
  });

  it("classifica as manobras do OSRM", () => {
    expect(classifyManeuver("depart", undefined)).toBe("depart");
    expect(classifyManeuver("arrive", "left")).toBe("arrive");
    expect(classifyManeuver("turn", "left")).toBe("left");
    expect(classifyManeuver("turn", "sharp right")).toBe("right");
    expect(classifyManeuver("continue", "straight")).toBe("straight");
    expect(classifyManeuver("roundabout", undefined)).toBe("roundabout");
    expect(classifyManeuver("fork", "slight left")).toBe("fork");
    expect(classifyManeuver("merge", "slight right")).toBe("merge");
  });

  it("funde trechos curtos e continuações na mesma via", () => {
    const simplificado = simplifyRouteSteps(
      [
        waypoint(-52.2, -12.6, 1200, "depart", "MT-242"),
        waypoint(-52.21, -12.61, 800, "straight", "MT-242"),
        waypoint(-52.22, -12.62, 150, "right", "Rua A"),
        waypoint(-52.23, -12.63, 4000, "left", "MT-243"),
        waypoint(-52.24, -12.64, 0, "arrive"),
      ],
      300,
    );

    // MT-242 vira um trecho só; a Rua A de 150 m é absorvida pela curva seguinte.
    expect(simplificado.map((w) => w.maneuver)).toEqual(["depart", "right", "arrive"]);
    expect(simplificado[0].distanceToNextM).toBe(2000);
    expect(simplificado[1].distanceToNextM).toBe(4150);
    // O total percorrido não muda.
    const antes = 1200 + 800 + 150 + 4000;
    expect(simplificado.reduce((acc, w) => acc + w.distanceToNextM, 0)).toBe(antes);
  });

  it("preserva o último ponto mesmo com trecho curto", () => {
    const simplificado = simplifyRouteSteps(
      [
        waypoint(-52.2, -12.6, 50, "depart", "MT-242"),
        waypoint(-52.21, -12.61, 0, "arrive"),
      ],
      300,
    );
    expect(simplificado).toHaveLength(2);
    expect(simplificado[1].maneuver).toBe("arrive");
  });

  it("corta a rota onde ela cruza a divisa do imóvel", () => {
    const quadrado: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-52.0, -12.0],
          [-51.9, -12.0],
          [-51.9, -11.9],
          [-52.0, -11.9],
          [-52.0, -12.0],
        ],
      ],
    };
    const coordinates = [
      [-52.2, -11.95],
      [-52.1, -11.95],
      [-51.95, -11.95], // já dentro do quadrado
    ];
    const rota: CroquiRoute = {
      coordinates,
      waypoints: [
        waypoint(-52.2, -11.95, 20000, "depart", "MT-242", 0),
        waypoint(-51.95, -11.95, 0, "arrive", "", 2),
      ],
      totalDistanceM: 20000,
      arrivalSide: null,
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };

    const { route, trimmed } = trimRouteAtPolygon(rota, quadrado);
    expect(trimmed).toBe(true);
    const fim = route.coordinates[route.coordinates.length - 1];
    expect(fim[0]).toBeCloseTo(-52.0, 6); // exatamente na divisa oeste
    expect(route.waypoints[route.waypoints.length - 1].maneuver).toBe("arrive");
    expect(route.waypoints[route.waypoints.length - 1].dms).toBe(formatDmsPair(fim[0], fim[1]));
    // O total passa a vir da geometria cortada, não do valor que veio do OSRM.
    expect(route.totalDistanceM).toBeLessThan(
      turfLength(lineString(coordinates), { units: "meters" }),
    );
    expect(route.totalDistanceM).toBeCloseTo(
      turfLength(lineString(route.coordinates), { units: "meters" }),
      6,
    );
  });

  it("devolve a rota intacta quando ela não entra no imóvel", () => {
    const quadrado: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-52.0, -12.0],
          [-51.9, -12.0],
          [-51.9, -11.9],
          [-52.0, -11.9],
          [-52.0, -12.0],
        ],
      ],
    };
    const coordinates = [
      [-52.3, -11.95],
      [-52.2, -11.95],
    ];
    const rota: CroquiRoute = {
      coordinates,
      waypoints: [
        waypoint(-52.3, -11.95, 10000, "depart", "", 0),
        waypoint(-52.2, -11.95, 0, "arrive", "", 1),
      ],
      totalDistanceM: 10000,
      arrivalSide: null,
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };
    const { route, trimmed } = trimRouteAtPolygon(rota, quadrado);
    expect(trimmed).toBe(false);
    expect(route).toBe(rota);
  });

  it("completa o caminho até a divisa quando o OSRM para longe do imóvel", () => {
    // Caso Estância MDM: via mapeada acaba ~1,9 km ao norte da ATP.
    const propriedade: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-51.8255, -13.0377],
          [-51.8127, -13.0377],
          [-51.8127, -13.0214],
          [-51.8255, -13.0214],
          [-51.8255, -13.0377],
        ],
      ],
    };
    const coordinates = [
      [-51.824578, -12.936782],
      [-51.80353, -13.010433],
    ];
    const rota: CroquiRoute = {
      coordinates,
      waypoints: [
        waypoint(-51.824578, -12.936782, 9718, "depart", "Avenida Padre João Bosco", 0),
        waypoint(-51.80353, -13.010433, 0, "arrive", "", 1),
      ],
      totalDistanceM: 9718,
      arrivalSide: "direita",
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };

    const { route, extended, gapM } = extendRouteToPolygon(rota, propriedade);
    expect(extended).toBe(true);
    expect(gapM).toBeGreaterThan(1000);
    const fim = route.coordinates[route.coordinates.length - 1];
    expect(fim[1]).toBeCloseTo(-13.0214, 3); // divisa norte
    expect(route.waypoints[route.waypoints.length - 1].maneuver).toBe("arrive");
    expect(route.totalDistanceM).toBeGreaterThan(rota.totalDistanceM);
    expect(route.arrivalSide).toBeNull();

    const ensured = ensureRouteReachesPolygon(rota, propriedade);
    expect(ensured.coordinates).toHaveLength(3);
    const gate = ensured.coordinates[ensured.coordinates.length - 1];
    expect(gate[1]).toBeCloseTo(-13.0214, 3);
  });

  it("não inventa trecho quando o fim já está na divisa", () => {
    const quadrado: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-52.0, -12.0],
          [-51.9, -12.0],
          [-51.9, -11.9],
          [-52.0, -11.9],
          [-52.0, -12.0],
        ],
      ],
    };
    const coordinates = [
      [-52.2, -11.95],
      [-52.0, -11.95],
    ];
    const rota: CroquiRoute = {
      coordinates,
      waypoints: [
        waypoint(-52.2, -11.95, 20000, "depart", "MT-242", 0),
        waypoint(-52.0, -11.95, 0, "arrive", "", 1),
      ],
      totalDistanceM: 20000,
      arrivalSide: null,
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };
    const { extended, gapM } = extendRouteToPolygon(rota, quadrado);
    expect(extended).toBe(false);
    expect(gapM).toBeLessThan(80);
  });

  it("encontra o ponto da divisa mais próximo como destino de fallback", () => {
    const quadrado: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-52.0, -12.0],
          [-51.9, -12.0],
          [-51.9, -11.9],
          [-52.0, -11.9],
          [-52.0, -12.0],
        ],
      ],
    };
    const destino = destinationOnPolygonBoundary(quadrado, -52.2, -11.95);
    // Tolerância de ~10 m: o turf interpola o ponto mais próximo sobre a esfera.
    expect(destino.lon).toBeCloseTo(-52.0, 4);
    expect(destino.lat).toBeCloseTo(-11.95, 3);
  });

  const quadrado: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [-52.0, -12.0],
        [-51.9, -12.0],
        [-51.9, -11.9],
        [-52.0, -11.9],
        [-52.0, -12.0],
      ],
    ],
  };

  function rotaQueTerminaNaDivisa(): CroquiRoute {
    const coordinates = [
      [-52.2, -11.95],
      [-52.1, -11.95],
      [-52.0, -11.95], // porteira: exatamente na divisa oeste
    ];
    return {
      coordinates,
      waypoints: [
        waypoint(-52.2, -11.95, 20000, "depart", "MT-242", 0),
        waypoint(-52.0, -11.95, 0, "arrive", "", 2),
      ],
      totalDistanceM: 20000,
      arrivalSide: null,
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };
  }

  function dentroDoQuadrado(lon: number, lat: number): boolean {
    return booleanPointInPolygon(point([lon, lat]), {
      type: "Feature",
      properties: {},
      geometry: quadrado,
    });
  }

  it("termina na sede quando o shapefile trouxe o ponto dentro do imóvel", () => {
    const sede = { lon: -51.96, lat: -11.94 }; // dentro do quadrado
    const final = ensureRouteEndsInsidePolygon(rotaQueTerminaNaDivisa(), quadrado, sede);

    const fim = final.coordinates[final.coordinates.length - 1];
    expect(fim[0]).toBeCloseTo(sede.lon, 6);
    expect(fim[1]).toBeCloseTo(sede.lat, 6);
    expect(dentroDoQuadrado(fim[0], fim[1])).toBe(true);
    expect(final.waypoints[final.waypoints.length - 1].maneuver).toBe("arrive");
    expect(final.waypoints[final.waypoints.length - 1].dms).toBe(
      formatDmsPair(sede.lon, sede.lat),
    );
    expect(final.destinationLabel).toBe("sede da propriedade");
    // O último trecho vira um seguimento até a sede e o total sai da geometria.
    expect(final.waypoints[final.waypoints.length - 2].maneuver).toBe("straight");
    expect(final.totalDistanceM).toBeCloseTo(
      turfLength(lineString(final.coordinates), { units: "meters" }),
      6,
    );
  });

  it("termina num ponto interior quando não há sede", () => {
    const final = ensureRouteEndsInsidePolygon(rotaQueTerminaNaDivisa(), quadrado);

    const fim = final.coordinates[final.coordinates.length - 1];
    expect(dentroDoQuadrado(fim[0], fim[1])).toBe(true);
    // Centroide do quadrado: (-51.95, -11.95), longe da divisa.
    expect(fim[0]).toBeCloseTo(-51.95, 5);
    expect(fim[1]).toBeCloseTo(-11.95, 5);
    expect(final.destinationLabel).toBeNull();
    expect(final.totalDistanceM).toBeGreaterThan(rotaQueTerminaNaDivisa().totalDistanceM);
  });

  it("ignora sede fora do polígono e cai no centroide", () => {
    const final = ensureRouteEndsInsidePolygon(
      rotaQueTerminaNaDivisa(),
      quadrado,
      { lon: -52.2, lat: -11.95 }, // fora
    );

    const fim = final.coordinates[final.coordinates.length - 1];
    expect(fim[0]).toBeCloseTo(-51.95, 5);
    expect(final.destinationLabel).toBeNull();
  });

  it("não altera a rota que já termina dentro do imóvel", () => {
    const coordinates = [
      [-52.2, -11.95],
      [-52.0, -11.95],
      [-51.96, -11.94], // já dentro, na futura sede
    ];
    const rota: CroquiRoute = {
      coordinates,
      waypoints: [
        waypoint(-52.2, -11.95, 20000, "depart", "MT-242", 0),
        waypoint(-51.96, -11.94, 0, "arrive", "", 2),
      ],
      totalDistanceM: 20000,
      arrivalSide: null,
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };

    const { extended, route } = extendRouteToInsidePoint(rota, quadrado, {
      lon: -51.96,
      lat: -11.94,
    });
    expect(extended).toBe(false);
    expect(route).toBe(rota);
    // ensureRouteEndsInsidePolygon também devolve a mesma rota (idempotente).
    expect(ensureRouteEndsInsidePolygon(rota, quadrado)).toBe(rota);
  });

  it("interiorDestination prefere a sede, depois o centroide", () => {
    expect(interiorDestination(quadrado, { lon: -51.96, lat: -11.94 }).label).toBe(
      "sede da propriedade",
    );
    const semSede = interiorDestination(quadrado);
    expect(semSede.label).toBeNull();
    expect(semSede.lon).toBeCloseTo(-51.95, 5);
    // Sede fora do polígono não vale; cai no centroide sem rótulo.
    const comSedeFora = interiorDestination(quadrado, { lon: -52.5, lat: -12.5 });
    expect(comSedeFora.label).toBeNull();
    expect(comSedeFora.lon).toBeCloseTo(-51.95, 5);
  });
});
