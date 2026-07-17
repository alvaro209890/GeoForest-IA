import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSimcarOraculoConfig,
  assertTestCarId,
} from "./config";
import { scramble } from "./scramble";
import { enqueueSimcar, getSimcarQueueLength, __resetSimcarQueueForTests } from "./queue";
import { extractShapeContext } from "./shape-context";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("simcar-oraculo/config", () => {
  afterEach(() => {
    delete process.env.SIMCAR_CPF;
    delete process.env.SIMCAR_SENHA;
    delete process.env.SIMCAR_TEST_CAR_ID;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("credentialsConfigured é false sem CPF/senha", () => {
    delete process.env.SIMCAR_CPF;
    delete process.env.SIMCAR_SENHA;
    const c = getSimcarOraculoConfig();
    expect(c.credentialsConfigured).toBe(false);
    expect(c.testCarId).toBe("271442");
    expect("mode" in c).toBe(false);
  });

  it("credentialsConfigured é true com CPF/senha; deepseekConfigured segue a chave", () => {
    process.env.SIMCAR_CPF = "12345678901";
    process.env.SIMCAR_SENHA = "x";
    expect(getSimcarOraculoConfig().credentialsConfigured).toBe(true);
    expect(getSimcarOraculoConfig().deepseekConfigured).toBe(false);
    process.env.DEEPSEEK_API_KEY = "sk-teste";
    expect(getSimcarOraculoConfig().deepseekConfigured).toBe(true);
  });

  it("assertTestCarId só aceita o projeto-teste", () => {
    process.env.SIMCAR_TEST_CAR_ID = "270069";
    expect(assertTestCarId("270069")).toBe("270069");
    expect(() => assertTestCarId("999")).toThrow(/projeto-teste/);
  });
});

describe("simcar-oraculo/scramble", () => {
  it("produz string não vazia e estável", () => {
    const payload = JSON.stringify({ Login: "123", Senha: "abc", NovaSenha: "" });
    const a = scramble(payload);
    const b = scramble(payload);
    expect(a.length).toBeGreaterThan(10);
    expect(a).toBe(b);
    expect(a).not.toContain("Senha");
  });
});

describe("simcar-oraculo/queue", () => {
  afterEach(() => {
    __resetSimcarQueueForTests();
  });

  it("serializa jobs (A termina antes de B começar a finalizar)", async () => {
    const order: string[] = [];
    const a = enqueueSimcar(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 40));
      order.push("a-end");
      return 1;
    });
    const b = enqueueSimcar(async () => {
      order.push("b-start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("b-end");
      return 2;
    });
    expect(getSimcarQueueLength()).toBeGreaterThanOrEqual(1);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(1);
    expect(rb).toBe(2);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});

describe("simcar-oraculo/shape-context", () => {
  it("extrai bbox do fixture Santa Clara FINAL", () => {
    const zipPath = resolve(
      __dirname,
      "../fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip",
    );
    const zip = readFileSync(zipPath);
    const ctx = extractShapeContext(zip);
    expect(ctx.layers.length).toBeGreaterThan(5);
    expect(ctx.bbox[0]).toBeLessThan(ctx.bbox[2]);
    expect(ctx.bbox[1]).toBeLessThan(ctx.bbox[3]);
    // MT roughly lon -61..-50, lat -18..-7
    const [minX, minY, maxX, maxY] = ctx.bbox;
    expect(minX).toBeGreaterThan(-65);
    expect(maxX).toBeLessThan(-50);
    expect(minY).toBeGreaterThan(-20);
    expect(maxY).toBeLessThan(-7);
    expect(ctx.centroid[0]).toBeGreaterThan(minX);
    expect(ctx.centroid[0]).toBeLessThan(maxX);
    expect(ctx.municipioDetectado).toEqual({
      nome: "Querência",
      ibge: "5107065",
      fonte: "malha-ibge",
    });
    expect(ctx.warnings).toEqual([]);
  });
});

describe("simcar-oraculo/client login (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SIMCAR_CPF;
    delete process.env.SIMCAR_SENHA;
  });

  it("login devolve token TECNICO", async () => {
    const { simcarLogin, clearSimcarTokenCache } = await import("./client");
    clearSimcarTokenCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => '"TECNICO abc.def"',
        arrayBuffer: async () => new ArrayBuffer(0),
        headers: { get: () => null },
      })),
    );
    const token = await simcarLogin("12345678901", "senha");
    expect(token).toBe("TECNICO abc.def");
  });
});
