import type { MultiPolygon, Polygon, Position } from "geojson";
import { decimalToDms, escapeXml } from "./coords";
import type { CroquiRoute } from "./routing";

function ringToKmlCoords(ring: Position[]): string {
  return ring.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
}

function polygonToKml(polygon: Polygon | MultiPolygon): string {
  if (polygon.type === "Polygon") {
    const outer = polygon.coordinates[0];
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringToKmlCoords(outer)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }
  return polygon.coordinates
    .map(
      (poly) =>
        `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringToKmlCoords(poly[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`,
    )
    .join("");
}

function lineSegments(coords: Position[]): Position[][] {
  if (coords.length < 2) return [];
  const segments: Position[][] = [];
  for (let i = 0; i < coords.length - 1; i++) segments.push([coords[i], coords[i + 1]]);
  return segments;
}

export function buildCroquiKml(args: {
  title: string;
  propertyName: string;
  atpGeometry: Polygon | MultiPolygon;
  route: CroquiRoute;
}): string {
  const { title, propertyName, atpGeometry, route } = args;
  const docName = escapeXml(title || propertyName || "croqui");
  const routeSegments = lineSegments(route.coordinates);
  const waypointPoints = route.waypoints.map((w) => ({ lon: w.lon, lat: w.lat, dms: w.dms }));

  const segmentPlacemarks = routeSegments
    .map(
      (seg) => `
    <Placemark>
      <name>Medida do caminho</name>
      <styleUrl>#lineRoute</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${ringToKmlCoords(seg)}</coordinates>
      </LineString>
    </Placemark>`,
    )
    .join("");

  const pointPlacemarks = waypointPoints
    .map(
      (p) => `
    <Placemark>
      <name>${escapeXml(p.dms.replace(/[()]/g, ""))}</name>
      <styleUrl>#pointStyle</styleUrl>
      <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
    </Placemark>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name>
    <Style id="lineRoute">
      <LineStyle><color>ff0000ff</color><width>4</width></LineStyle>
    </Style>
    <Style id="polyAtp">
      <LineStyle><color>ff00ffff</color><width>2</width></LineStyle>
      <PolyStyle><color>4000ffff</color></PolyStyle>
    </Style>
    <Style id="pointStyle">
      <IconStyle><scale>0.8</scale></IconStyle>
    </Style>
    <Folder>
      <name>Meus lugares</name>
      <Placemark>
        <name>${escapeXml(propertyName || "ATP")}</name>
        <styleUrl>#polyAtp</styleUrl>
        ${polygonToKml(atpGeometry)}
      </Placemark>
      ${segmentPlacemarks}
      ${pointPlacemarks}
    </Folder>
  </Document>
</kml>`;
}

export { decimalToDms };
