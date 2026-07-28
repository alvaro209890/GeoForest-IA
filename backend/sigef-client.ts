/**
 * SIGEF parcel geometry client.
 *
 * Primary source today: INCRA Acervo Fundiário WFS (i3geo GML).
 * Optional future source: Conecta Gov / SERPRO SIGEFGeo REST API
 *   https://apigateway.conectagov.estaleiro.serpro.gov.br/api-sigef-geo/v1/parcelas
 * when SIGEF_SERPRO_BASE_URL + credentials are configured.
 */
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { fetchTextWithTimeout, WFS_TIMEOUT_MS } from "./wfs-intersection";

export const SIGEF_WFS_BASE_URL =
  process.env.SIGEF_WFS_BASE_URL ||
  "https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=certificada_sigef_particular_mt";
export const SIGEF_WFS_TYPENAME = process.env.SIGEF_WFS_TYPENAME || "certificada_sigef_particular_mt";
export const SIGEF_WFS_FILTER_PARAM =
  process.env.SIGEF_WFS_FILTER_PARAM || "map_layer_certificada_sigef_particular_mt_filter";
export const SIGEF_WFS_TIMEOUT_MS = Number(
  process.env.SIGEF_WFS_TIMEOUT_MS || Math.max(WFS_TIMEOUT_MS, 120000),
);

/** Conecta Gov / SERPRO stubs (unused until credentials exist). */
export const SIGEF_SERPRO_BASE_URL = String(process.env.SIGEF_SERPRO_BASE_URL || "").trim();
export const SIGEF_SERPRO_CONSUMER_KEY = String(process.env.SIGEF_SERPRO_CONSUMER_KEY || "").trim();
export const SIGEF_SERPRO_CONSUMER_SECRET = String(process.env.SIGEF_SERPRO_CONSUMER_SECRET || "").trim();
export const SIGEF_SERPRO_TOKEN_URL = String(process.env.SIGEF_SERPRO_TOKEN_URL || "").trim();

export function isSigefSerproConfigured(): boolean {
  return Boolean(SIGEF_SERPRO_BASE_URL && SIGEF_SERPRO_CONSUMER_KEY && SIGEF_SERPRO_CONSUMER_SECRET);
}

export function normalizeSigefParcelCode(raw: string): string {
  return String(raw || "").trim();
}

function xmlDecode(value: string): string {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function buildSigefI3geoFilter(parcelCode: string): string {
  const safeValue = parcelCode.replace(/'/g, "''");
  return `(('[parcela_codigo]'='${safeValue}'))`;
}

export function buildSigefWfsUrl(
  parcelCode: string,
  options: { includePropertyName?: boolean } = {},
): string {
  const url = new URL(SIGEF_WFS_BASE_URL);
  url.searchParams.set(SIGEF_WFS_FILTER_PARAM, buildSigefI3geoFilter(parcelCode));
  url.searchParams.set("SERVICE", "WFS");
  url.searchParams.set("VERSION", "1.0.0");
  url.searchParams.set("REQUEST", "GetFeature");
  url.searchParams.set("TYPENAME", SIGEF_WFS_TYPENAME);
  url.searchParams.set("MAXFEATURES", "1");
  if (options.includePropertyName !== false) {
    url.searchParams.set("propertyName", "msGeometry,parcela_codigo");
  }
  return url.toString();
}

function parseGmlCoordinates(text: string): number[][] {
  const coords = String(text || "")
    .trim()
    .split(/\s+/g)
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [xRaw, yRaw] = pair.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    })
    .filter((coord): coord is number[] => Array.isArray(coord));
  if (coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  }
  return coords;
}

function parseGmlPosList(text: string): number[][] {
  const values = String(text || "")
    .trim()
    .split(/\s+/g)
    .map((n) => Number(n))
    .filter(Number.isFinite);
  const coords: number[][] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    const a = values[i];
    const b = values[i + 1];
    const looksLikeLatLonAxis = Math.abs(a) <= 30 && Math.abs(b) >= 30;
    coords.push(looksLikeLatLonAxis ? [b, a] : [a, b]);
  }
  if (coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  }
  return coords;
}

