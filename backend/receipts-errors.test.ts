import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerSimcarReceiptRoutes } from "./simcar-receipts";
import { registerApfReceiptRoutes } from "./apf-receipts";

/** Recibos SIMCAR/APF: o 502 tem que dizer O QUE falhou (HTTP x, ECONNREFUSED…). */
type Handler = (req: any, res: any) => Promise<void>;
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
  res.setHeader = () => res;
  res.send = () => res;
  return res;
}

beforeAll(() => {
  const app: any = {};
  for (const method of ["get", "post"]) {
    app[method] = (pathname: string, handler: Handler) => handlers.set(`${method} ${pathname}`, handler);
  }
  registerSimcarReceiptRoutes(app);
  registerApfReceiptRoutes(app);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recibos SIMCAR — erro descritivo", () => {
  it("HTTP 503 do SIMCAR aparece na mensagem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const res = fakeRes();
    await handlers.get("post /api/simcar/receipts/search")!({ body: { carNumber: "MT10005/2019" } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("HTTP 503");
    expect(res.body.code).toBe("SIMCAR_PUBLICO_INDISPONIVEL");
  });

  it("falha de rede mostra o código real", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } as any });
      }),
    );
    const res = fakeRes();
    await handlers.get("post /api/simcar/receipts/search")!({ body: { carNumber: "MT10005/2019" } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("ETIMEDOUT");
  });

  it("download que não é PDF diz isso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>erro</html>", { status: 200 })));
    const res = fakeRes();
    await handlers.get("get /api/simcar/receipts/download/:id")!({ params: { id: "123" }, query: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("não é um PDF");
  });

  it("validação de entrada continua 400", async () => {
    const res = fakeRes();
    await handlers.get("post /api/simcar/receipts/search")!({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("APF — erro descritivo", () => {
  it("portal fora do ar mostra o HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const res = fakeRes();
    await handlers.get("post /api/apf/search")!({ body: { cpfCnpj: "11122233344" } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("HTTP 500");
    expect(res.body.code).toBe("APF_PORTAL_INDISPONIVEL");
  });
});
