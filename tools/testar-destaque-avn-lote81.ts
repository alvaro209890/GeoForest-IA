// Valida a geração da imagem de DESTAQUE AVN sobre o recorte real do Lote 81:
// chama buildAvnHighlightImage direto e salva o PNG para conferência visual.
import fs from "node:fs";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { buildAvnHighlightImage } from "../backend/simcar/analysis.ts";

const fakeRes: any = {
    writableEnded: false, destroyed: false,
    setHeader() {}, flushHeaders() {}, write() { return true; }, end() {}, flush() {},
};

async function main() {
    const zip = fs.readFileSync("/tmp/sigef81.zip");
    const r = await processClip(fakeRes, "cli", zip, null, null, null, "123");
    console.log("recorte:", r.ok, "jobId:", r.jobId);
    const job = jobCache.get(r.jobId!);
    const highlight = await buildAvnHighlightImage(fakeRes, job!, ["spot_2008", "landsat5_2008"]);
    if (!highlight) {
        console.log("SEM DESTAQUE (retornou null)");
        return;
    }
    const b64 = highlight.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync("/tmp/destaque_avn_lote81.png", Buffer.from(b64, "base64"));
    console.log("DESTAQUE gerado:", highlight.caption);
    console.log("PNG salvo: /tmp/destaque_avn_lote81.png");
    fs.writeFileSync("/tmp/destaque_caption.txt", highlight.caption);
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });