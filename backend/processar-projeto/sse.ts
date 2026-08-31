/**
 * SSE/persistência do job de Processar Projeto.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`) — aqui fica só
 * a coleção `processar_projeto_jobs` e a resposta 410 do fluxo local removido.
 */
import type { Request, Response } from "express";
import { createSseHub } from "../lib/sse";

const hub = createSseHub({ collection: "processar_projeto_jobs" });

export const subscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const closeSubscribers = hub.closeSubscribers;
export const persistJob = hub.persistJob;

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
