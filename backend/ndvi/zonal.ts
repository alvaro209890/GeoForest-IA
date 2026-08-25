/**
 * Estatística zonal — o número que vai para o laudo.
 *
 * ⚠️ **Uma linha por feição, jamais pela união das feições.** Isso é requisito, não
 * estilo: na reunião de 31/07/2026 o Bruno mostrou ao vivo três polígonos medidos
 * juntos devolvendo 0,16 — um número que não descrevia nenhum dos três (22:18).
 * Dissolver geometrias antes de medir é o atalho natural de quem implementa e é
 * exatamente o que produz laudo errado.
 *
 * Sem dependência nova: recorta com `gdalwarp -cutline` por feição e lê
 * `gdalinfo -json -stats`, que já entrega min/max/mean/stdDev e
 * `STATISTICS_VALID_PERCENT`.
 */
import "../proj-defs";
import path from "node:path";
import { area as turfArea } from "@turf/turf";
import type { Geometry } from "geojson";
import { runCommand } from "../cbers/gdal";
import { isCancelRequested } from "../processing-jobs";
import {
  NDVI_MIN_PIXELS,
  NDVI_MIN_VALID_PCT,
  NDVI_NODATA,
  NDVI_ZONAL_LAYERS,
  NDVI_ZONAL_MAX_FEATURES,
} from "./constants";
import { readBandStats, readGrid, writeCutline } from "./compute";
import { classifyNdvi } from "./ndvi-math";
import { NdviCancelError, type NdviZonalStat } from "./types";

function areaHaOf(geometry: Geometry): number {
  try {
    const m2 = turfArea({ type: "Feature", properties: {}, geometry } as any);
    return Number.isFinite(m2) ? m2 / 10_000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Mede uma feição. Devolve `null` só quando o recorte falha de todo (feição fora do
 * raster) — o resto vira aviso na própria linha, nunca omissão silenciosa.
 */
export async function measureFeature(args: {
  uid: string;
  jobId: string;
  ndviPath: string;
  tmpDir: string;
  layer: string;
  featureIndex: number;
  geometry: Geometry;
}): Promise<NdviZonalStat | null> {
  const areaHa = areaHaOf(args.geometry);
  const nome = `zonal_${args.layer}_${args.featureIndex}`;
  const cutline = writeCutline(args.tmpDir, nome, args.geometry);
  const recorte = path.join(args.tmpDir, `${nome}.tif`);

  try {
    await runCommand({
      uid: args.uid,
      jobId: args.jobId,
      command: "gdalwarp",
      commandArgs: [
        "-cutline", cutline,
        "-crop_to_cutline",
        "-dstnodata", String(NDVI_NODATA),
        "-of", "GTiff",
        "-co", "COMPRESS=LZW",
        args.ndviPath,
        recorte,
      ],
      basePercent: 0,
      spanPercent: 0,
      stage: "zonal",
      message: `Medindo ${args.layer} #${args.featureIndex + 1}.`,
    });
  } catch (erro) {
    if (erro instanceof NdviCancelError) throw erro;
    return null;
  }

  const stats = await readBandStats(recorte, args.jobId);
  if (!stats) return null;

  // gdalinfo dá o percentual de pixels válidos; o total sai da grade do recorte.
  const validPct =
    stats.validPercent === null ? 1 : Math.max(0, Math.min(1, stats.validPercent / 100));
  const grade = await readGrid(recorte, args.jobId);
  const totalPixels = grade ? grade.ts[0] * grade.ts[1] : 0;
  const validPixels = Math.round(totalPixels * validPct);

  let aviso: NdviZonalStat["aviso"] = null;
  if (totalPixels > 0 && totalPixels < NDVI_MIN_PIXELS) aviso = "area_pequena_demais";
  else if (validPct < NDVI_MIN_VALID_PCT) aviso = "nuvem_excessiva";

  // Sem pixel válido suficiente a gente MEDE mas NÃO classifica.
  const classe = aviso === null ? classifyNdvi(stats.mean) : null;

  return {
    layer: args.layer,
    featureIndex: args.featureIndex,
    areaHa,
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    stdDev: stats.stdDev,
    validPixels,
    totalPixels,
    validPct,
    classe: classe?.id ?? null,
    classeLabel: classe?.label ?? null,
    aviso,
  };
}

/** Seleciona as feições que serão medidas, respeitando o teto e priorizando as maiores. */
export function selectFeatures(
  clipped: Map<string, Geometry[]>,
  maxFeatures = NDVI_ZONAL_MAX_FEATURES,
): { alvo: Array<{ layer: string; featureIndex: number; geometry: Geometry }>; omitidas: number } {
  const todas: Array<{ layer: string; featureIndex: number; geometry: Geometry; areaHa: number }> = [];
  for (const layer of NDVI_ZONAL_LAYERS) {
    const geoms = clipped.get(layer) || [];
    geoms.forEach((geometry, featureIndex) => {
      if (!geometry) return;
      todas.push({ layer, featureIndex, geometry, areaHa: areaHaOf(geometry) });
    });
  }
  if (todas.length <= maxFeatures) {
    return { alvo: todas.map(({ areaHa, ...resto }) => resto), omitidas: 0 };
  }
  // Um CAR com centenas de fragmentos não pode travar o job: medimos as maiores.
  const ordenadas = [...todas].sort((a, b) => b.areaHa - a.areaHa).slice(0, maxFeatures);
  // devolve na ordem original de camada para o laudo ficar legível
  const chave = new Set(ordenadas.map((f) => `${f.layer}#${f.featureIndex}`));
  const alvo = todas
    .filter((f) => chave.has(`${f.layer}#${f.featureIndex}`))
    .map(({ areaHa, ...resto }) => resto);
  return { alvo, omitidas: todas.length - alvo.length };
}

/** Mede todas as feições selecionadas, uma por vez. */
export async function measureAll(args: {
  uid: string;
  jobId: string;
  ndviPath: string;
  tmpDir: string;
  clipped: Map<string, Geometry[]>;
  onProgress?: (feito: number, total: number) => void;
}): Promise<{ stats: NdviZonalStat[]; omitidas: number }> {
  const { alvo, omitidas } = selectFeatures(args.clipped);
  const stats: NdviZonalStat[] = [];
  for (let i = 0; i < alvo.length; i += 1) {
    if (isCancelRequested(args.jobId)) throw new NdviCancelError();
    const feicao = alvo[i];
    const linha = await measureFeature({
      uid: args.uid,
      jobId: args.jobId,
      ndviPath: args.ndviPath,
      tmpDir: args.tmpDir,
      layer: feicao.layer,
      featureIndex: feicao.featureIndex,
      geometry: feicao.geometry,
    });
    if (linha) stats.push(linha);
    args.onProgress?.(i + 1, alvo.length);
  }
  return { stats, omitidas };
}
