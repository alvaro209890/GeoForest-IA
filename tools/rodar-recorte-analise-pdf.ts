// Recorte SIMCAR + análise de IA AUAS (pré-2008) + PDF — fluxo local completo.
// Uso: npx tsx tools/rodar-recorte-analise-pdf.ts <zip_do_imovel> <air_id> [--sem-tipologia] [--out <pdf>.pdf]
import fs from "node:fs";
import path from "node:path";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { buildSimcarReportPdfBuffer } from "../backend/simcar/report.ts";
import { runAuasPre2008Analysis } from "../backend/analise-pos-recorte/orchestrator.ts";

const TEMPLATE_SEM_TIPOLOGIA = ["AIR","ATP","AREA_CONSOLIDADA","AREA_USO_RESTRITO","INTERESSE_SOCIAL","UTILIDADE_PUBLICA","RIO_ATE_10","RIO_10_A_50","RIO_50_A_200","RIO_200_A_600","RIO_ACIMA_600","NASCENTE","RESERVATORIO_ARTIFICIAL","LAGOA_NATURAL","MANGUEZAL","RESTINGA","VEREDA","AREA_ALTITUDE_1800","AREA_DECLIVIDADE","AREA_TOPO_MORRO","BORDA_CHAPADA","ARL","ARLREM","AUAS","AURD","AVN","AREA_UMIDA"];

async function main() {
    const args = process.argv.slice(2);
    const zipPath = args[0];
    const airId = args[1];
    const semTipologia = args.includes("--sem-tipologia");
    const outIdx = args.indexOf("--out");
    const outPath = outIdx >= 0 ? args[outIdx + 1] : "/tmp/laudo_simcar.pdf";
    if (!zipPath || !airId) {
        console.error("Uso: rodar-recorte-analise-pdf.ts <zip_do_imovel> <air_id> [--sem-tipologia] [--out pdf]");
        process.exit(1);
    }

    const layers = semTipologia ? TEMPLATE_SEM_TIPOLOGIA : null;
    const zip = fs.readFileSync(zipPath);
    const fakeRes: any = {
        writableEnded: false, destroyed: false,
        setHeader() {}, flushHeaders() {}, write() { return true; },
        end() {}, flush() {},
    };

    // 1. RECORTE
    console.log("==> [1/3] Recorte SIMCAR com AIR", airId, "...");
    const r = await processClip(fakeRes, "", zip, null, null, layers, airId);
    console.log("    ok:", r.ok, "| jobId:", r.jobId, "| areaHa:", r.summary?.propertyAreaHa);
    if (!r.ok || !r.jobId) { console.error("RECORTE FALHOU"); process.exit(1); }
    for (const l of r.summary?.layers || []) {
        if (l.features > 0) console.log(`    ${l.name}: ${l.features} feicoes${l.areaHa ? " | " + l.areaHa.toFixed(4) + " ha" : ""}`);
    }
    const job: any = jobCache.get(r.jobId);
    if (!job?.clippedGeometries) { console.error("job sem clippedGeometries no cache"); process.exit(1); }

    // 2. ANÁLISE DE IA (AUAS pré-2008: 2003-2008, Landsat + SPOT, Groq Vision + DeepSeek)
    console.log("==> [2/3] Análise de IA pré-2008 (AUAS)...");
    const analysis = await runAuasPre2008Analysis(r.jobId, job.clippedGeometries, {
        onProgress: (p: any) => console.log(`    [${String(p.percent).padStart(3)}%] ${p.message}`),
    });
    console.log("    status:", analysis.status, "| alerta:", analysis.pre2008Alert, "| confiança:", analysis.confidence);
    console.log("    poly:", analysis.summary.polygonCount, "| alerta:", analysis.summary.alertCount,
        "| sem evidência:", analysis.summary.noEvidenceCount, "| inconclusivo:", analysis.summary.inconclusiveCount,
        "| área AUAS:", analysis.summary.totalAuasAreaHa?.toFixed?.(2) ?? analysis.summary.totalAuasAreaHa);
    console.log("    modelo do laudo:", analysis.report.model);

    // 3. PDF (mesma estrutura do app: painel de veredito, resumo executivo, achados, timeline)
    console.log("==> [3/3] Gerando PDF técnico...");
    const summary = job.layerSummaries ? {
        propertyAreaHa: job.areaHa || r.summary?.propertyAreaHa || 0,
        crs: "EPSG:4674",
        layersProcessed: job.layerSummaries.length,
        layersWithData: job.layerSummaries.filter((l: any) => l.features > 0).length,
        totalFeaturesClipped: job.layerSummaries.reduce((s: number, l: any) => s + Number(l.features || 0), 0),
        processingTimeMs: 0,
        layers: job.layerSummaries,
        warnings: job.warnings,
    } : r.summary;
    const pdfBuffer = await buildSimcarReportPdfBuffer({
        jobId: r.jobId,
        filename: `Recorte ${r.jobId.slice(0, 8)}`,
        sourceMode: "ARQUIVO",
        summary,
        job,
        analysisText: "",
        analysisMeta: undefined,
        analysisImages: [],
        auasText: analysis.report.markdown,
        auasMeta: analysis,
        auasImages: [],
    });
    fs.mkdirSync(path.dirname(outAbs(outPath)), { recursive: true });
    fs.writeFileSync(outAbs(outPath), pdfBuffer);
    console.log("PDF SALVO:", outAbs(outPath), `(${pdfBuffer.length} bytes)`);
}

function outAbs(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

main().catch((e) => { console.error("ERRO:", e?.message || e); process.exit(1); });