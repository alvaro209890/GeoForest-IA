import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Fluxo oráculo desativado para sempre (05/08/2026). Mesmo com SIMCAR_CPF/SENHA
 * configurados no servidor, nenhuma rota pode chegar a logar no SIMCAR.
 */
type Handler = (req: any, res: any) => Promise<void>;

const loginSpy = vi.fn();
vi.mock("./client", async (importOriginal) => {
  const real = await importOriginal<typeof import("./client")>();
  return {
    ...real,
    withSimcarAuthRetry: (...args: unknown[]) => {
      loginSpy(...args);
      throw new Error("NÃO DEVIA LOGAR NO SIMCAR");
    },
  };
});

let storageRoot = "";
const handlers = new Map<string, Handler>();

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined as any, headersSent: false };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  res.setHeader = () => res;
  res.write = () => true;
  res.end = () => res;
  return res;
}

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-oraculo-off-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  process.env.SIMCAR_CPF = "11122233344";
  process.env.SIMCAR_SENHA = "senha-de-teste";
  vi.resetModules();
  const routes = await import("./routes");
  const app: any = {};
  for (const method of ["get", "post", "delete"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  routes.registerSimcarOraculoRoutes(app);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  delete process.env.SIMCAR_CPF;
  delete process.env.SIMCAR_SENHA;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("rotas do oráculo SIMCAR desativadas", () => {
  const bloqueadas = [
    "get /api/simcar-oraculo/test-project",
    "get /api/simcar-oraculo/municipios",
    "post /api/simcar-oraculo/pipeline",
    "post /api/simcar-oraculo/importar",
    "post /api/simcar-oraculo/processar",
  ];

  for (const key of bloqueadas) {
    it(`${key} responde 410 sem tocar no SIMCAR`, async () => {
      const handler = handlers.get(key);
      expect(handler, `rota ${key} não registrada`).toBeTruthy();
      const res = fakeRes();
      await handler!({ authUid: "uid-1", body: { uploadId: "qualquer" }, query: {}, params: {} }, res);
      expect(res.statusCode).toBe(410);
      expect(res.body.code).toBe("SIMCAR_ORACULO_DESATIVADO");
      expect(res.body.error).toMatch(/desativado/i);
    });
  }

  it("não houve nenhuma tentativa de login", () => {
    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("sem token continua 401 antes do 410", async () => {
    const res = fakeRes();
    await handlers.get("post /api/simcar-oraculo/pipeline")!({ authUid: "", body: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("health (só leitura de config) continua respondendo", async () => {
    const res = fakeRes();
    await handlers.get("get /api/simcar-oraculo/health")!({ authUid: "uid-1" }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
