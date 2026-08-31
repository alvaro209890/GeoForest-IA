/**
 * Saída: shapefiles de pontos/midpoints, CSV, relatório e ZIP.
 */
import archiver from "archiver";
import type { DbfFieldDef, PointShpRecord } from "../shapefile-writer";
import { buildDbfBuffer, buildPointShpAndShx } from "../shapefile-writer";
import { SIRGAS_2000_PRJ } from "./constants";
import { VertexPair } from "./types";
import { csvEscape } from "../lib/job-utils";

export { csvEscape } from "../lib/job-utils";

export const midpointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "ranking", type: "N", length: 8, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "vertice_a", type: "N", length: 10, decimals: 0 },
  { name: "vertice_b", type: "N", length: 10, decimals: 0 },
  { name: "dist_m", type: "F", length: 16, decimals: 6 },
  { name: "dist_cm", type: "F", length: 16, decimals: 3 },
  { name: "dist_mm", type: "F", length: 16, decimals: 3 },
  { name: "x_a", type: "F", length: 18, decimals: 8 },
  { name: "y_a", type: "F", length: 18, decimals: 8 },
  { name: "x_b", type: "F", length: 18, decimals: 8 },
  { name: "y_b", type: "F", length: 18, decimals: 8 },
  { name: "x_medio", type: "F", length: 18, decimals: 8 },
  { name: "y_medio", type: "F", length: 18, decimals: 8 },
];

export const vertexFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "ranking", type: "N", length: 8, decimals: 0 },
  { name: "ponto_tipo", type: "C", length: 1, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "vertice", type: "N", length: 10, decimals: 0 },
  { name: "dist_m", type: "F", length: 16, decimals: 6 },
  { name: "dist_mm", type: "F", length: 16, decimals: 3 },
];

export function pairToMidpointRecord(pair: VertexPair): PointShpRecord {
  return {
    coordinates: pair.midOriginal,
    attributes: {
      camada: pair.layerName,
      ranking: pair.ranking,
      feicao: pair.feature,
      parte: pair.part,
      anel: pair.ring,
      vertice_a: pair.vertexA,
      vertice_b: pair.vertexB,
      dist_m: pair.distM,
      dist_cm: pair.distM * 100,
      dist_mm: pair.distM * 1000,
      x_a: pair.aOriginal[0],
      y_a: pair.aOriginal[1],
      x_b: pair.bOriginal[0],
      y_b: pair.bOriginal[1],
      x_medio: pair.midOriginal[0],
      y_medio: pair.midOriginal[1],
    },
  };
}

export function pairToVertexRecords(pair: VertexPair): PointShpRecord[] {
  return [
    {
      coordinates: pair.aOriginal,
      attributes: {
        camada: pair.layerName,
        ranking: pair.ranking,
        ponto_tipo: "A",
        feicao: pair.feature,
        parte: pair.part,
        anel: pair.ring,
        vertice: pair.vertexA,
        dist_m: pair.distM,
        dist_mm: pair.distM * 1000,
      },
    },
    {
      coordinates: pair.bOriginal,
      attributes: {
        camada: pair.layerName,
        ranking: pair.ranking,
        ponto_tipo: "B",
        feicao: pair.feature,
        parte: pair.part,
        anel: pair.ring,
        vertice: pair.vertexB,
        dist_m: pair.distM,
        dist_mm: pair.distM * 1000,
      },
    },
  ];
}

export function buildCsv(pairs: VertexPair[]): Buffer {
  const headers = midpointFields.map((field) => field.name);
  const rows = pairs.map((pair) => {
    const attrs = pairToMidpointRecord(pair).attributes;
    return headers.map((header) => csvEscape(attrs[header])).join(";");
  });
  return Buffer.from([headers.join(";"), ...rows].join("\n"), "utf8");
}

export function buildReport(args: {
  filename: string;
  pairs: VertexPair[];
  analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }>;
  warnings: string[];
}): Buffer {
  const lines: string[] = [];
  lines.push("Relatorio de vertices proximas");
  lines.push(`Arquivo analisado: ${args.filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Camadas analisadas:");
  for (const layer of args.analyzedLayers) {
    lines.push(`- ${layer.name}: solicitados=${layer.requested}; encontrados=${layer.found}; CRS original=${layer.crsLabel}; CRS metrico=${layer.metricCrsLabel}`);
  }
  lines.push("");
  lines.push("Pontos encontrados:");
  for (const pair of args.pairs) {
    lines.push(
      `${pair.layerName}; ranking=${pair.ranking}; feicao=${pair.feature}; parte=${pair.part}; anel=${pair.ring}; ` +
      `A=${pair.vertexA} (${pair.aOriginal[0]}, ${pair.aOriginal[1]}); ` +
      `B=${pair.vertexB} (${pair.bOriginal[0]}, ${pair.bOriginal[1]}); ` +
      `dist_m=${pair.distM.toFixed(6)}; medio=(${pair.midOriginal[0]}, ${pair.midOriginal[1]})`,
    );
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
  pairs: VertexPair[];
  includeOriginalVertices: boolean;
  includeCsvSummary: boolean;
  includeTxtReport: boolean;
  prjText?: string;
  filename: string;
  analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }>;
  warnings: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const prjText = args.prjText || SIRGAS_2000_PRJ;

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const midpointRecords = args.pairs.map(pairToMidpointRecord);
    const mid = buildPointShpAndShx(midpointRecords, 1);
    archive.append(mid.shp, { name: "pontos_vertices_proximas.shp" });
    archive.append(mid.shx, { name: "pontos_vertices_proximas.shx" });
    archive.append(buildDbfBuffer(midpointRecords.map((item) => item.attributes), midpointFields), { name: "pontos_vertices_proximas.dbf" });
    archive.append(Buffer.from(prjText, "utf8"), { name: "pontos_vertices_proximas.prj" });

    if (args.includeOriginalVertices) {
      const vertexRecords = args.pairs.flatMap(pairToVertexRecords);
      const vertices = buildPointShpAndShx(vertexRecords, 1);
      archive.append(vertices.shp, { name: "vertices_pares.shp" });
      archive.append(vertices.shx, { name: "vertices_pares.shx" });
      archive.append(buildDbfBuffer(vertexRecords.map((item) => item.attributes), vertexFields), { name: "vertices_pares.dbf" });
      archive.append(Buffer.from(prjText, "utf8"), { name: "vertices_pares.prj" });
    }

    if (args.includeCsvSummary) archive.append(buildCsv(args.pairs), { name: "resumo_vertices.csv" });
    if (args.includeTxtReport) archive.append(buildReport(args), { name: "relatorio_vertices.txt" });
    archive.finalize().catch(reject);
  });
}
