/**
 * Progresso do job Landsat via SSE + persistência.
 */
import type { Response } from "express";
import { readDocBySegments, stripUndefinedDeep, writeDocBySegments } from "../local-storage";
import { LandsatProgressPatch } from "./types";

export const eventSubscribers = new Map<string, Set<Response>>();

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

export function writeSse(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(stripUndefinedDeep(payload))}\n\n`);
}

export function emitJobEvent(jobId: string, payload: unknown): void {
  const set = eventSubscribers.get(jobId);
  if (!set) return;
  for (const res of set) writeSse(res, payload);
}

export function closeJobSubscribers(jobId: string): void {
  const set = eventSubscribers.get(jobId);
  if (!set) return;
  for (const res of set) res.end();
  eventSubscribers.delete(jobId);
}

export function progress(uid: string, jobId: string, patch: LandsatProgressPatch): void {
  const current = readDocBySegments(["users", uid, "landsat_jobs", jobId]) || {};
  const next = { ...current, ...patch };
  persistLandsatJob(uid, jobId, next);
  emitJobEvent(jobId, { type: "progress", jobId, ...next });
}
