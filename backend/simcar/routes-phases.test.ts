/**
 * Contrato da rota `GET /api/simcar/clip/phases/:jobId` (tarefa F0.5).
 * R-01 (exige token) e R-03 (estado das fases logo após o recorte) do plano
 * `docs/planos/analise-pos-recorte/09-testes-e-validacao.md`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Geometry } from "geojson";

type RouteHandler = (req: Record<string, any>, res: Record<string, any>) => unknown;

const hydrated: { job: any; persisted: Record<string, any> | null } = { job: null, persisted: null };

vi.mock("./hydration", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./hydration");
  return {
    ...actual,
    hydrateCachedJob: vi.fn(async () => hydrated.job),
    readPersistedSimcarClip: vi.fn(() => hydrated.persisted),
    readPersistedSimcarClipForUid: vi.fn(() => hydrated.persisted),
  };
});

let getHandlers = new Map<string, RouteHandler>();

function square(x0: number, y0: number): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x0 + 1, y0],
        [x0 + 1, y0 + 1],
        [x0, y0 + 1],
        [x0, y0],
      ],
    ],
  };
}

beforeAll(async () => {
  const routes = await import("./routes");
  getHandlers = new Map();
  routes.registerSimcarClipRoutes({
    get(pathname: string, handler: RouteHandler) {
      getHandlers.set(pathname, handler);
    },
    post() {},
    delete() {},
  } as any);
}, 120_000);

async function callPhases(jobId: string, authUid = "uid-1") {
  const handler = getHandlers.get("/api/simcar/clip/phases/:jobId");
  if (!handler) throw new Error("Rota GET /api/simcar/clip/phases/:jobId não registrada");
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
  await handler({ params: { jobId }, query: {}, authUid }, res);
  return res;
}

describe("GET /api/simcar/clip/phases/:jobId", () => {
  it("R-01: o path está na allowlist de auth, então nenhuma chamada sem token chega ao handler", async () => {
    const { requiresAuth } = await import("../auth-required-paths");
    expect(requiresAuth("/api/simcar/clip/phases/job-1")).toBe(true);
    expect(requiresAuth("/api/simcar/clip/analyze-auas")).toBe(true);
  });

  it("R-03: logo após o recorte devolve Fase 1 disponível e as outras bloqueadas", async () => {
    hydrated.persisted = {};
    hydrated.job = {
      clippedGeometries: new Map<string, Geometry[]>([
        ["AUAS", [square(0, 0), square(2, 2)]],
        ["AREA_CONSOLIDADA", [square(4, 4)]],
      ]),
    };
    const res = await callPhases("job-1");
    expect(res.statusCode).toBe(200);
    expect(res.payload.jobId).toBe("job-1");
    expect(res.payload.layers).toEqual({ auasPolygonCount: 2, acPolygonCount: 1 });
    expect(res.payload.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(res.payload.phases.POS_2008.state).toBe("BLOCKED");
    expect(res.payload.phases.AC_VEG.state).toBe("BLOCKED");
  });

  it("reflete o laudo já persistido da Fase 1 sem devolver o laudo inteiro", async () => {
    hydrated.persisted = {
      auasMeta: {
        schemaVersion: 2,
        rulesVersion: "auas-pre2008-v1",
        status: "ALERTA_PRE_2008",
        pre2008Alert: true,
        completedAt: "2026-08-05T14:20:00.000Z",
        summary: { polygonCount: 2, alertCount: 1, inconclusiveCount: 0, noEvidenceCount: 1 },
        report: { markdown: "texto longo do laudo" },
        polygons: [{ polygonId: "AUAS-0001" }],
      },
    };
    hydrated.job = { clippedGeometries: new Map<string, Geometry[]>([["AUAS", [square(0, 0)]]]) };
    const res = await callPhases("job-2");
    expect(res.payload.phases.PRE_2008.state).toBe("COMPLETED");
    expect(res.payload.phases.PRE_2008.summary.alertCount).toBe(1);
    expect(JSON.stringify(res.payload)).not.toContain("texto longo do laudo");
  });

  it("job que não reidrata devolve 404 explicativo, nunca 500", async () => {
    hydrated.persisted = {};
    hydrated.job = null;
    const res = await callPhases("job-inexistente");
    expect(res.statusCode).toBe(404);
    expect(res.payload.code).toBe("JOB_NOT_FOUND");
  });

  it("jobId vazio é 400", async () => {
    const res = await callPhases("   ");
    expect(res.statusCode).toBe(400);
  });
});
