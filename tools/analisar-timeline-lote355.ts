import path from "node:path";
import fs from "node:fs";
import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { extractAuasPolygons } from "../backend/analise-pos-recorte/auas-polygons.ts";
import { buildAuasScene } from "../backend/analise-pos-recorte/wms-scenes.ts";

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

  console.log("==> Analisando AUAS do Lote 355 (Marcos Antonio Benke - PA Pingos D'Água)");
  console.log(`Polígono ID: ${p.polygonId} | Área: ${p.areaHa.toFixed(2)} ha`);

  const key = process.env.GROQ_API_KEY;

  // 1. Janela 2003 - 2005
  console.log("\n[1/2] Baixando cenas 2003, 2004, 2005...");
  const s2003 = await buildAuasScene(p, 2003);
  const s2004 = await buildAuasScene(p, 2004);
  const s2005 = await buildAuasScene(p, 2005);

  const res1 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Analista de sensoriamento remoto de MT. Responda em JSON com { observations: [ { year: number, state: 'NATIVE_VEGETATION' | 'ANTHROPIZED' | 'MIXED', evidence: string } ] }" },
        {
          role: "user",
          content: [
            { type: "text", text: "Avalie o polígono AUAS nos anos 2003, 2004 e 2005 (Landsat 5 falsa-cor)." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2003.imageBuffer!.toString("base64")}` } },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2004.imageBuffer!.toString("base64")}` } },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2005.imageBuffer!.toString("base64")}` } },
          ]
        }
      ]
    })
  });
  const data1 = await res1.json();

  // 2. Janela 2006 - 2008
  console.log("\n[2/2] Baixando cenas 2006, 2007, 2008...");
  const s2006 = await buildAuasScene(p, 2006);
  const s2007 = await buildAuasScene(p, 2007);
  const s2008 = await buildAuasScene(p, 2008);

  const res2 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Analista de sensoriamento remoto de MT. Responda em JSON com { observations: [ { year: number, state: 'NATIVE_VEGETATION' | 'ANTHROPIZED' | 'MIXED', evidence: string } ], summary: string }" },
        {
          role: "user",
          content: [
            { type: "text", text: "Avalie o polígono AUAS nos anos 2006 (Landsat), 2007 (Landsat) e 2008 (SPOT cor natural)." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2006.imageBuffer!.toString("base64")}` } },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2007.imageBuffer!.toString("base64")}` } },
            { type: "image_url", image_url: { url: `data:image/png;base64,${s2008.imageBuffer!.toString("base64")}` } },
          ]
        }
      ]
    })
  });
  const data2 = await res2.json();

  console.log("\n=======================================================");
  console.log("==> RESULTADO DA ANÁLISE TEMPORAL (2003 a 2008)");
  console.log("=======================================================");
  console.log("2003–2005:", JSON.parse(data1.choices[0].message.content));
  console.log("\n2006–2008:", JSON.parse(data2.choices[0].message.content));
}

main().catch(console.error);
