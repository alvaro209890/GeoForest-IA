/**
 * Composições da cena completa: bandas necessárias e o comando GDAL de cada uma.
 *
 * NDVI e NDFI são índices calculados com `gdal_calc.py` em Float32 (com a máscara
 * QA do `qa_pixel`) e depois coloridos com `gdaldem color-relief` — mesmas peças do
 * pipeline pós-recorte (`backend/ndvi/compute.ts`), agora sobre a cena inteira.
 * RGB e SWIR são composições diretas das bandas 16 bits convertidas para 8 bits com
 * realce (média ± N·σ), via `computeByteStretchArgs` do CBERS.
 */
import fs from "node:fs";
import path from "node:path";
import { computeByteStretchArgs } from "../cbers/enhance";
import { runCommand, runCommandCapture } from "../cbers/gdal";
import { isCancelRequested } from "../processing-jobs";
import { buildGdalCalcExpression, qaMaskForPlatform } from "../ndvi/ndvi-math";
import type { NdviProgressPatch } from "../ndvi/types";
import {
  NDFI_COLOR_RAMP_PATH,
  NDVI_COLOR_RAMP_PATH,
  NDVI_NODATA,
  NDVI_SCENE_COMPOSITIONS,
  NDVI_SR_OFFSET,
  NDVI_SR_SCALE,
  SAVI_COLOR_RAMP_PATH,
  type NdviSceneComposition,
} from "./constants";
import { NdviSceneCancelError } from "./types";

export type RunArgs = {
  uid: string;
  jobId: string;
  onProgress?: (patch: NdviProgressPatch) => void;
};

/** Lança o erro de cancelamento do pipeline quando o job foi cancelado. */
export function throwIfCancelled(jobId: string): void {
  if (isCancelRequested(jobId)) throw new NdviSceneCancelError();
}

/**
 * Bandas C2 L2 necessárias para cada composição. Fonte única: `NDVI_SCENE_COMPOSITIONS`.
 *   NDVI → [nir08, red, qa_pixel]
 *   NDFI → [swir16, nir08, qa_pixel]
 *   RGB  → [red, green, blue]
 *   SWIR → [swir16, nir08, red]  (falsa-cor 6-5-4)
 */
export function bandKeysForComposition(comp: NdviSceneComposition): string[] {
  const meta = NDVI_SCENE_COMPOSITIONS.find((c) => c.id === comp);
  if (!meta) throw new Error(`Composição desconhecida: ${comp}`);
  return [...meta.bands];
}

/** Todas as bandas que qualquer composição pode precisar (para assinar os hrefs). */
export function allBandKeys(): string[] {
  const set = new Set<string>();
  for (const meta of NDVI_SCENE_COMPOSITIONS) {
    for (const band of meta.bands) set.add(band);
  }
  return [...set];
}

/** Caminho da rampa de cor da composição (NDVI usa a do NDVI; NDFI/SAVI usam as próprias). */
function colorRampFor(comp: NdviSceneComposition): string {
  if (comp === "NDFI") return NDFI_COLOR_RAMP_PATH;
  if (comp === "SAVI") return SAVI_COLOR_RAMP_PATH;
  return NDVI_COLOR_RAMP_PATH;
}

/** Estatística da 1ª banda do `gdalinfo -json -approx_stats` (subamostra basta para realce). */
async function firstBandStat(rasterPath: string, jobId: string): Promise<{
  min: number;
  max: number;
  mean: number;
  stdDev: number;
} | null> {
  const out = await runCommandCapture("gdalinfo", ["-json", "-approx_stats", rasterPath], jobId);
  let info: any = null;
  try {
    info = JSON.parse(out);
  } catch {
    return null;
  }
  const band = Array.isArray(info?.bands) ? info.bands[0] : null;
  if (!band) return null;
  const min = Number(band.minimum);
  const max = Number(band.maximum);
  const mean = Number(band.mean);
  const stdDev = Number(band.stdDev);
  if (![min, max, mean, stdDev].every(Number.isFinite)) return null;
  return { min, max, mean, stdDev };
}

/**
 * Args `-scale_N` de fallback: min-max absoluto por banda (piso em 0, teto 255).
 * Só usado quando o realce média ± N·σ não está disponível.
 */
