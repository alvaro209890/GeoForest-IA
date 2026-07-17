import { readDocBySegments, writeDocBySegments } from "../local-storage";
import type { OraculoProgress } from "./types";

type JobPatch = Record<string, unknown>;

function jobSegments(uid: string, jobId: string): string[] {
  return ["users", uid, "simcar_oraculo_jobs", jobId];
}

export function readOraculoJob(uid: string, jobId: string): Record<string, any> | null {
  return readDocBySegments(jobSegments(uid, jobId));
}

export function persistOraculoJob(
  uid: string,
  jobId: string,
  data: JobPatch,
): Record<string, any> {
  return writeDocBySegments(jobSegments(uid, jobId), data, { merge: true });
}

/**
 * O merge do storage é raso; portanto o evento precisa ser anexado ao array completo.
 * O patch adicional mantém status/percentual sincronizados no mesmo write atômico.
 */
export function appendOraculoTimelineEvent(
  uid: string,
  jobId: string,
  event: OraculoProgress,
  patch: JobPatch = {},
): Record<string, any> {
  const current = readOraculoJob(uid, jobId);
  const timeline = Array.isArray(current?.timeline) ? current.timeline : [];
  return persistOraculoJob(uid, jobId, {
    ...patch,
    timeline: [...timeline, event],
  });
}
