/**
 * Detector: regras de reservatório (contenção e situação).
 */
import { difference as turfDifference, featureCollection as turfFeatureCollection } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { readDbfRows } from "../../shapefile-writer";
import { recognizeSimcarLayer } from "../../simcar-rules";
import { SEMA_MSG_RESERVATORIO_CONTIDO, SEMA_MSG_RESERVATORIO_SITUACAO } from "../constants";
import { GeometryErrorRow, RuleViolationPolygon, SimcarRuleLayer } from "../types";
import { firstVertexLonLat, groupLayersByCode, polygonMetricAreaM2, unionFeatures } from "../utils";

/**
 * Regras do RESERVATORIO_ARTIFICIAL do ProcessarGeo oficial (SEMA):
 *  - espacial: reservatório SEM barramento (BARRAMENTO ≠ 'S') deve estar
 *    completamente contido em AUAS ∪ AREA_CONSOLIDADA;
 *  - atributo: nesses casos o campo SITUACAO deve ser 'O' (Outro).
 * Oráculo: relatório de processamento do CAR 270069 (12 erros espaciais +
 * 13 de atributo com essas mensagens exatas).
 */
export function detectReservatorioRules(args: {
  layers: SimcarRuleLayer[];
  minAreaM2?: number;
}): { rows: GeometryErrorRow[]; violations: RuleViolationPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const violations: RuleViolationPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minAreaM2)) ? Math.max(0, Number(args.minAreaM2)) : 1;

  const byCode = groupLayersByCode(args.layers);
  const reservatorios = byCode.get("RESERVATORIO_ARTIFICIAL");
  if (!reservatorios?.length) return { rows, violations, warnings };

  const attrsByLayer = new Map<string, Array<Record<string, string>>>();
  for (const layer of args.layers) {
    if (layer.dbf && recognizeSimcarLayer(layer.name) === "RESERVATORIO_ARTIFICIAL") {
      attrsByLayer.set(layer.name, readDbfRows(layer.dbf));
    }
  }

  const containers = [
    ...(byCode.get("AUAS") || []),
    ...(byCode.get("AREA_CONSOLIDADA") || []),
  ];
  const containerUnion = containers.length ? unionFeatures(containers) : null;

  for (const res of reservatorios) {
    const attrs = attrsByLayer.get(res.layerName)?.[res.feature - 1] || {};
    const barramento = (attrs.BARRAMENTO || "").toUpperCase();
    if (barramento === "S") continue; // com barramento: regras não se aplicam

    const [x, y] = firstVertexLonLat(res.geometry);

    const situacao = (attrs.SITUACAO || "").toUpperCase();
    if (situacao !== "O") {
      rows.push({
        camada: res.layerName,
        tipo: "atributo_situacao_reservatorio",
        feicao: res.feature,
        parte: 0,
        anel: 0,
        x,
        y,
        detalhe: SEMA_MSG_RESERVATORIO_SITUACAO,
      });
    }

    if (!containerUnion) {
      rows.push({
        camada: res.layerName,
        tipo: "reservatorio_fora_uso_antropico",
        feicao: res.feature,
        parte: 0,
        anel: 0,
        x,
        y,
        detalhe: SEMA_MSG_RESERVATORIO_CONTIDO,
      });
      continue;
    }
    let diff: Feature<Polygon | MultiPolygon> | null = null;
    try {
      diff = turfDifference(
        turfFeatureCollection([
          { type: "Feature", properties: {}, geometry: res.geometry } as Feature<Polygon | MultiPolygon>,
          containerUnion,
        ]) as any,
      ) as Feature<Polygon | MultiPolygon> | null;
    } catch (error: any) {
      warnings.push(
        `Reservatório: falha ao comparar feição ${res.feature} com AUAS/AREA_CONSOLIDADA (${error?.message || "geometria inválida"}).`,
      );
      continue;
    }
    if (!diff?.geometry) continue; // totalmente contido
    const polygons =
      diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
    let outsideM2 = 0;
    for (const polygon of polygons) {
      outsideM2 += polygonMetricAreaM2(polygon as number[][][], res.crs, res.metricProjDef);
    }
    if (outsideM2 < minArea) continue;
    rows.push({
      camada: res.layerName,
      tipo: "reservatorio_fora_uso_antropico",
      feicao: res.feature,
      parte: 0,
      anel: 0,
      x,
      y,
      detalhe: SEMA_MSG_RESERVATORIO_CONTIDO,
    });
    for (const polygon of polygons) {
      const areaM2 = polygonMetricAreaM2(polygon as number[][][], res.crs, res.metricProjDef);
      if (areaM2 < minArea) continue;
      violations.push({
        camadaA: res.layerName,
        feicaoA: res.feature,
        camadaB: "AUAS/AREA_CONSOLIDADA",
        regra: "contencao",
        areaM2,
        geometry: { type: "Polygon", coordinates: polygon as number[][][] },
      });
    }
  }

  return { rows, violations, warnings };
}
