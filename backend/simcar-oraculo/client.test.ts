import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSimcarTokenCache,
  SimcarHttpError,
  simcarGet,
  withSimcarAuthRetry,
  withSimcarPollRetry,
} from "./client";

function configureFakeCredentials(): void {
  process.env.SIMCAR_CPF = "11122233344";
  process.env.SIMCAR_SENHA = "senha-de-teste";
}

afterEach(() => {
  clearSimcarTokenCache();
  delete process.env.SIMCAR_CPF;
  delete process.env.SIMCAR_SENHA;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("simcar-oraculo/client auth retry", () => {
  it("renova a sessão após um 401 e conclui com o token novo", async () => {
    configureFakeCredentials();
    let loginCalls = 0;
    let buscarCalls = 0;
    const authorizationHeaders: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any, init: RequestInit = {}) => {
        const url = String(input);
        if (url.includes("Autenticacao/Autenticar")) {
          loginCalls += 1;
          return new Response(JSON.stringify(`TECNICO sessao-${loginCalls}`), { status: 200 });
        }
        if (url.includes("Requerimento/Buscar/270069")) {
          buscarCalls += 1;
          authorizationHeaders.push(String((init.headers as Record<string, string>).authorization));
          if (buscarCalls === 1) return new Response("sessão expirada", { status: 401 });
          return new Response(JSON.stringify({ Id: 270069 }), { status: 200 });
        }
        return new Response("não esperado", { status: 500 });
      }),
    );

    const result = await withSimcarAuthRetry((token) =>
      simcarGet(token, "Requerimento/Buscar/270069"),
    );

    expect(result).toEqual({ Id: 270069 });
    expect(loginCalls).toBe(2);
    expect(buscarCalls).toBe(2);
    expect(authorizationHeaders).toEqual(["TECNICO sessao-1", "TECNICO sessao-2"]);
  });

  it("não entra em loop quando a segunda tentativa também recebe 401", async () => {
    configureFakeCredentials();
    let loginCalls = 0;
    let buscarCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("Autenticacao/Autenticar")) {
          loginCalls += 1;
          return new Response(JSON.stringify(`TECNICO sessao-${loginCalls}`), { status: 200 });
        }
        buscarCalls += 1;
        return new Response("sessão expirada", { status: 401 });
      }),
    );

    await expect(
      withSimcarAuthRetry((token) => simcarGet(token, "Requerimento/Buscar/270069")),
    ).rejects.toMatchObject({ status: 401 });
    expect(loginCalls).toBe(2);
    expect(buscarCalls).toBe(2);
  });
});

describe("simcar-oraculo/client timeout", () => {
  it("repassa timeoutMs do GET e aborta a requisição", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: any, init: RequestInit = {}) => {
        receivedSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason));
        });
      }),
    );

    const pending = simcarGet("TECNICO teste", "Requerimento/Lento", 25);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe("simcar-oraculo/client poll retry", () => {
  it("repete 5xx transitório com backoff limitado e conclui na terceira tentativa", async () => {
    let calls = 0;
    const retries: number[] = [];
    const result = await withSimcarPollRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new SimcarHttpError({
            method: "GET",
            pathname: "Requerimento/BuscarStatusProcessamento/270069",
            status: 503,
            responseText: "indisponível",
          });
        }
        return "ok";
      },
      {
        baseDelayMs: 0,
        onRetry: ({ attempt }) => retries.push(attempt),
      },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("não repete erro 4xx", async () => {
    let calls = 0;
    await expect(
      withSimcarPollRetry(
        async () => {
          calls += 1;
          throw new SimcarHttpError({
            method: "GET",
            pathname: "Requerimento/BuscarStatusProcessamento/270069",
            status: 400,
            responseText: "inválido",
          });
        },
        { baseDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
});
