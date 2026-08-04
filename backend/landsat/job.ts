/**
 * Job Landsat: reaproveitamento do acervo ou processamento completo.
 */
import fs from "node:fs";
import path from "node:path";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { createLandsatComposite } from "./composite";
import { GEOSERVER_WORKSPACE, LANDSAT_TMP_ROOT } from "./constants";
import { publicWmsCapabilitiesUrl, publishLandsatGeoTiff, wmsDownloadPathForLayer } from "./geoserver";
import { buildStoreName, findLocalRecordByLayerName, findLocalRecordForExternal, landsatArchivePath, localRecordToScene } from "./local-archive";
import { closeJobSubscribers, emitJobEvent, progress } from "./sse";
import { getStacItem, prepareDownloadableLandsatItem, sceneFromStacFeature } from "./stac-search";
import { LandsatComposition, LandsatJobState, LandsatJobStatus, LandsatLocalRecord } from "./types";
import { copyFileAtomic, ensureDir } from "./utils";

export function buildReuseState(record: LandsatLocalRecord): LandsatJobState {
  const scene = localRecordToScene(record);
  return {
    sceneId: record.layerName,
    scene,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "Imagem Landsat já publicada no WMS; acervo reaproveitado para este usuário.",
    outputUrl: scene.wmsDownloadUrl,
    outputFilename: path.basename(record.sourcePath),
    outputBytes: record.bytes,
    wmsLayerName: scene.wmsLayerName,
    wmsStoreName: scene.wmsStoreName,
    wmsUrl: scene.wmsUrl,
    wmsDownloadUrl: scene.wmsDownloadUrl,
  };
}

export async function processLandsatJob(input: {
  uid: string;
  jobId: string;
  sceneId: string;
  filename: string;
  composition: LandsatComposition;
}): Promise<void> {
  const { uid, jobId } = input;
  const tmpDir = path.join(LANDSAT_TMP_ROOT, jobId);
  ensureDir(tmpDir);
  try {
    const local = findLocalRecordByLayerName(input.sceneId);
    if (local) {
      const state = buildReuseState(local);
      progress(uid, jobId, {
        ...state,
        filename: input.filename,
        completedAt: new Date().toISOString(),
      });
      finishJob({ jobId, status: "completed" });
      emitJobEvent(jobId, { type: "completed", jobId });
      return;
    }

    const item = await getStacItem(input.sceneId);
    let scene = sceneFromStacFeature(item, input.composition);
    if (!scene) throw new Error(`Cena Landsat ${input.sceneId} sem assets suficientes para ${input.composition}.`);
    const already = findLocalRecordForExternal(scene);
    if (already) {
      const state = buildReuseState(already);
      progress(uid, jobId, {
        ...state,
        filename: input.filename,
        completedAt: new Date().toISOString(),
      });
      finishJob({ jobId, status: "completed" });
      emitJobEvent(jobId, { type: "completed", jobId });
      return;
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "download",
      percent: 8,
      message: "Cena Landsat não encontrada no WMS; preparando download das bandas.",
      scene,
    });
    const downloadableItem = await prepareDownloadableLandsatItem(item);
    const composite = await createLandsatComposite({
      item: downloadableItem,
      scene,
      tmpDir,
      onProgress: (patch) => progress(uid, jobId, { status: "processing", ...patch }),
    });
    const archivePath = landsatArchivePath(scene, composite.outputFilename);
    progress(uid, jobId, { stage: "archive", percent: 78, message: "Salvando GeoTIFF Landsat no acervo permanente." });
    const bytes = copyFileAtomic(composite.outputPath, archivePath);
    const overviewTmp = `${composite.outputPath}.ovr`;
    if (fs.existsSync(overviewTmp)) {
      copyFileAtomic(overviewTmp, `${archivePath}.ovr`);
    }
    const storeName = buildStoreName(scene, composite.outputFilename);
    progress(uid, jobId, { stage: "publish_wms", percent: 88, message: "Publicando Landsat no GeoServer/WMS." });
    await publishLandsatGeoTiff({
      storeName,
      title: path.basename(composite.outputFilename, path.extname(composite.outputFilename)),
      hdPath: archivePath,
      orbit: scene.orbit,
      year: scene.year,
    });
    const record = findLocalRecordByLayerName(storeName);
    if (record) scene = localRecordToScene(record);
    else {
      scene = {
        ...scene,
        source: "local_wms",
        wmsAvailable: true,
        wmsLayerName: `${GEOSERVER_WORKSPACE}:${storeName}`,
        wmsStoreName: storeName,
        wmsUrl: publicWmsCapabilitiesUrl(),
        wmsDownloadUrl: wmsDownloadPathForLayer(storeName),
        sourcePath: archivePath,
        outputFilename: path.basename(archivePath),
      };
    }
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Imagem Landsat criada e publicada no WMS.",
      filename: input.filename,
      sceneId: input.sceneId,
      scene,
      outputUrl: scene.wmsDownloadUrl,
      outputFilename: path.basename(archivePath),
      outputBytes: bytes,
      wmsLayerName: scene.wmsLayerName,
      wmsStoreName: scene.wmsStoreName,
      wmsUrl: scene.wmsUrl,
      wmsDownloadUrl: scene.wmsDownloadUrl,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
    emitJobEvent(jobId, { type: "completed", jobId });
  } catch (error: any) {
    const status: LandsatJobStatus = isCancelRequested(jobId) ? "cancelled" : "failed";
    const message = status === "cancelled"
      ? "Processamento Landsat cancelado."
      : String(error?.message || "Falha ao processar Landsat.");
    progress(uid, jobId, {
      status,
      stage: status,
      percent: status === "cancelled" ? 0 : 100,
      message,
      error: status === "failed" ? message : undefined,
    });
    finishJob({ jobId, status, error: status === "failed" ? message : "cancel_requested" });
    emitJobEvent(jobId, { type: status, jobId, message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    closeJobSubscribers(jobId);
  }
}

export function parseComposition(raw: unknown): LandsatComposition | "any" {
  const value = String(raw || "").trim();
  if (value === "natural_color" || value === "natural") return "natural_color";
  if (value === "any") return "any";
  return "false_color";
}
