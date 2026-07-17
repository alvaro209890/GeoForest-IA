import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type RouteHandler = (req: Record<string, any>, res: Record<string, any>) => unknown;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let storageRoot = "";
let postHandlers = new Map<string, RouteHandler>();
let storage: typeof import("./local-storage");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-processar-routes-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  const routes = await import("./processar-projeto");
  storage = await import("./local-storage");
  postHandlers = new Map();
  routes.registerProcessarProjetoRoutes({
    post(pathname: string, handler: RouteHandler) {
      postHandlers.set(pathname, handler);
    },
    get() {},
    delete() {},
  } as any);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

function handler(pathname: string): RouteHandler {
  const found = postHandlers.get(pathname);
  if (!found) throw new Error(`Rota POST não registrada: ${pathname}`);
  return found;
}

function exchange(body: Record<string, unknown> = {}, authUid = "uid-routes") {
  const req = { authUid, body, params: {} };
  const res: Record<string, any> = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.payload = payload;
      return res;
    },
  };
  return { req, res };
}

describe("migração das rotas locais de Processar projeto", () => {
  it.each([
    "/api/processar-projeto/importar",
    "/api/processar-projeto/processar",
  ])("responde 410 em %s e aponta para o pipeline real", async (pathname) => {
    const { req, res } = exchange({ uploadId: "legado" });

    await handler(pathname)(req, res);

    expect(res.statusCode).toBe(410);
    expect(res.payload).toMatchObject({
      code: "LOCAL_PROCESSING_REMOVED",
      hint: "Use POST /api/simcar-oraculo/pipeline.",
    });
  });

  it("mantém os endpoints mortos protegidos por autenticação", async () => {
    const { req, res } = exchange({}, "");

    await handler("/api/processar-projeto/importar")(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("mantém o upload/preview disponível para o Oráculo", async () => {
    const fixture = path.join(
      moduleDir,
      "fixtures",
      "teste_1",
      "Recorte_SANTA_CLARA_FINAL_16-07-26.zip",
    );
    const zip = fs.readFileSync(fixture);
    const { req, res } = exchange({
      filename: path.basename(fixture),
      zipBase64: zip.toString("base64"),
    });

    await handler("/api/processar-projeto/upload")(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload?.ok).toBe(true);
    expect(res.payload?.uploadId).toBeTruthy();
    expect(res.payload?.layers?.length).toBeGreaterThan(0);
    expect(res.payload?.shapePreview?.municipioDetectado?.nome).toMatch(/^querência$/i);
    expect(res.payload?.shapePreview?.municipioDetectado?.ibge).toBe("5107065");
    expect(
      storage.readDocBySegments([
        "users",
        "uid-routes",
        "processar_projeto_jobs",
        String(res.payload.uploadId),
      ]),
    ).toMatchObject({ status: "uploaded" });
  });
});
