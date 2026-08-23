// Gera o PDF da Fase 1 v2 a partir do JSON salvo (mesmo caminho de código da
// rota HTTP: buildSimcarReportPdfBuffer com auasMeta + auasText).
import fs from "node:fs";

const meta = JSON.parse(fs.readFileSync("/tmp/f1_v2_result.json", "utf-8"));

const { buildSimcarReportPdfBuffer } = await import("../backend/simcar/report.ts");

const summary = {
    propertyAreaHa: 265.0071,
    crs: "EPSG:4674",
    layersProcessed: 28,
    layersWithData: 9,
    totalFeaturesClipped: 45,
    layers: [
        { name: "AIR", features: 2, areaHa: 0 },
        { name: "ATP", features: 2, areaHa: 0 },
        { name: "AREA_CONSOLIDADA", features: 3, areaHa: 137.3665 },
        { name: "AUAS", features: 3, areaHa: 33.4517 },
        { name: "AVN", features: 9, areaHa: 93.8731 },
        { name: "ARL", features: 8, areaHa: 93.2515 },
        { name: "RIO_ATE_10", features: 5, areaHa: 1.4811 },
        { name: "TIPOLOGIA_VEGETAL", features: 6, areaHa: 264.6841 },
        { name: "AREA_UMIDA", features: 7, areaHa: 15.3995 },
    ],
    warnings: [],
};

const pdf = await buildSimcarReportPdfBuffer({
    jobId: meta.jobId,
    filename: "SIMCAR_Recorte_2026-08-17T19-20-30.zip",
    sourceMode: "auto-clip",
    summary,
    analysisText: "",
    analysisMeta: null,
    auasText: meta.report.markdown,
    auasImages: [],
    analysisImages: [],
    auasMeta: meta,
});

fs.writeFileSync("/tmp/Laudo_Fase1_v2_imovel_real.pdf", pdf);
console.log(`PDF salvo: /tmp/Laudo_Fase1_v2_imovel_real.pdf (${(pdf.length / 1024 / 1024).toFixed(2)} MB)`);
