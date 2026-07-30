/**
 * Caminhos de acesso alternativos.
 *
 * O OSRM público quase sempre devolve um traçado só (`alternatives` não vem
 * habilitado), e no rural de MT o caminho mais curto nem sempre é o que se usa
 * — no Lote 89-A de Querência ele sobe pelo oeste, enquanto o acesso real vai
 * pelo leste. Aqui os corredores são descobertos à força: pontos de passagem
 * jogados de lado a lado da rota principal, cada um roteado de novo, limpo dos
 * vai-e-volta que o desvio forçado cria e comparado com os já aceitos.
 *
 * A escolha entre eles é do usuário — este módulo só garante que as opções
 * sejam poucas, distintas e percorríveis.
 */
import {
  along as turfAlong,
  bearing as turfBearing,
  destination as turfDestination,
  length as turfLength,
  lineString,
  nearestPointOnLine,
  point,
} from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import {
  destinationOnPolygonBoundary,
  fetchDrivingRoutes,
  fetchNearestOnRoad,
  trimRouteAtPolygon,
  type CroquiRoute,
} from "./routing";

export type RouteOptionSummary = {
  id: string;
  label: string;
  /** "leste", "oeste"… — de que lado o traçado se afasta da rota mais curta. */
  side: string | null;
  totalDistanceM: number;
  roads: string[];
  recommended: boolean;
};

export type RouteOption = RouteOptionSummary & { route: CroquiRoute };

/** Célula usada para comparar traçados: dois pontos na mesma célula são "o mesmo lugar". */
const CELL_M = 400;
/** Acima disso duas rotas são a mesma coisa e a mais longa é descartada. */
const OVERLAP_LIMIT = 0.65;
/** Rota mais de N× a mais curta não é alternativa, é volta ao mundo. */
const MAX_DETOUR_RATIO = 3.5;
const MAX_OPTIONS = Number(process.env.CROQUI_MAX_ROUTE_OPTIONS || 4);
/** Ponto de passagem que só encontra via a mais que isso não vira candidato. */
const MAX_SNAP_M = 6000;
/** Teto de tempo da busca — a requisição atravessa o túnel e não pode estourar. */
const BUDGET_MS = Number(process.env.CROQUI_ROUTE_OPTIONS_BUDGET_MS || 70000);

const DEG_PER_M_LAT = 1 / 110540;

function cellKey(lon: number, lat: number, cellM: number): string {
  const latCell = Math.round(lat / (cellM * DEG_PER_M_LAT));
  const lonPerM = 1 / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const lonCell = Math.round(lon / (cellM * lonPerM));
  return `${lonCell}:${latCell}`;
}

export function cellKeySet(coords: Position[], cellM = CELL_M): Set<string> {
  const set = new Set<string>();
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    set.add(cellKey(lon, lat, cellM));
  }
  return set;
}

/** Fração das células do traçado menor que também estão no maior. */
export function routeOverlapRatio(a: Position[], b: Position[], cellM = CELL_M): number {
  const setA = cellKeySet(a, cellM);
  const setB = cellKeySet(b, cellM);
  if (!setA.size || !setB.size) return 0;
  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let shared = 0;
  for (const key of small) if (big.has(key)) shared++;
  return shared / small.size;
}

/**
 * Remove trechos em que a rota vai e volta pelo mesmo lugar. Um desvio forçado
 * por ponto de passagem fora de rota produz exatamente isso; como o trecho sai
 * e retorna ao mesmo nó, tirá-lo deixa um traçado ainda percorrível.
 */
export function stripOutAndBackSpurs(
  coords: Position[],
  options: { cellM?: number; minSpurM?: number; maxPasses?: number } = {},
): Position[] {
  const cellM = options.cellM ?? 120;
  const minSpurM = options.minSpurM ?? 500;
  const maxPasses = options.maxPasses ?? 6;
  let current = coords.slice();

  for (let pass = 0; pass < maxPasses; pass++) {
    const firstSeen = new Map<string, number>();
    let best: { from: number; to: number } | null = null;
    for (let i = 0; i < current.length; i++) {
      const key = cellKey(current[i][0], current[i][1], cellM);
      const seen = firstSeen.get(key);
      if (seen === undefined) {
        firstSeen.set(key, i);
        continue;
      }
      if (!best || i - seen > best.to - best.from) best = { from: seen, to: i };
    }
    if (!best || best.to - best.from < 4) break;
    const spur = current.slice(best.from, best.to + 1);
    if (spur.length < 2 || turfLength(lineString(spur), { units: "meters" }) < minSpurM) break;
    current = [...current.slice(0, best.from + 1), ...current.slice(best.to + 1)];
  }
  return current;
}

/**
 * Pontos de passagem candidatos: jogados perpendicularmente à rota de
 * referência, de um lado e do outro, em algumas alturas do percurso.
 */
