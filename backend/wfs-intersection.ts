import type { Express } from "express";
import {
  area as turfArea,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  multiPolygon as turfMultiPolygon,
  polygon as turfPolygon,
  union as turfUnion,
} from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";

export type PolygonGeometry = { type: "Polygon"; coordinates: number[][][] };
export type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: number[][][][] };
export type SupportedPolygonGeometry = PolygonGeometry | MultiPolygonGeometry;

type IntersectionStatus =
  | "ok"
  | "not_in_wfs"
  | "no_intersection"
  | "invalid_layer"
  | "error";

type IntersectionResult = {
  layerName: string;
  status: IntersectionStatus;
  matchedFeatures: number;
  intersectionHa: number;
  coveragePercentOfPolygon: number;
  warnings: string[];
};

type IntersectionResponse = {
  ok: boolean;
  wfsSource: string;
  polygonAreaHa: number;
  computedAtIso: string;
  results: IntersectionResult[];
};

type LayerFetchPage = {
  features: Array<{ geometry?: Geometry | null }>;
};

const DEFAULT_WFS_BASE_URL = "https://geo.sema.mt.gov.br/geoserver/ows";
const DEFAULT_WFS_AUTHKEY = "541085de-9a2e-454e-bdba-eb3d57a2f492";
export const WFS_BASE_URL = process.env.WFS_BASE_URL || DEFAULT_WFS_BASE_URL;
export const WFS_AUTHKEY =
  process.env.WFS_AUTHKEY || process.env.SEMA_WMS_AUTHKEY || DEFAULT_WFS_AUTHKEY;
export const WFS_TIMEOUT_MS = Number(process.env.WFS_TIMEOUT_MS ?? "25000");
export const WFS_PAGE_SIZE = Number(process.env.WFS_PAGE_SIZE ?? "2000");
const WFS_MAX_FEATURES_PER_LAYER = Number(
  process.env.WFS_MAX_FEATURES_PER_LAYER ?? "50000",
);
const CAPABILITIES_TTL_MS = 10 * 60 * 1000;
const DESCRIBE_TTL_MS = 30 * 60 * 1000;
const LAYER_NAME_REGEX = /^[A-Za-z0-9_]+:[A-Za-z0-9_]+$/;

let capabilitiesCache:
  | {
    expiresAt: number;
    layerNames: Set<string>;
    featureTypeCount: number;
  }
  | null = null;

const describeCache = new Map<
  string,
  { expiresAt: number; geometryField: string }
>();

function nowMs() {
  return Date.now();
}

function sanitizeLayerNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const layerName = raw.trim();
    if (!layerName) continue;
    if (!LAYER_NAME_REGEX.test(layerName)) continue;
    if (seen.has(layerName)) continue;
    seen.add(layerName);
    out.push(layerName);
  }
  return out;
}

export function buildWfsUrl(
  params: Record<string, string | number | undefined>,
  options: { includeAuthkey?: boolean } = {},
) {
  const url = new URL(WFS_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  if (options.includeAuthkey !== false && WFS_AUTHKEY) {
    url.searchParams.set("authkey", WFS_AUTHKEY);
  }
  return url.toString();
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchFailure(error: any, timeoutMs: number): string {
  if (error?.name === "AbortError") {
    return `WFS timeout apos ${Math.round(timeoutMs / 1000)}s`;
  }
  const cause = error?.cause;
  const causeCode = cause?.code ? String(cause.code) : "";
  const causeMessage = cause?.message ? String(cause.message) : "";
  const detail = [causeCode, causeMessage].filter(Boolean).join(": ");
  const message = String(error?.message || "falha de rede").trim();
  return detail ? `WFS ${message} (${detail})` : `WFS ${message}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (error: any) {
      lastError = error;
      if (attempt < 2) await sleepMs(500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(describeFetchFailure(lastError, timeoutMs));
}

export async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WFS ${response.status}: ${text.slice(0, 220)}`);
  }
  return await response.text();
}

export async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WFS ${response.status}: ${text.slice(0, 220)}`);
  }
  return (await response.json()) as T;
}

export function parseWfsLayerNamesFromCapabilities(xml: string) {
  const names: string[] = [];
  const regex =
    /<FeatureType\b[\s\S]*?<Name>\s*([^<]+)\s*<\/Name>[\s\S]*?<\/FeatureType>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const name = String(match[1] || "").trim();
    if (!name || !name.includes(":")) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

function parseNumberMatched(xml: string): number | null {
  const match = xml.match(/numberMatched="([^"]+)"/i);
  if (!match) return null;
  const raw = String(match[1] || "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseGeometryFieldFromDescribe(xml: string) {
  const candidates = [...xml.matchAll(
    /<xsd:element[^>]*name="([^"]+)"[^>]*type="gml:[^"]*PropertyType"/gi,
  )]
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);
  if (!candidates.length) return "GEOMETRY";
  const preferred = candidates.find((name) => name.toUpperCase() === "GEOMETRY");
  return preferred || candidates[0];
}

export async function getCapabilitiesCached(forceRefresh = false) {
  const current = capabilitiesCache;
  if (!forceRefresh && current && current.expiresAt > nowMs()) {
    return current;
  }
  const url = buildWfsUrl({
    service: "WFS",
    request: "GetCapabilities",
    version: "2.0.0",
  });
  const xml = await fetchTextWithTimeout(url, WFS_TIMEOUT_MS);
  const layerNames = parseWfsLayerNamesFromCapabilities(xml);
  const next = {
    expiresAt: nowMs() + CAPABILITIES_TTL_MS,
    layerNames: new Set(layerNames),
    featureTypeCount: layerNames.length,
  };
  capabilitiesCache = next;
  return next;
}

export async function getGeometryFieldForLayer(layerName: string) {
  const cached = describeCache.get(layerName);
  if (cached && cached.expiresAt > nowMs()) {
    return cached.geometryField;
  }
  const url = buildWfsUrl({
    service: "WFS",
    version: "2.0.0",
    request: "DescribeFeatureType",
    typeNames: layerName,
  });
  const xml = await fetchTextWithTimeout(url, WFS_TIMEOUT_MS);
  const geometryField = parseGeometryFieldFromDescribe(xml);
  describeCache.set(layerName, {
    expiresAt: nowMs() + DESCRIBE_TTL_MS,
    geometryField,
  });
  return geometryField;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeRing(ring: unknown): number[][] | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out: number[][] = [];
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const x = point[0];
    const y = point[1];
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return null;
    out.push([x, y]);
  }
  if (out.length < 3) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : null;
}

export function normalizePolygonGeometry(input: unknown): SupportedPolygonGeometry | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { type?: unknown; coordinates?: unknown };
  if (raw.type === "Polygon") {
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length === 0) return null;
    const rings: number[][][] = [];
    for (const ring of raw.coordinates) {
      const normalized = normalizeRing(ring);
      if (!normalized) return null;
      rings.push(normalized);
    }
    return { type: "Polygon", coordinates: rings };
  }
  if (raw.type === "MultiPolygon") {
    if (!Array.isArray(raw.coordinates) || raw.coordinates.length === 0) return null;
    const polygons: number[][][][] = [];
    for (const poly of raw.coordinates) {
      if (!Array.isArray(poly) || poly.length === 0) return null;
      const rings: number[][][] = [];
      for (const ring of poly) {
        const normalized = normalizeRing(ring);
        if (!normalized) return null;
        rings.push(normalized);
      }
      polygons.push(rings);
    }
    return { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}

function numberToWkt(value: number) {
  return Number(value.toFixed(8)).toString();
}

function ringToWkt(ring: number[][]) {
  return ring.map(([x, y]) => `${numberToWkt(x)} ${numberToWkt(y)}`).join(",");
}

export function polygonToWkt(geometry: SupportedPolygonGeometry) {
  if (geometry.type === "Polygon") {
    return `POLYGON(${geometry.coordinates.map((ring) => `(${ringToWkt(ring)})`).join(",")})`;
  }
  return `MULTIPOLYGON(${geometry.coordinates
    .map((poly) => `(${poly.map((ring) => `(${ringToWkt(ring)})`).join(",")})`)
    .join(",")})`;
}

function toPolygonFeature(
  geometry: SupportedPolygonGeometry,
): Feature<Polygon | MultiPolygon> {
  if (geometry.type === "Polygon") {
    return turfPolygon(geometry.coordinates);
  }
  return turfMultiPolygon(geometry.coordinates);
}

export function toPolygonOrMultiFeature(
  geometry: Geometry | null | undefined,
): Feature<Polygon | MultiPolygon> | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") {
    return {
      type: "Feature",
      properties: {},
      geometry: geometry as Polygon,
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "Feature",
      properties: {},
      geometry: geometry as MultiPolygon,
    };
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

async function computeIntersectionForLayer(args: {
  layerName: string;
  polygonGeometry: SupportedPolygonGeometry;
  polygonFeature: Feature<Polygon | MultiPolygon>;
  polygonWkt: string;
  polygonAreaHa: number;
}) {
  const { layerName, polygonFeature, polygonWkt, polygonAreaHa } = args;
  const warnings: string[] = [];
  const startedAt = Date.now();

  try {
    const geometryField = await getGeometryFieldForLayer(layerName);
    const cqlFilter = `INTERSECTS(${geometryField},${polygonWkt})`;

    const hitsUrl = buildWfsUrl({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: layerName,
      resultType: "hits",
      CQL_FILTER: cqlFilter,
    });
    const hitsXml = await fetchTextWithTimeout(hitsUrl, WFS_TIMEOUT_MS);
    const numberMatched = parseNumberMatched(hitsXml);
    if (numberMatched === 0) {
      return {
        layerName,
        status: "no_intersection" as const,
        matchedFeatures: 0,
        intersectionHa: 0,
        coveragePercentOfPolygon: 0,
        warnings,
      };
    }

    let startIndex = 0;
    let totalFetched = 0;
    const clipped: Array<Feature<Polygon | MultiPolygon>> = [];
    let usedSinglePageFallback = false;

    while (true) {
      if (totalFetched >= WFS_MAX_FEATURES_PER_LAYER) {
        warnings.push(
          `Limite de ${WFS_MAX_FEATURES_PER_LAYER} feicoes atingido; resultado parcial.`,
        );
        break;
      }

      const pageSize = Math.min(
        WFS_PAGE_SIZE,
        WFS_MAX_FEATURES_PER_LAYER - totalFetched,
      );
      if (pageSize <= 0) break;

      const pageUrl = buildWfsUrl({
        service: "WFS",
        version: "2.0.0",
        request: "GetFeature",
        typeNames: layerName,
        outputFormat: "application/json",
        srsName: "EPSG:4326",
        startIndex,
        count: pageSize,
        CQL_FILTER: cqlFilter,
      });

      let page: LayerFetchPage;
      try {
        page = await fetchJsonWithTimeout<LayerFetchPage>(pageUrl, WFS_TIMEOUT_MS);
      } catch (error: any) {
        const message = String(error?.message || "");
        const isBadRequest = /\bWFS 400\b/i.test(message);
        const requiresManualSorting =
          /natural order without a primary key/i.test(message) ||
          /Cannot do natural order without a primary key/i.test(message);
        if ((!requiresManualSorting && !isBadRequest) || usedSinglePageFallback) {
          throw error;
        }

        const fallbackCount = Math.min(WFS_MAX_FEATURES_PER_LAYER, Math.max(100, WFS_PAGE_SIZE));
        const fallbackUrl = buildWfsUrl({
          service: "WFS",
          version: "2.0.0",
          request: "GetFeature",
          typeNames: layerName,
          outputFormat: "application/json",
          srsName: "EPSG:4326",
          count: fallbackCount,
          CQL_FILTER: cqlFilter,
        });
        page = await fetchJsonWithTimeout<LayerFetchPage>(fallbackUrl, WFS_TIMEOUT_MS);
        usedSinglePageFallback = true;
        let warningMessage =
          `WFS sem paginacao com startIndex para esta camada; calculo limitado a ate ${fallbackCount} feicoes por chamada.`;
        if (numberMatched !== null && numberMatched > fallbackCount) {
          warningMessage =
            `WFS sem paginacao com startIndex para esta camada; total estimado ${numberMatched} feicoes, calculo limitado a ${fallbackCount}.`;
        }
        warnings.push(warningMessage);
      }
      const features = Array.isArray(page.features) ? page.features : [];
      if (!features.length) break;

      for (const rawFeature of features) {
        const polygonLike = toPolygonOrMultiFeature(rawFeature.geometry);
        if (!polygonLike) continue;
        const fc = turfFeatureCollection([polygonFeature, polygonLike]) as FeatureCollection<
          Polygon | MultiPolygon
        >;
        const intersection = turfIntersect(fc);
        if (!intersection) continue;
        clipped.push(intersection as Feature<Polygon | MultiPolygon>);
      }

      totalFetched += features.length;
      startIndex += features.length;

      if (usedSinglePageFallback) break;
      if (features.length < pageSize) break;
      if (numberMatched !== null && startIndex >= numberMatched) break;
    }

    if (!clipped.length) {
      return {
        layerName,
        status: "no_intersection" as const,
        matchedFeatures: numberMatched ?? totalFetched,
        intersectionHa: 0,
        coveragePercentOfPolygon: 0,
        warnings,
      };
    }

    let merged = clipped[0];
    for (let i = 1; i < clipped.length; i += 1) {
      const fc = turfFeatureCollection([merged, clipped[i]]) as FeatureCollection<
        Polygon | MultiPolygon
      >;
      const unioned = turfUnion(fc);
      if (!unioned) {
        warnings.push("Falha ao unir geometrias de intersecao; mantendo uniao parcial.");
        continue;
      }
      merged = unioned as Feature<Polygon | MultiPolygon>;
    }

    const intersectionSqm = turfArea(merged);
    const intersectionHa = Number((intersectionSqm / 10000).toFixed(4));
    const coveragePercentOfPolygon =
      polygonAreaHa > 0
        ? Number(((intersectionHa / polygonAreaHa) * 100).toFixed(4))
        : 0;

    console.log(
      `[WFS INTERSECTION] layer=${layerName} matched=${numberMatched ?? "unknown"} fetched=${totalFetched} ha=${intersectionHa} ms=${Date.now() - startedAt}`,
    );

    return {
      layerName,
      status: "ok" as const,
      matchedFeatures: numberMatched ?? totalFetched,
      intersectionHa,
      coveragePercentOfPolygon,
      warnings,
    };
  } catch (error: any) {
    console.error(`[WFS INTERSECTION] layer=${layerName} error:`, error?.message || error);
    return {
      layerName,
      status: "error" as const,
      matchedFeatures: 0,
      intersectionHa: 0,
      coveragePercentOfPolygon: 0,
      warnings: [...warnings, String(error?.message || error || "Erro interno")],
    };
  }
}

export function registerWfsIntersectionRoutes(app: Express) {
  app.get("/api/wfs/health", async (_req, res) => {
    const startedAt = Date.now();
    try {
      const caps = await getCapabilitiesCached(true);
      res.json({
        ok: true,
        latencyMs: Date.now() - startedAt,
        featureTypeCount: caps.featureTypeCount,
        wfsSource: WFS_BASE_URL,
        testedAtIso: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(502).json({
        ok: false,
        latencyMs: Date.now() - startedAt,
        wfsSource: WFS_BASE_URL,
        testedAtIso: new Date().toISOString(),
        error: String(error?.message || error || "Falha no WFS"),
      });
    }
  });

  app.post("/api/map/intersection-hectares", async (req, res) => {
    try {
      const polygonInput = normalizePolygonGeometry(
        (req.body as { polygon?: unknown })?.polygon,
      );
      if (!polygonInput) {
        res.status(400).json({ error: "polygon invalido. Use GeoJSON Polygon/MultiPolygon." });
        return;
      }

      const crs = String((req.body as { crs?: string })?.crs || "EPSG:4326");
      if (crs.toUpperCase() !== "EPSG:4326") {
        res.status(400).json({ error: "Apenas CRS EPSG:4326 e suportado neste endpoint." });
        return;
      }

      const layerNames = sanitizeLayerNames((req.body as { layerNames?: unknown })?.layerNames);
      if (!layerNames.length) {
        const polygonFeature = toPolygonFeature(polygonInput);
        const polygonAreaHa = Number((turfArea(polygonFeature) / 10000).toFixed(4));
        const emptyResponse: IntersectionResponse = {
          ok: true,
          wfsSource: WFS_BASE_URL,
          polygonAreaHa,
          computedAtIso: new Date().toISOString(),
          results: [],
        };
        res.json(emptyResponse);
        return;
      }

      const capabilities = await getCapabilitiesCached(false);
      const available = capabilities.layerNames;

      const polygonFeature = toPolygonFeature(polygonInput);
      const polygonAreaHa = Number((turfArea(polygonFeature) / 10000).toFixed(4));
      const polygonWkt = polygonToWkt(polygonInput);

      const validLayers: string[] = [];
      const invalidLayerResults: IntersectionResult[] = [];

      for (const layerName of layerNames) {
        if (!available.has(layerName)) {
          invalidLayerResults.push({
            layerName,
            status: "not_in_wfs",
            matchedFeatures: 0,
            intersectionHa: 0,
            coveragePercentOfPolygon: 0,
            warnings: ["Camada nao encontrada no WFS atual."],
          });
          continue;
        }
        validLayers.push(layerName);
      }

      const computedValidResults = await mapWithConcurrency(
        validLayers,
        3,
        async (layerName) =>
          computeIntersectionForLayer({
            layerName,
            polygonGeometry: polygonInput,
            polygonFeature,
            polygonWkt,
            polygonAreaHa,
          }),
      );

      const byLayer = new Map<string, IntersectionResult>();
      for (const item of [...invalidLayerResults, ...computedValidResults]) {
        byLayer.set(item.layerName, item);
      }

      const orderedResults = layerNames.map(
        (layerName) =>
          byLayer.get(layerName) || {
            layerName,
            status: "invalid_layer" as const,
            matchedFeatures: 0,
            intersectionHa: 0,
            coveragePercentOfPolygon: 0,
            warnings: ["Camada invalida."],
          },
      );

      const response: IntersectionResponse = {
        ok: true,
        wfsSource: WFS_BASE_URL,
        polygonAreaHa,
        computedAtIso: new Date().toISOString(),
        results: orderedResults,
      };
      res.json(response);
    } catch (error: any) {
      console.error("Erro no /api/map/intersection-hectares:", error);
      res.status(500).json({ error: String(error?.message || "Erro interno") });
    }
  });
}
