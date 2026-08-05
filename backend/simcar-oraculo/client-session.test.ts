import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSimcarTokenCache,
  getSimcarToken,
  getSimcarTokenFor,
  simcarCredentialKey,
  simcarGet,
  withSimcarAuthRetryFor,
} from "./client";

afterEach(() => {
  clearSimcarTokenCache();
  delete process.env.SIMCAR_CPF;
  delete process.env.SIMCAR_SENHA;
  vi.unstubAllGlobals();
});

/** fetch falso que devolve um token diferente por conta e conta os logins. */
function stubLogin(): { logins: string[] } {
  const logins: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes("Autenticacao/Autenticar")) {
        // O corpo vai embaralhado (scramble); a ordem das chamadas basta para o teste.
        logins.push(String(init.body || ""));
        return new Response(JSON.stringify(`TECNICO sessao-${logins.length}`), { status: 200 });
      }
      return new Response("não esperado", { status: 500 });
    }),
  );
  return { logins };
}

describe("simcar-oraculo/client — sessão por credencial", () => {
  it("mantém tokens distintos para contas distintas", async () => {
    const { logins } = stubLogin();

    const tokenA = await getSimcarTokenFor("111.222.333-44", "senha-a");
    const tokenB = await getSimcarTokenFor("555.666.777-88", "senha-b");

    expect(tokenA).toBe("TECNICO sessao-1");
    expect(tokenB).toBe("TECNICO sessao-2");
    expect(logins).toHaveLength(2);

    // Segunda leitura vem do cache: nenhum login novo, nenhuma troca de token.
    expect(await getSimcarTokenFor("11122233344", "senha-a")).toBe(tokenA);
    expect(await getSimcarTokenFor("55566677788", "senha-b")).toBe(tokenB);
    expect(logins).toHaveLength(2);
  });

  it("coalesce logins simultâneos da mesma conta (single-flight por chave)", async () => {
    const { logins } = stubLogin();

    const [a, b, c] = await Promise.all([
      getSimcarTokenFor("11122233344", "senha"),
      getSimcarTokenFor("11122233344", "senha"),
      getSimcarTokenFor("11122233344", "senha"),
    ]);

    expect(logins).toHaveLength(1);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it("logins simultâneos de contas diferentes não são coalescidos", async () => {
    const { logins } = stubLogin();

    const [a, b] = await Promise.all([
      getSimcarTokenFor("11122233344", "senha-a"),
      getSimcarTokenFor("55566677788", "senha-b"),
    ]);

    expect(logins).toHaveLength(2);
    expect(a).not.toBe(b);
  });

  it("clearSimcarTokenCache(chave) invalida só a conta indicada", async () => {
    const { logins } = stubLogin();

    await getSimcarTokenFor("11122233344", "senha-a");
    const tokenB = await getSimcarTokenFor("55566677788", "senha-b");
    expect(logins).toHaveLength(2);

    clearSimcarTokenCache(simcarCredentialKey("11122233344", "senha-a"));

    // A conta limpa re-loga; a outra continua servida pelo cache.
    expect(await getSimcarTokenFor("11122233344", "senha-a")).toBe("TECNICO sessao-3");
    expect(await getSimcarTokenFor("55566677788", "senha-b")).toBe(tokenB);
    expect(logins).toHaveLength(3);
  });

  it("getSimcarToken() continua usando a conta do env (oráculo)", async () => {
    const { logins } = stubLogin();
    process.env.SIMCAR_CPF = "11122233344";
    process.env.SIMCAR_SENHA = "senha-do-oraculo";

    const doEnv = await getSimcarToken();
    // Mesma conta do env → cache compartilhado, sem novo login.
    expect(await getSimcarTokenFor("11122233344", "senha-do-oraculo")).toBe(doEnv);
    expect(logins).toHaveLength(1);
  });

  it("withSimcarAuthRetryFor renova a sessão da própria conta em 401", async () => {
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
        buscarCalls += 1;
        authorizationHeaders.push(String((init.headers as Record<string, string>).authorization));
        if (buscarCalls === 1) return new Response("sessão expirada", { status: 401 });
        return new Response(JSON.stringify({ Id: 10005 }), { status: 200 });
      }),
    );

    const result = await withSimcarAuthRetryFor("11122233344", "senha", (token) =>
      simcarGet(token, "Requerimento/Buscar/10005"),
    );

    expect(result).toEqual({ Id: 10005 });
    expect(loginCalls).toBe(2);
    expect(authorizationHeaders).toEqual(["TECNICO sessao-1", "TECNICO sessao-2"]);
  });
});
