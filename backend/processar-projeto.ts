/**
 * Processar projeto — fluxo em 2 fases no estilo Projeto Geográfico SIMCAR.
 *
 * Fase 1 (Importar): conformidade estrutural (CRS, 2D, nomenclatura, atributos, ATP).
 * Fase 2 (Processar): topologia + Anexo 01 + soma AIR×ATP.
 *
 * Motor local reutiliza geometry-errors.ts / simcar-rules.ts.
 * Não substitui o validador oficial da SEMA; backend roda no mesmo host
 * do recorte SIMCAR (PC físico + tunnel), não em Render.
 *
 * Endpoints:
 *   POST   /api/processar-projeto/upload
 *   POST   /api/processar-projeto/importar
 *   POST   /api/processar-projeto/processar
 *   GET    /api/processar-projeto/jobs/:id/status
 *   GET    /api/processar-projeto/jobs/:id/events
 *   GET    /api/processar-projeto/download/:id
 *   DELETE /api/processar-projeto/jobs/:id
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  analyzeLayerGeometry,
  detectAirAtpAreaConsistency,
  detectGaps,
  detectOverlaps,
  detectSimcarContainment,
  detectSimcarForbiddenOverlaps,
  fixLayerGeometry,
  LAYER_LEVEL_TIPOS,
  type GapPolygon,
  type GeometryErrorRow,
  type GeometrySettings,
  type LayerFixResult,
  type OverlapPolygon,
  type RuleViolationPolygon,
  type SimcarRuleLayer,
} from "./geometry-errors";
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
} from "./simcar-rules";
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
  detectCrs,
  getZipLayerGroups,
  listPolygonLayersFromZip,
  parsePolygonRecords,
  SIRGAS_2000_PRJ,
  WGS84_PRJ,
  visibleVerticesLayers,
} from "./vertices-proximas";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const subscribers = new Map<string, Set<Response>>();

/* ─────────────────────── pure phases ─────────────────────── */

export type ImportPhaseResult = {
  ok: boolean;
  rows: GeometryErrorRow[];
  camadasReconhecidas: Array<{ name: string; code: string | null; featureCount: number; crsLabel: string }>;
  relatorioTexto: string;
  warnings: string[];
};

export type ProcessPhaseResult = {
  rows: GeometryErrorRow[];
  warnings: string[];
  analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  fixedLayers: Array<{ name: string; fixedFeatures: number }>;
  overlapPolygons: OverlapPolygon[];
  gapPolygons: GapPolygon[];
  ruleViolations: RuleViolationPolygon[];
  fixes: LayerFixResult[];
  prjText: string;
  relatorioTexto: string;
};

function groupsFromZip(zipBuffer: Buffer) {
  return getZipLayerGroups(zipBuffer);
}

/**
 * Fase Importar: inventário + conformidade estrutural do ZIP inteiro.
 * Corresponde conceitualmente a [CAR_IMPORTAR_SHAPEFILE] do SIMCAR.
 */
