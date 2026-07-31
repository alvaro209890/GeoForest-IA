import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Geometry } from "geojson";

import {
  AuasCancelledError,
  AuasTooManyPolygonsError,
  createInMemoryCheckpointStore,
  runAuasPre2008Analysis,
} from "./orchestrator";
import { getAuasV2Config } from "./config";
import type { AuasV2Progress } from "./types";

function squarePolygon(cx: number, cy: number, size = 0.01): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [cx, cy],
        [cx + size, cy],
        [cx + size, cy + size],
        [cx, cy + size],
        [cx, cy],
      ],
    ],
  };
}

function clippedGeometries(polys: Geometry[]): Map<string, Geometry[]> {
  return new Map([["AUAS", polys]]);
}

/** WMS fake: gera imagem em xadrez (não uniforme) no tamanho pedido na URL. */
function wmsFetchImpl(): typeof fetch {
  return (async (input: any) => {
    const url = new URL(String(input));
    const width = Number(url.searchParams.get("width")) || 800;
    const height = Number(url.searchParams.get("height")) || 600;
    const channels = 3;
    const blockSize = Math.max(8, Math.round(Math.min(width, height) / 10));
    const data = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isDark = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
        const value = isDark ? 10 : 230;
        const offset = (y * width + x) * channels;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
    const buf = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
    return new Response(buf, { status: 200, headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
}

type GroqFailureRule = (polygonId: string, windowId: string) => boolean;

/** Groq fake: sempre retorna vegetação nativa (SEM_EVIDENCIA), exceto para regras de falha explícitas. */
function groqFetchImpl(opts: { shouldFail?: GroqFailureRule } = {}): { fetchImpl: typeof fetch; calls: () => number } {
  let callCount = 0;
  const fetchImpl = (async (_url: any, init: any) => {
    callCount += 1;
    const body = JSON.parse(init.body);
    const userContent = body.messages[1].content;
    const promptText = userContent[0].text as string;
    const polygonId = /polygonId=(\S+)/.exec(promptText)?.[1] || "";
    const windowId = /windowId=(\S+)/.exec(promptText)?.[1] || "";
    if (opts.shouldFail?.(polygonId, windowId)) {
      return new Response("server error", { status: 500 });
    }
    const imageParts = userContent.filter((c: any) => c.type === "image_url");
    const sceneMatches = [...promptText.matchAll(/sceneId=(\S+) ano=(\d+) sensor=\S+/g)];
    const observations = sceneMatches.map(([, sceneId, year]) => ({
      sceneId,
      year: Number(year),
      state: "NATIVE_VEGETATION",
      observableFraction: 0.9,
      confidence: "HIGH",
      evidence: [],
      limitations: [],
    }));
    const payload = {
      schemaVersion: 1,
      polygonId,
      windowId,
      inspectedSceneIds: sceneMatches.map(([, sceneId]) => sceneId),
      observations,
      transitions: [],
      conflicts: [],
    };
    expect(imageParts.length).toBeLessThanOrEqual(3);
    return new Response(
      JSON.stringify({ id: "req_x", choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => callCount };
}

const noNetworkDeepseekDeps = { apiKey: "", fetchImpl: vi.fn() };

// Compõe imagens reais (sharp) para vários polígonos/janelas; sob contenção de
// CPU no conjunto completo de testes, o timeout padrão de 5s é apertado demais.
vi.setConfig({ testTimeout: 20_000 });

describe("runAuasPre2008Analysis", () => {
  it("zero AUAS termina sem cobrar IA e informa ausência da camada", async () => {
    const groqFetch = vi.fn();
    const result = await runAuasPre2008Analysis("job-1", new Map(), {
      groqDeps: { apiKey: "k", fetchImpl: groqFetch },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    expect(result.polygons).toHaveLength(0);
    expect(result.scenes).toHaveLength(0);
    expect(result.report.model).toBe("deterministic-fallback");
    expect(groqFetch).not.toHaveBeenCalled();
    expect(result.limitations.join(" ")).toContain("AUAS ausente");
  });

  it("um AUAS cria 3 janelas", async () => {
    const groq = groqFetchImpl();
    const result = await runAuasPre2008Analysis("job-2", clippedGeometries([squarePolygon(-56.1, -12.1)]), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    expect(result.polygons).toHaveLength(1);
    expect(result.windows).toHaveLength(3);
    expect(groq.calls()).toBe(3);
    expect(result.polygons[0].status).toBe("SEM_EVIDENCIA_PRE_2008");
  });

  it("N AUAS cria 3×N janelas, sem truncar", async () => {
    const groq = groqFetchImpl();
    const polys = [squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9), squarePolygon(-55.5, -11.5)];
    const result = await runAuasPre2008Analysis("job-3", clippedGeometries(polys), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    expect(result.polygons).toHaveLength(3);
    expect(result.windows).toHaveLength(9);
    expect(groq.calls()).toBe(9);
  });

  it("recusa job acima do limite de polígonos antes de processar/cobrar", async () => {
    const wmsFetch = vi.fn();
    const groqFetch = vi.fn();
    const cfg = { ...getAuasV2Config(), maxPolygonsPerJob: 1 };
    const polys = [squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9)];
    await expect(
      runAuasPre2008Analysis("job-4", clippedGeometries(polys), {
        config: cfg,
        sceneDeps: { fetchImpl: wmsFetch },
        groqDeps: { apiKey: "k", fetchImpl: groqFetch },
        deepseekDeps: noNetworkDeepseekDeps,
      })
    ).rejects.toBeInstanceOf(AuasTooManyPolygonsError);
    expect(wmsFetch).not.toHaveBeenCalled();
    expect(groqFetch).not.toHaveBeenCalled();
  });

  it("uma janela falha e apenas o polígono correspondente vira inconclusivo", async () => {
    const groq = groqFetchImpl({ shouldFail: (polygonId) => polygonId === "AUAS-0002" });
    const polys = [squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9)];
    const result = await runAuasPre2008Analysis("job-5", clippedGeometries(polys), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    const p1 = result.polygons.find((p) => p.polygonId === "AUAS-0001")!;
    const p2 = result.polygons.find((p) => p.polygonId === "AUAS-0002")!;
    expect(p1.status).toBe("SEM_EVIDENCIA_PRE_2008");
    expect(p2.status).toBe("INCONCLUSIVO");
    expect(result.windows.some((w) => w.polygonId === "AUAS-0002" && w.status === "FAILED")).toBe(true);
  });

  it("checkpoint evita repetição ao reprocessar o mesmo job", async () => {
    const groq = groqFetchImpl();
    const store = createInMemoryCheckpointStore();
    const polygon = clippedGeometries([squarePolygon(-56.1, -12.1)]);
    await runAuasPre2008Analysis("job-6", polygon, {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
      checkpointStore: store,
    });
    expect(groq.calls()).toBe(3);
    await runAuasPre2008Analysis("job-6", polygon, {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
      checkpointStore: store,
    });
    expect(groq.calls()).toBe(3); // nenhuma chamada nova — tudo veio do checkpoint
  });

  it("cancelamento interrompe antes da próxima chamada cara", async () => {
    const groq = groqFetchImpl();
    const controller = new AbortController();
    const polys = [squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9)];
    const onProgress = vi.fn((p: AuasV2Progress) => {
      if (p.step === "analyzing_polygons") controller.abort();
    });
    await expect(
      runAuasPre2008Analysis("job-7", clippedGeometries(polys), {
        sceneDeps: { fetchImpl: wmsFetchImpl() },
        groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
        deepseekDeps: noNetworkDeepseekDeps,
        signal: controller.signal,
        onProgress,
      })
    ).rejects.toBeInstanceOf(AuasCancelledError);
    expect(groq.calls()).toBe(0);
  });

  it("ETA/percentual reportado é monotônico não decrescente", async () => {
    const groq = groqFetchImpl();
    const progressValues: number[] = [];
    await runAuasPre2008Analysis(
      "job-8",
      clippedGeometries([squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9)]),
      {
        sceneDeps: { fetchImpl: wmsFetchImpl() },
        groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
        deepseekDeps: noNetworkDeepseekDeps,
        onProgress: (p) => progressValues.push(p.percent),
      }
    );
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });

  it("billing/usage (windows retornados) corresponde às chamadas realmente feitas", async () => {
    const groq = groqFetchImpl();
    const result = await runAuasPre2008Analysis("job-9", clippedGeometries([squarePolygon(-56.1, -12.1)]), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    const completed = result.windows.filter((w) => w.status === "COMPLETED");
    expect(completed).toHaveLength(groq.calls());
  });
});
