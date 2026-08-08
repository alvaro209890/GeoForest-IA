/**
 * Job de análise de erros de geometria (execução assíncrona com progresso).
 */
import fs from "node:fs";
import { SIRGAS_2000_PRJ, WGS84_PRJ, detectCrs, getZipLayerGroups, parsePolygonRecords } from "../vertices-proximas";
import { getAbsoluteStoragePath, saveUserBuffer } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { checkSimcarConformity } from "../simcar-rules";
import { detectAirAtpAreaConsistency } from "./detectors/air";
import { CONTAINMENT_SLIVER_TOLERANCE_M2, detectSimcarContainment } from "./detectors/containment";
import { detectSimcarForbiddenOverlaps } from "./detectors/forbidden-overlap";
import { detectGaps, MIN_GAP_M2 } from "./detectors/gaps";
import { detectOverlaps } from "./detectors/overlaps";
import { fixLayerGeometry } from "./detectors/self-intersection";
import { buildResultZip } from "./report";
import { analyzeLayerGeometry } from "./runner";
import { closeSubscribers, progress } from "./sse";
import { GapPolygon, GeometryChecks, GeometryErrorRow, GeometrySettings, LayerFixResult, OverlapPolygon, RuleViolationPolygon, SimcarRuleLayer } from "./types";

