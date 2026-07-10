/**
 * Containment Analysis — "Áreas Não Contidas"
 *
 * Verifica a regra topológica do SIMCAR/SEMA-MT: uma camada-alvo (ex.: AREA_UMIDA)
 * deve estar COMPLETAMENTE contida pela união de uma ou mais camadas-continente
 * (ex.: AVN, AUAS, AREA_CONSOLIDADA). Quando não está, o sistema calcula a
 * diferença geométrica  alvo − ∪(continentes)  e gera os polígonos (e pontos)
 * das áreas que "sobram" — exatamente as feições que o validador reprova com
 * "Geometria deve ser completamente contida por ...".
 *
 * Endpoints:
 *   POST /api/containment/upload            — importa ZIP e lista camadas poligonais
 *   POST /api/containment/process           — inicia job de análise
 *   GET  /api/containment/jobs/:id/status   — snapshot do job
 *   GET  /api/containment/jobs/:id/events    — SSE de progresso
 *   GET  /api/containment/download/:id       — baixa ZIP de resultado
 *   DELETE /api/containment/jobs/:id         — cancela / remove
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import proj4 from "proj4";
import {
  area as turfArea,
  difference as turfDifference,
  union as turfUnion,
  featureCollection as turfFeatureCollection,
  pointOnFeature as turfPointOnFeature,
} from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import {
  getZipLayerGroups,
  parsePolygonRecords,
  detectCrs,
  ringGroupsForRecord,
  estimateUtmProjFromLonLat,
  layerBbox,
  listPolygonLayersFromZip,
  visibleVerticesLayers,
  SIRGAS_2000_PRJ,
  WGS84_PRJ,
  type CodedCrs,
  type ParsedPolygonRecord,
} from "./vertices-proximas";
import {
  buildShpAndShx,
  buildPointShpAndShx,
  buildDbfBuffer,
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

proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_AREA_M2 = 1; // slivers de borda menores que isto são ruído numérico

const subscribers = new Map<string, Set<Response>>();

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

/* ─────────────── conversão registro → GeoJSON turf ─────────────── */

/**
 * Converte um registro de polígono (rings crus) em GeoJSON, agrupando anéis
 * por profundidade de aninhamento: o primeiro anel de cada "parte" é a casca
 * (shell), os demais da mesma parte são buracos (holes). Várias partes viram
 * um MultiPolygon.
 */
function recordToGeoJSON(record: ParsedPolygonRecord): Polygon | MultiPolygon | null {
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

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0] };
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function safeFeature(geom: Polygon | MultiPolygon | null): Feature<Polygon | MultiPolygon> | null {
  if (!geom) return null;
  return { type: "Feature", properties: {}, geometry: geom };
}

/** União robusta de várias feições. Ignora as que falham individualmente. */
function unionAll(features: Array<Feature<Polygon | MultiPolygon>>): Feature<Polygon | MultiPolygon> | null {
  const valid = features.filter(Boolean);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];
  let acc: Feature<Polygon | MultiPolygon> | null = null;
  for (const feat of valid) {
    if (!acc) {
      acc = feat;
      continue;
    }
    try {
      const merged = turfUnion(turfFeatureCollection([acc, feat]) as any) as Feature<Polygon | MultiPolygon> | null;
      if (merged && merged.geometry) acc = merged;
    } catch {
      // mantém acumulado parcial; a feição problemática é ignorada
    }
  }
  return acc;
}

/* ─────────────────────── área métrica ─────────────────────── */

function metricProjForCrs(crs: CodedCrs, records: ParsedPolygonRecord[]): { label: string; projDef: string } {
  if (crs.kind === "projected" && crs.projDef) return { label: crs.label, projDef: crs.projDef };
  const bbox = layerBbox(records);
  const center: [number, number] = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : [0, 0];
  return estimateUtmProjFromLonLat(center[0], center[1]);
}

function ringPlanarArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** Área (m²) de um Polygon GeoJSON reprojetado para CRS métrico. */
function polygonMetricAreaM2(
  polygon: number[][][],
  crs: CodedCrs,
  metricProjDef: string,
): number {
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
    total += idx === 0 ? a : -a; // shell soma, buracos subtraem
  });
  return Math.max(0, total);
}

/* ─────────────── explode difference em polígonos ─────────────── */

type GapPolygon = { coordinates: number[][][]; areaM2: number };

function explodeDifference(
  diff: Feature<Polygon | MultiPolygon> | null,
  crs: CodedCrs,
  metricProjDef: string,
): GapPolygon[] {
  if (!diff || !diff.geometry) return [];
  const geom = diff.geometry;
  const polys: number[][][][] =
    geom.type === "Polygon"
      ? [geom.coordinates as number[][][]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as number[][][][])
        : [];
  return polys
    .map((coordinates) => ({ coordinates, areaM2: polygonMetricAreaM2(coordinates, crs, metricProjDef) }))
    .filter((p) => p.coordinates.length && p.areaM2 > 0);
}

/* ─────────────────────── shapefile writers ─────────────────────── */

const polygonFields: DbfFieldDef[] = [
  { name: "alvo", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 10, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "area_ha", type: "F", length: 19, decimals: 6 },
  { name: "area_m2", type: "F", length: 19, decimals: 3 },
  { name: "contido_em", type: "C", length: 180, decimals: 0 },
  { name: "erro", type: "C", length: 200, decimals: 0 },
];

const pointFields: DbfFieldDef[] = [
  { name: "alvo", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 10, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "area_ha", type: "F", length: 19, decimals: 6 },
  { name: "area_m2", type: "F", length: 19, decimals: 3 },
  { name: "x", type: "F", length: 18, decimals: 8 },
  { name: "y", type: "F", length: 18, decimals: 8 },
  { name: "contido_em", type: "C", length: 180, decimals: 0 },
];

