/**
 * Enquadramento e imagem de fundo do croqui.
 *
 * Toda a projeção fica aqui, em Web Mercator puro, para que a imagem de satélite
 * e os vetores (rota, polígono, pins) usem exatamente o mesmo enquadramento.
 *
 * O provedor padrão é o Google Static Maps (`maptype=hybrid`), que traz os rótulos
 * de cidade e os escudos de rodovia dos croquis modelo. Sem `GOOGLE_STATIC_MAPS_KEY`
 * o fallback é o Esri World Imagery — imagem parecida, porém sem rótulos.
 */
import type { Position } from "geojson";

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Teto da Maps Static API: 640x640 em pixels lógicos (scale=2 dobra a resolução real). */
const GOOGLE_MAX_CSS_PX = 640;
/** Teto prático do `export` do ArcGIS. */
const ESRI_MAX_PX = 4096;

const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

export type BasemapProvider = "google" | "esri" | "none";

export type MapFrame = {
  centerLon: number;
  centerLat: number;
  zoom: number;
  /** Tamanho lógico da imagem pedida ao provedor, em pixels CSS. */
  imageWidthPx: number;
  imageHeightPx: number;
  /** Área de desenho no PDF, em pontos. */
  widthPt: number;
  heightPt: number;
  metersPerPoint: number;
  /** Canto inferior-esquerdo e superior-direito cobertos pelo quadro. */
  bboxLonLat: [number, number, number, number];
  /** Converte lon/lat em pontos relativos ao canto superior-esquerdo da área de mapa. */
  project(lon: number, lat: number): [number, number];
};

export type BasemapImage = {
  buffer: Buffer;
  provider: BasemapProvider;
  attribution: string;
};

function worldSizeAt(zoom: number): number {
  return TILE_SIZE * Math.pow(2, zoom);
}

export function lonToWorldX(lon: number, worldSize: number): number {
  return ((lon + 180) / 360) * worldSize;
}

export function latToWorldY(lat: number, worldSize: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.min(Math.max(sin, -0.9999), 0.9999);
  return (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * worldSize;
}

export function worldXToLon(x: number, worldSize: number): number {
  return (x / worldSize) * 360 - 180;
}

export function worldYToLat(y: number, worldSize: number): number {
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function mercatorMetersX(lon: number): number {
  return (lon / 360) * EARTH_CIRCUMFERENCE_M;
}

function mercatorMetersY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.min(Math.max(sin, -0.9999), 0.9999);
  return (Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * EARTH_CIRCUMFERENCE_M;
}

export function bboxOfPositions(coords: Position[]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon)) return [-52.3, -12.7, -52.1, -12.5];
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Escolhe centro e zoom inteiro em que todo o conteúdo cabe na área de mapa.
 *
 * Trabalhar com centro + zoom (e não com bbox) é o que garante o alinhamento: é
 * exatamente o contrato da Static API, e o Esri passa a receber uma bbox já no
 * aspect certo, então nenhum dos dois precisa reenquadrar por conta própria.
 */
export function resolveMapFrame(args: {
  contentBbox: [number, number, number, number];
  widthPt: number;
  heightPt: number;
  /** Folga em cada borda, como fração da área de mapa. */
  paddingRatio?: number;
  /** Faixa no topo reservada à caixa do roteiro — nada de conteúdo entra aqui. */
  topInsetPt?: number;
  maxCssPx?: number;
}): MapFrame {
  const { contentBbox, widthPt, heightPt } = args;
  const paddingRatio = args.paddingRatio ?? 0.06;
  const maxCssPx = args.maxCssPx ?? GOOGLE_MAX_CSS_PX;

  const aspect = widthPt / heightPt;
  const imageWidthPx = aspect >= 1 ? maxCssPx : Math.round(maxCssPx * aspect);
  const imageHeightPx = aspect >= 1 ? Math.round(maxCssPx / aspect) : maxCssPx;

  const [minLon, minLat, maxLon, maxLat] = contentBbox;
  const centerLon = (minLon + maxLon) / 2;
  const contentCenterLat = (minLat + maxLat) / 2;

  const topInsetPx = Math.max(
    0,
    Math.min(((args.topInsetPt ?? 0) / heightPt) * imageHeightPx, imageHeightPx * 0.5),
  );
  const usableW = imageWidthPx * (1 - 2 * paddingRatio);
  const usableH = (imageHeightPx - topInsetPx) * (1 - 2 * paddingRatio);

  let zoom = MIN_ZOOM;
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const worldSize = worldSizeAt(z);
    const spanX = Math.abs(lonToWorldX(maxLon, worldSize) - lonToWorldX(minLon, worldSize));
    const spanY = Math.abs(latToWorldY(minLat, worldSize) - latToWorldY(maxLat, worldSize));
    if (spanX <= usableW && spanY <= usableH) {
      zoom = z;
      break;
    }
  }

  const worldSize = worldSizeAt(zoom);
  const centerX = lonToWorldX(centerLon, worldSize);
  // Desce o conteúdo metade da faixa reservada, para ele nascer abaixo da caixa.
  const centerY = latToWorldY(contentCenterLat, worldSize) - topInsetPx / 2;
  const centerLat = worldYToLat(centerY, worldSize);
  const ptPerPxX = widthPt / imageWidthPx;
  const ptPerPxY = heightPt / imageHeightPx;

  const project = (lon: number, lat: number): [number, number] => [
    (lonToWorldX(lon, worldSize) - centerX + imageWidthPx / 2) * ptPerPxX,
    (latToWorldY(lat, worldSize) - centerY + imageHeightPx / 2) * ptPerPxY,
  ];

  const west = worldXToLon(centerX - imageWidthPx / 2, worldSize);
  const east = worldXToLon(centerX + imageWidthPx / 2, worldSize);
  const north = worldYToLat(centerY - imageHeightPx / 2, worldSize);
  const south = worldYToLat(centerY + imageHeightPx / 2, worldSize);

  const metersPerCssPx =
    (EARTH_CIRCUMFERENCE_M * Math.cos((centerLat * Math.PI) / 180)) / worldSize;

  return {
    centerLon,
    centerLat,
    zoom,
    imageWidthPx,
    imageHeightPx,
    widthPt,
    heightPt,
    metersPerPoint: metersPerCssPx / ptPerPxX,
    bboxLonLat: [west, south, east, north],
    project,
  };
}

