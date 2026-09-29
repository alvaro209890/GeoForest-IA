import { describe, expect, it } from "vitest";
import { describeUpstreamError } from "./upstream-error";

describe("describeUpstreamError", () => {
  it("traduz código próprio PREFIXO_<status> em HTTP", () => {
    expect(describeUpstreamError(new Error("SIMCAR_SEARCH_503"), "o SIMCAR público")).toBe(
      "o SIMCAR público respondeu HTTP 503.",
    );
  });

  it("expõe a causa real do `fetch failed` do undici", () => {
    const err = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } as any });
    expect(describeUpstreamError(err, "o SIMCAR público")).toBe(
      "falha de rede ao acessar o SIMCAR público: conexão recusada (ECONNREFUSED).",
    );
  });

  it("mostra código desconhecido em vez de engolir", () => {
    const err = new TypeError("fetch failed", { cause: { code: "EPROTO", message: "wrong version" } as any });
    expect(describeUpstreamError(err, "X")).toBe("falha de rede ao acessar X: EPROTO — wrong version.");
  });

  it("reconhece timeout (AbortError)", () => {
    const err = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(describeUpstreamError(err, "o portal APF")).toBe("o portal APF não respondeu dentro do tempo limite.");
  });

  it("repassa a mensagem original quando não reconhece o formato", () => {
    expect(describeUpstreamError(new Error("CPF sem APF cadastrada."), "X")).toBe("CPF sem APF cadastrada.");
    expect(describeUpstreamError(null, "X")).toBe("erro sem mensagem ao acessar X.");
  });
});
