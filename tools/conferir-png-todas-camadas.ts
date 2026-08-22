// Converte o SVG de conferência em PNG com fundo da cena SPOT 2008 (acervo),
// no mesmo zoom do destaque AVN do laudo — todas as camadas juntas.
import fs from "node:fs";
import sharp from "sharp";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { buildPolygonOverlaySvg, fetchSatelliteImage, SATELLITE_LAYERS } from "../backend/simcar/analysis.ts";
import { simplifyGeometryForOverlay } from "../backend/simcar/polygon-ops.ts";
import type { Geometry } from "geojson";

const fakeRes: any = {
  writableEnded: false, destroyed: false,
  setHeader() {}, flushHeaders() {}, write() { return true; }, end() {}, flush() {},
};

function collectCoords(g: any, out: number[][]) {
  if (g.type === "Polygon") { for (const ring of g.coordinates) for (const c of ring) out.push(c); }
  else if (g.type === "MultiPolygon") { for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) out.push(c); }
}

async function main() {
  const zip = fs.readFileSync("/tmp/sigef81.zip");
  const r = await processClip(fakeRes, "cli", zip, null, null, null, "123");
  const job = jobCache.get(r.jobId!);
  const geoms = job!.clippedGeometries!;

  const feats: number[][] = [];
  for (const g of geoms.get("AVN") || []) collectCoords(g, feats);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of feats) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const dx = (maxX - minX) * 0.15, dy = (maxY - minY) * 0.15;
  const bbox: [number, number, number, number] = [minX - dx, minY - dy, maxX + dx, maxY + dy];

  const W = 1200, H = 900;
  const sat = SATELLITE_LAYERS["spot_2008"];
  const resolved = await fetchSatelliteImage("spot_2008", sat, bbox, W, H, "SIMCAR CONF");
  if (!resolved?.png) { console.error("cena SPOT indisponível"); return; }
  console.log("cena SPOT:", resolved.provenance);

  const layerGeos = new Map<string, Geometry[]>();
  for (const [name, gg] of Array.from(geoms.entries())) {
    layerGeos.set(name, gg.map((g2: Geometry) => simplifyGeometryForOverlay(g2, 1400)));
  }
  const svg = buildPolygonOverlaySvg(W, H, bbox, job!.polygon!, layerGeos, [
    { name: "AREA_CONSOLIDADA", stroke: "#FF00FF", fill: "rgba(255,0,255,0.12)", strokeWidth: 4 },
    { name: "AVN", stroke: "#00FFFF", fill: "rgba(0,255,255,0.22)", strokeWidth: 5 },
    { name: "AUAS", stroke: "#FFA500", fill: "rgba(255,165,0,0.15)", strokeWidth: 4 },
    { name: "RESERVATORIO_ARTIFICIAL", stroke: "#0044FF", fill: "rgba(0,0,255,0.40)", strokeWidth: 4 },
  ]);
  const svgBuf = Buffer.from(svg);
  const rawPng: any = resolved.png;
  const baseBuf = typeof rawPng === "string"
    ? Buffer.from(rawPng.replace(/^data:image\/png;base64,/, ""), "base64")
    : Buffer.isBuffer(rawPng) ? rawPng : Buffer.from(rawPng as Uint8Array);
  const outBuf = await sharp(baseBuf).composite([
    { input: svgBuf, top: 0, left: 0 },
  ]).png().toBuffer();
  const outPath = "/tmp/conferencia_lote81_spot2008_todas_camadas.png";
  fs.writeFileSync(outPath, outBuf);
  console.log("PNG salvo:", outPath, "(", outBuf.length, "bytes )");
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });