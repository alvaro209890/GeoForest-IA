import fs from "node:fs";
import path from "node:path";
import { bbox as turfBbox } from "@turf/turf";
import type { Geometry } from "geojson";

import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { runAuasPre2008Analysis, runPos2008Analysis } from "../backend/analise-pos-recorte/index.ts";
import { createPos2008InMemoryCheckpointStore } from "../backend/analise-pos-recorte/pos2008/orchestrator.ts";

function loadClippedGeometries(zipBuffer: Buffer): Map<string, Geometry[]> {
  const shpEntries = extractZipEntriesByExtension(zipBuffer, [".shp"]);
  const byLayer = new Map<string, Buffer>();
  for (const entry of shpEntries) {
    const base = path.basename(entry.name).replace(/\.shp$/i, "");
    if (!byLayer.has(base)) byLayer.set(base, entry.data);
  }

  const map = new Map<string, Geometry[]>();
  for (const [layer, shpBuffer] of byLayer) {
    const ringsList = readFullShapefile(shpBuffer);
    const geoms: Geometry[] = [];
    for (const rings of ringsList) {
      const feature = ringsToFeature(rings);
      if (feature?.geometry) geoms.push(feature.geometry);
    }
    if (geoms.length > 0) map.set(layer, geoms);
  }
  return map;
}

function firstBboxOf(map: Map<string, Geometry[]>, layer: string): [number, number, number, number] | undefined {
  const geoms = map.get(layer);
  if (!geoms?.length) return undefined;
  const b = turfBbox(geoms[0] as any);
  return [b[0], b[1], b[2], b[3]];
}

async function main() {
  const zipPath = "/tmp/Lote_355_SIMCAR_Recorte.zip";
  console.log("==> Carregando recorte do Lote 355:", zipPath);
  const zip = fs.readFileSync(zipPath);
  const clipped = loadClippedGeometries(zip);

  const layerCounts: Record<string, number> = {};
  for (const [layer, geoms] of clipped) layerCounts[layer] = geoms.length;
  console.log("Camadas no recorte:", JSON.stringify(layerCounts, null, 2));

  const jobId = `analise-lote-355-${Date.now()}`;

  // 1. Fase 1 — Análise Pré-2008 (Landsat 5 2003-2007 + SPOT 2008)
  console.log("\n=======================================================");
  console.log("==> [FASE 1] Análise Pré-2008 da AUAS (Houve supressão antes de 22/07/2008?)");
  console.log("=======================================================");
  const f1 = await runAuasPre2008Analysis(jobId, clipped, {
    onProgress: (p) => console.log(`[F1 ${String(p.percent).padStart(3)}%] ${p.message}`),
  });

  console.log("\n[FASE 1 - RESUMO]");
  console.log("Status geral:", f1.status);
  console.log("Alerta pré-2008:", f1.pre2008Alert);
  console.log("Confiança:", f1.confidence);
  console.log("Sumário:", JSON.stringify(f1.summary, null, 2));
  console.log("Laudo Pré-2008:\n", f1.report?.markdown);

  // 2. Fase 2 — Datação 2009-2019 (Quando ocorreu a supressão?)
  console.log("\n=======================================================");
  console.log("==> [FASE 2] Datação da Supressão 2009–2019");
  console.log("=======================================================");
  const sampleBbox = firstBboxOf(clipped, "AUAS") || firstBboxOf(clipped, "ATP");
  const f2 = await runPos2008Analysis(
    {
      jobId,
      clippedGeometries: clipped,
      pre2008Meta: null,
      sampleBbox,
    },
    {
      checkpointStore: createPos2008InMemoryCheckpointStore(),
      onProgress: (p) => console.log(`[F2 ${String(p.percent).padStart(3)}%] ${p.message}`),
    }
  );

  console.log("\n[FASE 2 - RESUMO]");
  console.log("Sumário:", JSON.stringify(f2.summary, null, 2));
  if (f2.polygons && f2.polygons.length > 0) {
    for (const p of f2.polygons) {
      console.log(`Polígono ${p.polygonId} (${p.areaHa?.toFixed(2)} ha): status=${p.status}, anoConfirmado=${p.confirmedYear || "N/A"}, intervalo=${p.confirmedInterval || "N/A"}`);
    }
  }
  console.log("\nLaudo Datação 2009-2019:\n", f2.report?.markdown);
}

main().catch((err) => {
  console.error("ERRO na análise:", err);
  process.exit(1);
});
