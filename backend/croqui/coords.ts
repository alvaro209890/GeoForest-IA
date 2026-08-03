/** Conversão de coordenadas decimais para DMS (padrão croqui SEMA / Google Earth). */

export function decimalToDms(value: number, axis: "lat" | "lon"): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "O";
  const secStr = sec.toFixed(2);
  return `${deg}°${min}'${secStr}"${hemi}`;
}

/** Parênteses — texto do PDF/Word (ex.: (12°35'24.15"S, 52°13'10.51"O)). */
export function formatDmsPair(lon: number, lat: number): string {
  return `(${decimalToDms(lat, "lat")}, ${decimalToDms(lon, "lon")})`;
}

/** Rótulo de ponto como aparece no mapa: espaço duplo depois da vírgula. */
export function formatDmsLabel(lon: number, lat: number): string {
  return `${decimalToDms(lat, "lat")},  ${decimalToDms(lon, "lon")}`;
}

/**
 * Mesmo rótulo para o KML. Só `'` e `"` viram entidade — o grau fica literal,
 * como nos croquis modelo (`&deg;` não é entidade XML e apareceria como texto).
 */
export function formatDmsKmlLabel(lon: number, lat: number): string {
  return formatDmsLabel(lon, lat).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    let text = km.toFixed(2).replace(".", ",");
    text = text.replace(/,00$/, "").replace(/,(\d)0$/, ",$1");
    return `${text} km`;
  }
  const m = Math.round(meters);
  return `${m} m`;
}

/** Rumo (bearing) em graus [0, 360) entre dois pontos, no sentido horário a partir do norte. */
export function bearingDegrees(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const PONTOS_CARDEAIS = [
  "norte",
  "nordeste",
  "leste",
  "sudeste",
  "sul",
  "sudoeste",
  "oeste",
  "noroeste",
] as const;

/** Ponto cardeal (8 direções) do deslocamento entre dois pontos. */
export function sentidoCardeal(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): string {
  const idx = Math.round(bearingDegrees(lon1, lat1, lon2, lat2) / 45) % 8;
  return PONTOS_CARDEAIS[idx];
}

export function escapeXml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function safeFileStem(title: string): string {
  return String(title || "croqui")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "croqui";
}
