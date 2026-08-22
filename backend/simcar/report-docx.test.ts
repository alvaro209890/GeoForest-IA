/**
 * Laudo em Word.
 *
 * O que estes testes protegem:
 *  - o `.docx` sai no MESMO papel timbrado do PDF (imagem embutida, margens do
 *    Ofício, fio verde, endereço da IMAP);
 *  - o conteúdo vem do `report-theme` — o mesmo modelo do PDF, então os dois
 *    formatos não podem discordar do veredito;
 *  - a tabela de quantitativos entra mesmo no documento. O rascunho original
 *    montava a tabela e nunca a inseria: a seção saía só com o título, e isso
 *    passava despercebido porque o arquivo abria normalmente;
 *  - camada excluída da entrega (`EXPORT_EXCLUDED_LAYERS`) não vaza no laudo e
 *    os contadores descontam a exclusão — mesma regra do PDF.
 */
import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";

import { buildSimcarReportDocxBuffer } from "./report-docx";
import { IMAP_ADDRESS_LINES, IMAP_COLORS, loadTimbradoImapPng } from "./report-imap";

const layers = [
    { name: "ATP", source: "property" as const, features: 1, areaHa: 1284.36 },
    { name: "AREA_CONSOLIDADA", source: "wfs" as const, features: 33, areaHa: 812.4 },
    { name: "AVN", source: "wfs" as const, features: 12, areaHa: 402.11 },
];

const entrada = {
    jobId: "9f2c41ab-7de0-4c1a-9b55-teste0001",
    filename: "Fazenda de teste — recorte SIMCAR",
    sourceMode: "vectorized-analysis",
    summary: {
        propertyAreaHa: 1284.36,
        layersProcessed: 28,
        layersWithData: layers.length,
        totalFeaturesClipped: 46,
        layers,
        warnings: ["Camada TIPOLOGIA_VEGETAL truncada pelo WFS."],
    },
    analysisText: "## Parecer\n- **AC fora do shape:** Revisar — uso antrópico fora da AC.",
    analysisMeta: {
        globalVerdict: {
            acForaShape: "SIM",
            avnDentroShapeAntropizado: "INCONCLUSIVO",
            confidence: "MEDIA",
        },
        satelliteVerdicts: [
            { key: "l5_2003", label: "Landsat 5 (2003)", year: 2003, status: "used" },
            { key: "spot_2008", label: "SPOT 2008", year: 2008, status: "used" },
        ],
        coherence: { isCoherent: true, notes: [] },
    },
    analysisImages: [],
    auasImages: [],
};

/** Fixture do modelo compartilhado: exercita exclusão de camada e markdown da IA. */
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

let zip: JSZip;
let documentXml: string;
let headerXml: string;
let footerXml: string;

beforeAll(async () => {
    const buffer = await buildSimcarReportDocxBuffer(entrada);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    zip = await JSZip.loadAsync(buffer);
    const nomes = Object.keys(zip.files);
    documentXml = await zip.file("word/document.xml")!.async("string");
    headerXml = await zip.file(nomes.find((n) => /^word\/header\d+\.xml$/.test(n))!)!.async("string");
    footerXml = await zip.file(nomes.find((n) => /^word\/footer\d+\.xml$/.test(n))!)!.async("string");
}, 60_000);

/** Extrai o texto corrido do `document.xml`, que é onde o corpo do laudo vive. */
async function docxText(buffer: Buffer): Promise<string> {
    const loaded = await JSZip.loadAsync(buffer);
    const xml = (await loaded.file("word/document.xml")?.async("string")) || "";
    return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const semCerquilha = (cor: string) => cor.replace("#", "").toUpperCase();

describe("papel timbrado da IMAP no .docx", () => {
    it("embute o PNG do timbrado uma vez", async () => {
        // `zip.files` traz também a entrada de diretório — só arquivos contam.
        const midia = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir);
        expect(midia).toHaveLength(1);
        const bytes = await zip.file(midia[0])!.async("uint8array");
        expect(Buffer.from(bytes.subarray(1, 4)).toString("ascii")).toBe("PNG");
        expect(bytes.length).toBe(loadTimbradoImapPng()!.length);
    });

    it("usa as margens do Ofício (twips do sectPr)", () => {
        expect(documentXml).toMatch(/w:top="2154"/);
        expect(documentXml).toMatch(/w:bottom="1700"/);
        expect(documentXml).toMatch(/w:left="1418"/);
        expect(documentXml).toMatch(/w:right="1418"/);
        expect(documentXml).toMatch(/w:header="283"/);
    });

    it("cabeçalho traz o título com o tracking do Ofício e o fio verde", () => {
        expect(headerXml).toContain("LAUDO TÉCNICO SIMCAR");
        // `w:spacing w:val="100"` = 5 pt de tracking, igual ao Ofício.
        expect(headerXml).toMatch(/w:spacing w:val="100"/);
        expect(headerXml.toUpperCase()).toContain(semCerquilha(IMAP_COLORS.green));
        // A imagem flutuante fica atrás do texto.
        expect(headerXml).toMatch(/behindDoc="1"/);
    });

    it("rodapé traz o endereço da IMAP e o número da página", () => {
        for (const linha of IMAP_ADDRESS_LINES) {
            // O XML quebra o texto em runs; basta um trecho estável de cada linha.
            expect(footerXml).toContain(linha.split("|")[0].trim().slice(0, 20));
        }
        expect(footerXml).toContain("florestal@imap.eng.br");
        expect(footerXml).toContain("PAGE");
        expect(footerXml.toUpperCase()).toContain(semCerquilha(IMAP_COLORS.green));
        // Larguras exatas das 2 colunas do Ofício.
        expect(footerXml).toMatch(/w:w="7511"/);
        expect(footerXml).toMatch(/w:w="1559"/);
    });
});

