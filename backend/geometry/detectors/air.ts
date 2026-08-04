/**
 * Detectores das regras da AIR: área AIR×ATP e composição (hidrografia) da AIR.
 */
import { featureCollection as turfFeatureCollection, intersect as turfIntersect, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { readDbfRows } from "../../shapefile-writer";
import type { SimcarLayerCode } from "../../simcar-rules";
import { recognizeSimcarLayer } from "../../simcar-rules";
import { AIR_COMPOSITION_HYDRO } from "../constants";
import { CodedFeature, GeometryErrorRow, SimcarRuleLayer } from "../types";
import { firstVertexLonLat, geometryBbox, geometryMetricAreaM2, groupLayersByCode, polygonMetricAreaM2 } from "../utils";

/**
 * Verifica a regra de feições obrigatórias do Manual do Projeto Geográfico:
 * a soma das áreas das AIRs deve corresponder à área da ATP. Emite um erro
 * de nível de camada quando |soma(AIR) − ATP| supera o máximo entre o limiar
 * absoluto (m²) e a tolerância relativa (padrão 0,01% da maior área).
 */
export function detectAirAtpAreaConsistency(args: {
  layers: SimcarRuleLayer[];
  minDiffM2?: number;
  maxDiffRatio?: number;
}): { rows: GeometryErrorRow[]; warnings: string[]; airAreaM2: number; atpAreaM2: number } {
  const rows: GeometryErrorRow[] = [];
  const warnings: string[] = [];
  const minDiff = Number.isFinite(Number(args.minDiffM2)) ? Math.max(0, Number(args.minDiffM2)) : 1;
  const maxRatio =
    Number.isFinite(Number(args.maxDiffRatio)) && Number(args.maxDiffRatio) >= 0
      ? Number(args.maxDiffRatio)
      : 0.0001;

  const byCode = groupLayersByCode(args.layers);
  const airFeatures = byCode.get("AIR") || [];
  const atpFeatures = byCode.get("ATP") || [];

  if (!airFeatures.length || !atpFeatures.length) {
    return { rows, warnings, airAreaM2: 0, atpAreaM2: 0 };
  }

  let airAreaM2 = 0;
  for (const item of airFeatures) {
    airAreaM2 += geometryMetricAreaM2(item.geometry, item.crs, item.metricProjDef);
  }
  let atpAreaM2 = 0;
  for (const item of atpFeatures) {
    atpAreaM2 += geometryMetricAreaM2(item.geometry, item.crs, item.metricProjDef);
  }

  const absDiff = Math.abs(airAreaM2 - atpAreaM2);
  const threshold = Math.max(minDiff, maxRatio * Math.max(airAreaM2, atpAreaM2));
  if (absDiff <= threshold) {
    return { rows, warnings, airAreaM2, atpAreaM2 };
  }

  // Ponto representativo: centroide aproximado da primeira ATP.
  let x = 0;
  let y = 0;
  try {
    const point = turfPointOnFeature({
      type: "Feature",
      properties: {},
      geometry: atpFeatures[0].geometry,
    } as any);
    [x, y] = point.geometry.coordinates as [number, number];
  } catch {
    const bbox = geometryBbox(atpFeatures[0].geometry);
    x = (bbox[0] + bbox[2]) / 2;
    y = (bbox[1] + bbox[3]) / 2;
  }

  const airHa = airAreaM2 / 10000;
  const atpHa = atpAreaM2 / 10000;
  const diffHa = absDiff / 10000;
  rows.push({
    camada: atpFeatures[0].layerName,
    tipo: "air_atp_area",
    feicao: 0,
    parte: 0,
    anel: 0,
    x: Number(x),
    y: Number(y),
    detalhe:
      `Soma das AIRs (${airHa.toFixed(4)} ha) diverge da ATP (${atpHa.toFixed(4)} ha) em ${diffHa.toFixed(4)} ha ` +
      `(${absDiff.toFixed(2)} m²; limiar ${threshold.toFixed(2)} m²). Manual SIMCAR: a soma das AIRs deve corresponder à ATP.`,
  });

  return { rows, warnings, airAreaM2, atpAreaM2 };
}

/* ────────── check: regras de contenção do Anexo 01 (SIMCAR) ────────── */


/**
 * Conferência de composição da AIR (ProcessarGeo oficial): a soma das áreas de
 * AVN, AUAS, Área Consolidada e Hidrografia dentro de cada AIR de tipo 'M'
 * deve corresponder à área total da AIR. Mensagem idêntica à da SEMA, com a
 * identificação da matrícula. Tolerância padrão 0,5% (não calibrada — no
 * oráculo todas as AIRs falhavam por dupla contagem de AVN duplicada).
 */
export function detectAirCompositionConsistency(args: {
  layers: SimcarRuleLayer[];
  tolRatio?: number;
}): { rows: GeometryErrorRow[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const warnings: string[] = [];
  const tolRatio = Number.isFinite(Number(args.tolRatio)) ? Math.max(0, Number(args.tolRatio)) : 0.005;

  const byCode = groupLayersByCode(args.layers);
  const airs = byCode.get("AIR");
  if (!airs?.length) return { rows, warnings };

  const airAttrs = new Map<string, Array<Record<string, string>>>();
  for (const layer of args.layers) {
    if (layer.dbf && recognizeSimcarLayer(layer.name) === "AIR") {
      airAttrs.set(layer.name, readDbfRows(layer.dbf));
    }
  }

  const componentCodes: SimcarLayerCode[] = ["AVN", "AUAS", "AREA_CONSOLIDADA", ...AIR_COMPOSITION_HYDRO];
  const components: CodedFeature[] = [];
  for (const code of componentCodes) components.push(...(byCode.get(code) || []));

  for (const air of airs) {
    const attrs = airAttrs.get(air.layerName)?.[air.feature - 1] || {};
    const tipo = (attrs.TIPO || "").toUpperCase();
    if (tipo && tipo !== "M") continue;
    const identific = attrs.IDENTIFIC || attrs.IDENTIFICA || String(air.feature);

    const airPolygons =
      air.geometry.type === "Polygon" ? [air.geometry.coordinates] : air.geometry.coordinates;
    let airArea = 0;
    for (const polygon of airPolygons) {
      airArea += polygonMetricAreaM2(polygon as number[][][], air.crs, air.metricProjDef);
    }
    if (airArea <= 0) continue;

    let sum = 0;
    for (const comp of components) {
      let intersection: Feature<Polygon | MultiPolygon> | null = null;
      try {
        intersection = turfIntersect(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: air.geometry } as Feature<Polygon | MultiPolygon>,
            { type: "Feature", properties: {}, geometry: comp.geometry } as Feature<Polygon | MultiPolygon>,
          ]) as any,
        ) as Feature<Polygon | MultiPolygon> | null;
      } catch {
        continue; // geometria problemática já é acusada em outros checks
      }
      if (!intersection?.geometry) continue;
      const polygons =
        intersection.geometry.type === "Polygon"
          ? [intersection.geometry.coordinates]
          : intersection.geometry.coordinates;
      for (const polygon of polygons) {
        sum += polygonMetricAreaM2(polygon as number[][][], air.crs, air.metricProjDef);
      }
    }

    if (Math.abs(sum - airArea) <= tolRatio * airArea) continue;
    const [x, y] = firstVertexLonLat(air.geometry);
    rows.push({
      camada: air.layerName,
      tipo: "air_composicao_area",
      feicao: air.feature,
      parte: 0,
      anel: 0,
      x,
      y,
      detalhe: `A soma das áreas de AVN, AUAS, Área Consolidada e Hidrografia não corresponde à área total da AIR de tipo 'M' e identificação '${identific}'.`,
    });
  }

  return { rows, warnings };
}

/* ─────────────────────── análise por camada ─────────────────────── */
