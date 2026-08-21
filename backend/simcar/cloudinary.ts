/**
 * Cloudinary/local-storage helpers for SIMCAR analysis images.
 * Extraído de simcar-clip.ts (Plano 02, Fase 2).
 */

import sharp from "sharp";
import { removeStoragePath, saveUserBuffer } from "../local-storage";
import { PUBLIC_API_BASE_URL } from "./constants";
import type { AiImage } from "./types";

export type { AiImage };

/**
 * Compress image for AI vision analysis (base64 fallback path, used when Cloudinary is unavailable).
 * Downscales to max 1024×768 and encodes as JPEG at quality 80 with metadata stripped.
 * Keeps enough detail for vegetation/land-use classification while minimising token cost.
 */
export async function compressForVision(dataUrl: string): Promise<string> {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    const compressed = await sharp(buf)
        .resize(1024, 768, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}

/** Local storage helpers replacing Cloudinary persistence. */
export async function uploadToCloudinary(dataUrl: string, filename: string, uid = "anonymous"): Promise<string> {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    return saveUserBuffer({
        uid,
        area: "simcar/analysis",
        filename: `${Date.now()}_${filename}`,
        buffer,
    }).publicUrl;
}

/**
 * Returns a Cloudinary URL with on-the-fly transformations optimized for AI vision APIs.
 * Resizes to max 1024×768, converts to JPEG at quality 80, strips metadata.
 * This reduces image token consumption by ~70–80% vs. sending the full-res PNG,
 * while preserving enough detail for land-use / vegetation classification.
 * The original full-resolution URL is kept intact for user display.
 */
export function getCloudinaryAiUrl(url: string): string {
    if (url.startsWith("/")) {
        return `${PUBLIC_API_BASE_URL}${url}`;
    }
    return url;
}

export async function deleteFromCloudinary(secureUrl: string, resourceType: "image" | "raw" = "image"): Promise<void> {
    void resourceType;
    removeStoragePath(secureUrl);
}

export async function uploadRawBufferToCloudinary(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    uid = "anonymous",
): Promise<string> {
    void mimeType;
    const area = filename.toLowerCase().endsWith(".json") ? "simcar/context" : "simcar/output";
    return saveUserBuffer({
        uid,
        area,
        filename: `${Date.now()}_${filename}`,
        buffer,
    }).publicUrl;
}

export async function uploadBufferToCloudinary(buffer: Buffer, filename: string, uid = "anonymous"): Promise<string> {
    const storedFilename = filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`;
    return saveUserBuffer({
        uid,
        area: storedFilename.includes("input") ? "simcar/input" : "simcar/output",
        filename: `${Date.now()}_${storedFilename}`,
        buffer,
    }).publicUrl;
}

/**
 * Build content parts for vision API from images.
 * Uses Cloudinary URLs when available, otherwise compressed base64.
 */
export function buildVisionContentParts(images: AiImage[], prompt: string): any[] {
    const contentParts: any[] = [
        { type: "text", text: prompt },
    ];
    for (const img of images) {
        const imageUrl = img.url || img.dataUrl;
        if (!imageUrl) continue;
        contentParts.push({
            type: "image_url",
            image_url: { url: imageUrl },
        });
        contentParts.push({ type: "text", text: `[Legenda: ${img.caption}]` });
    }
    return contentParts;
}

/**
 * Conjunto reduzido para o retry quando o payload estoura.
 *
 * Historicamente bastava filtrar por "Visão Geral", porque cada satélite gerava
 * 3 vistas. Desde o commit `0e429b3b` cada satélite gera **um único composite**,
 * já rotulado "Visão Geral" — o filtro deixou de reduzir coisa alguma e o retry
 * remandava exatamente o mesmo payload. Com a janela AC/AVN contígua de 2003 a
 * 2008 (7 cenas) isso passou a importar.
 *
 * Quando o filtro não reduz, a lista cai para as cenas de maior peso jurídico,
 * na ordem: **SPOT 2008** (2,5 m, base da Nota Técnica 001/2017 e do marco do
 * art. 3º, IV), a cena do próprio marco (2008) e a cena de **2003** (marco do
 * pousio da IN SEMA-MT 04/2023, art. 42 §6º). O resto entra por ano decrescente,
 * porque o ano mais próximo do marco é o que decide a consolidação.
 */
export function reduceImageSet(
    images: AiImage[],
    maxImages = 3,
): AiImage[] {
    const overview = images.filter((img) => img.caption.includes("Visão Geral"));
    const pool = overview.length > 0 ? overview : images;
    if (pool.length < images.length) return pool;
    if (pool.length <= maxImages) return pool;

    const yearOf = (caption: string): number => Number(caption.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
    const weightOf = (caption: string): number => {
        if (/spot/i.test(caption)) return 0;
        if (yearOf(caption) === 2008) return 1;
        if (yearOf(caption) === 2003) return 2;
        return 3;
    };

    return [...pool]
        .sort((a, b) => {
            const byWeight = weightOf(a.caption) - weightOf(b.caption);
            if (byWeight !== 0) return byWeight;
            return yearOf(b.caption) - yearOf(a.caption);
        })
        .slice(0, maxImages);
}

export function estimateBytesFromDataUrl(dataUrl: string): number {
    const match = String(dataUrl || "").match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return 0;
    const payload = match[1].replace(/\s/g, "");
    if (!payload) return 0;
    const padding = payload.match(/=+$/)?.[0]?.length || 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function isTruncationFinishReason(reason: unknown): boolean {
    const normalized = String(reason || "").trim().toLowerCase();
    return (
        normalized === "length" ||
        normalized === "max_tokens" ||
        normalized === "max_output_tokens" ||
        normalized === "token_limit"
    );
}
