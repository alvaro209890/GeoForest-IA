/**
 * SSE/persistência do job de vértices próximos.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`) — este arquivo
 * só amarra a coleção `vertices_jobs` e reexporta a API do módulo.
 */
import { createSseHub } from "../lib/sse";

const hub = createSseHub({ collection: "vertices_jobs" });

export const subscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeSubscribers = hub.closeSubscribers;
export const persistVerticesJob = hub.persistJob;
export const progress = hub.progress;
