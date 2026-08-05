import { afterEach, describe, expect, it, vi } from "vitest";
import { CarNaoLocalizadoError, carEstadualPorReciboFederal, requerimentoIdPublico, resolverCar } from "./resolver";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ATENÇÃO — dois espaços de Id diferentes (confirmado ao vivo em 2026-08-05):
 *   API pública  (`Publico/ListarRequerimento`): Id 470498, RId 10005
 *   API técnica  (`Requerimento/ListarRasc`)   : Id 10005
 * Os downloads técnicos usam o Id TÉCNICO; `Publico/DownloadReciboCar` usa o
 * Id PÚBLICO. Por isso o resolver e `requerimentoIdPublico` são consultas separadas.
 */
const ITEM_TECNICO = {
  Id: 10005,
  NumeroCompleto: "MT10005/2019",
  NumeroReciboFedederal: "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
  Situacao: "[EM_ANALISE]",
  PropriedadeNome: "LOTE RURAL 81",
  MunicipioTexto: "Querência",
};

const ITEM_PUBLICO = {
  Id: 470498,
  RId: 10005,
  NumeroCompleto: "MT10005/2019",
  NumeroReciboFedederal: "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
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
    const { bodies } = stubFetch({ rasc: () => ({ QuantidadeTotal: 1, Itens: [ITEM_TECNICO] }) });

    const resolucao = await resolverCar({
      carEstadual: "MT10005/2019",
      reciboFederal: null,
      token: "TECNICO abc",
    });

    // Id TÉCNICO (10005), não o público (470498) — é ele que os downloads usam.
    expect(resolucao).toEqual({
      requerimentoId: 10005,
      numeroCompleto: "MT10005/2019",
      situacao: "[EM_ANALISE]",
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
          ITEM_TECNICO,
        ],
      }),
    });

    const resolucao = await resolverCar({
      carEstadual: "MT10005/2019",
      reciboFederal: null,
      token: "TECNICO abc",
    });

    expect(resolucao.requerimentoId).toBe(10005);
    expect(resolucao.propriedade).toBe("LOTE RURAL 81");
  });

  it("usa a API pública para achar o estadual quando só há recibo federal", async () => {
    const { bodies } = stubFetch({
      publico: () => ({ Itens: [ITEM_PUBLICO] }),
      rasc: () => ({ Itens: [ITEM_TECNICO] }),
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
    expect(resolucao.requerimentoId).toBe(10005);
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

  it("requerimentoIdPublico devolve o Id PÚBLICO, diferente do técnico", async () => {
    stubFetch({ publico: () => ({ Itens: [ITEM_PUBLICO] }) });
    // 470498 (público) ≠ 10005 (técnico): o recibo em PDF só baixa com este.
    expect(await requerimentoIdPublico("MT10005/2019")).toBe(470498);
  });
});
