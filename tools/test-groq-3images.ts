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

  const s2003 = await buildAuasScene(p, 2003);
  const s2004 = await buildAuasScene(p, 2004);
  const s2005 = await buildAuasScene(p, 2005);
  const s2008 = await buildAuasScene(p, 2008);

  const key = process.env.GROQ_API_KEY;

  const testScenes = [
    { year: 2006, s: await buildAuasScene(p, 2006) },
    { year: 2007, s: await buildAuasScene(p, 2007) },
    { year: 2008, s: s2008 },
  ];

  console.log("Chamando Groq com 3 imagens (2006, 2007, 2008)...");
  const t0 = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Você é um analista de sensoriamento remoto de Mato Grosso. Avalie se o polígono destacado em vermelho tem vegetação nativa ou foi antropizado/desmatado em cada ano. Responda em JSON com { observations: [ { year: number, state: 'NATIVE_VEGETATION' | 'ANTHROPIZED', evidence: string } ], summary: string }"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Avalie o polígono AUAS nos anos 2006 (Landsat), 2007 (Landsat) e 2008 (SPOT)." },
            ...testScenes.map(ts => ({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${ts.s.imageBuffer!.toString("base64")}` }
            }))
          ]
        }
      ]
    })
  });

  console.log("Status:", res.status, res.statusText);
  const data = await res.json();
  console.log("Tempo:", Date.now() - t0, "ms");
  if (data.choices) {
    console.log("Conteúdo da resposta:\n", data.choices[0].message.content);
  } else {
    console.log("Erro:", data);
  }
}

main().catch(console.error);
