import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (req: any, res: any) => Promise<void> | void;

let storageRoot = "";
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
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-store-routes-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  const store = await import("./store");
  const account = await import("./account");
  const app: any = {};
  for (const method of ["get", "put", "delete", "patch", "post"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  store.registerStoreRoutes(app);
  account.registerAccountRoutes(app);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("/api/store — erro descritivo em vez de request pendurado", () => {
  it("PUT em coleção fora da whitelist responde 400 dizendo qual coleção", async () => {
    const res = fakeRes();
    await handlers.get("put /api/store/doc")!(
      { authUid: "u1", query: { path: "users/u1/colecao_inexistente/doc1" }, body: { data: { a: 1 } } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("INVALID_DOC_PATH");
    expect(res.body.error).toContain("colecao_inexistente");
  });

  it("PUT válido continua gravando e o GET lê de volta", async () => {
    const put = fakeRes();
    await handlers.get("put /api/store/doc")!(
      { authUid: "u1", query: { path: "users/u1/croqui_jobs/j1" }, body: { data: { status: "ok" } } },
      put,
    );
    expect(put.statusCode).toBe(200);
    expect(put.body.ok).toBe(true);

    const get = fakeRes();
    await handlers.get("get /api/store/doc")!({ authUid: "u1", query: { path: "users/u1/croqui_jobs/j1" } }, get);
    expect(get.body.exists).toBe(true);
    expect(get.body.data.status).toBe("ok");
  });

  it("falha de disco vira 500 com a causa, não exceção solta", async () => {
    const userDir = path.join(storageRoot, "users", "u2");
    fs.mkdirSync(userDir, { recursive: true });
    // `croqui_jobs` como ARQUIVO: gravar o doc dentro dele falha com ENOTDIR.
    fs.writeFileSync(path.join(userDir, "croqui_jobs"), "não sou diretório");
    const res = fakeRes();
    await handlers.get("put /api/store/doc")!(
      { authUid: "u2", query: { path: "users/u2/croqui_jobs/j1" }, body: { data: { a: 1 } } },
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe("STORE_IO_ERROR");
    expect(res.body.error).toMatch(/ENOTDIR|EEXIST/);
  });

  it("isolamento por usuário continua valendo", async () => {
    const res = fakeRes();
    await handlers.get("get /api/store/collection")!({ authUid: "u1", query: { path: "users/outro/croqui_jobs" } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /api/me", () => {
  it("sem uid responde 401 em vez de gravar em users/", async () => {
    const res = fakeRes();
    await handlers.get("patch /api/me")!({ authUid: "", body: { nome: "x" } }, res);
    expect(res.statusCode).toBe(401);
    expect(fs.existsSync(path.join(storageRoot, "users", "profile.json"))).toBe(false);
  });

  it("com uid grava o perfil", async () => {
    const res = fakeRes();
    await handlers.get("patch /api/me")!({ authUid: "u3", body: { nome: "Fulano" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).toBe("u3");
    expect(res.body.nome).toBe("Fulano");
  });
});
