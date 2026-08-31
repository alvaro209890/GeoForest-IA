import {
  booleanPointInPolygon,
  centroid,
  length as turfLength,
  lineIntersect,
  lineString,
  nearestPointOnLine,
  point,
  pointOnFeature,
  polygonToLine,
} from "@turf/turf";
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import { formatDmsPair } from "./coords";
import { sleep } from "../lib/job-utils";

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
  /** Onde a rota termina dentro do imóvel: "sede da propriedade" ou null. */
  destinationLabel?: string | null;
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

/**
 * Junta os passos de todas as pernas numa sequência só. Cada ponto de passagem
 * intermediário cria um par `arrive`/`depart` artificial: o `arrive` some e o
 * `depart` vira um seguimento normal, senão o roteiro anunciaria uma chegada no
 * meio do caminho.
 */
export function flattenLegSteps(legs: Array<{ steps?: OsrmStep[] }>): OsrmStep[] {
  const out: OsrmStep[] = [];
  legs.forEach((leg, legIndex) => {
    const steps = leg.steps || [];
    steps.forEach((step, stepIndex) => {
      const type = String(step.maneuver?.type || "").toLowerCase();
      const isLastLeg = legIndex === legs.length - 1;
      if (type === "arrive" && !isLastLeg) return;
      if (type === "depart" && legIndex > 0 && stepIndex === 0) {
        out.push({ ...step, maneuver: { ...step.maneuver, type: "continue" } });
        return;
      }
      out.push(step);
    });
  });
  return out;
}

type OsrmRouteJson = {
  distance?: number;
  geometry?: { coordinates?: Position[] };
  legs?: Array<{ steps?: OsrmStep[] }>;
};

function osrmUrl(points: Position[], alternatives: number): string {
  const coordPath = points.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const alt = alternatives > 0 ? String(alternatives) : "false";
  return (
    `${OSRM_BASE}/route/v1/driving/${coordPath}` +
    `?overview=full&steps=true&geometries=geojson&annotations=false&alternatives=${alt}`
  );
}

function buildRoute(route: OsrmRouteJson): CroquiRoute {
  const coords = route.geometry?.coordinates || [];
  const steps = flattenLegSteps(route.legs || []);

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

/**
 * Rota viária passando pelos pontos na ordem dada. Com `alternatives > 0` o OSRM
 * pode devolver mais de um traçado — o público costuma devolver só um, e é por
 * isso que `route-options` também procura corredores por pontos de passagem.
 */
export async function fetchDrivingRoutes(
  points: Position[],
  options: { alternatives?: number } = {},
): Promise<CroquiRoute[]> {
  if (points.length < 2) throw new Error("Rota precisa de origem e destino.");
  const data = (await fetchOsrmJson(osrmUrl(points, options.alternatives ?? 0))) as {
    code?: string;
    routes?: OsrmRouteJson[];
  };
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("Não foi possível calcular a rota viária até a propriedade.");
  }
  return data.routes.map(buildRoute);
}

export async function fetchDrivingRoute(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
): Promise<CroquiRoute> {
  const routes = await fetchDrivingRoutes([
    [startLon, startLat],
    [endLon, endLat],
  ]);
  return routes[0];
}

/**
 * Encaixa um ponto na via mais próxima. Pontos de passagem soltos no meio da
 * lavoura fariam o OSRM inventar um desvio até o asfalto e voltar.
 */
