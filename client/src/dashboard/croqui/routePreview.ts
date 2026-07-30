/**
 * Projeção do mapinha de escolha do caminho.
 *
 * É Web Mercator simplificado: em 30–50 km de extensão a diferença para a
 * projeção do PDF é invisível, e assim o preview não precisa de biblioteca de
 * mapa nenhuma.
 */

export type PreviewProjection = {
  width: number;
  height: number;
  project: (lon: number, lat: number) => [number, number];
};

export type LonLat = [number, number];

/** Cor fixa por posição na lista: a mesma linha no mapa e no cartão da opção. */
export const ROUTE_COLORS = ['#34d399', '#fb923c', '#60a5fa', '#f472b6', '#facc15'];

export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

/**
 * Web Mercator em radianos nos dois eixos. Misturar grau em x com radiano em y
 * achataria o traçado umas 57 vezes na vertical.
 */
function mercatorX(lon: number): number {
  return (lon * Math.PI) / 180;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(Math.min(lat, 85), -85);
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

export function boundsOf(groups: LonLat[][]): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const group of groups) {
    for (const [lon, lat] of group) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Enquadra tudo que for desenhado, com folga, mantendo a proporção — traçados
 * esticados num eixo só seriam impossíveis de reconhecer contra o Google Earth.
 */
export function buildProjection(
  groups: LonLat[][],
  width: number,
  height: number,
  padding = 14,
): PreviewProjection | null {
  const bounds = boundsOf(groups);
  if (!bounds) return null;

  const x0 = mercatorX(bounds.minLon);
  const x1 = mercatorX(bounds.maxLon);
  const y0 = mercatorY(bounds.minLat);
  const y1 = mercatorY(bounds.maxLat);
  const spanX = Math.max(x1 - x0, 1e-6);
  const spanY = Math.max(y1 - y0, 1e-6);

  const innerW = Math.max(width - padding * 2, 1);
  const innerH = Math.max(height - padding * 2, 1);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offsetX = padding + (innerW - spanX * scale) / 2;
  const offsetY = padding + (innerH - spanY * scale) / 2;

  return {
    width,
    height,
    project: (lon: number, lat: number) => [
      offsetX + (mercatorX(lon) - x0) * scale,
      offsetY + (y1 - mercatorY(lat)) * scale,
    ],
  };
}

export function toPolylinePoints(coords: LonLat[], projection: PreviewProjection): string {
  return coords
    .map(([lon, lat]) => {
      const [x, y] = projection.project(lon, lat);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
