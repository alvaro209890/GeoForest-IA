/**
 * Progresso do job CBERS via SSE + persistência.
 */
import type { Response } from "express";
import { stripUndefinedDeep, writeDocBySegments } from "../local-storage";
import { isCancelRequested } from "../processing-jobs";
import { CbersCancelError, CbersProgressPatch } from "./types";
import { clampPercent } from "./utils";

export const eventSubscribers = new Map<string, Set<Response>>();

export function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // Connection is gone.
  }
}

export function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const subscribers = eventSubscribers.get(jobId);
  if (!subscribers) return;
  for (const res of subscribers) writeSse(res, data);
}

export function closeJobSubscribers(jobId: string): void {
  const subscribers = eventSubscribers.get(jobId);
  if (!subscribers) return;
  for (const res of subscribers) {
    if (!res.writableEnded) res.end();
  }
  eventSubscribers.delete(jobId);
}

export function persistCbersJob(uid: string, jobId: string, patch: CbersProgressPatch & Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "cbers_wpm_jobs", jobId],
    stripUndefinedDeep({
      jobId,
      ...patch,
      updatedAtMs: Date.now(),
    }),
    { merge: true },
  );
}

export function progress(uid: string, jobId: string, patch: CbersProgressPatch): void {
  const next = {
    status: patch.status || "processing",
    percent: typeof patch.percent === "number" ? clampPercent(patch.percent) : undefined,
    ...patch,
  };
  persistCbersJob(uid, jobId, next);
  emitJobEvent(jobId, { type: "progress", jobId, ...next });
}

export function throwIfCancelled(jobId: string): void {
  if (isCancelRequested(jobId)) throw new CbersCancelError();
}
