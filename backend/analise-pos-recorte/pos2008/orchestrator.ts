/**
 * Orquestrador da Fase 2 (datação 2009–2019) — tarefas F2.8.
 *
 * Fila guiada: por polígono → 5 janelas de visão (+ janela-ponte condicional na
 * fronteira de sensor), checkpoints por janela (namespaced `POS_2008`),
 * cancelamento e progresso SSE no mesmo formato da Fase 1.
 */
import type { Geometry } from "geojson";

import { extractPolygonsFromLayer } from "../polygons";
import { buildPhaseCheckpointKey } from "../checkpoint-store";
import { requestPos2008VisionWindow, type Pos2008VisionDeps } from "./groq-vision-client";
import { resolvePos2008Catalog, type PosCatalog } from "./catalog";
import { buildTimelinePlan } from "./timeline";
import { reducePos2008Aggregate, reducePos2008Polygon, type Pos2008ReducerWindowInput } from "./evidence-reducer";
import { buildPos2008Scene, type BuildPos2008SceneDeps } from "./scenes";
import { buildPos2008Report, type BuildPos2008ReportInput } from "./report-builder";
import type { AuasPolygonIdentity, AuasPre2008AnalysisV2 } from "../types";
import type {
  AuasPos2008Analysis,
  Pos2008Scene,
  Pos2008Sensor,
  Pos2008WindowRun,
  Pos2008WindowId,
} from "./types";

export const POS2008_RULES_VERSION = "auas-pos2008-v1" as const;

export class Pos2008CancelledError extends Error {
  constructor(message = "Análise de datação cancelada.") {
    super(message);
    this.name = "Pos2008CancelledError";
  }
}

export type Pos2008Progress = {
  step: string;
  percent: number;
  message: string;
  polygonIndex?: number;
  polygonTotal?: number;
  windowIndex?: number;
  windowTotal?: number;
  etaSeconds?: number;
};

export type Pos2008CheckpointStore = {
  get(key: string): Promise<Pos2008WindowRun | undefined> | Pos2008WindowRun | undefined;
  set(key: string, value: Pos2008WindowRun): Promise<void> | void;
};

