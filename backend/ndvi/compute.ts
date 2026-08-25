/**
 * Núcleo do NDVI: recorte remoto das bandas, cálculo, paleta e overviews.
 *
 * Reusa o executor GDAL do CBERS (`runCommand`/`runCommandCapture`), que já traz
 * progresso, cancelamento e o `gdalCommandEnv()` configurado para ler COG por HTTP.
 *
 * ⚠️ **Não baixamos a cena inteira.** Cada banda C2 L2 é um COG de ~60–120 MB cobrindo
 * ~180×180 km; o imóvel ocupa uma fração ínfima. `gdalwarp` sobre `/vsicurl/` lê só os
 * tiles necessários. Se falhar (servidor sem range request), cai para download completo.
 */
import fs from "node:fs";
import path from "node:path";
import { runCommand, runCommandCapture } from "../cbers/gdal";
import {
  NDVI_COLOR_RAMP_PATH,
  NDVI_NODATA,
  NDVI_OVERVIEW_LEVELS,
  NDVI_OVERVIEW_MIN_PIXELS,
  NDVI_OVERVIEW_RESAMPLING_DATA,
  NDVI_OVERVIEW_RESAMPLING_RGB,
} from "./constants";
import { buildGdalCalcExpression, qaMaskForPlatform } from "./ndvi-math";
import type { NdviProgressPatch } from "./types";

export type BandKey = "nir08" | "red" | "qa_pixel";

type RunArgs = {
  uid: string;
  jobId: string;
  onProgress?: (patch: NdviProgressPatch) => void;
};

/** Grade de referência do primeiro recorte, para os demais saírem idênticos. */
export type GridRef = {
  te: [number, number, number, number];
  ts: [number, number];
  /** Área de um pixel na projeção nativa (Landsat C2 L2: UTM, em m²). */
  pixelAreaM2?: number;
};

/**
 * Recorta uma banda pelo cutline do imóvel, direto da URL assinada.
 *
 * ⚠️ **Sem `-cutline_srs`**: essa flag NÃO existe no gdalwarp do GDAL 3.8.4 (medido no
 * servidor em 25/08/2026 — `gdalwarp --help` só lista `-cutline`, `-cl`, `-cwhere`,
 * `-csql`, `-cblend`, `-crop_to_cutline`). O GDAL lê o CRS do próprio arquivo de corte;
 * o GeoJSON que escrevemos é WGS84 por especificação, e SIRGAS 2000 fica a menos de 1 m
 * dele. O raster sai na projeção **nativa** da cena — reprojetar antes do cálculo
 * interpolaria as bandas.
 */
export async function clipBand(
  args: RunArgs & {
    href: string;
    cutlinePath: string;
    outPath: string;
    band: BandKey;
    grid?: GridRef | null;
    basePercent: number;
    spanPercent: number;
  },
): Promise<void> {
  const remoto = /^https?:\/\//i.test(args.href) ? `/vsicurl/${args.href}` : args.href;
  // qa_pixel é bitmask: qualquer interpolação inventa bits que não existem.
  const resampling = args.band === "qa_pixel" ? "near" : "cubic";
  const gradeArgs = args.grid
    ? ["-te", ...args.grid.te.map(String), "-ts", ...args.grid.ts.map(String)]
    : [];
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdalwarp",
    commandArgs: [
      "-cutline", args.cutlinePath,
      "-crop_to_cutline",
      "-r", resampling,
      "-dstnodata", "0",
      ...gradeArgs,
      "-of", "GTiff",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
      remoto,
      args.outPath,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent,
    stage: "clip",
    message: `Recortando banda ${args.band.toUpperCase()} da cena.`,
    onProgress: args.onProgress,
  });
}

