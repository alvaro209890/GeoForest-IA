/**
 * Detector: sobreposição proibida entre classes do SIMCAR.
 */
import { featureCollection as turfFeatureCollection, intersect as turfIntersect, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { SimcarLayerCode } from "../../simcar-rules";
import { SIMCAR_FORBIDDEN_OVERLAP_PAIRS } from "../../simcar-rules";
import { CodedFeature, GeometryErrorRow, RuleViolationPolygon, SimcarRuleLayer } from "../types";
import { bboxesTouch, geometryBbox, groupLayersByCode, polygonMetricAreaDensifiedM2 } from "../utils";

/**
 * Aplica as regras de SOBREPOSIÇÃO PROIBIDA entre feições DIFERENTES do
 * Anexo 01 (ex.: AVN não pode sobrepor AUAS nem AREA_CONSOLIDADA). As
 * camadas são reconhecidas pela nomenclatura oficial; a interseção de cada
 * par de feições vira polígono de violação com área métrica.
 */
export function detectSimcarForbiddenOverlaps(args: {
  layers: SimcarRuleLayer[];
  minAreaM2?: number;
  /** Semântica do ProcessarGeo: o par só conta se a soma das interseções ≥ este valor. */
  pairMinAreaM2?: number;
  /**
   * Filtro por PAR de feições (oráculo v8: sobreposição com RESERVATORIO
   * sem barramento é isenta — ele deve estar DENTRO de AUAS/CONS; os demais
   * corpos d'água CONTAM). Devolver false para isentar o par.
   */
  pairFilter?: (
    a: { code: SimcarLayerCode; layerName: string; feature: number },
    b: { code: SimcarLayerCode; layerName: string; feature: number },
  ) => boolean;
}): { rows: GeometryErrorRow[]; violations: RuleViolationPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const violations: RuleViolationPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minAreaM2)) ? Math.max(0, Number(args.minAreaM2)) : 1;
  const pairMin = Number.isFinite(Number(args.pairMinAreaM2)) ? Math.max(0, Number(args.pairMinAreaM2)) : null;

  const byCode = groupLayersByCode(args.layers);
  const bboxCache = new Map<CodedFeature, [number, number, number, number]>();
  const bboxOf = (item: CodedFeature): [number, number, number, number] => {
    let bbox = bboxCache.get(item);
    if (!bbox) {
      bbox = geometryBbox(item.geometry);
      bboxCache.set(item, bbox);
    }
    return bbox;
  };

  for (const [codeA, codeB] of SIMCAR_FORBIDDEN_OVERLAP_PAIRS) {
    const featuresA = byCode.get(codeA);
    const featuresB = byCode.get(codeB);
    if (!featuresA?.length || !featuresB?.length) continue;

    for (const a of featuresA) {
      for (const b of featuresB) {
        if (!bboxesTouch(bboxOf(a), bboxOf(b))) continue;
        if (
          args.pairFilter &&
          !args.pairFilter(
            { code: codeA, layerName: a.layerName, feature: a.feature },
            { code: codeB, layerName: b.layerName, feature: b.feature },
          )
        ) {
          continue;
        }
        let intersection: Feature<Polygon | MultiPolygon> | null = null;
        try {
          intersection = turfIntersect(
            turfFeatureCollection([
              { type: "Feature", properties: {}, geometry: a.geometry } as Feature<Polygon | MultiPolygon>,
              { type: "Feature", properties: {}, geometry: b.geometry } as Feature<Polygon | MultiPolygon>,
            ]) as any,
          ) as Feature<Polygon | MultiPolygon> | null;
        } catch (error: any) {
          warnings.push(
            `Regras SIMCAR: falha ao cruzar ${codeA} feição ${a.feature} com ${codeB} feição ${b.feature} (${error?.message || "geometria inválida"}); corrija a geometria antes.`,
          );
          continue;
        }
        if (!intersection?.geometry) continue;

        const polygons =
          intersection.geometry.type === "Polygon"
            ? [intersection.geometry.coordinates]
            : intersection.geometry.coordinates;
        let pairAreaM2 = 0;
        let pairTotalM2 = 0;
        const pairViolations: RuleViolationPolygon[] = [];
        for (const polygon of polygons) {
          const areaM2 = polygonMetricAreaDensifiedM2(polygon as number[][][], a.crs, a.metricProjDef);
          pairTotalM2 += areaM2;
          if (areaM2 < minArea) continue;
          pairAreaM2 += areaM2;
          pairViolations.push({
            camadaA: a.layerName,
            feicaoA: a.feature,
            camadaB: b.layerName,
            feicaoB: b.feature,
            regra: "sobreposicao",
            areaM2,
            geometry: { type: "Polygon", coordinates: polygon as number[][][] },
          });
        }
        if (!pairViolations.length) continue;
        if (pairMin !== null && pairTotalM2 < pairMin) continue; // par abaixo da resolução do ProcessarGeo
        violations.push(...pairViolations);

        let x = NaN;
        let y = NaN;
        try {
          const point = turfPointOnFeature({ type: "Feature", properties: {}, geometry: pairViolations[0].geometry } as any);
          [x, y] = point.geometry.coordinates as [number, number];
        } catch {
          [x, y] = pairViolations[0].geometry.coordinates[0][0] as [number, number];
        }
        rows.push({
          camada: a.layerName,
          tipo: "sobreposicao_proibida",
          feicao: a.feature,
          parte: 0,
          anel: 0,
          x: Number(x),
          y: Number(y),
          detalhe: `${codeA} sobrepõe ${codeB} (feição ${b.feature}) em ${(pairAreaM2 / 10000).toFixed(4)} ha (validação IMPEDITIVA do Anexo 01 do SIMCAR).`,
        });
      }
    }
  }

  return { rows, violations, warnings };
}

/* ───────── regras do ProcessarGeo oficial (oráculo CAR 270069) ───────── */
