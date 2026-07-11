/**
 * Geometry Errors — "Erros de Geometria do SIMCAR"
 *
 * Detecta (e opcionalmente corrige) erros de geometria que o validador do
 * SIMCAR/SEMA-MT reprova ao processar os shapefiles do CAR, começando por:
 *
 *   • borda_se_cruza — "Borda de polígono se cruza" (auto-interseção do anel).
 *     Detecção via cruzamento de segmentos do mesmo anel (turf kinks) e
 *     correção via divisão do polígono em polígonos simples (turf unkink).
 *
 *   • vertice_duplicado — vértices consecutivos idênticos no mesmo anel
 *     ("Vértices duplicados" no validador). Correção: remoção dos repetidos.
 *
 *   • anel_degenerado — anel com menos de 3 vértices distintos (colapsado em
 *     ponto/linha). Correção: o anel é descartado da camada corrigida.
 *
 *   • sobreposicao — feições da MESMA camada se sobrepõem ("Sobreposição de
 *     polígonos" no validador). Sem correção automática (é ambíguo qual feição
 *     recortar); o ZIP traz os polígonos exatos da sobreposição.
 *
 * A saída é um ZIP com:
 *   • pontos_erros_geometria.shp — um ponto por erro encontrado
 *   • corrigido_<camada>.shp     — camada corrigida (opcional)
 *   • resumo_erros.csv / relatorio_erros.txt
 *
 * Endpoints:
 *   POST /api/geometry-errors/upload            — importa ZIP e lista camadas poligonais
 *   POST /api/geometry-errors/process           — inicia job de análise
 *   GET  /api/geometry-errors/jobs/:id/status   — snapshot do job
 *   GET  /api/geometry-errors/jobs/:id/events   — SSE de progresso
 *   GET  /api/geometry-errors/download/:id      — baixa ZIP de resultado
 *   DELETE /api/geometry-errors/jobs/:id        — cancela / remove
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import proj4 from "proj4";
import {
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  kinks as turfKinks,
  pointOnFeature as turfPointOnFeature,
  union as turfUnion,
  unkinkPolygon as turfUnkink,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  detectCrs,
  estimateUtmProjFromLonLat,
  getZipLayerGroups,
  layerBbox,
  listPolygonLayersFromZip,
  parsePolygonRecords,
  ringGroupsForRecord,
  SIRGAS_2000_PRJ,
  WGS84_PRJ,
  visibleVerticesLayers,
  type CodedCrs,
  type ParsedPolygonRecord,
} from "./vertices-proximas";
import {
  buildDbfBuffer,
  buildPointShpAndShx,
  buildShpAndShx,
  geojsonToShpRecords,
  type DbfFieldDef,
  type PointShpRecord,
  type ShpRecord,
} from "./shapefile-writer";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import {
  checkSimcarConformity,
  recognizeSimcarLayer,
  SIMCAR_CONTAINMENT_RULES,
  SIMCAR_FORBIDDEN_OVERLAP_PAIRS,
  type SimcarLayerCode,
} from "./simcar-rules";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const subscribers = new Map<string, Set<Response>>();

export type GeometryChecks = {
  selfIntersection?: boolean;
  duplicateVertices?: boolean;
  overlaps?: boolean;
  simcarConformity?: boolean;
  simcarContainment?: boolean;
  simcarCrossOverlaps?: boolean;
};

export type RuleViolationPolygon = {
  camadaA: string;
  feicaoA: number;
  camadaB: string;
  regra: string;
  areaM2: number;
  geometry: Polygon;
};

/**
 * Tipos de erro em nível de CAMADA (sem feição/coordenada específica).
 * Ficam fora do shapefile de pontos, mas entram no CSV/relatório/tabela.
 */
export const LAYER_LEVEL_TIPOS = new Set([
  "nomenclatura_desconhecida",
  "crs_ausente",
  "crs_nao_conforme",
  "dimensao_nao_2d",
  "primitiva_incorreta",
  "atp_multipla",
  "atributo_ausente",
  "feicao_obrigatoria_ausente",
]);

export type GeometrySettings = {
  generateFixed?: boolean;
  minOverlapM2?: number;
};

export type OverlapPolygon = {
  camada: string;
  feicaoA: number;
  feicaoB: number;
  areaM2: number;
  geometry: Polygon;
};

