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
  generateSimcarDerivedLayers,
  parsePointRecords,
  type ProcessarGeoInputLayer,
} from "./simcar-processar-geo";
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

/** Camada pronta para gravação em shapefile (processado / conferência). */
export type ProcessedLayerOut = {
  name: string;
  records: ShpRecord[];
  fixedFeatures: number;
  featureCount: number;
};

/** Cópia dos arquivos originais do ZIP de entrada (arquivo enviado). */
export type OriginalLayerOut = {
  name: string;
  shp: Buffer;
  dbf?: Buffer;
  prjText: string;
};

export type QuadroAreaRow = {
  camada: string;
  codigo: string;
  feicoes: number;
  erros: number;
  corrigidas: number;
  area_m2: number;
  area_ha: number;
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
  /** Sempre preenchido: camadas limpas (unkink + vértices) = base do arquivo processado. */
  processedLayers: ProcessedLayerOut[];
  /** Camadas originais do ZIP (arquivo enviado). */
  originalLayers: OriginalLayerOut[];
  quadroAreas: QuadroAreaRow[];
  prjText: string;
  relatorioTexto: string;
};

/** Área planar aproximada (m² se CRS métrico; senão unidade do CRS). */
function ringsAreaAbs(rings: number[][][]): number {
  let total = 0;
  for (let r = 0; r < rings.length; r += 1) {
    const ring = rings[r];
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    const abs = Math.abs(a / 2);
    total += r === 0 ? abs : -abs;
  }
  return Math.max(0, total);
}

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
 * Fase Processar — espelha [CAR_PROCESSAR_GEOMETRIAS] / ProcessarGeo:
 * topologia + Anexo 01 + AIR×ATP + geração de APP/APPD/APPP/APPRL/AURD/ARLDR
 * e empacotamento do arquivo processado completo.
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
  const processedLayers: ProcessedLayerOut[] = [];
  const originalLayers: OriginalLayerOut[] = [];
  const quadroAreas: QuadroAreaRow[] = [];
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

  // ─── ProcessarGeo: deriva APP, APPD, APPP, APPRL, AURD, ARLDR ───
  onProgress?.({ percent: 12, message: "Calculando APP / APPD / APPP / APPRL (ProcessarGeo).", stage: "app" });
  let derivedLayers: ReturnType<typeof generateSimcarDerivedLayers>["derived"] = [];
  try {
    const geoInputs: ProcessarGeoInputLayer[] = groups.map((group) => {
      const crs = detectCrs(group.prj?.data.toString("utf8"));
      const records = parsePolygonRecords(group.shp!.data);
      const points =
        records.length === 0 ? parsePointRecords(group.shp!.data) : undefined;
      return { name: group.name, records, crs, points };
    });
    // Also attach points for NASCENTE even if polygon parse found something wrong
    for (const input of geoInputs) {
      const code = recognizeSimcarLayer(input.name);
      if (code === "NASCENTE" && !input.points?.length) {
        const group = groups.find((g) => g.name === input.name);
        if (group?.shp) input.points = parsePointRecords(group.shp.data);
      }
    }
    const derivedResult = generateSimcarDerivedLayers(geoInputs);
    derivedLayers = derivedResult.derived;
    allRows.push(...derivedResult.errorRows);
    allWarnings.push(...derivedResult.warnings);
    for (const q of derivedResult.quadroApp) {
      quadroAreas.push({
        camada: q.feicao,
        codigo: q.feicao,
        feicoes: 1,
        erros: 0,
        corrigidas: 0,
        area_m2: q.area_m2,
        area_ha: q.area_ha,
      });
    }
  } catch (error: any) {
    allWarnings.push(`ProcessarGeo (APP): ${error?.message || "falha no cálculo de APP"}`);
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

      // Sempre gera camada processada (arquivo processado SIMCAR-like),
      // mesmo sem erros: limpa vértices e unkink de auto-interseções.
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
      processedLayers.push({
        name: group.name,
        records: fix.records,
        fixedFeatures: fix.fixedFeatures,
        featureCount: fix.records.length,
      });

      originalLayers.push({
        name: group.name,
        shp: group.shp!.data,
        dbf: group.dbf?.data,
        prjText: crs.prjText || outputPrjText || SIRGAS_2000_PRJ,
      });

      let layerArea = 0;
      for (const rec of fix.records) {
        layerArea += ringsAreaAbs(rec.rings || []);
      }
      quadroAreas.push({
        camada: group.name,
        codigo: recognizeSimcarLayer(group.name) || "",
        feicoes: records.length,
        erros: rows.length,
        corrigidas: fix.fixedFeatures,
        area_m2: layerArea,
        area_ha: layerArea / 10000,
      });
    } catch (error: any) {
      allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
      analyzedLayers.push({ name: group.name, featureCount: 0, errors: 0, crsLabel: "erro" });
    }
  }

  // Inclui camadas derivadas (APP, APPD…) no arquivo processado
  for (const d of derivedLayers) {
    processedLayers.push({
      name: d.name,
      records: d.records,
      fixedFeatures: 0,
      featureCount: d.featureCount,
    });
    analyzedLayers.push({
      name: d.name,
      featureCount: d.featureCount,
      errors: 0,
      crsLabel: "derivada (ProcessarGeo)",
    });
  }

  const lines: string[] = [];
  lines.push("Relatorio de processamento — Processar projeto (GeoForest / ProcessarGeo local)");
  lines.push(`Arquivo: ${filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas analisadas / geradas:");
  for (const layer of analyzedLayers) {
    lines.push(`- ${layer.name}: feicoes=${layer.featureCount}; erros=${layer.errors}; CRS=${layer.crsLabel}`);
  }
  lines.push("");
  lines.push(`Total de inconsistencias: ${allRows.length}`);
  lines.push(`Camadas no arquivo processado: ${processedLayers.length}`);
  const derivedNames = derivedLayers.map((d) => d.code).join(", ") || "(nenhuma — falta hidrografia)";
  lines.push(`Camadas derivadas ProcessarGeo: ${derivedNames}`);
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
  lines.push("");
  lines.push("Artefatos gerados (fluxo SIMCAR completo):");
  lines.push("- arquivo_enviado.zip — shapes enviados");
  lines.push("- arquivo_processado.zip — projeto processado (limpos + APP/APPD/APPP/APPRL/AURD/ARLDR)");
  lines.push("- arquivo_conferencia.zip — areas por feicao");
  lines.push("- erros_processamento.zip — sobreposicao/vazios/anexo 01");
  lines.push("- erros_processamento_app.zip — pontos de erro de calculo de APP");
  lines.push("- quadro_areas.csv — quadro de areas (inclui APP*)");
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
  lines.push("Motor local alinhado ao fluxo Importar→ProcessarGeo do SIMCAR/SEMA-MT.");
  lines.push("Faixas de APP: Codigo Florestal (Art. 4). Detalhes de dominio SEMA podem divergir.");
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
    processedLayers,
    originalLayers,
    quadroAreas,
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

const processadoFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

const conferenciaFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
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

function buildQuadroCsv(rows: QuadroAreaRow[]): Buffer {
  const headers = ["camada", "codigo", "feicoes", "erros", "corrigidas", "area_m2", "area_ha"];
  const lines = rows.map((row) =>
    headers.map((h) => csvEscape((row as any)[h])).join(";"),
  );
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

function appendPointSet(
  archive: { append: (data: Buffer, opts: { name: string }) => void },
  folder: string,
  baseName: string,
  records: PointShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): void {
  const base = folder ? `${folder}/${baseName}` : baseName;
  const points = buildPointShpAndShx(records, 1);
  archive.append(points.shp, { name: `${base}.shp` });
  archive.append(points.shx, { name: `${base}.shx` });
  archive.append(buildDbfBuffer(records.map((p) => p.attributes), fields), { name: `${base}.dbf` });
  archive.append(Buffer.from(prj, "utf8"), { name: `${base}.prj` });
}

/** Monta um ZIP interno (ex.: arquivo_processado.zip) a partir de entradas buffer. */
function buildNestedZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.data, { name: f.name });
    archive.finalize().catch(reject);
  });
}

function layerShpFiles(
  name: string,
  records: ShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): Array<{ name: string; data: Buffer }> {
  const safe = safeSegment(name) || "camada";
  const built = buildShpAndShx(records, 5);
  return [
    { name: `${safe}.shp`, data: built.shp },
    { name: `${safe}.shx`, data: built.shx },
    { name: `${safe}.dbf`, data: buildDbfBuffer(records.map((r) => r.attributes), fields) },
    { name: `${safe}.prj`, data: Buffer.from(prj, "utf8") },
  ];
}

/**
 * ZIP completo no espírito SIMCAR:
 * - arquivo_enviado (+ .zip)
 * - arquivo_processado (+ .zip)
 * - arquivo_conferencia (+ .zip)
 * - erros / erros_processamento.zip
 * - relatórios e quadro de áreas
 */
export async function buildProcessarProjetoZip(args: {
  importRelatorio: string;
  process: ProcessPhaseResult;
  importRows?: GeometryErrorRow[];
}): Promise<Buffer> {
  const allRows = [...(args.importRows || []), ...args.process.rows];
  const prj = args.process.prjText || SIRGAS_2000_PRJ;
  const proc = args.process;

  const pointRecords: PointShpRecord[] = proc.rows
    .filter((row) => !LAYER_LEVEL_TIPOS.has(row.tipo))
    .map((row) => ({
      coordinates: [row.x, row.y] as [number, number],
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

  // Nested: arquivo_processado.zip
  const processadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    processadoFiles.push(...layerShpFiles(layer.name, layer.records, processadoFields, prj));
  }
  const processadoZip = await buildNestedZip(processadoFiles);

  // Nested: arquivo_conferencia.zip (mesmas geometrias + áreas)
  const conferenciaFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    const withArea: ShpRecord[] = layer.records.map((rec) => {
      const areaM2 = ringsAreaAbs(rec.rings || []);
      return {
        ...rec,
        attributes: {
          ...rec.attributes,
          area_m2: Number(areaM2.toFixed(2)),
          area_ha: Number((areaM2 / 10000).toFixed(6)),
        },
      };
    });
    conferenciaFiles.push(...layerShpFiles(layer.name, withArea, conferenciaFields, prj));
  }
  const conferenciaZip = await buildNestedZip(conferenciaFiles);

  // Nested: arquivo_enviado.zip (originais)
  const enviadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.originalLayers) {
    const safe = safeSegment(layer.name) || "camada";
    // Reconstrói shx a partir do shp parseado
    const records = parsePolygonRecords(layer.shp);
    const shpRecords: ShpRecord[] = records.map((r) => ({
      type: "polygon" as const,
      rings: r.rings,
      attributes: { feicao: r.feature },
    }));
    if (shpRecords.length) {
      const built = buildShpAndShx(shpRecords, 5);
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
      enviadoFiles.push({ name: `${safe}.shx`, data: built.shx });
    } else {
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
    }
    if (layer.dbf) enviadoFiles.push({ name: `${safe}.dbf`, data: layer.dbf });
    else {
      enviadoFiles.push({
        name: `${safe}.dbf`,
        data: buildDbfBuffer(
          records.map((r) => ({ feicao: r.feature })),
          [{ name: "feicao", type: "N", length: 8, decimals: 0 }],
        ),
      });
    }
    enviadoFiles.push({ name: `${safe}.prj`, data: Buffer.from(layer.prjText || prj, "utf8") });
  }
  const enviadoZip = await buildNestedZip(enviadoFiles);

  // Nested: erros_processamento.zip
  const errosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const points = buildPointShpAndShx(pointRecords, 1);
    errosFiles.push({ name: "pontos_erros.shp", data: points.shp });
    errosFiles.push({ name: "pontos_erros.shx", data: points.shx });
    errosFiles.push({
      name: "pontos_erros.dbf",
      data: buildDbfBuffer(pointRecords.map((p) => p.attributes), errorPointFields),
    });
    errosFiles.push({ name: "pontos_erros.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.overlapPolygons.length) {
    const records: ShpRecord[] = proc.overlapPolygons.flatMap((o) =>
      geojsonToShpRecords(o.geometry, {
        camada: o.camada,
        feicao_a: o.feicaoA,
        feicao_b: o.feicaoB,
        area_m2: o.areaM2,
        area_ha: o.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    errosFiles.push({ name: "poligonos_sobreposicao.shp", data: built.shp });
    errosFiles.push({ name: "poligonos_sobreposicao.shx", data: built.shx });
    errosFiles.push({
      name: "poligonos_sobreposicao.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), overlapFields),
    });
    errosFiles.push({ name: "poligonos_sobreposicao.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.gapPolygons.length) {
    const records: ShpRecord[] = proc.gapPolygons.flatMap((g) =>
      geojsonToShpRecords(g.geometry, {
        camada: g.camada,
        feicoes: g.feicoes.join(",").slice(0, 40),
        area_m2: g.areaM2,
        area_ha: g.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    errosFiles.push({ name: "poligonos_vazios.shp", data: built.shp });
    errosFiles.push({ name: "poligonos_vazios.shx", data: built.shx });
    errosFiles.push({
      name: "poligonos_vazios.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), gapFields),
    });
    errosFiles.push({ name: "poligonos_vazios.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.ruleViolations.length) {
    const records: ShpRecord[] = proc.ruleViolations.flatMap((v) =>
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
    errosFiles.push({ name: "poligonos_regras_simcar.shp", data: built.shp });
    errosFiles.push({ name: "poligonos_regras_simcar.shx", data: built.shx });
    errosFiles.push({
      name: "poligonos_regras_simcar.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), ruleViolationFields),
    });
    errosFiles.push({ name: "poligonos_regras_simcar.prj", data: Buffer.from(prj, "utf8") });
  }
  const errosZip = await buildNestedZip(errosFiles);

  // erros_processamento_app.zip — pontos de erro de cálculo de APP (artefato SIMCAR)
  const appErrorPoints = pointRecords.filter((p) => String(p.attributes.tipo) === "erro_calculo_app");
  const appErrosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const pts = buildPointShpAndShx(appErrorPoints, 1);
    appErrosFiles.push({ name: "pontos_erro_app.shp", data: pts.shp });
    appErrosFiles.push({ name: "pontos_erro_app.shx", data: pts.shx });
    appErrosFiles.push({
      name: "pontos_erro_app.dbf",
      data: buildDbfBuffer(appErrorPoints.map((p) => p.attributes), errorPointFields),
    });
    appErrosFiles.push({ name: "pontos_erro_app.prj", data: Buffer.from(prj, "utf8") });
  }
  const appErrosZip = await buildNestedZip(appErrosFiles);

  const inventario = [
    "Inventario de saidas — Processar projeto (fluxo completo SIMCAR / ProcessarGeo local)",
    "",
    "arquivo_enviado.zip            — shapefiles originais enviados",
    "arquivo_processado.zip         — projeto processado: limpos + APP/APPD/APPP/APPRL/AURD/ARLDR",
    "arquivo_conferencia.zip        — camadas com area_m2/area_ha",
    "erros_processamento.zip        — sobreposicao, vazios, anexo 01, topologia",
    "erros_processamento_app.zip    — pontos de erro de calculo de APP",
    "relatorio_importacao.txt       — fase Importar",
    "relatorio_processamento.txt    — fase Processar",
    "resumo_erros.csv               — tabela unificada de erros",
    "quadro_areas.csv               — areas por camada (inclui APP*)",
    "",
    "Pastas espelhadas (mesmos arquivos, para abrir direto no SIG):",
    "  arquivo_enviado/",
    "  arquivo_processado/   ← aqui entram APP.shp, APPD.shp, APPP.shp, …",
    "  arquivo_conferencia/",
    "  erros/",
    "  erros_app/",
    "",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.append(Buffer.from(args.importRelatorio, "utf8"), { name: "relatorio_importacao.txt" });
    archive.append(Buffer.from(proc.relatorioTexto, "utf8"), { name: "relatorio_processamento.txt" });
    archive.append(buildCsv(allRows), { name: "resumo_erros.csv" });
    archive.append(buildQuadroCsv(proc.quadroAreas), { name: "quadro_areas.csv" });
    archive.append(Buffer.from(inventario, "utf8"), { name: "inventario_saidas.txt" });

    archive.append(enviadoZip, { name: "arquivo_enviado.zip" });
    archive.append(processadoZip, { name: "arquivo_processado.zip" });
    archive.append(conferenciaZip, { name: "arquivo_conferencia.zip" });
    archive.append(errosZip, { name: "erros_processamento.zip" });
    archive.append(appErrosZip, { name: "erros_processamento_app.zip" });

    // Pastas planas (mesmos conteúdos)
    for (const f of enviadoFiles) archive.append(f.data, { name: `arquivo_enviado/${f.name}` });
    for (const f of processadoFiles) archive.append(f.data, { name: `arquivo_processado/${f.name}` });
    for (const f of conferenciaFiles) archive.append(f.data, { name: `arquivo_conferencia/${f.name}` });
    for (const f of errosFiles) archive.append(f.data, { name: `erros/${f.name}` });
    for (const f of appErrosFiles) archive.append(f.data, { name: `erros_app/${f.name}` });

    // Também na raiz para quem espera só pontos_erros.shp
    appendPointSet(archive, "", "pontos_erros", pointRecords, errorPointFields, prj);

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
