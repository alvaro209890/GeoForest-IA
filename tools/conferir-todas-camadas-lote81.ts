// Overlay de conferência do Lote 81: TODAS as camadas relevantes (AC, AVN,
// AUAS, RESERVATORIO_ARTIFICIAL, propriedade) no mesmo zoom do destaque do
// laudo — para conferir visualmente o que a IA apontou como "uso consolidado
// dentro da AVN" e se aquilo é reservatório.
import fs from "node:fs";
import type { Geometry } from "geojson";
import { processClip, jobCache } from "../backend/simcar/clip-pipeline.ts";
import { buildPolygonOverlaySvg } from "../backend/simcar/analysis.ts";

const fakeRes: any = {
  writableEnded: false, destroyed: false,
  setHeader() {}, flushHeaders() {}, write() { return true; }, end() {}, flush() {},
};

function exportSvg(svg: string, out: string) {
  fs.writeFileSync(out, svg);
  console.log("SVG salvo:", out);
}

async function main() {
  const zip = fs.readFileSync("/tmp/sigef81.zip");
  const r = await processClip(fakeRes, "cli", zip, null, null, null, "123");
  console.log("recorte:", r.ok, "jobId:", r.jobId);
  const job = jobCache.get(r.jobId!);
  const geoms = job!.clippedGeometries!;

  // bbox da AVN (mesmo foco do destaque) com padding
  const feats: number[][] = [];
  for (const g of geoms.get("AVN") || []) collectCoords(g, feats);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of feats) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const dx = (maxX - minX) * 0.15, dy = (maxY - minY) * 0.15;
  const bbox: [number, number, number, number] = [minX - dx, minY - dy, maxX + dx, maxY + dy];

  const W = 1100, H = 825;
  const layerGeos = new Map<string, Geometry[]>();
  for (const [name, gg] of geoms) {
    layerGeos.set(name, gg);
  }
  const svg = buildPolygonOverlaySvg(W, H, bbox, job!.polygon!, layerGeos, [
    { name: "AREA_CONSOLIDADA", stroke: "#FF00FF", fill: "rgba(255,0,255,0.12)", strokeWidth: 3.5 },
    { name: "AVN", stroke: "#00FFFF", fill: "rgba(0,255,255,0.20)", strokeWidth: 4.5 },
    { name: "AUAS", stroke: "#FFA500", fill: "rgba(255,165,0,0.15)", strokeWidth: 3.5 },
    { name: "RESERVATORIO_ARTIFICIAL", stroke: "#0000AA", fill: "rgba(0,0,200,0.35)", strokeWidth: 3.5 },
  ]);
  exportSvg(svg, "/tmp/conferencia_lote81_todas_camadas.svg");
}

function collectCoords(g: any, out: number[][]) {
  if (g.type === "Polygon") { for (const ring of g.coordinates) for (const c of ring) out.push(c); }
  else if (g.type === "MultiPolygon") { for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) out.push(c); }
}

main().catch((e) => { console.error("ERRO:", e); process.exit(1); });