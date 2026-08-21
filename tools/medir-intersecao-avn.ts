// Mede a interseção geométrica AC∩AVN no recorte do Lote 81 (fonte da verdade
// para o achado "área consolidada dentro da AVN", independente da IA).
import fs from "node:fs";
import path from "node:path";
import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { area as turfArea, featureCollection as turfFC, union as turfUnion, intersect as turfIntersect } from "@turf/turf";

function load(zipPath: string) {
  const zip = fs.readFileSync(zipPath);
  const entries = extractZipEntriesByExtension(zip, [".shp"]);
  const byLayer = new Map<string, Buffer>();
  for (const e of entries) {
    const base = path.basename(e.name).replace(/\.shp$/i, "");
    if (!byLayer.has(base)) byLayer.set(base, e.data);
  }
  const map = new Map<string, any[]>();
  for (const [layer, buf] of byLayer) {
    const geoms: any[] = [];
    for (const rings of readFullShapefile(buf)) {
      const f = ringsToFeature(rings);
      if (f?.geometry) geoms.push(f.geometry);
    }
    if (geoms.length) map.set(layer, geoms);
  }
  return map;
}

function mergeAsFeature(geoms: any[]) {
  let merged: any = null;
  for (const g of geoms) {
    const f = { type: "Feature", properties: {}, geometry: g };
    if (!merged) { merged = f; continue; }
    try {
      merged = turfUnion(turfFC([merged, f] as any)) as any;
      if (!merged) merged = f;
    } catch { /* keep */ }
  }
  return merged;
}

const map = load(process.argv[2] || "/tmp/recorte_lote81.zip");
const ac = mergeAsFeature(map.get("AREA_CONSOLIDADA") || []);
const avn = mergeAsFeature(map.get("AVN") || []);
const auas = mergeAsFeature(map.get("AUAS") || []);
const reserv = mergeAsFeature(map.get("RESERVATORIO_ARTIFICIAL") || []);
const reserv2 = mergeAsFeature(map.get("RESERVATORIO") || []);

console.log("AC:", ac ? (turfArea(ac) / 10000).toFixed(4) + " ha" : "ausente");
console.log("AVN:", avn ? (turfArea(avn) / 10000).toFixed(4) + " ha" : "ausente");
console.log("AUAS:", auas ? (turfArea(auas) / 10000).toFixed(4) + " ha" : "ausente");
console.log("RESERVATORIO_ARTIFICIAL:", reserv ? (turfArea(reserv) / 10000).toFixed(4) + " ha" : "ausente");
console.log("RESERVATORIO (alt):", reserv2 ? (turfArea(reserv2) / 10000).toFixed(4) + " ha" : "ausente");

if (ac && avn) {
  try {
    const inter = turfIntersect(turfFC([ac, avn] as any)) as any;
    console.log("AC∩AVN:", inter ? (turfArea(inter) / 10000).toFixed(6) + " ha" : "0 (sem interseção)");
  } catch (e: any) { console.log("AC∩AVN: erro", e.message); }
}
if (auas && avn) {
  try {
    const inter2 = turfIntersect(turfFC([auas, avn] as any)) as any;
    console.log("AUAS∩AVN:", inter2 ? (turfArea(inter2) / 10000).toFixed(6) + " ha" : "0 (sem interseção)");
  } catch (e: any) { console.log("AUAS∩AVN: erro", e.message); }
}
for (const [nome, res] of [["RESERVATORIO", reserv], ["RESERVATORIO_ARTIFICIAL", reserv2]] as const) {
  if (res) {
    try {
      const iAcc = turfIntersect(turfFC([ac, res] as any)) as any;
      const iAvn = turfIntersect(turfFC([avn, res] as any)) as any;
      const iAuas = turfIntersect(turfFC([auas, res] as any)) as any;
      console.log(`${nome}∩AC:`, iAcc ? (turfArea(iAcc) / 10000).toFixed(6) + " ha" : "0");
      console.log(`${nome}∩AVN:`, iAvn ? (turfArea(iAvn) / 10000).toFixed(6) + " ha" : "0");
      console.log(`${nome}∩AUAS:`, iAuas ? (turfArea(iAuas) / 10000).toFixed(6) + " ha" : "0");
    } catch (e: any) { console.log(`${nome}: erro`, e.message); }
  }
}