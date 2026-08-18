// Recorte SIMCAR via CLI — mesmo pipeline do GeoForest, sem auth/SSE.
// Uso: npx tsx tools/rodar-recorte-simcar-cli.ts <zip_da_AIR> <air_identificacao> [--sem-tipologia] [--out <destino.zip>]
// Ex.: npx tsx tools/rodar-recorte-simcar-cli.ts /tmp/air.zip "7.162" --sem-tipologia --out /tmp/recorte.zip
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { extractZipEntries } from "../backend/geo-utils.ts";

const TEMPLATE_SEM_TIPOLOGIA = ["AIR","ATP","AREA_CONSOLIDADA","AREA_USO_RESTRITO","INTERESSE_SOCIAL","UTILIDADE_PUBLICA","RIO_ATE_10","RIO_10_A_50","RIO_50_A_200","RIO_200_A_600","RIO_ACIMA_600","NASCENTE","RESERVATORIO_ARTIFICIAL","LAGOA_NATURAL","MANGUEZAL","RESTINGA","VEREDA","AREA_ALTITUDE_1800","AREA_DECLIVIDADE","AREA_TOPO_MORRO","BORDA_CHAPADA","ARL","ARLREM","AUAS","AURD","AVN","AREA_UMIDA"];

async function main() {
    const args = process.argv.slice(2);
    const zipPath = args[0];
    const airId = args[1];
    const semTipologia = args.includes("--sem-tipologia");
    const outIdx = args.indexOf("--out");
    const outPath = outIdx >= 0 ? args[outIdx + 1] : "/tmp/recorte_simcar.zip";
    if (!zipPath || !airId) {
        console.error("Uso: rodar-recorte-simcar-cli.ts <zip_da_AIR> <air_identificacao> [--sem-tipologia] [--out <destino.zip>]");
        process.exit(1);
    }

    const layers = semTipologia ? TEMPLATE_SEM_TIPOLOGIA : null; // null = todas (28)
    const zip = fs.readFileSync(zipPath);
    const fakeRes: any = {
        writableEnded: false,
        destroyed: false,
        setHeader() {},
        flushHeaders() {},
        write() { return true; },
        end() {},
        flush() {},
    };

    const r = await processClip(fakeRes, "", zip, null, null, layers, airId);
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
            const outAbs = path.resolve(outPath);
            let finalBuf = buf;
            if (semTipologia) {
                // O ZIP do pipeline traz o template completo (camadas não processadas vazias):
                // remove TIPOLOGIA_VEGETAL.* quando --sem-tipologia
                const entries = extractZipEntries(buf).filter((e) => !e.name.toUpperCase().includes("TIPOLOGIA"));
                finalBuf = await new Promise<Buffer>((resolve, reject) => {
                    const archive = archiver("zip", { zlib: { level: 6 } });
                    const chunks: Buffer[] = [];
                    archive.on("data", (c: Buffer) => chunks.push(c));
                    archive.on("error", reject);
                    archive.on("end", () => resolve(Buffer.concat(chunks)));
                    for (const e of entries) archive.append(e.data, { name: e.name });
                    archive.finalize();
                });
                console.log("TIPOLOGIA_VEGETAL removida do ZIP de saida.");
            }
            fs.mkdirSync(path.dirname(outAbs), { recursive: true });
            fs.writeFileSync(outAbs, finalBuf);
            console.log("ZIP SALVO: " + outAbs + " (" + finalBuf.length + " bytes)");
        } else {
            console.log("sem buffer no cache; chaves do job:", job ? Object.keys(job).join(",") : "null");
        }
    }
}

main().catch((e) => { console.error("ERRO:", e?.message || e); process.exit(1); });
