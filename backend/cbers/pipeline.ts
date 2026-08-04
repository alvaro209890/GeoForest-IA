/**
 * Orquestrador de uma cena: download → pansharpen → realce → validação → publicação.
 */
import fs from "node:fs";
import path from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import { publishCbersPanToArchive } from "./archive";
import { cbersOutputFilename } from "./collections";
import { CBERS_STRETCH_SIGMA } from "./constants";
import { downloadAsset } from "./download";
import { computeByteStretchArgs } from "./enhance";
import { runCommand } from "./gdal";
import { progress, throwIfCancelled } from "./sse";
import { estimateSceneAssets, getStacItem, sceneFromStacFeature } from "./stac-search";
import { CbersEstimate, CbersProgressPatch, CbersScene, CbersSceneJobState } from "./types";
import { safeName } from "./utils";
import { validateAndCorrectCbersAlignment } from "./validate";
import { wmsDownloadPathForArchiveImage } from "./wms";
import { createPrivateCbersZip } from "./zip";

export async function processCbersScene(args: {
  uid: string;
  jobId: string;
  itemId: string;
  collectionId?: string | null;
  tmpDir: string;
  propertyGeometry?: Polygon | MultiPolygon;
  propertyGeometryHash?: string | null;
  areaHa: number;
  onSceneProgress?: (patch: Partial<CbersSceneJobState>) => void;
}): Promise<CbersSceneJobState> {
  const { uid, jobId } = args;
  const sceneDir = path.join(args.tmpDir, safeName(args.itemId));
  fs.mkdirSync(sceneDir, { recursive: true });

  let currentScene: CbersScene | null = null;
  let currentEstimate: CbersEstimate | null = null;

  const report = (patch: CbersProgressPatch) => {
    args.onSceneProgress?.({
      itemId: args.itemId,
      collectionId: currentScene?.collectionId || args.collectionId || undefined,
      level: currentScene?.level,
      status: "processing",
      ...patch,
      scene: currentScene,
      estimate: (patch.estimate ?? currentEstimate) ?? undefined,
      error: patch.error ?? undefined,
    });
    if (!args.onSceneProgress) {
      progress(uid, jobId, {
        ...patch,
        scene: currentScene,
        estimate: currentEstimate,
      });
    }
  };

  throwIfCancelled(jobId);
  report({ stage: "scene", percent: 5, message: "Carregando metadados da cena." });
  const { item, collection } = await getStacItem(args.itemId, args.collectionId);
  currentScene = sceneFromStacFeature(item, args.propertyGeometry, collection);
  const scene = currentScene;
  if (!scene) throw new Error("Cena STAC sem as bandas obrigatórias BAND3, BAND4, BAND2 e BAND0.");
  if (scene.coversArea === false) {
    throw new Error(`Cena ${scene.id} cobre apenas ${scene.coveragePercent ?? 0}% da área.`);
  }
  currentEstimate = await estimateSceneAssets({ itemId: args.itemId, collectionId: collection.collectionId, areaHa: args.areaHa, scene });
  const estimate = currentEstimate;
  report({ stage: "scene", percent: 7, message: `Cena selecionada: ${scene.id}.` });

  const assets = item.assets || {};
  const bandPaths: Record<string, string> = {};
  const downloadPlan = [
    { key: "BAND3", start: 8, span: 10 },
    { key: "BAND4", start: 18, span: 10 },
    { key: "BAND2", start: 28, span: 10 },
    { key: "BAND0", start: 38, span: 12 },
  ];
  for (const itemPlan of downloadPlan) {
    const href = String(assets[itemPlan.key]?.href || "");
    if (!href) throw new Error(`Asset ${itemPlan.key} ausente na cena ${scene.id}.`);
    const targetPath = path.join(sceneDir, `${itemPlan.key}.tif`);
    await downloadAsset({
      uid,
      jobId,
      assetKey: itemPlan.key,
      url: href,
      filePath: targetPath,
      basePercent: itemPlan.start,
      spanPercent: itemPlan.span,
      expectedBytes: estimate.assetSizes[itemPlan.key],
      onProgress: report,
    });
    bandPaths[itemPlan.key] = targetPath;
    report({ stage: "download", percent: itemPlan.start + itemPlan.span, message: `${itemPlan.key} baixada.` });
  }

  const rawPansharpenPath = path.join(sceneDir, "cbers_342_pan_raw.tif");
  await runCommand({
    uid,
    jobId,
    command: "gdal_pansharpen.py",
    commandArgs: [
      bandPaths.BAND0,
      bandPaths.BAND3,
      bandPaths.BAND4,
      bandPaths.BAND2,
      rawPansharpenPath,
      "-of", "GTiff",
      "-r", "cubic",
      "-spat_adjust", "intersection",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
    ],
    basePercent: 50,
    spanPercent: 37,
    stage: "pansharpen",
    message: "Fusionando a folha completa 3-4-2 com a pancromática.",
    onProgress: report,
  });
  report({ stage: "pansharpen", percent: 87, message: "Fusão pancromática da folha completa concluída." });

  const finalTempPath = path.join(sceneDir, "cbers_4a_wpm_342_pan.tif");
  const stretchArgs = (await computeByteStretchArgs(rawPansharpenPath, jobId)) ?? ["-scale"];
  const stretchLabel = stretchArgs.length <= 1
    ? "contraste automático (min-max)"
    : stretchArgs[0] === "-scale"
      ? `realce ${CBERS_STRETCH_SIGMA}σ preservando cor`
      : `realce ${CBERS_STRETCH_SIGMA}σ por banda`;
  await runCommand({
    uid,
    jobId,
    command: "gdal_translate",
    commandArgs: [
      "-of", "GTiff",
      "-ot", "Byte",
      ...stretchArgs,
      "-a_nodata", "0",
      "-colorinterp_1", "red",
      "-colorinterp_2", "green",
      "-colorinterp_3", "blue",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
      rawPansharpenPath,
      finalTempPath,
    ],
    basePercent: 87,
    spanPercent: 8,
    stage: "geotiff",
    message: `Gerando GeoTIFF final 8 bits (${stretchLabel}) da órbita/ponto completa para ArcMap.`,
    onProgress: report,
  });
  const outputName = cbersOutputFilename(scene.id || args.itemId, collection.level);
  const alignment = await validateAndCorrectCbersAlignment({
    uid,
    jobId,
    scene,
    item,
    sourcePath: finalTempPath,
    sceneDir,
    onProgress: report,
  });
  const publishSourcePath = alignment.correctedPath || finalTempPath;
  const alignmentWarning = alignment.warning;

  if (alignment.status === "failed_private" || alignment.status === "reference_missing") {
    report({
      stage: "private_zip",
      percent: 99,
      message: "Georreferenciamento inválido para WMS; gerando ZIP privado com aviso.",
      alignmentStatus: "failed_private",
      alignmentWarning,
      alignment,
    });
    const privateZip = await createPrivateCbersZip({
      uid,
      jobId,
      scene,
      sourcePath: publishSourcePath,
      outputFilename: outputName,
      sceneDir,
      alignment: {
        ...alignment,
        status: "failed_private",
        warning: alignment.warning || "Imagem entregue apenas ao usuário porque o georreferenciamento gerado não pôde ser validado.",
      },
    });
    return {
      itemId: args.itemId,
      collectionId: collection.collectionId,
      level: collection.level,
      scene: {
        ...scene,
        alignmentStatus: "failed_private",
        alignmentWarning: alignment.warning,
      },
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "GeoTIFF concluído, mas com georreferenciamento não validado. Disponível apenas para este usuário; não publicado no WMS.",
      estimate,
      outputUrl: privateZip.url,
      outputRelativePath: privateZip.relativePath,
      outputFilename: privateZip.filename,
      outputBytes: privateZip.bytes,
      alignmentStatus: "failed_private",
      alignmentWarning: alignment.warning,
      alignment: {
        ...alignment,
        status: "failed_private",
      },
    };
  }

  report({ stage: "save", percent: 98, message: "Salvando GeoTIFF no raster compartilhado." });
  report({ stage: "publish", percent: 98, message: "Publicando GeoTIFF no acervo WMS." });
  const archive = await publishCbersPanToArchive({
    uid,
    jobId,
    itemId: args.itemId,
    geometryHash: undefined,
    outputFilename: outputName,
    sourcePath: publishSourcePath,
    level: collection.level,
  });

  return {
    itemId: args.itemId,
    collectionId: collection.collectionId,
    level: collection.level,
    scene: {
      ...scene,
      alignmentStatus: alignment.status,
      alignmentWarning,
    },
    status: "completed",
    stage: "completed",
    percent: 100,
    message: "GeoTIFF concluído.",
    estimate,
    outputUrl: wmsDownloadPathForArchiveImage(archive.imageId),
    outputRelativePath: archive.hdRelativePath,
    outputFilename: outputName,
    outputBytes: archive.bytes,
    archive,
    archiveImageId: archive.imageId,
    wmsLayerName: archive.wmsLayerName,
    wmsUrl: archive.wmsPublicUrl,
    wmsDownloadUrl: wmsDownloadPathForArchiveImage(archive.imageId),
    alignmentStatus: alignment.status,
    alignmentWarning,
    alignment,
  };
}
