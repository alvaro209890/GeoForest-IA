/**
 * Orquestrador da Fase 3 (vegetação na AC) — F3.6.
 *
 * Analisa **todas** as Áreas Consolidadas do recorte (doc 06 §1: "para cada
 * polígono `AREA_CONSOLIDADA`"). A datação da Fase 2 entra como referência de
 * contexto (`pos2008CompletedAt`), não como filtro de polígonos — o vínculo
 * entre AUAS e AC não é 1:1 nem tem IDs compatíveis entre camadas. Fluxo por
 * polígono: evidência geométrica (turf, determinística) → cenas de visão →
 * observação → redutor → resultado agregado. Persistência via
 * `persistAcVegetacaoMeta`.
 */
import type { Geometry } from "geojson";

import type { WmsFetchDeps } from "../wms-scenes";
import { getAcVegetacaoConfig, type AcVegetacaoConfig } from "../config";
import { buildAcVegetacaoScene, type AcSceneSpec } from "./scenes";
import { computeAcGeometricEvidence } from "./geometry-evidence";
import { reduceAcVegetacao } from "./evidence-reducer";
import { buildAcVegetacaoReport } from "./report-builder";
import { requestAcVegetacaoVisionWindow, type AcVegetacaoVisionDeps } from "./groq-vision-client";
import { AC_VEGETATION_WINDOW_ID } from "./types";
import type { AcVegetacaoWindowRun, AcPolygonResult, AcPotentialPolygon, AcVegetacaoAnalysis } from "./types";

export { AC_VEGETATION_RULES_VERSION } from "./types";
import { AC_VEGETATION_RULES_VERSION } from "./types";

export type AcVegetacaoRunInput = {
  jobId: string;
  clippedGeometries: Map<string, Geometry[]> | undefined;
  pos2008CompletedAt: string;
  polygons: AcPotentialPolygon[];
};

export type AcVegetacaoProgress = {
  step: string;
  percent: number;
  message: string;
  polygonIndex?: number;
  polygonTotal?: number;
};

export type AcVegetacaoOrchestratorDeps = {
  config?: AcVegetacaoConfig;
  sceneDeps?: WmsFetchDeps;
  visionDeps?: AcVegetacaoVisionDeps;
  persistAcVegetacaoMeta?: (
    meta: Pick<AcVegetacaoAnalysis, "summary" | "polygons" | "scenes" | "windows">
  ) => Promise<void>;
  onProgress?: (progress: AcVegetacaoProgress) => void;
  now?: () => string;
};