export type GeometryErrorRow = {
  camada: string;
  tipo: string;
  feicao: number;
  parte: number;
  anel: number;
  x: number;
  y: number;
  detalhe: string;
};

export type LayerFixResult = {
  layerName: string;
  records: ShpRecord[];
  fixedFeatures: number;
  warnings: string[];
};

/* ─────────────────────────── util ─────────────────────────── */

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function ensureClosed(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, [first[0], first[1]]];
  return ring;
}

/** Agrupa anéis por parte (casca + buracos) e devolve GeoJSON Polygon/MultiPolygon. */
export function recordToGeoJSON(record: ParsedPolygonRecord): Polygon | MultiPolygon | null {
  const groups = ringGroupsForRecord(record);
  if (!groups.length) return null;

  const partsMap = new Map<number, { shell?: number[][]; holes: number[][][] }>();
  for (const group of groups) {
    const coords = ensureClosed(group.coords);
    if (coords.length < 4) continue;
    const entry = partsMap.get(group.part) || { holes: [] };
    if (group.ring === 1 && !entry.shell) entry.shell = coords;
    else entry.holes.push(coords);
    partsMap.set(group.part, entry);
  }

  const polygons: number[][][][] = [];
  for (const entry of partsMap.values()) {
    if (!entry.shell) continue;
    polygons.push([entry.shell, ...entry.holes]);
  }
  if (!polygons.length) return null;
  if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
  return { type: "MultiPolygon", coordinates: polygons };
}

/* ─────────── check: vértices duplicados / anel degenerado ─────────── */

function sameCoordinate(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
}

/**
 * Encontra vértices consecutivos idênticos no mesmo anel ("Vértices
 * duplicados") e anéis colapsados com menos de 3 vértices distintos
 * ("anel degenerado"). Trabalha sobre os anéis SEM o fechamento natural
 * (ringGroupsForRecord já o remove), então o par último→primeiro também
 * é verificado.
 */
export function detectDuplicateVertices(layerName: string, records: ParsedPolygonRecord[]): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  for (const record of records) {
    for (const group of ringGroupsForRecord(record)) {
      const coords = group.coords;
      if (!coords.length) continue;
      const distinct: number[][] = [];
      for (let i = 0; i < coords.length; i += 1) {
        const prev = i === 0 ? coords[coords.length - 1] : coords[i - 1];
        if (i > 0 && sameCoordinate(coords[i], prev)) {
          rows.push({
            camada: layerName,
            tipo: "vertice_duplicado",
            feicao: record.feature,
            parte: group.part,
            anel: group.ring,
            x: Number(coords[i][0]),
            y: Number(coords[i][1]),
            detalhe: `Vértices ${i} e ${i + 1} do anel são idênticos.`,
          });
          continue;
        }
        if (i === coords.length - 1 && coords.length > 1 && sameCoordinate(coords[i], coords[0])) {
          rows.push({
            camada: layerName,
            tipo: "vertice_duplicado",
            feicao: record.feature,
            parte: group.part,
            anel: group.ring,
            x: Number(coords[i][0]),
            y: Number(coords[i][1]),
            detalhe: `Vértice ${i + 1} repete o primeiro vértice além do fechamento do anel.`,
          });
          continue;
        }
        distinct.push(coords[i]);
      }
      if (distinct.length < 3) {
        const [x, y] = coords[0];
        rows.push({
          camada: layerName,
          tipo: "anel_degenerado",
          feicao: record.feature,
          parte: group.part,
          anel: group.ring,
          x: Number(x),
          y: Number(y),
          detalhe: `Anel com apenas ${distinct.length} vértice(s) distinto(s); polígono válido exige 3 ou mais.`,
        });
      }
    }
  }
  return rows;
}

/**
 * Limpa os anéis de um registro: remove vértices consecutivos duplicados e
 * descarta anéis degenerados (menos de 3 vértices distintos).
 */
