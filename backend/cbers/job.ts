/**
 * Jobs CBERS (cena única e lote) com progresso e cancelamento.
 */
import fs from "node:fs";
import path from "node:path";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { CBERS_BATCH_CONCURRENCY, CBERS_TMP_ROOT } from "./constants";
import { processCbersScene } from "./pipeline";
import { closeJobSubscribers, emitJobEvent, progress, throwIfCancelled } from "./sse";
import { CbersAreaContext, CbersCancelError, CbersJobStatus, CbersProgressPatch, CbersSceneJobState } from "./types";
import { clampPercent } from "./utils";
import { createCbersBatchZip } from "./zip";

export async function runCbersJob(input: {
  uid: string;
  jobId: string;
  filename: string;
  area: CbersAreaContext;
  itemId: string;
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(CBERS_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, {
      stage: "geometry",
      percent: 2,
      message: input.area.geometry ? "Lendo limite da área enviada." : "Processando por órbita/ponto sem SHP.",
    });

    const result = await processCbersScene({
      uid,
      jobId,
      itemId: input.itemId,
      tmpDir,
      propertyGeometry: input.area.geometry,
      propertyGeometryHash: input.area.geometryHash,
      areaHa: input.area.areaHa,
    });
    const scene = result.scene || null;

    if (result.archive) {
      progress(uid, jobId, { stage: "save", percent: 96, message: "Salvando GeoTIFF no raster compartilhado." });
    }
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: result.alignmentStatus === "failed_private"
        ? "GeoTIFF CBERS-4A/WPM concluído, mas sem validação de georreferenciamento; download privado liberado sem WMS."
        : "GeoTIFF CBERS-4A/WPM concluído.",
      outputUrl: result.outputUrl,
      outputRelativePath: result.outputRelativePath,
      outputFilename: result.outputFilename,
      outputBytes: result.outputBytes,
      archive: result.archive,
      archiveImageId: result.archiveImageId,
      wmsLayerName: result.wmsLayerName,
      wmsUrl: result.wmsUrl,
      wmsDownloadUrl: result.wmsDownloadUrl,
      alignmentStatus: result.alignmentStatus,
      alignmentWarning: result.alignmentWarning,
      alignment: result.alignment,
      completedAt: new Date().toISOString(),
      scene,
      scenes: [result],
    });
    finishJob({ jobId, status: "completed" });
    emitJobEvent(jobId, { type: "done", jobId, outputUrl: result.outputUrl });
  } catch (error: any) {
    if (error instanceof CbersCancelError || isCancelRequested(jobId)) {
      progress(uid, jobId, {
        status: "cancelled",
        stage: "cancelled",
        percent: 0,
        message: "Processamento CBERS cancelado.",
        error: "cancel_requested",
        scenes: [{
          itemId: input.itemId,
          status: "cancelled",
          stage: "cancelled",
          percent: 0,
          message: "Cancelado.",
        }],
      });
      finishJob({ jobId, status: "cancelled", error: "cancel_requested" });
      emitJobEvent(jobId, { type: "cancelled", jobId });
      return;
    }
    const message = String(error?.message || "Falha ao processar CBERS-4A/WPM.");
    progress(uid, jobId, {
      status: "failed",
      stage: "failed",
      message,
      error: message,
      scenes: [{
        itemId: input.itemId,
        status: "failed",
        stage: "failed",
        percent: 100,
        message: "Falha ao processar esta cena.",
        error: message,
      }],
    });
    finishJob({ jobId, status: "failed", error: message });
    emitJobEvent(jobId, { type: "error", jobId, message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    closeJobSubscribers(jobId);
  }
}

export async function runCbersBatchJob(input: {
  uid: string;
  jobId: string;
  filename: string;
  area: CbersAreaContext;
  itemIds: string[];
  reusedScenes?: CbersSceneJobState[];
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(CBERS_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });
  const sceneStates = new Map<string, CbersSceneJobState>();
  for (const reused of input.reusedScenes || []) {
    sceneStates.set(reused.itemId, reused);
  }
  for (const itemId of input.itemIds) {
    sceneStates.set(itemId, {
      itemId,
      status: "processing",
      stage: "queued",
      percent: 1,
      message: "Aguardando processamento.",
    });
  }
  const persistBatch = (patch?: Partial<CbersProgressPatch>) => {
    const scenes = [...sceneStates.values()];
    const average = scenes.length
      ? scenes.reduce((acc, scene) => acc + Number(scene.percent || 0), 0) / scenes.length
      : 0;
    progress(uid, jobId, {
      mode: "batch",
      stage: patch?.stage || "batch",
      percent: patch?.percent ?? average,
      message: patch?.message || "Processando cenas CBERS selecionadas.",
      scenes,
      ...patch,
    });
  };

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, {
      mode: "batch",
      stage: "geometry",
      percent: 2,
      message: input.area.geometry ? "Lendo limite da área enviada." : "Processando por órbita/ponto sem SHP.",
    });
    persistBatch({
      stage: "queued",
      message: input.reusedScenes?.length
        ? `${input.reusedScenes.length} cena(s) reaproveitada(s) do WMS; ${input.itemIds.length} cena(s) nova(s) na fila.`
        : `${input.itemIds.length} cena(s) na fila.`,
    });

    let cursor = 0;
    const worker = async () => {
      while (cursor < input.itemIds.length) {
        const itemId = input.itemIds[cursor++];
        try {
          const result = await processCbersScene({
            uid,
            jobId,
            itemId,
            tmpDir,
            propertyGeometry: input.area.geometry,
            propertyGeometryHash: input.area.geometryHash,
            areaHa: input.area.areaHa,
            onSceneProgress: (patch) => {
              sceneStates.set(itemId, {
                ...(sceneStates.get(itemId) || { itemId, status: "processing", percent: 0 }),
                ...patch,
                itemId,
                status: patch.status || "processing",
                percent: clampPercent(Number(patch.percent ?? sceneStates.get(itemId)?.percent ?? 0)),
              });
              persistBatch();
            },
          });
          sceneStates.set(itemId, result);
          persistBatch({ message: `Cena ${itemId} concluída.` });
        } catch (error: any) {
          if (error instanceof CbersCancelError || isCancelRequested(jobId)) throw error;
          sceneStates.set(itemId, {
            ...(sceneStates.get(itemId) || { itemId }),
            itemId,
            status: "failed",
            stage: "failed",
            percent: 100,
            message: "Falha ao processar esta cena.",
            error: String(error?.message || "Falha ao processar cena."),
          });
          persistBatch({ message: `Cena ${itemId} falhou; demais cenas continuam.` });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CBERS_BATCH_CONCURRENCY, input.itemIds.length) }, () => worker()));

    const scenes = [...sceneStates.values()];
    const completed = scenes.filter((scene) => scene.status === "completed");
    const failed = scenes.filter((scene) => scene.status === "failed");
    const finalStatus: CbersJobStatus = completed.length > 0 ? "completed" : "failed";
    let batchZip: Awaited<ReturnType<typeof createCbersBatchZip>> = null;
    if (input.itemIds.length > 1 && completed.length > 0) {
      persistBatch({
        stage: "zip",
        percent: 99,
        message: `Compactando ${completed.length} GeoTIFF(s) do lote.`,
      });
      batchZip = await createCbersBatchZip({
        uid,
        jobId,
        tmpDir,
        scenes: completed,
      });
    }
    progress(uid, jobId, {
      status: finalStatus,
      mode: "batch",
      stage: finalStatus === "completed" ? "completed" : "failed",
      percent: 100,
      message:
        failed.length > 0
          ? `${completed.length} cena(s) concluída(s), ${failed.length} falharam.`
          : `${completed.length} cena(s) concluída(s).`,
      scenes,
      batchZipUrl: batchZip?.url,
      batchZipRelativePath: batchZip?.relativePath,
      batchZipFilename: batchZip?.filename,
      batchZipBytes: batchZip?.bytes,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: finalStatus, error: finalStatus === "failed" ? "all_scenes_failed" : undefined });
    emitJobEvent(jobId, { type: "done", jobId });
  } catch (error: any) {
    if (error instanceof CbersCancelError || isCancelRequested(jobId)) {
      for (const [itemId, current] of sceneStates.entries()) {
        if (current.status === "processing") {
          sceneStates.set(itemId, {
            ...current,
            status: "cancelled",
            stage: "cancelled",
            message: "Cancelado.",
          });
        }
      }
      progress(uid, jobId, {
        status: "cancelled",
        mode: "batch",
        stage: "cancelled",
        percent: 0,
        message: "Processamento CBERS cancelado.",
        error: "cancel_requested",
        scenes: [...sceneStates.values()],
      });
      finishJob({ jobId, status: "cancelled", error: "cancel_requested" });
      emitJobEvent(jobId, { type: "cancelled", jobId });
      return;
    }
    const message = String(error?.message || "Falha ao processar lote CBERS-4A/WPM.");
    progress(uid, jobId, {
      status: "failed",
      mode: "batch",
      stage: "failed",
      message,
      error: message,
      scenes: [...sceneStates.values()],
    });
    finishJob({ jobId, status: "failed", error: message });
    emitJobEvent(jobId, { type: "error", jobId, message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
    closeJobSubscribers(jobId);
  }
}
