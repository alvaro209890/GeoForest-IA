/**
 * SSE/persistência de progresso dos jobs de geometria.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`) — este arquivo
 * só amarra a coleção `geometry_errors_jobs` e reexporta a API do módulo.
 */
import { createSseHub } from "../lib/sse";

const hub = createSseHub({ collection: "geometry_errors_jobs" });

export const subscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeSubscribers = hub.closeSubscribers;
export const persistGeometryJob = hub.persistJob;
export const progress = hub.progress;
