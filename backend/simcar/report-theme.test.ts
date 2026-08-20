import { describe, expect, it } from "vitest";

import {
    buildAcAvnFindings,
    buildAuasFindings,
    buildExecutiveBullets,
    buildTimelineModel,
    buildVerdictPanel,
    classifyLayerNature,
    detectReportKind,
    MARCO_CODIGO_FLORESTAL_YEAR,
    MARCO_POUSIO_YEAR,
    parseMarkdownBlocks,
    reportKindSectionTitle,
    splitLongParagraph,
    worstTone,
    type Finding,
} from "./report-theme";

describe("detectReportKind", () => {
    it("reconhece cada fase pelo formato da meta que chega ao PDF", () => {
        expect(detectReportKind({ phase: "AC_VEG" })).toBe("AC_VEG");
        expect(detectReportKind({ phase: "POS_2008" })).toBe("AUAS_POS2008");
        expect(detectReportKind({ rulesVersion: "auas-pos2008-v1" })).toBe("AUAS_POS2008");
        expect(detectReportKind({ schemaVersion: 2, rulesVersion: "auas-pre2008-v1" })).toBe("AUAS_PRE2008");
        expect(detectReportKind({ finalStatus: "AUAS_VALIDA" })).toBe("AUAS_V1");
        expect(detectReportKind(null)).toBe("GENERICO");
    });

    it("não rotula a Fase 3 como AUAS — o título antigo era sempre o mesmo", () => {
        expect(reportKindSectionTitle(detectReportKind({ phase: "AC_VEG" }))).toContain("Fase 3");
        expect(reportKindSectionTitle(detectReportKind({ phase: "POS_2008" }))).toContain("Fase 2");
        expect(reportKindSectionTitle("AUAS_V1")).toContain("Uso Alternativo do Solo");
    });
});

describe("buildAcAvnFindings", () => {
    it("traduz SIM em 'revisar' vermelho e NAO em 'conforme' verde", () => {
        const findings = buildAcAvnFindings({
            globalVerdict: { acForaShape: "SIM", avnDentroShapeAntropizado: "NAO", confidence: "ALTA" },
            coherence: { isCoherent: true, notes: [] },
        });
        const ac = findings.find((f) => f.label.includes("fora do polígono AC"))!;
        const avn = findings.find((f) => f.label.includes("dentro do polígono AVN"))!;
        expect(ac.tone).toBe("danger");
        expect(ac.status).toBe("Revisar");
        expect(avn.tone).toBe("ok");
        expect(avn.status).toBe("Conforme");
    });

    it("INCONCLUSIVO é amarelo, nunca verde — pendência não é aprovação", () => {
        const findings = buildAcAvnFindings({
            globalVerdict: { acForaShape: "INCONCLUSIVO", avnDentroShapeAntropizado: "INCONCLUSIVO" },
            coherence: { isCoherent: true, notes: [] },
        });
        expect(findings.filter((f) => f.tone === "warn").length).toBeGreaterThanOrEqual(2);
        expect(findings.some((f) => f.tone === "ok" && f.label.includes("polígono"))).toBe(false);
    });

    it("marca divergência entre cenas e nuvem como pendência", () => {
        const findings = buildAcAvnFindings({
            globalVerdict: { acForaShape: "NAO", avnDentroShapeAntropizado: "NAO" },
            coherence: { isCoherent: false, notes: ["SPOT discorda do Landsat"] },
            cloudWarnings: [{ satellite: "Landsat 5 (2007)", cloudScore: 0.7 }],
        });
        expect(findings.find((f) => f.label.includes("Coerência"))!.tone).toBe("warn");
        expect(findings.find((f) => f.label.includes("Nuvem"))!.status).toBe("1 cena(s)");
    });

    it("devolve lista vazia quando não houve análise AC/AVN", () => {
        expect(buildAcAvnFindings(undefined)).toEqual([]);
        expect(buildAcAvnFindings({})).toEqual([]);
    });
});

describe("buildAuasFindings", () => {
    it("Fase 1: alerta pré-2008 é vermelho e conta polígonos inconclusivos", () => {
        const findings = buildAuasFindings({
            schemaVersion: 2,
            rulesVersion: "auas-pre2008-v1",
            status: "ALERTA_PRE_2008",
            pre2008Alert: true,
            summary: { polygonCount: 7, alertCount: 2, inconclusiveCount: 3, totalAuasAreaHa: 41.5 },
        });
        expect(findings[0].tone).toBe("danger");
        expect(findings[0].status).toBe("Alerta pré-2008");
        expect(findings.some((f) => f.label === "Polígonos inconclusivos" && f.tone === "warn")).toBe(true);
    });

    it("Fase 1 sem alerta fica verde", () => {
        const findings = buildAuasFindings({
            schemaVersion: 2,
            status: "SEM_EVIDENCIA_PRE_2008",
            pre2008Alert: false,
            summary: { polygonCount: 3, alertCount: 0, inconclusiveCount: 0, totalAuasAreaHa: 10 },
        });
        expect(findings[0].tone).toBe("ok");
    });

    it("Fase 2 resume datação por ano confirmado e intervalo", () => {
        const findings = buildAuasFindings({
            phase: "POS_2008",
            summary: {
                polygonCount: 5,
                confirmedYearCount: 2,
                intervalCount: 1,
                alreadyAnthropizedCount: 1,
                noChangeCount: 1,
                inconclusiveCount: 0,
            },
        });
        expect(findings[0].status).toBe("3 de 5");
        expect(findings.find((f) => f.label.includes("inconclusivos"))!.tone).toBe("ok");
    });

    it("Fase 3 acusa vegetação aparente dentro da AC", () => {
        const findings = buildAuasFindings({
            phase: "AC_VEG",
            summary: {
                polygonCount: 4,
                totalAcAreaHa: 300,
                declaredVegetationCount: 0,
                declaredVegetationAreaHa: 0,
                apparentVegetationCount: 2,
                cleanCount: 2,
                inconclusiveCount: 0,
            },
        });
        expect(findings[0].tone).toBe("danger");
        expect(findings[0].status).toBe("2");
    });
});

