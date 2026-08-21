/**
 * Gera um laudo PDF de amostra, sem rede e sem Firebase, para conferência visual
 * do layout (`simcar-report-v3`, no papel timbrado da IMAP).
 *
 *   npx tsx scripts/preview-laudo-pdf.ts [saida.pdf] [--fase=acavn|pre2008|pos2008|acveg]
 *
 * Os dados são fictícios mas têm a MESMA forma das metas reais das fases, para
 * exercitar semáforo, quadro de achados, linha do tempo e markdown estruturado.
 */
import fs from "fs";
import path from "path";

import { buildSimcarReportPdfBuffer } from "../backend/simcar/report";

const outPath = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "laudo-preview.pdf");
const fase = (process.argv.find((a) => a.startsWith("--fase="))?.split("=")[1] || "acavn") as
    | "acavn"
    | "pre2008"
    | "pos2008"
    | "acveg";

const layers = [
    { name: "ATP", source: "property" as const, features: 1, areaHa: 1284.36 },
    { name: "AREA_CONSOLIDADA", source: "wfs" as const, features: 33, areaHa: 812.4 },
    { name: "AVN", source: "wfs" as const, features: 12, areaHa: 402.11 },
    { name: "ARL", source: "wfs" as const, features: 2, areaHa: 257.9 },
    { name: "AUAS", source: "wfs" as const, features: 8, areaHa: 96.72 },
    { name: "RIO_ATE_10", source: "wfs" as const, features: 14, areaHa: 21.08 },
    { name: "NASCENTE", source: "wfs" as const, features: 5, areaHa: 3.14 },
    { name: "AREA_DECLIVIDADE", source: "wfs" as const, features: 3, areaHa: 44.2 },
];

const summary = {
    propertyAreaHa: 1284.36,
    crs: "EPSG:4674",
    layersProcessed: 28,
    layersWithData: layers.length,
    totalFeaturesClipped: layers.reduce((sum, l) => sum + l.features, 0),
    layers,
    warnings: ["Camada TIPOLOGIA_VEGETAL truncada em 50.000 feições pelo WFS."],
};

const analysisText = [
    "## Parecer Técnico AC/AVN",
    "AC precisa de revisão; AVN ficou inconclusiva. Confiança geral: **Média**.",
    "",
    "## Decisão por Tema",
    "- **AC fora do shape:** Revisar — foi detectado uso antrópico fora do polígono AC. Revisar o limite da AC nos trechos apontados.",
    "- **Antropização dentro da AVN:** Inconclusivo — não houve segurança suficiente para confirmar a integridade da AVN.",
    "- **Relação AVN x AUAS:** Sem ajuste indicado — não há indicação de conflito visual entre AVN e AUAS.",
    "",
    "## Imagens Avaliadas",
    "- **Landsat 5 (2003):** AC fora do shape não detectada; AVN inconclusiva. Confiança média (apoio válido).",
    "- **SPOT 2008:** AC fora do shape detectada; antropização dentro da AVN não detectada. Confiança alta (maior peso por melhor resolução).",
    "",
    "## Conclusão Técnica",
    "- Há indicação de ajuste vetorial. Priorize os trechos onde a imagem mostra uso antrópico fora da AC.",
    "- O resultado da AVN é parcialmente inconclusivo nas bordas de transição a nordeste, onde a textura é ambígua entre campo nativo e pastagem degradada, e por isso a decisão deve ser tratada com cautela técnica antes de qualquer alteração de shape submetida ao SIMCAR.",
].join("\n");

const analysisMeta = {
    globalVerdict: {
        acForaShape: "SIM",
        avnDentroShapeAntropizado: "INCONCLUSIVO",
        avnParcialForaShapeMasEmAuas: "NAO",
        confidence: "MEDIA",
    },
    satelliteVerdicts: [
        { key: "landsat5_2003", label: "Landsat 5 (2003)", year: 2003, status: "used" },
        { key: "landsat5_2005", label: "Landsat 5 (2005)", year: 2005, status: "used" },
        { key: "landsat5_2006", label: "Landsat 5 (2006)", year: 2006, status: "missing" },
        { key: "landsat5_2007", label: "Landsat 5 (2007)", year: 2007, status: "used" },
        { key: "spot_2008", label: "SPOT 2008", year: 2008, status: "used" },
        { key: "landsat5_2008", label: "Landsat 5 (2008)", year: 2008, status: "used" },
    ],
    coherence: { isCoherent: false, notes: ["SPOT (2.5m) indica SIM, prevalece por maior resolução."] },
    cloudWarnings: [{ satellite: "Landsat 5 (2006)", cloudScore: 0.62 }],
};

