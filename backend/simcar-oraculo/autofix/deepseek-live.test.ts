import { describe, expect, it } from "vitest";

import { buildFixPlan } from "./plan";

const liveEnabled =
  process.env.DEEPSEEK_LIVE === "1" &&
  Boolean(String(process.env.DEEPSEEK_API_KEY || "").trim());

describe("DeepSeek V4 Pro live — planner autofix", () => {
  it.skipIf(!liveEnabled)(
    "planeja os pontos repetidos do V23 sem inventar ação ou camada",
    async () => {
      const plan = await buildFixPlan({
        reportText:
          "Relatório de importação. Situação: COM_PENDENCIA. AREA_UMIDA — A geometria contém pontos repetidos — Quantidade 11.",
        errosResumo: [
          {
            camada: "AREA_UMIDA",
            erro: "A geometria contém pontos repetidos",
            qtd: 11,
          },
        ],
        allowedActions: [
          "remove_duplicate_vertices",
          "clean_degenerate_rings",
          "unkink_self_intersection",
          "remove_glued_holes",
          "split_complex_polygon",
        ],
      });

      expect(plan.fonte, plan.avisos.join("\n")).toBe("deepseek");
      expect(plan.modelo).toBe("deepseek-v4-pro");
      expect(plan.acoes).toEqual([
        expect.objectContaining({
          type: "remove_duplicate_vertices",
          layers: ["AREA_UMIDA"],
        }),
      ]);
      expect(plan.explicacaoUsuario.length).toBeGreaterThan(20);
    },
    200_000
  );
});
