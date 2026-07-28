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

/** Rótulo de ponto no KML (com entidades XML e espaço duplo após vírgula). */
export function formatDmsKmlLabel(lon: number, lat: number): string {
  const latTxt = decimalToDms(lat, "lat")
    .replace(/°/g, "&deg;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
  const lonTxt = decimalToDms(lon, "lon")
    .replace(/°/g, "&deg;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
  return `${latTxt},  ${lonTxt}`;
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
