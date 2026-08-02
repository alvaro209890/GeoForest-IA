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
 * Downscales to max 800×600 and encodes as JPEG at quality 65 with metadata stripped.
 * Keeps enough detail for vegetation/land-use classification while minimising token cost.
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
 * Resizes to max 800×600, converts to JPEG at quality 65, strips metadata.
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
 * Reduce image set for retry: keep only overview images (1 per satellite)
 * instead of all 3 views per satellite.
 */
export function reduceImageSet(
    images: AiImage[],
): AiImage[] {
    return images.filter((img) => img.caption.includes("Visão Geral"));
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