export function cleanRecordRings(record: ParsedPolygonRecord): {
  record: ParsedPolygonRecord;
  removedVertices: number;
  droppedRings: number;
} {
  const rings: number[][][] = [];
  let removedVertices = 0;
  let droppedRings = 0;
  for (const ring of record.rings) {
    const out: number[][] = [];
    for (const point of ring) {
      const prev = out[out.length - 1];
      if (prev && sameCoordinate(prev, point)) {
        removedVertices += 1;
        continue;
      }
      out.push(point);
    }
    // Remove fechamento natural para contar vértices distintos e depois refecha.
    const open = out.length >= 2 && sameCoordinate(out[0], out[out.length - 1]) ? out.slice(0, -1) : out;
    if (open.length < 3) {
      droppedRings += 1;
      continue;
    }
    rings.push(ensureClosed(open));
  }
  return { record: { feature: record.feature, rings }, removedVertices, droppedRings };
}

/* ─────────────── check: borda de polígono se cruza ─────────────── */

/**
 * Encontra os pontos onde segmentos do MESMO anel se cruzam ("Borda de
 * polígono se cruza" no validador do SIMCAR). Cada anel é analisado
 * isoladamente para atribuir feição/parte/anel corretos ao ponto de erro.
 */
export function detectSelfIntersections(layerName: string, records: ParsedPolygonRecord[]): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  for (const record of records) {
    for (const group of ringGroupsForRecord(record)) {
      const ring = ensureClosed(group.coords);
      if (ring.length < 4) continue;
      let found: Array<[number, number]> = [];
      try {
        const collection = turfKinks({ type: "Polygon", coordinates: [ring] });
        found = collection.features.map((feature) => [
          Number(feature.geometry.coordinates[0]),
          Number(feature.geometry.coordinates[1]),
        ]);
      } catch {
        continue;
      }
      const seen = new Set<string>();
      for (const [x, y] of found) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = `${x.toFixed(9)}:${y.toFixed(9)}`;
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
          detalhe: "Segmentos do mesmo anel se cruzam neste ponto (auto-interseção).",
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

function geometryBbox(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < xMin) xMin = x;
        if (y < yMin) yMin = y;
        if (x > xMax) xMax = x;
        if (y > yMax) yMax = y;
      }
    }
  }
  return [xMin, yMin, xMax, yMax];
}

function bboxesTouch(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function ringPlanarArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** Área (m²) de um Polygon reprojetado para CRS métrico (cascas − buracos). */
function polygonMetricAreaM2(polygon: number[][][], crs: CodedCrs, metricProjDef: string): number {
  const toMetric = (pt: number[]): number[] => {
    if (crs.kind === "geographic") {
      const src = crs.projDef || "EPSG:4326";
      const out = proj4(src, metricProjDef, [pt[0], pt[1]]) as [number, number];
      return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : pt;
    }
    return pt;
  };
  let total = 0;
  polygon.forEach((ring, idx) => {
    const projected = ring.map(toMetric);
    const a = Math.abs(ringPlanarArea(projected));
    total += idx === 0 ? a : -a;
  });
  return Math.max(0, total);
}

function metricProjForCrs(crs: CodedCrs, records: ParsedPolygonRecord[]): string {
  if (crs.kind === "projected" && crs.projDef) return crs.projDef;
  const bbox = layerBbox(records);
  const center: [number, number] = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : [0, 0];
  return estimateUtmProjFromLonLat(center[0], center[1]).projDef;
}

/**
 * Detecta pares de feições da MESMA camada cujos polígonos se sobrepõem
 * (interseção com área acima de `minOverlapM2`). Sobreposições de borda com
 * área ínfima são ruído numérico e ficam abaixo do limiar padrão de 1 m².
 */
export function detectOverlaps(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  minOverlapM2?: number;
}): { rows: GeometryErrorRow[]; overlapPolygons: OverlapPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const overlapPolygons: OverlapPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minOverlapM2)) ? Math.max(0, Number(args.minOverlapM2)) : 1;
  const metricProjDef = metricProjForCrs(args.crs, args.records);

  const features = args.records
    .map((record) => {
      const geometry = recordToGeoJSON(record);
      if (!geometry) return null;
      return { feature: record.feature, geometry, bbox: geometryBbox(geometry) };
    })
    .filter((item): item is { feature: number; geometry: Polygon | MultiPolygon; bbox: [number, number, number, number] } => Boolean(item));

  for (let i = 0; i < features.length; i += 1) {
    for (let j = i + 1; j < features.length; j += 1) {
      const a = features[i];
      const b = features[j];
      if (!bboxesTouch(a.bbox, b.bbox)) continue;
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
          `${args.layerName}: não foi possível comparar as feições ${a.feature} e ${b.feature} (${error?.message || "geometria inválida"}); corrija a auto-interseção antes.`,
        );
        continue;
      }
      if (!intersection?.geometry) continue;
      const polygons =
        intersection.geometry.type === "Polygon"
          ? [intersection.geometry.coordinates]
          : intersection.geometry.coordinates;
      let pairAreaM2 = 0;
      const pairPolygons: OverlapPolygon[] = [];
      for (const polygon of polygons) {
        const areaM2 = polygonMetricAreaM2(polygon as number[][][], args.crs, metricProjDef);
        if (areaM2 < minArea) continue;
        pairAreaM2 += areaM2;
        pairPolygons.push({
          camada: args.layerName,
          feicaoA: a.feature,
          feicaoB: b.feature,
          areaM2,
          geometry: { type: "Polygon", coordinates: polygon as number[][][] },
        });
      }
      if (!pairPolygons.length) continue;
      overlapPolygons.push(...pairPolygons);
      let x = NaN;
      let y = NaN;
      try {
        const point = turfPointOnFeature({ type: "Feature", properties: {}, geometry: pairPolygons[0].geometry } as any);
        [x, y] = point.geometry.coordinates as [number, number];
      } catch {
        [x, y] = pairPolygons[0].geometry.coordinates[0][0] as [number, number];
      }
      rows.push({
        camada: args.layerName,
        tipo: "sobreposicao",
        feicao: a.feature,
        parte: 0,
        anel: 0,
        x: Number(x),
        y: Number(y),
        detalhe: `Sobrepõe a feição ${b.feature} da mesma camada em ${(pairAreaM2 / 10000).toFixed(4)} ha (${pairAreaM2.toFixed(2)} m²).`,
      });
    }
  }
  return { rows, overlapPolygons, warnings };
}

