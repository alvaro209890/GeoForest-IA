/**
 * Execução da análise de fiscalização: coleta nas 3 fontes, cruza com a ATP e
 * empacota mapas PDF + planilha + shapefiles num ZIP.
 */
import archiver from "archiver";
import { getAbsoluteStoragePath, saveUserBuffer } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { parseUserShapefile } from "../simcar";
import { expandBbox, featureAreaHa } from "../overlap/utils";
import { analyzeRecords } from "./analysis";
import { DEFAULT_BUFFER_METERS, SOURCE_LABELS } from "./constants";
import { buildFiscalizacaoXlsx } from "./excel-builder";
import { buildFiscalizacaoMapPdf } from "./render-map";
import { buildFiscalizacaoShapefiles } from "./shapefiles";
import { fetchIbamaFeatures, fetchImapSource } from "./sources";
import { closeSubscribers, progress } from "./sse";
import {
  FISCALIZACAO_SOURCES,
  type AtpFeature,
  type FiscalizacaoSource,
  type FiscalizacaoSourceResult,
} from "./types";
import fs from "node:fs";

type OutFile = { name: string; buffer: Buffer };

function ensureNotCancelled(jobId: string): void {
  if (isCancelRequested(jobId)) throw new Error("Análise cancelada pelo usuário.");
}

/** Coleta de uma fonte. Falha de fonte vira aviso, não derruba o job. */
async function collectSource(
  source: FiscalizacaoSource,
  bbox: [number, number, number, number],
): Promise<FiscalizacaoSourceResult> {
  const base: FiscalizacaoSourceResult = {
    source,
    label: SOURCE_LABELS[source],
    records: [],
    incidentes: 0,
  };
  try {
    if (source === "ibama") {
      base.records = await fetchIbamaFeatures(bbox);
      return base;
    }
    const { records, errors } = await fetchImapSource(source, bbox);
    base.records = records;
    if (errors.length && !records.length) base.error = errors.join(" | ");
    return base;
  } catch (error: any) {
    base.error = String(error?.message || error);
    return base;
  }
}

