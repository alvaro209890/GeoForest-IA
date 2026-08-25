/**
 * Orquestrador do job NDVI: geometria → cena → recorte → cálculo → paleta → acervo →
 * publicação → estatística zonal → laudo.
 *
 * Roda sobre um recorte SIMCAR já concluído — a geometria vem do documento persistido,
 * não de um upload novo.
 */
import fs from "node:fs";
import path from "node:path";
import type { Geometry } from "geojson";
import { isCancelRequested } from "../processing-jobs";
import { hydrateCachedJob, readPersistedSimcarClipForUid } from "../simcar/hydration";
import { uploadRawBufferToCloudinary } from "../simcar/cloudinary";
import { NDVI_TMP_ROOT } from "./constants";
import {
  assertNdviRange,
  buildOverviews,
  clipBand,
  colorRelief,
  computeNdvi,
  readBandStats,
  readGrid,
  rgbToPng,
  writeCutline,
} from "./compute";
import { findReusableNdvi, ndviArchiveSubdir, saveNdviArchiveAsset, saveNdviArchiveRecord } from "./archive";
import { buildNdviFilename, dateCompactFromItemId } from "./naming";
import { classifyNdvi } from "./ndvi-math";
import { buildNdviReportDocxBuffer } from "./report-ndvi-docx";
import { pickBest, resolveAssetHrefs, searchCandidates, toSceneRef } from "./scene-select";
import { measureAll } from "./zonal";
import {
  NdviCancelError,
  NdviFailure,
  type NdviArchiveRecord,
  type NdviProgressPatch,
  type NdviResult,
  type NdviZonalStat,
} from "./types";

export type NdviJobInput = {
  uid: string;
  ndviJobId: string;
  clipJobId: string;
  year?: number | null;
  force?: boolean;
  onProgress?: (patch: NdviProgressPatch) => void;
};

function relatar(input: NdviJobInput, patch: NdviProgressPatch): void {
  input.onProgress?.(patch);
}

function throwIfCancelled(jobId: string): void {
  if (isCancelRequested(jobId)) throw new NdviCancelError();
}

/** Ano padrão: o mais recente com chance de cena boa. */
function anoAlvo(year?: number | null): number {
  if (year && Number.isFinite(year)) return Number(year);
  const agora = new Date();
  // antes de outubro a janela seca do ano corrente ainda não fechou
  return agora.getUTCMonth() >= 9 ? agora.getUTCFullYear() : agora.getUTCFullYear() - 1;
}

