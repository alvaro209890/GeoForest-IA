/**
 * Progresso do job CBERS via SSE + persistência.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`). O que é
 * próprio do CBERS fica aqui: o default de `status` no `progress` e o
 * `throwIfCancelled` com a exceção do módulo.
 */
import { createSseHub } from "../lib/sse";
import { isCancelRequested } from "../processing-jobs";
import { CbersCancelError, CbersProgressPatch } from "./types";
import { clampPercent } from "./utils";

const hub = createSseHub<CbersProgressPatch>({ collection: "cbers_wpm_jobs" });

export const eventSubscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeJobSubscribers = hub.closeSubscribers;
export const persistCbersJob = hub.persistJob;

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
