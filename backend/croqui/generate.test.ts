import { describe, expect, it } from "vitest";
import { buildCroquiNarrative } from "./narrative";
import { buildCroquiKml } from "./render-kml";
import type { CroquiRoute } from "./routing";

describe("croqui narrative + kml", () => {
  const route: CroquiRoute = {
    totalDistanceM: 12000,
    coordinates: [
      [-52.22, -12.59],
      [-52.21, -12.58],
    ],
    geometry: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[-52.22, -12.59], [-52.21, -12.58]] },
    },
    waypoints: [
      {
        lon: -52.22,
        lat: -12.59,
        dms: "(-12°35'24.14\"S, 52°13'10.64\"O)",
        distanceFromPrevM: 0,
        instruction: "Inicia-se",
        roadName: "MT-109",
      },
      {
        lon: -52.215,
        lat: -12.585,
        dms: "(-12°34'48.00\"S, 52°12'36.00\"O)",
        distanceFromPrevM: 10700,
        instruction: "Siga em frente pela MT-109",
        roadName: "MT-109",
      },
      {
        lon: -52.21,
        lat: -12.58,
        dms: "(-12°34'20.00\"S, 52°12'00.00\"O)",
        distanceFromPrevM: 5000,
        instruction: "Chegada ao destino",
        roadName: "",
      },
    ],
  };

  it("gera narrativa com município e propriedade", () => {
    const text = buildCroquiNarrative({
      municipioNome: "Querência",
      municipioIbge: "5107909",
      propertyName: "Fazenda Teste",
      landmark: {
        label: "rotatória MT-109",
        lon: -52.22,
        lat: -12.59,
        introSuffix: "na rotatória entre a Av. Norte e a MT-109",
      },
      route,
      startDms: "(-12°35'24.14\"S, 52°13'10.64\"O)",
    });
    expect(text).toContain("Querência");
    expect(text).toContain("Fazenda Teste");
    expect(text).toContain("sede da propriedade");
  });

  it("gera KML com polígono e medidas de caminho", () => {
    const kml = buildCroquiKml({
      title: "LOTE TESTE",
      propertyName: "Fazenda Teste",
      atpGeometry: {
        type: "Polygon",
        coordinates: [
          [
            [-52.21, -12.58],
            [-52.205, -12.58],
            [-52.205, -12.575],
            [-52.21, -12.575],
            [-52.21, -12.58],
          ],
        ],
      },
      route,
    });
    expect(kml).toContain("Medida do caminho");
    expect(kml).toContain("<Polygon>");
    expect(kml).toContain("Fazenda Teste");
    expect(kml).toContain("msn_ylw-pushpin");
    expect(kml).toContain("Meus lugares");
  });
});
