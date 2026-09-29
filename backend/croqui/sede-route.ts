/**
 * Sede da propriedade no croqui — pedido do Álvaro (29/09/2026).
 *
 * Quando o usuário marca que a propriedade possui sede, o caminho não termina
 * mais em linha reta da cerca até um ponto qualquer: ele entra pela estrada
 * interna (quando o OSM a conhece) e termina na sede, e o roteiro ganha a
 * frase "Dali, siga pela estrada interna por X até a sede da propriedade,
 * localizada no ponto (DMS)". Para o texto saber onde fica a "entrada da
 * propriedade", a travessia da divisa vira um ponto marcado (`entrance`).
 *
 * Aqui também mora o caminho editado à mão no site: a linha passa exatamente
 * pelos vértices que o usuário deixou, e o roteiro é refeito em cima dela.
 */
import {
  bearing as turfBearing,
  booleanPointInPolygon,
  distance as turfDistance,
  length as turfLength,
  lineIntersect,
  lineString,
  nearestPointOnLine,
  point,
  simplify as turfSimplify,
} from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { formatDmsPair } from "./coords";
import {
  ensureRouteEndsInsidePolygon,
  fetchDrivingRoutes,
  polygonBoundaryLines,
  simplifyRouteSteps,
  type CroquiRoute,
  type RouteWaypoint,
} from "./routing";

export const SEDE_LABEL = "sede da propriedade";

/** Ponto do roteiro original a até isso do caminho editado continua valendo (manobra e via). */
const KEEP_ON_EDIT_M = 25;
/** Curva menor que isso num vértice editado é só um "siga em frente". */
const TURN_MIN_DEG = 30;
/** Fim do caminho a mais que isso da sede ganha o trecho final até ela. */
const SEDE_SNAP_M = 15;
/** Ponto do roteiro a menos disso da entrada no imóvel é absorvido por ela. */
const ENTRANCE_MERGE_M = 100;

type Sede = { lon: number; lat: number };

