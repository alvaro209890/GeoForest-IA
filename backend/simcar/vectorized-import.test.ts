/**
 * Modo "Análise de vetorização" — o fluxo que recebe um ZIP do modelo SIMCAR já
 * vetorizado e roda a mesma análise de IA do pós-recorte, **sem recorte WFS**.
 *
 * Até 21/08/2026 esta aba não tinha teste nenhum. Ela é a que menos se mexe e a
 * que mais depende de dado real: o ZIP vem do usuário, com as camadas que ele
 * vetorizou, e o parser precisa reconstruir o imóvel a partir de ATP/AIR sem
 * nenhuma consulta externa.
 *
 * Por isso estes testes rodam contra o **ZIP real versionado**
 * (`backend/fixtures/teste_1/*.zip`, o CAR da Santa Clara). Vale a regra que já
 * custou caro neste repo: teste sintético não valida código geométrico.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { parseCachedContextFromOutputZip } from "./hydration";
import { buildSimcarReportDocxBuffer } from "./report-docx";
import { buildSimcarReportPdfBuffer } from "./report";
import { isExcludedFromExport } from "./constants";
import { extractZipEntries } from "../geo-utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip");
const temFixture = fs.existsSync(FIXTURE);

const descreveComFixture = temFixture ? describe : describe.skip;

descreveComFixture("import vetorizado — ZIP real do CAR Santa Clara", () => {
    const zip = temFixture ? fs.readFileSync(FIXTURE) : Buffer.alloc(0);

    it("reconstrói o imóvel a partir do ATP, sem consulta externa", () => {
        const parsed = parseCachedContextFromOutputZip(zip, "santa_clara.zip");
        expect(parsed).toBeTruthy();
        expect(parsed!.propertySourceLayer).toBe("ATP");
        expect(parsed!.polygon).toBeTruthy();
        // O imóvel tem ~38.037 ha; a tolerância cobre variação de projeção.
        expect(parsed!.areaHa).toBeGreaterThan(37_000);
        expect(parsed!.areaHa).toBeLessThan(39_000);
    });

    it("devolve bbox coerente com Mato Grosso", () => {
        const [minX, minY, maxX, maxY] = parseCachedContextFromOutputZip(zip, "f.zip")!.bbox!;
        expect(minX).toBeLessThan(maxX);
        expect(minY).toBeLessThan(maxY);
        // MT fica entre ~-61 e ~-50 de longitude e ~-18 e ~-7 de latitude.
        expect(minX).toBeGreaterThan(-62);
        expect(maxX).toBeLessThan(-50);
        expect(minY).toBeGreaterThan(-19);
        expect(maxY).toBeLessThan(-7);
    });

    it("lê as camadas que a análise AC/AVN e AUAS consomem", () => {
        const parsed = parseCachedContextFromOutputZip(zip, "f.zip")!;
        const comDados = (parsed.layerSummaries || []).filter((l) => Number(l.features || 0) > 0);
        const nomes = comDados.map((l) => l.name);
        for (const obrigatoria of ["ATP", "AREA_CONSOLIDADA", "AVN", "AUAS"]) {
            expect(nomes, `${obrigatoria} ausente`).toContain(obrigatoria);
        }
        // As geometrias precisam chegar ao renderizador de overlay, não só o resumo.
        for (const obrigatoria of ["AREA_CONSOLIDADA", "AVN", "AUAS"]) {
            expect(parsed.clippedGeometries?.get(obrigatoria)?.length || 0).toBeGreaterThan(0);
        }
    });

    it("classifica ATP/AIR como camada de propriedade e o resto como WFS", () => {
        const parsed = parseCachedContextFromOutputZip(zip, "f.zip")!;
        const porNome = new Map((parsed.layerSummaries || []).map((l) => [l.name, l]));
        expect(porNome.get("ATP")?.source).toBe("property");
        expect(porNome.get("AIR")?.source).toBe("property");
        expect(porNome.get("AVN")?.source).toBe("wfs");
    });

    it("camada vazia do modelo entra com 0 feições, sem virar erro", () => {
        const parsed = parseCachedContextFromOutputZip(zip, "f.zip")!;
        // O Modelo.zip traz shapefiles vazios (100 bytes) das camadas não usadas.
        const vazias = (parsed.layerSummaries || []).filter((l) => Number(l.features || 0) === 0);
        expect(vazias.length).toBeGreaterThan(0);
        expect(parsed.warnings || []).toEqual([]);
    });

    it("não gasta tempo desproporcional (o import é síncrono no request)", () => {
        const t0 = Date.now();
        parseCachedContextFromOutputZip(zip, "f.zip");
        expect(Date.now() - t0).toBeLessThan(10_000);
    });
});

descreveComFixture("laudo do modo vetorizado", () => {
    const zip = temFixture ? fs.readFileSync(FIXTURE) : Buffer.alloc(0);

    /** Mesmo `summary` que a rota `/import-vectorized` monta a partir do parse. */
    function summaryDoImport() {
        const parsed = parseCachedContextFromOutputZip(zip, "santa_clara.zip")!;
        const layers = parsed.layerSummaries || [];
        return {
            propertyAreaHa: Number(parsed.areaHa || 0),
            crs: "EPSG:4674",
            layersProcessed: layers.length,
            layersWithData: layers.filter((l) => Number(l.features || 0) > 0).length,
            totalFeaturesClipped: layers.reduce((sum, l) => sum + Number(l.features || 0), 0),
            processingTimeMs: 0,
            layers,
            warnings: parsed.warnings,
        };
    }

    const analiseIntegrada = [
        "## Resumo Geral",
        "Analise integrada AC/AVN e AUAS do ZIP vetorizado.",
        "## Veredito Integrado",
        "- **AC fora do shape:** conforme.",
    ].join("\n");

    it("o ZIP importado tem TIPOLOGIA_VEGETAL, e o laudo não a exibe", async () => {
        const summary = summaryDoImport();
        // A camada existe mesmo no ZIP do usuário — é isso que torna o filtro necessário.
        expect(summary.layers.some((l) => isExcludedFromExport(l.name) && Number(l.features || 0) > 0)).toBe(true);

        const pdf = await buildSimcarReportPdfBuffer({
            jobId: "vetorizado-1",
            filename: "Santa Clara (vetorizado)",
            sourceMode: "vectorized-analysis",
            summary,
            analysisText: analiseIntegrada,
            analysisImages: [],
            auasImages: [],
        });
        expect(pdf.length).toBeGreaterThan(1000);

        const docx = await buildSimcarReportDocxBuffer({
            jobId: "vetorizado-1",
            filename: "Santa Clara (vetorizado)",
            sourceMode: "vectorized-analysis",
            summary,
            analysisText: analiseIntegrada,
        });
        const xml = extractZipEntries(docx).find((e) => e.name === "word/document.xml")!.data.toString("utf8");
        const texto = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        expect(texto).not.toContain("TIPOLOGIA_VEGETAL");
        expect(texto).toContain("AREA_CONSOLIDADA");
        expect(texto).toContain("Laudo Técnico SIMCAR");
    });

    it("o laudo do modo vetorizado sai com os mesmos blocos do modo recorte", async () => {
        const docx = await buildSimcarReportDocxBuffer({
            jobId: "vetorizado-2",
            filename: "Santa Clara (vetorizado)",
            sourceMode: "vectorized-analysis",
            summary: summaryDoImport(),
            analysisText: analiseIntegrada,
        });
        const xml = extractZipEntries(docx).find((e) => e.name === "word/document.xml")!.data.toString("utf8");
        const texto = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        for (const bloco of [
            "VEREDITO GERAL DA ANÁLISE",
            "Resumo Executivo",
            "Quantitativos por Camada",
            "Fundamentação Legal Aplicada",
            "Como ler AC, AUAS e AVN neste laudo",
            "Limitações e Observações Técnicas",
        ]) {
            expect(texto, `bloco ausente: ${bloco}`).toContain(bloco);
        }
    });
});

describe("import vetorizado — ZIP inválido", () => {
    it("rejeita ZIP sem nenhuma camada com geometria", () => {
        // ZIP vazio válido (EOCD só) — não tem .shp nenhum.
        const eocdVazio = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
        const parsed = parseCachedContextFromOutputZip(eocdVazio, "vazio.zip");
        // A rota trata tanto `null` quanto contexto sem polígono como 400.
        expect(parsed === null || !parsed.polygon).toBe(true);
    });
});