/* ────────── check: regras de contenção do Anexo 01 (SIMCAR) ────────── */

export type SimcarRuleLayer = {
  name: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
};

type CodedFeature = {
  layerName: string;
  feature: number;
  geometry: Polygon | MultiPolygon;
  crs: CodedCrs;
  metricProjDef: string;
};

function groupLayersByCode(layers: SimcarRuleLayer[]): Map<SimcarLayerCode, CodedFeature[]> {
  const byCode = new Map<SimcarLayerCode, CodedFeature[]>();
  for (const layer of layers) {
    const code = recognizeSimcarLayer(layer.name);
    if (!code || !layer.records.length) continue;
    const metricProjDef = metricProjForCrs(layer.crs, layer.records);
    const list = byCode.get(code) || [];
    for (const record of layer.records) {
      const geometry = recordToGeoJSON(record);
      if (!geometry) continue;
      list.push({ layerName: layer.name, feature: record.feature, geometry, crs: layer.crs, metricProjDef });
    }
    if (list.length) byCode.set(code, list);
  }
  return byCode;
}

/** União robusta; feições problemáticas são ignoradas (com aviso do chamador). */
function unionFeatures(features: CodedFeature[]): Feature<Polygon | MultiPolygon> | null {
  let acc: Feature<Polygon | MultiPolygon> | null = null;
  for (const item of features) {
    const feat: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: item.geometry };
    if (!acc) {
      acc = feat;
      continue;
    }
    try {
      const merged = turfUnion(turfFeatureCollection([acc, feat]) as any) as Feature<Polygon | MultiPolygon> | null;
      if (merged?.geometry) acc = merged;
    } catch {
      // mantém acumulado parcial
    }
  }
  return acc;
}

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
  const minArea = Number.isFinite(Number(args.minAreaM2)) ? Math.max(0, Number(args.minAreaM2)) : 1;

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

/**
 * Aplica as regras de SOBREPOSIÇÃO PROIBIDA entre feições DIFERENTES do
 * Anexo 01 (ex.: AVN não pode sobrepor AUAS nem AREA_CONSOLIDADA). As
 * camadas são reconhecidas pela nomenclatura oficial; a interseção de cada
 * par de feições vira polígono de violação com área métrica.
 */