describe("buildVerdictPanel", () => {
    const finding = (tone: Finding["tone"], label = "Achado"): Finding => ({
        label,
        status: "x",
        tone,
        detail: "detalhe",
    });

    it("um achado vermelho manda no painel inteiro", () => {
        const panel = buildVerdictPanel({
            findings: [finding("ok"), finding("danger", "AC fora do shape")],
            kind: "AC_AVN",
        });
        expect(panel.tone).toBe("danger");
        expect(panel.title).toBe("Requer revisão");
        expect(panel.headline).toContain("AC fora do shape");
    });

    it("só pendências viram 'parcialmente inconclusivo'", () => {
        const panel = buildVerdictPanel({ findings: [finding("ok"), finding("warn")], kind: "AC_AVN" });
        expect(panel.title).toBe("Parcialmente inconclusivo");
        expect(panel.tone).toBe("warn");
    });

    it("tudo verde não indica ajuste", () => {
        const panel = buildVerdictPanel({
            findings: [finding("ok"), finding("ok")],
            kind: "AC_AVN",
            analysisMeta: { globalVerdict: { confidence: "ALTA" } },
        });
        expect(panel.title).toBe("Sem ajuste indicado");
        expect(panel.confidence).toBe("Alta");
        expect(panel.confidenceTone).toBe("ok");
    });

    it("sem análise nenhuma o painel é neutro e diz isso", () => {
        const panel = buildVerdictPanel({ findings: [], kind: "GENERICO" });
        expect(panel.tone).toBe("neutral");
        expect(panel.title).toBe("Sem análise de IA");
    });
});

describe("worstTone", () => {
    it("escolhe a pior gravidade da lista", () => {
        expect(worstTone(["ok", "info", "warn"])).toBe("warn");
        expect(worstTone(["warn", "danger", "ok"])).toBe("danger");
        expect(worstTone(["ok"])).toBe("ok");
        expect(worstTone([])).toBe("ok");
    });
});

describe("buildTimelineModel", () => {
    it("monta a série a partir dos vereditos por satélite e marca o ano sem cena", () => {
        const model = buildTimelineModel({
            analysisMeta: {
                satelliteVerdicts: [
                    { key: "landsat5_2003", label: "Landsat 5 (2003)", year: 2003, status: "used" },
                    { key: "landsat5_2005", label: "Landsat 5 (2005)", year: 2005, status: "missing" },
                    { key: "spot_2008", label: "SPOT 2008", year: 2008, status: "used" },
                ],
            },
        })!;
        expect(model.firstYear).toBe(2003);
        expect(model.lastYear).toBe(2008);
        expect(model.markerYear).toBe(MARCO_CODIGO_FLORESTAL_YEAR);
        expect(model.years.find((y) => y.year === 2005)!.state).toBe("missing");
        expect(model.years.find((y) => y.year === 2008)!.label).toBe("SPOT");
    });

    it("ano com conversão datada vira evento e sobrepõe 'cena utilizável'", () => {
        const model = buildTimelineModel({
            auasMeta: {
                phase: "POS_2008",
                catalog: { years: [2009, 2010, 2011], missingYears: [], layerByYear: { 2009: "Mosaicos:LANDSAT_5_2009" } },
                summary: { yearHistogram: { 2010: { count: 2, areaHa: 12 } } },
                polygons: [{ firstDetectedYear: 2010 }],
            },
        })!;
        expect(model.eventYears).toEqual([2010]);
        expect(model.years.find((y) => y.year === 2010)!.state).toBe("event");
        expect(model.years.find((y) => y.year === 2009)!.state).toBe("used");
    });

    it("marco fica nulo quando a série não alcança 2008", () => {
        const model = buildTimelineModel({
            auasMeta: { catalog: { years: [2009, 2010], missingYears: [], layerByYear: {} } },
        })!;
        expect(model.markerYear).toBeNull();
    });

    it("sem análise temporal não há linha do tempo", () => {
        expect(buildTimelineModel({})).toBeNull();
        expect(buildTimelineModel({ analysisMeta: { satelliteVerdicts: [] } })).toBeNull();
    });

    it("cena não utilizável da fase entra como ano sem cena", () => {
        const model = buildTimelineModel({
            auasMeta: {
                scenes: [
                    { year: 2003, sensor: "LANDSAT_5", usability: "USABLE" },
                    { year: 2004, sensor: "LANDSAT_5", usability: "CLOUD_OR_OCCLUSION" },
                ],
            },
        })!;
        expect(model.years.find((y) => y.year === 2004)!.state).toBe("missing");
        expect(model.years.find((y) => y.year === 2003)!.label).toBe("L5");
    });
});