type GapRow = {
  alvo: string;
  feicao: number;
  parte: number;
  areaHa: number;
  areaM2: number;
  contidoEm: string;
  x: number;
  y: number;
  coordinates: number[][][];
};

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: GapRow[]): Buffer {
  const headers = ["alvo", "feicao", "parte", "area_ha", "area_m2", "x", "y", "contido_em"];
  const lines = rows.map((r) =>
    [r.alvo, r.feicao, r.parte, r.areaHa.toFixed(6), r.areaM2.toFixed(3), r.x.toFixed(8), r.y.toFixed(8), r.contidoEm]
      .map(csvEscape)
      .join(";"),
  );
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

function buildReport(args: {
  filename: string;
  targetName: string;
  containerNames: string[];
  rows: GapRow[];
  totalTargetFeatures: number;
  featuresWithGap: number;
  warnings: string[];
}): Buffer {
  const lines: string[] = [];
  lines.push("Relatorio de areas nao contidas (regra de containment SIMCAR)");
  lines.push(`Arquivo analisado: ${args.filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Regra verificada: "${args.targetName}" deve estar contida por ${args.containerNames.join(", ") || "(nenhuma camada)"}.`);
  lines.push(`Feicoes da camada-alvo: ${args.totalTargetFeatures}`);
  lines.push(`Feicoes com area nao contida: ${args.featuresWithGap}`);
  lines.push(`Poligonos de erro gerados: ${args.rows.length}`);
  const totalHa = args.rows.reduce((acc, r) => acc + r.areaHa, 0);
  lines.push(`Area total nao contida: ${totalHa.toFixed(6)} ha (${(totalHa * 10000).toFixed(2)} m2)`);
  lines.push("");
  lines.push("Poligonos:");
  for (const r of args.rows) {
    lines.push(
      `- alvo=${r.alvo}; feicao=${r.feicao}; parte=${r.parte}; area=${r.areaHa.toFixed(6)} ha (${r.areaM2.toFixed(2)} m2); ` +
      `ponto=(${r.x.toFixed(8)}, ${r.y.toFixed(8)})`,
    );
  }
  if (args.warnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const w of args.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  return Buffer.from(lines.join("\n"), "utf8");
}

function buildResultZip(args: {
  rows: GapRow[];
  prjText: string;
  filename: string;
  targetName: string;
  containerNames: string[];
  totalTargetFeatures: number;
  featuresWithGap: number;
  warnings: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const contidoEm = args.containerNames.join(", ");
    const erroMsg = `Nao contida por ${contidoEm}`;

    // 1. Polígonos das áreas não contidas
    const polyRecords: ShpRecord[] = args.rows.map((r) => ({
      type: "polygon",
      rings: r.coordinates,
      attributes: {
        alvo: r.alvo,
        feicao: r.feicao,
        parte: r.parte,
        area_ha: r.areaHa,
        area_m2: r.areaM2,
        contido_em: contidoEm,
        erro: erroMsg,
      },
    }));
    const poly = buildShpAndShx(polyRecords, 5);
    archive.append(poly.shp, { name: "areas_nao_contidas.shp" });
    archive.append(poly.shx, { name: "areas_nao_contidas.shx" });
    archive.append(buildDbfBuffer(polyRecords.map((r) => r.attributes), polygonFields), { name: "areas_nao_contidas.dbf" });
    archive.append(Buffer.from(args.prjText, "utf8"), { name: "areas_nao_contidas.prj" });

    // 2. Pontos representativos (um por polígono de erro)
    const pointRecords: PointShpRecord[] = args.rows.map((r) => ({
      coordinates: [r.x, r.y],
      attributes: {
        alvo: r.alvo,
        feicao: r.feicao,
        parte: r.parte,
        area_ha: r.areaHa,
        area_m2: r.areaM2,
        x: r.x,
        y: r.y,
        contido_em: contidoEm,
      },
    }));
    const pts = buildPointShpAndShx(pointRecords, 1);
    archive.append(pts.shp, { name: "pontos_nao_contidos.shp" });
    archive.append(pts.shx, { name: "pontos_nao_contidos.shx" });
    archive.append(buildDbfBuffer(pointRecords.map((r) => r.attributes), pointFields), { name: "pontos_nao_contidos.dbf" });
    archive.append(Buffer.from(args.prjText, "utf8"), { name: "pontos_nao_contidos.prj" });

    // 3. CSV + relatório
    archive.append(buildCsv(args.rows), { name: "resumo_nao_contidas.csv" });
    archive.append(
      buildReport({
        filename: args.filename,
        targetName: args.targetName,
        containerNames: args.containerNames,
        rows: args.rows,
        totalTargetFeatures: args.totalTargetFeatures,
        featuresWithGap: args.featuresWithGap,
        warnings: args.warnings,
      }),
      { name: "relatorio_nao_contidas.txt" },
    );

    archive.finalize().catch(reject);
  });
}

/* ─────────────────────── núcleo da análise ─────────────────────── */

export type ContainmentResult = {
  rows: GapRow[];
  warnings: string[];
  crs: CodedCrs;
  prjText: string;
  totalTargetFeatures: number;
  featuresWithGap: number;
  metricLabel: string;
};

export function analyzeContainment(args: {
  targetName: string;
  targetShp: Buffer;
  targetPrj?: string;
  containers: Array<{ name: string; shp: Buffer; prj?: string }>;
  minAreaM2?: number;
}): ContainmentResult {
  const warnings: string[] = [];
  const minAreaM2 = Number.isFinite(Number(args.minAreaM2)) ? Math.max(0, Number(args.minAreaM2)) : DEFAULT_MIN_AREA_M2;

  const targetRecords = parsePolygonRecords(args.targetShp);
  const crs = detectCrs(args.targetPrj);
  if (crs.missing) throw new Error(`Camada-alvo ${args.targetName} sem CRS. Informe o .prj.`);
  if (!targetRecords.length) throw new Error(`Camada-alvo ${args.targetName} está vazia.`);

  const prjText = crs.prjText || (crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
  const metric = metricProjForCrs(crs, targetRecords);

  // União dos continentes
  const containerFeatures: Array<Feature<Polygon | MultiPolygon>> = [];
  for (const container of args.containers) {
    const records = parsePolygonRecords(container.shp);
    if (!records.length) {
      warnings.push(`${container.name}: camada continente vazia, ignorada.`);
      continue;
    }
    for (const record of records) {
      const feat = safeFeature(recordToGeoJSON(record));
      if (feat) containerFeatures.push(feat);
    }
  }
  const containerUnion = unionAll(containerFeatures);
  if (!containerUnion) {
    warnings.push("Nenhuma camada-continente válida: TODA a camada-alvo será reportada como não contida.");
  }

  const rows: GapRow[] = [];
  let featuresWithGap = 0;

  for (const record of targetRecords) {
    const targetFeature = safeFeature(recordToGeoJSON(record));
    if (!targetFeature) continue;

    let diff: Feature<Polygon | MultiPolygon> | null;
    if (!containerUnion) {
      diff = targetFeature; // sem continente, tudo é gap
    } else {
      try {
        diff = turfDifference(turfFeatureCollection([targetFeature, containerUnion]) as any) as
          | Feature<Polygon | MultiPolygon>
          | null;
      } catch (error: any) {
        warnings.push(`${args.targetName} feição ${record.feature}: falha na diferença (${error?.message || "erro"}).`);
        continue;
      }
    }

    const gaps = explodeDifference(diff, crs, metric.projDef).filter((g) => g.areaM2 >= minAreaM2);
    if (!gaps.length) continue;
    featuresWithGap += 1;

    gaps
      .sort((a, b) => b.areaM2 - a.areaM2)
      .forEach((gap, index) => {
        const feat = safeFeature({ type: "Polygon", coordinates: gap.coordinates });
        let point: [number, number] = [gap.coordinates[0]?.[0]?.[0] ?? 0, gap.coordinates[0]?.[0]?.[1] ?? 0];
        try {
          const rep = turfPointOnFeature(feat as any);
          const c = rep?.geometry?.coordinates as [number, number] | undefined;
          if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) point = c;
        } catch {
          // usa o primeiro vértice como fallback
        }
        rows.push({
          alvo: args.targetName,
          feicao: record.feature,
          parte: index + 1,
          areaHa: gap.areaM2 / 10000,
          areaM2: gap.areaM2,
          contidoEm: args.containers.map((c) => c.name).join(", "),
          x: point[0],
          y: point[1],
          coordinates: gap.coordinates,
        });
      });
  }

  rows.sort((a, b) => a.feicao - b.feicao || b.areaM2 - a.areaM2);

  return {
    rows,
    warnings,
    crs,
    prjText,
    totalTargetFeatures: targetRecords.length,
    featuresWithGap,
    metricLabel: metric.label,
  };
}

/* ─────────────────────────── SSE / jobs ─────────────────────────── */

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // conexão encerrada
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

function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "containment_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function runContainmentJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  targetLayerId: string;
  containerLayerIds: string[];
  minAreaM2?: number;
}): Promise<void> {
  const { uid, jobId, upload, targetLayerId, containerLayerIds, minAreaM2 } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const groups = getZipLayerGroups(zipBuffer);
    const byId = new Map(groups.map((g) => [g.id, g]));

    const target = byId.get(targetLayerId);
    if (!target || !target.shp) throw new Error("Camada-alvo não encontrada no ZIP.");
    const containers = containerLayerIds
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g && g.shp));
    if (!containers.length) throw new Error("Selecione ao menos uma camada-continente.");

    if (isCancelRequested(jobId)) throw new Error("cancel_requested");
    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 10,
      message: `Calculando ${target.name} − união(${containers.map((c) => c.name).join(", ")}).`,
    });

    const result = analyzeContainment({
      targetName: target.name,
      targetShp: target.shp.data,
      targetPrj: target.prj?.data.toString("utf8"),
      containers: containers.map((c) => ({
        name: c.name,
        shp: c.shp!.data,
        prj: c.prj?.data.toString("utf8"),
      })),
      minAreaM2,
    });

    if (isCancelRequested(jobId)) throw new Error("cancel_requested");
    progress(uid, jobId, { status: "processing", stage: "zip", percent: 85, message: "Gerando shapefiles de resultado." });

    const containerNames = containers.map((c) => c.name);
    const zip = await buildResultZip({
      rows: result.rows,
      prjText: result.prjText,
      filename: String(upload.filename || "car.zip"),
      targetName: target.name,
      containerNames,
      totalTargetFeatures: result.totalTargetFeatures,
      featuresWithGap: result.featuresWithGap,
      warnings: result.warnings,
    });
    const stored = saveUserBuffer({
      uid,
      area: "containment/output",
      filename: `areas_nao_contidas_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });

    const resultRows = result.rows.map((r) => ({
      alvo: r.alvo,
      feicao: r.feicao,
      parte: r.parte,
      area_ha: r.areaHa,
      area_m2: r.areaM2,
      x: r.x,
      y: r.y,
      contido_em: r.contidoEm,
    }));
    const totalHa = result.rows.reduce((acc, r) => acc + r.areaHa, 0);

    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: result.rows.length
        ? `${result.rows.length} polígono(s) não contido(s) em ${result.featuresWithGap} feição(ões).`
        : "Nenhuma área não contida: a camada-alvo está totalmente contida. ✔",
      targetName: target.name,
      containerNames,
      totalTargetFeatures: result.totalTargetFeatures,
      featuresWithGap: result.featuresWithGap,
      totalAreaHa: Number(totalHa.toFixed(6)),
      metricLabel: result.metricLabel,
      crsLabel: result.crs.label,
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/containment/download/${jobId}`,
      outputBytes: zip.length,
      resultRows,
      warnings: result.warnings,
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
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao analisar containment.",
      error: error?.message || "containment_failed",
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: error?.message || "containment_failed" });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────────── rotas ─────────────────────────── */

