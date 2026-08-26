/**
 * SSE/persistência do job de fiscalização.
 * Mesmo contrato do módulo `overlap`, com coleção própria.
 */
import type { Response } from "express";
import { stripUndefinedDeep, writeDocBySegments } from "../local-storage";

export const subscribers = new Map<string, Set<Response>>();

export function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // conexão encerrada
  }
}

export function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) writeSse(r, data);
}

export function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) {
    if (!r.writableEnded) r.end();
  }
  subscribers.delete(jobId);
}

export function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "fiscalizacao_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

export function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}