async function perBandMinMaxScaleArgs(bandPaths: string[], jobId: string): Promise<string[]> {
  const args: string[] = [];
  for (let i = 0; i < bandPaths.length; i += 1) {
    const stats = await firstBandStat(bandPaths[i], jobId);
    if (!stats || !(stats.max > stats.min)) {
      args.push(`-scale_${i + 1}`, "0", "255", "0", "255");
      continue;
    }
    args.push(`-scale_${i + 1}`, String(stats.min), String(stats.max), "0", "255");
  }
  return args;
}

function gdalCalcBaseArgs(outPath: string): string[] {
  return [
    "--outfile", outPath,
    "--type", "Float32",
    "--NoDataValue", String(NDVI_NODATA),
    "--co", "COMPRESS=LZW",
    "--co", "TILED=YES",
    "--co", "BIGTIFF=IF_SAFER",
    "--quiet",
  ];
}

/**
 * Expressão `gdal_calc` do NDFI a partir de reflectância (A: NIR, B: SWIR16, C: QA).
 *
 * NDFI = (ρ_NIR − ρ_SWIR16) / (ρ_NIR + ρ_SWIR16) — variação do NDVI usando SWIR:
 * área convertida/solo exposto tem SWIR alto e NIR baixo → valor negativo;
 * vegetação densa tem NIR alto e SWIR baixo → valor positivo alto.
 * Mesma disciplina do NDVI (`backend/ndvi/ndvi-math.ts`): converter DN → reflectância
 * ANTES de dividir, porque o offset (-0.2) não cancela na razão.
 */
