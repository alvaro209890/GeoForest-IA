/**
 * Detector: ÁREA ÚMIDA contida em AVN ∪ AUAS ∪ CONS (oráculo v8/v22).
 */
import { booleanPointInPolygon, difference as turfDifference, featureCollection as turfFeatureCollection, point as turfPoint } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { SEMA_MSG_UMIDA_CONTIDA, SIMCAR_UMIDA_EDGE_SAMPLE_M, SIMCAR_UMIDA_FORA_TOL_M2 } from "../constants";
import { GeometryErrorRow, SimcarRuleLayer } from "../types";
import { bboxesTouch, geometryBbox, groupLayersByCode, polygonMetricAreaM2, sampleRingEveryMeters, unionFeatures } from "../utils";

/**
 * ProcessarGeo oficial — AREA_UMIDA deve estar completamente contida na
 * COBERTURA de AVN ∪ AUAS ∪ AREA_CONSOLIDADA (mensagem SEMA exata).
 *
 * Implementação (sem mock / sem feição hardcoded):
 *  1. União real dos hosts (turf union), não só diferença sequencial
 *     (a sequencial subdetectava no v22: 8 vs 41 da SEMA).
 *  2. Área residual métrica (úmida \ cobertura) > SIMCAR_UMIDA_FORA_TOL_M2.
 *  3. Amostragem da borda a cada SIMCAR_UMIDA_EDGE_SAMPLE_M: ponto fora da
 *     cobertura → reprova (micro-lascas ao longo de rios/buracos de AVN).
 *
 * Nota: o relatório ANTIGO (AVN duplicado + 256 erros) não trazia esta regra —
 * a SEMA curto-circuita quando outras falhas dominam; aqui ela roda sempre.
 */
export function detectUmidaContainment(args: {
  layers: SimcarRuleLayer[];
}): { rows: GeometryErrorRow[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const warnings: string[] = [];
  const byCode = groupLayersByCode(args.layers);
  const umidas = byCode.get("AREA_UMIDA");
  if (!umidas?.length) return { rows, warnings };
  const hosts = [
    ...(byCode.get("AVN") || []),
    ...(byCode.get("AUAS") || []),
    ...(byCode.get("AREA_CONSOLIDADA") || []),
  ];
  if (!hosts.length) {
    for (const umida of umidas) {
      const point =
        umida.geometry.type === "Polygon" ? umida.geometry.coordinates[0][0] : umida.geometry.coordinates[0][0][0];
      rows.push({
        camada: umida.layerName,
        tipo: "umida_fora_cobertura",
        feicao: umida.feature,
        parte: 0,
        anel: 0,
        x: Number(point[0]),
        y: Number(point[1]),
        detalhe: SEMA_MSG_UMIDA_CONTIDA,
      });
    }
    warnings.push("AREA_UMIDA: sem AVN/AUAS/AREA_CONSOLIDADA para validar contenção.");
    return { rows, warnings };
  }

  const coverUnion = unionFeatures(hosts);
  if (!coverUnion?.geometry) {
    warnings.push("AREA_UMIDA: falha ao unir cobertura AVN∪AUAS∪CONS; usando diferença sequencial.");
  }

  const coverFeature = coverUnion?.geometry
    ? coverUnion
    : null;

  for (const umida of umidas) {
    let foraM2 = 0;
    let edgeOutside = false;

    if (coverFeature) {
      // (2) área residual
      try {
        const diff = turfDifference(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: umida.geometry } as Feature<Polygon | MultiPolygon>,
            coverFeature,
          ]) as any,
        ) as Feature<Polygon | MultiPolygon> | null;
        if (diff?.geometry) {
          const polys =
            diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
          for (const polygon of polys) {
            foraM2 += polygonMetricAreaM2(polygon as number[][][], umida.crs, umida.metricProjDef);
          }
        }
      } catch {
        // fallback sequencial abaixo
      }

      // (3) amostragem da borda
      try {
        const polys =
          umida.geometry.type === "Polygon" ? [umida.geometry.coordinates] : umida.geometry.coordinates;
        outer: for (const poly of polys) {
          for (const ring of poly) {
            const samples = sampleRingEveryMeters(ring as number[][], umida.crs, umida.metricProjDef, SIMCAR_UMIDA_EDGE_SAMPLE_M);
            for (const pt of samples) {
              if (!booleanPointInPolygon(turfPoint(pt), coverFeature as any)) {
                edgeOutside = true;
                break outer;
              }
            }
          }
        }
      } catch {
        /* ignora amostragem se geometria degenerada */
      }
    }

    // Fallback: diferença sequencial (hosts) se união/área falhou em zero mas há hosts
    if (!coverFeature || (foraM2 <= 0 && !edgeOutside)) {
      let current: Feature<Polygon | MultiPolygon> | null = {
        type: "Feature",
        properties: {},
        geometry: umida.geometry,
      } as Feature<Polygon | MultiPolygon>;
      const umidaBbox = geometryBbox(umida.geometry);
      for (const host of hosts) {
        if (!current) break;
        if (!bboxesTouch(umidaBbox, geometryBbox(host.geometry))) continue;
        try {
          current = turfDifference(
            turfFeatureCollection([
              current,
              { type: "Feature", properties: {}, geometry: host.geometry } as Feature<Polygon | MultiPolygon>,
            ]) as any,
          ) as Feature<Polygon | MultiPolygon> | null;
        } catch {
          /* host inválido */
        }
      }
      if (current?.geometry) {
        const polys =
          current.geometry.type === "Polygon" ? [current.geometry.coordinates] : current.geometry.coordinates;
        let seqFora = 0;
        for (const polygon of polys) {
          seqFora += polygonMetricAreaM2(polygon as number[][][], umida.crs, umida.metricProjDef);
        }
        foraM2 = Math.max(foraM2, seqFora);
      }
    }

    if (foraM2 <= SIMCAR_UMIDA_FORA_TOL_M2 && !edgeOutside) continue;
    const point =
      umida.geometry.type === "Polygon" ? umida.geometry.coordinates[0][0] : umida.geometry.coordinates[0][0][0];
    rows.push({
      camada: umida.layerName,
      tipo: "umida_fora_cobertura",
      feicao: umida.feature,
      parte: 0,
      anel: 0,
      x: Number(point[0]),
      y: Number(point[1]),
      detalhe: SEMA_MSG_UMIDA_CONTIDA,
    });
  }
  return { rows, warnings };
}
