/**
 * Plumbing comum de SSE + persistência de progresso dos jobs.
 *
 * Os grupos de rota que seguem o padrão de job (croqui, containment, overlap,
 * vertices, cbers-wpm, landsat, processar-projeto, geometria, fiscalização,
 * lotes SIMCAR, solicitação) tinham a MESMA implementação de
 * `writeSse` / `emitJobEvent` / `closeSubscribers` / `persistJob` / `progress`
 * copiada arquivo a arquivo — variando só o nome da coleção onde o job é
 * persistido. Agora todos montam o hub aqui.
 *
 * O contrato público de cada módulo (`subscribers`, `writeSse`, `emitJobEvent`,
 * `closeSubscribers`, `persist<X>Job`, `progress`) continua igual: os módulos
 * só reexportam o que o hub devolve.
 */
import type { Response } from "express";
import { stripUndefinedDeep, writeDocBySegments } from "../local-storage";

/** Escreve um evento SSE ignorando conexões já encerradas. */
export function writeSse(res: Response, data: unknown): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // Conexão caiu.
  }
}

/** Fecha todas as respostas SSE inscritas em `jobId` e limpa o registro. */
export function closeSubscribersIn(
  subscribers: Map<string, Set<Response>>,
  jobId: string,
): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) {
    if (!res.writableEnded) res.end();
  }
  subscribers.delete(jobId);
}

export type SseHub<TPatch extends Record<string, any> = Record<string, unknown>> = {
  /** jobId → respostas SSE abertas. */
  subscribers: Map<string, Set<Response>>;
  writeSse: (res: Response, data: any) => void;
  emitJobEvent: (jobId: string, data: any) => void;
  closeSubscribers: (jobId: string) => void;
  /** Grava o patch em `users/<uid>/<collection>/<jobId>.json` (merge). */
  persistJob: (uid: string, jobId: string, patch: TPatch & Record<string, unknown>) => void;
  /** Persiste e emite `{ type: "progress", jobId, ...patch }`. */
  progress: (uid: string, jobId: string, patch: TPatch) => void;
};

export type SseHubOptions = {
  /** Coleção sob `users/<uid>/` onde o job é persistido. */
  collection: string;
  /** Transforma o payload antes de serializar no SSE. */
  serialize?: (data: any) => unknown;
};

export function createSseHub<TPatch extends Record<string, any> = Record<string, unknown>>(
  options: SseHubOptions,
): SseHub<TPatch> {
  const subscribers = new Map<string, Set<Response>>();
  const serialize = options.serialize;

  const write = serialize
    ? (res: Response, data: any) => writeSse(res, serialize(data))
    : writeSse;

  const emitJobEvent = (jobId: string, data: any): void => {
    const set = subscribers.get(jobId);
    if (!set) return;
    for (const res of set) write(res, data);
  };

  const persistJob = (uid: string, jobId: string, patch: Record<string, unknown>): void => {
    writeDocBySegments(
      ["users", uid, options.collection, jobId],
      stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
      { merge: true },
    );
  };

  const progress = (uid: string, jobId: string, patch: TPatch): void => {
    persistJob(uid, jobId, patch);
    emitJobEvent(jobId, { type: "progress", jobId, ...patch });
  };

  return {
    subscribers,
    writeSse: write,
    emitJobEvent,
    closeSubscribers: (jobId: string) => closeSubscribersIn(subscribers, jobId),
    persistJob: persistJob as SseHub<TPatch>["persistJob"],
    progress,
  };
}