function isFinitePoint(p: Position | null | undefined): p is Position {
  return !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function meters(a: Position, b: Position): number {
  return turfDistance(point(a as [number, number]), point(b as [number, number]), { units: "meters" });
}

function cumulative(coords: Position[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + meters(coords[i - 1], coords[i]));
  return out;
}

function withCoordinates(route: CroquiRoute, coords: Position[], waypoints: RouteWaypoint[]): CroquiRoute {
  return {
    ...route,
    coordinates: coords,
    waypoints,
    totalDistanceM: coords.length >= 2 ? turfLength(lineString(coords), { units: "meters" }) : 0,
    geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
  };
}

function insidePolygon(polygon: Polygon | MultiPolygon, p: Position): boolean {
  return booleanPointInPolygon(point(p as [number, number]), {
    type: "Feature",
    properties: {},
    geometry: polygon,
  });
}

/**
 * Marca onde o caminho entra no imóvel: a última travessia da divisa de fora
 * para dentro. Entre essa entrada e o fim só fica o trecho interno — os pontos
 * do meio saem do roteiro, porque o texto descreve esse trecho numa frase só e
 * o PDF não pode mostrar pino sem correspondência no texto.
 */
export function markPropertyEntrance(route: CroquiRoute, polygon: Polygon | MultiPolygon): CroquiRoute {
  const coords = route.coordinates;
  if (coords.length < 2 || route.waypoints.length < 2) return route;
  if (insidePolygon(polygon, coords[0])) return route;
  if (!insidePolygon(polygon, coords[coords.length - 1])) return route;

  let crossing = -1;
  for (let i = 0; i < coords.length - 1; i++) {
    if (!insidePolygon(polygon, coords[i]) && insidePolygon(polygon, coords[i + 1])) crossing = i;
  }
  if (crossing < 0) return route;

  const segment = lineString([coords[crossing], coords[crossing + 1]]);
  let entry: Position = coords[crossing + 1];
  let best = Infinity;
  for (const boundary of polygonBoundaryLines(polygon)) {
    for (const hit of lineIntersect(segment, boundary).features) {
      const p = hit.geometry.coordinates;
      const d = meters(p, coords[crossing + 1]);
      if (d < best) {
        best = d;
        entry = p;
      }
    }
  }

  const newCoords = [...coords.slice(0, crossing + 1), entry, ...coords.slice(crossing + 1)];
  const entryIdx = crossing + 1;
  const cum = cumulative(newCoords);
  const lastIdx = newCoords.length - 1;

  const before = route.waypoints
    .filter((w) => w.coordIndex <= crossing)
    .map((w) => ({ ...w, entrance: undefined }));
  if (!before.length) before.push({ ...route.waypoints[0], coordIndex: 0, entrance: undefined });
  // Ponto colado na divisa (a porteira do corte antigo) é a própria entrada —
  // senão o texto ganha um "Siga em frente por 18 m" antes de entrar.
  while (before.length > 1 && cum[entryIdx] - cum[before[before.length - 1].coordIndex] < ENTRANCE_MERGE_M) before.pop();
  const lastBefore = before[before.length - 1];
  lastBefore.distanceToNextM = Math.max(0, cum[entryIdx] - cum[lastBefore.coordIndex]);
  if (lastBefore.maneuver === "arrive") lastBefore.maneuver = "straight";

  const end = route.waypoints[route.waypoints.length - 1];
  const entrance: RouteWaypoint = {
    lon: entry[0],
    lat: entry[1],
    dms: formatDmsPair(entry[0], entry[1]),
    distanceToNextM: Math.max(0, cum[lastIdx] - cum[entryIdx]),
    maneuver: "straight",
    roadName: "",
    coordIndex: entryIdx,
    entrance: true,
  };
  const final: RouteWaypoint = {
    ...end,
    lon: newCoords[lastIdx][0],
    lat: newCoords[lastIdx][1],
    dms: formatDmsPair(newCoords[lastIdx][0], newCoords[lastIdx][1]),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: lastIdx,
    entrance: undefined,
  };
  return { ...withCoordinates(route, newCoords, [...before, entrance, final]), arrivalSide: null };
}

/** Anexa um trecho reto até `target` quando o fim do caminho não está nele. */
function appendLegTo(route: CroquiRoute, target: Position, label: string | null): CroquiRoute {
  const coords = route.coordinates;
  const end = coords[coords.length - 1];
  if (!end || meters(end, target) <= SEDE_SNAP_M) {
    return { ...route, destinationLabel: label ?? route.destinationLabel ?? null };
  }
  const newCoords = [...coords, target];
  const waypoints = route.waypoints.map((w) => ({ ...w }));
  const last = waypoints[waypoints.length - 1];
  if (last) {
    const tail = newCoords.slice(Math.min(last.coordIndex, coords.length - 1));
    last.distanceToNextM = tail.length >= 2 ? turfLength(lineString(tail), { units: "meters" }) : 0;
    if (last.maneuver === "arrive") last.maneuver = "straight";
  }
  waypoints.push({
    lon: target[0],
    lat: target[1],
    dms: formatDmsPair(target[0], target[1]),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: newCoords.length - 1,
  });
  return { ...withCoordinates(route, newCoords, waypoints), arrivalSide: null, destinationLabel: label };
}

/**
 * Caminho que já chegou na divisa (termina na porteira) segue pela estrada
 * interna até a sede quando o OSM tem essa estrada. Só aceita o trajeto que de
 * fato anda por dentro do imóvel e se aproxima da sede — senão devolve null e o
 * chamador completa em linha reta (usuário ajusta os vértices no site).
 */
export async function extendThroughInternalRoad(
  route: CroquiRoute,
  polygon: Polygon | MultiPolygon,
  sede: Sede,
  fetchRoutes: typeof fetchDrivingRoutes = fetchDrivingRoutes,
): Promise<CroquiRoute | null> {
  const coords = route.coordinates;
  const gate = coords[coords.length - 1];
  const target: Position = [sede.lon, sede.lat];
  if (!isFinitePoint(gate)) return null;
  const straightM = meters(gate, target);
  if (straightM < 30) return null;

  let internal: CroquiRoute | undefined;
  try {
    [internal] = await fetchRoutes([gate, target]);
  } catch {
    return null;
  }
  const path = internal?.coordinates || [];
  if (path.length < 2) return null;

  const insideShare = path.filter((p) => insidePolygon(polygon, p)).length / path.length;
  if (insideShare < 0.7) return null;
  if ((internal?.totalDistanceM || 0) > straightM * 3 + 1000) return null;
  // O OSRM encaixa a sede na via mais próxima; se essa via não chega perto dela,
  // não existe estrada interna até a sede no mapa.
  if (meters(path[path.length - 1], target) > straightM * 0.6) return null;

  const joined = [...coords, ...(meters(gate, path[0]) > 1 ? path : path.slice(1))];
  const waypoints = route.waypoints.map((w) => ({ ...w }));
  const last = waypoints[waypoints.length - 1];
  const lastIdx = joined.length - 1;
  if (last) {
    const tail = joined.slice(last.coordIndex);
    last.distanceToNextM = tail.length >= 2 ? turfLength(lineString(tail), { units: "meters" }) : 0;
    if (last.maneuver === "arrive") last.maneuver = "straight";
  }
  waypoints.push({
    lon: joined[lastIdx][0],
    lat: joined[lastIdx][1],
    dms: formatDmsPair(joined[lastIdx][0], joined[lastIdx][1]),
    distanceToNextM: 0,
    maneuver: "arrive",
    roadName: "",
    coordIndex: lastIdx,
  });
  const extended = withCoordinates(route, joined, waypoints);
  return appendLegTo({ ...extended, arrivalSide: null }, target, SEDE_LABEL);
}

/**
 * Última garantia antes de desenhar: com sede, o caminho termina NELA e a
 * entrada no imóvel fica marcada; sem sede, termina no interior do imóvel
 * como sempre (e nunca fala em sede).
 */
export function finalizeCroquiRoute(
  route: CroquiRoute,
  polygon: Polygon | MultiPolygon,
  sede: Sede | null,
): CroquiRoute {
  if (!sede || !insidePolygon(polygon, [sede.lon, sede.lat])) {
    const semSede = route.destinationLabel === SEDE_LABEL ? { ...route, destinationLabel: null } : route;
    return ensureRouteEndsInsidePolygon(semSede, polygon, null);
  }
  const inside = ensureRouteEndsInsidePolygon(route, polygon, sede);
  const atSede = appendLegTo(inside, [sede.lon, sede.lat], SEDE_LABEL);
  return markPropertyEntrance(atSede, polygon);
}

function turnManeuver(prev: Position, at: Position, next: Position): RouteWaypoint["maneuver"] | null {
  const b1 = turfBearing(point(prev as [number, number]), point(at as [number, number]));
  const b2 = turfBearing(point(at as [number, number]), point(next as [number, number]));
  let turn = b2 - b1;
  while (turn > 180) turn -= 360;
  while (turn <= -180) turn += 360;
  if (Math.abs(turn) < TURN_MIN_DEG) return null;
  return turn > 0 ? "right" : "left";
}

/**
 * Caminho com os vértices editados no site. A linha é exatamente a que o
 * usuário deixou; os pontos do roteiro original que continuam sobre ela
 * mantêm a manobra e o nome da via, e os vértices novos viram curva pelo
 * ângulo (trecho editado fica sem nome de via).
 */
export function buildRouteFromEditedLine(input: Position[], base: CroquiRoute | null): CroquiRoute {
  const coords: Position[] = [];
  for (const p of input) {
    if (!isFinitePoint(p)) continue;
    const q: Position = [Number(p[0]), Number(p[1])];
    const prev = coords[coords.length - 1];
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    coords.push(q);
  }
  if (coords.length < 2) throw new Error("O caminho editado precisa de pelo menos dois pontos.");

  const line = lineString(coords);
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const baseLine = base && base.coordinates.length >= 2 ? lineString(base.coordinates) : null;
  const onLine = (p: Position) =>
    nearestPointOnLine(line, point(p as [number, number]), { units: "meters" }).properties;

  const candidates: Array<{ along: number; waypoint: RouteWaypoint }> = [];

  const baseWaypoints = base?.waypoints || [];
  baseWaypoints.forEach((w, i) => {
    if (w.maneuver === "arrive" || w.entrance) return;
    const snap = onLine([w.lon, w.lat]);
    if (Number(snap.dist) > KEEP_ON_EDIT_M) return;
    // A manobra e a via valem para o trecho SEGUINTE. Se esse trecho foi
    // mexido, o ponto sai (a curva nova vem do vértice editado); só a partida
    // fica, sem nome de via.
    const next = baseWaypoints[i + 1];
    const mid = next && base ? base.coordinates[Math.floor((w.coordIndex + next.coordIndex) / 2)] : null;
    const trechoMexido = !mid || Number(onLine(mid).dist) > KEEP_ON_EDIT_M;
    if (trechoMexido && i > 0) return;
    const roadName = trechoMexido ? "" : w.roadName;
    candidates.push({ along: Number(snap.location), waypoint: { ...w, roadName, entrance: undefined } });
  });

  const nearBase = (p: Position) =>
    !!baseLine &&
    Number(nearestPointOnLine(baseLine, point(p as [number, number]), { units: "meters" }).properties.dist) <=
      KEEP_ON_EDIT_M;
  for (let k = 1; k < coords.length - 1; k++) {
    // Vértice que continua sobre o traçado original, seguindo por ele, já está
    // descrito pelos pontos originais.
    const midNext: Position = [(coords[k][0] + coords[k + 1][0]) / 2, (coords[k][1] + coords[k + 1][1]) / 2];
    if (nearBase(coords[k]) && nearBase(midNext)) continue;
    const maneuver = turnManeuver(coords[k - 1], coords[k], coords[k + 1]);
    if (!maneuver) continue;
    candidates.push({
      along: cum[k],
      waypoint: {
        lon: coords[k][0],
        lat: coords[k][1],
        dms: formatDmsPair(coords[k][0], coords[k][1]),
        distanceToNextM: 0,
        maneuver,
        roadName: "",
        coordIndex: k,
      },
    });
  }

  candidates.sort((a, b) => a.along - b.along);
  const first = candidates[0];
  if (!first || first.along > 1) {
    candidates.unshift({
      along: 0,
      waypoint: {
        lon: coords[0][0],
        lat: coords[0][1],
        dms: formatDmsPair(coords[0][0], coords[0][1]),
        distanceToNextM: 0,
        maneuver: "depart",
        roadName: first && first.along <= 1 ? first.waypoint.roadName : "",
        coordIndex: 0,
      },
    });
  }

  const ordered: Array<{ along: number; waypoint: RouteWaypoint }> = [];
  for (const c of candidates) {
    if (c.along >= total - 1) continue;
    const prev = ordered[ordered.length - 1];
    if (prev && c.along - prev.along < 15) continue;
    ordered.push(c);
  }
  const end = coords[coords.length - 1];
  ordered.push({
    along: total,
    waypoint: {
      lon: end[0],
      lat: end[1],
      dms: formatDmsPair(end[0], end[1]),
      distanceToNextM: 0,
      maneuver: "arrive",
      roadName: "",
      coordIndex: coords.length - 1,
    },
  });

  const waypoints = ordered.map(({ along, waypoint }, i) => {
    let coordIndex = 0;
    while (coordIndex < cum.length - 1 && cum[coordIndex + 1] <= along) coordIndex++;
    const nextAlong = ordered[i + 1]?.along ?? along;
    return {
      ...waypoint,
      coordIndex: i === ordered.length - 1 ? coords.length - 1 : coordIndex,
      distanceToNextM: Math.max(0, nextAlong - along),
      maneuver: i === 0 ? ("depart" as const) : waypoint.maneuver,
    };
  });

  return {
    coordinates: coords,
    waypoints: simplifyRouteSteps(waypoints),
    totalDistanceM: total,
    arrivalSide: null,
    destinationLabel: base?.destinationLabel ?? null,
    geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
  };
}

/**
 * Traçado para o mapa do site: fiel à rota (tolerância de ~4 m) e leve o
 * bastante para virar vértices editáveis. O que o usuário editar volta nesta
 * resolução, então ela não pode ser a amostragem grossa de antes.
 */
export function simplifyForEditing(coords: Position[], maxPoints = 400): Position[] {
  if (coords.length <= 2) return coords.map(([lon, lat]) => [round6(lon), round6(lat)]);
  let tolerance = 0.00004;
  let out = coords;
  for (let i = 0; i < 8; i++) {
    out = turfSimplify(lineString(coords), { tolerance, highQuality: true }).geometry.coordinates;
    if (out.length <= maxPoints) break;
    tolerance *= 2;
  }
  return out.map(([lon, lat]) => [round6(lon), round6(lat)]);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
