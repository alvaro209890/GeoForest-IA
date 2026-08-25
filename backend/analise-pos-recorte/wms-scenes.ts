import crypto from "crypto";
import sharp from "sharp";
import type { Geometry } from "geojson";

import { classifySceneUsability } from "./image-quality";
import { resolveAuasLayerName } from "./config";
import type { AuasPolygonIdentity, AuasScene, AuasYear } from "./types";

const SEMA_WMS_BASE = process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
const SEMA_WMS_AUTHKEY = process.env.SEMA_WMS_AUTHKEY || "541085de-9a2e-454e-bdba-eb3d57a2f492";

const WMS_FETCH_RETRY_ATTEMPTS = Math.max(1, Number(process.env.WMS_FETCH_RETRY_ATTEMPTS || 2));
const WMS_RETRY_BASE_DELAY_MS = 1200;

/**
 * Constrói a URL WMS 1.1.1 GetMap. Espelha buildWmsGetMapUrl de backend/simcar-clip.ts —
 * qualquer mudança de contrato WMS deve ser feita nos dois lugares até a extração completa.
 */
export function buildWmsGetMapUrl(
  layers: string[],
  bbox: [number, number, number, number],
  width = 1200,
  height = 800,
  format = "image/png",
  crs = "EPSG:4326",
  /** Estilos por camada. Necessário para as cenas NIR, que na SEMA são estilo, não camada. */
  styles?: string[]
): string {
  const url = new URL(SEMA_WMS_BASE);
  url.searchParams.set("service", "WMS");
  url.searchParams.set("request", "GetMap");
  url.searchParams.set("version", "1.1.1");
  url.searchParams.set("layers", layers.join(","));
  url.searchParams.set(
    "styles",
    styles && styles.length === layers.length ? styles.join(",") : layers.map(() => "").join(",")
  );
  url.searchParams.set("format", format);
  url.searchParams.set("transparent", "false");
  url.searchParams.set("srs", crs);
  url.searchParams.set("bbox", `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  if (SEMA_WMS_AUTHKEY) url.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
  return url.toString();
}

/** URL sanitizada para proveniência/logs: nunca inclui a authkey. */
export function sanitizeWmsUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("authkey");
  return parsed.toString();
}

/* ─── Resolução do sensor e enquadramento da cena ────────────── */

/**
 * Resolução nominal no terreno (m/pixel) das fontes publicadas pela SEMA-MT.
 * Serve para duas coisas: não pedir ao GeoServer mais pixels do que o mosaico
 * tem, e saber quando o polígono é pequeno demais para o sensor enxergar.
 */
export const SENSOR_GROUND_RESOLUTION_M: Record<string, number> = {
  LANDSAT_5: 30,
  LANDSAT_7: 30,
  LANDSAT_8: 30,
  LANDSAT_9: 30,
  RESOURCESAT: 24,
  RESOURCESAT_2: 24,
  SENTINEL_2: 10,
  SPOT: 5,
  CBERS_4A: 2,
  UNKNOWN: 30,
};

/** Metros por grau — aproximação suficiente para dimensionar uma cena. */
const METERS_PER_DEGREE = 111_320;

export function sensorGroundResolutionM(sensor: string): number {
  const key = String(sensor || "").toUpperCase();
  return SENSOR_GROUND_RESOLUTION_M[key] ?? SENSOR_GROUND_RESOLUTION_M.UNKNOWN;
}

/** Lados do bbox em metros (latitude média corrige a compressão em longitude). */
export function bboxSidesMeters(bbox: [number, number, number, number]): {
  widthM: number;
  heightM: number;
} {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  return {
    widthM: Math.abs(bbox[2] - bbox[0]) * METERS_PER_DEGREE * cosLat,
    heightM: Math.abs(bbox[3] - bbox[1]) * METERS_PER_DEGREE,
  };
}

/**
 * Quantos pixels **nativos** do sensor o polígono ocupa. Um polígono de 1,4 ha
 * e 106 m de lado menor tem 3,5 pixels Landsat: qualquer imagem gerada dele é
 * interpolação, não informação.
 */
export function polygonSensorPixels(
  bbox: [number, number, number, number],
  groundResolutionM: number
): { widthPx: number; heightPx: number; shortSidePx: number } {
  const { widthM, heightM } = bboxSidesMeters(bbox);
  const gsd = Math.max(0.1, groundResolutionM);
  const widthPx = widthM / gsd;
  const heightPx = heightM / gsd;
  return { widthPx, heightPx, shortSidePx: Math.min(widthPx, heightPx) };
}

/**
 * Mínimo de pixels nativos no lado menor para a cena valer uma chamada de
 * visão. Abaixo disso o polígono não é resolvido pelo sensor e a cena vira
 * limitação declarada, sem custo de IA.
 */
export const MIN_POLYGON_SENSOR_PIXELS = Math.max(
  1,
  Number(process.env.SIMCAR_SCENE_MIN_SENSOR_PIXELS || 4)
);

/** Pixels nativos que a cena inteira (com margem) deve ter no lado menor. */
export const MIN_CONTEXT_SENSOR_PIXELS = Math.max(
  MIN_POLYGON_SENSOR_PIXELS,
  Number(process.env.SIMCAR_SCENE_MIN_CONTEXT_PIXELS || 24)
);

/**
 * Margem relativa do contexto. v2 (zoom maior): 0.15 → 0.08 — o polígono
 * ocupa mais do quadro, facilitando a leitura de desmate raso/parcial pela
 * visão (pedido do Álvaro: "recorte com zoom maior para cada polígono").
 */
const CONTEXT_MARGIN_FRACTION = Number(process.env.SIMCAR_SCENE_CONTEXT_MARGIN ?? 0.08);

/** Teto da expansão, para um polígono minúsculo não virar uma cena regional. */
const MAX_CONTEXT_SIDE_M = 5_000;

/**
 * Expande o bbox do polígono para dar contexto ao intérprete.
 *
 * Antes as cenas usavam exatamente o bbox do polígono: o overlay vermelho
 * cobria o quadro inteiro, não sobrava paisagem para comparar, e polígonos
 * pequenos viravam um gradiente liso (o modelo respondia "gradiente de cor sem
 * dados visuais"). A margem resolve os dois problemas de uma vez.
 */
export function expandBboxForContext(
  bbox: [number, number, number, number],
  groundResolutionM: number
): [number, number, number, number] {
  const { widthM, heightM } = bboxSidesMeters(bbox);
  const gsd = Math.max(0.1, groundResolutionM);
  const minSideM = Math.min(MIN_CONTEXT_SENSOR_PIXELS * gsd, MAX_CONTEXT_SIDE_M);

  const targetWidthM = Math.min(
    MAX_CONTEXT_SIDE_M,
    Math.max(widthM * (1 + 2 * CONTEXT_MARGIN_FRACTION), minSideM)
  );
  const targetHeightM = Math.min(
    MAX_CONTEXT_SIDE_M,
    Math.max(heightM * (1 + 2 * CONTEXT_MARGIN_FRACTION), minSideM)
  );

  const padXM = Math.max(0, (targetWidthM - widthM) / 2);
  const padYM = Math.max(0, (targetHeightM - heightM) / 2);

  const midLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  const padLon = padXM / (METERS_PER_DEGREE * cosLat);
  const padLat = padYM / METERS_PER_DEGREE;

  return [
    Math.max(-180, bbox[0] - padLon),
    Math.max(-90, bbox[1] - padLat),
    Math.min(180, bbox[2] + padLon),
    Math.min(90, bbox[3] + padLat),
  ];
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Fator máximo de reamostragem sobre a resolução nativa do sensor. Acima disso
 * o GeoServer só interpola: 2 kpx para 437 m de Landsat 5 (≈140×) devolve um
 * borrão liso, custa banda e ainda atrapalha a leitura.
 */
const MAX_UPSAMPLE_FACTOR = 4;

export function calculateDynamicResolution(
  areaHa: number,
  bbox: [number, number, number, number],
  /** Resolução do sensor (m/pixel). Quando informada, limita a reamostragem. */
  groundResolutionM?: number
): { width: number; height: number } {
  const bboxWidth = Math.abs(bbox[2] - bbox[0]);
  const bboxHeight = Math.abs(bbox[3] - bbox[1]);
  const aspect = bboxWidth > 0 && bboxHeight > 0 ? bboxWidth / bboxHeight : 4 / 3;
  const MIN_SHORT_SIDE_PX = 480;

  let baseLongSide: number;
  if (areaHa <= 50) baseLongSide = 1200; // v2: 800 → 1200 (zoom maior)
  else if (areaHa <= 200) baseLongSide = 1400; // v2: 900 → 1400
  else if (areaHa <= 500) baseLongSide = 1600; // v2: 1200 → 1600
  else if (areaHa <= 2000) baseLongSide = 2000; // v2: 1600 → 2000
  else if (areaHa <= 5000) baseLongSide = 2400;
  else baseLongSide = 2800;

  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = baseLongSide;
    height = Math.max(1, Math.round(width / aspect));
  } else {
    height = baseLongSide;
    width = Math.max(1, Math.round(height * aspect));
  }

  const shortSide = Math.min(width, height);
  if (shortSide < MIN_SHORT_SIDE_PX) {
    const upscale = MIN_SHORT_SIDE_PX / Math.max(shortSide, 1);
    width = Math.max(1, Math.round(width * upscale));
    height = Math.max(1, Math.round(height * upscale));
  }

  const scaleDown = Math.min(2400 / Math.max(width, 1), 1800 / Math.max(height, 1), 1);
  width = Math.max(1, Math.round(width * scaleDown));
  height = Math.max(1, Math.round(height * scaleDown));

  if (Number.isFinite(groundResolutionM) && (groundResolutionM as number) > 0) {
    const native = polygonSensorPixels(bbox, groundResolutionM as number);
    const capW = Math.max(1, Math.round(native.widthPx * MAX_UPSAMPLE_FACTOR));
    const capH = Math.max(1, Math.round(native.heightPx * MAX_UPSAMPLE_FACTOR));
    const cap = Math.min(capW / Math.max(width, 1), capH / Math.max(height, 1), 1);
    if (cap < 1) {
      // Mantém o aspect ratio: reduz os dois lados pelo mesmo fator.
      width = Math.max(1, Math.round(width * cap));
      height = Math.max(1, Math.round(height * cap));
    }
  }

  return { width, height };
}

export function calculateWmsTimeout(width: number, height: number): number {
  const pixels = width * height;
  if (pixels <= 800 * 600) return 15_000;
  if (pixels <= 1200 * 900) return 30_000;
  if (pixels <= 1600 * 1200) return 45_000;
  if (pixels <= 2000 * 1500) return 60_000;
  return 90_000;
}

export function isRetryableWmsError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("socket") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("und_err_")
  );
}

export function buildWmsResolutionFallbacks(width: number, height: number): Array<[number, number]> {
  const factors = [1, 0.85, 0.7, 0.55];
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const factor of factors) {
    const w = Math.max(1, Math.round(width * factor));
    const h = Math.max(1, Math.round(height * factor));
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([w, h]);
  }
  return out;
}

export type WmsFetchDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  /** Estilos por camada (ex.: NIR na SEMA é estilo, não camada). */
  styles?: string[];
};

async function fetchWmsImageBufferOnce(
  layers: string[],
  bbox: [number, number, number, number],
  width: number,
  height: number,
  fetchImpl: typeof fetch,
  styles?: string[]
): Promise<Buffer> {
  const mapUrl = buildWmsGetMapUrl(layers, bbox, width, height, "image/png", "EPSG:4326", styles);
  const controller = new AbortController();
  const dynamicTimeout = calculateWmsTimeout(width, height);
  const timeout = setTimeout(() => controller.abort(), dynamicTimeout);
  try {
    const response = await fetchImpl(mapUrl, { signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WMS error ${response.status}: ${text.slice(0, 200)}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("xml") || contentType.includes("html") || contentType.includes("text")) {
      const text = await response.text();
      throw new Error(`WMS retornou ${contentType} em vez de imagem: ${text.slice(0, 200)}`);
    }
    const arr = await response.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length < 4) {
      throw new Error(`WMS retornou buffer muito pequeno (${buf.length} bytes)`);
    }
    const isPng = buf.subarray(0, 4).equals(PNG_MAGIC);
    const isJpeg = buf.subarray(0, 3).equals(JPEG_MAGIC);
    if (!isPng && !isJpeg) {
      const preview = buf.toString("utf8", 0, Math.min(200, buf.length));
      throw new Error(`WMS retornou formato inválido (não é PNG/JPEG): ${preview.slice(0, 150)}`);
    }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Busca a imagem WMS com retry e fallback de resolução. Sempre retorna no
 * width/height solicitados (reamostra se um fallback menor foi usado).
 * Retorna também se um fallback de resolução foi necessário, para classificar
 * a cena como LOW_RESOLUTION.
 */
export async function fetchWmsImageBuffer(
  layers: string[],
  bbox: [number, number, number, number],
  width: number,
  height: number,
  deps: WmsFetchDeps = {}
): Promise<{ buffer: Buffer; usedResolutionFallback: boolean }> {
  const fetchImpl = deps.fetchImpl || fetch;
  const sleep = deps.sleep || defaultSleep;
  const retryAttempts = deps.retryAttempts ?? WMS_FETCH_RETRY_ATTEMPTS;
  const retryBaseDelayMs = deps.retryBaseDelayMs ?? WMS_RETRY_BASE_DELAY_MS;

  const resolutions = buildWmsResolutionFallbacks(width, height);
  let lastError: unknown = null;

  for (const [tryW, tryH] of resolutions) {
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        const buf = await fetchWmsImageBufferOnce(layers, bbox, tryW, tryH, fetchImpl, deps.styles);
        if (tryW === width && tryH === height) {
          return { buffer: buf, usedResolutionFallback: false };
        }
        const resized = await sharp(buf).resize(width, height, { fit: "fill" }).png().toBuffer();
        return { buffer: resized, usedResolutionFallback: true };
      } catch (err) {
        lastError = err;
        const retryable = isRetryableWmsError(err);
        if (retryable && attempt < retryAttempts) {
          await sleep(retryBaseDelayMs * attempt);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error("Falha ao buscar imagem WMS.");
}

function geoToPixel(
  lon: number,
  lat: number,
  bbox: [number, number, number, number],
  width: number,
  height: number
): [number, number] {
  const x = ((lon - bbox[0]) / (bbox[2] - bbox[0])) * width;
  const y = ((bbox[3] - lat) / (bbox[3] - bbox[1])) * height;
  return [x, y];
}

function ringToSvgPath(
  ring: number[][],
  bbox: [number, number, number, number],
  width: number,
  height: number
): string {
  return (
    ring
      .map((coord, i) => {
        const [px, py] = geoToPixel(coord[0], coord[1], bbox, width, height);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

function geometryToSvgPath(
  geom: Geometry,
  bbox: [number, number, number, number],
  width: number,
  height: number,
  stroke: string,
  strokeWidth: number,
  fill: string
): string {
  let rings: number[][][] = [];
  if (geom.type === "Polygon") {
    rings = geom.coordinates as number[][][];
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as number[][][][]) rings.push(...poly);
  }
  return rings
    .map(
      (ring) =>
        `<path d="${ringToSvgPath(ring, bbox, width, height)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
    )
    .join("\n");
}