/** Lê a grade (extensão + tamanho) de um raster já recortado. */
export async function readGrid(rasterPath: string, jobId: string): Promise<GridRef | null> {
  const saida = await runCommandCapture("gdalinfo", ["-json", rasterPath], jobId);
  try {
    const info = JSON.parse(saida);
    const size = info?.size;
    const c = info?.cornerCoordinates;
    if (!Array.isArray(size) || !c?.upperLeft || !c?.lowerRight) return null;
    const minX = Math.min(Number(c.upperLeft[0]), Number(c.lowerRight[0]));
    const maxX = Math.max(Number(c.upperLeft[0]), Number(c.lowerRight[0]));
    const minY = Math.min(Number(c.upperLeft[1]), Number(c.lowerRight[1]));
    const maxY = Math.max(Number(c.upperLeft[1]), Number(c.lowerRight[1]));
    if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
    const transform = Array.isArray(info?.geoTransform) ? info.geoTransform.map(Number) : [];
    const pixelAreaM2 = transform.length >= 6
      ? Math.abs(transform[1] * transform[5] - transform[2] * transform[4])
      : undefined;
    return {
      te: [minX, minY, maxX, maxY],
      ts: [Number(size[0]), Number(size[1])],
      pixelAreaM2: Number.isFinite(pixelAreaM2) && Number(pixelAreaM2) > 0 ? Number(pixelAreaM2) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Calcula o NDVI em Float32.
 *
 * A expressão converte DN → reflectância ANTES de dividir. Ver `ndvi-math.ts`: o offset
 * do produto C2 L2 não cancela na razão, e ignorá-lo produz número errado com cara de
 * certo.
 */
export async function computeNdvi(
  args: RunArgs & {
    nirPath: string;
    redPath: string;
    qaPath?: string | null;
    outPath: string;
    platform: string;
    basePercent: number;
    spanPercent: number;
  },
): Promise<void> {
  const comQa = Boolean(args.qaPath && fs.existsSync(args.qaPath));
  const expressao = buildGdalCalcExpression({
    qaMask: qaMaskForPlatform(args.platform),
    comQa,
  });
  const entradaQa = comQa ? ["-C", args.qaPath as string, "--C_band=1"] : [];
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdal_calc.py",
    commandArgs: [
      "-A", args.nirPath, "--A_band=1",
      "-B", args.redPath, "--B_band=1",
      ...entradaQa,
      "--outfile", args.outPath,
      "--type", "Float32",
      "--NoDataValue", String(NDVI_NODATA),
      "--co", "COMPRESS=LZW",
      "--co", "TILED=YES",
      "--co", "BIGTIFF=IF_SAFER",
      "--quiet",
      "--calc", expressao,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent,
    stage: "ndvi",
    message: "Calculando NDVI a partir da reflectância de superfície.",
    onProgress: args.onProgress,
  });
}

export type BandStats = {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  validPercent: number | null;
};

/** Estatísticas de banda a partir do `gdalinfo -json -stats`. */
export function bandStatsFromGdalInfoJson(info: any): BandStats | null {
  const band = Array.isArray(info?.bands) ? info.bands[0] : null;
  if (!band) return null;
  const min = Number(band.minimum);
  const max = Number(band.maximum);
  const mean = Number(band.mean);
  const stdDev = Number(band.stdDev);
  if (![min, max, mean, stdDev].every(Number.isFinite)) return null;
  const metaRaiz = band.metadata?.[""] ?? band.metadata ?? {};
  const bruto = metaRaiz.STATISTICS_VALID_PERCENT;
  const validPercent = bruto === undefined ? null : Number(bruto);
  return {
    min,
    max,
    mean,
    stdDev,
    validPercent: Number.isFinite(validPercent as number) ? (validPercent as number) : null,
  };
}

/**
 * Lê estatísticas reais (`-stats`, não `-approx_stats`).
 *
 * ⚠️ O CBERS usa `-approx_stats` porque lá o número só alimenta realce visual. Aqui a
 * média **é o produto** — subamostrar mudaria o valor que vai para o laudo.
 * `GDAL_PAM_ENABLED=NO` evita sujar o diretório com `.aux.xml`.
 */
export async function readBandStats(rasterPath: string, jobId: string): Promise<BandStats | null> {
  const saida = await runCommandCapture(
    "gdalinfo",
    ["-json", "-stats", "--config", "GDAL_PAM_ENABLED", "NO", rasterPath],
    jobId,
  );
  try {
    return bandStatsFromGdalInfoJson(JSON.parse(saida));
  } catch {
    return null;
  }
}

/** Sanidade obrigatória: NDVI fora de [-1, 1] denuncia erro de escala/offset. */
export function assertNdviRange(stats: BandStats | null): void {
  if (!stats) throw new Error("Não foi possível ler as estatísticas do NDVI gerado.");
  const folga = 1e-6;
  if (stats.min < -1 - folga || stats.max > 1 + folga) {
    throw new Error(
      `NDVI fora da faixa [-1, 1] (min ${stats.min}, max ${stats.max}). ` +
        "Provável erro na conversão DN → reflectância (ver backend/ndvi/ndvi-math.ts).",
    );
  }
}

/** Aplica a rampa de cor. `-alpha` deixa o nodata transparente no WMS e no Word. */
export async function colorRelief(
  args: RunArgs & { ndviPath: string; outPath: string; basePercent: number; spanPercent: number },
): Promise<void> {
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
      args.ndviPath,
      NDVI_COLOR_RAMP_PATH,
      args.outPath,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent,
    stage: "palette",
    message: "Aplicando a rampa de cor do NDVI.",
    onProgress: args.onProgress,
  });
}

