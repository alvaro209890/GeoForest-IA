/**
 * Progresso do job Landsat via SSE + persistência.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`). O Landsat tem
 * persistência própria (preserva `timestamp`/`createdAt` do doc anterior) e
 * serializa o evento com `stripUndefinedDeep`.
 */
import { createSseHub } from "../lib/sse";
import { readDocBySegments, stripUndefinedDeep, writeDocBySegments } from "../local-storage";
import { LandsatProgressPatch } from "./types";

const hub = createSseHub({ collection: "landsat_jobs", serialize: stripUndefinedDeep });

export const eventSubscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeJobSubscribers = hub.closeSubscribers;

export function persistLandsatJob(uid: string, jobId: string, patch: LandsatProgressPatch & Record<string, unknown>): void {
  const now = new Date().toISOString();
  const current = readDocBySegments(["users", uid, "landsat_jobs", jobId]) || {};
  const next = stripUndefinedDeep({
    ...current,
    ...patch,
    jobId,
    updatedAt: now,
    updatedAtMs: Date.now(),
    timestamp: current.timestamp || current.createdAt || now,
  });
  writeDocBySegments(["users", uid, "landsat_jobs", jobId], next, { merge: true });
}

export function progress(uid: string, jobId: string, patch: LandsatProgressPatch): void {
  const current = readDocBySegments(["users", uid, "landsat_jobs", jobId]) || {};
  const next = { ...current, ...patch };
  persistLandsatJob(uid, jobId, next);
  emitJobEvent(jobId, { type: "progress", jobId, ...next });
}
