/**
 * Job de análise de vértices próximos.
 */
import fs from "node:fs";
import { getAbsoluteStoragePath, saveUserBuffer } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { SIRGAS_2000_PRJ, WGS84_PRJ } from "./constants";
import { analyzeLayer } from "./detector";
import { buildResultZip, pairToMidpointRecord } from "./report";
import { getZipLayerGroups } from "./shapefile-io";
import { closeSubscribers, progress } from "./sse";
import { LayerSelection, ProcessSettings, VertexPair } from "./types";

export async function runVerticesJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  selections: LayerSelection[];
  settings: ProcessSettings;
}): Promise<void> {
  const { uid, jobId, upload, selections, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const groups = getZipLayerGroups(zipBuffer);
    const selectionById = new Map(selections.map((item) => [String(item.id), item]));
    const selectedGroups = groups.filter((group) => selectionById.get(group.id)?.analyze !== false && selectionById.has(group.id));
    if (!selectedGroups.length) throw new Error("Selecione ao menos uma camada poligonal para analisar.");

    const allPairs: VertexPair[] = [];
    const allWarnings: string[] = [];
    const analyzedLayers: Array<{ name: string; requested: number; found: number; crsLabel: string; metricCrsLabel: string }> = [];
    let outputPrjText = SIRGAS_2000_PRJ;
    let outputCrsLabel = "";

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 5,
      message: "Iniciando análise de vértices.",
    });

    for (let index = 0; index < selectedGroups.length; index += 1) {
      if (isCancelRequested(jobId)) throw new Error("cancel_requested");
      const group = selectedGroups[index];
      const selection = selectionById.get(group.id)!;
      const percent = 5 + Math.round((index / selectedGroups.length) * 80);
      progress(uid, jobId, {
        status: "processing",
        stage: "layer",
        layer: group.name,
        percent,
        message: `Processando ${group.name}.`,
      });

      try {
        if (!group.shp) throw new Error("Camada sem .shp.");
        const result = analyzeLayer({
          layerId: group.id,
          layerName: group.name,
          shpBuffer: group.shp.data,
          prjText: group.prj?.data.toString("utf8"),
          selection,
          settings,
        });
        if (!outputCrsLabel) {
          outputCrsLabel = result.crs.label;
          outputPrjText = result.crs.prjText || (result.crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
        } else if (outputCrsLabel !== result.crs.label) {
          allWarnings.push(`${group.name}: CRS diferente da primeira camada (${result.crs.label}); saída única usa ${outputCrsLabel}.`);
        }
        allPairs.push(...result.pairs);
        allWarnings.push(...result.warnings);
        analyzedLayers.push({
          name: group.name,
          requested: Math.max(0, Math.floor(Number(selection.pointCount || 0))),
          found: result.pairs.length,
          crsLabel: result.crs.label,
          metricCrsLabel: result.metricCrsLabel,
        });
      } catch (error: any) {
        allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
        analyzedLayers.push({
          name: group.name,
          requested: Math.max(0, Math.floor(Number(selection.pointCount || 0))),
          found: 0,
          crsLabel: "erro",
          metricCrsLabel: "erro",
        });
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 90,
      message: "Gerando ZIP final.",
    });
    const zip = await buildResultZip({
      pairs: allPairs,
      includeOriginalVertices: settings.includeOriginalVertices !== false,
      includeCsvSummary: settings.includeCsvSummary !== false,
      includeTxtReport: settings.includeTxtReport !== false,
      prjText: outputPrjText,
      filename: String(upload.filename || "vertices.zip"),
      analyzedLayers,
      warnings: allWarnings,
    });
    const stored = saveUserBuffer({
      uid,
      area: "vertices/output",
      filename: `vertices_proximas_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });
    const resultRows = allPairs.map((pair) => pairToMidpointRecord(pair).attributes);
    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Análise concluída.",
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/vertices/download/${jobId}`,
      outputBytes: zip.length,
      resultRows,
      warnings: allWarnings,
      analyzedLayers,
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
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao processar vértices.",
      error: error?.message || "vertices_failed",
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: error?.message || "vertices_failed" });
  } finally {
    closeSubscribers(jobId);
  }
}
