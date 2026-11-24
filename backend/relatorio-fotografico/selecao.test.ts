import { describe, expect, it } from "vitest";
import { normalizeSelecao } from "./selecao";

describe("normalizeSelecao", () => {
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
