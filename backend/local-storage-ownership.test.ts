import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (req: any, res: any) => Promise<void> | void;

let storageRoot = "";
let storage: typeof import("./local-storage");
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

function victimFile(name: string): { relativePath: string; absolutePath: string } {
  const stored = storage.saveUserBuffer({
    uid: "vitima",
    area: "croqui/output",
    filename: name,
    buffer: Buffer.from("laudo da vitima"),
  });
  return { relativePath: stored.relativePath, absolutePath: stored.absolutePath };
}

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-ownership-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("./local-storage");
  const croqui = await import("./croqui");
  const app: any = {};
  for (const method of ["get", "head", "post", "put", "delete", "patch", "use"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  croqui.registerCroquiRoutes(app);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("removeStoragePath com dono", () => {
  it("não apaga arquivo de outro usuário", () => {
    const file = victimFile("a.zip");
    expect(storage.removeStoragePath(file.relativePath, "atacante")).toBe(false);
    expect(fs.existsSync(file.absolutePath)).toBe(true);
  });

  it("não aceita ../ para sair da pasta do dono", () => {
    const file = victimFile("b.zip");
    expect(storage.removeStoragePath("users/atacante/../vitima/croqui/output/b.zip", "atacante")).toBe(false);
    expect(fs.existsSync(file.absolutePath)).toBe(true);
  });

  it("apaga o arquivo do próprio dono (inclusive por URL pública)", () => {
    const own = storage.saveUserBuffer({ uid: "dono", area: "croqui/output", filename: "c.zip", buffer: Buffer.from("x") });
    expect(storage.removeStoragePath(own.publicUrl, "dono")).toBe(true);
    expect(fs.existsSync(own.absolutePath)).toBe(false);
  });
});

describe("getAbsoluteStoragePath", () => {
  it("rejeita diretório irmão que só compartilha o prefixo do STORAGE_ROOT", () => {
    expect(() => storage.getAbsoluteStoragePath(`${storage.STORAGE_ROOT}-irmao/x.zip`)).toThrow("INVALID_STORAGE_PATH");
  });
});

describe("DELETE /api/croqui/jobs/:jobId com doc forjado via PUT /api/store/doc", () => {
  it("não apaga o arquivo de outro usuário apontado no doc", async () => {
    const file = victimFile("croqui_vitima.zip");
    // /api/store/doc deixa o usuário gravar qualquer campo nos próprios docs de job.
    storage.writeDocBySegments(["users", "atacante", "croqui_jobs", "job-forjado"], {
      status: "completed",
      outputRelativePath: file.relativePath,
      inputRelativePath: `/api/storage/${file.relativePath}`,
    });
    const res = fakeRes();
    await handlers.get("delete /api/croqui/jobs/:jobId")!(
      { authUid: "atacante", params: { jobId: "job-forjado" } },
      res,
    );
    expect(res.body).toEqual({ ok: true });
    expect(fs.existsSync(file.absolutePath)).toBe(true);
  });
});