const auasByFase: Record<string, { text: string; meta: any }> = {
    acavn: { text: "", meta: undefined },
    pre2008: {
        text: [
            "## Resumo executivo",
            "Sete polígonos AUAS analisados na série 2003–2008; dois apresentam sinal de antropização anterior ao marco.",
            "",
            "### AUAS-0002",
            "- **Status:** Alerta pré-2008. Área: 12,35 ha.",
            "- Evidência: uso antrópico já visível na cena de 2005 e mantido até 2008.",
        ].join("\n"),
        meta: {
            schemaVersion: 2,
            rulesVersion: "auas-pre2008-v1",
            status: "ALERTA_PRE_2008",
            pre2008Alert: true,
            confidence: "ALTA",
            summary: { polygonCount: 7, alertCount: 2, inconclusiveCount: 1, noEvidenceCount: 4, totalAuasAreaHa: 96.72, alertAreaHa: 21.4 },
            scenes: [2003, 2004, 2005, 2006, 2007, 2008].map((year) => ({
                year,
                sensor: year === 2008 ? "SPOT" : "LANDSAT_5",
                usability: year === 2006 ? "CLOUD_OR_OCCLUSION" : "USABLE",
            })),
            limitations: ["Cena de 2006 descartada por nuvem sobre a porção sul do imóvel."],
        },
    },
    pos2008: {
        text: [
            "## Resumo executivo",
            "Cinco polígonos AUAS datados na série 2009–2019; dois com ano confirmado.",
            "",
            "### AUAS-0004",
            "- **Status:** Conversão confirmada em ano. Ano observado: 2014.",
        ].join("\n"),
        meta: {
            phase: "POS_2008",
            rulesVersion: "auas-pos2008-v1",
            summary: {
                polygonCount: 5,
                confirmedYearCount: 2,
                intervalCount: 1,
                alreadyAnthropizedCount: 1,
                noChangeCount: 1,
                inconclusiveCount: 0,
                totalAuasAreaHa: 96.72,
                yearHistogram: { 2014: { count: 1, areaHa: 18.2 }, 2017: { count: 1, areaHa: 9.4 } },
            },
            catalog: {
                years: [2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
                missingYears: [2016],
                layerByYear: { 2009: "Mosaicos:LANDSAT_5_2009", 2012: "Mosaicos:RESOURCESAT_2012", 2019: "Mosaicos:SENTINEL_2_2019" },
            },
            polygons: [{ firstDetectedYear: 2014 }, { firstDetectedYear: 2017 }],
            limitations: ["Ano de 2016 reprovado no GetMap; intervalo, não data exata, para os polígonos afetados."],
        },
    },
    acveg: {
        text: [
            "## Resumo executivo",
            "Quatro polígonos de Área Consolidada avaliados; dois apresentam feição de vegetação na cena atual.",
        ].join("\n"),
        meta: {
            phase: "AC_VEG",
            rulesVersion: "ac-vegetacao-v1",
            summary: {
                polygonCount: 4,
                totalAcAreaHa: 812.4,
                declaredVegetationCount: 1,
                declaredVegetationAreaHa: 6.2,
                apparentVegetationCount: 2,
                cleanCount: 1,
                inconclusiveCount: 1,
            },
            scenes: [
                { year: 2024, sensor: "SENTINEL_2", usability: "USABLE" },
                { year: 2025, sensor: "SENTINEL_2", usability: "USABLE" },
                { year: 2008, sensor: "SPOT", usability: "USABLE" },
            ],
            limitations: [],
        },
    },
};

const auas = auasByFase[fase];

const buffer = await buildSimcarReportPdfBuffer({
    jobId: "9f2c41ab-7de0-4c1a-9b55-preview0001",
    filename: "Fazenda Santa Clara — recorte SIMCAR (amostra)",
    sourceMode: "vectorized-analysis",
    summary,
    analysisText: fase === "acavn" ? analysisText : analysisText,
    analysisMeta,
    analysisImages: [],
    auasText: auas.text || undefined,
    auasMeta: auas.meta,
    auasImages: [],
});

fs.writeFileSync(outPath, buffer);
console.log(`PDF de amostra (${fase}): ${outPath} — ${(buffer.length / 1024).toFixed(1)} KB`);
