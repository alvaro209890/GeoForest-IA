/**
 * Detector: regras de contenção entre camadas do SIMCAR.
 */
import { difference as turfDifference, featureCollection as turfFeatureCollection, pointOnFeature as turfPointOnFeature } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { SimcarLayerCode } from "../../simcar-rules";
import { recognizeSimcarLayer, SIMCAR_CONTAINMENT_RULES } from "../../simcar-rules";
import { GeometryErrorRow, RuleViolationPolygon, SimcarRuleLayer } from "../types";
import { readDbfRows } from "../../shapefile-writer";
import { groupLayersByCode, polygonMetricAreaM2, unionFeatures } from "../utils";

/**
 * Tolerância para resíduo de topologia na contenção. Uma sobra de poucos metros
 * quadrados entre camadas vizinhas é arredondamento de vetorização, não erro:
 * o CAR 6816, **aprovado pela SEMA**, era reprovado por 2 m² de ARL fora da AIR
 * em um imóvel de 62 ha. Ajustável por quem chama, via `minAreaM2`.
 */
export const CONTAINMENT_SLIVER_TOLERANCE_M2 = 500;

/**
 * `SITUACAO` da ARL que indica reserva **já vegetada** — só essas precisam
 * coincidir com a AVN. "A" (a recuperar) e "C" (compensada em outro imóvel) são
 * justamente as que não têm vegetação nativa declarada no próprio polígono.
 *
 * Sem essa distinção a regra `ARL ⊂ AVN` reprovava qualquer reserva em
 * recuperação: no CAR 6816 a ARL feição 3 (48,44 ha, `SITUACAO="A"`) saía como
 * "48,24 ha fora da AVN — validação IMPEDITIVA", enquanto as feições 1 e 2
 * (`SITUACAO="P"`) coincidiam exatamente com as duas feições de AVN.
 */
const ARL_SITUACAO_REQUIRING_VEGETATION = new Set(["P"]);

/**
 * Aplica as regras de CONTENÇÃO do Anexo 01 "Validações GEO" do SIMCAR:
 * para cada regra (ex.: AVN deve estar dentro da AIR), calcula
 * child − união(parent) e reporta as sobras como validação impeditiva.
 * As camadas são reconhecidas pela nomenclatura oficial.
 */
export function detectSimcarContainment(args: {
  layers: SimcarRuleLayer[];
  minAreaM2?: number;
}): { rows: GeometryErrorRow[]; violations: RuleViolationPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const violations: RuleViolationPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minAreaM2))
    ? Math.max(0, Number(args.minAreaM2))
    : CONTAINMENT_SLIVER_TOLERANCE_M2;

  // Atributos da ARL, para saber quais feições precisam coincidir com a AVN.
  const arlAttrsByLayer = new Map<string, Array<Record<string, string>>>();
  for (const layer of args.layers) {
    if (layer.dbf && recognizeSimcarLayer(layer.name) === "ARL") {
      arlAttrsByLayer.set(layer.name, readDbfRows(layer.dbf));
    }
  }
  const arlNeedsVegetation = (layerName: string, feature: number): boolean => {
    const rows = arlAttrsByLayer.get(layerName);
    // Sem .dbf não dá para distinguir reserva preservada de reserva a recuperar;
    // acusar seria repetir o falso positivo, então a regra não se aplica.
    if (!rows) return false;
    const situacao = String(rows[feature - 1]?.SITUACAO || "").trim().toUpperCase();
    if (!situacao) return false;
    return ARL_SITUACAO_REQUIRING_VEGETATION.has(situacao);
  };

  const byCode = groupLayersByCode(args.layers);
  const unionCache = new Map<SimcarLayerCode, Feature<Polygon | MultiPolygon> | null>();

  for (const rule of SIMCAR_CONTAINMENT_RULES) {
    const children = byCode.get(rule.child);
    const parents = byCode.get(rule.parent);
    if (!children?.length || !parents?.length) continue;

    if (!unionCache.has(rule.parent)) unionCache.set(rule.parent, unionFeatures(parents));
    const parentUnion = unionCache.get(rule.parent);
    if (!parentUnion) {
      warnings.push(`Regras SIMCAR: não foi possível unir as feições de ${rule.parent}; regra ${rule.child} ⊂ ${rule.parent} não verificada.`);
      continue;
    }

    for (const child of children) {
      // ARL só precisa estar dentro da AVN quando é reserva já vegetada.
      if (rule.child === "ARL" && rule.parent === "AVN" && !arlNeedsVegetation(child.layerName, child.feature)) {
        continue;
      }

      let diff: Feature<Polygon | MultiPolygon> | null = null;
      try {
        diff = turfDifference(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: child.geometry } as Feature<Polygon | MultiPolygon>,
            parentUnion,
          ]) as any,
        ) as Feature<Polygon | MultiPolygon> | null;
      } catch (error: any) {
        warnings.push(
          `Regras SIMCAR: falha ao comparar ${rule.child} feição ${child.feature} com ${rule.parent} (${error?.message || "geometria inválida"}); corrija a geometria antes.`,
        );
        continue;
      }
      if (!diff?.geometry) continue; // totalmente contida

      const polygons = diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
      let totalAreaM2 = 0;
      const featureViolations: RuleViolationPolygon[] = [];
      for (const polygon of polygons) {
        const areaM2 = polygonMetricAreaM2(polygon as number[][][], child.crs, child.metricProjDef);
        if (areaM2 < minArea) continue;
        totalAreaM2 += areaM2;
        featureViolations.push({
          camadaA: child.layerName,
          feicaoA: child.feature,
          camadaB: rule.parent,
          regra: "contencao",
          areaM2,
          geometry: { type: "Polygon", coordinates: polygon as number[][][] },
        });
      }
      if (!featureViolations.length) continue;
      violations.push(...featureViolations);

      let x = NaN;
      let y = NaN;
      try {
        const point = turfPointOnFeature({ type: "Feature", properties: {}, geometry: featureViolations[0].geometry } as any);
        [x, y] = point.geometry.coordinates as [number, number];
      } catch {
        [x, y] = featureViolations[0].geometry.coordinates[0][0] as [number, number];
      }
      rows.push({
        camada: child.layerName,
        tipo: "fora_do_continente",
        feicao: child.feature,
        parte: 0,
        anel: 0,
        x: Number(x),
        y: Number(y),
        detalhe: `${rule.child} vetorizada fora da ${rule.parent}: ${(totalAreaM2 / 10000).toFixed(4)} ha fora (validação IMPEDITIVA do Anexo 01 do SIMCAR).`,
      });
    }
  }

  return { rows, violations, warnings };
}
