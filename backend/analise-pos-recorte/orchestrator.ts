import type { Geometry } from "geojson";

import { extractAuasPolygons } from "./auas-polygons";
import { buildPhaseCheckpointKey } from "./checkpoint-store";
import { AUAS_REQUIRED_SOURCES, AUAS_RULES_VERSION, AUAS_VISION_WINDOWS, getAuasV2Config, resolveAuasLayerName } from "./config";
import { reduceAuasAggregate, reduceAuasPolygon, type ReducerWindowInput } from "./evidence-reducer";
import { requestGroqVisionWindow, type GroqVisionDeps } from "./groq-vision-client";
import { buildAuasReport, type BuildAuasReportInput } from "./report-builder";
import type { DeepseekTextDeps } from "./deepseek-text-client";
import { buildAuasScene, type BuildAuasSceneDeps } from "./wms-scenes";
import type {
  AuasPolygonIdentity,
  AuasPre2008AnalysisV2,
  AuasScene,
  AuasV2Progress,
  AuasWindowId,
  AuasWindowRun,
  AuasYear,
} from "./types";

export class AuasCancelledError extends Error {
  constructor(message = "Análise AUAS cancelada.") {
    super(message);
    this.name = "AuasCancelledError";
  }
}

export class AuasTooManyPolygonsError extends Error {
  constructor(
    public readonly polygonCount: number,
    public readonly limit: number
  ) {
    super(
      `Job possui ${polygonCount} polígonos AUAS, acima do limite configurado (${limit}). Recusado antes de processar/cobrar.`
    );
    this.name = "AuasTooManyPolygonsError";
  }
}

export type CheckpointStore = {
  get(key: string): Promise<AuasWindowRun | undefined> | AuasWindowRun | undefined;
  set(key: string, value: AuasWindowRun): Promise<void> | void;
};