export async function runNdviJob(input: NdviJobInput): Promise<NdviResult> {
  const tmpDir = path.join(NDVI_TMP_ROOT, input.ndviJobId);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // --- 1. Geometria do recorte -----------------------------------------
    relatar(input, { stage: "geometry", percent: 2, message: "Lendo a geometria do recorte." });
    const persistido = readPersistedSimcarClipForUid(input.uid, input.clipJobId);
    if (!persistido) throw new NdviFailure("sem_geometria", "Recorte não encontrado para este usuário.");

    const job = await hydrateCachedJob(
      input.clipJobId,
      persistido.contextUrl || persistido.files?.contextUrl,
      persistido.outputZipUrl || persistido.files?.outputZipUrl,
      input.uid,
    );
    const imovel = job?.polygon?.geometry as Geometry | undefined;
    if (!imovel) throw new NdviFailure("sem_geometria");
    const clipped: Map<string, Geometry[]> = job?.clippedGeometries || new Map();
    throwIfCancelled(input.ndviJobId);

    // --- 2. Cena ----------------------------------------------------------
    const ano = anoAlvo(input.year);
    relatar(input, { stage: "scene", percent: 6, message: `Procurando cena Landsat de ${ano}.` });
    const candidatos = await searchCandidates({ geometry: imovel, year: ano });
    const melhor = pickBest(candidatos);
    const scene = toSceneRef(melhor);
    relatar(input, {
      stage: "scene",
      percent: 12,
      message: `Cena escolhida: ${scene.platformLabel}, ${scene.path}/${scene.row}, ${scene.acquiredAt}.`,
    });
    throwIfCancelled(input.ndviJobId);

    // --- 2b. Reuso --------------------------------------------------------
    if (!input.force) {
      const reaproveitavel = findReusableNdvi({ itemId: scene.itemId, clipJobId: input.clipJobId });
      if (reaproveitavel) {
        relatar(input, { stage: "scene", percent: 70, message: "Reusando NDVI já publicado desta cena." });
        return await finalizar({
          input,
          scene,
          tmpDir,
          ndviPath: reaproveitavel.ndviHdPath,
          rgbPath: reaproveitavel.rgbHdPath,
          clipped,
          imovel,
          registro: reaproveitavel,
        });
      }
    }

    // --- 3. Recorte remoto das bandas ------------------------------------
    const hrefs = await resolveAssetHrefs(melhor.item);
    const cutline = writeCutline(tmpDir, "imovel", imovel);
    const nirPath = path.join(tmpDir, "nir.tif");
    const redPath = path.join(tmpDir, "red.tif");
    const qaPath = path.join(tmpDir, "qa.tif");

    await clipBand({
      uid: input.uid, jobId: input.ndviJobId, href: hrefs.nir08, cutlinePath: cutline,
      outPath: nirPath, band: "nir08", basePercent: 12, spanPercent: 13, onProgress: input.onProgress,
    });
    // as demais bandas herdam a grade da primeira: desalinhar faria o gdal_calc
    // alinhar errado em silêncio
    const grid = await readGrid(nirPath, input.ndviJobId);
    await clipBand({
      uid: input.uid, jobId: input.ndviJobId, href: hrefs.red, cutlinePath: cutline,
      outPath: redPath, band: "red", grid, basePercent: 25, spanPercent: 13, onProgress: input.onProgress,
    });
    if (hrefs.qa_pixel) {
      await clipBand({
        uid: input.uid, jobId: input.ndviJobId, href: hrefs.qa_pixel, cutlinePath: cutline,
        outPath: qaPath, band: "qa_pixel", grid, basePercent: 38, spanPercent: 7, onProgress: input.onProgress,
      });
    }
    throwIfCancelled(input.ndviJobId);

    // --- 4. Cálculo -------------------------------------------------------
    const ndviTmp = path.join(tmpDir, "ndvi.tif");
    await computeNdvi({
      uid: input.uid, jobId: input.ndviJobId, nirPath, redPath,
      qaPath: hrefs.qa_pixel ? qaPath : null, outPath: ndviTmp, platform: scene.platform,
      basePercent: 45, spanPercent: 15, onProgress: input.onProgress,
    });
    // sanidade: fora de [-1, 1] denuncia erro de escala/offset. Custa nada e pega o
    // bug mais caro da feature na hora.
    assertNdviRange(await readBandStats(ndviTmp, input.ndviJobId));

    // --- 5. Paleta --------------------------------------------------------
    const rgbTmp = path.join(tmpDir, "ndvi_rgb.tif");
    await colorRelief({
      uid: input.uid, jobId: input.ndviJobId, ndviPath: ndviTmp, outPath: rgbTmp,
      basePercent: 60, spanPercent: 6, onProgress: input.onProgress,
    });

    // --- 6. Overviews -----------------------------------------------------
    await buildOverviews({
      uid: input.uid, jobId: input.ndviJobId, rasterPath: ndviTmp, kind: "data",
      basePercent: 66, spanPercent: 3, onProgress: input.onProgress,
    });
    await buildOverviews({
      uid: input.uid, jobId: input.ndviJobId, rasterPath: rgbTmp, kind: "rgb",
      basePercent: 69, spanPercent: 3, onProgress: input.onProgress,
    });
    throwIfCancelled(input.ndviJobId);

    // --- 7. Acervo --------------------------------------------------------
    relatar(input, { stage: "archive", percent: 73, message: "Arquivando no HD Backup." });
    const dateCompact = dateCompactFromItemId(scene.itemId) || scene.acquiredAt.replace(/-/g, "");
    const subdir = ndviArchiveSubdir(scene.path, scene.row, scene.year);
    const nomeNdvi = buildNdviFilename({
      path: scene.path, row: scene.row, dateCompact,
      platform: scene.platform as any, kind: "NDVI", jobId: input.ndviJobId,
    });
    const nomeRgb = buildNdviFilename({
      path: scene.path, row: scene.row, dateCompact,
      platform: scene.platform as any, kind: "RGB", jobId: input.ndviJobId,
    });
    const salvoNdvi = saveNdviArchiveAsset({ subdir, filename: nomeNdvi, sourcePath: ndviTmp });
    const salvoRgb = saveNdviArchiveAsset({ subdir, filename: nomeRgb, sourcePath: rgbTmp });

    // ⚠️ Desde 25/08/2026 o NDVI pós-recorte NÃO é mais publicado no WMS: a aba
    // NDVI dedicada (backend/ndvi-scene/) publica a cena completa. Aqui ficam só
    // acervo + estatística + laudo (a cena recortada não deve aparecer no WMS).
    const registro: NdviArchiveRecord = {
      ndviId: nomeNdvi,
      uid: input.uid,
      ndviJobId: input.ndviJobId,
      clipJobId: input.clipJobId,
      itemId: scene.itemId,
      platform: scene.platform,
      path: scene.path,
      row: scene.row,
      year: String(scene.year),
      acquiredAt: scene.acquiredAt,
      cloudCoverPct: scene.cloudCoverPct,
      ndviFilename: nomeNdvi,
      ndviHdPath: salvoNdvi.absolutePath,
      ndviLayerName: "",
      rgbFilename: nomeRgb,
      rgbHdPath: salvoRgb.absolutePath,
      rgbLayerName: "",
      bytes: salvoNdvi.bytes + salvoRgb.bytes,
      wmsPublicUrl: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveNdviArchiveRecord(registro);

    return await finalizar({
      input, scene, tmpDir,
      ndviPath: salvoNdvi.absolutePath,
      rgbPath: salvoRgb.absolutePath,
      clipped, imovel, registro,
    });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* temporário some na próxima limpeza */
    }
  }
}

