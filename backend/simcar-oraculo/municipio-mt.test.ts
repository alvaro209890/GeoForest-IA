import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMunicipioCachesForTests,
  detectarMunicipioMt,
  detectarMunicipioWfsSema,
  listarMunicipiosMtLocais,
  listarMunicipiosSimcar,
  normalizarNomeMunicipio,
  resolverChaveMunicipioSimcar,
} from "./municipio-mt";
import { clearSimcarTokenCache } from "./client";

afterEach(() => {
  __resetMunicipioCachesForTests();
  clearSimcarTokenCache();
  delete process.env.SIMCAR_CPF;
  delete process.env.SIMCAR_SENHA;
  vi.unstubAllGlobals();
});

describe("malha municipal IBGE 2024", () => {
  it("contém os 142 municípios de MT com códigos únicos", () => {
    const municipios = listarMunicipiosMtLocais();
    expect(municipios).toHaveLength(142);
    expect(new Set(municipios.map((item) => item.ibge)).size).toBe(142);
  });

  it("detecta a Santa Clara em Querência", () => {
    expect(detectarMunicipioMt([-52.4101216771, -12.4272312653])).toEqual({
      nome: "Querência",
      ibge: "5107065",
      fonte: "malha-ibge",
    });
  });

  it("detecta Cuiabá e rejeita ponto fora de MT", () => {
    expect(detectarMunicipioMt([-56.0979, -15.601])).toMatchObject({
      nome: "Cuiabá",
      ibge: "5103403",
    });
    expect(detectarMunicipioMt([-46.6333, -23.5505])).toBeNull();
  });

  it("normaliza acentos e caixa para casar nomes do SIMCAR", () => {
    expect(normalizarNomeMunicipio("  Querência/MT ")).toBe("QUERENCIA MT");
    expect(normalizarNomeMunicipio("São José do Xingu")).toBe("SAO JOSE DO XINGU");
  });
});

describe("fallback municipal WFS SEMA", () => {
  it("consulta a camada oficial por INTERSECTS(point)", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            features: [
              { properties: { MUNICIPIO: "QUERÊNCIA", COD_IBGE: "5107065" } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    await expect(detectarMunicipioWfsSema([-52.41, -12.42])).resolves.toEqual({
      nome: "QUERÊNCIA",
      ibge: "5107065",
      fonte: "wfs-sema",
    });
    const url = new URL(requestedUrl);
    expect(url.searchParams.get("typeNames")).toBe("Geoportal:LIM_MUNICIPIOS_MT");
    expect(url.searchParams.get("CQL_FILTER")).toContain("INTERSECTS(SHAPE,POINT(-52.41000000");
  });
});

describe("municípios do SIMCAR para dropdown/prepare", () => {
  it("casa Chave do SIMCAR com IBGE por nome e mantém cache de 24h", async () => {
    process.env.SIMCAR_CPF = "11122233344";
    process.env.SIMCAR_SENHA = "senha-de-teste";
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("Autenticacao/Autenticar")) {
          return new Response(JSON.stringify("TECNICO sessao-municipios"), { status: 200 });
        }
        if (url.includes("Municipio/ListarMatoGrosso")) {
          listCalls += 1;
          return new Response(
            JSON.stringify([
              { Chave: 751, Texto: "Querência" },
              { Chave: 340, Texto: "Cuiabá" },
            ]),
            { status: 200 },
          );
        }
        return new Response("não esperado", { status: 500 });
      }),
    );

    const first = await listarMunicipiosSimcar();
    const second = await listarMunicipiosSimcar();
    const resolved = await resolverChaveMunicipioSimcar({ nome: "QUERENCIA", ibge: "5107065" });

    expect(first).toEqual([
      { chave: 751, nome: "Querência", ibge: "5107065" },
      { chave: 340, nome: "Cuiabá", ibge: "5103403" },
    ]);
    expect(second).toBe(first);
    expect(resolved).toMatchObject({ chave: 751, ibge: "5107065" });
    expect(listCalls).toBe(1);
  });
});