function emptyAcAnalysis(jobId: string, startedAt: string, completedAt: string): AcVegetacaoAnalysis {
  return {
    schemaVersion: 1,
    rulesVersion: AC_VEGETATION_RULES_VERSION,
    phase: "AC_VEG",
    jobId,
    pos2008JobRef: null,
    summary: {
      polygonCount: 0,
      totalAcAreaHa: 0,
      declaredVegetationCount: 0,
      declaredVegetationAreaHa: 0,
      apparentVegetationCount: 0,
      cleanCount: 0,
      inconclusiveCount: 0,
    },
    polygons: [],
    scenes: [],
    windows: [],
    report: {
      model: "deterministic-fallback",
      markdown: "Nenhuma Área Consolidada neste recorte. Nenhuma chamada de IA foi realizada.",
      evidenceRefs: [],
    },
    limitations: ["Nenhuma AC para a Fase 3."],
    startedAt,
    completedAt,
  };
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/**
 * Roda a Fase 3. Não faz chamadas a IA se não houver visão configurada (somente
 * geometria). Imutável em relação ao conjunto de polígonos pós-2008.
 */
export async function runAcVegetacaoAnalysis(
  input: AcVegetacaoRunInput,
  deps: AcVegetacaoOrchestratorDeps = {}
): Promise<AcVegetacaoAnalysis> {
  const now = deps.now || (() => new Date().toISOString());
  const startedAt = now();

  const targets = input.polygons;
  if (targets.length === 0) return emptyAcAnalysis(input.jobId, startedAt, now());

  const layers = input.clippedGeometries ?? new Map<string, Geometry[]>();
  const config = deps.config || getAcVegetacaoConfig();

  const sceneSpecs: AcSceneSpec[] = [
    { sceneId: "S2_2024", year: 2024, sensor: "SENTINEL_2", layer: config.currentLayer },
    {
      sceneId: `S2_${config.nirYear}_NIR`,
      year: config.nirYear,
      sensor: "SENTINEL_2",
      layer: config.nirLayer,
      style: config.nirStyle,
    },
    { sceneId: "SPOT_2008", year: 2008, sensor: "SPOT", layer: config.referenceLayer },
  ];

  const windows: AcVegetacaoWindowRun[] = [];
  const scenes: AcVegetacaoAnalysis["scenes"] = [];
  const polygons: AcPolygonResult[] = [];
  const limitations: string[] = [];
  const onProgress = deps.onProgress || (() => {});

  for (const polygon of targets) {
    const idx = targets.indexOf(polygon) + 1;
    onProgress({
      step: "analyzing_polygon",
      percent: Math.round((idx / targets.length) * 90),
      message: `Analisando vegetação na AC ${polygon.polygonId} (${idx}/${targets.length}).`,
      polygonIndex: idx,
      polygonTotal: targets.length,
    });

    const { geometric, flags } = computeGeometric(polygon.geometry, layers, config);

    const builtScenes = [];
    const usedScenes = [];
    for (const spec of sceneSpecs) {
      const scene = await buildAcVegetacaoScene(
        polygon,
        { ...spec, sceneId: `${polygon.polygonId}:${spec.sceneId}` },
        deps.sceneDeps || {}
      );
      builtScenes.push(scene);
      if (scene.usability === "USABLE") usedScenes.push(scene);
    }
    scenes.push(...builtScenes.map(({ imageBuffer: _ignored, ...pub }) => pub));

    if (usedScenes.length === 0) {
      windows.push({
        polygonId: polygon.polygonId,
        windowId: AC_VEGETATION_WINDOW_ID,
        status: "SKIPPED",
        model: AC_VEGETATION_RULES_VERSION,
        errorCode: "NO_USABLE_SCENES",
      });
      limitations.push(`${polygon.polygonId}: nenhuma cena utilizável; apenas evidência geométrica.`);
    } else {
      const visionResult = await requestAcVegetacaoVisionWindow(
        {
          polygonId: polygon.polygonId,
          images: usedScenes.map((s) => ({
            sceneId: s.sceneId,
            year: s.year,
            sensor: s.sensor,
            dataUrl: toDataUrl(s.imageBuffer!),
          })),
        },
        deps.visionDeps
      );
      if (!visionResult.ok) {
        windows.push({
          polygonId: polygon.polygonId,
          windowId: AC_VEGETATION_WINDOW_ID,
          status: "FAILED",
          model: AC_VEGETATION_RULES_VERSION,
          errorCode: visionResult.errorCode,
        });
        limitations.push(`${polygon.polygonId}: visão falhou (${visionResult.errorCode}); apenas evidência geométrica.`);
      } else {
        windows.push({
          polygonId: polygon.polygonId,
          windowId: AC_VEGETATION_WINDOW_ID,
          status: "COMPLETED",
          model: visionResult.model,
          requestId: visionResult.requestId,
          inputTokens: visionResult.inputTokens,
          outputTokens: visionResult.outputTokens,
          observation: visionResult.observation,
        });
      }
    }

    const windowRun = windows[windows.length - 1];
    const result = reduceAcVegetacao(
      {
        polygonId: polygon.polygonId,
        geometryHash: polygon.geometryHash,
        areaHa: polygon.areaHa,
        geometric,
        window: windowRun?.observation ? { observation: windowRun.observation } : null,
        flags,
        pos2008CompletedAt: input.pos2008CompletedAt,
      },
      {
        declaredFractionThreshold: config.minDeclaredFraction,
        declaredAreaHaThreshold: config.minDeclaredAreaHa,
      },
    );
    polygons.push(result);
  }

  const summary = aggregateSummary(polygons);
  onProgress({ step: "writing_report", percent: 97, message: "Redigindo laudo técnico da vegetação na AC." });
  const report = buildAcVegetacaoReport({ polygons, summary, windows });
  onProgress({ step: "completed", percent: 100, message: "Fase 3 concluída." });

  await deps.persistAcVegetacaoMeta?.({
    summary,
    polygons,
    scenes,
    windows,
  });

  return {
    schemaVersion: 1,
    rulesVersion: AC_VEGETATION_RULES_VERSION,
    phase: "AC_VEG",
    jobId: input.jobId,
    pos2008JobRef: { rulesVersion: "auas-pos2008-v1", completedAt: input.pos2008CompletedAt },
    summary,
    polygons,
    scenes,
    windows,
    report,
    limitations,
    startedAt,
    completedAt: now(),
  };
}

function computeGeometric(
  acGeometry: Geometry,
  layers: Map<string, Geometry[]>,
  config: AcVegetacaoConfig,
): { geometric: AcPolygonResult["geometric"]; flags: string[] } {
  const { geometric } = computeAcGeometricEvidence(
    {
      acGeometry,
      layers: {
        AVN: layers.get("AVN"),
        TIPOLOGIA_VEGETAL: layers.get("TIPOLOGIA_VEGETAL"),
        ARL: layers.get("ARL"),
        ARLREM: layers.get("ARLREM"),
        AUAS: layers.get("AUAS"),
      },
    },
    { sliverThresholdM2: config.minSliverM2 }
  );
  const flags: string[] = [];
  if (geometric.arlAreaHa > 0) flags.push("AC_SOBREPOE_ARL");
  if (geometric.auasAreaHa > 0) flags.push("AC_SOBREPOE_AUAS");
  return { geometric, flags };
}

function aggregateSummary(results: AcPolygonResult[]): AcVegetacaoAnalysis["summary"] {
  const declared = results.filter((c) => c.status === "VEGETACAO_DECLARADA_DENTRO_DA_AC");
  const apparent = results.filter((c) => c.status === "VEGETACAO_APARENTE_DENTRO_DA_AC");
  const clean = results.filter((c) => c.status === "SEM_VEGETACAO_APARENTE");
  const inconclusive = results.filter((c) => c.status === "INCONCLUSIVO");
  return {
    polygonCount: results.length,
    totalAcAreaHa: results.reduce((sum, p) => sum + p.areaHa, 0),
    declaredVegetationCount: declared.length,
    declaredVegetationAreaHa: declared.reduce((sum, p) => sum + p.geometric.declaredVegetationAreaHa, 0),
    apparentVegetationCount: apparent.length,
    cleanCount: clean.length,
    inconclusiveCount: inconclusive.length,
  };
}
