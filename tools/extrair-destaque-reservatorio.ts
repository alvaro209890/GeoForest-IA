// Extrai a imagem de destaque do reservatório do Lote 81 (usada no laudo final).
import fs from "node:fs";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { buildReservoirHighlightImage } from "../backend/simcar/analysis.ts";

const fakeRes: any = {
  writableEnded: false, destroyed: false,
  setHeader() {}, flushHeaders() {}, write() { return true; }, end() {}, flush() {},
};

async function main() {
  const r = await processClip(fakeRes, "cli", fs.readFileSync("/tmp/sigef81.zip"), null, null, null, "123");
  const job = jobCache.get(r.jobId!);
  const hl = await buildReservoirHighlightImage(fakeRes, job!, ["spot_2008", "landsat5_2008"]);
  if (!hl) { console.log("SEM DESTAQUE (null)"); return; }
  const b64 = hl.dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync("/tmp/destaque_reservatorio_lote81.png", Buffer.from(b64, "base64"));
  console.log("OK:", hl.caption);
  console.log("PNG:", "/tmp/destaque_reservatorio_lote81.png");
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });