/**
 * Laudo em DOCX — o formato editável do mesmo laudo do PDF.
 *
 * O que estes testes protegem: que o DOCX saia como .docx de verdade (OOXML
 * zipado), que ele carregue o mesmo conteúdo do PDF (veredito, achados,
 * quantitativos, fundamentação) e — o principal — que ele respeite as mesmas
 * exclusões de entrega. Um laudo que cita uma camada que o ZIP não contém é
 * pior do que um laudo sem a camada.
 */
import { describe, expect, it } from "vitest";

// Leitor de ZIP do próprio projeto — evita depender de `jszip`, que só existe
// aqui como dependência transitiva e pode sumir num `pnpm dedupe`.
import { extractZipEntries } from "../geo-utils";
import { buildSimcarReportDocxBuffer } from "./report-docx";

function docxEntry(buffer: Buffer, name: string): Buffer | undefined {
    return extractZipEntries(buffer).find((entry) => entry.name === name)?.data;
}

/** Extrai o texto corrido do `document.xml`, que é onde o corpo do laudo vive. */
function docxText(buffer: Buffer): string {
    const xml = docxEntry(buffer, "word/document.xml")?.toString("utf8") || "";
    return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const baseArgs = () => ({
    jobId: "job-docx-1",
    filename: "Recorte Fazenda Teste",
    summary: {
        propertyAreaHa: 1000,
        layersProcessed: 28,
        layers: [
            { name: "AREA_CONSOLIDADA", features: 12, areaHa: 620.5 },
            { name: "AVN", features: 4, areaHa: 300.25 },
            { name: "TIPOLOGIA_VEGETAL", features: 50000, areaHa: 998.4 },
        ],
        warnings: ["Camada TIPOLOGIA_VEGETAL truncada em 50.000 feições pelo WFS."],
    },
    analysisText: [
        "## Veredito Objetivo",
        "- **AC fora do shape:** conforme.",
        "Parágrafo de conclusão técnica do laudo.",
    ].join("\n"),
    analysisMeta: {
        globalVerdict: { acForaShape: "NAO", avnDentroShapeAntropizado: "NAO", confidence: "ALTA" },
        coherence: { isCoherent: true, notes: [] },
        satelliteVerdicts: [
            { key: "landsat5_2003", label: "Landsat 5 (2003)", year: 2003, status: "used" },
            { key: "spot_2008", label: "SPOT 2008", year: 2008, status: "used" },
        ],
    },
});

describe("buildSimcarReportDocxBuffer", () => {
    it("gera um .docx válido (OOXML zipado, com o document.xml no lugar)", async () => {
        const buffer = await buildSimcarReportDocxBuffer(baseArgs());
        expect(buffer.length).toBeGreaterThan(1000);
        // Assinatura de ZIP — .docx é um ZIP com o pacote OOXML dentro.
        expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
        expect(docxEntry(buffer, "word/document.xml")).toBeTruthy();
        expect(docxEntry(buffer, "[Content_Types].xml")).toBeTruthy();
    });

    it("traz o mesmo conteúdo estrutural do PDF", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("Laudo Técnico SIMCAR");
        expect(texto).toContain("VEREDITO GERAL DA ANÁLISE");
        expect(texto).toContain("Resumo Executivo");
        expect(texto).toContain("Quadro de Achados");
        expect(texto).toContain("Quantitativos por Camada");
        expect(texto).toContain("Fundamentação Legal Aplicada");
        expect(texto).toContain("Como ler AC, AUAS e AVN neste laudo");
    });

    it("não vaza TIPOLOGIA_VEGETAL — nem na tabela, nem nos avisos", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).not.toContain("TIPOLOGIA_VEGETAL");
        // o aviso de truncamento da camada excluída também não faz sentido aqui
        expect(texto).not.toContain("truncada em 50.000");
    });

    it("os contadores descontam a camada excluída", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        // 28 camadas do template - 1 excluída = 27; 2 delas com dados.
        expect(texto).toContain("2/27");
        // 12 + 4 feições, sem as 50.000 da tipologia
        expect(texto).toContain("16");
    });

    it("preserva a estrutura markdown que a IA produziu", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("Veredito Objetivo");
        expect(texto).toContain("AC fora do shape");
        expect(texto).toContain("Parágrafo de conclusão técnica do laudo.");
    });

    it("usa o vocabulário corrigido: AC é uso consolidado", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("uso consolidado");
    });

    it("mostra a janela temporal 2003–2008 na linha do tempo", async () => {
        const texto = docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("Linha do Tempo da Análise");
        expect(texto).toContain("2003");
        expect(texto).toContain("2008");
    });

    it("não quebra quando não há análise nenhuma", async () => {
        const buffer = await buildSimcarReportDocxBuffer({
            jobId: "job-vazio",
            filename: "Recorte sem análise",
            summary: { propertyAreaHa: 10, layersProcessed: 28, layers: [] },
        });
        const texto = docxText(buffer);
        expect(texto).toContain("Nenhuma sobreposição encontrada");
        expect(texto).toContain("Sem análise de IA");
    });
});