/** Overlay SVG com apenas o contorno do polígono AUAS individual (sem outras camadas). */
export function buildAuasPolygonOverlaySvg(
  width: number,
  height: number,
  bbox: [number, number, number, number],
  geometry: Geometry
): Buffer {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    geometryToSvgPath(geometry, bbox, width, height, "#FF0000", 3.5, "rgba(255,0,0,0.08)"),
    "</svg>",
  ].join("\n");
  return Buffer.from(svg);
}

/** Camada do overlay vetorial: geometria + estilo do traço e do preenchimento. */
export type OverlayLayer = {
  geometry: Geometry;
  stroke: string;
  strokeWidth: number;
  fill: string;
};

/**
 * Overlay SVG com várias camadas vetoriais (ex.: polígono da AC em vermelho +
 * AVN declarada em amarelo). Usado pela Fase 3 para a IA cruzar o que o projeto
 * declarou (AVN) com o que a cena mostra dentro da Área Consolidada.
 */
export function buildMultiLayerOverlaySvg(
  width: number,
  height: number,
  bbox: [number, number, number, number],
  layers: OverlayLayer[]
): Buffer {
  const paths = layers
    .map((layer) => geometryToSvgPath(layer.geometry, bbox, width, height, layer.stroke, layer.strokeWidth, layer.fill))
    .join("\n");
  return Buffer.from(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      paths,
      "</svg>",
    ].join("\n")
  );
}

