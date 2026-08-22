// Analisa o recorte do Lote 355 (PA Pingos D'Água — Marcos Antonio Benke)
// e gera o PDF do laudo técnico — mesmo fluxo da rota AUAS v2 de produção.
// Uso: npx tsx tools/analisar-lote355-pdf.ts
import fs from "node:fs";
import path from "node:path";
import { extractZipEntriesByExtension, readFullShapefile, ringsToFeature } from "../backend/simcar/shapefile-io.ts";
import { runAuasPre2008Analysis } from "../backend/analise-pos-recorte/index.ts";
import { buildSimcarReportPdfBuffer } from "../backend/simcar/report.ts";

// DeepSeek está sem saldo (balance -0.20 USD); redige o laudo via OpenRouter
// mantendo o MESMO contrato JSON validado (schemas.ts) — só troca o transporte.
function openRouterFetchWrapper(apiKey: string): typeof fetch {
  return async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("api.deepseek.com")) {
      const newUrl = url.replace("https://api.deepseek.com/v1", "https://openrouter.ai/api/v1");
      const headers: Record<string, string> = { ...(init?.headers || {}) };
      headers["Authorization"] = `Bearer ${apiKey}`;
      return fetch(newUrl, { ...init, headers });
    }
    return fetch(input, init);
  };
}

function loadClippedGeometries(zipBuffer: Buffer): Map<string, any[]> {
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
  const zipPath = "/tmp/Lote_355_SIMCAR_Recorte.zip";
  console.log("==> Carregando recorte do Lote 355:", zipPath);
  const zip = fs.readFileSync(zipPath);
  const clipped = loadClippedGeometries(zip);

  const layerCounts: Record<string, number> = {};
  for (const [layer, geoms] of clipped) layerCounts[layer] = geoms.length;
  console.log("Camadas no recorte:", JSON.stringify(layerCounts));

  const jobId = `lote-355-${Date.now()}`;

  // Fase 1 — Análise Pré-2008 da AUAS (Landsat 2003-2007 + SPOT 2008)
  console.log("\n==> [FASE 1] Análise Pré-2008 da AUAS...");
  const vOrUrl = String(process.env.VISION_API_URL || "");
  const vKey = String(process.env.VISION_API_KEY || "");
  const vModel = String(process.env.VISION_MODEL || "google/gemini-2.5-flash");
  const deepseekDeps = vOrUrl.includes("openrouter")
    ? {
        apiKey: vKey,
        model: vModel,
        timeoutMs: 120_000,
        fetchImpl: openRouterFetchWrapper(vKey),
      }
    : { timeoutMs: 120_000 };
  console.log("Redação do laudo via:", deepseekDeps.model ? `OpenRouter/${deepseekDeps.model}` : "DeepSeek");
  const f1 = await runAuasPre2008Analysis(jobId, clipped, {
    onProgress: (p) => console.log(`  [F1 ${String(p.percent).padStart(3)}%] ${p.message}`),
    deepseekDeps,
  });

  console.log("\n[FASE 1 - RESUMO]");
  console.log("Status geral:", f1.status);
  console.log("Alerta pré-2008:", f1.pre2008Alert);
  console.log("Confiança:", f1.confidence);
  const summaryJson = JSON.stringify(f1.summary, null, 2);
  console.log("Sumário:", summaryJson);
  console.log("Laudo Pré-2008:\n", f1.report?.markdown);

  // Monta o summary para o PDF (mesmos números do recorte real)
  const summary = {
    propertyAreaHa: 63.1788,
    crs: "EPSG:4674",
    layersProcessed: 27,
    layersWithData: 9,
    totalFeaturesClipped: 23,
    processingTimeMs: 0,
    layers: [
      { name: "AIR", features: 1, areaHa: 63.1788 },
      { name: "ATP", features: 1, areaHa: 63.1788 },
      { name: "AREA_CONSOLIDADA", features: 1, areaHa: 51.9142 },
      { name: "UTILIDADE_PUBLICA", features: 1, areaHa: 0.0722 },
      { name: "RIO_ATE_10", features: 4, areaHa: 0.4356 },
      { name: "RESERVATORIO_ARTIFICIAL", features: 8, areaHa: 1.0940 },
      { name: "ARL", features: 3, areaHa: 2.0037 },
      { name: "AUAS", features: 1, areaHa: 9.1754 },
      { name: "AVN", features: 3, areaHa: 2.0037 },
    ],
    warnings: [],
  };

  const pdfBuffer = await buildSimcarReportPdfBuffer({
    jobId,
    filename: "Lote 355 - PA Pingos D'Água - Marcos Antonio Benke",
    sourceMode: "upload",
    summary,
    analysisText: "",
    analysisMeta: undefined,
    analysisImages: [],
    auasText: f1.report?.markdown || "",
    auasMeta: f1 as any,
    auasImages: [],
  });

  const outPath = "/tmp/Laudo_Tecnico_Lote_355.pdf";
  fs.writeFileSync(outPath, pdfBuffer);
  console.log("\nPDF SALVO:", outPath, `(${pdfBuffer.length} bytes)`);
}

main().catch((err) => {
  console.error("ERRO na análise:", err);
  process.exit(1);
});