export async function fetchNearestOnRoad(
  lon: number,
  lat: number,
): Promise<{ lon: number; lat: number; distanceM: number } | null> {
  try {
    const data = (await fetchOsrmJson(`${OSRM_BASE}/nearest/v1/driving/${lon},${lat}?number=1`)) as {
      code?: string;
      waypoints?: Array<{ location?: [number, number]; distance?: number }>;
    };
    const waypoint = data.waypoints?.[0];
    const location = waypoint?.location;
    if (data.code !== "Ok" || !location || location.length < 2) return null;
    return { lon: location[0], lat: location[1], distanceM: Number(waypoint?.distance || 0) };
  } catch {
    return null;
  }
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

/** Abaixo disso o fim da rota já é a porteira — não inventa trecho off-road. */
const REACH_TOLERANCE_M = Number(process.env.CROQUI_REACH_TOLERANCE_M || 80);

/**
 * Completa o caminho até a divisa quando o OSRM para na via asfaltada mais
 * próxima e a rede OSM não cobre o acesso rural até a porteira.
 *
 * Sem isso o croqui termina quilômetros antes do imóvel (ex.: Estância MDM,
 * Ribeirão Cascalheira — gap de ~1,9 km). O trecho final é linha reta do fim
 * da via mapeada até o ponto da divisa mais próximo — o padrão dos croquis
 * manuais no Google Earth quando não há estrada no OSM.
 */
export function extendRouteToPolygon(
  route: CroquiRoute,
  geometry: Polygon | MultiPolygon,
): { route: CroquiRoute; extended: boolean; gapM: number } {
  const coords = route.coordinates;
  if (!coords.length) return { route, extended: false, gapM: 0 };

  const end = coords[coords.length - 1];
  const gate = destinationOnPolygonBoundary(geometry, end[0], end[1]);
  const gapSegment = lineString([end, [gate.lon, gate.lat]]);
  const gapM = turfLength(gapSegment, { units: "meters" });

  if (!(gapM > REACH_TOLERANCE_M)) {
    return { route, extended: false, gapM };
  }

  const extendedCoords = [...coords, [gate.lon, gate.lat] as Position];
  const waypoints = route.waypoints.map((w) => ({ ...w }));
  if (!waypoints.length) {
    waypoints.push({
      lon: end[0],
      lat: end[1],
      dms: formatDmsPair(end[0], end[1]),
      distanceToNextM: gapM,
      maneuver: "depart",
      roadName: "",
      coordIndex: Math.max(0, coords.length - 1),
    });
  } else {
    const last = waypoints[waypoints.length - 1];
    last.lon = end[0];
    last.lat = end[1];
    last.dms = formatDmsPair(end[0], end[1]);
    last.coordIndex = Math.max(0, coords.length - 1);
    last.distanceToNextM = gapM;
    if (last.maneuver === "arrive") last.maneuver = "straight";
  }

  waypoints.push({
    lon: gate.lon,
    lat: gate.lat,
    dms: formatDmsPair(gate.lon, gate.lat),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: extendedCoords.length - 1,
  });

  return {
    extended: true,
    gapM,
    route: {
      ...route,
      coordinates: extendedCoords,
      waypoints,
      arrivalSide: null,
      totalDistanceM: turfLength(lineString(extendedCoords), { units: "meters" }),
      geometry: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: extendedCoords },
      },
    },
  };
}

/**
 * Garante que o traçado chega na divisa: corta se entra no polígono; senão
 * completa o trecho off-road até a porteira.
 */
export function ensureRouteReachesPolygon(
  route: CroquiRoute,
  geometry: Polygon | MultiPolygon,
): CroquiRoute {
  const cut = trimRouteAtPolygon(route, geometry);
  if (cut.trimmed) return cut.route;
  return extendRouteToPolygon(cut.route, geometry).route;
}

/* ─── Fim da rota dentro do imóvel ─────────────────────────── */

function polygonRings(polygon: Polygon | MultiPolygon): Position[][] {
  if (polygon.type === "Polygon") return polygon.coordinates;
  return polygon.coordinates.flat();
}

/**
 * Só considera "dentro" o ponto que está a mais de `marginM` de qualquer
 * divisa. Um ponto exatamente na porteira (fim do corte) não conta como
 * dentro — o croqui precisa terminar no interior, não na cerca.
 */
function isStrictlyInside(
  polygon: Polygon | MultiPolygon,
  lon: number,
  lat: number,
  marginM = 1,
): boolean {
  const feature = { type: "Feature" as const, properties: {}, geometry: polygon };
  const p = point([lon, lat]);
  if (!booleanPointInPolygon(p, feature)) return false;
  for (const ring of polygonRings(polygon)) {
    const snapped = nearestPointOnLine(lineString(ring), p, { units: "meters" });
    if (Number(snapped.properties?.dist ?? 0) < marginM) return false;
  }
  return true;
}

/**
 * Ponto onde a rota termina dentro do imóvel: a sede da propriedade quando o
 * ponto foi informado e cai dentro do polígono; senão o centroide (quando
 * dentro); último recurso, um ponto sobre a superfície do polígono.
 */
