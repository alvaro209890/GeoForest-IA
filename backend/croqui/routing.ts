import {
  booleanPointInPolygon,
  length as turfLength,
  lineIntersect,
  lineString,
  nearestPointOnLine,
  point,
  polygonToLine,
} from "@turf/turf";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import { formatDmsPair } from "./coords";

const OSRM_BASE =
  String(process.env.CROQUI_OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/, "");

/** Trechos menores que isso são absorvidos pelo anterior — os croquis modelo têm 4 a 12 pontos. */
const MIN_STEP_M = Number(process.env.CROQUI_MIN_STEP_M || 300);

export type ManeuverKind =
  | "depart"
  | "arrive"
  | "left"
  | "right"
  | "straight"
  | "roundabout"
  | "fork"
  | "merge";

export type RouteWaypoint = {
  lon: number;
  lat: number;
  dms: string;
  /** Distância percorrida a partir deste ponto até o próximo. */
  distanceToNextM: number;
  maneuver: ManeuverKind;
  /** Nome da via, ou a sigla da rodovia quando o OSRM não trouxer nome. */
  roadName: string;
  /** Índice do ponto correspondente na geometria da rota. */
  coordIndex: number;
};

export type CroquiRoute = {
  coordinates: Position[];
  waypoints: RouteWaypoint[];
  totalDistanceM: number;
  /** Lado em que o destino fica, quando o OSRM informa. */
  arrivalSide: "esquerda" | "direita" | null;
  geometry: Feature<LineString>;
};

type OsrmStep = {
  distance?: number;
  name?: string;
  ref?: string;
  maneuver?: { location?: [number, number]; type?: string; modifier?: string };
};

/** "BR-158 | BR-242" → "BR-158". O OSRM usa `|` ou `;` para múltiplas siglas. */
export function primaryRoadRef(ref: unknown): string {
  return String(ref || "")
    .split(/[|;]/)[0]
    .trim();
}

/** Prefere o nome da via; no rural de MT ele vem vazio e a sigla é o que sobra. */
export function resolveRoadLabel(name: unknown, ref: unknown): string {
  const clean = String(name || "").trim();
  if (clean && clean !== "-") return clean;
  return primaryRoadRef(ref);
}

export function classifyManeuver(type: unknown, modifier: unknown): ManeuverKind {
  const t = String(type || "").toLowerCase();
  const m = String(modifier || "").toLowerCase();
  if (t === "depart") return "depart";
  if (t === "arrive") return "arrive";
  if (t.includes("roundabout") || t.includes("rotary")) return "roundabout";
  if (t === "fork") return "fork";
  if (t === "merge") return "merge";
  if (m.includes("left")) return "left";
  if (m.includes("right")) return "right";
  return "straight";
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

function dist2(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = lon1 - lon2;
  const dy = lat1 - lat2;
  return dx * dx + dy * dy;
}

export function nearestCoordIndex(coords: Position[], lon: number, lat: number, from = 0): number {
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

/**
 * Junta trechos consecutivos que seguem na mesma via e absorve trechos curtos
 * demais para virar frase no roteiro. A distância absorvida vai para o trecho
 * anterior, então o total do percurso não muda.
 */
export function simplifyRouteSteps(
  waypoints: RouteWaypoint[],
  minStepM = MIN_STEP_M,
): RouteWaypoint[] {
  if (waypoints.length <= 2) return waypoints.slice();
  const out: RouteWaypoint[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const current = waypoints[i];
    const previous = out[out.length - 1];
    const isLast = i === waypoints.length - 1;
    const continuesOnSameRoad =
      current.maneuver === "straight" &&
      !!current.roadName &&
      current.roadName === previous.roadName;
    const tooShort = previous.distanceToNextM < minStepM;
    if (!isLast && (continuesOnSameRoad || tooShort)) {
      previous.distanceToNextM += current.distanceToNextM;
      continue;
    }
    out.push(current);
  }
  return out;
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
  const data = (await fetchOsrmJson(url)) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      geometry?: { coordinates?: Position[] };
      legs?: Array<{ steps?: OsrmStep[] }>;
    }>;
  };
  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error("Não foi possível calcular a rota viária até a propriedade.");
  }
  const route = data.routes[0];
  const coords = route.geometry?.coordinates || [];
  const steps = route.legs?.[0]?.steps || [];

  const raw: RouteWaypoint[] = [];
  let searchFrom = 0;
  for (const step of steps) {
    const loc = step.maneuver?.location;
    if (!loc || loc.length < 2) continue;
    const [lon, lat] = loc;
    const coordIndex = coords.length ? nearestCoordIndex(coords, lon, lat, searchFrom) : 0;
    searchFrom = coordIndex;
    raw.push({
      lon,
      lat,
      dms: formatDmsPair(lon, lat),
      distanceToNextM: Number(step.distance || 0),
      maneuver: classifyManeuver(step.maneuver?.type, step.maneuver?.modifier),
      roadName: resolveRoadLabel(step.name, step.ref),
      coordIndex,
    });
  }

  if (!raw.length && coords.length) {
    const [lon, lat] = coords[0];
    const last = coords[coords.length - 1];
    raw.push(
      {
        lon,
        lat,
        dms: formatDmsPair(lon, lat),
        distanceToNextM: Number(route.distance || 0),
        maneuver: "depart",
        roadName: "",
        coordIndex: 0,
      },
      {
        lon: last[0],
        lat: last[1],
        dms: formatDmsPair(last[0], last[1]),
        distanceToNextM: 0,
        maneuver: "arrive",
        roadName: "",
        coordIndex: coords.length - 1,
      },
    );
  }

  const arriveModifier = String(steps[steps.length - 1]?.maneuver?.modifier || "").toLowerCase();
  const arrivalSide = arriveModifier.includes("left")
    ? "esquerda"
    : arriveModifier.includes("right")
      ? "direita"
      : null;

  return {
    coordinates: coords,
    waypoints: simplifyRouteSteps(raw),
    totalDistanceM: Number(route.distance || 0),
    arrivalSide,
    geometry: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    },
  };
}

