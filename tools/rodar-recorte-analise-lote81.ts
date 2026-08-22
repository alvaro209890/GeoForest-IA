// Recorte SIMCAR + Análise AC/AVN + Laudo PDF do Lote 81 (via pipeline real, sem auth).
// Uso:
//   export PATH="/home/server/.nvm/versions/node/v20.20.0/bin:$PATH"
//   bash -c 'set -a; source ~/.config/geoforest/backend.env; set +a; npx tsx tools/rodar-recorte-analise-lote81.ts'
// Saída: /tmp/recorte_lote81.zip + /tmp/Laudo_Lote81.pdf
import fs from "node:fs";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { processAnalysis, getFixedAcAvnSatelliteKeys } from "../backend/simcar/analysis.ts";
import { buildSimcarReportPdfBuffer } from "../backend/simcar/report.ts";

const ZIP_IN = process.env.LOTE81_ZIP || "/tmp/sigef81.zip";
const AIR_ID = process.env.LOTE81_AIR_ID || "123"; // identificação da AIR pedida pelo Álvaro
const OUT_RECORTE = process.env.LOTE81_OUT_RECORTE || "/tmp/recorte_lote81.zip";
const OUT_PDF = process.env.LOTE81_OUT_PDF || "/tmp/Laudo_Lote81.pdf";
const UID = "cli"; // uid fake: só para as URLs públicas do /api/storage

const fakeRes: any = {
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    write() { return true; },
    end() {},
    flush() {},
};

async function main() {
    const zip = fs.readFileSync(ZIP_IN);
    console.log(`==> Recorte SIMCAR do Lote 81 (AIR ${AIR_ID}) usando ${ZIP_IN}`);

    // 1. Recorte — template completo (todas as camadas do Modelo)
    const r = await processClip(fakeRes, UID, zip, null, null, null, AIR_ID);
    console.log("recorte ok:", r.ok, "| jobId:", r.jobId);
    if (!r.ok || !r.jobId) throw new Error("Recorte falhou.");
    if (r.summary) {
        console.log("areaHa:", r.summary.propertyAreaHa, "| camadas:", r.summary.layersProcessed,
            "| com dados:", r.summary.layersWithData, "| feicoes:", r.summary.totalFeaturesClipped);
        for (const l of r.summary.layers) {
            if (l.features > 0) console.log(`  ${l.name}: ${l.features} feicoes${l.areaHa ? " | " + l.areaHa.toFixed(4) + " ha" : ""}`);
        }
        if (r.summary.warnings?.length) console.log("avisos:", r.summary.warnings.join("; "));
    }

    const job = jobCache.get(r.jobId);
    if (job?.buffer) {
        fs.writeFileSync(OUT_RECORTE, job.buffer);
        console.log("ZIP recorte salvo:", OUT_RECORTE, `(${job.buffer.length} bytes)`);
    }

    // 2. Análise AC/AVN (mesmo fluxo da rota /api/simcar/clip/analyze com
    // selectedLayers vazio → getFixedAcAvnSatelliteKeys; aiAnalysis=true).
    const layers = getFixedAcAvnSatelliteKeys();
    console.log("\n==> Análise IA AC/AVN — satélites:", layers.join(", "));
    const outcome = await processAnalysis(fakeRes, r.jobId, layers, true, r.contextUrl, r.outputZipUrl, UID);
    if (!outcome) throw new Error("Análise IA falhou (resultado nulo).");
    console.log("\nanálise ok | imagens:", outcome.cloudinaryUrls.length,
        "| keys usadas:", outcome.usedSatelliteKeys.join(","));
    console.log("meta:", JSON.stringify(outcome.analysisMeta, null, 2).slice(0, 800));

    // 3. Laudo PDF técnico (mesmo builder da rota report; sem persistência Cloudinary)
    console.log("\n==> Gerando PDF do laudo...");
    const pdfBuffer = await buildSimcarReportPdfBuffer({
        jobId: r.jobId,
        filename: `Recorte Lote 81 (AIR ${AIR_ID})`,
        sourceMode: "zip",
        summary: r.summary,
        job: jobCache.get(r.jobId),
        analysisText: outcome.analysisText,
        analysisMeta: outcome.analysisMeta,
        analysisImages: outcome.cloudinaryUrls,
        auasText: "",
        auasImages: [],
    });
    fs.writeFileSync(OUT_PDF, pdfBuffer);
    console.log("PDF salvo:", OUT_PDF, `(${pdfBuffer.length} bytes)`);
}

main().catch((e) => { console.error("ERRO:", e?.message || e); process.exit(1); });