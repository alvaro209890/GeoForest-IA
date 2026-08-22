import fs from "node:fs";
import path from "node:path";
import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { extractAuasPolygons } from "../backend/analise-pos-recorte/auas-polygons.ts";
import { buildAuasScene } from "../backend/analise-pos-recorte/wms-scenes.ts";
import { AUAS_REQUIRED_SOURCES } from "../backend/analise-pos-recorte/config.ts";

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
  console.log(`Encontrados ${polygons.length} polígonos AUAS.`);

  for (const p of polygons) {
    console.log(`\nPolígono ${p.polygonId} (área: ${p.areaHa?.toFixed(2)} ha, bbox: ${p.bbox.map(n=>n.toFixed(4)).join(",")})`);
    for (const source of AUAS_REQUIRED_SOURCES) {
      console.log(`--> Buscando cena ano ${source.year} (${source.sensor})...`);
      const t0 = Date.now();
      try {
        const scene = await buildAuasScene(p, source.year);
        console.log(`    Ano ${source.year}: status=${scene.usability}, tamanho=${scene.imageBuffer?.length || 0} bytes, tempo=${Date.now()-t0}ms`);
      } catch (err: any) {
        console.error(`    Ano ${source.year} ERRO:`, err.message);
      }
    }
  }
}

main().catch(console.error);
