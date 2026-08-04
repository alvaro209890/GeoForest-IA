/**
 * Saída da análise: shapefiles de erro, CSV, relatório TXT e ZIP de resultado.
 */
import archiver from "archiver";
import type { DbfFieldDef, PointShpRecord, ShpRecord } from "../shapefile-writer";
import { buildDbfBuffer, buildPointShpAndShx, buildShpAndShx, geojsonToShpRecords } from "../shapefile-writer";
import { LAYER_LEVEL_TIPOS } from "./constants";
import { GapPolygon, GeometryErrorRow, LayerFixResult, OverlapPolygon, RuleViolationPolygon } from "./types";
import { safeSegment } from "./utils";

export const errorPointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "tipo", type: "C", length: 24, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "x", type: "F", length: 18, decimals: 8 },
  { name: "y", type: "F", length: 18, decimals: 8 },
  { name: "detalhe", type: "C", length: 120, decimals: 0 },
];

export const fixedLayerFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

export const overlapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "feicao_b", type: "N", length: 8, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

export const gapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicoes", type: "C", length: 40, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

export const ruleViolationFields: DbfFieldDef[] = [
  { name: "camada_a", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "camada_b", type: "C", length: 40, decimals: 0 },
  { name: "regra", type: "C", length: 12, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

export function rowToPointRecord(row: GeometryErrorRow): PointShpRecord {
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

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: GeometryErrorRow[]): Buffer {
  const headers = ["camada", "tipo", "feicao", "parte", "anel", "x", "y", "detalhe"];
  const lines = rows.map((row) => headers.map((h) => csvEscape((row as any)[h])).join(";"));
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

export function buildReport(args: {
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
  if (args.rows.some((row) => row.tipo === "vazio")) {
    lines.push("");
    lines.push("Vazios/gaps: os poligonos exatos estao em poligonos_vazios.shp (sem correcao automatica; edite no SIG para fechar o vazio entre feicoes adjacentes).");
  }
  if (args.rows.some((row) => row.tipo === "air_atp_area")) {
    lines.push("");
    lines.push("Soma AIR vs ATP: a soma das areas das AIRs deve corresponder a area da ATP (Manual do Projeto Geografico / feicoes obrigatorias).");
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

export function buildResultZip(args: {
  rows: GeometryErrorRow[];
  fixes: LayerFixResult[];
  overlapPolygons: OverlapPolygon[];
  gapPolygons: GapPolygon[];
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

    if (args.gapPolygons.length > 0) {
      const gapRecords: ShpRecord[] = args.gapPolygons.flatMap((gap) =>
        geojsonToShpRecords(gap.geometry, {
          camada: gap.camada,
          feicoes: gap.feicoes.join(",").slice(0, 40),
          area_m2: gap.areaM2,
          area_ha: gap.areaM2 / 10000,
        }),
      );
      const built = buildShpAndShx(gapRecords, 5);
      archive.append(built.shp, { name: "poligonos_vazios.shp" });
      archive.append(built.shx, { name: "poligonos_vazios.shx" });
      archive.append(buildDbfBuffer(gapRecords.map((item) => item.attributes), gapFields), {
        name: "poligonos_vazios.dbf",
      });
      archive.append(Buffer.from(args.prjText, "utf8"), { name: "poligonos_vazios.prj" });
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