export function detectSimcarForbiddenOverlaps(args: {
  layers: SimcarRuleLayer[];
  minAreaM2?: number;
}): { rows: GeometryErrorRow[]; violations: RuleViolationPolygon[]; warnings: string[] } {
  const rows: GeometryErrorRow[] = [];
  const violations: RuleViolationPolygon[] = [];
  const warnings: string[] = [];
  const minArea = Number.isFinite(Number(args.minAreaM2)) ? Math.max(0, Number(args.minAreaM2)) : 1;

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
        const pairViolations: RuleViolationPolygon[] = [];
        for (const polygon of polygons) {
          const areaM2 = polygonMetricAreaM2(polygon as number[][][], a.crs, a.metricProjDef);
          if (areaM2 < minArea) continue;
          pairAreaM2 += areaM2;
          pairViolations.push({
            camadaA: a.layerName,
            feicaoA: a.feature,
            camadaB: b.layerName,
            regra: "sobreposicao",
            areaM2,
            geometry: { type: "Polygon", coordinates: polygon as number[][][] },
          });
        }
        if (!pairViolations.length) continue;
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

/* ─────────────────────── análise por camada ─────────────────────── */

export function analyzeLayerGeometry(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  checks: GeometryChecks;
}): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  if (args.checks.selfIntersection !== false) {
    rows.push(...detectSelfIntersections(args.layerName, args.records));
  }
  if (args.checks.duplicateVertices !== false) {
    rows.push(...detectDuplicateVertices(args.layerName, args.records));
  }
  return rows;
}

/* ─────────────────────── exportação ─────────────────────── */

const errorPointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "tipo", type: "C", length: 24, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "x", type: "F", length: 18, decimals: 8 },
  { name: "y", type: "F", length: 18, decimals: 8 },
  { name: "detalhe", type: "C", length: 120, decimals: 0 },
];

const fixedLayerFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

const overlapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "feicao_b", type: "N", length: 8, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

