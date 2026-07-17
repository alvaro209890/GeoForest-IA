import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSemaReportPdf, parseSemaReportText } from "./sema-report-parse";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/teste_1",
);

describe("parseSemaReportText", () => {
  it("reconstrói erros com quebra de linha e agrega repetições", () => {
    const parsed = parseSemaReportText(`
Relatório de processamento
Situação do processamento: Reprovado - corrija
Erros espaciais
FeiçãoErroQuantidade
AREA_UMIDAGeometria deve ser completamente contida por
AVN, AUAS ou AREA_CONSOLIDADA.
40
AREA_UMIDA Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA. 1
Geometrias encontradas
`);

    expect(parsed.tipo).toBe("processamento");
    expect(parsed.resumo).toEqual([
      {
        camada: "AREA_UMIDA",
        erro: "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA.",
        qtd: 41,
      },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("aceita relatório aprovado sem inventar erro", () => {
    const parsed = parseSemaReportText(
      "Relatório de importação\nSituação da importação: Geometrias importadas com sucesso!\nGeometrias encontradas",
    );
    expect(parsed).toMatchObject({ tipo: "importacao", resumo: [], warnings: [] });
  });
});

describe("parseSemaReportPdf — oráculos reais", () => {
  it("v21 extrai sobreposição de bordas/buracos em AREA_UMIDA ×1", async () => {
    const parsed = await parseSemaReportPdf(
      fs.readFileSync(path.join(fixtureDir, "relatorio_importacao_v21_sema.pdf")),
    );

    expect(parsed.tipo).toBe("importacao");
    expect(parsed.situacao).toMatch(/Reprovado/i);
    expect(parsed.resumo).toEqual([
      {
        camada: "AREA_UMIDA",
        erro: "Duas ou mais bordas ou buracos da geometria de poligono complexo se sobrepõem",
        qtd: 1,
      },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("v22 aprovado não inventa erros", async () => {
    const parsed = await parseSemaReportPdf(
      fs.readFileSync(path.join(fixtureDir, "relatorio_importacao_v22_sema.pdf")),
    );

    expect(parsed.tipo).toBe("importacao");
    expect(parsed.situacao).toMatch(/sucesso/i);
    expect(parsed.resumo).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it("v23 extrai pontos repetidos em AREA_UMIDA ×11", async () => {
    const parsed = await parseSemaReportPdf(
      fs.readFileSync(path.join(fixtureDir, "relatorio_importacao_v23_sema.pdf")),
    );

    expect(parsed.tipo).toBe("importacao");
    expect(parsed.situacao).toMatch(/Reprovado/i);
    expect(parsed.resumo).toEqual([
      { camada: "AREA_UMIDA", erro: "A geometria contém pontos repetidos", qtd: 11 },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("v22-process extrai contenção de AREA_UMIDA ×41", async () => {
    const parsed = await parseSemaReportPdf(
      fs.readFileSync(path.join(fixtureDir, "relatorio_processamento_v22_sema.pdf")),
    );

    expect(parsed.tipo).toBe("processamento");
    expect(parsed.resumo).toEqual([
      {
        camada: "AREA_UMIDA",
        erro: "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA.",
        qtd: 41,
      },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("degrada com warning, sem lançar, quando o PDF é inválido", async () => {
    const parsed = await parseSemaReportPdf(Buffer.from("não é PDF"));
    expect(parsed.resumo).toEqual([]);
    expect(parsed.warnings.join(" ")).toMatch(/Falha ao extrair/);
  });
});
