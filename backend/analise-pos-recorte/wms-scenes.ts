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
  crs = "EPSG:4326"
): string {
  const url = new URL(SEMA_WMS_BASE);
  url.searchParams.set("service", "WMS");
  url.searchParams.set("request", "GetMap");
  url.searchParams.set("version", "1.1.1");
  url.searchParams.set("layers", layers.join(","));
  url.searchParams.set("styles", layers.map(() => "").join(","));
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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function calculateDynamicResolution(
  areaHa: number,
  bbox: [number, number, number, number]
): { width: number; height: number } {
  const bboxWidth = Math.abs(bbox[2] - bbox[0]);
  const bboxHeight = Math.abs(bbox[3] - bbox[1]);
  const aspect = bboxWidth > 0 && bboxHeight > 0 ? bboxWidth / bboxHeight : 4 / 3;
  const MIN_SHORT_SIDE_PX = 480;

  let baseLongSide: number;
  if (areaHa <= 50) baseLongSide = 800;
  else if (areaHa <= 200) baseLongSide = 900;
  else if (areaHa <= 500) baseLongSide = 1200;
  else if (areaHa <= 2000) baseLongSide = 1600;
  else if (areaHa <= 5000) baseLongSide = 2000;
  else baseLongSide = 2400;

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
};

async function fetchWmsImageBufferOnce(
  layers: string[],
  bbox: [number, number, number, number],
  width: number,
  height: number,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  const mapUrl = buildWmsGetMapUrl(layers, bbox, width, height);
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
        const buf = await fetchWmsImageBufferOnce(layers, bbox, tryW, tryH, fetchImpl);
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
  const { width, height } = calculateDynamicResolution(polygon.areaHa, polygon.bbox);
  const now = deps.now || (() => new Date().toISOString());

  let usability: AuasScene["usability"] = "MISSING";
  let qualityScore: number | null = null;
  let qualityFlags: string[] = [];
  let imageBuffer: Buffer | undefined;
  let storedImageUrl: string | undefined;

  try {
    const { buffer: baseImage, usedResolutionFallback } = await fetchWmsImageBuffer(
      [layer],
      polygon.bbox,
      width,
      height,
      deps
    );
    const overlaySvg = buildAuasPolygonOverlaySvg(width, height, polygon.bbox, polygon.geometry);
    const composited = await compositeOverlay(baseImage, overlaySvg);
    const classification = await classifySceneUsability(composited, { usedResolutionFallback });
    usability = classification.usability;
    qualityScore = classification.qualityScore;
    qualityFlags = classification.qualityFlags;
    imageBuffer = composited;
    storedImageUrl = sanitizeWmsUrl(buildWmsGetMapUrl([layer], polygon.bbox, width, height));
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
    bbox: polygon.bbox,
    usability,
    qualityScore,
    qualityFlags,
    fetchedAt: now(),
    storedImageUrl,
    imageBuffer,
  };
}
