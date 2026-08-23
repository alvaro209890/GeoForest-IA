// Roda a Fase 1 v2 (AUAS pré-2008) sobre o último recorte real do Álvaro
// (job 27ca02d3, 17/08/2026, 265 ha) via CLI local — sem auth/billing HTTP.
// Gera o DOCX timbrado IMAP com as cenas por polígono/ano.
import fs from "node:fs";
import { runAuasPre2008Analysis } from "../backend/analise-pos-recorte/orchestrator.ts";
import { createFileCheckpointStore } from "../backend/analise-pos-recorte/checkpoint-store.ts";

const UID = process.env.TARGET_UID || "cuFolltIEjdNLSCVEWC1je4LKQj1";
const JOB_ID = process.env.TARGET_JOB || "27ca02d3-a2a8-40bb-8f82-461e1c72d18e";

// 1. Hidrata o job do contexto persistido (mesma mecânica da rota HTTP).
const { hydrateCachedJob } = await import("../backend/simcar/hydration.ts");
const { STORAGE_ROOT } = await import("../backend/local-storage.ts");
const persistedPath = `${STORAGE_ROOT}/users/${UID}/simcar/context`;
const ctxFile = fs.readdirSync(persistedPath).find((f) => f.includes(JOB_ID.slice(0, 8)));
if (!ctxFile) throw new Error(`Contexto não encontrado para ${JOB_ID}`);
const contextUrl = `/api/storage/users/${UID}/simcar/context/${ctxFile}`;

console.log(`[DOURADO F1 v2] hidratando job ${JOB_ID}...`);
const job = await hydrateCachedJob(JOB_ID, contextUrl, undefined, UID);
if (!job?.clippedGeometries) throw new Error("Job sem clippedGeometries");

// 2. Roda a análise v2 com uid para persistir as cenas.
console.log("[DOURADO F1 v2] rodando análise pré-2008...");
const analysis = await runAuasPre2008Analysis(JOB_ID, job.clippedGeometries, {
    checkpointStore: createFileCheckpointStore(`${JOB_ID}-v2-spot-fix-${Date.now()}`),
    uid: UID,
});

// 3. Resumo no stdout.
const s = analysis.summary;
console.log("=== RESULTADO ===");
console.log(`status: ${analysis.status} | pre2008Alert: ${analysis.pre2008Alert} | confiança: ${analysis.confidence}`);
console.log(`polígonos: ${s.polygonCount} | alerta: ${s.alertCount} | dúvida: ${s.doubtCount} (${s.doubtAreaHa.toFixed(2)} ha) | inconclusivos: ${s.inconclusiveCount} | sem evidência: ${s.noEvidenceCount}`);
for (const p of analysis.polygons) {
    console.log(`  - ${p.polygonId}: ${p.status} (${p.areaHa.toFixed(4)} ha) [${p.evidenceKind}]`);
    for (const sig of p.doubtSignals || []) console.log(`      ❓ ${sig}`);
    if (p.geometryChecks) {
        console.log(`      📐 AC=${p.geometryChecks.overlapAcHa.toFixed(4)} ha · AVN=${p.geometryChecks.overlapAvnHa.toFixed(4)} ha`);
    }
}
const scenesWithUrl = analysis.scenes.filter((sc) => sc.publicImageUrl).length;
console.log(`cenas persistidas: ${scenesWithUrl}/${analysis.scenes.length}`);
console.log(`laudo (modelo): ${analysis.report.model}`);

fs.writeFileSync("/tmp/f1_v2_result.json", JSON.stringify(analysis, null, 2));
console.log("JSON salvo: /tmp/f1_v2_result.json");

// Exporta para a tool de DOCX consumir.
process.env.AUAS_META_JSON = "/tmp/f1_v2_result.json";
