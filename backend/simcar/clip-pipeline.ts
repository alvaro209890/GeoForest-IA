/**
 * Clip Pipeline — SSE helpers, job cache, and pipeline utilities
 * for the SIMCAR clip processing pipeline.
 *
 * Extraído de simcar-clip.ts (Plano 02, Passo 7).
 */

import type { Response } from "express";
import { isCancelRequested } from "../processing-jobs";
import { CACHE_CLEANUP_INTERVAL, CACHE_MAX_JOBS } from "./constants";
import type { CachedJob } from "./types";

/* ─── Job Cache ─────────────────────────────────────── */

export const jobCache = new Map<string, CachedJob>();

export function pruneJobCache(): void {
    const now = Date.now();
    for (const [key, entry] of jobCache.entries()) {
        if (entry.expiresAt <= now) jobCache.delete(key);
    }
    while (jobCache.size > CACHE_MAX_JOBS) {
        const oldest = jobCache.keys().next().value as string | undefined;
        if (!oldest) break;
        jobCache.delete(oldest);
    }
}

setInterval(pruneJobCache, CACHE_CLEANUP_INTERVAL).unref();

/* ─── Client Abort ──────────────────────────────────── */

export class ClientAbortError extends Error {
    constructor(message = "Cliente desconectou durante a análise.") {
        super(message);
        this.name = "ClientAbortError";
    }
}

/* ─── SSE Connection ────────────────────────────────── */

export function isSseConnectionClosed(res: Response): boolean {
    const anyRes = res as any;
    return Boolean(
        res.writableEnded ||
        res.destroyed ||
        anyRes?.writableAborted ||
        anyRes?.socket?.destroyed,
    );
}

export function throwIfClientDisconnected(res: Response): void {
    const jobId = String((res as any).__processingJobId || "").trim();
    if (jobId && isCancelRequested(jobId)) {
        throw new ClientAbortError("Cancelamento solicitado pelo usuário.");
    }
    if (isSseConnectionClosed(res)) {
        throw new ClientAbortError("Cliente desconectou.");
    }
}

/* ─── SSE Write ─────────────────────────────────────── */

export function sendSSE(res: Response, data: Record<string, unknown>): void {
    if (isSseConnectionClosed(res)) return;
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
        return;
    }
    if (typeof (res as any).flush === "function") (res as any).flush();
}

export function startSseHeartbeat(
    res: Response,
    intervalMs = 15_000,
): ReturnType<typeof setInterval> {
    return setInterval(() => {
        if (isSseConnectionClosed(res)) return;
        try {
            res.write(": heartbeat\n\n");
            if (typeof (res as any).flush === "function") (res as any).flush();
        } catch {
            // The route finally block will close the interval.
        }
    }, intervalMs);
}

/* ─── Utilities ─────────────────────────────────────── */

export function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
