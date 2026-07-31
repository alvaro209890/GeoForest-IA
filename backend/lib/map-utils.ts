/**
 * Map utilities — WMS capabilities, snapshot cache, imagery layer parsing.
 * Extraído de backend/index.ts (plano 01).
 */

export const SEMA_WMS_BASE =
  process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
export const SEMA_WMS_AUTHKEY =
  process.env.SEMA_WMS_AUTHKEY ||
  "541085de-9a2e-454e-bdba-eb3d57a2f492";
export const readPositiveInt = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};
export const MAP_CAPABILITIES_TTL_MS = readPositiveInt(
  process.env.MAP_CAPABILITIES_TTL_MS,
  5 * 60 * 1000,
);
export const MAP_SNAPSHOT_TTL_MS = readPositiveInt(
  process.env.MAP_SNAPSHOT_TTL_MS,
  10 * 60 * 1000,
);
export const MAP_SNAPSHOT_CACHE_MAX_ITEMS = readPositiveInt(
  process.env.MAP_SNAPSHOT_CACHE_MAX_ITEMS,
  40,
);
export const CURATED_IMAGERY_LAYER_NAMES = [
  "SEMAMT:ALOS_PALSAR_DEM",
  "Geoportal:DECLIVIDADE_GEOPORTAL",
  "Mosaicos:LANDSAT_5_1984",
  "semamt:LANDSAT_5",
  "Mosaicos:LANDSAT_5_1985",
  "Mosaicos:LANDSAT_5_1986",
  "Mosaicos:LANDSAT_5_1987",
  "Mosaicos:LANDSAT_5_1988",
  "Mosaicos:LANDSAT_5_1989",
  "Mosaicos:LANDSAT_5_1990",
  "Mosaicos:LANDSAT_5_1991",
  "Mosaicos:LANDSAT_5_1992",
  "Mosaicos:LANDSAT_5_1993",
  "Mosaicos:LANDSAT_5_1994",
  "Mosaicos:LANDSAT_5_1995",
  "Mosaicos:LANDSAT_5_1996",
  "Mosaicos:LANDSAT_5_1997",
  "Mosaicos:LANDSAT_5_1998",
  "Mosaicos:LANDSAT_5_1999",
  "Mosaicos:LANDSAT_5_2000",
  "Mosaicos:LANDSAT_5_2003",
  "Mosaicos:LANDSAT_5_2004",
  "Mosaicos:LANDSAT_5_2005",
  "Mosaicos:LANDSAT_5_2006",
  "Mosaicos:LANDSAT_5_2007",
  "Mosaicos:LANDSAT_5_2008",
  "Mosaicos:LANDSAT_5_2009",
  "Mosaicos:LANDSAT_5_2010",
  "Mosaicos:LANDSAT_5_2011",
  "Mosaicos:LANDSAT_7_2002",
  "Mosaicos:LANDSAT_8_2013",
  "Mosaicos:LANDSAT_8_2014",
  "Mosaicos:LANDSAT_8_2015",
  "Mosaicos:LANDSAT_8_2016",
  "Mosaicos:LANDSAT_8_2017",
  "Mosaicos:MOSAICO_SPOT_SEPLAN",
  "Mosaicos:RESOURCESAT_2012",
  "Mosaicos:SENTINEL_2_2016",
  "Mosaicos:Geoportal_Sentinel_2_2016_NIR",
  "Mosaicos:SENTINEL_2_2017",
  "Mosaicos:Geoportal_Sentinel_2_2017_NIR",
  "Mosaicos:SENTINEL_2_2018",
  "Mosaicos:Geoportal_Sentinel_2_2018_NIR",
  "Mosaicos:SENTINEL_2_2019",
  "Mosaicos:SENTINEL_2_2020",
  "Mosaicos:Geoportal_Sentinel_2_2020_NIR",
  "Mosaicos:SENTINEL_2_2021",
  "Mosaicos:Geoportal_Sentinel_2_2021_NIR",
  "Mosaicos:SENTINEL_2_2022",
  "Mosaicos:SENTINEL_2_2023",
  "Mosaicos:SENTINEL_2_2024",
] as const;
export const CURATED_IMAGERY_ORDER_MAP = new Map<string, number>();
for (const name of CURATED_IMAGERY_LAYER_NAMES) {
  const key = name.toLowerCase();
  if (!CURATED_IMAGERY_ORDER_MAP.has(key)) {
    CURATED_IMAGERY_ORDER_MAP.set(key, CURATED_IMAGERY_ORDER_MAP.size);
  }
}

