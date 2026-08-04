/**
 * Detector: "Borda de polígono se cruza" (auto-interseção / anel colapsado) + correção da camada.
 */
import { kinks as turfKinks, unkinkPolygon as turfUnkink } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { ParsedPolygonRecord } from "../../vertices-proximas";
import { ringGroupsForRecord } from "../../vertices-proximas";
import type { ShpRecord } from "../../shapefile-writer";
import { geojsonToShpRecords } from "../../shapefile-writer";
import { SIMCAR_IMPORT_COLLAPSE_AREA_M2, SIMCAR_IMPORT_COLLAPSE_WIDTH_M, SIMCAR_IMPORT_SELF_TOUCH_M } from "../constants";
import { GeometryErrorRow, LayerFixResult, TopologyDetectOptions } from "../types";
import { buildMetricBridge, ensureClosed, minWidth, recordToGeoJSON } from "../utils";
import { cleanRecordRings } from "./duplicate-points";

/**
 * Pontos onde segmentos NÃO adjacentes do MESMO anel se tocam (< 1 mm) —
 * a "pinça" que o importador da SEMA acusa como "Borda do polígono se cruza".
 * `metric` = vértices métricos SEM o ponto de fechamento.
 */
export function ringExactSelfTouches(metric: Array<[number, number]>): Array<[number, number]> {
  const n = metric.length;
  if (n < 4) return [];
  const touches: Array<[number, number]> = [];
  // hash espacial com célula adaptativa (≥ metade do maior segmento):
  // garante nº de células limitado por segmento mesmo com arestas de km.
  let maxSegLen = 0;
  for (let i = 0; i < n; i += 1) {
    const a = metric[i];
    const b = metric[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > maxSegLen) maxSegLen = len;
  }
  const cell = Math.max(5, maxSegLen / 2);
  const grid = new Map<string, number[]>();
  const segBox = (i: number): [number, number, number, number] => {
    const a = metric[i];
    const b = metric[(i + 1) % n];
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  };
  for (let i = 0; i < n; i += 1) {
    const [x0, y0, x1, y1] = segBox(i);
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx += 1) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy += 1) {
        const key = `${gx}:${gy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  }
  const ptSegDist = (p: [number, number], a: [number, number], b: [number, number]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const checked = new Set<number>();
  for (const segs of grid.values()) {
    for (let a = 0; a < segs.length; a += 1) {
      for (let b = a + 1; b < segs.length; b += 1) {
        const i = Math.min(segs[a], segs[b]);
        const j = Math.max(segs[a], segs[b]);
        if (j - i <= 1 || (i === 0 && j === n - 1)) continue; // adjacentes
        const pairKey = i * n + j;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        const p1 = metric[i];
        const p2 = metric[(i + 1) % n];
        const q1 = metric[j];
        const q2 = metric[(j + 1) % n];
        const d = Math.min(
          ptSegDist(p1, q1, q2),
          ptSegDist(p2, q1, q2),
          ptSegDist(q1, p1, p2),
          ptSegDist(q2, p1, p2),
        );
        if (d < SIMCAR_IMPORT_SELF_TOUCH_M) {
          touches.push([(p1[0] + q1[0]) / 2, (p1[1] + q1[1]) / 2]);
        }
      }
    }
  }
  return touches;
}

/**
 * Encontra onde a borda do polígono "se cruza" segundo o importador SIMCAR.
 * Três detecções por anel:
 *  1. kinks exatos (auto-interseção real — turf);
 *  2. anel COLAPSADO: largura mínima ≤ SIMCAR_IMPORT_COLLAPSE_WIDTH_M — as
 *     paredes se sobrepõem no cluster do importador (micro-resíduos e agulhas);
 *  3. ESPIGA: vértice de ida-e-volta (ângulo ≤ ~0,5°) com braços longos.
 * Encostes pontuais de vértice em borda NÃO reprovam (regra ESRI: toque
 * pontual é permitido) — comprovado no oráculo (ver constantes SIMCAR_*).
 */
export function detectSelfIntersections(
  layerName: string,
  records: ParsedPolygonRecord[],
  options: TopologyDetectOptions = {},
): GeometryErrorRow[] {
  const collapseM =
    options.selfIntersectionSnapM === undefined
      ? SIMCAR_IMPORT_COLLAPSE_WIDTH_M
      : Math.max(0, Number(options.selfIntersectionSnapM));
  const bridge = buildMetricBridge(records);
  const rows: GeometryErrorRow[] = [];

  for (const record of records) {
    for (const group of ringGroupsForRecord(record)) {
      const raw = ensureClosed(group.coords);
      if (raw.length < 4) continue;

      // 1) kinks exatos no anel original
      let found: Array<[number, number]> = [];
      try {
        const collection = turfKinks({ type: "Polygon", coordinates: [raw] });
        found = collection.features.map((feature) => [
          Number(feature.geometry.coordinates[0]),
          Number(feature.geometry.coordinates[1]),
        ]);
      } catch {
        // segue para os testes de colapso/espiga
      }

      if (collapseM > 0) {
        try {
          const metricRaw = raw.slice(0, -1).map((p) => bridge.toMetric(p));
          // remove duplicados consecutivos exatos
          const metric: Array<[number, number]> = [];
          for (const p of metricRaw) {
            const prev = metric[metric.length - 1];
            if (!prev || p[0] !== prev[0] || p[1] !== prev[1]) metric.push(p);
          }
          if (metric.length >= 3) {
            // 2) anel colapsado: largura mínima ≤ collapseM OU área ≤ limiar —
            //    as paredes do anel se sobrepõem no cluster do importador.
            let area2 = 0;
            for (let i = 0; i < metric.length; i += 1) {
              const a = metric[i];
              const b = metric[(i + 1) % metric.length];
              area2 += a[0] * b[1] - b[0] * a[1];
            }
            const area = Math.abs(area2) / 2;
            const width = minWidth(metric);
            if (width <= collapseM || area <= SIMCAR_IMPORT_COLLAPSE_AREA_M2) {
              const cx = metric.reduce((s, p) => s + p[0], 0) / metric.length;
              const cy = metric.reduce((s, p) => s + p[1], 0) / metric.length;
              const lonlat = bridge.fromMetric([cx, cy]);
              found.push([Number(lonlat[0]), Number(lonlat[1])]);
            }
            // 4) TOQUE EXATO do próprio anel (oráculo upload v4, 16/07/2026):
            //    segmentos NÃO adjacentes a < 1 mm (anel revisita o mesmo
            //    ponto / pinça) reprovam — ARL f108/f113, AVN f108/f113,
            //    AUAS f26 = exatamente o "Borda do polígono se cruza" 2+2+1
            //    do PDF; quase-toques de 4,3 mm (f86) NÃO reprovam.
            for (const touchPt of ringExactSelfTouches(metric)) {
              const lonlat = bridge.fromMetric(touchPt);
              found.push([Number(lonlat[0]), Number(lonlat[1])]);
            }
          }
        } catch {
          // ignora falha do caminho métrico; mantém o que o kinks encontrou
        }
      }

      // Um erro por LOCAL: cluster de ~1 m em métrico (como no relatório SEMA).
      const seen = new Set<string>();
      for (const [x, y] of found) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const m = bridge.toMetric([x, y]);
        const key = `${Math.round(m[0])}:${Math.round(m[1])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          camada: layerName,
          tipo: "borda_se_cruza",
          feicao: record.feature,
          parte: group.part,
          anel: group.ring,
          x,
          y,
          detalhe:
            collapseM > 0
              ? `Borda do polígono se cruza (anel colapsado/espiga ou auto-interseção; largura crítica ${collapseM} m).`
              : "Segmentos do mesmo anel se cruzam neste ponto (auto-interseção).",
        });
      }
    }
  }
  return rows;
}

