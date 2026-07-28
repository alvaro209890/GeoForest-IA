import type { MultiPolygon, Polygon, Position } from "geojson";
import { escapeXml, formatDmsKmlLabel } from "./coords";
import type { CroquiRoute, RouteWaypoint } from "./routing";

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

function dist2(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = lon1 - lon2;
  const dy = lat1 - lat2;
  return dx * dx + dy * dy;
}

function nearestIndex(coords: Position[], lon: number, lat: number, from = 0): number {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < coords.length; i++) {
    const d = dist2(coords[i][0], coords[i][1], lon, lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function routeSegmentsByWaypoints(coords: Position[], waypoints: RouteWaypoint[]): Position[][] {
  if (coords.length < 2 || waypoints.length < 2) return [];
  const indices: number[] = [];
  let from = 0;
  for (const w of waypoints) {
    const idx = nearestIndex(coords, w.lon, w.lat, from);
    indices.push(idx);
    from = idx;
  }
  const segments: Position[][] = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const start = indices[i];
    const end = indices[i + 1];
    if (end > start) segments.push(coords.slice(start, end + 1));
  }
  return segments.filter((s) => s.length >= 2);
}

const GE_STYLES = `
	<Style id="falseColor">
		<LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
		<PolyStyle><colorMode>random</colorMode><fill>0</fill></PolyStyle>
	</Style>
	<StyleMap id="falseColor0">
		<Pair><key>normal</key><styleUrl>#falseColor1</styleUrl></Pair>
		<Pair><key>highlight</key><styleUrl>#falseColor</styleUrl></Pair>
	</StyleMap>
	<Style id="falseColor1">
		<LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
		<PolyStyle><colorMode>random</colorMode><fill>0</fill></PolyStyle>
	</Style>
	<StyleMap id="inline">
		<Pair><key>normal</key><styleUrl>#inline0</styleUrl></Pair>
		<Pair><key>highlight</key><styleUrl>#inline1</styleUrl></Pair>
	</StyleMap>
	<Style id="inline0">
		<LineStyle><color>ff0055ff</color><width>3</width></LineStyle>
		<PolyStyle><fill>0</fill></PolyStyle>
	</Style>
	<Style id="inline1">
		<LineStyle><color>ff0055ff</color><width>3</width></LineStyle>
		<PolyStyle><fill>0</fill></PolyStyle>
	</Style>
	<StyleMap id="msn_ylw-pushpin">
		<Pair><key>normal</key><styleUrl>#sn_ylw-pushpin</styleUrl></Pair>
		<Pair><key>highlight</key><styleUrl>#sh_ylw-pushpin</styleUrl></Pair>
	</StyleMap>
	<Style id="sn_ylw-pushpin">
		<IconStyle>
			<scale>0.8</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
			<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
		</IconStyle>
		<LabelStyle><scale>0.8</scale></LabelStyle>
	</Style>
	<Style id="sh_ylw-pushpin">
		<IconStyle>
			<scale>0.945455</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
			<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
		</IconStyle>
		<LabelStyle><scale>0.8</scale></LabelStyle>
	</Style>
	<StyleMap id="m_ylw-pushpin">
		<Pair><key>normal</key><styleUrl>#s_ylw-pushpin</styleUrl></Pair>
		<Pair><key>highlight</key><styleUrl>#s_ylw-pushpin_hl</styleUrl></Pair>
	</StyleMap>
	<Style id="s_ylw-pushpin">
		<IconStyle>
			<scale>1.1</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
			<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
		</IconStyle>
	</Style>
	<Style id="s_ylw-pushpin_hl">
		<IconStyle>
			<scale>1.3</scale>
			<Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon>
			<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>
		</IconStyle>
	</Style>`;

export function buildCroquiKml(args: {
  title: string;
  propertyName: string;
  atpGeometry: Polygon | MultiPolygon;
  route: CroquiRoute;
}): string {
  const { title, propertyName, atpGeometry, route } = args;
  const docName = escapeXml(title || propertyName || "croqui");
  const routeSegments = routeSegmentsByWaypoints(route.coordinates, route.waypoints);

  const segmentPlacemarks = routeSegments
    .map(
      (seg, i) => `
		<Placemark>
			<name>Medida do caminho</name>
			<styleUrl>#${i % 2 === 0 ? "inline" : "inline"}</styleUrl>
			<LineString>
				<tessellate>1</tessellate>
				<coordinates>
					${ringToKmlCoords(seg)}
				</coordinates>
			</LineString>
		</Placemark>`,
    )
    .join("");

  const pointPlacemarks = route.waypoints
    .map((p, i) => {
      const label = formatDmsKmlLabel(p.lon, p.lat);
      const style = i === 0 || i === route.waypoints.length - 1 ? "#m_ylw-pushpin" : "#msn_ylw-pushpin";
      return `
		<Placemark>
			<name>${label}</name>
			<styleUrl>${style}</styleUrl>
			<Point>
				<gx:drawOrder>1</gx:drawOrder>
				<coordinates>${p.lon},${p.lat},0</coordinates>
			</Point>
		</Placemark>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
	<name>${docName}</name>
${GE_STYLES}
	<Folder>
		<name>Meus lugares</name>
		<open>1</open>
		<Placemark>
			<name>${escapeXml(propertyName || "ATP")}</name>
			<styleUrl>#falseColor0</styleUrl>
			${polygonToKml(atpGeometry)}
		</Placemark>
${segmentPlacemarks}
${pointPlacemarks}
	</Folder>
</Document>
</kml>`;
}
