import { lineString, nearestPointOnLine, point } from "@turf/turf";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import { formatDistance, formatDmsPair } from "./coords";

const OSRM_BASE =
  String(process.env.CROQUI_OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/, "");

export type RouteWaypoint = {
  lon: number;
  lat: number;
  dms: string;
  distanceFromPrevM: number;
  instruction: string;
  roadName: string;
};

export type CroquiRoute = {
  coordinates: Position[];
  waypoints: RouteWaypoint[];
  totalDistanceM: number;
  geometry: Feature<LineString>;
};

function maneuverText(type: string, modifier: string, road: string): string {
  const roadLabel = road && road !== "-" ? road : "estrada";
  const mod = String(modifier || "").toLowerCase();
  if (type === "depart") return `Inicia-se o percurso pela ${roadLabel}`;
  if (type === "arrive") return "Chegada ao destino";
  if (mod.includes("left")) return `Vire à esquerda e siga pela ${roadLabel}`;
  if (mod.includes("right")) return `Vire à direita e siga pela ${roadLabel}`;
  if (mod.includes("straight") || type === "continue") return `Siga em frente pela ${roadLabel}`;
  if (type === "roundabout") return `Na rotatória, siga pela ${roadLabel}`;
  if (type === "fork") return `Na bifurcação, siga pela ${roadLabel}`;
  if (type === "merge") return `Entre na ${roadLabel}`;
  return `Siga pela ${roadLabel}`;
}

export function destinationOnPolygonBoundary(
  polygon: Polygon | MultiPolygon,
  fromLon: number,
  fromLat: number,
): { lon: number; lat: number } {
  const rings: Position[][] = [];
  if (polygon.type === "Polygon") {
    rings.push(polygon.coordinates[0]);
  } else {
    for (const poly of polygon.coordinates) rings.push(poly[0]);
  }
  let best: { lon: number; lat: number; dist: number } | null = null;
  const origin = point([fromLon, fromLat]);
  for (const ring of rings) {
    const ls = lineString(ring);
    const snapped = nearestPointOnLine(ls, origin, { units: "kilometers" });
    const [lon, lat] = snapped.geometry.coordinates;
    const dist = snapped.properties?.dist ?? 0;
    if (!best || dist < best.dist) best = { lon, lat, dist };
  }
  if (best) return { lon: best.lon, lat: best.lat };
  const c = centroidFromPolygon(polygon);
  return { lon: c[0], lat: c[1] };
}

function centroidFromPolygon(polygon: Polygon | MultiPolygon): [number, number] {
  const ring =
    polygon.type === "Polygon" ? polygon.coordinates[0] : polygon.coordinates[0][0];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
    n++;
  }
  return n ? [sx / n, sy / n] : [0, 0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFetchError(error: unknown): string {
  const message = String((error as Error)?.message || error || "fetch failed");
  const cause = (error as { cause?: unknown })?.cause;
  const code = String((cause as { code?: string })?.code || "");
  if (/fetch failed|ETIMEDOUT|ENETUNREACH|ECONNRESET|ENOTFOUND/i.test(`${message} ${code}`)) {
    return "Serviço de roteamento OSRM indisponível no momento. Tente novamente em instantes.";
  }
  return message;
}

async function fetchOsrmJson(url: string): Promise<Record<string, unknown>> {
  const attempts = Number(process.env.CROQUI_OSRM_RETRIES || 3);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        throw new Error(`OSRM indisponível (${response.status}). Verifique CROQUI_OSRM_BASE_URL.`);
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1000 * attempt);
    }
  }
  throw new Error(formatFetchError(lastError));
}

export async function fetchDrivingRoute(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
): Promise<CroquiRoute> {
  const coordPath = `${startLon},${startLat};${endLon},${endLat}`;
  const url =
    `${OSRM_BASE}/route/v1/driving/${coordPath}` +
    "?overview=full&steps=true&geometries=geojson&annotations=false";
  const data = await fetchOsrmJson(url) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      geometry?: { coordinates?: Position[] };
      legs?: Array<{
        steps?: Array<{
          distance?: number;
          name?: string;
          maneuver?: { location?: [number, number]; type?: string; modifier?: string };
        }>;
      }>;
    }>;
  };
  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error("Não foi possível calcular a rota viária até a propriedade.");
  }
  const route = data.routes[0];
  const coords = route.geometry?.coordinates || [];
  const steps = route.legs?.[0]?.steps || [];
  const waypoints: RouteWaypoint[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const loc = step.maneuver?.location;
    if (!loc || loc.length < 2) continue;
    const [lon, lat] = loc;
    const type = String(step.maneuver?.type || "");
    const modifier = String(step.maneuver?.modifier || "");
    const road = String(step.name || "").trim();
    waypoints.push({
      lon,
      lat,
      dms: formatDmsPair(lon, lat),
      distanceFromPrevM: Number(step.distance || 0),
      instruction: maneuverText(type, modifier, road),
      roadName: road,
    });
  }
  if (!waypoints.length && coords.length) {
    const [lon, lat] = coords[0];
    waypoints.push({
      lon,
      lat,
      dms: formatDmsPair(lon, lat),
      distanceFromPrevM: 0,
      instruction: "Inicia-se o percurso",
      roadName: "",
    });
    const last = coords[coords.length - 1];
    waypoints.push({
      lon: last[0],
      lat: last[1],
      dms: formatDmsPair(last[0], last[1]),
      distanceFromPrevM: Number(route.distance || 0),
      instruction: "Chegada ao destino",
      roadName: "",
    });
  }
  return {
    coordinates: coords,
    waypoints,
    totalDistanceM: Number(route.distance || 0),
    geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
  };
}
