/**
 * Orquestrador do job NDVI por cena completa (padrão da aba CBERS).
 *
 * Suporta cena única e lote (várias cenas com concorrência limitada), progresso via
 * SSE, cancelamento cooperativo e persistência em `users/<uid>/ndvi_scene_jobs/<jobId>`
 * (mesmo padrão do `persistCbersJob`).
 */
import fs from "node:fs";
import path from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import { writeDocBySegments, stripUndefinedDeep } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { NDVI_SCENE_BATCH_CONCURRENCY, NDVI_SCENE_TMP_ROOT } from "./constants";
import { processNdviScene } from "./pipeline";
import { throwIfCancelled } from "./compositions";
import { NdviSceneCancelError, type NdviSceneJobScene, type NdviSceneJobStatus, type NdviSceneProgressPatch } from "./types";
import { clampPercent } from "../cbers/utils";

export type NdviSceneJobInput = {
  uid: string;
  jobId: string;
  filename: string;
  area: { geometry?: Polygon | MultiPolygon | null; areaHa: number };
  itemIds: string[];
  compositions: string[];
};

/** Persistência + SSE do progresso do job (padrão CBERS). */
export function persistNdviSceneJob(
  uid: string,
  jobId: string,
  patch: NdviSceneProgressPatch & Record<string, unknown>,
): void {
  writeDocBySegments(
    ["users", uid, "ndvi_scene_jobs", jobId],
    stripUndefinedDeep({
      jobId,
      ...patch,
      updatedAtMs: Date.now(),
    }),
    { merge: true },
  );
}

function progress(
  uid: string,
  jobId: string,
  patch: NdviSceneProgressPatch,
  emit: (jobId: string, data: Record<string, unknown>) => void,
): void {
  const next = {
    status: patch.status || "processing",
    percent: typeof patch.percent === "number" ? clampPercent(patch.percent) : undefined,
    ...patch,
  };
  persistNdviSceneJob(uid, jobId, next);
  emit(jobId, { type: "progress", jobId, ...next });
}

/** Estado inicial de uma cena na fila do lote. */
function queuedScene(itemId: string): NdviSceneJobScene {
  return {
    itemId,
    status: "processing",
    stage: "queued",
    percent: 1,
    message: "Aguardando processamento.",
  };
}