/**
 * Gera a versão corrigida da camada: vértices duplicados e anéis degenerados
 * são limpos (quando `cleanDuplicates`), e feições com auto-interseção são
 * divididas em polígonos simples (unkink). As demais são copiadas como estão.
 * O atributo `corrigido` marca o que mudou e `feicao` preserva o número
 * original para re-associação de atributos no SIG.
 */
export function fixLayerGeometry(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  errorFeatureIds: Set<number>;
  cleanDuplicates?: boolean;
}): LayerFixResult {
  const warnings: string[] = [];
  const outRecords: ShpRecord[] = [];
  let fixedFeatures = 0;

  for (const rawRecord of args.records) {
    let record = rawRecord;
    let cleanedSomething = false;
    if (args.cleanDuplicates) {
      const cleaned = cleanRecordRings(rawRecord);
      record = cleaned.record;
      cleanedSomething = cleaned.removedVertices > 0 || cleaned.droppedRings > 0;
      if (cleaned.droppedRings > 0) {
        warnings.push(
          `${args.layerName}: feição ${rawRecord.feature} teve ${cleaned.droppedRings} anel(is) degenerado(s) descartado(s) na camada corrigida.`,
        );
      }
    }
    const geometry = recordToGeoJSON(record);
    if (!geometry) {
      warnings.push(`${args.layerName}: feição ${rawRecord.feature} sem anéis válidos foi descartada da camada corrigida.`);
      continue;
    }
    const baseAttrs = { feicao: rawRecord.feature, camada: args.layerName };
    if (!args.errorFeatureIds.has(rawRecord.feature)) {
      if (cleanedSomething) fixedFeatures += 1;
      outRecords.push(...geojsonToShpRecords(geometry, { ...baseAttrs, corrigido: cleanedSomething ? "S" : "N" }));
      continue;
    }
    try {
      const feature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry };
      const simple = turfUnkink(feature as any);
      const pieces = Array.isArray(simple?.features) ? simple.features : [];
      if (!pieces.length) throw new Error("unkink não gerou polígonos");
      for (const piece of pieces) {
        if (!piece?.geometry) continue;
        outRecords.push(...geojsonToShpRecords(piece.geometry as Polygon | MultiPolygon, { ...baseAttrs, corrigido: "S" }));
      }
      fixedFeatures += 1;
    } catch (error: any) {
      warnings.push(
        `${args.layerName}: feição ${record.feature} não pôde ser corrigida automaticamente (${error?.message || "erro"}); mantida original.`,
      );
      outRecords.push(...geojsonToShpRecords(geometry, { ...baseAttrs, corrigido: "N" }));
    }
  }

  return { layerName: args.layerName, records: outRecords, fixedFeatures, warnings };
}

/* ─────────── check: sobreposição entre feições da mesma camada ─────────── */