const SCALE_STEPS_M = [
  100, 200, 500, 1000, 2000, 4000, 5000, 10000, 20000, 40000, 50000, 100000, 200000, 400000,
  500000, 1000000,
];

/** Barra de escala com número redondo e largura calculada, no estilo do Google Earth. */
export function pickScaleBar(
  metersPerPoint: number,
  maxWidthPt: number,
): { meters: number; widthPt: number; label: string } {
  const maxMeters = metersPerPoint * maxWidthPt;
  let meters = SCALE_STEPS_M[0];
  for (const step of SCALE_STEPS_M) {
    if (step <= maxMeters) meters = step;
  }
  const widthPt = meters / metersPerPoint;
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return { meters, widthPt, label };
}

function googleKey(): string {
  return String(process.env.GOOGLE_STATIC_MAPS_KEY || "").trim();
}

async function fetchImage(url: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 1000 ? buffer : null;
  } catch {
    return null;
  }
}

export function buildGoogleStaticUrl(frame: MapFrame, key: string): string {
  const params = new URLSearchParams({
    center: `${frame.centerLat},${frame.centerLon}`,
    zoom: String(frame.zoom),
    size: `${frame.imageWidthPx}x${frame.imageHeightPx}`,
    scale: "2",
    maptype: "hybrid",
    format: "png",
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export function buildEsriExportUrl(frame: MapFrame): string {
  const [west, south, east, north] = frame.bboxLonLat;
  const aspect = frame.widthPt / frame.heightPt;
  const width = aspect >= 1 ? ESRI_MAX_PX : Math.round(ESRI_MAX_PX * aspect);
  const height = aspect >= 1 ? Math.round(ESRI_MAX_PX / aspect) : ESRI_MAX_PX;
  const params = new URLSearchParams({
    bbox: [
      mercatorMetersX(west),
      mercatorMetersY(south),
      mercatorMetersX(east),
      mercatorMetersY(north),
    ].join(","),
    bboxSR: "102100",
    imageSR: "102100",
    size: `${width},${height}`,
    format: "jpg",
    f: "image",
  });
  return (
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?" +
    params.toString()
  );
}

/**
 * Busca a imagem de fundo do quadro. Google quando houver chave, Esri como
 * fallback; se os dois falharem devolve `null` e o PDF sai com fundo neutro.
 */
export async function fetchBasemapImage(frame: MapFrame): Promise<BasemapImage | null> {
  const key = googleKey();
  if (key) {
    const buffer = await fetchImage(buildGoogleStaticUrl(frame, key), 45000);
    if (buffer) {
      // A Static API já embute a atribuição do Google na própria imagem.
      return { buffer, provider: "google", attribution: "" };
    }
    console.warn("[CROQUI] Google Static Maps indisponível; usando Esri World Imagery.");
  }
  const esri = await fetchImage(buildEsriExportUrl(frame), 45000);
  if (esri) {
    return {
      buffer: esri,
      provider: "esri",
      attribution: "Esri, Maxar, Earthstar Geographics",
    };
  }
  return null;
}
