import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { formatDmsPair } from "./coords";
import { buildCroquiKml, routeSegmentsByWaypoints } from "./render-kml";
import type { CroquiRoute, RouteWaypoint } from "./routing";

// O KML modelo é a referência de formato. Quando a pasta `Croquis/` não está
// presente (checkout do servidor), as asserções contra ele são puladas.
const MODELO = path.resolve(
  import.meta.dirname,
  "../../Croquis/Fazenda Irmaos Sebald-lote 121B_kml.kml",
);
const temModelo = fs.existsSync(MODELO);

function waypoint(lon: number, lat: number, coordIndex: number): RouteWaypoint {
  return {
    lon,
    lat,
    dms: formatDmsPair(lon, lat),
    distanceToNextM: 1000,
    maneuver: "straight",
    roadName: "MT-243",
    coordIndex,
  };
}

const coordinates = [
  [-52.2195, -12.5990],
  [-52.2195, -12.6088],
  [-52.2552, -12.6288],
];

const route: CroquiRoute = {
  coordinates,
  waypoints: [waypoint(-52.2195, -12.599, 0), waypoint(-52.2195, -12.6088, 1), waypoint(-52.2552, -12.6288, 2)],
  totalDistanceM: 6200,
  arrivalSide: "esquerda",
  geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
};

const atpGeometry: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-52.26, -12.63],
      [-52.25, -12.63],
      [-52.25, -12.62],
      [-52.26, -12.62],
      [-52.26, -12.63],
    ],
  ],
};

describe("croqui KML", () => {
  const kml = buildCroquiKml({
    title: "Fazenda Irmãos Sebald - Lote 121B",
    propertyName: "Fazenda Irmãos Sebald",
    atpGeometry,
    route,
    fileName: "Fazenda Irmaos Sebald-lote 121B.kml",
  });

  it("usa o mesmo envelope do Google Earth Pro dos modelos", () => {
    expect(kml).toContain("<name>Fazenda Irmaos Sebald-lote 121B.kml</name>");
    expect(kml).toContain("<open>1</open>");
    expect(kml).toContain('rel="app"');
    expect(kml).toContain("Google Earth Pro");
    expect(kml).toContain("<name>Meus lugares</name>");
    expect(kml).toContain("<listItemType>check</listItemType>");
    expect(kml).toContain(":/mysavedplaces_open.png");
  });

  it("mantém as cores dos modelos: polígono vermelho e caminho laranja", () => {
    const modelo = temModelo ? fs.readFileSync(MODELO, "utf8") : null;
    for (const cor of ["ff0000ff", "ff0055ff"]) {
      if (modelo) expect(modelo).toContain(`<color>${cor}</color>`);
      expect(kml).toContain(`<color>${cor}</color>`);
    }
    expect(kml).toContain("ylw-pushpin.png");
  });

  it("intercala ponto e trecho na ordem do percurso, com o polígono ao final", () => {
    const ordem = [...kml.matchAll(/<name>([^<]*)<\/name>/g)]
      .map((m) => m[1])
      .filter(
        (n) =>
          n === "Medida do caminho" || n.startsWith("12°") || n === "Fazenda Irmãos Sebald",
      );
    expect(ordem[0]).toMatch(/^12°/);
    expect(ordem[1]).toBe("Medida do caminho");
    expect(ordem[2]).toMatch(/^12°/);
    expect(ordem[3]).toBe("Medida do caminho");
    expect(ordem[4]).toMatch(/^12°/);
    expect(ordem[ordem.length - 1]).toContain("Sebald");
    expect(kml.indexOf("<Polygon>")).toBeGreaterThan(kml.lastIndexOf("Medida do caminho"));
  });

  it("rotula os pontos em DMS como o modelo: grau literal, aspas em entidade", () => {
    // `&deg;` não é entidade XML — o Google Earth mostraria o texto cru.
    if (temModelo) {
      const modelo = fs.readFileSync(MODELO, "utf8");
      expect(modelo).toMatch(/<name>\s*12°\d+&apos;[\d.]+&quot;S,\s{2}52°/);
    }
    expect(kml).toMatch(/<name>12°\d+&apos;[\d.]+&quot;S,\s{2}52°/);
    expect(kml).not.toContain("&deg;");
  });

  it("destaca o primeiro e o último ponto", () => {
    const estilos = [...kml.matchAll(/<styleUrl>#(m_ylw-pushpin|msn_ylw-pushpin)<\/styleUrl>/g)].map(
      (m) => m[1],
    );
    expect(estilos).toEqual(["m_ylw-pushpin", "msn_ylw-pushpin", "m_ylw-pushpin"]);
  });

  it("fatia a rota entre pontos consecutivos", () => {
    const segmentos = routeSegmentsByWaypoints(coordinates, route.waypoints);
    expect(segmentos).toHaveLength(2);
    expect(segmentos[0]).toEqual([coordinates[0], coordinates[1]]);
    expect(segmentos[1]).toEqual([coordinates[1], coordinates[2]]);
  });
});