describe("buildExecutiveBullets", () => {
    it("abre com o quantitativo e fecha com o aviso de revisão", () => {
        const bullets = buildExecutiveBullets({
            jobId: "job-1",
            totalLayers: 28,
            layersWithData: 6,
            totalFeatures: 42,
            propertyAreaHa: 1234.5,
            findings: [{ label: "AC fora", status: "Revisar", tone: "danger", detail: "detalhe" }],
            timeline: {
                years: [{ year: 2003, state: "used" }, { year: 2008, state: "used" }],
                firstYear: 2003,
                lastYear: 2008,
                markerYear: 2008,
                eventYears: [],
                caption: "",
            },
        });
        expect(bullets[0].text).toContain("1234.50 ha");
        expect(bullets[1].text).toContain("2003–2008");
        expect(bullets.some((b) => b.text.includes("AC fora") && b.tone === "danger")).toBe(true);
        expect(bullets[bullets.length - 1].text).toContain("responsável técnico");
    });

    it("limita a 5 achados para o resumo não virar texto massante", () => {
        const findings: Finding[] = Array.from({ length: 9 }, (_, i) => ({
            label: `Achado ${i}`,
            status: "x",
            tone: "warn" as const,
            detail: "d",
        }));
        const bullets = buildExecutiveBullets({
            jobId: "j",
            totalLayers: 1,
            layersWithData: 1,
            totalFeatures: 1,
            propertyAreaHa: 1,
            findings,
        });
        expect(bullets.filter((b) => b.text.startsWith("Achado")).length).toBe(5);
    });
});

describe("parseMarkdownBlocks", () => {
    it("preserva títulos e bullets que a limpeza antiga achatava em parágrafo", () => {
        const blocks = parseMarkdownBlocks(
            [
                "## Decisão por Tema",
                "- **AC fora do shape:** Revisar — foi detectado uso antrópico.",
                "- Linha simples sem rótulo.",
                "",
                "Parágrafo comum de fechamento.",
            ].join("\n"),
        );
        expect(blocks[0]).toEqual({ type: "heading", text: "Decisão por Tema" });
        expect(blocks[1]).toEqual({
            type: "bullet",
            label: "AC fora do shape",
            text: "Revisar — foi detectado uso antrópico.",
        });
        expect(blocks[2]).toEqual({ type: "bullet", label: null, text: "Linha simples sem rótulo." });
        expect(blocks[3]).toEqual({ type: "paragraph", text: "Parágrafo comum de fechamento." });
    });

    it("junta linhas soltas no mesmo parágrafo e remove marcação inline", () => {
        const blocks = parseMarkdownBlocks("Primeira linha **forte**\nsegunda linha `code`.");
        expect(blocks).toEqual([{ type: "paragraph", text: "Primeira linha forte segunda linha code." }]);
    });

    it("aceita bullets numerados e ignora entrada vazia", () => {
        expect(parseMarkdownBlocks("1. Primeiro item")[0]).toEqual({
            type: "bullet",
            label: null,
            text: "Primeiro item",
        });
        expect(parseMarkdownBlocks("")).toEqual([]);
        expect(parseMarkdownBlocks("   \n\n  ")).toEqual([]);
    });
});

describe("splitLongParagraph", () => {
    it("quebra parágrafo longo em frases inteiras", () => {
        const long = `${"Frase de teste com tamanho razoável. ".repeat(20)}`;
        const parts = splitLongParagraph(long, 200);
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) expect(part.length).toBeLessThanOrEqual(240);
    });

    it("não mexe em parágrafo curto", () => {
        expect(splitLongParagraph("Curto.")).toEqual(["Curto."]);
        expect(splitLongParagraph("")).toEqual([]);
    });
});

describe("classifyLayerNature", () => {
    it("separa restrição legal de uso e de base cadastral", () => {
        expect(classifyLayerNature("ARL").nature).toBe("Restrição");
        expect(classifyLayerNature("rio_ate_10").nature).toBe("Restrição");
        expect(classifyLayerNature("AREA_CONSOLIDADA").nature).toBe("Uso");
        expect(classifyLayerNature("ATP").nature).toBe("Base");
        expect(classifyLayerNature("CAMADA_DESCONHECIDA").nature).toBe("Base");
    });
});

describe("marcos legais", () => {
    it("mantém as duas datas que definem a janela do laudo", () => {
        expect(MARCO_CODIGO_FLORESTAL_YEAR).toBe(2008);
        expect(MARCO_POUSIO_YEAR).toBe(2003);
    });
});