export async function runNdviSceneJob(input: NdviSceneJobInput, emit: (jobId: string, data: Record<string, unknown>) => void): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(NDVI_SCENE_TMP_ROOT, jobId);
  fs.mkdirSync(tmpDir, { recursive: true });
  const sceneStates = new Map<string, NdviSceneJobScene>();

  for (const itemId of input.itemIds) {
    sceneStates.set(itemId, queuedScene(itemId));
  }

  const persistBatch = (patch?: Partial<NdviSceneProgressPatch>) => {
    const scenes = [...sceneStates.values()];
    const average = scenes.length
      ? scenes.reduce((acc, scene) => acc + Number(scene.percent || 0), 0) / scenes.length
      : 0;
    progress(
      uid,
      jobId,
      {
        mode: "batch",
        stage: patch?.stage || "batch",
        percent: patch?.percent ?? average,
        message: patch?.message || "Processando cenas selecionadas.",
        scenes,
        ...patch,
      },
      emit,
    );
  };

  try {
    throwIfCancelled(jobId);
    progress(uid, jobId, {
      mode: input.itemIds.length > 1 ? "batch" : "single",
      stage: "queued",
      percent: 1,
      message: input.itemIds.length > 1
        ? `${input.itemIds.length} cena(s) na fila.`
        : "Processamento enviado para o servidor.",
      scenes: [...sceneStates.values()],
    }, emit);

    let cursor = 0;
    const worker = async () => {
      while (cursor < input.itemIds.length) {
        const itemId = input.itemIds[cursor++];
        try {
          const result = await processNdviScene({
            uid,
            jobId,
            itemId,
            tmpDir,
            propertyGeometry: input.area.geometry ?? undefined,
            areaHa: input.area.areaHa,
            compositions: input.compositions as any,
            onSceneProgress: (patch) => {
              const current = sceneStates.get(itemId) || queuedScene(itemId);
              sceneStates.set(itemId, {
                ...current,
                ...patch,
                itemId,
                status: (patch.status as NdviSceneJobStatus | undefined) || "processing",
                error: patch.error ?? undefined,
                percent: clampPercent(Number(patch.percent ?? current.percent ?? 0)),
              });
              persistBatch();
            },
          });
          const state: NdviSceneJobScene = {
            itemId,
            status: "completed",
            stage: "completed",
            percent: 100,
            message: `Cena ${itemId} concluída.`,
            sceneRef: result.sceneRef,
            compositions: result.compositions.map((c) => ({
              composition: c.composition,
              status: "completed",
              stage: "completed",
              percent: 100,
              message: "Publicada no WMS.",
              archiveFilename: c.archive.filename,
              archiveHdPath: c.archive.hdPath,
              wmsLayerName: c.archive.wmsLayerName,
              wmsStoreName: c.archive.wmsStoreName,
              wmsUrl: c.archive.wmsPublicUrl,
              bytes: c.archive.bytes,
              completedAt: new Date().toISOString(),
            })),
            archive: result.compositions[0]?.archive,
            wmsLayerNames: result.wmsLayerNames,
            bytes: result.bytes,
            completedAt: new Date().toISOString(),
          };
          sceneStates.set(itemId, state);
          persistBatch({ message: `Cena ${itemId} concluída.` });
        } catch (error: any) {
          if (error instanceof NdviSceneCancelError || isCancelRequested(jobId)) throw error;
          const current = sceneStates.get(itemId) || queuedScene(itemId);
          sceneStates.set(itemId, {
            ...current,
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
    await Promise.all(
      Array.from(
        { length: Math.min(NDVI_SCENE_BATCH_CONCURRENCY, input.itemIds.length) },
        () => worker(),
      ),
    );

    const scenes = [...sceneStates.values()];
    const completed = scenes.filter((scene) => scene.status === "completed");
    const failed = scenes.filter((scene) => scene.status === "failed");
    const finalStatus: NdviSceneJobStatus = completed.length > 0 ? "completed" : "failed";
    const outputUrls = completed.flatMap((scene) => scene.compositions?.map((c) => c.wmsUrl || "") || []);
    const wmsLayerNames = completed.flatMap((scene) => scene.wmsLayerNames || []);

    progress(uid, jobId, {
      status: finalStatus,
      mode: input.itemIds.length > 1 ? "batch" : "single",
      stage: finalStatus === "completed" ? "completed" : "failed",
      percent: 100,
      message:
        failed.length > 0
          ? `${completed.length} cena(s) concluída(s), ${failed.length} falharam.`
          : `${completed.length} cena(s) concluída(s).`,
      scenes,
      outputUrls,
      wmsLayerNames,
      wmsUrl: completed[0]?.compositions?.[0]?.wmsUrl || "",
      completedAt: new Date().toISOString(),
    }, emit);
    finishJob({ jobId, status: finalStatus, error: finalStatus === "failed" ? "all_scenes_failed" : undefined });
    emit(jobId, { type: "done", jobId });
  } catch (error: any) {
    if (error instanceof NdviSceneCancelError || isCancelRequested(jobId)) {
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
        mode: input.itemIds.length > 1 ? "batch" : "single",
        stage: "cancelled",
        percent: 0,
        message: "Processamento NDVI cancelado.",
        error: "cancel_requested",
        scenes: [...sceneStates.values()],
      }, emit);
      finishJob({ jobId, status: "cancelled", error: "cancel_requested" });
      emit(jobId, { type: "cancelled", jobId });
      return;
    }
    const message = String(error?.message || "Falha ao processar NDVI por cena completa.");
    progress(uid, jobId, {
      status: "failed",
      mode: input.itemIds.length > 1 ? "batch" : "single",
      stage: "failed",
      message,
      error: message,
      scenes: [...sceneStates.values()],
    }, emit);
    finishJob({ jobId, status: "failed", error: message });
    emit(jobId, { type: "error", jobId, message });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro de limpeza.
    }
  }
}