export async function compositeOverlay(basePngBuffer: Buffer, svgOverlay: Buffer): Promise<Buffer> {
  return sharp(basePngBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export function computeImageSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export type BuildAuasSceneDeps = WmsFetchDeps & {
  now?: () => string;
};

/**
 * Gera uma cena comparável (mesmo bbox/dimensão/overlay) para um polígono AUAS
 * e um ano/fonte da série 2003–2008. Não chama IA — apenas WMS + overlay + qualidade.
 */
export async function buildAuasScene(
  polygon: AuasPolygonIdentity,
  year: AuasYear,
  deps: BuildAuasSceneDeps = {}
): Promise<AuasScene> {
  const layer = resolveAuasLayerName(year);
  const sensor = year === 2008 ? "SPOT" : "LANDSAT_5";
  const groundResolutionM = sensorGroundResolutionM(sensor);
  const sceneBbox = expandBboxForContext(polygon.bbox, groundResolutionM);
  const { width, height } = calculateDynamicResolution(
    polygon.areaHa,
    sceneBbox,
    groundResolutionM
  );
  const native = polygonSensorPixels(polygon.bbox, groundResolutionM);
  const now = deps.now || (() => new Date().toISOString());

  let usability: AuasScene["usability"] = "MISSING";
  let qualityScore: number | null = null;
  let qualityFlags: string[] = [];
  let imageBuffer: Buffer | undefined;
  let storedImageUrl: string | undefined;

  // O polígono menor que alguns pixels do sensor não é resolvido por ele: gerar
  // a cena e mandar para a visão só gasta GetMap + IA para receber
  // "NOT_OBSERVABLE". Vira limitação declarada, antes de qualquer custo.
  if (native.shortSidePx < MIN_POLYGON_SENSOR_PIXELS) {
    return {
      sceneId: `${polygon.polygonId}:${sensor === "SPOT" ? "spot" : "landsat5"}:${year}`,
      polygonId: polygon.polygonId,
      geometryHash: polygon.geometryHash,
      year,
      sensor,
      layer,
      imageSha256: "",
      width,
      height,
      bbox: sceneBbox,
      usability: "BELOW_MIN_RESOLUTION",
      qualityScore: 0,
      qualityFlags: [
        `below_sensor_resolution: lado menor ≈ ${native.shortSidePx.toFixed(1)} px de ${groundResolutionM} m (mínimo ${MIN_POLYGON_SENSOR_PIXELS})`,
      ],
      fetchedAt: now(),
    };
  }

  try {
    const { buffer: baseImage, usedResolutionFallback } = await fetchWmsImageBuffer(
      [layer],
      sceneBbox,
      width,
      height,
      deps
    );
    const overlaySvg = buildAuasPolygonOverlaySvg(width, height, sceneBbox, polygon.geometry);
    const composited = await compositeOverlay(baseImage, overlaySvg);
    const classification = await classifySceneUsability(composited, { usedResolutionFallback });
    usability = classification.usability;
    qualityScore = classification.qualityScore;
    qualityFlags = classification.qualityFlags;
    imageBuffer = composited;
    storedImageUrl = sanitizeWmsUrl(buildWmsGetMapUrl([layer], sceneBbox, width, height));
  } catch (err) {
    usability = "MISSING";
    qualityFlags = [`fetch_error: ${String((err as any)?.message || err).slice(0, 200)}`];
  }

  const sensorKey = sensor === "SPOT" ? "spot" : "landsat5";
  return {
    sceneId: `${polygon.polygonId}:${sensorKey}:${year}`,
    polygonId: polygon.polygonId,
    geometryHash: polygon.geometryHash,
    year,
    sensor,
    layer,
    imageSha256: imageBuffer ? computeImageSha256(imageBuffer) : "",
    width,
    height,
    bbox: sceneBbox,
    usability,
    qualityScore,
    qualityFlags,
    fetchedAt: now(),
    storedImageUrl,
    imageBuffer,
  };
}