export function runImportPhase(zipBuffer: Buffer, filename = "projeto.zip"): ImportPhaseResult {
  const groups = groupsFromZip(zipBuffer);
  const warnings: string[] = [];
  const camadasReconhecidas = groups
    .filter((g) => g.shp)
    .map((g) => {
      const records = parsePolygonRecords(g.shp!.data);
      const crs = detectCrs(g.prj?.data.toString("utf8"));
      const code = recognizeSimcarLayer(g.name);
      return {
        name: g.name,
        code,
        featureCount: records.length,
        crsLabel: crs.missing ? "ausente" : crs.label,
      };
    });

  let rows: GeometryErrorRow[] = [];
  try {
    rows = checkSimcarConformity(
      groups
        .filter((g) => g.shp)
        .map((g) => ({
          name: g.name,
          shp: g.shp!.data,
          prjText: g.prj?.data.toString("utf8"),
          dbf: g.dbf?.data,
        })),
    );
  } catch (error: any) {
    warnings.push(`Importação: ${error?.message || "falha na conformidade"}`);
  }

  const lines: string[] = [];
  lines.push("Relatorio de importacao — Processar projeto (GeoForest / estilo SIMCAR)");
  lines.push(`Arquivo: ${filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas no ZIP:");
  for (const layer of camadasReconhecidas) {
    lines.push(
      `- ${layer.name}: codigo=${layer.code || "desconhecido"}; feicoes=${layer.featureCount}; CRS=${layer.crsLabel}`,
    );
  }
  lines.push("");
  lines.push(`Resultado da importacao: ${rows.length === 0 ? "OK (sem erros estruturais)" : `FALHA (${rows.length} inconsistencia(s))`}`);
  lines.push("");
  if (!rows.length) {
    lines.push("Nenhum erro de conformidade estrutural.");
  } else {
    lines.push("Erros de importacao (conformidade SIMCAR):");
    for (const row of rows) {
      lines.push(`${row.camada}; tipo=${row.tipo}; ${row.detalhe}`);
    }
  }
  if (warnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const w of warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("Nota: pre-validacao local. O importador oficial da SEMA pode divergir em detalhes.");
  lines.push("");

  return {
    ok: rows.length === 0,
    rows,
    camadasReconhecidas,
    relatorioTexto: lines.join("\n"),
    warnings,
  };
}

/**
 * Fase Processar: topologia + Anexo 01 + AIR×ATP em todas as camadas poligonais do ZIP.
 * Corresponde conceitualmente a [CAR_PROCESSAR_GEOMETRIAS] do SIMCAR.
 */
export function runProcessPhase(
  zipBuffer: Buffer,
  settings: GeometrySettings = {},
  filename = "projeto.zip",
  onProgress?: (patch: { percent: number; message: string; stage?: string; layer?: string }) => void,
  jobId?: string,
): ProcessPhaseResult {
  const groups = groupsFromZip(zipBuffer).filter((g) => g.shp);
  const allRows: GeometryErrorRow[] = [];
  const allWarnings: string[] = [];
  const fixes: LayerFixResult[] = [];
  const allOverlaps: OverlapPolygon[] = [];
  const allGaps: GapPolygon[] = [];
  const allRuleViolations: RuleViolationPolygon[] = [];
  const analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }> = [];
  let outputPrjText = "";
  const minArea = Number.isFinite(Number(settings.minOverlapM2)) ? Math.max(0, Number(settings.minOverlapM2)) : 1;

  onProgress?.({ percent: 5, message: "Iniciando processamento do projeto.", stage: "processing" });

  // Regras de projeto (ZIP inteiro)
  const ruleLayers: SimcarRuleLayer[] = groups.map((group) => ({
    name: group.name,
    records: parsePolygonRecords(group.shp!.data),
    crs: detectCrs(group.prj?.data.toString("utf8")),
  }));

  onProgress?.({ percent: 10, message: "Aplicando regras do Anexo 01 / AIR×ATP.", stage: "simcar-rules" });
  try {
    const containmentResult = detectSimcarContainment({ layers: ruleLayers, minAreaM2: minArea });
    allRows.push(...containmentResult.rows);
    allRuleViolations.push(...containmentResult.violations);
    allWarnings.push(...containmentResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Contenção Anexo 01: ${error?.message || "falha"}`);
  }
  try {
    const crossResult = detectSimcarForbiddenOverlaps({ layers: ruleLayers, minAreaM2: minArea });
    allRows.push(...crossResult.rows);
    allRuleViolations.push(...crossResult.violations);
    allWarnings.push(...crossResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Sobreposições proibidas: ${error?.message || "falha"}`);
  }
  try {
    const airAtpResult = detectAirAtpAreaConsistency({
      layers: ruleLayers,
      minDiffM2: minArea,
      maxDiffRatio: settings.airAtpMaxDiffRatio,
    });
    allRows.push(...airAtpResult.rows);
    allWarnings.push(...airAtpResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Soma AIR vs ATP: ${error?.message || "falha"}`);
  }

  const checks = {
    selfIntersection: true,
    duplicateVertices: true,
    overlaps: true,
    gaps: true,
  };

  for (let index = 0; index < groups.length; index += 1) {
    if (jobId && isCancelRequested(jobId)) throw new Error("cancel_requested");
    const group = groups[index];
    const percent = 15 + Math.round((index / Math.max(1, groups.length)) * 70);
    onProgress?.({
      percent,
      message: `Analisando ${group.name}.`,
      stage: "layer",
      layer: group.name,
    });

    try {
      const records = parsePolygonRecords(group.shp!.data);
      const crs = detectCrs(group.prj?.data.toString("utf8"));
      if (!outputPrjText) {
        outputPrjText = crs.prjText || (crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
      }
      const rows = analyzeLayerGeometry({ layerName: group.name, records, checks });
      const overlapResult = detectOverlaps({
        layerName: group.name,
        records,
        crs,
        minOverlapM2: minArea,
      });
      rows.push(...overlapResult.rows);
      allOverlaps.push(...overlapResult.overlapPolygons);
      allWarnings.push(...overlapResult.warnings);

      const gapResult = detectGaps({
        layerName: group.name,
        records,
        crs,
        minGapM2: minArea,
      });
      rows.push(...gapResult.rows);
      allGaps.push(...gapResult.gapPolygons);
      allWarnings.push(...gapResult.warnings);

      allRows.push(...rows);
      analyzedLayers.push({
        name: group.name,
        featureCount: records.length,
        errors: rows.length,
        crsLabel: crs.label,
      });

      const nonFixable = new Set(["sobreposicao", "vazio"]);
      if (settings.generateFixed !== false && rows.some((row) => !nonFixable.has(row.tipo))) {
        const errorFeatureIds = new Set(
          rows.filter((row) => row.tipo === "borda_se_cruza").map((row) => row.feicao),
        );
        const fix = fixLayerGeometry({
          layerName: group.name,
          records,
          errorFeatureIds,
          cleanDuplicates: true,
        });
        fixes.push(fix);
        allWarnings.push(...fix.warnings);
      }
    } catch (error: any) {
      allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
      analyzedLayers.push({ name: group.name, featureCount: 0, errors: 0, crsLabel: "erro" });
    }
  }

  const lines: string[] = [];
  lines.push("Relatorio de processamento — Processar projeto (GeoForest / estilo SIMCAR)");
  lines.push(`Arquivo: ${filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas analisadas:");
  for (const layer of analyzedLayers) {
    lines.push(`- ${layer.name}: feicoes=${layer.featureCount}; erros=${layer.errors}; CRS=${layer.crsLabel}`);
  }
  lines.push("");
  lines.push(`Total de inconsistencias: ${allRows.length}`);
  lines.push("");
  if (!allRows.length) {
    lines.push("Processamento realizado com sucesso, nenhum erro encontrado.");
  } else {
    lines.push("Erros encontrados:");
    for (const row of allRows) {
      lines.push(
        `${row.camada}; tipo=${row.tipo}; feicao=${row.feicao}; xy=(${row.x}, ${row.y}); ${row.detalhe}`,
      );
    }
  }
  if (allRows.some((r) => r.tipo === "sobreposicao")) {
    lines.push("");
    lines.push("Sobreposicoes: poligonos_sobreposicao.shp");
  }
  if (allRows.some((r) => r.tipo === "vazio")) {
    lines.push("");
    lines.push("Vazios/gaps: poligonos_vazios.shp");
  }
  if (allRows.some((r) => r.tipo === "fora_do_continente" || r.tipo === "sobreposicao_proibida")) {
    lines.push("");
    lines.push("Anexo 01: poligonos_regras_simcar.shp");
  }
  if (allRows.some((r) => r.tipo === "air_atp_area")) {
    lines.push("");
    lines.push("Soma AIR vs ATP divergente (Manual Projeto Geografico).");
  }
  if (allWarnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const w of allWarnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("Nota: pre-validacao local. Nao substitui ProcessarGeo oficial da SEMA.");
  lines.push("");

  return {
    rows: allRows,
    warnings: allWarnings,
    analyzedLayers,
    fixedLayers: fixes.map((f) => ({ name: f.layerName, fixedFeatures: f.fixedFeatures })),
    overlapPolygons: allOverlaps,
    gapPolygons: allGaps,
    ruleViolations: allRuleViolations,
    fixes,
    prjText: outputPrjText || SIRGAS_2000_PRJ,
    relatorioTexto: lines.join("\n"),
  };
}

/* ─────────────────────── ZIP ─────────────────────── */

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

const overlapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "feicao_b", type: "N", length: 8, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

const gapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicoes", type: "C", length: 40, decimals: 0 },
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

const fixedLayerFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
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

export function buildProcessarProjetoZip(args: {
  importRelatorio: string;
  process: ProcessPhaseResult;
  importRows?: GeometryErrorRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const allRows = [...(args.importRows || []), ...args.process.rows];
    const prj = args.process.prjText || SIRGAS_2000_PRJ;

    archive.append(Buffer.from(args.importRelatorio, "utf8"), { name: "relatorio_importacao.txt" });
    archive.append(Buffer.from(args.process.relatorioTexto, "utf8"), { name: "relatorio_processamento.txt" });
    archive.append(buildCsv(allRows), { name: "resumo_erros.csv" });

    const pointRecords: PointShpRecord[] = args.process.rows
      .filter((row) => !LAYER_LEVEL_TIPOS.has(row.tipo))
      .map((row) => ({
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
      }));
    const points = buildPointShpAndShx(pointRecords, 1);
    archive.append(points.shp, { name: "pontos_erros.shp" });
    archive.append(points.shx, { name: "pontos_erros.shx" });
    archive.append(buildDbfBuffer(pointRecords.map((p) => p.attributes), errorPointFields), {
      name: "pontos_erros.dbf",
    });
    archive.append(Buffer.from(prj, "utf8"), { name: "pontos_erros.prj" });

    if (args.process.overlapPolygons.length) {
      const records: ShpRecord[] = args.process.overlapPolygons.flatMap((o) =>
        geojsonToShpRecords(o.geometry, {
          camada: o.camada,
          feicao_a: o.feicaoA,
          feicao_b: o.feicaoB,
          area_m2: o.areaM2,
          area_ha: o.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(records, 5);
      archive.append(built.shp, { name: "poligonos_sobreposicao.shp" });
      archive.append(built.shx, { name: "poligonos_sobreposicao.shx" });
      archive.append(buildDbfBuffer(records.map((r) => r.attributes), overlapFields), {
        name: "poligonos_sobreposicao.dbf",
      });
      archive.append(Buffer.from(prj, "utf8"), { name: "poligonos_sobreposicao.prj" });
    }

    if (args.process.gapPolygons.length) {
      const records: ShpRecord[] = args.process.gapPolygons.flatMap((g) =>
        geojsonToShpRecords(g.geometry, {
          camada: g.camada,
          feicoes: g.feicoes.join(",").slice(0, 40),
          area_m2: g.areaM2,
          area_ha: g.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(records, 5);
      archive.append(built.shp, { name: "poligonos_vazios.shp" });
      archive.append(built.shx, { name: "poligonos_vazios.shx" });
      archive.append(buildDbfBuffer(records.map((r) => r.attributes), gapFields), {
        name: "poligonos_vazios.dbf",
      });
      archive.append(Buffer.from(prj, "utf8"), { name: "poligonos_vazios.prj" });
    }

    if (args.process.ruleViolations.length) {
      const records: ShpRecord[] = args.process.ruleViolations.flatMap((v) =>
        geojsonToShpRecords(v.geometry, {
          camada_a: v.camadaA,
          feicao_a: v.feicaoA,
          camada_b: v.camadaB,
          regra: v.regra,
          area_m2: v.areaM2,
          area_ha: v.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(records, 5);
      archive.append(built.shp, { name: "poligonos_regras_simcar.shp" });
      archive.append(built.shx, { name: "poligonos_regras_simcar.shx" });
      archive.append(buildDbfBuffer(records.map((r) => r.attributes), ruleViolationFields), {
        name: "poligonos_regras_simcar.dbf",
      });
      archive.append(Buffer.from(prj, "utf8"), { name: "poligonos_regras_simcar.prj" });
    }

    for (const fix of args.process.fixes) {
      const base = `corrigido_${safeSegment(fix.layerName) || "camada"}`;
      const built = buildShpAndShx(fix.records, 5);
      archive.append(built.shp, { name: `${base}.shp` });
      archive.append(built.shx, { name: `${base}.shx` });
      archive.append(buildDbfBuffer(fix.records.map((r) => r.attributes), fixedLayerFields), {
        name: `${base}.dbf`,
      });
      archive.append(Buffer.from(prj, "utf8"), { name: `${base}.prj` });
    }

    archive.finalize().catch(reject);
  });
}

/* ─────────────────────── job plumbing ─────────────────────── */

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    /* gone */
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
    ["users", uid, "processar_projeto_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function runProcessJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  importSnapshot: any;
  settings: GeometrySettings;
}): Promise<void> {
  const { uid, jobId, upload, importSnapshot, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const filename = String(upload.filename || "projeto.zip");

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 3,
      message: "Iniciando processamento do projeto geográfico.",
    });

    const processResult = runProcessPhase(
      zipBuffer,
      settings,
      filename,
      (patch) => {
        progress(uid, jobId, {
          status: "processing",
          stage: patch.stage || "processing",
          layer: patch.layer,
          percent: patch.percent,
          message: patch.message,
        });
      },
      jobId,
    );

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 92,
      message: "Gerando ZIP final.",
    });

    const importRelatorio =
      String(importSnapshot?.relatorioTexto || "") ||
      runImportPhase(zipBuffer, filename).relatorioTexto;
    const importRows = Array.isArray(importSnapshot?.rows) ? (importSnapshot.rows as GeometryErrorRow[]) : [];

    const zip = await buildProcessarProjetoZip({
      importRelatorio,
      process: processResult,
      importRows,
    });

    const stored = saveUserBuffer({
      uid,
      area: "processar-projeto/output",
      filename: `processar_projeto_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });

    const allResultRows = [...importRows, ...processResult.rows];
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message:
        processResult.rows.length === 0
          ? "Processamento concluído sem erros."
          : `Processamento concluído com ${processResult.rows.length} inconsistência(s).`,
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/processar-projeto/download/${jobId}`,
      outputBytes: zip.length,
      resultRows: allResultRows,
      processRows: processResult.rows,
      importRows,
      warnings: processResult.warnings,
      analyzedLayers: processResult.analyzedLayers,
      fixedLayers: processResult.fixedLayers,
      totalErrors: allResultRows.length,
      processErrors: processResult.rows.length,
      importErrors: importRows.length,
      featuresWithErrors: new Set(processResult.rows.map((r) => `${r.camada}:${r.feicao}`)).size,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const cancelled = error?.message === "cancel_requested";
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      percent: cancelled ? undefined : 100,
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao processar projeto.",
      error: error?.message || "processar_projeto_failed",
    });
    finishJob({
      jobId,
      status: cancelled ? "cancelled" : "failed",
      error: error?.message || "processar_projeto_failed",
    });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────── routes ─────────────────────── */

export function registerProcessarProjetoRoutes(app: Express): void {
  app.post("/api/processar-projeto/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "projeto.zip")) || "projeto.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({
          error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile.",
        });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "processar-projeto/input",
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

  app.post("/api/processar-projeto/importar", async (req: Request, res: Response) => {
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
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado. Envie o ZIP novamente." });
        return;
      }
      const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
      const zipBuffer = fs.readFileSync(inputPath);
      const result = runImportPhase(zipBuffer, String(upload.filename || "projeto.zip"));
      const importId = crypto.randomUUID();
      persistJob(uid, importId, {
        type: "import",
        uploadId,
        status: result.ok ? "import_ok" : "import_failed",
        filename: upload.filename,
        rows: result.rows,
        camadasReconhecidas: result.camadasReconhecidas,
        relatorioTexto: result.relatorioTexto,
        warnings: result.warnings,
        ok: result.ok,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      // Keep import snapshot on upload doc for process step
      persistJob(uid, uploadId, {
        lastImportId: importId,
        lastImportOk: result.ok,
        lastImportRows: result.rows,
        lastImportRelatorio: result.relatorioTexto,
        lastImportCamadas: result.camadasReconhecidas,
      });
      res.json({
        ok: result.ok,
        importId,
        uploadId,
        rows: result.rows,
        camadasReconhecidas: result.camadasReconhecidas,
        relatorioTexto: result.relatorioTexto,
        warnings: result.warnings,
        totalErrors: result.rows.length,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha na importação." });
    }
  });

  app.post("/api/processar-projeto/processar", async (req: Request, res: Response) => {
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
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const importId = String((req.body as any)?.importId || upload.lastImportId || "").trim();
      let importSnapshot: any = null;
      if (importId) {
        importSnapshot = readDocBySegments(["users", uid, "processar_projeto_jobs", importId]);
      }
      if (!importSnapshot && upload.lastImportRelatorio) {
        importSnapshot = {
          rows: upload.lastImportRows || [],
          relatorioTexto: upload.lastImportRelatorio,
        };
      }
      if (!importSnapshot) {
        // Auto-run import if user skipped explicit call
        const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
        const zipBuffer = fs.readFileSync(inputPath);
        const autoImport = runImportPhase(zipBuffer, String(upload.filename || "projeto.zip"));
        importSnapshot = {
          rows: autoImport.rows,
          relatorioTexto: autoImport.relatorioTexto,
        };
      }

      const settings = ((req.body as any)?.settings || {}) as GeometrySettings;
      const job = startJob({
        uid,
        endpoint: "/api/processar-projeto/processar",
        metadata: { uploadId, filename: upload.filename },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        importId: importId || null,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento enviado ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runProcessJob({
        uid,
        jobId: job.jobId,
        upload,
        importSnapshot,
        settings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/processar-projeto/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/processar-projeto/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let set = subscribers.get(jobId);
    if (!set) {
      set = new Set();
      subscribers.set(jobId, set);
    }
    set.add(res);
    writeSse(res, { type: "snapshot", jobId, job: data });

    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId, t: Date.now() }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set?.delete(res);
      if (set && set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/processar-projeto/download/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (!data?.outputRelativePath) {
        res.status(404).json({ error: "Resultado não disponível." });
        return;
      }
      const abs = getAbsoluteStoragePath(String(data.outputRelativePath));
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: "Arquivo de resultado não encontrado." });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="processar_projeto_${jobId.slice(0, 8)}.zip"`,
      );
      fs.createReadStream(abs).pipe(res);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha no download." });
    }
  });

  app.delete("/api/processar-projeto/jobs/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      requestCancel(jobId);
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (data?.inputRelativePath) removeStoragePath(String(data.inputRelativePath));
      if (data?.outputRelativePath) removeStoragePath(String(data.outputRelativePath));
      persistJob(uid, jobId, { status: "deleted", message: "Removido." });
      closeSubscribers(jobId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao remover job." });
    }
  });
}