export function parsePolygonGeometryFromGml(xml: string): Polygon | MultiPolygon | null {
  const geometryXml = String(xml || "");
  const polygons: number[][][][] = [];
  const polygonRegex = /<gml:Polygon\b[^>]*>([\s\S]*?)<\/gml:Polygon>/gi;
  let polygonMatch: RegExpExecArray | null;
  while ((polygonMatch = polygonRegex.exec(geometryXml))) {
    const polygonXml = polygonMatch[1];
    const rings: number[][][] = [];
    const coordinatesRegex = /<gml:coordinates\b[^>]*>([\s\S]*?)<\/gml:coordinates>/gi;
    const posListRegex = /<gml:posList\b[^>]*>([\s\S]*?)<\/gml:posList>/gi;
    let coordMatch: RegExpExecArray | null;
    while ((coordMatch = coordinatesRegex.exec(polygonXml))) {
      const ring = parseGmlCoordinates(xmlDecode(coordMatch[1]));
      if (ring.length >= 4) rings.push(ring);
    }
    while ((coordMatch = posListRegex.exec(polygonXml))) {
      const ring = parseGmlPosList(xmlDecode(coordMatch[1]));
      if (ring.length >= 4) rings.push(ring);
    }
    if (rings.length > 0) polygons.push(rings);
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0] };
  }
  if (polygons.length > 1) {
    return { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}

function parseSigefGeometryFromGml(xml: string): Polygon | MultiPolygon | null {
  const featureMatch = String(xml || "").match(/<gml:featureMember\b[\s\S]*?<\/gml:featureMember>/i);
  if (!featureMatch) return null;
  return parsePolygonGeometryFromGml(featureMatch[0]);
}

async function fetchSigefBoundaryFromWfs(
  parcelCodeRaw: string,
): Promise<Feature<Polygon | MultiPolygon>> {
  const parcelCode = normalizeSigefParcelCode(parcelCodeRaw);
  if (!parcelCode) throw new Error("Código da parcela SIGEF inválido.");

  const errors: string[] = [];
  let xml = "";
  for (const includePropertyName of [true, false]) {
    const wfsUrl = buildSigefWfsUrl(parcelCode, { includePropertyName });
    try {
      xml = await fetchTextWithTimeout(wfsUrl, SIGEF_WFS_TIMEOUT_MS);
      break;
    } catch (error: any) {
      errors.push(String(error?.message || error || "falha desconhecida"));
    }
  }
  if (!xml) {
    throw new Error(
      `Não foi possível consultar o WFS do SIGEF/INCRA para a parcela ${parcelCode}. ` +
        `O serviço externo não respondeu dentro de ${Math.round(SIGEF_WFS_TIMEOUT_MS / 1000)}s. ` +
        `Detalhes: ${errors.slice(0, 2).join(" | ")}`,
    );
  }
  if (/<(?:ServiceExceptionReport|ows:ExceptionReport)\b/i.test(xml)) {
    const detail = xmlDecode(
      xml.match(
        /<(?:ServiceException|ows:ExceptionText)\b[^>]*>([\s\S]*?)<\/(?:ServiceException|ows:ExceptionText)>/i,
      )?.[1] || "",
    )
      .replace(/\s+/g, " ")
      .trim();
    throw new Error(detail || "O WFS do SIGEF/INCRA retornou erro ao consultar a parcela.");
  }
  if (!/<gml:featureMember\b/i.test(xml)) {
    throw new Error(`Nenhuma certificação SIGEF encontrada para parcela_codigo: ${parcelCode}`);
  }

  const returnedCode = xmlDecode(
    xml.match(/<ms:parcela_codigo\b[^>]*>([\s\S]*?)<\/ms:parcela_codigo>/i)?.[1] || "",
  ).trim();
  if (returnedCode.toLowerCase() !== parcelCode.toLowerCase()) {
    throw new Error(`O WFS do SIGEF não retornou a parcela solicitada (${parcelCode}).`);
  }

  const geometry = parseSigefGeometryFromGml(xml);
  if (!geometry) throw new Error("A geometria retornada pelo WFS do SIGEF não é um polígono válido.");

  return {
    type: "Feature",
    properties: { parcela_codigo: returnedCode, source: "wfs-incra" },
    geometry,
  };
}

/**
 * Future SERPRO path. Throws until credentials + response mapping are implemented.
 * Kept so callers can branch on `isSigefSerproConfigured()` without importing env ad hoc.
 */
async function fetchSigefBoundaryFromSerpro(
  parcelCodeRaw: string,
): Promise<Feature<Polygon | MultiPolygon>> {
  const parcelCode = normalizeSigefParcelCode(parcelCodeRaw);
  if (!parcelCode) throw new Error("Código da parcela SIGEF inválido.");
  if (!isSigefSerproConfigured()) {
    throw new Error("API SIGEF SERPRO/Conecta não configurada (faltam URL/credenciais).");
  }
  throw new Error(
    "Integração SIGEF SERPRO/Conecta ainda não implementada. " +
      "Configure apenas após obter Consumer Key/Secret no Conecta Gov. " +
      `Parcela solicitada: ${parcelCode}.`,
  );
}

/**
 * Resolve a certified SIGEF parcel polygon by `parcela_codigo`.
 * Prefers SERPRO when configured; otherwise uses INCRA WFS.
 */
export async function fetchParcelByCode(
  parcelCodeRaw: string,
): Promise<Feature<Polygon | MultiPolygon>> {
  if (isSigefSerproConfigured()) {
    try {
      return await fetchSigefBoundaryFromSerpro(parcelCodeRaw);
    } catch (error: any) {
      const msg = String(error?.message || error || "");
      // Fall back to WFS when SERPRO is configured but not yet usable.
      if (/não implementada|não configurada/i.test(msg)) {
        return fetchSigefBoundaryFromWfs(parcelCodeRaw);
      }
      throw error;
    }
  }
  return fetchSigefBoundaryFromWfs(parcelCodeRaw);
}

/** Alias kept for call sites that used the old simcar-clip name. */
export async function fetchSigefBoundaryByParcelCode(
  parcelCodeRaw: string,
): Promise<Feature<Polygon | MultiPolygon>> {
  return fetchParcelByCode(parcelCodeRaw);
}
