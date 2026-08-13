/**
 * Dourado F2/F3 — análise pós-recorte SIMCAR (datação 2009–2019 e vegetação na
 * Área Consolidada) sobre o recorte REAL da Santa Clara (CAR 270069).
 *
 * Objetivo: gerar os laudos de referência (dourados) para conferência humana
 * antes dos rollouts de produção (gates F2/F3 do plano
 * `docs/planos/analise-pos-recorte/STATUS.md`).
 *
 * Uso (exige o env de produção do backend para Groq/DeepSeek/WMS):
 *   export PATH="/home/server/.nvm/versions/node/v20.20.0/bin:$PATH"
 *   source ~/.config/geoforest/backend.env
 *   npx tsx tools/rodar-dourado-f2-f3.ts [--inspect]
 *
 * Saída: docs/dourados/santa-clara/ (JSON completo + laudo markdown + resumo).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bbox as turfBbox } from "@turf/turf";
import type { Geometry } from "geojson";

import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io";
import { runPos2008Analysis, runAcVegetacaoAnalysis } from "../backend/analise-pos-recorte";
import { createPos2008InMemoryCheckpointStore } from "../backend/analise-pos-recorte/pos2008/orchestrator";
import { extractPolygonsFromLayer } from "../backend/analise-pos-recorte/polygons";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ZIP_PATH = process.env.DOURADO_ZIP || path.join(REPO_ROOT, "backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip");
const OUT_DIR = process.env.DOURADO_OUT || path.join(REPO_ROOT, "docs/dourados/santa-clara");
const JOB_ID = process.env.DOURADO_JOB_ID || `dourado-santa-clara-${new Date().toISOString().slice(0, 10)}`;
const INSPECT_ONLY = process.argv.includes("--inspect");
/** Limite de polígonos AUAS/AC processados (default: todos) — útil para smoke test. */
const MAX_POLYGONS = Number(process.env.DOURADO_MAX_POLYGONS || 0);

/** Lê todas as camadas .shp do ZIP e monta o Map<camada, Geometry[]> (EPSG:4326). */
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

function ha(geometry: Geometry): number {
  const b = turfBbox(geometry as any);
  return (((b[2] - b[0]) * 111_320) * ((b[3] - b[1]) * 110_540)) / 10_000;
}

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error(`Fixture ausente: ${ZIP_PATH}`);
  }
  const zip = fs.readFileSync(ZIP_PATH);
  const clipped = loadClippedGeometries(zip);

  if (MAX_POLYGONS > 0) {
    for (const layer of ["AUAS", "AREA_CONSOLIDADA"]) {
      const geoms = clipped.get(layer);
      if (geoms && geoms.length > MAX_POLYGONS) clipped.set(layer, geoms.slice(0, MAX_POLYGONS));
    }
  }

  const layerCounts: Record<string, number> = {};
  for (const [layer, geoms] of clipped) layerCounts[layer] = geoms.length;
  console.log("[dourado] camadas no recorte:", JSON.stringify(layerCounts, null, 2));

  if (INSPECT_ONLY) return;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── Fase 2 — datação 2009–2019 ────────────────────────────────────────────
  const sampleBbox = firstBboxOf(clipped, "AUAS");
  console.log("[dourado] F2 iniciada, sampleBbox =", sampleBbox, "— cenas WMS + Groq + DeepSeek reais.");
  const f2 = await runPos2008Analysis(
    {
      jobId: JOB_ID,
      clippedGeometries: clipped,
      pre2008Meta: null,
      sampleBbox,
    },
    {
      checkpointStore: createPos2008InMemoryCheckpointStore(),
      onProgress: (p) => console.log(`[F2 ${String(p.percent).padStart(3)}%] ${p.message}`),
    },
  );
  console.log("[dourado] F2 concluída:", f2.summary);
  fs.writeFileSync(path.join(OUT_DIR, "f2-pos2008.json"), JSON.stringify(f2, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "f2-pos2008-laudo.md"), f2.report.markdown);

  // ── Fase 3 — vegetação na Área Consolidada ────────────────────────────────
  const acPolygons = extractPolygonsFromLayer(clipped, "AREA_CONSOLIDADA", "AC");
  console.log(`[dourado] F3 iniciada — ${acPolygons.length} ACs (área média ~${(acPolygons.reduce((s, p) => s + ha(p.geometry), 0) / Math.max(1, acPolygons.length)).toFixed(1)} ha).`);
  const f3 = await runAcVegetacaoAnalysis(
    {
      jobId: JOB_ID,
      clippedGeometries: clipped,
      pos2008CompletedAt: f2.completedAt,
      polygons: acPolygons,
    },
    {
      onProgress: (p) => console.log(`[F3 ${String(p.percent).padStart(3)}%] ${p.message}`),
    },
  );
  console.log("[dourado] F3 concluída:", f3.summary);
  fs.writeFileSync(path.join(OUT_DIR, "f3-ac-vegetacao.json"), JSON.stringify(f3, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "f3-ac-vegetacao-laudo.md"), f3.report.markdown);

  const resumo = {
    jobId: JOB_ID,
    geradoEm: new Date().toISOString(),
    fixture: path.basename(ZIP_PATH),
    camadas: layerCounts,
    f2: {
      status: f2.summary,
      laudoModel: f2.report.model,
      laudoArquivo: "f2-pos2008-laudo.md",
    },
    f3: {
      status: f3.summary,
      laudoModel: f3.report.model,
      laudoArquivo: "f3-ac-vegetacao-laudo.md",
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, "resumo.json"), JSON.stringify(resumo, null, 2));
  console.log("[dourado] pronto —", OUT_DIR);
}

main().catch((err) => {
  console.error("[dourado] FALHOU:", err);
  process.exit(1);
});
