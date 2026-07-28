/** Conversão de coordenadas decimais para DMS (padrão croqui SEMA). */

export function decimalToDms(value: number, axis: "lat" | "lon"): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "O";
  const secStr = sec.toFixed(2).replace(/\.?0+$/, "");
  return `${deg}°${min}'${secStr}"${hemi}`;
}

export function formatDmsPair(lon: number, lat: number): string {
  return `(${decimalToDms(lat, "lat")}, ${decimalToDms(lon, "lon")})`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    const rounded = Math.round(km * 100) / 100;
    const text = rounded.toFixed(2).replace(/\.?0+$/, "");
    return `${text} km`;
  }
  const m = Math.round(meters);
  return `${m} m`;
}

export function escapeXml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