function polygonBoundaryLines(geometry: Polygon | MultiPolygon): Feature<LineString>[] {
  const asLine = polygonToLine({ type: "Feature", properties: {}, geometry } as never) as
    | Feature<LineString>
    | { type: "FeatureCollection"; features: Feature<LineString>[] };
  if ("features" in asLine) return asLine.features;
  return [asLine];
}

/**
 * Corta a rota onde ela cruza a divisa do imóvel. O ponto de corte é o acesso
 * real — a porteira — e não o ponto da divisa mais próximo em linha reta.
 * Sem cruzamento (rota que só encosta na divisa), devolve a rota intacta.
 */
export function trimRouteAtPolygon(
  route: CroquiRoute,
  geometry: Polygon | MultiPolygon,
): { route: CroquiRoute; trimmed: boolean } {
  const coords = route.coordinates;
  if (coords.length < 2) return { route, trimmed: false };

  const polygonFeature = { type: "Feature" as const, properties: {}, geometry };
  let cutIndex = -1;
  let cutPoint: Position | null = null;
  const boundaries = polygonBoundaryLines(geometry);

  for (let i = 0; i < coords.length - 1; i++) {
    const insideNext = booleanPointInPolygon(point(coords[i + 1] as [number, number]), polygonFeature);
    if (!insideNext) continue;
    const segment = lineString([coords[i], coords[i + 1]]);
    for (const boundary of boundaries) {
      const hits = lineIntersect(segment, boundary);
      if (hits.features.length) {
        cutPoint = hits.features[0].geometry.coordinates;
        break;
      }
    }
    cutIndex = i;
    if (!cutPoint) cutPoint = coords[i + 1];
    break;
  }

  if (cutIndex < 0 || !cutPoint) return { route, trimmed: false };

  const trimmed = [...coords.slice(0, cutIndex + 1), cutPoint];
  const kept = route.waypoints.filter((w) => w.coordIndex <= cutIndex);
  if (!kept.length) kept.push({ ...route.waypoints[0], coordIndex: 0 });

  const lastKept = kept[kept.length - 1];
  const tail = trimmed.slice(lastKept.coordIndex);
  lastKept.distanceToNextM =
    tail.length >= 2 ? turfLength(lineString(tail), { units: "meters" }) : 0;

  kept.push({
    lon: cutPoint[0],
    lat: cutPoint[1],
    dms: formatDmsPair(cutPoint[0], cutPoint[1]),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: trimmed.length - 1,
  });

  return {
    trimmed: true,
    route: {
      ...route,
      coordinates: trimmed,
      waypoints: kept,
      totalDistanceM: turfLength(lineString(trimmed), { units: "meters" }),
      geometry: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: trimmed },
      },
    },
  };
}
