/**
 * SSE/persistência do job de sobreposição.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`) — este arquivo
 * só amarra a coleção `overlap_jobs` e reexporta a API do módulo.
 */
import { createSseHub } from "../lib/sse";

const hub = createSseHub({ collection: "overlap_jobs" });

export const subscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeSubscribers = hub.closeSubscribers;
export const persistJob = hub.persistJob;
export const progress = hub.progress;
