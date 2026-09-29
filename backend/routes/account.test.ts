import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Sem Firebase de verdade: o token é decidido por teste. Função simples em vez
// de vi.fn(): o spy do vitest 2 reporta como falha a promise rejeitada mesmo
// quando o handler a captura.
let verifyImpl: (token: string) => Promise<any> = async () => ({});
let verifyCalls = 0;
vi.mock("../firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: (token: string) => {
      verifyCalls += 1;
      return verifyImpl(token);
    },
  },
}));

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
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-account-routes-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  const account = await import("./account");
  const app: any = {};
  for (const method of ["get", "put", "delete", "patch", "post"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  account.registerAccountRoutes(app);
});

beforeEach(() => {
  verifyCalls = 0;
  verifyImpl = async () => ({});
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("GET /api/me", () => {
  it("sem uid responde 401 sem consultar o Firebase", async () => {
    const res = fakeRes();
    await handlers.get("get /api/me")!({ authUid: "", headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
    expect(verifyCalls).toBe(0);
  });

  it("com token válido provisiona e devolve o perfil", async () => {
    verifyImpl = async () => ({ uid: "u1", email: "fulano@exemplo.com", name: "" });
    const res = fakeRes();
    await handlers.get("get /api/me")!({ authUid: "u1", headers: { authorization: "Bearer t" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.uid).toBe("u1");
    expect(res.body.fullName).toBe("fulano");
    expect(fs.existsSync(path.join(storageRoot, "users", "u1", "profile.json"))).toBe(true);
  });

  it("falha do Firebase vira 500 descritivo, não rejeição solta", async () => {
    verifyImpl = async () => {
      throw Object.assign(new Error("token revogado"), { code: "auth/id-token-revoked" });
    };
    const res = fakeRes();
    // Antes do fix o handler rejeitava aqui (e no Express 4 a requisição ficava pendurada).
    await handlers.get("get /api/me")!({ authUid: "u1", headers: { authorization: "Bearer t" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe("PROFILE_READ_FAILED");
    expect(res.body.error).toContain("auth/id-token-revoked");
  });
});
