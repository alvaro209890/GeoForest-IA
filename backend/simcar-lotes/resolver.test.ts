import { afterEach, describe, expect, it, vi } from "vitest";
import { CarNaoLocalizadoError, carEstadualPorReciboFederal, requerimentoIdPublico, resolverCar } from "./resolver";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEM_10005 = {
  Id: 470498,
  RId: 10005,
  NumeroCompleto: "MT10005/2019",
  NumeroReciboFedederal: "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
  Situacao: "[AGUARDANDO_ANALISE]",
  PropriedadeNome: "LOTE RURAL 81",
  MunicipioTexto: "Querência",
};

/** fetch falso: distingue endpoint público de ListarRasc e guarda os corpos. */
function stubFetch(handlers: {
  publico?: (body: any) => unknown;
  rasc?: (body: any) => unknown;
}): { bodies: any[] } {
  const bodies: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init: RequestInit = {}) => {
      const url = String(input);
      const body = init.body ? JSON.parse(String(init.body)) : null;
      bodies.push({ url, body });
      if (url.includes("Publico/ListarRequerimento")) {
        return new Response(JSON.stringify(handlers.publico?.(body) ?? { Itens: [] }), { status: 200 });
      }
      if (url.includes("Requerimento/ListarRasc")) {
        return new Response(JSON.stringify(handlers.rasc?.(body) ?? { Itens: [] }), { status: 200 });
      }
      return new Response("não esperado", { status: 500 });
    }),
  );
  return { bodies };
}

describe("simcar-lotes/resolver", () => {
  it("resolve o CAR estadual pelo ListarRasc e devolve o RequerimentoId", async () => {
    const { bodies } = stubFetch({ rasc: () => ({ QuantidadeTotal: 1, Itens: [ITEM_10005] }) });

    const resolucao = await resolverCar({
      carEstadual: "MT10005/2019",
      reciboFederal: null,
      token: "TECNICO abc",
    });

    expect(resolucao).toEqual({
      requerimentoId: 470498,
      numeroCompleto: "MT10005/2019",
      situacao: "[AGUARDANDO_ANALISE]",
      propriedade: "LOTE RURAL 81",
      municipio: "Querência",
    });
    // Body completo é obrigatório: corpo genérico devolve 400 na SEMA.
    expect(bodies[0].body).toMatchObject({
      Filtros: { NUMERO: "MT10005/2019" },
      Pagina: 1,
      ColunaOrdenar: "NumeroCompleto",
      Colunas: [],
    });
  });

  it("re-filtra pelo NumeroCompleto exato quando a SEMA ignora o filtro", async () => {
    stubFetch({
      rasc: () => ({
        Itens: [
          { Id: 1, NumeroCompleto: "MT99999/2020", PropriedadeNome: "OUTRA" },
          { Id: 2, NumeroCompleto: "MT100050/2019", PropriedadeNome: "PARECIDA" },
          ITEM_10005,
        ],
      }),
    });

    const resolucao = await resolverCar({
      carEstadual: "MT10005/2019",
      reciboFederal: null,
      token: "TECNICO abc",
    });

    expect(resolucao.requerimentoId).toBe(470498);
    expect(resolucao.propriedade).toBe("LOTE RURAL 81");
  });

  it("usa a API pública para achar o estadual quando só há recibo federal", async () => {
    const { bodies } = stubFetch({
      publico: () => ({ Itens: [ITEM_10005] }),
      rasc: () => ({ Itens: [ITEM_10005] }),
    });

    const resolucao = await resolverCar({
      carEstadual: null,
      reciboFederal: "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
      token: "TECNICO abc",
    });

    expect(bodies[0].body.Filtros).toEqual({
      NUMERO_CAR_FERERAL: "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
    });
    expect(bodies[1].url).toContain("Requerimento/ListarRasc");
    expect(resolucao.requerimentoId).toBe(470498);
  });

  it("erro claro quando o CAR não está na conta", async () => {
    stubFetch({ rasc: () => ({ Itens: [] }) });

    await expect(
      resolverCar({ carEstadual: "MT10005/2019", reciboFederal: null, token: "TECNICO abc" }),
    ).rejects.toBeInstanceOf(CarNaoLocalizadoError);
  });

  it("erro quando o recibo não tem nenhum identificador", async () => {
    stubFetch({});
    await expect(
      resolverCar({ carEstadual: null, reciboFederal: null, token: "TECNICO abc" }),
    ).rejects.toThrow(/sem nº de CAR estadual/i);
  });

  it("carEstadualPorReciboFederal devolve null quando não encontra", async () => {
    stubFetch({ publico: () => ({ Itens: [] }) });
    expect(await carEstadualPorReciboFederal("MT-0000000-AAAA")).toBeNull();
  });

  it("requerimentoIdPublico devolve o Id do recibo público", async () => {
    stubFetch({ publico: () => ({ Itens: [ITEM_10005] }) });
    expect(await requerimentoIdPublico("MT10005/2019")).toBe(470498);
  });
});