/**
 * Overviews.
 *
 * ⚠️ No Float32 com nodata -9999, `average` mistura nodata com dado válido e inventa
 * valor no zoom-out. Por isso o dado usa `nearest` e só o RGB usa `average`.
 */
export async function buildOverviews(
  args: RunArgs & { rasterPath: string; kind: "data" | "rgb"; basePercent: number; spanPercent: number },
): Promise<void> {
  const grid = await readGrid(args.rasterPath, args.jobId);
  const maiorLado = grid ? Math.max(grid.ts[0], grid.ts[1]) : 0;
  if (maiorLado > 0 && maiorLado < NDVI_OVERVIEW_MIN_PIXELS) return; // pequeno demais
  const resampling =
    args.kind === "data" ? NDVI_OVERVIEW_RESAMPLING_DATA : NDVI_OVERVIEW_RESAMPLING_RGB;
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdaladdo",
    commandArgs: [
      "-ro",
      "-r", resampling,
      "--config", "COMPRESS_OVERVIEW", "LZW",
      "--config", "INTERLEAVE_OVERVIEW", "PIXEL",
      "--config", "BIGTIFF_OVERVIEW", "IF_SAFER",
      args.rasterPath,
      ...NDVI_OVERVIEW_LEVELS,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent,
    stage: "overview",
    message: "Gerando overviews.",
    onProgress: args.onProgress,
  });
}

/** PNG para as figuras do laudo — local, sem depender do GeoServer. */
export async function rgbToPng(
  args: RunArgs & { rgbPath: string; outPath: string; width?: number },
): Promise<void> {
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdal_translate",
    commandArgs: [
      "-of", "PNG",
      "-outsize", String(args.width || 1400), "0",
      "-co", "WORLDFILE=NO",
      args.rgbPath,
      args.outPath,
    ],
    basePercent: 0,
    spanPercent: 0,
    stage: "figure",
    message: "Gerando figura do NDVI.",
    onProgress: args.onProgress,
  });
}

/** GeoJSON do cutline num arquivo temporário. */
export function writeCutline(tmpDir: string, nome: string, geometry: unknown): string {
  const destino = path.join(tmpDir, `${nome}.geojson`);
  const fc = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  };
  fs.writeFileSync(destino, JSON.stringify(fc), "utf8");
  return destino;
}
