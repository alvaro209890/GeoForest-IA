import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerOcupacaoSimcar, limparCacheMonitor } from "./monitor";
import {
  CONN_ID_PRESENCA,
  PRESENCA_WHO,
  adquirirPresenca,
  liberarPresencaForcado,
  resetarPresencaParaTeste,
  soltarPresenca,
  usosPresenca,
} from "./presenca";

const AGORA = Date.now();

function stubRtdb() {
  const puts: Array<{ url: string; body: any }> = [];
  const deletes: string[] = [];
  const state: { clients: any } = { clients: null };

  const fetchMock = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();
    if (url.includes("clients.json") && method === "GET") {
      return new Response(JSON.stringify(state.clients), { status: 200 });
    }
    if (url.includes("current.json") && method === "GET") {
      return new Response("null", { status: 200 });
    }
    const match = url.match(/clients\/([^/]+)\/([^/.]+)\.json/);
    if (match && method === "PUT") {
      const body = JSON.parse(String(init.body || "{}"));
      puts.push({ url, body });
      const uid = match[1];
      const id = match[2];
      state.clients = state.clients || {};
      state.clients[uid] = state.clients[uid] || {};
      state.clients[uid][id] = body;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (match && method === "DELETE") {
      deletes.push(url);
      const uid = match[1];
      const id = match[2];
      if (state.clients?.[uid]) delete state.clients[uid][id];
      return new Response("null", { status: 200 });
    }
    return new Response("não esperado", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { puts, deletes, state, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("SIMCAR_PRESENCA_TEST", "1");
  vi.stubEnv("SIMCAR_MONITOR_POLL_MS", "1000");
  resetarPresencaParaTeste();
  limparCacheMonitor();
});

afterEach(async () => {
  await liberarPresencaForcado();
  resetarPresencaParaTeste();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("presença Sistema no monitor", () => {
  it("grava who=Sistema no RTDB e some no soltar", async () => {
    const { puts, deletes } = stubRtdb();

    await adquirirPresenca({ app: "GeoForest-IA", esperar: false });
    expect(usosPresenca()).toBe(1);
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(puts[0].body).toMatchObject({
      who: PRESENCA_WHO,
      kind: "sistema",
      app: "GeoForest-IA",
    });
    expect(puts[0].url).toContain(`/sistema/${CONN_ID_PRESENCA}.json`);

    await soltarPresenca();
    expect(usosPresenca()).toBe(0);
    expect(deletes.length).toBeGreaterThanOrEqual(1);
    expect(deletes[0]).toContain(`/sistema/${CONN_ID_PRESENCA}.json`);
  });

  it("refcount: duas operações compartilham uma entrada; só a última apaga", async () => {
    const { puts, deletes } = stubRtdb();

    await adquirirPresenca({ esperar: false });
    await adquirirPresenca({ esperar: false });
    expect(usosPresenca()).toBe(2);
    expect(puts).toHaveLength(1);

    await soltarPresenca();
    expect(usosPresenca()).toBe(1);
    expect(deletes).toHaveLength(0);

    await soltarPresenca();
    expect(usosPresenca()).toBe(0);
    expect(deletes).toHaveLength(1);
  });

  it("a própria presença não conta como ocupado (sem deadlock)", async () => {
    stubRtdb();
    await adquirirPresenca({ esperar: false });

    const status = await lerOcupacaoSimcar({ ignorarConnIds: [CONN_ID_PRESENCA] });
    expect(status.ocupado).toBe(false);

    const incluindoSelf = await lerOcupacaoSimcar();
    expect(incluindoSelf.ocupado).toBe(true);
    expect(incluindoSelf.por).toBe("Sistema");
  });

  it("espera o humano sair antes de gravar quando esperar=true", async () => {
    const { puts } = stubRtdb();
    const agora = Date.now();
    // Primeiro GET: Pamera viva. Demais: livre.
    let leituras = 0;
    const original = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method || "GET").toUpperCase();
        if (url.includes("clients.json") && method === "GET") {
          leituras += 1;
          if (leituras === 1) {
            return new Response(
              JSON.stringify({
                uidA: { c1: { who: "Pamera", lastSeen: agora - 1_000 } },
              }),
              { status: 200 },
            );
          }
          return new Response("null", { status: 200 });
        }
        return original(input, init as any);
      }),
    );

    await adquirirPresenca({ esperar: true });
    expect(leituras).toBeGreaterThanOrEqual(2);
    expect(puts.length).toBeGreaterThanOrEqual(1);
    expect(puts[0].body.who).toBe("Sistema");
  });
});
