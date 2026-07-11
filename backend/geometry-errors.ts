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
import { kinks as turfKinks, unkinkPolygon as turfUnkink } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  detectCrs,
  getZipLayerGroups,
  listPolygonLayersFromZip,
  parsePolygonRecords,
  ringGroupsForRecord,
  SIRGAS_2000_PRJ,
  WGS84_PRJ,
  visibleVerticesLayers,
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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const subscribers = new Map<string, Set<Response>>();

export type GeometryChecks = {
  selfIntersection?: boolean;
};

export type GeometrySettings = {
  generateFixed?: boolean;
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
 * Gera a versão corrigida da camada: feições com auto-interseção são divididas
 * em polígonos simples (unkink); as demais são copiadas como estão. O atributo
 * `corrigido` marca o que mudou e `feicao` preserva o número original para
 * re-associação de atributos no SIG.
 */
export function fixLayerGeometry(args: {
  layerName: string;
  records: ParsedPolygonRecord[];
  errorFeatureIds: Set<number>;
}): LayerFixResult {
  const warnings: string[] = [];
  const outRecords: ShpRecord[] = [];
  let fixedFeatures = 0;

  for (const record of args.records) {
    const geometry = recordToGeoJSON(record);
    if (!geometry) {
      warnings.push(`${args.layerName}: feição ${record.feature} sem anéis válidos foi descartada da camada corrigida.`);
      continue;
    }
    const baseAttrs = { feicao: record.feature, camada: args.layerName };
    if (!args.errorFeatureIds.has(record.feature)) {
      outRecords.push(...geojsonToShpRecords(geometry, { ...baseAttrs, corrigido: "N" }));
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

    const pointRecords = args.rows.map(rowToPointRecord);
    const points = buildPointShpAndShx(pointRecords, 1);
    archive.append(points.shp, { name: "pontos_erros_geometria.shp" });
    archive.append(points.shx, { name: "pontos_erros_geometria.shx" });
    archive.append(buildDbfBuffer(pointRecords.map((item) => item.attributes), errorPointFields), {
      name: "pontos_erros_geometria.dbf",
    });
    archive.append(Buffer.from(args.prjText, "utf8"), { name: "pontos_erros_geometria.prj" });

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
    const analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }> = [];
    let outputPrjText = "";

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 5,
      message: "Iniciando análise de geometria.",
    });

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
        allRows.push(...rows);
        analyzedLayers.push({
          name: group.name,
          featureCount: records.length,
          errors: rows.length,
          crsLabel: crs.label,
        });
        if (settings.generateFixed !== false && rows.length > 0) {
          const errorFeatureIds = new Set(rows.map((row) => row.feicao));
          const fix = fixLayerGeometry({ layerName: group.name, records, errorFeatureIds });
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
      const hasAnyCheck = checks.selfIntersection !== false;
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