export function perpendicularViaPoints(
  coords: Position[],
  fractions: number[],
  offsetsKm: number[],
): Position[] {
  if (coords.length < 2) return [];
  const line = lineString(coords);
  const totalKm = turfLength(line, { units: "kilometers" });
  if (!(totalKm > 0)) return [];
  const out: Position[] = [];
  for (const fraction of fractions) {
    const atKm = totalKm * fraction;
    const here = turfAlong(line, atKm, { units: "kilometers" });
    const aheadKm = Math.min(totalKm, atKm + Math.max(totalKm * 0.02, 0.5));
    const ahead = turfAlong(line, aheadKm, { units: "kilometers" });
    const heading = turfBearing(here, ahead);
    for (const offsetKm of offsetsKm) {
      const side = heading + (offsetKm >= 0 ? 90 : -90);
      const moved = turfDestination(here, Math.abs(offsetKm), side, { units: "kilometers" });
      out.push(moved.geometry.coordinates);
    }
  }
  return out;
}

/** Ponto do traçado mais afastado da rota de referência — é o que o identifica. */
export function mostDistinctivePoint(
  coords: Position[],
  reference: Position[],
): { position: Position; distanceKm: number } | null {
  if (coords.length < 2 || reference.length < 2) return null;
  const refLine = lineString(reference);
  let best: { position: Position; distanceKm: number } | null = null;
  const step = Math.max(1, Math.floor(coords.length / 120));
  for (let i = 0; i < coords.length; i += step) {
    const snapped = nearestPointOnLine(refLine, point(coords[i] as [number, number]), {
      units: "kilometers",
    });
    const distanceKm = Number(snapped.properties?.dist || 0);
    if (!best || distanceKm > best.distanceKm) best = { position: coords[i], distanceKm };
  }
  return best;
}

const CARDINAIS: Array<{ max: number; nome: string }> = [
  { max: 22.5, nome: "norte" },
  { max: 67.5, nome: "nordeste" },
  { max: 112.5, nome: "leste" },
  { max: 157.5, nome: "sudeste" },
  { max: 202.5, nome: "sul" },
  { max: 247.5, nome: "sudoeste" },
  { max: 292.5, nome: "oeste" },
  { max: 337.5, nome: "noroeste" },
];

export function cardinalOf(bearingDeg: number): string {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  for (const item of CARDINAIS) if (normalized < item.max) return item.nome;
  return "norte";
}

/** De que lado o traçado se afasta da rota de referência. */
export function deviationSide(coords: Position[], reference: Position[]): string | null {
  const distinctive = mostDistinctivePoint(coords, reference);
  if (!distinctive || distinctive.distanceKm < 0.5) return null;
  const snapped = nearestPointOnLine(
    lineString(reference),
    point(distinctive.position as [number, number]),
  );
  return cardinalOf(turfBearing(snapped, point(distinctive.position as [number, number])));
}

