import sharp from "sharp";

import type { SceneUsability } from "./types";

/** PNG magic bytes: 0x89 P N G */
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** JPEG magic bytes: 0xFF 0xD8 0xFF */
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function validateImageMagicBytes(buffer: Buffer): { valid: boolean; format: "png" | "jpeg" | null } {
  if (!buffer || buffer.length < 4) return { valid: false, format: null };
  if (buffer.subarray(0, 4).equals(PNG_MAGIC)) return { valid: true, format: "png" };
  if (buffer.subarray(0, 3).equals(JPEG_MAGIC)) return { valid: true, format: "jpeg" };
  return { valid: false, format: null };
}

/**
 * Analisa um buffer de imagem para detectar cobertura de nuvem/oclusão.
 * Extraído de backend/simcar-clip.ts (detectCloudCover) sem alterar a heurística
 * original: luminância, contraste, homogeneidade espacial e adjacência de sombra.
 */
export async function detectCloudCover(imageBuffer: Buffer): Promise<{
  cloudScore: number;
  isLikelyCloudy: boolean;
  brightPixelRatio: number;
  contrastScore: number;
}> {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(100, 75, { fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const totalPixels = w * h;
    const channels = info.channels;
    let brightCount = 0;
    let darkCount = 0;
    let luminanceSum = 0;
    let luminanceSqSum = 0;

    const lumGrid: number[] = new Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumGrid[i] = lum;
      luminanceSum += lum;
      luminanceSqSum += lum * lum;

      if (lum > 220) brightCount++;
      if (lum < 30) darkCount++;
    }

    const meanLum = luminanceSum / totalPixels;
    const variance = luminanceSqSum / totalPixels - meanLum * meanLum;
    const stdDev = Math.sqrt(Math.max(0, variance));

    const brightPixelRatio = brightCount / totalPixels;
    const contrastScore = Math.min(1, stdDev / 60);
    const darkPixelRatio = darkCount / totalPixels;

    let homogeneousBlockCount = 0;
    let totalBlocks = 0;
    const winSize = 5;
    for (let y = 0; y <= h - winSize; y += winSize) {
      for (let x = 0; x <= w - winSize; x += winSize) {
        let wSum = 0;
        let wSqSum = 0;
        const wPixels = winSize * winSize;
        for (let dy = 0; dy < winSize; dy++) {
          for (let dx = 0; dx < winSize; dx++) {
            const l = lumGrid[(y + dy) * w + (x + dx)];
            wSum += l;
            wSqSum += l * l;
          }
        }
        const wMean = wSum / wPixels;
        const wVar = wSqSum / wPixels - wMean * wMean;
        if (wMean > 190 && wVar < 100) homogeneousBlockCount++;
        totalBlocks++;
      }
    }
    const homogeneousRatio = totalBlocks > 0 ? homogeneousBlockCount / totalBlocks : 0;

    let shadowAdjacencyCount = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (lumGrid[idx] > 200) {
          const hasAdjacentDark =
            lumGrid[idx - 1] < 40 || lumGrid[idx + 1] < 40 || lumGrid[idx - w] < 40 || lumGrid[idx + w] < 40;
          if (hasAdjacentDark) shadowAdjacencyCount++;
        }
      }
    }
    const shadowRatio = shadowAdjacencyCount / Math.max(1, totalPixels);

    let cloudScore = 0;
    if (brightPixelRatio > 0.25) cloudScore += brightPixelRatio * 0.35;
    if (contrastScore < 0.3) cloudScore += (1 - contrastScore) * 0.25;
    if (meanLum > 180) cloudScore += ((meanLum - 180) / 75) * 0.15;
    if (homogeneousRatio > 0.15) cloudScore += homogeneousRatio * 0.15;
    if (shadowRatio > 0.005) cloudScore += Math.min(0.1, shadowRatio * 10);
    if (darkPixelRatio > 0.4) cloudScore *= 0.5;

    cloudScore = Math.min(1, Math.max(0, cloudScore));

    return {
      cloudScore: Number(cloudScore.toFixed(3)),
      isLikelyCloudy: cloudScore > 0.45,
      brightPixelRatio: Number(brightPixelRatio.toFixed(3)),
      contrastScore: Number(contrastScore.toFixed(3)),
    };
  } catch {
    return { cloudScore: 0, isLikelyCloudy: false, brightPixelRatio: 0, contrastScore: 1 };
  }
}

/** Imagem uniforme (uma única cor, típico de tile sem dado/erro do servidor WMS). */
export async function detectUniformImage(imageBuffer: Buffer): Promise<{ isUniform: boolean; stdDev: number }> {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 48, { fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const totalPixels = info.width * info.height;
    const channels = info.channels;
    let sum = 0;
    let sqSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const offset = i * channels;
      const lum = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
      sum += lum;
      sqSum += lum * lum;
    }
    const mean = sum / totalPixels;
    const variance = sqSum / totalPixels - mean * mean;
    const stdDev = Math.sqrt(Math.max(0, variance));
    return { isUniform: stdDev < 2, stdDev };
  } catch {
    return { isUniform: false, stdDev: 999 };
  }
}

/**
 * Classifica a usabilidade de uma cena para fins de evidência pré-2008.
 * Ordem de checagem: formato inválido → uniforme/sem dado → nublado/ocluído →
 * baixa resolução (fallback usado) → utilizável.
 */
export async function classifySceneUsability(
  imageBuffer: Buffer,
  opts: { usedResolutionFallback?: boolean } = {}
): Promise<{ usability: SceneUsability; qualityScore: number; qualityFlags: string[] }> {
  const magic = validateImageMagicBytes(imageBuffer);
  if (!magic.valid) {
    return { usability: "INVALID", qualityScore: 0, qualityFlags: ["invalid_image_format"] };
  }

  const uniform = await detectUniformImage(imageBuffer);
  if (uniform.isUniform) {
    return { usability: "INVALID", qualityScore: 0, qualityFlags: ["uniform_no_data"] };
  }

  const cloud = await detectCloudCover(imageBuffer);
  if (cloud.isLikelyCloudy) {
    return {
      usability: "CLOUD_OR_OCCLUSION",
      qualityScore: Number((1 - cloud.cloudScore).toFixed(3)),
      qualityFlags: ["cloud_or_occlusion"],
    };
  }

  if (opts.usedResolutionFallback) {
    return {
      usability: "LOW_RESOLUTION",
      qualityScore: Number((1 - cloud.cloudScore).toFixed(3)),
      qualityFlags: ["resolution_fallback_used"],
    };
  }

  return {
    usability: "USABLE",
    qualityScore: Number((1 - cloud.cloudScore).toFixed(3)),
    qualityFlags: [],
  };
}

/**
 * Comprime imagem para visão (fallback base64), extraído de backend/simcar-clip.ts
 * (compressForVision) sem alterar os parâmetros de downscale/qualidade.
 */
export async function compressForVision(dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  const compressed = await sharp(buf)
    .resize(800, 600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 65, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}
