/**
 * Cor por rota e formatação de distância, compartilhadas entre o mapa de
 * satélite navegável (`StartPointMap`) e a lista de opções (`RoutePicker`).
 */

export type LonLat = [number, number];

/** Cor fixa por posição na lista: a mesma linha no mapa e no cartão da opção. */
export const ROUTE_COLORS = ['#34d399', '#fb923c', '#60a5fa', '#f472b6', '#facc15'];

export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
