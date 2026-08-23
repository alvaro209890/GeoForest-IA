import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseGroqDurationToMs,
  requestGroqVisionWindow,
  resetGroqVisionRateLimitStateForTests,
  type GroqVisionWindowRequest,
} from "./groq-vision-client";

function image(sceneId: string, year: number, sensor: "LANDSAT_5" | "SPOT" = "LANDSAT_5") {
  return { sceneId, year: year as any, sensor, dataUrl: `data:image/png;base64,AAAA_${sceneId}` };
}

function baseRequest(): GroqVisionWindowRequest {
  return {
    polygonId: "AUAS-0001",
    windowId: "W2003_2005",
    images: [image("s1", 2003), image("s2", 2004), image("s3", 2005)],
  };
}

function validObservationPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: 1,
    polygonId: "AUAS-0001",
    windowId: "W2003_2005",
    inspectedSceneIds: ["s1", "s2", "s3"],
    observations: [
      { sceneId: "s1", year: 2003, state: "NATIVE_VEGETATION", observableFraction: 0.9, confidence: "HIGH", evidence: [], limitations: [] },
      { sceneId: "s2", year: 2004, state: "NATIVE_VEGETATION", observableFraction: 0.9, confidence: "HIGH", evidence: [], limitations: [] },
      { sceneId: "s3", year: 2005, state: "NATIVE_VEGETATION", observableFraction: 0.9, confidence: "HIGH", evidence: [], limitations: [] },
    ],
    transitions: [],
    conflicts: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function groqSuccessBody(content: unknown, usage = { prompt_tokens: 1000, completion_tokens: 200 }) {
  return {
    id: "req_123",
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage,
  };
}

afterEach(() => {
  resetGroqVisionRateLimitStateForTests();
  vi.restoreAllMocks();
});

describe("parseGroqDurationToMs", () => {
  it("parseia segundos com casas decimais", () => {
    expect(parseGroqDurationToMs("7.66s")).toBe(7660);
  });
  it("parseia minutos+segundos", () => {
    expect(parseGroqDurationToMs("1m2s")).toBe(62000);
  });
  it("retorna null para valor ausente", () => {
    expect(parseGroqDurationToMs(null)).toBeNull();
  });
});

describe("requestGroqVisionWindow — validações locais", () => {
  it("rejeita localmente uma quarta imagem sem fazer fetch", async () => {
    const fetchImpl = vi.fn();
    const request: GroqVisionWindowRequest = {
      polygonId: "AUAS-0001",
      windowId: "W2003_2005",
      images: [image("s1", 2003), image("s2", 2004), image("s3", 2005), image("s4", 2003)],
    };
    const result = await requestGroqVisionWindow(request, { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("TOO_MANY_IMAGES");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("nunca envia mais de 3 image_url mesmo com 3 imagens (checagem do payload)", async () => {
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      // O modelo default deixou de ser fixo (commit cee54247: `VISION_MODEL`), por
      // isso o teste passa o modelo por `deps` em vez de cravar o default aqui.
      expect(body.model).toBe("qwen/qwen3.6-27b");
      // `reasoning_effort` só é enviado quando o endpoint é da Groq — mandar o
      // campo para outro provedor quebra a chamada.
      expect(body.reasoning_effort).toBe("none");
      const imageParts = body.messages[1].content.filter((c: any) => c.type === "image_url");
      expect(imageParts.length).toBeLessThanOrEqual(3);
      return jsonResponse(groqSuccessBody(validObservationPayload()));
    });
    const result = await requestGroqVisionWindow(baseRequest(), {
      fetchImpl,
      apiKey: "k",
      model: "qwen/qwen3.6-27b",
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("requestGroqVisionWindow — validação de schema e retry", () => {
  it("valida JSON antes de retornar sucesso", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(groqSuccessBody(validObservationPayload())));
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.polygonId).toBe("AUAS-0001");
      expect(result.requestId).toBe("req_123");
      expect(result.inputTokens).toBe(1000);
    }
  });

  it("faz uma repetição em JSON inválido e depois sucede", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(groqSuccessBody({ not: "valid" }));
      return jsonResponse(groqSuccessBody(validObservationPayload()));
    });
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("não entra em loop depois da terceira falha de schema (retry ampliado no v2)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(groqSuccessBody({ not: "valid" })));
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_SCHEMA");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejeita polygonId/sceneId inventado no retorno", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(groqSuccessBody(validObservationPayload({ polygonId: "AUAS-9999" })))
    );
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
  });
});

describe("requestGroqVisionWindow — erros HTTP", () => {
  it("trata timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl: fetchImpl as any, apiKey: "k", timeoutMs: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("TIMEOUT");
  });

  it("trata 400 por payload", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("HTTP_400");
  });

  it("trata 401 sem vazar a chave no erro", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "super-secret-key" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("HTTP_401");
      expect(result.message).not.toContain("super-secret-key");
    }
  });

  it("trata 429 respeitando retry-after e usa relógio fake para provar a espera", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({}, 429, { "retry-after": "2" });
      }
      return jsonResponse(groqSuccessBody(validObservationPayload()));
    });
    const sleep = vi.fn(async () => {});
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k", sleep });
    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("respeita x-ratelimit-reset-tokens quando não há retry-after", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({}, 429, { "x-ratelimit-reset-tokens": "1.5s" });
      }
      return jsonResponse(groqSuccessBody(validObservationPayload()));
    });
    const sleep = vi.fn(async () => {});
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k", sleep });
    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(1500);
  });
});

describe("requestGroqVisionWindow — serialização e cancelamento", () => {
  it("serializa duas chamadas concorrentes (não executam ao mesmo tempo)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return jsonResponse(groqSuccessBody(validObservationPayload()));
    });
    await Promise.all([
      requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" }),
      requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k" }),
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("cancelamento interrompe antes da chamada", async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const result = await requestGroqVisionWindow(baseRequest(), { fetchImpl, apiKey: "k", signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("CANCELLED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
