import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Geometry } from "geojson";

import { runAuasPre2008Analysis } from "./orchestrator";
import { AUAS_VISION_WINDOWS, SPOT_MARCO_WINDOW_ID, getAuasV2Config } from "./config";

// A cena SPOT 2008 é o marco legal (22/07/2008). Estes testes garantem que ela
// nunca some em silêncio: se a janela que a carrega falhar na visão, o laudo
// tem de declarar a falha — e o modelo de visão não pode ficar preso a um
// literal que ignora o VISION_MODEL do ambiente (era a causa do TIMEOUT).

function squarePolygon(cx: number, cy: number, size = 0.01): Geometry {
  return {
    type: "Polygon",
    coordinates: [[[cx, cy], [cx + size, cy], [cx + size, cy + size], [cx, cy + size], [cx, cy]]],
  };
}

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

/** Groq fake: vegetação nativa em tudo, exceto nas janelas listadas em failWindows. */
function groqFetchImpl(failWindows: string[] = []): typeof fetch {
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const userContent = body.messages[1].content;
    const promptText = userContent[0].text as string;
    const polygonId = /polygonId=(\S+)/.exec(promptText)?.[1] || "";
    const windowId = /windowId=(\S+)/.exec(promptText)?.[1] || "";
    if (failWindows.includes(windowId)) return new Response("server error", { status: 500 });
    const sceneMatches = [...promptText.matchAll(/sceneId=(\S+) ano=(\d+) sensor=\S+/g)];
    const payload = {
      schemaVersion: 1,
      polygonId,
      windowId,
      inspectedSceneIds: sceneMatches.map(([, sceneId]) => sceneId),
      observations: sceneMatches.map(([, sceneId, year]) => ({
        sceneId,
        year: Number(year),
        state: "NATIVE_VEGETATION",
        observableFraction: 0.9,
        confidence: "HIGH",
        evidence: [],
        limitations: [],
      })),
      transitions: [],
      conflicts: [],
    };
    return new Response(
      JSON.stringify({ id: "req_x", choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
}

const noNetworkDeepseekDeps = { apiKey: "", fetchImpl: vi.fn() };
vi.setConfig({ testTimeout: 20_000 });

describe("SPOT 2008 — marco legal nunca falha em silêncio", () => {
  it("SPOT_MARCO_WINDOW_ID aponta para a janela que carrega 2008", () => {
    const window = AUAS_VISION_WINDOWS.find((w) => w.windowId === SPOT_MARCO_WINDOW_ID)!;
    expect(window).toBeDefined();
    expect((window.years as readonly number[]).includes(2008)).toBe(true);
  });

  it("janela do SPOT falhando declara a limitação do marco de 2008", async () => {
    const result = await runAuasPre2008Analysis("job-spot-1", new Map([["AUAS", [squarePolygon(-56.1, -12.1)]]]), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groqFetchImpl([SPOT_MARCO_WINDOW_ID]) },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    const texto = result.limitations.join(" ");
    expect(texto).toContain("SPOT 2008");
    expect(texto).toContain("22/07/2008");
    expect(result.polygons[0].status).toBe("INCONCLUSIVO");
  });

  it("sem falha no SPOT não inventa limitação de marco", async () => {
    const result = await runAuasPre2008Analysis("job-spot-2", new Map([["AUAS", [squarePolygon(-56.1, -12.1)]]]), {
      sceneDeps: { fetchImpl: wmsFetchImpl() },
      groqDeps: { apiKey: "k", fetchImpl: groqFetchImpl() },
      deepseekDeps: noNetworkDeepseekDeps,
    });
    expect(result.limitations.join(" ")).not.toContain("marco legal");
    expect(result.polygons[0].status).toBe("SEM_EVIDENCIA_PRE_2008");
  });
});

describe("modelo de visão da Fase 1", () => {
  const saved = { auas: process.env.SIMCAR_AUAS_VISION_MODEL, vision: process.env.VISION_MODEL };
  afterEach(() => {
    if (saved.auas === undefined) delete process.env.SIMCAR_AUAS_VISION_MODEL;
    else process.env.SIMCAR_AUAS_VISION_MODEL = saved.auas;
    if (saved.vision === undefined) delete process.env.VISION_MODEL;
    else process.env.VISION_MODEL = saved.vision;
  });

  it("herda VISION_MODEL do ambiente quando não há override específico", () => {
    delete process.env.SIMCAR_AUAS_VISION_MODEL;
    process.env.VISION_MODEL = "google/gemini-2.5-flash";
    expect(getAuasV2Config().visionModel).toBe("google/gemini-2.5-flash");
  });

  it("SIMCAR_AUAS_VISION_MODEL continua tendo precedência", () => {
    process.env.SIMCAR_AUAS_VISION_MODEL = "outro/modelo";
    process.env.VISION_MODEL = "google/gemini-2.5-flash";
    expect(getAuasV2Config().visionModel).toBe("outro/modelo");
  });

  it("sem nenhuma env cai no padrão medido como estável", () => {
    delete process.env.SIMCAR_AUAS_VISION_MODEL;
    delete process.env.VISION_MODEL;
    expect(getAuasV2Config().visionModel).toBe("google/gemini-2.5-flash");
  });
});