export function createPos2008InMemoryCheckpointStore(): Pos2008CheckpointStore {
  const map = new Map<string, Pos2008WindowRun>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

export type Pos2008OrchestratorDeps = {
  sceneDeps?: BuildPos2008SceneDeps;
  visionDeps?: Pos2008VisionDeps;
  reportDeps?: { apiKey?: string; fetchImpl?: typeof fetch; model?: string; timeoutMs?: number };
  checkpointStore?: Pos2008CheckpointStore;
  catalog?: PosCatalog;
  onProgress?: (progress: Pos2008Progress) => void;
  signal?: AbortSignal;
  now?: () => string;
  visionModel?: string;
  visionMaxImages?: number;
  visionTimeoutMs?: number;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Pos2008CancelledError();
}

function sceneToPublic(scene: Pos2008Scene): Omit<Pos2008Scene, "imageBuffer"> {
  const { imageBuffer, ...rest } = scene;
  return rest;
}

function sceneUsableForVision(scene: Pos2008Scene): boolean {
  return scene.usability === "USABLE" || scene.usability === "CLOUD_OR_OCCLUSION" || scene.usability === "LOW_RESOLUTION";
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Chave de checkpoint da Fase 2 — namespaced e com catalogVersion (invalida ao trocar mosaico). */
export function buildPos2008CheckpointKey(
  jobId: string,
  geometryHash: string,
  windowId: string,
  catalogVersion: string,
  imageSha256s: string[]
): string {
  return buildPhaseCheckpointKey({
    jobId,
    phase: "POS_2008",
    rulesVersion: POS2008_RULES_VERSION,
    catalogVersion,
    geometryHash,
    windowId,
    imageSha256s,
  });
}

export type Pos2008RunInput = {
  jobId: string;
  clippedGeometries: Map<string, Geometry[]> | undefined;
  /** Bloco V2 da Fase 1 — usado para ecoar por polígono e não recalcular. */
  pre2008Meta?: AuasPre2008AnalysisV2 | null;
  /** Bbox do primeiro polígono AUAS — unidade espacial da validação do catálogo. */
  sampleBbox?: [number, number, number, number];
};

function emptyPos2008Analysis(jobId: string, startedAt: string, completedAt: string, catalog: PosCatalog): AuasPos2008Analysis {
  return {
    schemaVersion: 1,
    rulesVersion: POS2008_RULES_VERSION,
    phase: "POS_2008",
    jobId,
    pre2008JobRef: null,
    catalog: {
      version: catalog.version,
      years: catalog.years,
      layerByYear: catalog.layerByYear,
      missingYears: catalog.missingYears,
      alternativesAvailable: catalog.alternativesAvailable,
    },
    summary: {
      polygonCount: 0,
      confirmedYearCount: 0,
      intervalCount: 0,
      alreadyAnthropizedCount: 0,
      noChangeCount: 0,
      inconclusiveCount: 0,
      totalAuasAreaHa: 0,
      areaByStatusHa: {
        CONFIRMADO_ANO: 0,
        CONFIRMADO_INTERVALO: 0,
        JA_ANTROPIZADO_NO_INICIO_DA_SERIE: 0,
        SEM_MUDANCA_OBSERVADA: 0,
        INCONCLUSIVO: 0,
      },
      yearHistogram: {},
    },
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
 * Orquestra a Fase 2: resolve o catálogo runtime, extrai os mesmos polígonos
 * AUAS da Fase 1 (mesmo `polygonId`/`geometryHash`), gera as cenas por ano,
 * consulta a Groq Vision por janela (checkpoint/idempotência), reduz com o
 * redutor determinístico e produz o laudo (DeepSeek + fallback).
 */
export async function runPos2008Analysis(
  input: Pos2008RunInput,
  deps: Pos2008OrchestratorDeps = {}
): Promise<AuasPos2008Analysis> {
  const now = deps.now || (() => new Date().toISOString());
  const startedAt = now();
  const checkpointStore = deps.checkpointStore || createPos2008InMemoryCheckpointStore();
  const onProgress = deps.onProgress || (() => {});
  const signal = deps.signal;
  const catalog = deps.catalog || (await resolvePos2008Catalog({ sampleBbox: input.sampleBbox }));

  const polygons: AuasPolygonIdentity[] = extractPolygonsFromLayer(input.clippedGeometries, "AUAS", "AUAS");
  if (polygons.length === 0) {
    onProgress({ step: "no_auas_layer", percent: 100, message: "Nenhuma geometria AUAS encontrada." });
    return emptyPos2008Analysis(input.jobId, startedAt, now(), catalog);
  }

  const plan = buildTimelinePlan(catalog.entries);
  const pre2008ByPolygon = new Map<string, AuasPre2008AnalysisV2["polygons"][number]>();
  for (const p of input.pre2008Meta?.polygons || []) {
    pre2008ByPolygon.set(p.polygonId, p);
  }

  const totalPolygons = polygons.length;
  const windowsPerPolygon = plan.windows.length + (plan.bridgeWindow ? 1 : 0);
  const totalSteps = totalPolygons + totalPolygons * windowsPerPolygon;
  let stepsDone = 0;
  const progressPercent = () => Math.min(90, Math.round((stepsDone / totalSteps) * 90));

  const allWindowRuns: Pos2008WindowRun[] = [];
  const allScenes: Array<Omit<Pos2008Scene, "imageBuffer">> = [];
  const polygonResults: AuasPos2008Analysis["polygons"] = [];
  const limitations: string[] = [...catalog.limitations];

  const visionModel = deps.visionModel || "qwen/qwen3.6-27b";
  const visionMaxImages = deps.visionMaxImages ?? 3;
  const visionTimeoutMs = deps.visionTimeoutMs ?? 120_000;

  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
    const polygon = polygons[polygonIndex];
    throwIfCancelled(signal);

    onProgress({
      step: "preparing_scenes",
      percent: progressPercent(),
      message: `Gerando cenas da série para ${polygon.polygonId} (${polygonIndex + 1}/${totalPolygons}).`,
      polygonIndex: polygonIndex + 1,
      polygonTotal: totalPolygons,
    });

    const scenesByYear = new Map<number, Pos2008Scene>();
    for (const entry of catalog.entries) {
      throwIfCancelled(signal);
      if (!entry.preferred) continue;
      const scene = await buildPos2008Scene(
        polygon,
        { year: entry.year, sensor: entry.preferred.sensor, layer: entry.preferred.layer },
        deps.sceneDeps
      );
      scenesByYear.set(entry.year, scene);
      allScenes.push(sceneToPublic(scene));
    }
    stepsDone += 1;

    const sceneUsabilityByYear: Record<number, Pos2008Scene["usability"]> = {};
    const sceneIdByYear: Record<number, string> = {};
    for (const [year, scene] of scenesByYear.entries()) {
      sceneUsabilityByYear[year] = scene.usability;
      sceneIdByYear[year] = scene.sceneId;
    }

    // Janela-ponte: cenas dos dois anos da fronteira com o sensor alternativo.
    let bridgeRun: Pos2008WindowRun | null = null;
    const bridgeInput = { available: !!plan.bridgeWindow, executed: false, windowId: null as string | null };
    if (plan.bridgeWindow && plan.bridgeCandidates.length > 0) {
      const candidate = plan.bridgeCandidates[0];
      const years = plan.bridgeWindow.years;
      const bridgeScenes: Pos2008Scene[] = [];
      for (const year of years) {
        const altLayers = candidate.alternateLayers[year] || [];
        const altLayer = altLayers[0];
        if (!altLayer) continue;
        const altSensor = classifySensorFromLayer(altLayer);
        const scene = await buildPos2008Scene(
          polygon,
          { year, sensor: altSensor, layer: altLayer, bridge: true },
          deps.sceneDeps
        );
        scenesByYear.set(year, scene);
        allScenes.push(sceneToPublic(scene));
        sceneUsabilityByYear[year] = scene.usability;
        sceneIdByYear[year] = scene.sceneId;
        bridgeScenes.push(scene);
      }
      if (bridgeScenes.length === years.length) {
        bridgeInput.executed = true;
        bridgeInput.windowId = "WBRIDGE";
        bridgeRun = await runWindow(
          input.jobId,
          polygon,
          "WBRIDGE",
          bridgeScenes,
          catalog.version,
          checkpointStore,
          onProgress,
          signal,
          visionModel,
          visionMaxImages,
          visionTimeoutMs,
          deps
        );
        allWindowRuns.push(bridgeRun);
      }
    }

    const reducerWindows: Pos2008ReducerWindowInput[] = [];
    for (const windowDef of plan.windows) {
      throwIfCancelled(signal);
      onProgress({
        step: "analyzing_polygons",
        percent: progressPercent(),
        message: `Analisando ${polygon.polygonId}, janela ${windowDef.windowId}.`,
        polygonIndex: polygonIndex + 1,
        polygonTotal: totalPolygons,
        windowIndex: plan.windows.indexOf(windowDef) + 1,
        windowTotal: plan.windows.length,
      });
      stepsDone += 1;

      const windowScenes = windowDef.years
        .map((y) => scenesByYear.get(y))
        .filter((s): s is Pos2008Scene => Boolean(s));
      const sendable = windowScenes.filter(sceneUsableForVision);

      if (sendable.length === 0) {
        const skipped: Pos2008WindowRun = {
          polygonId: polygon.polygonId,
          windowId: windowDef.windowId,
          status: "SKIPPED",
          model: visionModel,
          errorCode: "NO_USABLE_SCENES",
        };
        allWindowRuns.push(skipped);
        reducerWindows.push({ windowId: windowDef.windowId, observation: null });
        continue;
      }

      const run = await runWindow(
        input.jobId,
        polygon,
        windowDef.windowId,
        sendable,
        catalog.version,
        checkpointStore,
        onProgress,
        signal,
        visionModel,
        visionMaxImages,
        visionTimeoutMs,
        deps
      );
      allWindowRuns.push(run);
      reducerWindows.push({ windowId: windowDef.windowId, observation: run.observation ?? null });
    }

    const pre2008 = pre2008ByPolygon.get(polygon.polygonId);
    const polygonResult = reducePos2008Polygon({
      polygonId: polygon.polygonId,
      geometryHash: polygon.geometryHash,
      areaHa: polygon.areaHa,
      pre2008: {
        status: pre2008?.status || "SEM_EVIDENCIA_PRE_2008",
        pre2008Alert: pre2008?.pre2008Alert === true,
      },
      sceneUsabilityByYear,
      sceneIdByYear,
      windows: reducerWindows,
      sensorBoundaries: plan.boundaries,
      bridge: {
        available: bridgeInput.available,
        executed: bridgeInput.executed,
        windowId: bridgeInput.windowId,
        observation: bridgeRun?.observation ?? null,
      },
    });
    polygonResults.push(polygonResult);
  }

  throwIfCancelled(signal);
  onProgress({ step: "reducing_evidence", percent: 96, message: "Consolidando evidências da datação." });

  const aggregate = reducePos2008Aggregate(polygonResults);
  const pre2008CompletedAt = input.pre2008Meta?.completedAt || null;
  const pre2008Rules = input.pre2008Meta?.rulesVersion || null;

  limitations.push(
    ...polygonResults
      .filter((p) => p.status === "INCONCLUSIVO")
      .map((p) => `${p.polygonId}: inconclusivo — ${p.limitations.join("; ")}`)
  );

  const reportInput: BuildPos2008ReportInput = {
    rulesVersion: POS2008_RULES_VERSION,
    summary: aggregate,
    catalog: {
      version: catalog.version,
      years: catalog.years,
      layerByYear: catalog.layerByYear,
      missingYears: catalog.missingYears,
      alternativesAvailable: catalog.alternativesAvailable,
    },
    polygons: polygonResults,
    limitations,
    pre2008CompletedAt,
  };

  onProgress({ step: "writing_report", percent: 98, message: "Redigindo laudo técnico da datação." });
  const report = await buildPos2008Report(reportInput, deps.reportDeps);

  const completedAt = now();
  onProgress({ step: "completed", percent: 100, message: "Datação 2009–2019 concluída." });

  return {
    schemaVersion: 1,
    rulesVersion: POS2008_RULES_VERSION,
    phase: "POS_2008",
    jobId: input.jobId,
    pre2008JobRef:
      pre2008Rules && pre2008CompletedAt
        ? { rulesVersion: pre2008Rules, completedAt: pre2008CompletedAt }
        : null,
    catalog: {
      version: catalog.version,
      years: catalog.years,
      layerByYear: catalog.layerByYear,
      missingYears: catalog.missingYears,
      alternativesAvailable: catalog.alternativesAvailable,
    },
    summary: aggregate,
    polygons: polygonResults,
    scenes: allScenes,
    windows: allWindowRuns,
    report,
    limitations,
    startedAt,
    completedAt,
  };
}

async function runWindow(
  jobId: string,
  polygon: AuasPolygonIdentity,
  windowId: Pos2008WindowId | "WBRIDGE",
  scenes: Pos2008Scene[],
  catalogVersion: string,
  checkpointStore: Pos2008CheckpointStore,
  onProgress: (p: Pos2008Progress) => void,
  signal: AbortSignal | undefined,
  visionModel: string,
  visionMaxImages: number,
  visionTimeoutMs: number,
  deps: Pos2008OrchestratorDeps
): Promise<Pos2008WindowRun> {
  const imageShas = scenes.map((s) => s.imageSha256);
  const checkpointKey = buildPos2008CheckpointKey(jobId, polygon.geometryHash, windowId, catalogVersion, imageShas);
  const cached = await checkpointStore.get(checkpointKey);
  if (cached && cached.status === "COMPLETED") {
    return cached;
  }

  const result = await requestPos2008VisionWindow(
    {
      polygonId: polygon.polygonId,
      windowId: windowId as Pos2008WindowId,
      images: scenes.map((s) => ({
        sceneId: s.sceneId,
        year: s.year,
        sensor: s.sensor,
        dataUrl: toDataUrl(s.imageBuffer!),
      })),
    },
    {
      ...deps.visionDeps,
      model: visionModel,
      maxImages: visionMaxImages,
      timeoutMs: visionTimeoutMs,
      signal,
    }
  );

  let windowRun: Pos2008WindowRun;
  if (result.ok) {
    windowRun = {
      polygonId: polygon.polygonId,
      windowId: windowId as Pos2008WindowId,
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
      windowId: windowId as Pos2008WindowId,
      status: "FAILED",
      model: visionModel,
      errorCode: result.errorCode,
    };
  }
  await checkpointStore.set(checkpointKey, windowRun);
  return windowRun;
}

function classifySensorFromLayer(layer: string): Pos2008Sensor {
  if (/RESOURCESAT/i.test(layer)) return "RESOURCESAT";
  if (/LANDSAT_7/i.test(layer)) return "LANDSAT_7";
  if (/LANDSAT_8/i.test(layer)) return "LANDSAT_8";
  if (/LANDSAT_5/i.test(layer)) return "LANDSAT_5";
  if (/SENTINEL/i.test(layer)) return "SENTINEL_2";
  return "LANDSAT_5";
}

export type { Pos2008WindowRun };