/** Estatística zonal + laudo. Compartilhado entre o caminho novo e o de reuso. */
async function finalizar(args: {
  input: NdviJobInput;
  scene: NdviResult["scene"];
  tmpDir: string;
  ndviPath: string;
  rgbPath: string;
  clipped: Map<string, Geometry[]>;
  imovel: Geometry;
  registro: NdviArchiveRecord;
}): Promise<NdviResult> {
  const { input, scene } = args;

  // --- 9. Estatística zonal ---------------------------------------------
  relatar(input, { stage: "zonal", percent: 88, message: "Medindo o NDVI por polígono." });
  const propertyStat = await medirImovel(args);
  const { stats, omitidas } = await measureAll({
    uid: input.uid,
    jobId: input.ndviJobId,
    ndviPath: args.ndviPath,
    tmpDir: args.tmpDir,
    clipped: args.clipped,
    onProgress: (feito, total) =>
      relatar(input, {
        stage: "zonal",
        percent: 88 + Math.round((feito / Math.max(1, total)) * 6),
        message: `Medindo polígonos (${feito}/${total}).`,
      }),
  });

  const resultado: NdviResult = {
    clipJobId: input.clipJobId,
    ndviJobId: input.ndviJobId,
    generatedAt: new Date().toISOString(),
    scene,
    propertyStat,
    stats,
    featuresOmitidas: omitidas,
    raster: {
      // ⚠️ Sem publicação WMS desde 25/08/2026 (cena recortada não vai ao WMS;
      // a aba NDVI dedicada publica a cena completa). Mantém só os caminhos locais.
      ndviLayerName: "",
      rgbLayerName: "",
      ndviHdPath: args.registro.ndviHdPath,
      rgbHdPath: args.registro.rgbHdPath,
      wmsPublicUrl: "",
      bytes: args.registro.bytes,
    },
    failure: derivarFalha(propertyStat, scene),
    avisos: [],
  };

  // --- 10. Laudo ---------------------------------------------------------
  relatar(input, { stage: "report", percent: 95, message: "Gerando o laudo NDVI em Word." });
  try {
    const figuras = await gerarFiguras(args, scene);
    const docx = await buildNdviReportDocxBuffer({
      clipJobId: input.clipJobId,
      ndvi: resultado,
      figures: figuras,
    });
    const nome = `NDVI_Laudo_Tecnico_${input.clipJobId.slice(0, 8)}.docx`;
    const url = await uploadRawBufferToCloudinary(
      docx,
      nome,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      input.uid,
    );
    (resultado as any).reportDocxUrl = url;
    (resultado as any).reportDocxFilename = nome;
  } catch (erro) {
    // ⚠️ Falha no laudo NÃO derruba o raster já publicado: são entregas independentes.
    // Mesma regra que já vale para o DOCX do laudo SIMCAR.
    resultado.avisos.push(
      `Laudo não pôde ser gerado: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  relatar(input, { stage: "done", percent: 100, message: "NDVI concluído." });
  return resultado;
}

async function medirImovel(args: {
  input: NdviJobInput;
  tmpDir: string;
  ndviPath: string;
  imovel: Geometry;
}): Promise<NdviZonalStat | null> {
  const { measureFeature } = await import("./zonal");
  return measureFeature({
    uid: args.input.uid,
    jobId: args.input.ndviJobId,
    ndviPath: args.ndviPath,
    tmpDir: args.tmpDir,
    layer: "IMOVEL",
    featureIndex: 0,
    geometry: args.imovel,
  });
}

async function gerarFiguras(
  args: { input: NdviJobInput; tmpDir: string; rgbPath: string },
  scene: NdviResult["scene"],
): Promise<Array<{ caption: string; buffer: Buffer }>> {
  try {
    const png = path.join(args.tmpDir, "fig_ndvi.png");
    await rgbToPng({
      uid: args.input.uid,
      jobId: args.input.ndviJobId,
      rgbPath: args.rgbPath,
      outPath: png,
    });
    if (!fs.existsSync(png)) return [];
    return [
      {
        caption:
          `NDVI do imóvel — ${scene.platformLabel}, órbita/ponto ${scene.path}/${scene.row}, ` +
          `passagem de ${scene.acquiredAt.split("-").reverse().join("/")}`,
        buffer: fs.readFileSync(png),
      },
    ];
  } catch {
    return [];
  }
}

function derivarFalha(
  propertyStat: NdviZonalStat | null,
  scene: NdviResult["scene"],
): NdviResult["failure"] {
  if (!propertyStat) return "sem_geometria";
  if (propertyStat.aviso) return propertyStat.aviso;
  if (scene.coberturaParcial) return "cobertura_parcial";
  if (scene.sensorDegradado) return "sensor_degradado";
  return null;
}

export { classifyNdvi };
