/**
 * SSE/persistência do job de fiscalização.\n * Mesmo contrato do módulo `overlap`, com coleção própria.
 *
 * Plumbing compartilhado em `backend/lib/sse.ts` (`createSseHub`) — este arquivo
 * só amarra a coleção `fiscalizacao_jobs` e reexporta a API do módulo.
 */
import { createSseHub } from "../lib/sse";

const hub = createSseHub({ collection: "fiscalizacao_jobs" });

export const subscribers = hub.subscribers;
export const writeSse = hub.writeSse;
export const emitJobEvent = hub.emitJobEvent;
export const closeSubscribers = hub.closeSubscribers;
export const persistJob = hub.persistJob;
export const progress = hub.progress;