export function interiorDestination(
  polygon: Polygon | MultiPolygon,
  prefer?: { lon: number; lat: number } | null,
): { lon: number; lat: number; label: string | null } {
  if (prefer && Number.isFinite(prefer.lon) && Number.isFinite(prefer.lat)) {
    if (isStrictlyInside(polygon, prefer.lon, prefer.lat)) {
      return { lon: prefer.lon, lat: prefer.lat, label: "sede da propriedade" };
    }
  }
  const feature = { type: "Feature" as const, properties: {}, geometry: polygon };
  const c = centroid(feature);
  const [clon, clat] = c.geometry.coordinates as [number, number];
  if (Number.isFinite(clon) && Number.isFinite(clat) && isStrictlyInside(polygon, clon, clat)) {
    return { lon: clon, lat: clat, label: null };
  }
  const on = pointOnFeature(feature);
  const [olon, olat] = on.geometry.coordinates as [number, number];
  return { lon: olon, lat: olat, label: null };
}

/**
 * Completa o caminho da porteira até o destino dentro do imóvel. O último
 * trecho é linha reta da divisa até a sede (ou o ponto interior) — o mesmo
 * padrão dos croquis manuais, que terminam na sede e não na cerca.
 *
 * Idempotente: rota que já termina no interior volta intacta.
 */
export function extendRouteToInsidePoint(
  route: CroquiRoute,
  polygon: Polygon | MultiPolygon,
  destination: { lon: number; lat: number; label?: string | null },
): { route: CroquiRoute; extended: boolean; legM: number } {
  const coords = route.coordinates;
  if (!coords.length) return { route, extended: false, legM: 0 };

  const end = coords[coords.length - 1];
  if (isStrictlyInside(polygon, end[0], end[1])) {
    return { route, extended: false, legM: 0 };
  }

  const leg = lineString([end, [destination.lon, destination.lat]]);
  const legM = turfLength(leg, { units: "meters" });
  if (!(legM > 0)) return { route, extended: false, legM: 0 };

  const extendedCoords = [...coords, [destination.lon, destination.lat] as Position];
  const waypoints = route.waypoints.map((w) => ({ ...w }));
  if (waypoints.length) {
    const last = waypoints[waypoints.length - 1];
    last.distanceToNextM = legM;
    if (last.maneuver === "arrive") last.maneuver = "straight";
  } else {
    waypoints.push({
      lon: end[0],
      lat: end[1],
      dms: formatDmsPair(end[0], end[1]),
      distanceToNextM: legM,
      maneuver: "straight",
      roadName: "",
      coordIndex: Math.max(0, coords.length - 1),
    });
  }

  waypoints.push({
    lon: destination.lon,
    lat: destination.lat,
    dms: formatDmsPair(destination.lon, destination.lat),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: extendedCoords.length - 1,
  });

  return {
    extended: true,
    legM,
    route: {
      ...route,
      coordinates: extendedCoords,
      waypoints,
      arrivalSide: null,
      destinationLabel: destination.label || route.destinationLabel || null,
      totalDistanceM: turfLength(lineString(extendedCoords), { units: "meters" }),
      geometry: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: extendedCoords },
      },
    },
  };
}

/**
 * Garante que o fim da rota fica DENTRO do imóvel, não na cerca: primeiro
 * alcança a divisa (corte ou extensão), depois completa até a sede quando há
 * uma, senão até um ponto interior do polígono.
 */
export function ensureRouteEndsInsidePolygon(
  route: CroquiRoute,
  polygon: Polygon | MultiPolygon,
  destination?: { lon: number; lat: number; label?: string | null } | null,
): CroquiRoute {
  // Valida e rotula o destino: sede apenas quando cai dentro do polígono,
  // senão cai para o centroide/ponto interior (sem rótulo).
  const dest = interiorDestination(polygon, destination);

  const end = route.coordinates[route.coordinates.length - 1];
  // Já termina dentro do imóvel? Não mexe (idempotente) — só garante o rótulo
  // quando o destino foi informado e a rota ainda não tem um.
  if (end && isStrictlyInside(polygon, end[0], end[1])) {
    if (dest.label && !route.destinationLabel) {
      return { ...route, destinationLabel: dest.label };
    }
    return route;
  }
  const reached = ensureRouteReachesPolygon(route, polygon);
  const extended = extendRouteToInsidePoint(reached, polygon, dest);
  return extended.extended ? extended.route : reached;
}
