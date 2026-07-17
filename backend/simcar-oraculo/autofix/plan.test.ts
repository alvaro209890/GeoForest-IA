import { describe, expect, it, vi } from "vitest";

import {
  DEEPSEEK_AUTOFIX_MODEL,
  DEEPSEEK_AUTOFIX_REASONING_EFFORT,
  DEEPSEEK_AUTOFIX_URL,
} from "./deepseek";
import {
  buildFallbackFixPlan,
  buildFixPlan,
  mappedActionsForError,
} from "./plan";
import type { BuildFixPlanInput } from "./types";

const repeatedInput: BuildFixPlanInput = {
  reportText:
    "Relatório de importação da SEMA: AREA_UMIDA com pontos repetidos.",
  errosResumo: [
    {
      camada: "AREA_UMIDA",
      erro: "A geometria contém pontos repetidos",
      qtd: 11,
    },
  ],
};

function rawPlan(overrides: Record<string, unknown> = {}) {
  return {
    acoes: [
      {
        type: "remove_duplicate_vertices",
        layers: ["AREA_UMIDA"],
        motivo: "A SEMA apontou pontos repetidos.",
      },
    ],
    naoCorrigivel: [],
    explicacaoUsuario:
      "Vou remover apenas os vértices repetidos com a rotina calibrada.",
    confianca: "alta",
    ...overrides,
  };
}

function deepseekResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

describe("planner de autofix", () => {
  it("usa JSON válido do DeepSeek com o contrato V4 Pro e precondições determinísticas", async () => {
    const fetchMock = vi.fn(async () =>
      deepseekResponse(
        JSON.stringify({
          ...rawPlan({ confianca: "média" }),
          metadadoIgnorado: "não participa do plano validado",
        })
      )
    );

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan).toMatchObject({
      fonte: "deepseek",
      modelo: DEEPSEEK_AUTOFIX_MODEL,
      confianca: "media",
      acoes: [
        {
          type: "remove_duplicate_vertices",
          layers: ["AREA_UMIDA"],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEEPSEEK_AUTOFIX_URL);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: DEEPSEEK_AUTOFIX_MODEL,
      reasoning_effort: DEEPSEEK_AUTOFIX_REASONING_EFFORT,
      response_format: { type: "json_object" },
    });
    expect(body.temperature).toBeUndefined();
    expect(body.messages[1].content).toContain("AREA_UMIDA");
    expect(body.messages[1].content).toContain("FORMATO RAIZ OBRIGATÓRIO");
    expect(body.messages[1].content).not.toContain('"contratoSaida":');
  });

  it("repete uma vez JSON inválido/conteúdo vazio com max_tokens maior", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(deepseekResponse(""))
      .mockResolvedValueOnce(deepseekResponse(JSON.stringify(rawPlan())));

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan.fonte).toBe("deepseek");
    expect(plan.avisos).toContain(
      "DeepSeek precisou da segunda tentativa para produzir JSON válido."
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.max_tokens).toBeGreaterThan(first.max_tokens);
  });

  it("cai para o mapeamento fixo após duas respostas inválidas", async () => {
    const fetchMock = vi.fn(async () => deepseekResponse("sem json"));

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.fonte).toBe("fallback");
    expect(plan.modelo).toBeNull();
    expect(plan.acoes.map(action => action.type)).toEqual([
      "remove_duplicate_vertices",
    ]);
    expect(plan.avisos.join(" ")).toContain("fallback determinístico");
  });

  it("descarta ação fora do inventário e conserva a ação mecânica segura", async () => {
    const fetchMock = vi.fn(async () =>
      deepseekResponse(
        JSON.stringify(
          rawPlan({
            acoes: [
              {
                type: "delete_layer",
                layers: ["AREA_UMIDA"],
                motivo: "Não permitido.",
              },
            ],
          })
        )
      )
    );

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan.fonte).toBe("deepseek");
    expect(plan.acoes).toHaveLength(1);
    expect(plan.acoes[0]).toMatchObject({
      type: "remove_duplicate_vertices",
      layers: ["AREA_UMIDA"],
    });
    expect(plan.avisos.join(" ")).toContain("delete_layer");
  });

  it("descarta camada inventada mesmo para uma ação existente", async () => {
    const fetchMock = vi.fn(async () =>
      deepseekResponse(
        JSON.stringify(
          rawPlan({
            acoes: [
              {
                type: "remove_duplicate_vertices",
                layers: ["ARL"],
                motivo: "Camada não indicada no relatório.",
              },
            ],
          })
        )
      )
    );

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(plan.acoes).toHaveLength(1);
    expect(plan.acoes[0].layers).toEqual(["AREA_UMIDA"]);
    expect(plan.avisos.join(" ")).toContain("pré-condições");
  });

  it("sem chave não chama rede e mantém o loop funcional pelo fallback", async () => {
    const fetchMock = vi.fn();
    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(plan.fonte).toBe("fallback");
    expect(plan.acoes[0].type).toBe("remove_duplicate_vertices");
    expect(plan.avisos.join(" ")).toContain("DEEPSEEK_API_KEY ausente");
  });

  it("aborta chamadas que excedem o timeout e usa fallback após uma repetição", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted by test"))
          );
        })
    );

    const plan = await buildFixPlan(repeatedInput, {
      apiKey: "test-only-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan.fonte).toBe("fallback");
    expect(plan.avisos.join(" ")).toContain("TIMEOUT");
    expect(plan.acoes[0].type).toBe("remove_duplicate_vertices");
  });

  it("mapeia as cinco ações de import e mantém casos de decisão fora do executor", () => {
    const input: BuildFixPlanInput = {
      reportText: "",
      errosResumo: [
        {
          camada: "AREA_UMIDA",
          erro: "A geometria contém pontos repetidos",
          qtd: 11,
        },
        { camada: "ARL", erro: "Borda do polígono se cruza", qtd: 4 },
        {
          camada: "AREA_UMIDA",
          erro: "Duas ou mais bordas ou buracos da geometria de polígono complexo se sobrepõem",
          qtd: 1,
        },
        {
          camada: "AVN",
          erro: "Era esperado um polígono simples, porém veio polígono complexo",
          qtd: 2,
        },
        { camada: "ARL", erro: "Sobreposição entre feições da camada", qtd: 3 },
      ],
      allowedActions: [
        "remove_duplicate_vertices",
        "clean_degenerate_rings",
        "unkink_self_intersection",
        "remove_glued_holes",
        "split_complex_polygon",
      ],
    };

    const plan = buildFallbackFixPlan(input);

    expect(plan.acoes.map(action => action.type)).toEqual([
      "remove_duplicate_vertices",
      "clean_degenerate_rings",
      "unkink_self_intersection",
      "remove_glued_holes",
      "split_complex_polygon",
    ]);
    expect(plan.naoCorrigivel).toHaveLength(1);
    expect(plan.naoCorrigivel[0].porque).toMatch(/decidir qual feição/i);
  });

  it("mapeia clip apenas para contenção da AREA_UMIDA e respeita ações permitidas", () => {
    const containment = {
      camada: "AREA_UMIDA",
      erro: "A geometria deve ser completamente contida em AVN, AUAS ou AREA_CONSOLIDADA",
    };
    expect(mappedActionsForError(containment)).toEqual(["clip_layer_to_cover"]);
    expect(mappedActionsForError({ ...containment, camada: "AVN" })).toEqual(
      []
    );

    const plan = buildFallbackFixPlan({
      reportText: "",
      errosResumo: [{ ...containment, qtd: 41 }],
      allowedActions: ["remove_duplicate_vertices"],
    });
    expect(plan.acoes).toHaveLength(0);
    expect(plan.naoCorrigivel).toHaveLength(1);
  });
});
