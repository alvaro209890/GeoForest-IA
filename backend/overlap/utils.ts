/**
 * Helpers: nomes seguros, ZIP base64, números, situação do CAR e áreas/interseções.
 */
import "../proj-defs";
import proj4 from "proj4";
import { area as turfArea, bbox as turfBbox, buffer as turfBuffer, featureCollection as turfFeatureCollection, intersect as turfIntersect } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizePolygonGeometry } from "../wfs-intersection";
import { estimateUtmProjFromLonLat } from "../vertices-proximas";
import { PolyFeature } from "./types";

export { parseBase64Zip, safeSegment } from "../lib/job-utils";


export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function cleanSituacao(raw: string): string {
  const s = String(raw || "")
    .replace(/^\[|\]$/g, "")
    .trim();
  const map: Record<string, string> = {
    CAR_VALIDADO: "Car Validado",
    CAR_VALIDADO_EM_REGULARIZACAO: "Car Validado Em Regularizacao",
    AGUARDANDO_ENVIO_PRA: "Aguardando Envio Pra",
    AGUARDANDO_COMPLEMENTACAO: "Aguardando Complementacao",
    AGUARDANDO_ANALISE: "Aguardando Analise",
    CANCELADO: "Cancelado",
  };
  return map[s] || s || "Desconhecida";
}

export function isCancelledSituacao(raw: string): boolean {
  return /CANCELADO/i.test(String(raw || ""));
}

export function federalStatusLabel(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "AT" || s === "ATIVO") return "Ativo";
  if (s === "CA" || s === "CANCELADO" || s === "RE") return "Cancelado";
  return String(raw || "Desconhecido");
}

export function isFederalCancelled(raw: string): boolean {
  return /cancel|CA\b|^RE$/i.test(String(raw || ""));
}

export function featureAreaHa(geom: Polygon | MultiPolygon): number {
  try {
    return turfArea({ type: "Feature", properties: {}, geometry: geom }) / 10000;
  } catch {
    return 0;
  }
}

export function densifiedPlanarAreaM2(geom: Polygon | MultiPolygon): number {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const sample = polys[0]?.[0]?.[0];
  if (!sample) return 0;
  const { projDef } = estimateUtmProjFromLonLat(sample[0], sample[1]);
  const densifyRing = (ring: number[][], stepDeg = 0.001): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      out.push([x1, y1]);
      const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      const extra = Math.min(64, Math.floor(span / stepDeg));
      for (let k = 1; k <= extra; k += 1) {
        out.push([x1 + ((x2 - x1) * k) / (extra + 1), y1 + ((y2 - y1) * k) / (extra + 1)]);
      }
    }
    out.push(ring[ring.length - 1]);
    return out;
  };
  const ringArea = (ring: number[][]): number => {
    const projected = densifyRing(ring).map((pt) => {
      const out = proj4("EPSG:4326", projDef, [pt[0], pt[1]]) as [number, number];
      return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : ([pt[0], pt[1]] as [number, number]);
    });
    let area = 0;
    for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
      area += projected[j][0] * projected[i][1] - projected[i][0] * projected[j][1];
    }
    return Math.abs(area / 2);
  };
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, idx) => {
      const a = ringArea(ring as number[][]);
      total += idx === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

export function intersectionAreaHa(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon): number {
  try {
    const fc = turfFeatureCollection([
      { type: "Feature", properties: {}, geometry: a },
      { type: "Feature", properties: {}, geometry: b },
    ]);
    const inter = turfIntersect(fc as any);
    if (!inter?.geometry) return 0;
    const geom = normalizePolygonGeometry(inter.geometry);
    if (!geom) return 0;
    return densifiedPlanarAreaM2(geom) / 10000;
  } catch {
    return 0;
  }
}

export function expandBbox(
  geom: Polygon | MultiPolygon,
  bufferMeters: number,
): [number, number, number, number] {
  const feat: PolyFeature = { type: "Feature", properties: {}, geometry: geom };
  let buffered = feat;
  try {
    const b = turfBuffer(feat, Math.max(1, bufferMeters), { units: "meters" });
    if (b) buffered = b as PolyFeature;
  } catch {
    // keep original
  }
  const box = turfBbox(buffered);
  return [box[0], box[1], box[2], box[3]];
}

export function propStr(props: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!props) return "";
  for (const key of keys) {
    const v = props[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // case-insensitive fallback
  const lowerMap = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const real = lowerMap.get(key.toLowerCase());
    if (real != null && props[real] != null && String(props[real]).trim()) {
      return String(props[real]).trim();
    }
  }
  return "";
}