/** Vias com nome que o trecho percorre, na ordem, sem repetir. */
export function summarizeRoads(route: CroquiRoute, limit = 4): string[] {
  const out: string[] = [];
  for (const waypoint of route.waypoints) {
    const name = String(waypoint.roadName || "").trim();
    if (!name || name === "-" || out.includes(name)) continue;
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

/**
 * `ordinal` distingue dois desvios que saem para o mesmo lado — sem ele o
 * usuário veria duas linhas com o mesmo nome e teria de adivinhar qual é qual.
 */
export function labelForOption(
  index: number,
  side: string | null,
  totalDistanceM: number,
  ordinal = 1,
): string {
  if (index === 0) return `Caminho principal — ${formatKm(totalDistanceM)}`;
  const lado = side ? `pelo ${side}` : `alternativo ${index + 1}`;
  const sufixo = ordinal > 1 ? ` (${ordinal})` : "";
  return `Caminho ${lado}${sufixo} — ${formatKm(totalDistanceM)}`;
}

/**
 * Roteia até o centroide e corta na divisa: o corte é o acesso real. Quando a
 * rota nem chega a entrar no imóvel, refaz mirando o ponto de divisa mais
 * próximo — mesmo comportamento de antes, agora reaproveitado por candidato.
 */
async function routeToProperty(
  waypoints: Position[],
  atpGeometry: Polygon | MultiPolygon,
): Promise<CroquiRoute | null> {
  try {
    const [candidate] = await fetchDrivingRoutes(waypoints);
    const cut = trimRouteAtPolygon(candidate, atpGeometry);
    if (cut.trimmed) return cut.route;
    const start = waypoints[0];
    const dest = destinationOnPolygonBoundary(atpGeometry, start[0], start[1]);
    const rerouted = await fetchDrivingRoutes([
      ...waypoints.slice(0, -1),
      [dest.lon, dest.lat],
    ]);
    return trimRouteAtPolygon(rerouted[0], atpGeometry).route;
  } catch {
    return null;
  }
}

function hasSpur(coords: Position[]): boolean {
  return stripOutAndBackSpurs(coords).length < coords.length;
}

export type DiscoverRouteOptionsArgs = {
  startLon: number;
  startLat: number;
  destLon: number;
  destLat: number;
  atpGeometry: Polygon | MultiPolygon;
  maxOptions?: number;
  onProgress?: (message: string) => void;
};

export async function discoverRouteOptions(args: DiscoverRouteOptionsArgs): Promise<RouteOption[]> {
  const { startLon, startLat, destLon, destLat, atpGeometry } = args;
  const maxOptions = Math.max(1, args.maxOptions ?? MAX_OPTIONS);
  const start: Position = [startLon, startLat];
  const notify = args.onProgress || (() => {});
  const deadline = Date.now() + BUDGET_MS;

  const primary = await routeToProperty([start, [destLon, destLat]], atpGeometry);
  if (!primary) throw new Error("Não foi possível calcular a rota viária até a propriedade.");

  const accepted: CroquiRoute[] = [primary];
  const reference = primary.coordinates;

  // O OSRM só devolve alternativas quando o servidor traz o recurso ligado;
  // quando traz, elas saem de graça e entram antes das buscas por desvio.
  try {
    const variants = await fetchDrivingRoutes([start, [destLon, destLat]], { alternatives: 3 });
    for (const variant of variants.slice(1)) {
      const cut = trimRouteAtPolygon(variant, atpGeometry);
      pushIfDistinct(accepted, cut.route, maxOptions);
    }
  } catch {
    // sem alternativas nativas: segue só com os desvios forçados
  }

  if (accepted.length < maxOptions) {
    const vias = perpendicularViaPoints(reference, [0.3, 0.5, 0.7], [8, -8, 20, -20]);
    const snapped: Position[] = [];
    for (const via of vias) {
      if (Date.now() > deadline) break;
      const near = await fetchNearestOnRoad(via[0], via[1]);
      if (!near || near.distanceM > MAX_SNAP_M) continue;
      const position: Position = [near.lon, near.lat];
      if (snapped.some((other) => haversineM(other, position) < 2000)) continue;
      snapped.push(position);
    }

    notify(`Avaliando ${snapped.length} desvios possíveis...`);
    for (const via of snapped) {
      if (accepted.length >= maxOptions || Date.now() > deadline) break;
      const candidate = await routeToProperty([start, via, [destLon, destLat]], atpGeometry);
      if (!candidate) continue;

      // O desvio forçado costuma criar um vai-e-volta até o ponto de passagem.
      // Em vez de entregar o traçado sujo, refaz a rota mirando o trecho que
      // realmente diferencia o corredor descoberto.
      let clean = candidate;
      if (hasSpur(candidate.coordinates)) {
        const stripped = stripOutAndBackSpurs(candidate.coordinates);
        const distinctive = mostDistinctivePoint(stripped, reference);
        if (!distinctive || distinctive.distanceKm < 1) continue;
        const retry = await routeToProperty(
          [start, distinctive.position, [destLon, destLat]],
          atpGeometry,
        );
        if (!retry || hasSpur(retry.coordinates)) continue;
        clean = retry;
      }
      pushIfDistinct(accepted, clean, maxOptions);
    }
  }

  const shortest = Math.min(...accepted.map((route) => route.totalDistanceM || Infinity));
  const viable = accepted.filter(
    (route, index) => index === 0 || route.totalDistanceM <= shortest * MAX_DETOUR_RATIO,
  );
  viable.sort((a, b) => a.totalDistanceM - b.totalDistanceM);

  const usados = new Map<string, number>();
  return viable.slice(0, maxOptions).map((route, index) => {
    const side = index === 0 ? null : deviationSide(route.coordinates, viable[0].coordinates);
    const chave = side || `alt-${index}`;
    const ordinal = (usados.get(chave) || 0) + 1;
    usados.set(chave, ordinal);
    return {
      id: `rota-${index + 1}`,
      label: labelForOption(index, side, route.totalDistanceM, ordinal),
      side,
      totalDistanceM: route.totalDistanceM,
      roads: summarizeRoads(route),
      recommended: index === 0,
      route,
    };
  });
}

function pushIfDistinct(accepted: CroquiRoute[], candidate: CroquiRoute, maxOptions: number): void {
  if (accepted.length >= maxOptions) return;
  if (candidate.coordinates.length < 2) return;
  for (const existing of accepted) {
    if (routeOverlapRatio(existing.coordinates, candidate.coordinates) >= OVERLAP_LIMIT) return;
  }
  accepted.push(candidate);
}

function haversineM(a: Position, b: Position): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Traçado leve para o mapinha de escolha — o PDF continua usando a rota cheia. */
export function decimateCoordinates(coords: Position[], maxPoints = 160): Position[] {
  if (coords.length <= maxPoints) return coords.map(([lon, lat]) => [round6(lon), round6(lat)]);
  const step = coords.length / maxPoints;
  const out: Position[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const [lon, lat] = coords[Math.floor(i * step)];
    out.push([round6(lon), round6(lat)]);
  }
  const [lon, lat] = coords[coords.length - 1];
  out.push([round6(lon), round6(lat)]);
  return out;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
