/**
 * SSE/persistência do job de Processar Projeto.
 */
import type { Request, Response } from "express";
import { stripUndefinedDeep, writeDocBySegments } from "../local-storage";

export const subscribers = new Map<string, Set<Response>>();

export function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    /* gone */
  }
}

export function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) {
    if (!res.writableEnded) res.end();
  }
  subscribers.delete(jobId);
}

export function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "processar_projeto_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

export function sendLocalProcessingGone(req: Request, res: Response): void {
  const uid = String((req as any).authUid || "").trim();
  if (!uid) {
    res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
    return;
  }
  res.status(410).json({
    error: "O fluxo local de Importar/Processar foi removido; o veredito agora vem do SIMCAR real.",
    code: "LOCAL_PROCESSING_REMOVED",
    hint: "Use POST /api/simcar-oraculo/pipeline.",
  });
}

/* ─────────────────────── routes ─────────────────────── */
