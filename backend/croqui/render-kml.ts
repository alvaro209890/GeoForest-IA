import type { MultiPolygon, Polygon, Position } from "geojson";
import { escapeXml, formatDmsKmlLabel } from "./coords";
import type { CroquiRoute, RouteWaypoint } from "./routing";

/**
 * KML no mesmo formato dos croquis modelo, que foram salvos pelo Google Earth Pro:
 * pasta "Meus lugares" com os trechos ("Medida do caminho") e os pontos DMS
 * intercalados na ordem do percurso, e o polígono da ATP ao final.
 */

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

/** Fatia a geometria da rota nos trechos entre pontos consecutivos. */
export function routeSegmentsByWaypoints(
  coords: Position[],
  waypoints: RouteWaypoint[],
): Position[][] {
  if (coords.length < 2 || waypoints.length < 2) return [];
  const segments: Position[][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const start = Math.max(0, Math.min(waypoints[i].coordIndex, coords.length - 1));
    const end = Math.max(0, Math.min(waypoints[i + 1].coordIndex, coords.length - 1));
    if (end > start) segments.push(coords.slice(start, end + 1));
    else segments.push([]);
  }
  return segments;
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

const FOLDER_LIST_STYLE = `
		<Style>
			<ListStyle>
				<listItemType>check</listItemType>
				<ItemIcon>
					<state>open</state>
					<href>:/mysavedplaces_open.png</href>
				</ItemIcon>
				<ItemIcon>
					<state>closed</state>
					<href>:/mysavedplaces_closed.png</href>
				</ItemIcon>
				<bgColor>00ffffff</bgColor>
				<maxSnippetLines>2</maxSnippetLines>
			</ListStyle>
		</Style>`;

function segmentPlacemark(segment: Position[]): string {
  return `
		<Placemark>
			<name>Medida do caminho</name>
			<styleUrl>#inline</styleUrl>
			<LineString>
				<tessellate>1</tessellate>
				<coordinates>
					${ringToKmlCoords(segment)}
				</coordinates>
			</LineString>
		</Placemark>`;
}

function pointPlacemark(waypoint: RouteWaypoint, destaque: boolean): string {
  return `
		<Placemark>
			<name>${formatDmsKmlLabel(waypoint.lon, waypoint.lat)}</name>
			<styleUrl>${destaque ? "#m_ylw-pushpin" : "#msn_ylw-pushpin"}</styleUrl>
			<Point>
				<gx:drawOrder>1</gx:drawOrder>
				<coordinates>${waypoint.lon},${waypoint.lat},0</coordinates>
			</Point>
		</Placemark>`;
}

export function buildCroquiKml(args: {
  title: string;
  propertyName: string;
  atpGeometry: Polygon | MultiPolygon;
  route: CroquiRoute;
  /** Nome do arquivo .kml — os modelos usam ele como nome do Document. */
  fileName?: string;
}): string {
  const { title, propertyName, atpGeometry, route } = args;
  const docName = escapeXml(args.fileName || `${title || propertyName || "croqui"}.kml`);
  const segments = routeSegmentsByWaypoints(route.coordinates, route.waypoints);
  const lastIndex = route.waypoints.length - 1;

  const percurso = route.waypoints
    .map((waypoint, i) => {
      const ponto = pointPlacemark(waypoint, i === 0 || i === lastIndex);
      const trecho = segments[i]?.length ? segmentPlacemark(segments[i]) : "";
      return `${ponto}${trecho}`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document>
	<name>${docName}</name>
	<open>1</open>
	<atom:link rel="app" href="https://www.google.com/earth/about/versions/#earth-pro" title="Google Earth Pro 7.3.6.10201"></atom:link>
${GE_STYLES}
	<Folder>
		<name>Meus lugares</name>
		<open>1</open>${FOLDER_LIST_STYLE}
${percurso}
		<Placemark>
			<name>${escapeXml(propertyName || "ATP")}</name>
			<styleUrl>#falseColor0</styleUrl>
			${polygonToKml(atpGeometry)}
		</Placemark>
	</Folder>
</Document>
</kml>`;
}
