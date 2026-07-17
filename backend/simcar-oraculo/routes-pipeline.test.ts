import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OraculoEvent } from "./types";

let storageRoot = "";
let routes: typeof import("./routes");
let store: typeof import("./job-store");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-simcar-sse-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  routes = await import("./routes");
  store = await import("./job-store");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

function registerSseHandler(): (req: any, res: any) => Promise<void> {
  let handler: ((req: any, res: any) => Promise<void>) | null = null;
  const app = {
    get(pathname: string, candidate: (req: any, res: any) => Promise<void>) {
      if (pathname === "/api/simcar-oraculo/jobs/:jobId/events") handler = candidate;
    },
    post() {},
    delete() {},
  };
  routes.registerSimcarOraculoRoutes(app as any);
  if (!handler) throw new Error("Rota SSE não registrada.");
  return handler;
}

function fakeExchange(uid: string, jobId: string): {
  req: EventEmitter & Record<string, any>;
  res: Record<string, any>;
  chunks: string[];
} {
  const req = Object.assign(new EventEmitter(), {
    authUid: uid,
    params: { jobId },
  });
  const chunks: string[] = [];
  const headers = new Map<string, string>();
  const res: Record<string, any> = {
    writableEnded: false,
    destroyed: false,
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    flushHeaders() {},
    write(chunk: string) {
      chunks.push(String(chunk));
      return true;
    },
    end() {
      res.writableEnded = true;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      chunks.push(JSON.stringify(payload));
      res.writableEnded = true;
      return res;
    },
    headers,
  };
  return { req, res, chunks };
}

describe("SSE do pipeline SIMCAR", () => {
  it("envia snapshot, propaga evento ao vivo e encerra no snapshot terminal", async () => {
    const handler = registerSseHandler();
    store.persistOraculoJob("uid-sse", "job-sse", {
      status: "running",
      round: 1,
      timeline: [],
    });
    const { req, res, chunks } = fakeExchange("uid-sse", "job-sse");

    await handler(req, res);

    expect(chunks.join("\n")).toContain('"type":"snapshot"');
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const event: OraculoEvent = {
      ts: "2026-07-16T12:00:00.000Z",
      round: 1,
      step: "import_poll",
      message: "Aguardando SEMA",
      percent: 50,
    };
    routes.publishOraculoPipelineNotification({
      type: "event",
      jobId: "job-sse",
      event,
      job: { status: "running" },
    });
    expect(chunks.join("\n")).toContain('"step":"import_poll"');

    routes.publishOraculoPipelineNotification({
      type: "snapshot",
      jobId: "job-sse",
      job: { status: "completed" },
    });
    expect(res.writableEnded).toBe(true);
    req.emit("close");
  });

  it("devolve o snapshot persistido e fecha imediatamente para job terminal", async () => {
    const handler = registerSseHandler();
    store.persistOraculoJob("uid-sse", "job-terminal", {
      status: "completed",
      timeline: [{ step: "done", message: "fim", round: 1, ts: "agora" }],
    });
    const { req, res, chunks } = fakeExchange("uid-sse", "job-terminal");

    await handler(req, res);

    expect(chunks.join("\n")).toContain('"status":"completed"');
    expect(res.writableEnded).toBe(true);
    req.emit("close");
  });

  it("não permite assinar job de outro usuário", async () => {
    const handler = registerSseHandler();
    store.persistOraculoJob("uid-dono", "job-privado", {
      status: "running",
      timeline: [],
    });
    const { req, res, chunks } = fakeExchange("uid-intruso", "job-privado");

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(chunks.join("\n")).toContain("Job oráculo não encontrado");
    expect(res.headers.has("content-type")).toBe(false);
  });
});
