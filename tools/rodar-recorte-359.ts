// Roda o recorte SIMCAR localmente (mesmo pipeline do GeoForest), sem TIPOLOGIA_VEGETAL
import fs from "node:fs";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";

const layers = ["AIR","ATP","AREA_CONSOLIDADA","AREA_USO_RESTRITO","INTERESSE_SOCIAL","UTILIDADE_PUBLICA","RIO_ATE_10","RIO_10_A_50","RIO_50_A_200","RIO_200_A_600","RIO_ACIMA_600","NASCENTE","RESERVATORIO_ARTIFICIAL","LAGOA_NATURAL","MANGUEZAL","RESTINGA","VEREDA","AREA_ALTITUDE_1800","AREA_DECLIVIDADE","AREA_TOPO_MORRO","BORDA_CHAPADA","ARL","ARLREM","AUAS","AURD","AVN","AREA_UMIDA"];

async function main() {
    const zip = fs.readFileSync("/tmp/air_359.zip");
    const fakeRes: any = {
        writableEnded: false,
        destroyed: false,
        setHeader() {},
        flushHeaders() {},
        write() { return true; },
        end() {},
        flush() {},
    };

    const r = await processClip(fakeRes, "", zip, null, null, layers, "7.162");
    console.log("ok:", r.ok, "| jobId:", r.jobId);
    if (r.summary) {
        console.log("areaHa:", r.summary.propertyAreaHa, "| layers:", r.summary.layersProcessed,
            "| com dados:", r.summary.layersWithData, "| features:", r.summary.totalFeaturesClipped);
        for (const l of r.summary.layers) {
            if (l.features > 0) console.log(`  ${l.name}: ${l.features} feicoes${l.areaHa ? " | " + l.areaHa.toFixed(4) + " ha" : ""}`);
        }
    }
    if (r.jobId) {
        const job = jobCache.get(r.jobId);
        const buf = (job as any)?.buffer;
        if (buf) {
            fs.writeFileSync("/tmp/recorte_359.zip", buf);
            console.log("ZIP SALVO: /tmp/recorte_359.zip (" + buf.length + " bytes)");
        } else {
            console.log("sem buffer no cache; chaves do job:", job ? Object.keys(job).join(",") : "null");
        }
    }
}

main().catch((e) => { console.error("ERRO:", e?.message || e); process.exit(1); });