export async function runGeometryJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  layerIds: string[];
  checks: GeometryChecks;
  settings: GeometrySettings;
}): Promise<void> {
  const { uid, jobId, upload, layerIds, checks, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const groups = getZipLayerGroups(zipBuffer);
    const wanted = new Set(layerIds);
    const selectedGroups = groups.filter((group) => wanted.has(group.id) && group.shp);
    if (!selectedGroups.length) throw new Error("Selecione ao menos uma camada poligonal para analisar.");

    const allRows: GeometryErrorRow[] = [];
    const allWarnings: string[] = [];
    const fixes: LayerFixResult[] = [];
    const allOverlaps: OverlapPolygon[] = [];
    const allGaps: GapPolygon[] = [];
    const allRuleViolations: RuleViolationPolygon[] = [];
    const analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }> = [];
    let outputPrjText = "";

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 5,
      message: "Iniciando análise de geometria.",
    });

    // Conformidade SIMCAR é verificada no ZIP inteiro (todas as camadas),
    // pois nomenclatura/CRS/feições obrigatórias são regras do projeto todo.
    if (checks.simcarConformity !== false) {
      try {
        const conformityRows = checkSimcarConformity(
          groups
            .filter((group) => group.shp)
            .map((group) => ({
              name: group.name,
              shp: group.shp!.data,
              prjText: group.prj?.data.toString("utf8"),
              dbf: group.dbf?.data,
            })),
        );
        allRows.push(...conformityRows);
      } catch (error: any) {
        allWarnings.push(`Conformidade SIMCAR: ${error?.message || "falha na verificação"}`);
      }
    }

    // Regras topológicas do Anexo 01 e AIR×ATP usam o ZIP inteiro: os pares
    // (ex.: AVN ⊂ AIR, AVN × AUAS) e a soma das AIRs independem das camadas marcadas.
    if (
      checks.simcarContainment !== false ||
      checks.simcarCrossOverlaps !== false ||
      checks.airAtpArea !== false
    ) {
      progress(uid, jobId, {
        status: "processing",
        stage: "simcar-rules",
        percent: 8,
        message: "Aplicando regras do Anexo 01 / AIR×ATP (SIMCAR).",
      });
      const ruleLayers: SimcarRuleLayer[] = groups
        .filter((group) => group.shp)
        .map((group) => ({
          name: group.name,
          records: parsePolygonRecords(group.shp!.data),
          crs: detectCrs(group.prj?.data.toString("utf8")),
          // Sem o .dbf as regras que dependem de atributo ficam mudas:
          // ARL/SITUACAO na contenção e BARRAMENTO/SITUACAO no reservatório.
          dbf: group.dbf?.data,
        }));
      if (checks.simcarContainment !== false) {
        try {
          const containmentResult = detectSimcarContainment({
            layers: ruleLayers,
            // `minOverlapM2` é o limiar de SOBREPOSIÇÃO (default 1 m² na UI) e
            // não serve para contenção: resíduo de vetorização entre camadas
            // vizinhas é da ordem de metros quadrados e virava validação
            // impeditiva. Aqui vale o piso de sliver, ou o valor do usuário se
            // for maior.
            minAreaM2: Math.max(Number(settings.minOverlapM2) || 0, CONTAINMENT_SLIVER_TOLERANCE_M2),
          });
          allRows.push(...containmentResult.rows);
          allRuleViolations.push(...containmentResult.violations);
          allWarnings.push(...containmentResult.warnings);
        } catch (error: any) {
          allWarnings.push(`Regras SIMCAR (contenção): ${error?.message || "falha na verificação"}`);
        }
      }
      if (checks.simcarCrossOverlaps !== false) {
        try {
          const crossResult = detectSimcarForbiddenOverlaps({
            layers: ruleLayers,
            minAreaM2: settings.minOverlapM2,
          });
          allRows.push(...crossResult.rows);
          allRuleViolations.push(...crossResult.violations);
          allWarnings.push(...crossResult.warnings);
        } catch (error: any) {
          allWarnings.push(`Regras SIMCAR (sobreposição): ${error?.message || "falha na verificação"}`);
        }
      }
      if (checks.airAtpArea !== false) {
        try {
          const airAtpResult = detectAirAtpAreaConsistency({
            layers: ruleLayers,
            minDiffM2: settings.minOverlapM2,
            maxDiffRatio: settings.airAtpMaxDiffRatio,
          });
          allRows.push(...airAtpResult.rows);
          allWarnings.push(...airAtpResult.warnings);
        } catch (error: any) {
          allWarnings.push(`Soma AIR vs ATP: ${error?.message || "falha na verificação"}`);
        }
      }
    }

    for (let index = 0; index < selectedGroups.length; index += 1) {
      if (isCancelRequested(jobId)) throw new Error("cancel_requested");
      const group = selectedGroups[index];
      const percent = 5 + Math.round((index / selectedGroups.length) * 80);
      progress(uid, jobId, {
        status: "processing",
        stage: "layer",
        layer: group.name,
        percent,
        message: `Analisando ${group.name}.`,
      });

      try {
        const records = parsePolygonRecords(group.shp!.data);
        const crs = detectCrs(group.prj?.data.toString("utf8"));
        if (!outputPrjText) {
          outputPrjText = crs.prjText || (crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
        }
        const rows = analyzeLayerGeometry({ layerName: group.name, records, checks });
        if (checks.overlaps !== false) {
          const overlapResult = detectOverlaps({
            layerName: group.name,
            records,
            crs,
            minOverlapM2: settings.minOverlapM2,
          });
          rows.push(...overlapResult.rows);
          allOverlaps.push(...overlapResult.overlapPolygons);
          allWarnings.push(...overlapResult.warnings);
        }
        if (checks.gaps !== false) {
          const gapResult = detectGaps({
            layerName: group.name,
            records,
            crs,
            // Mesmo motivo da contenção: 1 m² é ruído de arredondamento.
            minGapM2: Math.max(Number(settings.minOverlapM2) || 0, MIN_GAP_M2),
          });
          rows.push(...gapResult.rows);
          allGaps.push(...gapResult.gapPolygons);
          allWarnings.push(...gapResult.warnings);
        }
        allRows.push(...rows);
        analyzedLayers.push({
          name: group.name,
          featureCount: records.length,
          errors: rows.length,
          crsLabel: crs.label,
        });
        // Sobreposição/vazio não têm correção automática; só gera camada corrigida p/ erros corrigíveis.
        const nonFixable = new Set(["sobreposicao", "vazio"]);
        if (settings.generateFixed !== false && rows.some((row) => !nonFixable.has(row.tipo))) {
          const errorFeatureIds = new Set(rows.filter((row) => row.tipo === "borda_se_cruza").map((row) => row.feicao));
          const fix = fixLayerGeometry({
            layerName: group.name,
            records,
            errorFeatureIds,
            cleanDuplicates: checks.duplicateVertices !== false,
          });
          fixes.push(fix);
          allWarnings.push(...fix.warnings);
        }
      } catch (error: any) {
        allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
        analyzedLayers.push({ name: group.name, featureCount: 0, errors: 0, crsLabel: "erro" });
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 90,
      message: "Gerando ZIP final.",
    });
    const zip = await buildResultZip({
      rows: allRows,
      fixes,
      overlapPolygons: allOverlaps,
      gapPolygons: allGaps,
      ruleViolations: allRuleViolations,
      prjText: outputPrjText || SIRGAS_2000_PRJ,
      filename: String(upload.filename || "geometria.zip"),
      analyzedLayers,
      warnings: allWarnings,
    });
    const stored = saveUserBuffer({
      uid,
      area: "geometry-errors/output",
      filename: `erros_geometria_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });
    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: "Análise concluída.",
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/geometry-errors/download/${jobId}`,
      outputBytes: zip.length,
      resultRows: allRows,
      warnings: allWarnings,
      analyzedLayers,
      fixedLayers: fixes.map((fix) => ({ name: fix.layerName, fixedFeatures: fix.fixedFeatures })),
      totalErrors: allRows.length,
      featuresWithErrors: new Set(allRows.map((row) => `${row.camada}:${row.feicao}`)).size,
      completedAt: new Date().toISOString(),
    };
    progress(uid, jobId, payload);
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const cancelled = error?.message === "cancel_requested";
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      percent: cancelled ? undefined : 100,
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao analisar geometria.",
      error: error?.message || "geometry_errors_failed",
    });
    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: error?.message || "geometry_errors_failed" });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────── rotas ─────────────────────── */