const ruleViolationFields: DbfFieldDef[] = [
  { name: "camada_a", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "camada_b", type: "C", length: 40, decimals: 0 },
  { name: "regra", type: "C", length: 12, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

function rowToPointRecord(row: GeometryErrorRow): PointShpRecord {
  return {
    coordinates: [row.x, row.y],
    attributes: {
      camada: row.camada,
      tipo: row.tipo,
      feicao: row.feicao,
      parte: row.parte,
      anel: row.anel,
      x: row.x,
      y: row.y,
      detalhe: row.detalhe,
    },
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: GeometryErrorRow[]): Buffer {
  const headers = ["camada", "tipo", "feicao", "parte", "anel", "x", "y", "detalhe"];
  const lines = rows.map((row) => headers.map((h) => csvEscape((row as any)[h])).join(";"));
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

function buildReport(args: {
  filename: string;
  rows: GeometryErrorRow[];
  analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  fixes: LayerFixResult[];
  warnings: string[];
}): Buffer {
  const lines: string[] = [];
  lines.push("Relatorio de erros de geometria (SIMCAR)");
  lines.push(`Arquivo analisado: ${args.filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas analisadas:");
  for (const layer of args.analyzedLayers) {
    lines.push(`- ${layer.name}: feicoes=${layer.featureCount}; erros=${layer.errors}; CRS=${layer.crsLabel}`);
  }
  lines.push("");
  lines.push("Erros encontrados:");
  if (!args.rows.length) lines.push("- Nenhum erro encontrado.");
  for (const row of args.rows) {
    lines.push(
      `${row.camada}; tipo=${row.tipo}; feicao=${row.feicao}; parte=${row.parte}; anel=${row.anel}; ` +
      `xy=(${row.x}, ${row.y}); ${row.detalhe}`,
    );
  }
  if (args.fixes.length) {
    lines.push("");
    lines.push("Camadas corrigidas:");
    for (const fix of args.fixes) {
      lines.push(`- corrigido_${fix.layerName}.shp: ${fix.fixedFeatures} feicao(oes) corrigida(s). Atributo 'feicao' preserva o numero original para re-associar atributos no SIG.`);
    }
  }
  if (args.rows.some((row) => row.tipo === "sobreposicao")) {
    lines.push("");
    lines.push("Sobreposicoes: os poligonos exatos estao em poligonos_sobreposicao.shp (sem correcao automatica; decida no SIG qual feicao recortar).");
  }
  if (args.rows.some((row) => row.tipo === "fora_do_continente" || row.tipo === "sobreposicao_proibida")) {
    lines.push("");
    lines.push("Regras SIMCAR (Anexo 01): os poligonos das violacoes estao em poligonos_regras_simcar.shp (regra=contencao|sobreposicao).");
  }
  if (args.warnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const warning of args.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return Buffer.from(lines.join("\n"), "utf8");
}

function buildResultZip(args: {
  rows: GeometryErrorRow[];
  fixes: LayerFixResult[];
  overlapPolygons: OverlapPolygon[];
  ruleViolations: RuleViolationPolygon[];
  prjText: string;
  filename: string;
  analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  warnings: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const pointRecords = args.rows
      .filter((row) => !LAYER_LEVEL_TIPOS.has(row.tipo))
      .map(rowToPointRecord);
    const points = buildPointShpAndShx(pointRecords, 1);
    archive.append(points.shp, { name: "pontos_erros_geometria.shp" });
    archive.append(points.shx, { name: "pontos_erros_geometria.shx" });
    archive.append(buildDbfBuffer(pointRecords.map((item) => item.attributes), errorPointFields), {
      name: "pontos_erros_geometria.dbf",
    });
    archive.append(Buffer.from(args.prjText, "utf8"), { name: "pontos_erros_geometria.prj" });

    if (args.overlapPolygons.length > 0) {
      const overlapRecords: ShpRecord[] = args.overlapPolygons.flatMap((overlap) =>
        geojsonToShpRecords(overlap.geometry, {
          camada: overlap.camada,
          feicao_a: overlap.feicaoA,
          feicao_b: overlap.feicaoB,
          area_m2: overlap.areaM2,
          area_ha: overlap.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(overlapRecords, 5);
      archive.append(built.shp, { name: "poligonos_sobreposicao.shp" });
      archive.append(built.shx, { name: "poligonos_sobreposicao.shx" });
      archive.append(buildDbfBuffer(overlapRecords.map((item) => item.attributes), overlapFields), {
        name: "poligonos_sobreposicao.dbf",
      });
      archive.append(Buffer.from(args.prjText, "utf8"), { name: "poligonos_sobreposicao.prj" });
    }

    if (args.ruleViolations.length > 0) {
      const ruleRecords: ShpRecord[] = args.ruleViolations.flatMap((violation) =>
        geojsonToShpRecords(violation.geometry, {
          camada_a: violation.camadaA,
          feicao_a: violation.feicaoA,
          camada_b: violation.camadaB,
          regra: violation.regra,
          area_m2: violation.areaM2,
          area_ha: violation.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(ruleRecords, 5);
      archive.append(built.shp, { name: "poligonos_regras_simcar.shp" });
      archive.append(built.shx, { name: "poligonos_regras_simcar.shx" });
      archive.append(buildDbfBuffer(ruleRecords.map((item) => item.attributes), ruleViolationFields), {
        name: "poligonos_regras_simcar.dbf",
      });
      archive.append(Buffer.from(args.prjText, "utf8"), { name: "poligonos_regras_simcar.prj" });
    }

    for (const fix of args.fixes) {
      const base = `corrigido_${safeSegment(fix.layerName) || "camada"}`;
      const built = buildShpAndShx(fix.records, 5);
      archive.append(built.shp, { name: `${base}.shp` });
      archive.append(built.shx, { name: `${base}.shx` });
      archive.append(buildDbfBuffer(fix.records.map((item) => item.attributes), fixedLayerFields), {
        name: `${base}.dbf`,
      });
      archive.append(Buffer.from(args.prjText, "utf8"), { name: `${base}.prj` });
    }

    archive.append(buildCsv(args.rows), { name: "resumo_erros.csv" });
    archive.append(
      buildReport({
        filename: args.filename,
        rows: args.rows,
        analyzedLayers: args.analyzedLayers,
        fixes: args.fixes,
        warnings: args.warnings,
      }),
      { name: "relatorio_erros.txt" },
    );
    archive.finalize().catch(reject);
  });
}

/* ─────────────────────── job / SSE plumbing ─────────────────────── */

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // Connection is gone.
  }
}

function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) writeSse(res, data);
}

function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) {
    if (!res.writableEnded) res.end();
  }
  subscribers.delete(jobId);
}

function persistGeometryJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "geometry_errors_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistGeometryJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function runGeometryJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  layerIds: string[];
  checks: GeometryChecks;
  settings: GeometrySettings;
}): Promise<void> {
  const { uid, jobId, upload, layerIds, checks, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const groups = getZipLayerGroups(zipBuffer);
    const wanted = new Set(layerIds);
    const selectedGroups = groups.filter((group) => wanted.has(group.id) && group.shp);
    if (!selectedGroups.length) throw new Error("Selecione ao menos uma camada poligonal para analisar.");

    const allRows: GeometryErrorRow[] = [];
    const allWarnings: string[] = [];
    const fixes: LayerFixResult[] = [];
    const allOverlaps: OverlapPolygon[] = [];
    const allRuleViolations: RuleViolationPolygon[] = [];
    const analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }> = [];
    let outputPrjText = "";

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 5,
      message: "Iniciando análise de geometria.",
    });

    // Conformidade SIMCAR é verificada no ZIP inteiro (todas as camadas),
    // pois nomenclatura/CRS/feições obrigatórias são regras do projeto todo.
    if (checks.simcarConformity !== false) {
      try {
        const conformityRows = checkSimcarConformity(
          groups
            .filter((group) => group.shp)
            .map((group) => ({
              name: group.name,
              shp: group.shp!.data,
              prjText: group.prj?.data.toString("utf8"),
              dbf: group.dbf?.data,
            })),
        );
        allRows.push(...conformityRows);
      } catch (error: any) {
        allWarnings.push(`Conformidade SIMCAR: ${error?.message || "falha na verificação"}`);
      }
    }

    // Regras topológicas do Anexo 01 também usam o ZIP inteiro: os pares
    // (ex.: AVN ⊂ AIR, AVN × AUAS) independem de quais camadas foram marcadas.
    if (checks.simcarContainment !== false || checks.simcarCrossOverlaps !== false) {
      progress(uid, jobId, {
        status: "processing",
        stage: "simcar-rules",
        percent: 8,
        message: "Aplicando regras do Anexo 01 (SIMCAR).",
      });
      const ruleLayers: SimcarRuleLayer[] = groups
        .filter((group) => group.shp)
        .map((group) => ({
          name: group.name,
          records: parsePolygonRecords(group.shp!.data),
          crs: detectCrs(group.prj?.data.toString("utf8")),
        }));
      if (checks.simcarContainment !== false) {
        try {
          const containmentResult = detectSimcarContainment({
            layers: ruleLayers,
            minAreaM2: settings.minOverlapM2,
          });
          allRows.push(...containmentResult.rows);
          allRuleViolations.push(...containmentResult.violations);
          allWarnings.push(...containmentResult.warnings);
        } catch (error: any) {
          allWarnings.push(`Regras SIMCAR (contenção): ${error?.message || "falha na verificação"}`);
        }
      }
      if (checks.simcarCrossOverlaps !== false) {
        try {
          const crossResult = detectSimcarForbiddenOverlaps({
            layers: ruleLayers,
            minAreaM2: settings.minOverlapM2,
          });
          allRows.push(...crossResult.rows);
          allRuleViolations.push(...crossResult.violations);
          allWarnings.push(...crossResult.warnings);
        } catch (error: any) {
          allWarnings.push(`Regras SIMCAR (sobreposição): ${error?.message || "falha na verificação"}`);
        }
      }
    }

    for (let index = 0; index < selectedGroups.length; index += 1) {
      if (isCancelRequested(jobId)) throw new Error("cancel_requested");
      const group = selectedGroups[index];
      const percent = 5 + Math.round((index / selectedGroups.length) * 80);
      progress(uid, jobId, {
        status: "processing",
        stage: "layer",
        layer: group.name,
        percent,
        message: `Analisando ${group.name}.`,
      });

      try {
        const records = parsePolygonRecords(group.shp!.data);
        const crs = detectCrs(group.prj?.data.toString("utf8"));
        if (!outputPrjText) {
          outputPrjText = crs.prjText || (crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
        }
        const rows = analyzeLayerGeometry({ layerName: group.name, records, checks });
        if (checks.overlaps !== false) {
          const overlapResult = detectOverlaps({
            layerName: group.name,
            records,
            crs,
            minOverlapM2: settings.minOverlapM2,
          });
          rows.push(...overlapResult.rows);
          allOverlaps.push(...overlapResult.overlapPolygons);
          allWarnings.push(...overlapResult.warnings);
        }
        allRows.push(...rows);
        analyzedLayers.push({
          name: group.name,
          featureCount: records.length,
          errors: rows.length,
          crsLabel: crs.label,
        });
        // Sobreposição não tem correção automática; só gera camada corrigida p/ erros corrigíveis.
        if (settings.generateFixed !== false && rows.some((row) => row.tipo !== "sobreposicao")) {
          const errorFeatureIds = new Set(rows.filter((row) => row.tipo === "borda_se_cruza").map((row) => row.feicao));
          const fix = fixLayerGeometry({
            layerName: group.name,
            records,
            errorFeatureIds,
            cleanDuplicates: checks.duplicateVertices !== false,
          });
          fixes.push(fix);
          allWarnings.push(...fix.warnings);
        }
      } catch (error: any) {
        allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
        analyzedLayers.push({ name: group.name, featureCount: 0, errors: 0, crsLabel: "erro" });
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 90,
      message: "Gerando ZIP final.",
    });
    const zip = await buildResultZip({
      rows: allRows,
      fixes,
      overlapPolygons: allOverlaps,
      ruleViolations: allRuleViolations,
      prjText: outputPrjText || SIRGAS_2000_PRJ,
      filename: String(upload.filename || "geometria.zip"),
      analyzedLayers,
      warnings: allWarnings,
    });
    const stored = saveUserBuffer({
      uid,
      area: "geometry-errors/output",
      filename: `erros_geometria_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });
    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Análise concluída.",
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/geometry-errors/download/${jobId}`,
      outputBytes: zip.length,
      resultRows: allRows,
      warnings: allWarnings,
      analyzedLayers,
      fixedLayers: fixes.map((fix) => ({ name: fix.layerName, fixedFeatures: fix.fixedFeatures })),
      totalErrors: allRows.length,
      featuresWithErrors: new Set(allRows.map((row) => `${row.camada}:${row.feicao}`)).size,
      completedAt: new Date().toISOString(),
    };
    progress(uid, jobId, payload);
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const cancelled = error?.message === "cancel_requested";
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      percent: cancelled ? undefined : 100,
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao analisar geometria.",
      error: error?.message || "geometry_errors_failed",
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: error?.message || "geometry_errors_failed" });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────── rotas ─────────────────────── */

export function registerGeometryErrorsRoutes(app: Express): void {
  app.post("/api/geometry-errors/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "geometria.zip")) || "geometria.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({ error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile." });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "geometry-errors/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistGeometryJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        layers,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      res.json({
        ok: true,
        uploadId,
        filename,
        layers: visibleLayers,
        warnings: layers
          .filter((layer) => layer.ignoredReason && layer.featureCount > 0)
          .map((layer) => `${layer.name}: ${layer.ignoredReason}`),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ZIP." });
    }
  });

  app.post("/api/geometry-errors/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "geometry_errors_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload de geometria não encontrado." });
        return;
      }
      const layerIds = Array.isArray((req.body as any)?.layerIds)
        ? ((req.body as any).layerIds as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
      if (!layerIds.length) {
        res.status(400).json({ error: "Selecione ao menos uma camada para analisar." });
        return;
      }
      const checks = ((req.body as any)?.checks || {}) as GeometryChecks;
      const hasAnyCheck =
        checks.selfIntersection !== false ||
        checks.duplicateVertices !== false ||
        checks.overlaps !== false ||
        checks.simcarConformity !== false ||
        checks.simcarContainment !== false ||
        checks.simcarCrossOverlaps !== false;
      if (!hasAnyCheck) {
        res.status(400).json({ error: "Selecione ao menos um tipo de erro para verificar." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/geometry-errors/process",
        metadata: { uploadId, filename: upload.filename, layers: layerIds.length },
      });
      persistGeometryJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de geometria enviada ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runGeometryJob({
        uid,
        jobId: job.jobId,
        upload,
        layerIds,
        checks,
        settings: ((req.body as any)?.settings || {}) as GeometrySettings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/geometry-errors/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de geometria não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/geometry-errors/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de geometria não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });
    const status = String(data.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) {
      res.end();
      return;
    }
    const set = subscribers.get(jobId) || new Set<Response>();
    set.add(res);
    subscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/geometry-errors/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado de geometria não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `erros_geometria_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/geometry-errors/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    persistGeometryJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
