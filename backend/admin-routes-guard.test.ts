/**
 * Regressão: as rotas `/api/admin/*` de armazenamento e métricas ficaram sem
 * autenticação nenhuma (o painel React nem enviava token), expondo e-mails de
 * todos os usuários, métricas do servidor e um DELETE de imagem do acervo.
 */
import { describe, expect, it, vi } from "vitest";
import { requireAdminAuth, verifyAdminPassword } from "./admin-auth";
import { registerCbersArchiveAdminRoutes } from "./cbers/archive";

type Registered = { method: string; path: string; middlewares: unknown[] };

function collectRoutes(register: (app: any) => void): Registered[] {
  const routes: Registered[] = [];
  const record = (method: string) => (path: string, ...rest: unknown[]) => {
    routes.push({ method, path, middlewares: rest.slice(0, -1) });
  };
  register({ get: record("get"), post: record("post"), put: record("put"), delete: record("delete"), use() {} });
  return routes;
}

describe("proteção das rotas /api/admin/*", () => {
  const routes = collectRoutes(registerCbersArchiveAdminRoutes);
  const adminRoutes = routes.filter((route) => route.path.startsWith("/api/admin/"));

  it("registra as rotas de admin do acervo", () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it("toda rota /api/admin/* passa por requireAdminAuth", () => {
    const desprotegidas = adminRoutes
      .filter((route) => !route.middlewares.includes(requireAdminAuth))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(desprotegidas).toEqual([]);
  });
});

describe("requireAdminAuth", () => {
  function exchange(authorization?: string) {
    const res: Record<string, any> = {
      statusCode: 200,
      payload: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.payload = payload;
        return this;
      },
    };
    const next = vi.fn();
    requireAdminAuth({ headers: authorization ? { authorization } : {} }, res, next);
    return { res, next };
  }

  it("rejeita requisição sem token", () => {
    const { res, next } = exchange();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejeita token inválido", () => {
    const { res, next } = exchange("Bearer nao-e-um-jwt");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("aceita token emitido pela senha correta", () => {
    const token = verifyAdminPassword(process.env.ADMIN_PANEL_PASSWORD || "admin12345678");
    expect(token).toBeTruthy();
    const { res, next } = exchange(`Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});