export function registerContainmentRoutes(app: Express): void {
  app.post("/api/containment/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "car.zip")) || "car.zip";
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
        area: "containment/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistJob(uid, uploadId, {
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

  app.post("/api/containment/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      const targetLayerId = String((req.body as any)?.targetLayerId || "").trim();
      const containerLayerIds = Array.isArray((req.body as any)?.containerLayerIds)
        ? ((req.body as any).containerLayerIds as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
      const minAreaM2 = Number((req.body as any)?.minAreaM2);
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      if (!targetLayerId) {
        res.status(400).json({ error: "Selecione a camada-alvo (que deve estar contida)." });
        return;
      }
      if (!containerLayerIds.length) {
        res.status(400).json({ error: "Selecione ao menos uma camada-continente." });
        return;
      }
      if (containerLayerIds.includes(targetLayerId)) {
        res.status(400).json({ error: "A camada-alvo não pode também ser continente." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "containment_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/containment/process",
        metadata: { uploadId, filename: upload.filename, targetLayerId, containers: containerLayerIds.length },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de containment enviada ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runContainmentJob({
        uid,
        jobId: job.jobId,
        upload,
        targetLayerId,
        containerLayerIds,
        minAreaM2: Number.isFinite(minAreaM2) ? minAreaM2 : undefined,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar análise." });
    }
  });

  app.get("/api/containment/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "containment_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/containment/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "containment_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
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

  app.get("/api/containment/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "containment_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `areas_nao_contidas_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/containment/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "containment_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    persistJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