describe("conteúdo vindo do report-theme", () => {
    it("traz o veredito e os achados calculados pelo modelo", () => {
        expect(documentXml).toContain("VEREDITO GERAL DA ANÁLISE");
        expect(documentXml).toContain("Requer revisão");
        expect(documentXml).toContain("Uso consolidado fora do polígono AC");
        expect(documentXml).toContain("Confiança: Média");
    });

    it("desenha a linha do tempo com o marco de 2008", () => {
        expect(documentXml).toContain("Linha do Tempo da Análise");
        expect(documentXml).toContain("2003");
        expect(documentXml).toContain("2008");
    });

    it("INSERE a tabela de quantitativos, não só o título", () => {
        expect(documentXml).toContain("Quantitativos por Camada");
        // Regressão do rascunho: a tabela era montada e descartada.
        expect(documentXml).toContain("AREA_CONSOLIDADA");
        expect(documentXml).toContain("812.40");
        expect(documentXml).toContain("Restrição");
    });

    it("traz fundamentação legal e a ressalva do responsável técnico", () => {
        expect(documentXml).toContain("Fundamentação Legal Aplicada");
        expect(documentXml).toContain("12.651/2012");
        expect(documentXml).toContain("Este laudo não substitui o parecer do responsável técnico");
    });

    it("sem análise de IA ainda produz documento (quem recusa é o generateAndPersist*)", async () => {
        const buffer = await buildSimcarReportDocxBuffer({ ...entrada, analysisText: undefined, analysisMeta: undefined });
        expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
        const semIa = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
        // Sem achados o painel muda de rótulo — é o report-theme decidindo.
        expect(semIa).toContain("Sem análise de IA");
        expect(semIa).toContain("Quantitativos por Camada");
    });
});

describe("buildSimcarReportDocxBuffer — modelo compartilhado com o PDF", () => {
    it("gera um .docx válido (OOXML zipado, com o document.xml no lugar)", async () => {
        const buffer = await buildSimcarReportDocxBuffer(baseArgs());
        expect(buffer.length).toBeGreaterThan(1000);
        // Assinatura de ZIP — .docx é um ZIP com o pacote OOXML dentro.
        expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
        expect((await JSZip.loadAsync(buffer)).file("word/document.xml")).toBeTruthy();
    });

    it("traz o mesmo conteúdo estrutural do PDF", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("Laudo Técnico SIMCAR");
        expect(texto).toContain("VEREDITO GERAL DA ANÁLISE");
        expect(texto).toContain("Resumo Executivo");
        expect(texto).toContain("Quadro de Achados");
        expect(texto).toContain("Quantitativos por Camada");
        expect(texto).toContain("Fundamentação Legal Aplicada");
        expect(texto).toContain("Como ler AC, AUAS e AVN neste laudo");
    });

    it("não vaza TIPOLOGIA_VEGETAL — nem na tabela, nem nos avisos", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).not.toContain("TIPOLOGIA_VEGETAL");
        // o aviso de truncamento da camada excluída também não faz sentido aqui
        expect(texto).not.toContain("truncada em 50.000");
    });

    it("os contadores descontam a camada excluída", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        // 28 camadas do template - 1 excluída = 27; 2 delas com dados.
        expect(texto).toContain("2/27");
        // 12 + 4 feições, sem as 50.000 da tipologia
        expect(texto).toContain("16");
    });

    it("preserva a estrutura markdown que a IA produziu", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        // O renderizador pode aplicar estilo próprio ao título da seção
        // (caixa alta), então a comparação ignora a caixa.
        expect(texto.toUpperCase()).toContain("VEREDITO OBJETIVO");
        expect(texto).toContain("AC fora do shape");
        expect(texto).toContain("Parágrafo de conclusão técnica do laudo.");
    });

    it("usa o vocabulário corrigido: AC é uso consolidado", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("uso consolidado");
    });

    it("mostra a janela temporal 2003–2008 na linha do tempo", async () => {
        const texto = await docxText(await buildSimcarReportDocxBuffer(baseArgs()));
        expect(texto).toContain("Linha do Tempo da Análise");
        expect(texto).toContain("2003");
        expect(texto).toContain("2008");
    });

    it("não quebra quando não há análise nenhuma", async () => {
        const buffer = await buildSimcarReportDocxBuffer({
            jobId: "job-vazio",
            filename: "Recorte sem análise",
            summary: { propertyAreaHa: 10, layersProcessed: 28, layers: [] },
        } as any);
        const texto = await docxText(buffer);
        expect(texto).toContain("Nenhuma sobreposição encontrada");
        expect(texto).toContain("Sem análise de IA");
    });
});
