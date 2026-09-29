import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (req: any, res: any) => Promise<void> | void;

let storageRoot = "";
let storage: typeof import("../local-storage");
const handlers = new Map<string, Handler>();

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-landsat-delete-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("../local-storage");
  const routes = await import("./routes");
  const app: any = {};
  for (const method of ["get", "head", "post", "put", "delete", "patch", "use"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  routes.registerLandsatRoutes(app);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("removeStoragePath com URL que não é do storage local", () => {
  it("ignora /api/landsat/wms-download?... em vez de lançar INVALID_STORAGE_PATH", () => {
    expect(() => storage.removeStoragePath("/api/landsat/wms-download?layerName=cbers%3Alandsat_x")).not.toThrow();
    expect(() => storage.removeStoragePath("/api/cbers-wpm/wms-download?imageId=abc")).not.toThrow();
  });
});

describe("DELETE /api/landsat/jobs/:jobId", () => {
  it("responde e apaga o card quando o job só tem outputUrl do WMS (caso de todo job Landsat)", async () => {
    const segments = ["users", "u1", "landsat_jobs", "job-wms"];
    storage.writeDocBySegments(segments, {
      status: "completed",
      outputUrl: "/api/landsat/wms-download?layerName=cbers%3Alandsat_224_068_2008",
    });
    const res = fakeRes();
    // Antes: a promessa rejeitava com INVALID_STORAGE_PATH, o Express 4 não respondia
    // (requestTimeout=0 no server) e o card nunca saía do histórico.
    await handlers.get("delete /api/landsat/jobs/:jobId")!({ authUid: "u1", params: { jobId: "job-wms" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(storage.readDocBySegments(segments)).toBeNull();
  });
});
