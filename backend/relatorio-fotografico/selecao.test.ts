import { describe, expect, it } from "vitest";
import { limparLegenda, normalizeSelecao } from "./selecao";

describe("limparLegenda", () => {
  it("tira o prefixo Figura que o Word já escreve", () => {
    expect(limparLegenda("Figura 1. Vista parcial da sede.")).toBe("Vista parcial da sede.");
    expect(limparLegenda("Fig. 2 - Porteira de acesso")).toBe("Porteira de acesso");
    expect(limparLegenda("  Figura 3:  Curso d'água  ")).toBe("Curso d'água");
  });

  it("não mexe em legenda que só começa com a palavra figura", () => {
    expect(limparLegenda("Figura humana ao lado da cerca.")).toBe("Figura humana ao lado da cerca.");
  });
});

describe("normalizeSelecao", () => {
  it("limpa o prefixo Figura da legenda da IA", () => {
    const selecao = normalizeSelecao(
      JSON.stringify({ parciais: [{ titulo: "Sede", legenda: "Figura 1. Vista da sede.", fotos: ["a"] }] }),
      ["a"],
    );
    expect(selecao.parciais[0].legenda).toBe("Vista da sede.");
  });

  it("aceita JSON cercado de markdown e ignora id desconhecido", () => {
    const selecao = normalizeSelecao(
      "```json\n" +
        JSON.stringify({
          resumo: "Duas fotos do acesso.",
          parciais: [
            {
              titulo: "Acesso",
              legenda: "Entrada da propriedade.",
              fotos: ["a", { id: "b", motivo: "Mostra a porteira." }, "nao-existe", "a"],
            },
          ],
          excluidas: [{ id: "c", motivo: "Repetida e escura." }],
        }) +
        "\n```",
      ["a", "b", "c", "d"],
    );

    expect(selecao.resumo).toBe("Duas fotos do acesso.");
    expect(selecao.parciais).toHaveLength(1);
    expect(selecao.parciais[0].fotos.map((foto) => foto.id)).toEqual(["a", "b"]);
    expect(selecao.parciais[0].fotos[1].motivo).toBe("Mostra a porteira.");
    expect(selecao.excluidas).toEqual([
      { id: "c", motivo: "Repetida e escura." },
      { id: "d", motivo: "Não entrou na seleção da IA." },
    ]);
  });
});