/** Store em memória — usado como default em testes; a integração de rota injeta um store durável. */
export function createInMemoryCheckpointStore(): CheckpointStore {
  const map = new Map<string, AuasWindowRun>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

export type OrchestratorDeps = {
  sceneDeps?: BuildAuasSceneDeps;
  groqDeps?: GroqVisionDeps;
  deepseekDeps?: DeepseekTextDeps;
  checkpointStore?: CheckpointStore;
  onProgress?: (progress: AuasV2Progress) => void;
  signal?: AbortSignal;
  now?: () => string;
  config?: ReturnType<typeof getAuasV2Config>;
  acAvnContext?: { source: string; summary: string };
};

/**
 * Chave de checkpoint da Fase 1. Delega em `buildPhaseCheckpointKey` para que as
 * três fases compartilhem o mesmo formato namespaced (tarefa F0.4 do plano).
 */
export function buildCheckpointKey(
  jobId: string,
  geometryHash: string,
  windowId: AuasWindowId,
  rulesVersion: string,
  imageSha256s: string[]
): string {
  return buildPhaseCheckpointKey({
    jobId,
    phase: "PRE_2008",
    rulesVersion,
    geometryHash,
    windowId,
    imageSha256s,
  });
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AuasCancelledError();
}

function sceneToPublic(scene: AuasScene): Omit<AuasScene, "imageBuffer"> {
  const { imageBuffer, ...rest } = scene;
  return rest;
}

function sceneUsableForVision(scene: AuasScene): boolean {
  return scene.usability === "USABLE" || scene.usability === "CLOUD_OR_OCCLUSION" || scene.usability === "LOW_RESOLUTION";
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function emptyAnalysis(jobId: string, startedAt: string, completedAt: string): AuasPre2008AnalysisV2 {
  return {
    schemaVersion: 2,
    rulesVersion: AUAS_RULES_VERSION,
    jobId,
    status: "SEM_EVIDENCIA_PRE_2008",
    pre2008Alert: false,
    confidence: "INCONCLUSIVE",
    summary: {
      polygonCount: 0,
      alertCount: 0,
      inconclusiveCount: 0,
      noEvidenceCount: 0,
      totalAuasAreaHa: 0,
      alertAreaHa: 0,
    },
    sources: { required: AUAS_REQUIRED_SOURCES.map((s) => s.defaultLayer), used: [], missing: [] },
    polygons: [],
    scenes: [],
    windows: [],
    report: {
      model: "deterministic-fallback",
      markdown: "Nenhuma geometria classificada como AUAS foi encontrada nesta análise. Nenhuma chamada de IA foi realizada.",
      evidenceRefs: [],
    },
    limitations: ["Camada AUAS ausente ou vazia no recorte SIMCAR."],
    startedAt,
    completedAt,
  };
}

/**
 * Orquestra a análise pré-2008 de AUAS: extrai polígonos individualmente,
 * gera as 6 cenas por polígono, consulta a Groq Vision por janela (com
 * checkpoint/idempotência), reduz para status determinístico e produz o
 * laudo final via DeepSeek (com fallback determinístico).
 */
export async function runAuasPre2008Analysis(
  jobId: string,
  clippedGeometries: Map<string, Geometry[]> | undefined,
  deps: OrchestratorDeps = {}
): Promise<AuasPre2008AnalysisV2> {
  const cfg = deps.config || getAuasV2Config();
  const now = deps.now || (() => new Date().toISOString());
  const startedAt = now();
  const checkpointStore = deps.checkpointStore || createInMemoryCheckpointStore();
  const onProgress = deps.onProgress || (() => {});
  const signal = deps.signal;

  const polygons: AuasPolygonIdentity[] = extractAuasPolygons(clippedGeometries);

  if (polygons.length === 0) {
    onProgress({ step: "no_auas_layer", percent: 100, message: "Nenhuma geometria AUAS encontrada." });
    return emptyAnalysis(jobId, startedAt, now());
  }

  if (cfg.maxPolygonsPerJob > 0 && polygons.length > cfg.maxPolygonsPerJob) {
    throw new AuasTooManyPolygonsError(polygons.length, cfg.maxPolygonsPerJob);
  }

  const totalPolygons = polygons.length;
  const totalWindows = totalPolygons * AUAS_VISION_WINDOWS.length;
  const totalSteps = totalPolygons + totalWindows; // 1 passo de preparo de cenas + 1 passo por janela, por polígono
  let stepsDone = 0;
  const progressPercent = () => Math.min(90, Math.round((stepsDone / totalSteps) * 90));

  const allWindowRuns: AuasWindowRun[] = [];
  const allScenes: Omit<AuasScene, "imageBuffer">[] = [];
  const polygonResults = [] as ReturnType<typeof reduceAuasPolygon>[];
  const usedYears = new Set<number>();
  const attemptedYears = new Set<number>();

  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const polygon = polygons[polygonIndex];
    throwIfCancelled(signal);

    onProgress({
      step: "preparing_scenes",
      percent: progressPercent(),
      message: `Gerando cenas do polígono ${polygon.polygonId} (${polygonIndex + 1}/${totalPolygons}).`,
      polygonIndex: polygonIndex + 1,
      polygonTotal: totalPolygons,
    });

    const scenesByYear = new Map<AuasYear, AuasScene>();
    for (const source of AUAS_REQUIRED_SOURCES) {
      throwIfCancelled(signal);
      const scene = await buildAuasScene(polygon, source.year, deps.sceneDeps);
      scenesByYear.set(source.year, scene);
      allScenes.push(sceneToPublic(scene));
      attemptedYears.add(source.year);
      if (scene.usability !== "MISSING" && scene.usability !== "INVALID") {
        usedYears.add(source.year);
      }
    }
    stepsDone += 1;

    const sceneUsabilityByYear: Partial<Record<AuasYear, AuasScene["usability"]>> = {};
    const sceneIdByYear: Partial<Record<AuasYear, string>> = {};
    for (const [year, scene] of scenesByYear.entries()) {
      sceneUsabilityByYear[year] = scene.usability;
      sceneIdByYear[year] = scene.sceneId;
    }

    const reducerWindows: ReducerWindowInput[] = [];

    for (const windowDef of AUAS_VISION_WINDOWS) {
      throwIfCancelled(signal);
      onProgress({
        step: "analyzing_polygons",
        percent: progressPercent(),
        message: `Analisando ${polygon.polygonId}, janela ${windowDef.windowId}.`,
        polygonIndex: polygonIndex + 1,
        polygonTotal: totalPolygons,
        windowIndex: AUAS_VISION_WINDOWS.indexOf(windowDef) + 1,
        windowTotal: AUAS_VISION_WINDOWS.length,
      });
      stepsDone += 1;

      const windowScenes = windowDef.years.map((y) => scenesByYear.get(y as AuasYear)!).filter(Boolean);
      const sendableScenes = windowScenes.filter(sceneUsableForVision);

      if (sendableScenes.length === 0) {
        const skipped: AuasWindowRun = {
          polygonId: polygon.polygonId,
          windowId: windowDef.windowId,
          status: "SKIPPED",
          model: cfg.visionModel,
          errorCode: "NO_USABLE_SCENES",
        };
        allWindowRuns.push(skipped);
        reducerWindows.push({ windowId: windowDef.windowId, observation: null });
        continue;
      }

      const imageShas = sendableScenes.map((s) => s.imageSha256);
      const checkpointKey = buildCheckpointKey(jobId, polygon.geometryHash, windowDef.windowId, AUAS_RULES_VERSION, imageShas);
      const cached = await checkpointStore.get(checkpointKey);
      if (cached && cached.status === "COMPLETED") {
        allWindowRuns.push(cached);
        reducerWindows.push({ windowId: windowDef.windowId, observation: cached.observation ?? null });
        continue;
      }

      const result = await requestGroqVisionWindow(
        {
          polygonId: polygon.polygonId,
          windowId: windowDef.windowId,
          images: sendableScenes.map((s) => ({
            sceneId: s.sceneId,
            year: s.year,
            sensor: s.sensor,
            dataUrl: toDataUrl(s.imageBuffer!),
          })),
        },
        { ...deps.groqDeps, model: cfg.visionModel, maxImages: cfg.visionMaxImages, timeoutMs: cfg.visionTimeoutMs, signal }
      );

      let windowRun: AuasWindowRun;
      if (result.ok) {
        windowRun = {
          polygonId: polygon.polygonId,
          windowId: windowDef.windowId,
          status: "COMPLETED",
          model: result.model,
          requestId: result.requestId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          observation: result.observation,
        };
      } else {
        windowRun = {
          polygonId: polygon.polygonId,
          windowId: windowDef.windowId,
          status: "FAILED",
          model: cfg.visionModel,
          errorCode: result.errorCode,
        };
      }
      await checkpointStore.set(checkpointKey, windowRun);
      allWindowRuns.push(windowRun);
      reducerWindows.push({ windowId: windowDef.windowId, observation: windowRun.observation ?? null });
    }

    const polygonResult = reduceAuasPolygon({
      polygonId: polygon.polygonId,
      geometryHash: polygon.geometryHash,
      sourceIndex: polygon.sourceIndex,
      areaHa: polygon.areaHa,
      bbox: polygon.bbox,
      sceneUsabilityByYear,
      sceneIdByYear,
      windows: reducerWindows,
    });
    polygonResults.push(polygonResult);
  }

  throwIfCancelled(signal);
  onProgress({ step: "reducing_evidence", percent: 96, message: "Consolidando evidências." });

  const aggregate = reduceAuasAggregate(polygonResults);
  const requiredLayers = AUAS_REQUIRED_SOURCES.map((s) => resolveAuasLayerName(s.year));
  const usedLayers = AUAS_REQUIRED_SOURCES.filter((s) => usedYears.has(s.year)).map((s) => resolveAuasLayerName(s.year));
  const missingLayers = AUAS_REQUIRED_SOURCES.filter((s) => !usedYears.has(s.year)).map((s) => resolveAuasLayerName(s.year));

  const limitations = polygonResults.some((p) => p.status === "INCONCLUSIVO_NO_MARCO_2008")
    ? ["Um ou mais polígonos têm mudança observada apenas na transição 2007→SPOT 2008; não é possível afirmar de qual lado de 22/07/2008 ela ocorreu."]
    : [];

  const reportInput: BuildAuasReportInput = {
    rulesVersion: AUAS_RULES_VERSION,
    aggregateStatus: aggregate.status,
    pre2008Alert: aggregate.pre2008Alert,
    summary: {
      polygonCount: polygons.length,
      alertCount: aggregate.alertCount,
      inconclusiveCount: aggregate.inconclusiveCount,
      noEvidenceCount: aggregate.noEvidenceCount,
      totalAuasAreaHa: aggregate.totalAuasAreaHa,
      alertAreaHa: aggregate.alertAreaHa,
    },
    sources: { required: requiredLayers, used: usedLayers, missing: missingLayers },
    polygons: polygonResults,
    limitations,
    acAvnContext: deps.acAvnContext,
  };

  onProgress({ step: "writing_report", percent: 98, message: "Redigindo laudo técnico." });
  const report = await buildAuasReport(reportInput, deps.deepseekDeps);

  const completedAt = now();
  onProgress({ step: "completed", percent: 100, message: "Análise pré-2008 concluída." });

  const confidenceOrder = ["HIGH", "MEDIUM", "LOW", "INCONCLUSIVE"] as const;
  const overallConfidence =
    polygonResults
      .map((p) => p.confidence)
      .sort((a, b) => confidenceOrder.indexOf(a) - confidenceOrder.indexOf(b))
      .pop() || "INCONCLUSIVE";

  return {
    schemaVersion: 2,
    rulesVersion: AUAS_RULES_VERSION,
    jobId,
    status: aggregate.status,
    pre2008Alert: aggregate.pre2008Alert,
    confidence: overallConfidence,
    summary: {
      polygonCount: polygons.length,
      alertCount: aggregate.alertCount,
      inconclusiveCount: aggregate.inconclusiveCount,
      noEvidenceCount: aggregate.noEvidenceCount,
      totalAuasAreaHa: aggregate.totalAuasAreaHa,
      alertAreaHa: aggregate.alertAreaHa,
    },
    sources: { required: requiredLayers, used: usedLayers, missing: missingLayers },
    polygons: polygonResults,
    scenes: allScenes,
    windows: allWindowRuns,
    report,
    limitations,
    startedAt,
    completedAt,
  };
}