export const parseLayersFromCapabilities = (xml: string) => {
  type Node = {
    name?: string;
    title?: string;
    crs: string[];
    children: number;
  };
  const tokenRegex =
    /<Layer\b[^>]*>|<\/Layer>|<Style\b[^>]*>|<\/Style>|<Name>\s*([^<]+)\s*<\/Name>|<Title>\s*([^<]+)\s*<\/Title>|<(?:CRS|SRS)>\s*([^<]+)\s*<\/(?:CRS|SRS)>/gi;
  const stack: Node[] = [];
  let insideStyle = 0;
  const out: Array<{
    name: string;
    title: string;
    crs: string[];
    inferredYear?: string;
    group: "spot" | "landsat" | "sentinel" | "other";
    isLeaf: boolean;
    isRenderable: boolean;
    year?: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(xml)) !== null) {
    const token = match[0];
    if (/^<Style\b/i.test(token)) {
      insideStyle += 1;
      continue;
    }
    if (/^<\/Style>/i.test(token)) {
      insideStyle = Math.max(0, insideStyle - 1);
      continue;
    }
    if (insideStyle > 0) continue; // skip everything inside <Style>

    if (/^<Layer\b/i.test(token)) {
      const parent = stack[stack.length - 1];
      if (parent) parent.children += 1;
      stack.push({
        crs: parent ? [...parent.crs] : [],
        children: 0,
      });
      continue;
    }
    if (/^<\/Layer>/i.test(token)) {
      const node = stack.pop();
      if (!node || !node.name) continue;
      const name = node.name.trim();
      if (!name) continue;
      const title = (node.title || name).trim();
      const combined = `${name} ${title}`.toLowerCase();
      const yearMatch = combined.match(/\b(19|20)\d{2}\b/);
      const inferredYear = yearMatch?.[0];
      const year = inferredYear ? Number(inferredYear) : undefined;
      const group = /spot/.test(combined)
        ? "spot"
        : /landsat/.test(combined)
          ? "landsat"
          : /sentinel/.test(combined)
            ? "sentinel"
            : "other";
      const isLeaf = node.children === 0;
      const isRenderable = !!name.includes(":");
      out.push({
        name,
        title,
        crs: node.crs,
        inferredYear,
        group,
        isLeaf,
        isRenderable,
        year,
      });
      continue;
    }
    const current = stack[stack.length - 1];
    if (!current) continue;
    if (match[1]) {
      // Only set name on FIRST <Name> encounter (layer name, not style name)
      if (!current.name) current.name = String(match[1] || "").trim();
    } else if (match[2]) {
      if (!current.title) current.title = String(match[2] || "").trim();
    } else if (match[3]) {
      const code = String(match[3] || "").trim();
      if (code && !current.crs.includes(code)) current.crs.push(code);
    }
  }

  const uniq = new Map<string, (typeof out)[number]>();
  for (const item of out) {
    if (!uniq.has(item.name)) uniq.set(item.name, item);
  }
  return [...uniq.values()];
};

export const toImageryLayers = (
  layers: ReturnType<typeof parseLayersFromCapabilities>
) => {
  const workspaceRank = (name: string) => {
    const ws = name.split(":")[0]?.toLowerCase() || "";
    if (ws === "semamt") return 0;
    if (ws === "geoportal") return 1;
    if (ws === "mosaicos") return 2;
    return 3;
  };

  return layers
    .filter((l) => l.isRenderable)
    .filter((l) => {
      const low = l.name.toLowerCase();
      const txt = `${l.name} ${l.title}`.toLowerCase();
      const hasKnownWorkspace =
        low.startsWith("mosaicos:") || low.startsWith("semamt:") || low.startsWith("geoportal:");
      if (!hasKnownWorkspace) return false;
      return /(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
    })
    .sort((a, b) => {
      const aOrder = CURATED_IMAGERY_ORDER_MAP.get(a.name.toLowerCase());
      const bOrder = CURATED_IMAGERY_ORDER_MAP.get(b.name.toLowerCase());
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1;
        if (bOrder === undefined) return -1;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }

      const ws = workspaceRank(a.name) - workspaceRank(b.name);
      if (ws !== 0) return ws;

      const score = (x: (typeof layers)[number]) => {
        let s = 0;
        if (x.name === "Mosaicos:LANDSAT_5_2008") s += 1000;
        if (x.group === "landsat") s += 120;
        if (x.group === "spot") s += 100;
        if (x.group === "sentinel") s += 80;
        if (x.year === 2008) s += 400;
        if (x.year) s += Math.max(0, 2100 - x.year);
        return s;
      };
      return score(b) - score(a) || a.name.localeCompare(b.name);
    });
};

