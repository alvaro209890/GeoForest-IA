import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerOcupacaoSimcar, lerOcupacaoSimcarCached, limparCacheMonitor } from "./monitor";

const AGORA = Date.now();

function clients(entradas: Record<string, Record<string, unknown>> | null) {
  return entradas;
}

/** RTDB falso: devolve o que o teste mandar para cada nó. */
function stubRtdb(respostas: { clients?: unknown; current?: unknown }, ok = true) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    const corpo = url.includes("clients.json") ? respostas.clients ?? null : respostas.current ?? null;
    if (!ok) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify(corpo), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  limparCacheMonitor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("lerOcupacaoSimcar", () => {
  it("client com heartbeat recente → EM USO, com o nome do mais recente", async () => {
    stubRtdb({
      clients: clients({
        uidA: { c1: { who: "Bruno", since: AGORA - 300_000, lastSeen: AGORA - 5_000 } },
        uidB: { c2: { who: "Alvaro", since: AGORA - 60_000, lastSeen: AGORA - 1_000 } },
      }),
    });

    const status = await lerOcupacaoSimcar();

    expect(status.ocupado).toBe(true);
    expect(status.por).toBe("Alvaro"); // lastSeen mais recente, como o site faz
    expect(status.conexoes).toBe(2);
    expect(status.erro).toBeUndefined();
  });

  it("fantasmas (lastSeen velho) não contam como ocupado", async () => {
    stubRtdb({
      clients: clients({
        uidA: { c1: { who: "Bruno", lastSeen: AGORA - 49 * 24 * 3600_000 } },
        uidB: { c2: { who: "anônimo", lastSeen: AGORA - 120_000 } },
      }),
    });

    const status = await lerOcupacaoSimcar();

    expect(status.ocupado).toBe(false);
    expect(status.conexoes).toBe(0);
  });

  it("clients null → LIVRE", async () => {
    stubRtdb({ clients: null, current: null });
    await expect(lerOcupacaoSimcar()).resolves.toMatchObject({ ocupado: false, conexoes: 0 });
  });

  it("cai no nó legado `current` quando clients está vazio", async () => {
    stubRtdb({
      clients: null,
      current: { status: "online", who: "Bruno", lastSeen: AGORA - 3_000 },
    });

    const status = await lerOcupacaoSimcar();

    expect(status).toMatchObject({ ocupado: true, por: "Bruno", conexoes: 1 });
  });

  it("`current` antigo não segura o download", async () => {
    stubRtdb({ clients: null, current: { status: "online", who: "Bruno", lastSeen: AGORA - 600_000 } });
    await expect(lerOcupacaoSimcar()).resolves.toMatchObject({ ocupado: false });
  });

  it("monitor fora do ar → fail-open (livre + erro registrado)", async () => {
    stubRtdb({}, false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const status = await lerOcupacaoSimcar();

    expect(status.ocupado).toBe(false);
    expect(status.erro).toMatch(/500|monitor/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("respeita SIMCAR_MONITOR_STALE_MS", async () => {
    vi.stubEnv("SIMCAR_MONITOR_STALE_MS", "1000");
    stubRtdb({ clients: clients({ uidA: { c1: { who: "Bruno", lastSeen: AGORA - 30_000 } } }), current: null });

    // 30s > 1s + 10s de margem → considerado fantasma.
    await expect(lerOcupacaoSimcar()).resolves.toMatchObject({ ocupado: false });
  });
});

describe("lerOcupacaoSimcarCached", () => {
  it("segura o resultado por ~5s (não martela o RTDB)", async () => {
    const fetchMock = stubRtdb({ clients: null, current: null });

    await lerOcupacaoSimcarCached();
    await lerOcupacaoSimcarCached();
    await lerOcupacaoSimcarCached();

    // 1 leitura de clients + 1 de current, e nada além disso.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("R2 — o GeoForest é invisível no monitor", () => {
  it("o módulo não tem nenhuma escrita no RTDB de presença", () => {
    const arquivo = path.join(path.dirname(fileURLToPath(import.meta.url)), "monitor.ts");
    const codigo = fs.readFileSync(arquivo, "utf8");
    // Só o comentário do cabeçalho pode citar escrita; o código, nunca.
    const semComentarios = codigo
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(semComentarios).not.toMatch(/method:\s*["'](PUT|PATCH|POST|DELETE)["']/i);
    expect(semComentarios).toMatch(/method:\s*["']GET["']/);
    expect(semComentarios).not.toMatch(/\.(set|update|remove|push)\s*\(/);
  });
});