export function buildNdfiCalcExpression(args: {
  qaMask: number;
  scale?: number;
  offset?: number;
  nodata?: number;
  comQa?: boolean;
}): string {
  const scale = args.scale ?? NDVI_SR_SCALE;
  const offset = args.offset ?? NDVI_SR_OFFSET;
  const nodata = args.nodata ?? NDVI_NODATA;
  const nir = `(A.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const swir = `(B.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const soma = `(${nir}+${swir})`;
  const invalido = args.comQa === false
    ? `(A<=0)|(B<=0)`
    : `(A<=0)|(B<=0)|(bitwise_and(C.astype(uint16),${args.qaMask})>0)`;
  return `where(${invalido},${nodata},(${nir}-${swir})/where(${soma}==0,1e-10,${soma}))`;
}

/**
 * Expressão `gdal_calc` do SAVI a partir de reflectância (A: NIR, B: RED, C: QA).
 *
 * SAVI = (ρ_NIR − ρ_RED) / (ρ_NIR + ρ_RED + L) × (1 + L), com L = 0,5.
 * O fator L (soil adjustment factor) reduz a influência do solo exposto no índice —
 * em áreas de vegetação esparsa o NDVI fica contaminado pelo brilho do solo; o SAVI
 * estabiliza a resposta. Mesma disciplina do NDVI: DN → reflectância ANTES da razão.
 */
export function buildSaviCalcExpression(args: {
  qaMask: number;
  scale?: number;
  offset?: number;
  nodata?: number;
  comQa?: boolean;
  soilFactor?: number;
}): string {
  const scale = args.scale ?? NDVI_SR_SCALE;
  const offset = args.offset ?? NDVI_SR_OFFSET;
  const nodata = args.nodata ?? NDVI_NODATA;
  const l = Number.isFinite(args.soilFactor) ? Number(args.soilFactor) : 0.5;
  const nir = `(A.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const red = `(B.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const soma = `(${nir}+${red}+${l})`;
  const invalido = args.comQa === false
    ? `(A<=0)|(B<=0)`
    : `(A<=0)|(B<=0)|(bitwise_and(C.astype(uint16),${args.qaMask})>0)`;
  return `where(${invalido},${nodata},(${nir}-${red})/where(${soma}==0,1e-10,${soma})*${1 + l})`;
}

/**
 * Monta e executa o comando GDAL que gera o GeoTIFF RGB 8 bits da composição.
 *
 * NDVI/NDFI: `gdal_calc.py` (Float32, máscara QA) → `gdaldem color-relief` (rampa).
 * RGB/SWIR:  `gdal_merge.py` das bandas 16 bits → `gdal_translate` para 8 bits com realce.
 *
 * @returns caminho do GeoTIFF RGB 8 bits gerado.
 */
export async function buildCompositionCommand(args: {
  comp: NdviSceneComposition;
  bandPaths: Record<string, string | undefined>;
  platform: string;
  outDir: string;
  uid: string;
  jobId: string;
  basePercent: number;
  spanPercent: number;
  onProgress?: (patch: NdviProgressPatch) => void;
}): Promise<string> {
  const { comp, bandPaths, platform } = args;
  const outBase = path.join(args.outDir, `${String(comp).toLowerCase()}`);

  if (comp === "NDVI" || comp === "NDFI" || comp === "SAVI") {
    const nirPath = bandPaths.nir08;
    const segundoPath = comp === "NDVI" ? bandPaths.red : comp === "NDFI" ? bandPaths.swir16 : bandPaths.red;
    if (!nirPath || !segundoPath) {
      throw new Error(`Composição ${comp} exige bandas nir08 e ${comp === "NDVI" || comp === "SAVI" ? "red" : "swir16"} materializadas.`);
    }
    const qaPath = bandPaths.qa_pixel;
    const comQa = Boolean(qaPath && fs.existsSync(qaPath));
    const indexTmp = `${outBase}_float.tif`;
    const expression = comp === "NDVI"
      ? buildGdalCalcExpression({ qaMask: qaMaskForPlatform(platform), comQa })
      : comp === "NDFI"
        ? buildNdfiCalcExpression({ qaMask: qaMaskForPlatform(platform), comQa })
        : buildSaviCalcExpression({ qaMask: qaMaskForPlatform(platform), comQa });
    const qaArgs = comQa ? ["-C", qaPath as string, "--C_band=1"] : [];
    await runCommand({
      uid: args.uid,
      jobId: args.jobId,
      command: "gdal_calc.py",
      commandArgs: [
        "-A", nirPath, "--A_band=1",
        "-B", segundoPath, "--B_band=1",
        ...qaArgs,
        ...gdalCalcBaseArgs(indexTmp),
        "--calc", expression,
      ],
      basePercent: args.basePercent,
      spanPercent: args.spanPercent * 0.6,
      stage: comp.toLowerCase(),
      message: `Calculando ${comp} da cena completa.`,
      onProgress: args.onProgress,
    });

    const rgbOut = `${outBase}_rgb.tif`;
    await runCommand({
      uid: args.uid,
      jobId: args.jobId,
      command: "gdaldem",
      commandArgs: [
        "color-relief",
        "-alpha",
        "-of", "GTiff",
        "-co", "COMPRESS=LZW",
        "-co", "TILED=YES",
        "-co", "BIGTIFF=IF_SAFER",
        indexTmp,
        colorRampFor(comp),
        rgbOut,
      ],
      basePercent: args.basePercent + args.spanPercent * 0.6,
      spanPercent: args.spanPercent * 0.4,
      stage: comp.toLowerCase(),
      message: `Aplicando a rampa de cor do ${comp}.`,
      onProgress: args.onProgress,
    });
    return rgbOut;
  }

  // RGB / SWIR: composição direta das bandas 16 bits em 8 bits com realce.
  const keys = bandKeysForComposition(comp); // ["red","green","blue"] | ["swir16","nir08","red"]
  const inputs: string[] = [];
  for (const key of keys) {
    const p = bandPaths[key];
    if (!p || !fs.existsSync(p)) throw new Error(`Composição ${comp} exige banda ${key} materializada.`);
    inputs.push(p);
  }

  const mergedTmp = `${outBase}_merged.tif`;
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdal_merge.py",
    commandArgs: [
      "-o", mergedTmp,
      "-of", "GTiff",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
      ...inputs,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent * 0.4,
    stage: comp.toLowerCase(),
    message: `Combinando bandas da composição ${comp}.`,
    onProgress: args.onProgress,
  });

  const stretchArgs =
    (await computeByteStretchArgs(mergedTmp, args.jobId)) ??
    (await perBandMinMaxScaleArgs(inputs, args.jobId));

  const rgbOut = `${outBase}_rgb.tif`;
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
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
      mergedTmp,
      rgbOut,
    ],
    basePercent: args.basePercent + args.spanPercent * 0.4,
    spanPercent: args.spanPercent * 0.6,
    stage: comp.toLowerCase(),
    message: `Gerando composição ${comp} em 8 bits com realce.`,
    onProgress: args.onProgress,
  });
  return rgbOut;
}
