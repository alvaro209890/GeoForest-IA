/**
 * Consulta WFS (SEMA estadual e SICAR federal) e normalização dos candidatos CAR.
 */
import { featureCollection as turfFeatureCollection, union as turfUnion } from "@turf/turf";
import type { Feature } from "geojson";
import { WFS_TIMEOUT_MS, buildWfsUrl, fetchJsonWithTimeout, normalizePolygonGeometry } from "../wfs-intersection";
import { SICAR_WFS_BASE_URL, SICAR_WFS_LAYER, SICAR_WFS_TIMEOUT_MS } from "./constants";
import { CarEstadualCandidate, CarFederalCandidate, PolyFeature } from "./types";
import { cleanSituacao, featureAreaHa, federalStatusLabel, propStr } from "./utils";

export async function fetchWfsFeaturesByBbox(args: {
  baseUrl?: string;
  typeName: string;
  bbox: [number, number, number, number];
  maxFeatures?: number;
  includeAuthkey?: boolean;
  timeoutMs?: number;
}): Promise<PolyFeature[]> {
  const [minx, miny, maxx, maxy] = args.bbox;
  const maxFeatures = args.maxFeatures ?? 500;
  const timeoutMs = args.timeoutMs ?? WFS_TIMEOUT_MS;
  const params: Record<string, string> = {
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: args.typeName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${minx},${miny},${maxx},${maxy},EPSG:4326`,
    maxFeatures: String(maxFeatures),
  };

  let url: string;
  if (args.baseUrl) {
    const u = new URL(args.baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    // WFS 2.0 style alternate
    if (!u.searchParams.has("typeNames")) u.searchParams.set("typeNames", args.typeName);
    url = u.toString();
  } else {
    url = buildWfsUrl(params, { includeAuthkey: args.includeAuthkey !== false });
  }

  const fc = await fetchJsonWithTimeout<any>(url, timeoutMs);
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const out: PolyFeature[] = [];
  for (const f of features) {
    const geom = normalizePolygonGeometry(f?.geometry);
    if (!geom) continue;
    out.push({
      type: "Feature",
      properties: f?.properties || {},
      geometry: geom,
    });
  }
  return out;
}

export async function fetchSicarFeaturesByBbox(
  bbox: [number, number, number, number],
): Promise<PolyFeature[]> {
  const [minx, miny, maxx, maxy] = bbox;
  const u = new URL(SICAR_WFS_BASE_URL);
  u.searchParams.set("service", "WFS");
  u.searchParams.set("version", "2.0.0");
  u.searchParams.set("request", "GetFeature");
  u.searchParams.set("typeNames", SICAR_WFS_LAYER);
  u.searchParams.set("outputFormat", "application/json");
  u.searchParams.set("srsName", "EPSG:4326");
  u.searchParams.set("bbox", `${minx},${miny},${maxx},${maxy},EPSG:4326`);
  u.searchParams.set("count", "500");
  const fc = await fetchJsonWithTimeout<any>(u.toString(), SICAR_WFS_TIMEOUT_MS);
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const out: PolyFeature[] = [];
  for (const f of features) {
    const geom = normalizePolygonGeometry(f?.geometry);
    if (!geom) continue;
    out.push({
      type: "Feature",
      properties: f?.properties || {},
      geometry: geom,
    });
  }
  return out;
}

export function mergeCarEstadualCandidates(features: PolyFeature[], sourceLabel: string): CarEstadualCandidate[] {
  const map = new Map<string, CarEstadualCandidate>();
  for (const f of features) {
    const props = (f.properties || {}) as Record<string, unknown>;
    const numero = propStr(props, "NUMEROESTADUAL", "NUMEROESTA", "numeroestadual");
    if (!numero) continue;
    const situacaoRaw = propStr(props, "SITUACAO_CAR", "SITUACAO_C", "SITUACAO");
    const nome = propStr(props, "NOMEPROPRIEDADE", "NOMEPROPRI", "nomepropriedade");
    const carFederal = propStr(props, "CAR_FEDERAL", "CODIGO_CAR_FEDERAL", "cod_imovel");
    const protocolo = propStr(props, "PROTOCOLO", "protocolo");
    const areaHa = Number(propStr(props, "AREA", "area", "AREA_HA")) || featureAreaHa(f.geometry);
    const existing = map.get(numero);
    if (!existing) {
      map.set(numero, {
        numeroEstadual: numero,
        nomePropriedade: nome,
        carFederal,
        situacao: cleanSituacao(situacaoRaw),
        situacaoRaw,
        protocolo,
        encontradoEm: [sourceLabel],
        geometry: f.geometry,
        areaHa,
      });
    } else {
      if (!existing.encontradoEm.includes(sourceLabel)) existing.encontradoEm.push(sourceLabel);
      if (!existing.nomePropriedade && nome) existing.nomePropriedade = nome;
      if (!existing.carFederal && carFederal) existing.carFederal = carFederal;
      if (!existing.protocolo && protocolo) existing.protocolo = protocolo;
      try {
        const u = turfUnion(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: existing.geometry },
            { type: "Feature", properties: {}, geometry: f.geometry },
          ]) as any,
        );
        const g = u?.geometry ? normalizePolygonGeometry(u.geometry) : null;
        if (g) {
          existing.geometry = g;
          existing.areaHa = featureAreaHa(g);
        }
      } catch {
        // keep existing
      }
    }
  }
  return Array.from(map.values());
}

export function toFederalCandidates(features: PolyFeature[]): CarFederalCandidate[] {
  const map = new Map<string, CarFederalCandidate>();
  for (const f of features) {
    const props = (f.properties || {}) as Record<string, unknown>;
    const cod = propStr(props, "cod_imovel", "COD_IMOVEL", "codImovel");
    if (!cod) continue;
    const status = federalStatusLabel(propStr(props, "status_imovel", "STATUS_IMOVEL", "ind_status"));
    const condicao = propStr(props, "condicao", "CONDICAO", "des_condic");
    const areaHa = Number(propStr(props, "area", "AREA", "num_area")) || featureAreaHa(f.geometry);
    if (!map.has(cod)) {
      map.set(cod, {
        codImovel: cod,
        status,
        condicao,
        geometry: f.geometry,
        areaHa,
      });
    }
  }
  return Array.from(map.values());
}

/* ─────────────────────────── Excel builders ─────────────────────────── */