export async function runFiscalizacaoJob(args: {
  uid: string;
  jobId: string;
  upload: Record<string, any>;
  bufferMeters?: number;
}): Promise<void> {
  const { uid, jobId, upload } = args;
  const bufferMeters = Number.isFinite(args.bufferMeters)
    ? Number(args.bufferMeters)
    : DEFAULT_BUFFER_METERS;

  try {
    progress(uid, jobId, {
      status: "processing",
      stage: "lendo-atp",
      percent: 5,
      message: "Lendo a ATP do shapefile...",
    });

    const zipPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(zipPath);
    const parsed = parseUserShapefile(zipBuffer);
    const atp: AtpFeature = parsed.polygon;
    const atpAreaHa = featureAreaHa(atp.geometry);
    const atpNome = String(upload.filename || "ATP").replace(/\.zip$/i, "");

    ensureNotCancelled(jobId);

    const bbox = expandBbox(atp.geometry, bufferMeters);
    progress(uid, jobId, {
      stage: "consultando",
      percent: 18,
      message: "Consultando IBAMA, SEMA e SIGA...",
    });

    const results: FiscalizacaoSourceResult[] = [];
    for (const [index, source] of FISCALIZACAO_SOURCES.entries()) {
      ensureNotCancelled(jobId);
      const result = await collectSource(source, bbox);
      result.records = analyzeRecords(result.records, atp);
      result.incidentes = result.records.filter((r) => r.incidente).length;
      results.push(result);
      progress(uid, jobId, {
        stage: "consultando",
        percent: 18 + (index + 1) * 12,
        message: result.error
          ? `${SOURCE_LABELS[source]}: falha na consulta.`
          : `${SOURCE_LABELS[source]}: ${result.records.length} feição(ões), ${result.incidentes} incidente(s).`,
      });
    }

    ensureNotCancelled(jobId);

    const files: OutFile[] = [];
    const warnings: string[] = [];
    for (const result of results) {
      if (result.error) warnings.push(`${result.label}: ${result.error}`);
    }

    /* ── mapas ─────────────────────────────────────────── */
    for (const [index, result] of results.entries()) {
      ensureNotCancelled(jobId);
      progress(uid, jobId, {
        stage: "mapas",
        percent: 56 + index * 9,
        message: `Gerando mapa ${result.source.toUpperCase()}...`,
      });
      try {
        const map = await buildFiscalizacaoMapPdf({
          source: result.source,
          atp,
          atpNome,
          records: result.records,
        });
        files.push({ name: `Mapa_fiscalizacao_${result.source.toUpperCase()}.pdf`, buffer: map.buffer });
        if (!map.hasBasemapImage) {
          warnings.push(
            `Mapa ${result.source.toUpperCase()}: imagem de satélite indisponível; o mapa saiu com fundo neutro.`,
          );
        }
      } catch (error: any) {
        warnings.push(`Mapa ${result.source.toUpperCase()}: ${error?.message || error}`);
      }
    }

    /* ── planilha ──────────────────────────────────────── */
    ensureNotCancelled(jobId);
    progress(uid, jobId, { stage: "planilha", percent: 84, message: "Montando a planilha..." });
    try {
      const xlsx = await buildFiscalizacaoXlsx({ atpNome, atpAreaHa, results });
      files.push({ name: "Fiscalizacao_ocorrencias.xlsx", buffer: xlsx });
    } catch (error: any) {
      warnings.push(`Planilha: ${error?.message || error}`);
    }

    /* ── shapefiles ────────────────────────────────────── */
    progress(uid, jobId, { stage: "shapefiles", percent: 90, message: "Escrevendo shapefiles..." });
    for (const result of results) {
      if (!result.records.length) continue;
      try {
        for (const set of buildFiscalizacaoShapefiles(result.source, result.records)) {
          for (const file of set.files) {
            files.push({ name: `shapefiles/${file.name}`, buffer: file.buffer });
          }
        }
      } catch (error: any) {
        warnings.push(`Shapefile ${result.source.toUpperCase()}: ${error?.message || error}`);
      }
    }

    if (!files.length) throw new Error("Nenhum arquivo pôde ser gerado.");

    /* ── ZIP ───────────────────────────────────────────── */
    progress(uid, jobId, { stage: "empacotando", percent: 95, message: "Empacotando ZIP..." });
    const zipOut = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on("data", (c: Buffer) => chunks.push(c));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
      for (const f of files) archive.append(f.buffer, { name: f.name });
      if (warnings.length) {
        archive.append(Buffer.from(warnings.join("\n"), "utf8"), { name: "avisos.txt" });
      }
      void archive.finalize();
    });

    const stored = saveUserBuffer({
      uid,
      area: "fiscalizacao/output",
      filename: `${jobId}_fiscalizacao.zip`,
      buffer: zipOut,
    });

    const totalIncidentes = results.reduce((acc, r) => acc + r.incidentes, 0);
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: totalIncidentes
        ? `${totalIncidentes} ocorrência(s) incidente(s) na ATP.`
        : "Nenhuma ocorrência incidente na ATP.",
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/fiscalizacao/download/${jobId}`,
      files: files.map((f) => f.name),
      atpNome,
      atpAreaHa,
      totalIncidentes,
      resumo: results.map((r) => ({
        source: r.source,
        label: r.label,
        total: r.records.length,
        incidentes: r.incidentes,
        error: r.error || "",
      })),
      warnings,
      createdAt: upload.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const message = String(error?.message || error || "Falha na análise de fiscalização.");
    const cancelled = /cancel/i.test(message);
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: "error",
      percent: 100,
      message,
      error: message,
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: message });
  } finally {
    closeSubscribers(jobId);
  }
}
