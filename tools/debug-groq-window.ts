import fs from "node:fs";
import path from "node:path";
import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { extractAuasPolygons } from "../backend/analise-pos-recorte/auas-polygons.ts";
import { buildAuasScene } from "../backend/analise-pos-recorte/wms-scenes.ts";
import { requestGroqVisionWindow } from "../backend/analise-pos-recorte/groq-vision-client.ts";

function loadClippedGeometries(zipBuffer: Buffer) {
  const shpEntries = extractZipEntriesByExtension(zipBuffer, [".shp"]);
  const byLayer = new Map<string, Buffer>();
  for (const entry of shpEntries) {
    const base = path.basename(entry.name).replace(/\.shp$/i, "");
    if (!byLayer.has(base)) byLayer.set(base, entry.data);
  }

  const map = new Map<string, any[]>();
  for (const [layer, shpBuffer] of byLayer) {
    const ringsList = readFullShapefile(shpBuffer);
    const geoms: any[] = [];
    for (const rings of ringsList) {
      const feature = ringsToFeature(rings);
      if (feature?.geometry) geoms.push(feature.geometry);
    }
    if (geoms.length > 0) map.set(layer, geoms);
  }
  return map;
}

async function main() {
  const zip = fs.readFileSync("/tmp/Lote_355_SIMCAR_Recorte.zip");
  const clipped = loadClippedGeometries(zip);
  const polygons = extractAuasPolygons(clipped);
  const p = polygons[0];

  const s2003 = await buildAuasScene(p, 2003);
  const s2004 = await buildAuasScene(p, 2004);
  const s2005 = await buildAuasScene(p, 2005);

  const images = [
    { sceneId: s2003.sceneId, year: 2003, sensor: s2003.sensor, dataUrl: `data:image/png;base64,${s2003.imageBuffer!.toString("base64")}` },
    { sceneId: s2004.sceneId, year: 2004, sensor: s2004.sensor, dataUrl: `data:image/png;base64,${s2004.imageBuffer!.toString("base64")}` },
    { sceneId: s2005.sceneId, year: 2005, sensor: s2005.sensor, dataUrl: `data:image/png;base64,${s2005.imageBuffer!.toString("base64")}` },
  ];

  console.log("Enviando janela W2003_2005 para Groq Vision (timeout 90s)...");
  const t0 = Date.now();
  const res = await requestGroqVisionWindow({
    polygonId: p.polygonId,
    windowId: "W2003_2005" as any,
    images,
  }, {
    model: "qwen/qwen3.6-27b",
    timeoutMs: 90000,
  });

  console.log(`Tempo total: ${Date.now()-t0}ms`);
  console.log("Resultado:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