export const toShapeLayers = (layers: ReturnType<typeof parseLayersFromCapabilities>) => {
  return layers
    .filter((l) => l.isRenderable)
    .filter((l) => !l.name.toLowerCase().startsWith("mosaicos:"))
    .filter((l) => {
      const txt = `${l.name} ${l.title}`.toLowerCase();
      return !/(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const toSimcarDigitalLayers = (layers: ReturnType<typeof parseLayersFromCapabilities>) => {
  return layers
    .filter((l) => l.isRenderable)
    .filter((l) => {
      const low = l.name.toLowerCase();
      return (
        low.startsWith("geoportal:simcar_") ||
        low.startsWith("geoportal:car_")
      );
    })
    .map((l) => ({
      name: l.name,
      title: l.title,
      crs: l.crs,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
};

export let cachedPdfParser: null | ((buffer: Buffer) => Promise<any>) = null;
export const getPdfParser = async () => {
  if (cachedPdfParser) return cachedPdfParser;
  try {
    const mod: any = await import("pdf-parse");
    const parser = (mod?.default || mod) as (buffer: Buffer) => Promise<any>;
    if (typeof parser === "function") {
      cachedPdfParser = parser;
      return cachedPdfParser;
    }
    return null;
  } catch {
    return null;
  }
};

export const parsePdfSafe = async (buffer: Buffer) => {
  const parser = await getPdfParser();
  if (!parser) return null;
  try {
    return await parser(buffer);
  } catch {
    return null;
  }
};

export type MapCapabilitiesPayload = {
  serviceTitle: string;
  layers: Array<{
    name: string;
    title: string;
    crs: string[];
    inferredYear?: string;
    group: "spot" | "landsat" | "sentinel" | "other";
  }>;
  imageLayers: Array<{
    name: string;
    title: string;
    crs: string[];
    inferredYear?: string;
    group: "spot" | "landsat" | "sentinel" | "other";
  }>;
  shapeLayers: Array<{
    name: string;
    title: string;
    crs: string[];
  }>;
  simcarDigitalLayers: Array<{
    name: string;
    title: string;
    crs: string[];
  }>;
  defaultLayer?: string;
  recommended: {
    legalMarco2008: string;
  };
};
export type MapCapabilitiesCacheEntry = {
  expiresAt: number;
  xml: string;
  payload?: MapCapabilitiesPayload;
  allowedLayerNames?: Set<string>;
};
export type MapSnapshotPayload = {
  dataUrl: string;
  mimeType: string;
  sourceUrl: string;
  mapContext: {
    layerName: string;
    bbox: [number, number, number, number];
    crs: string;
    width: number;
    height: number;
    source: "SEMA_WMS";
  };
};
export let mapCapabilitiesCache: MapCapabilitiesCacheEntry | null = null;
export const mapSnapshotCache = new Map<string, { expiresAt: number; payload: MapSnapshotPayload }>();

export const pruneMapSnapshotCache = () => {
  const now = Date.now();
  for (const [key, entry] of mapSnapshotCache.entries()) {
    if (entry.expiresAt <= now) {
      mapSnapshotCache.delete(key);
    }
  }
  while (mapSnapshotCache.size > MAP_SNAPSHOT_CACHE_MAX_ITEMS) {
    const oldestKey = mapSnapshotCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    mapSnapshotCache.delete(oldestKey);
  }
};

export const getCachedMapSnapshot = (cacheKey: string): MapSnapshotPayload | null => {
  const cached = mapSnapshotCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    mapSnapshotCache.delete(cacheKey);
    return null;
  }
  mapSnapshotCache.delete(cacheKey);
  mapSnapshotCache.set(cacheKey, cached);
  return cached.payload;
};

export const storeMapSnapshot = (cacheKey: string, payload: MapSnapshotPayload) => {
  pruneMapSnapshotCache();
  if (mapSnapshotCache.has(cacheKey)) {
    mapSnapshotCache.delete(cacheKey);
  }
  mapSnapshotCache.set(cacheKey, {
    expiresAt: Date.now() + MAP_SNAPSHOT_TTL_MS,
    payload,
  });
  pruneMapSnapshotCache();
};

export const fetchSemamtCapabilitiesXml = async () => {
  if (mapCapabilitiesCache && mapCapabilitiesCache.expiresAt > Date.now()) {
    return mapCapabilitiesCache.xml;
  }

  const capUrl = new URL(SEMA_WMS_BASE);
  capUrl.searchParams.set("service", "WMS");
  capUrl.searchParams.set("request", "GetCapabilities");
  capUrl.searchParams.set("version", "1.3.0");
  if (SEMA_WMS_AUTHKEY) {
    capUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
  }

  const finalUrl = capUrl.toString();
  console.log("[WMS] Fetching capabilities from:", finalUrl.replace(SEMA_WMS_AUTHKEY, "***"));
  const t0 = Date.now();

  let response: Response;
  try {
    response = await fetch(finalUrl);
  } catch (fetchErr: any) {
    console.error("[WMS] Network error fetching capabilities:", fetchErr?.message || fetchErr);
    throw new Error(`Erro de rede ao buscar capabilities: ${fetchErr?.message}`);
  }

  const elapsed = Date.now() - t0;
  console.log(`[WMS] Capabilities response: status=${response.status}, time=${elapsed}ms`);

  if (!response.ok) {
    const text = await response.text();
    console.error(`[WMS] Capabilities HTTP error ${response.status}:`, text.slice(0, 300));
    throw new Error(
      `Falha ao carregar capabilities da SEMA (${response.status}): ${text.slice(0, 220)}`
    );
  }

  const xml = await response.text();
  console.log(`[WMS] Capabilities XML received: ${xml.length} chars`);
  mapCapabilitiesCache = {
    expiresAt: Date.now() + MAP_CAPABILITIES_TTL_MS,
    xml,
  };
  return xml;
};

export const getMapCapabilitiesData = async () => {
  if (
    mapCapabilitiesCache &&
    mapCapabilitiesCache.expiresAt > Date.now() &&
    mapCapabilitiesCache.payload &&
    mapCapabilitiesCache.allowedLayerNames
  ) {
    return mapCapabilitiesCache;
  }

  const xml = await fetchSemamtCapabilitiesXml();
  const parsed = parseLayersFromCapabilities(xml);
  console.log(`[API] Capabilities parsed: ${parsed.length} layers total`);

  const parsedImagery = toImageryLayers(parsed).map((l) => ({
    name: l.name,
    title: l.title,
    crs: l.crs,
    inferredYear: l.inferredYear,
    group: l.group,
  }));
  console.log(`[API] Imagery layers: ${parsedImagery.length}`);

  const byLowerName = new Map(parsedImagery.map((l) => [l.name.toLowerCase(), l]));
  const curatedImagery = CURATED_IMAGERY_LAYER_NAMES.map((name) => {
    const existing = byLowerName.get(name.toLowerCase());
    if (existing) return existing;
    return {
      name,
      title: name.split(":")[1] || name,
      crs: ["EPSG:4326"],
      inferredYear: String(name.match(/\b(19|20)\d{2}\b/)?.[0] || ""),
      group: /landsat/i.test(name)
        ? ("landsat" as const)
        : /spot/i.test(name)
          ? ("spot" as const)
          : /sentinel/i.test(name)
            ? ("sentinel" as const)
            : ("other" as const),
    };
  });
  const imagery = [...curatedImagery];
  for (const layer of parsedImagery) {
    if (!CURATED_IMAGERY_ORDER_MAP.has(layer.name.toLowerCase())) {
      imagery.push(layer);
    }
  }
  console.log(`[API] Final imagery count: ${imagery.length}`);

  const shapeLayers = toShapeLayers(parsed).map((l) => ({
    name: l.name,
    title: l.title,
    crs: l.crs,
  }));
  console.log(`[API] Shape layers: ${shapeLayers.length}`);

  const simcarDigitalLayers = toSimcarDigitalLayers(parsed);
  console.log(
    `[API] SIMCAR Digital layers: ${simcarDigitalLayers.length}`,
    simcarDigitalLayers.map((l) => l.name),
  );

  const defaultLayer =
    imagery.find((l) => l.name === "Mosaicos:LANDSAT_5_2008")?.name ||
    imagery.find((l) => l.group === "landsat")?.name ||
    imagery.find((l) => l.group === "spot")?.name ||
    imagery.find((l) => l.group === "sentinel")?.name ||
    imagery[0]?.name;

  const payload: MapCapabilitiesPayload = {
    serviceTitle: "SEMA WMS",
    layers: imagery,
    imageLayers: imagery,
    shapeLayers,
    simcarDigitalLayers,
    defaultLayer,
    recommended: {
      legalMarco2008: "Mosaicos:LANDSAT_5_2008",
    },
  };

  const allowedLayerNames = new Set<string>([
    ...imagery.map((l) => l.name.toLowerCase()),
    ...CURATED_IMAGERY_LAYER_NAMES.map((l) => l.toLowerCase()),
    ...simcarDigitalLayers.map((l) => l.name.toLowerCase()),
  ]);

  mapCapabilitiesCache = {
    expiresAt: Date.now() + MAP_CAPABILITIES_TTL_MS,
    xml,
    payload,
    allowedLayerNames,
  };
  return mapCapabilitiesCache;
};

export const fetchSemamtImageryLayers = async () => {
  const capabilities = await getMapCapabilitiesData();
  return capabilities.payload?.imageLayers || [];
};

export const decodeDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("dataUrl invÃ¡lido.");
  const mimeType = match[1] || "application/octet-stream";
  const payload = match[2];
  return { mimeType, buffer: Buffer.from(payload, "base64") };
};

export const parseKmlBbox = (kml: string) => {
  const coordBlocks = [...kml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  if (!coordBlocks.length) {
    throw new Error("KML sem bloco <coordinates>.");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const block of coordBlocks) {
    const raw = String(block[1] || "").trim();
    if (!raw) continue;
    const tuples = raw.split(/\s+/);
    for (const t of tuples) {
      const [xStr, yStr] = t.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error("NÃ£o foi possÃ­vel extrair coordenadas vÃ¡lidas do KML.");
  }
  return [minX, minY, maxX, maxY] as [number, number, number, number];
};


export const parseShapefileFirstPolygon = (shpBuffer: Buffer) => {
  // Returns first polygon ring found (lon/lat), limited to avoid oversized payloads.
  if (shpBuffer.length < 120) return null;
  const pointsLimit = 6000;
  let offset = 100; // skip .shp header
  while (offset + 12 <= shpBuffer.length) {
    const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
    const contentLengthBytes = contentLengthWords * 2;
    const recStart = offset + 8;
    const recEnd = recStart + contentLengthBytes;
    if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

    const shapeType = shpBuffer.readInt32LE(recStart);
    if ((shapeType === 5 || shapeType === 15) && contentLengthBytes >= 44) {
      const numParts = shpBuffer.readInt32LE(recStart + 36);
      const numPoints = shpBuffer.readInt32LE(recStart + 40);
      if (numParts > 0 && numPoints > 2) {
        const partsOffset = recStart + 44;
        const pointsOffset = partsOffset + numParts * 4;
        if (pointsOffset + numPoints * 16 <= recEnd) {
          const partStart = shpBuffer.readInt32LE(partsOffset);
          const partEnd = numParts > 1 ? shpBuffer.readInt32LE(partsOffset + 4) : numPoints;
          const end = Math.min(partEnd, numPoints, partStart + pointsLimit);
          const ring: Array<[number, number]> = [];
          for (let i = partStart; i < end; i += 1) {
            const pOff = pointsOffset + i * 16;
            const x = shpBuffer.readDoubleLE(pOff);
            const y = shpBuffer.readDoubleLE(pOff + 8);
            if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
          }
          if (ring.length >= 3) return ring;
        }
      }
    }

    offset = recEnd;
  }
  return null;
};
