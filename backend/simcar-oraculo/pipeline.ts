import crypto from "node:crypto";
import path from "node:path";
import {
  getAbsoluteStoragePath,
  saveSimcarOraculoArtifact,
  saveSimcarOraculoJobSnapshot,
} from "../local-storage";
import { assertTestCarId, getSimcarOraculoConfig } from "./config";
import { applyFixActions } from "./autofix/apply";
import { buildFixPlan } from "./autofix/plan";
import {
  IMPORT_AUTOFIX_ACTION_TYPES,
  PROCESS_AUTOFIX_ACTION_TYPES,
  type ApplyFixPlanResult,
  type FixAction,
  type FixDiffSummary,
  type FixPlan,
  type PlannerPreviousRound,
} from "./autofix/types";
import { simcarDownload, simcarPost, withSimcarAuthRetry } from "./client";
import {
  OraculoPipelineCancelledError,
  isOraculoPipelineCancelledError,
} from "./errors";
import { importZipOnTestProjectUnlocked } from "./import-shape";
import {
  appendOraculoTimelineEvent,
  persistOraculoJob,
  readOraculoJob,
} from "./job-store";
import { prepareTestProject } from "./prepare-project";
import { processGeoOnTestProjectUnlocked } from "./process-geo";
import { enqueueSimcar, getSimcarQueueLength } from "./queue";
import { parseSemaReportPdf } from "./sema-report-parse";
import { extractShapeContext } from "./shape-context";
import type {
  AutofixStopReason,
  OraculoArtifact,
  OraculoEvent,
  OraculoProgress,
  OraculoRoundResult,
  ShapeContext,
  SimcarImportOutcome,
  SimcarProcessOutcome,
} from "./types";

type Enqueue = <T>(fn: () => Promise<T>) => Promise<T>;
type ImportOperation = (args: {
  carId?: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (event: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}) => Promise<SimcarImportOutcome>;
type ProcessOperation = (args: {
  carId?: string;
  onProgress?: (event: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}) => Promise<SimcarProcessOutcome>;

export type OraculoPipelineNotification =
  | {
      type: "event";
      jobId: string;
      event: OraculoEvent;
      job: Record<string, any>;
    }
  | { type: "snapshot"; jobId: string; job: Record<string, any> };

export type OraculoPipelineDependencies = {
  enqueue: Enqueue;
  prepare: typeof prepareTestProject;
  importZip: ImportOperation;
  processGeo: ProcessOperation;
  parseReportPdf: typeof parseSemaReportPdf;
  buildFixPlan: typeof buildFixPlan;
  applyFixActions: (
    zipBuffer: Buffer,
    actions: FixAction[]
  ) => Promise<ApplyFixPlanResult>;
  downloadArtifact: (
    pathname: string
  ) => Promise<{ buffer: Buffer; contentType: string | null }>;
  cancelRemote: (phase: "import" | "process", carId: string) => Promise<void>;
  now: () => Date;
};

export type StartOraculoPipelineArgs = {
  uid: string;
  uploadId: string;
  zip: Buffer;
  fileName: string;
  shape?: ShapeContext;
  carId?: string;
  autoProcess?: boolean;
  autofix?: boolean;
  maxRounds?: number;
  jobId?: string;
  dependencies?: Partial<OraculoPipelineDependencies>;
  onNotification?: (notification: OraculoPipelineNotification) => void;
};

export type StartedOraculoPipeline = {
  jobId: string;
  queuePosition: number;
  completion: Promise<Record<string, any>>;
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function defaultCancelRemote(phase: "import" | "process", carId: string): Promise<void> {
  assertTestCarId(carId);
  const pathname =
    phase === "import"
      ? `Requerimento/CancelarImportacaoShape/${carId}`
      : `Requerimento/CancelarProcessamentoGeo/${carId}`;
  return withSimcarAuthRetry(async (token) => {
    await simcarPost(token, pathname);
  });
}

function dependencies(
  overrides: Partial<OraculoPipelineDependencies> = {}
): OraculoPipelineDependencies {
  return {
    enqueue: enqueueSimcar,
    prepare: prepareTestProject,
    importZip: importZipOnTestProjectUnlocked,
    processGeo: processGeoOnTestProjectUnlocked,
    parseReportPdf: parseSemaReportPdf,
    buildFixPlan,
    applyFixActions,
    downloadArtifact: pathname =>
      withSimcarAuthRetry(token => simcarDownload(token, pathname)),
    cancelRemote: defaultCancelRemote,
    now: () => new Date(),
    ...overrides,
  };
}

function eventAt(
  deps: OraculoPipelineDependencies,
  round: number,
  progress: OraculoProgress,
): OraculoEvent {
  return { ...progress, ts: deps.now().toISOString(), round };
}

function artifactUrl(jobId: string, key: string): string {
  return `/api/simcar-oraculo/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(key)}`;
}

function createArtifact(args: {
  uid: string;
  jobId: string;
  round: number;
  key: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  source: OraculoArtifact["source"];
}): OraculoArtifact {
  const stored = saveSimcarOraculoArtifact(args);
  return {
    key: args.key,
    round: args.round,
    filename: args.filename,
    relativePath: stored.relativePath,
    url: artifactUrl(args.jobId, args.key),
    contentType: args.contentType,
    bytes: stored.bytes,
    source: args.source,
  };
}

function normalizeMaxRounds(value: number | undefined): number {
  const raw = value ?? Number(process.env.AUTOFIX_MAX_ROUNDS || 3);
  const rounded = Math.trunc(Number(raw));
  return Number.isFinite(rounded) ? Math.min(3, Math.max(1, rounded)) : 3;
}

function mapPhaseProgress(
  phase: "import" | "process",
  progress: OraculoProgress,
  round: number,
  maxRounds: number
): OraculoProgress {
  const raw = Math.min(100, Math.max(0, Number(progress.percent ?? 0)));
  const span = 86 / Math.max(1, maxRounds);
  const base = 10 + (Math.max(1, round) - 1) * span;
  const percent = Math.round(
    phase === "import"
      ? base + (raw / 100) * span * 0.55
      : base + span * 0.55 + (raw / 100) * span * 0.4
  );
  return { ...progress, percent };
}

type ErrorSummary = { camada: string; erro: string; qtd: number };
type AutofixPhase = "import" | "process";

type FixPlanArtifactPayload = {
  schemaVersion: 1;
  round: number;
  phase: AutofixPhase;
  input: {
    resultado: string;
    errosResumo: ErrorSummary[];
    totalErrors: number;
  };
  plan: FixPlan;
  diffResumo: FixDiffSummary[];
  resultadoRodadaSeguinte: null | {
    round: number;
    import?: {
      ok: boolean;
      resultado: string;
      errosResumo: ErrorSummary[];
    };
    process?: {
      ok: boolean;
      resultado: string;
      errosResumo: ErrorSummary[];
    };
  };
  applicationError?: string;
  createdAt: string;
  updatedAt: string;
};

type AutofixDecision =
  | {
      kind: "continue";
      zip: Buffer;
      fileName: string;
    }
  | {
      kind: "stop";
      reason: AutofixStopReason;
      message: string;
    };

function totalErrors(errors: ErrorSummary[]): number {
  return errors.reduce(
    (total, error) => total + Math.max(0, Number(error.qtd) || 0),
    0
  );
}

function actionSignature(actions: FixAction[]): string {
  return actions
    .flatMap(action =>
      action.layers.map(
        layer =>
          `${action.type}:${String(layer || "")
            .trim()
            .toUpperCase()}`
      )
    )
    .sort()
    .join("|");
}

async function executePipeline(args: {
  input: StartOraculoPipelineArgs;
  deps: OraculoPipelineDependencies;
  jobId: string;
  carId: string;
  shape: ShapeContext;
  initialRounds: OraculoRoundResult[];
}): Promise<Record<string, any>> {
  const { input, deps, jobId, carId, shape } = args;
  const maxRounds = normalizeMaxRounds(input.maxRounds);
  let round = 1;
  let currentZip = input.zip;
  let currentFileName = input.fileName;
  let previousAutofixRound: PlannerPreviousRound | null = null;
  let activeRemotePhase: "import" | "process" | null = null;
  const remoteCancelAttempted = new Set<string>();
  const fixPlanArtifacts = new Map<number, FixPlanArtifactPayload>();
  let state = readOraculoJob(input.uid, jobId) || {};

  const notifySnapshot = (): void => {
    input.onNotification?.({ type: "snapshot", jobId, job: state });
  };
  const persist = (
    patch: Record<string, unknown>,
    notify = true
  ): Record<string, any> => {
    state = persistOraculoJob(input.uid, jobId, patch);
    if (notify) notifySnapshot();
    return state;
  };
  const emit = (
    progress: OraculoProgress,
    patch: Record<string, unknown> = {}
  ): OraculoEvent => {
    const event = eventAt(deps, round, progress);
    state = appendOraculoTimelineEvent(input.uid, jobId, event, {
      ...patch,
      lastStep: event.step,
      message: event.message,
      percent: event.percent ?? state.percent ?? null,
    });
    input.onNotification?.({ type: "event", jobId, event, job: state });
    return event;
  };
  const updateRoundAt = (
    targetRound: number,
    patch: Partial<OraculoRoundResult>
  ): void => {
    const currentRounds = Array.isArray(state.rounds)
      ? (state.rounds as OraculoRoundResult[])
      : args.initialRounds;
    const rounds = currentRounds.map(item =>
      item.n === targetRound
        ? ({ ...item, ...patch } as OraculoRoundResult)
        : item
    );
    persist({ rounds });
  };
  const updateRound = (patch: Partial<OraculoRoundResult>): void =>
    updateRoundAt(round, patch);
  const appendRound = (nextRound: OraculoRoundResult): void => {
    const currentRounds = Array.isArray(state.rounds)
      ? (state.rounds as OraculoRoundResult[])
      : args.initialRounds;
    const rounds = [
      ...currentRounds.filter(item => item.n !== nextRound.n),
      nextRound,
    ].sort((a, b) => a.n - b.n);
    persist({ rounds });
  };
  const addArtifact = (artifact: OraculoArtifact): void => {
    const current =
      state.artifacts && typeof state.artifacts === "object"
        ? state.artifacts
        : {};
    persist({ artifacts: { ...current, [artifact.key]: artifact } });
  };
  const addArtifactWarnings = (warnings: string[]): void => {
    if (!warnings.length) return;
    const currentRounds = Array.isArray(state.rounds)
      ? (state.rounds as OraculoRoundResult[])
      : args.initialRounds;
    const rounds = currentRounds.map(item =>
      item.n === round
        ? {
            ...item,
            artifactWarnings: [...(item.artifactWarnings || []), ...warnings],
          }
        : item
    );
    persist({ rounds });
  };
  const writeFixPlanArtifact = (payload: FixPlanArtifactPayload): void => {
    payload.updatedAt = deps.now().toISOString();
    fixPlanArtifacts.set(payload.round, payload);
    const key = `fixplan-r${payload.round}`;
    const artifact = createArtifact({
      uid: input.uid,
      jobId,
      round: payload.round,
      key,
      filename: "fixplan.json",
      contentType: "application/json",
      buffer: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
      source: "autofix",
    });
    addArtifact(artifact);
    updateRoundAt(payload.round, {
      fixplan: key,
      fixPlan: payload.plan,
      diffResumo: payload.diffResumo,
      autofixPhase: payload.phase,
    });
  };
  const updatePreviousFixPlanResult = (
    phase: AutofixPhase,
    outcome: {
      ok: boolean;
      resultado: string;
      errosResumo: ErrorSummary[];
    }
  ): void => {
    if (round <= 1) return;
    const payload = fixPlanArtifacts.get(round - 1);
    if (!payload) return;
    const previous = payload.resultadoRodadaSeguinte;
    payload.resultadoRodadaSeguinte = {
      ...(previous || { round }),
      round,
      [phase]: outcome,
    };
    writeFixPlanArtifact(payload);
  };
  const downloadOptionalArtifacts = async (
    specs: Array<{
      key: string;
      filename: string;
      pathname: string;
      label: string;
    }>
  ): Promise<void> => {
    const warnings: string[] = [];
    for (const spec of specs) {
      await checkCancelled();
      try {
        const downloaded = await deps.downloadArtifact(spec.pathname);
        if (!downloaded.buffer.length) throw new Error("arquivo vazio");
        const artifact = createArtifact({
          uid: input.uid,
          jobId,
          round,
          key: spec.key,
          filename: spec.filename,
          // A SEMA usa application/x-zip-compressed em parte dos endpoints; o contrato
          // público do artefato normaliza todos estes downloads conhecidos para ZIP.
          contentType: "application/zip",
          buffer: downloaded.buffer,
          source: "sema",
        });
        addArtifact(artifact);
        emit({
          step: "download_artifacts",
          message: `${spec.label} baixado da SEMA.`,
          data: { artifact: spec.key, bytes: artifact.bytes },
        });
      } catch (error: any) {
        const absent =
          Number(error?.status) === 400 || Number(error?.status) === 404;
        const warning = absent
          ? `${spec.label} não disponível nesta rodada.`
          : `Falha não bloqueante ao baixar ${spec.label}: ${error?.message || error}`;
        warnings.push(warning);
        emit({
          step: "download_artifacts",
          message: warning,
          data: {
            artifact: spec.key,
            optional: true,
            httpStatus: error?.status ?? null,
          },
        });
      }
    }
    addArtifactWarnings(warnings);
  };
  const checkCancelled = async (): Promise<void> => {
    const latest = readOraculoJob(input.uid, jobId);
    const requested =
      Boolean(latest?.cancelRequested) ||
      String(latest?.status || "") === "cancel_requested";
    if (!requested) return;
    if (activeRemotePhase && !remoteCancelAttempted.has(activeRemotePhase)) {
      remoteCancelAttempted.add(activeRemotePhase);
      try {
        await deps.cancelRemote(activeRemotePhase, carId);
        emit({
          step: "cancel_requested",
          message: `Cancelamento ${activeRemotePhase === "import" ? "da importação" : "do processamento"} solicitado à SEMA (best-effort).`,
        });
      } catch (error: any) {
        emit({
          step: "cancel_requested",
          message: `A SEMA não confirmou o cancelamento remoto; o GeoForest parou de acompanhar: ${error?.message || error}`,
        });
      }
    }
    throw new OraculoPipelineCancelledError();
  };
  const terminal = (
    status: "completed" | "failed" | "cancelled",
    patch: Record<string, unknown>
  ): Record<string, any> => {
    const finishedAt = deps.now().toISOString();
    const snapshotRelativePath = `users/${input.uid}/simcar-oraculo/${jobId}/job.json`;
    state = persistOraculoJob(input.uid, jobId, {
      ...patch,
      status,
      stage: status,
      finishedAt,
      cancelRequested: false,
      snapshotRelativePath,
    });
    try {
      saveSimcarOraculoJobSnapshot({ uid: input.uid, jobId, data: state });
    } catch (error: any) {
      state = persistOraculoJob(input.uid, jobId, {
        snapshotWarning: `Falha ao gravar job.json: ${error?.message || error}`,
      });
    }
    notifySnapshot();
    return state;
  };

  const stopDecision = (
    reason: AutofixStopReason,
    message: string
  ): AutofixDecision => ({ kind: "stop", reason, message });

  const planAndApply = async (argsPlan: {
    phase: AutofixPhase;
    reportText: string;
    errosResumo: ErrorSummary[];
    resultado: string;
  }): Promise<AutofixDecision> => {
    if (input.autofix !== true) {
      return stopDecision(
        "autofix_disabled",
        "Correção automática desativada para este job."
      );
    }
    if (round >= maxRounds) {
      return stopDecision(
        "max_rounds",
        `Teto de rodadas atingido (${round}/${maxRounds}); nenhuma nova correção será aplicada automaticamente.`
      );
    }

    await checkCancelled();
    emit(
      {
        step: "autofix_plan",
        message: `Analisando as pendências da rodada ${round} e preparando um plano seguro…`,
        data: {
          phase: argsPlan.phase,
          totalErrors: totalErrors(argsPlan.errosResumo),
        },
      },
      { stage: "autofix" }
    );
    const plan = await deps.buildFixPlan({
      reportText: argsPlan.reportText,
      errosResumo: argsPlan.errosResumo,
      previousRound: previousAutofixRound,
      allowedActions:
        argsPlan.phase === "import"
          ? IMPORT_AUTOFIX_ACTION_TYPES
          : PROCESS_AUTOFIX_ACTION_TYPES,
    });
    await checkCancelled();
    const now = deps.now().toISOString();
    const payload: FixPlanArtifactPayload = {
      schemaVersion: 1,
      round,
      phase: argsPlan.phase,
      input: {
        resultado: argsPlan.resultado,
        errosResumo: argsPlan.errosResumo,
        totalErrors: totalErrors(argsPlan.errosResumo),
      },
      plan,
      diffResumo: [],
      resultadoRodadaSeguinte: null,
      createdAt: now,
      updatedAt: now,
    };
    writeFixPlanArtifact(payload);

    if (!plan.acoes.length) {
      return stopDecision(
        "no_mechanical_action",
        plan.naoCorrigivel[0]?.orientacao
          ? `Nada corrigível mecanicamente. ${plan.naoCorrigivel[0].orientacao}`
          : "Nada corrigível mecanicamente; revise os artefatos no GIS antes de um novo envio."
      );
    }

    const currentSignature = actionSignature(plan.acoes);
    if (
      previousAutofixRound &&
      payload.input.totalErrors >= previousAutofixRound.totalErrors &&
      currentSignature === actionSignature(previousAutofixRound.actions)
    ) {
      return stopDecision(
        "no_improvement",
        `Rodada ${round}/${maxRounds} sem melhora: a quantidade de erros não caiu e o conjunto de ações continuou igual.`
      );
    }

    emit(
      {
        step: "autofix_apply",
        message: `Aplicando ${plan.acoes.length} ação(ões) mecânica(s) segura(s) para a rodada ${round + 1}/${maxRounds}…`,
        data: {
          actions: plan.acoes.map(action => ({
            type: action.type,
            layers: action.layers,
          })),
        },
      },
      { stage: "autofix" }
    );

    let applied: ApplyFixPlanResult;
    try {
      applied = await deps.applyFixActions(currentZip, plan.acoes);
    } catch (error: any) {
      payload.applicationError = String(
        error?.message || "Falha ao aplicar o plano mecânico."
      ).slice(0, 500);
      writeFixPlanArtifact(payload);
      return stopDecision(
        "apply_failed",
        `A correção foi recusada com segurança: ${payload.applicationError}`
      );
    }
    await checkCancelled();
    payload.diffResumo = applied.diffResumo;
    writeFixPlanArtifact(payload);
    if (!applied.diffResumo.some(item => item.alterou)) {
      return stopDecision(
        "no_changes",
        "O plano não alterou nenhuma feição; o mesmo ZIP não será reenviado."
      );
    }

    const nextRound = round + 1;
    const correctedKey = `corrigido-zip-r${nextRound}`;
    const correctedFileName = `corrigido_r${nextRound}.zip`;
    const correctedArtifact = createArtifact({
      uid: input.uid,
      jobId,
      round: nextRound,
      key: correctedKey,
      filename: correctedFileName,
      contentType: "application/zip",
      buffer: applied.novoZip,
      source: "autofix",
    });
    addArtifact(correctedArtifact);
    appendRound({
      n: nextRound,
      zipArtifact: correctedKey,
      import: null,
      process: null,
      artifactWarnings: [],
      fixplan: null,
      fixPlan: null,
      diffResumo: [],
      autofixPhase: null,
    });
    previousAutofixRound = {
      round,
      totalErrors: payload.input.totalErrors,
      actions: plan.acoes,
      resultado: argsPlan.resultado,
    };
    emit(
      {
        step: "autofix_apply",
        message: `ZIP corrigido preservado; iniciando o reenvio da rodada ${nextRound}/${maxRounds}.`,
        data: {
          artifact: correctedKey,
          diffResumo: applied.diffResumo,
          nextRound,
        },
      },
      { stage: "autofix" }
    );
    round = nextRound;
    persist({
      round,
      stage: "importing",
      autofixStopReason: null,
      autofixStopMessage: null,
      manualAutofixAvailable: false,
    });
    return {
      kind: "continue",
      zip: applied.novoZip,
      fileName: correctedFileName,
    };
  };

  const finishRejected = (
    phase: AutofixPhase,
    outcome: { resultado: string },
    decision: Extract<AutofixDecision, { kind: "stop" }>
  ): Record<string, any> => {
    emit(
      {
        step: "autofix_skip",
        message: decision.message,
        data: { reason: decision.reason, phase, round, maxRounds },
      },
      { stage: "autofix_stopped" }
    );
    emit({
      step: "done",
      message: `Pipeline concluído com pendência. ${decision.message}`,
      percent: 100,
    });
    return terminal("completed", {
      ok: false,
      importOk: phase === "import" ? false : true,
      processOk: phase === "process" ? false : null,
      resultado: outcome.resultado,
      round,
      autofixStopReason: decision.reason,
      autofixStopMessage: decision.message,
      manualAutofixAvailable: false,
      manualAutofixReason:
        "Nenhuma ação mecânica nova está disponível. Edite o ZIP no GIS e inicie um novo job.",
    });
  };

  try {
    await checkCancelled();
    persist({
      status: "running",
      stage: "preparing",
      startedAt: deps.now().toISOString(),
    });
    emit({
      step: "login",
      message: "Autenticando a sessão técnica do SIMCAR…",
      percent: 2,
    });

    const prepare = await deps.prepare({
      carId,
      shape,
      checkCancelled,
      onEvent: progress => emit(progress, { stage: "preparing" }),
    });
    persist({ prepare, stage: "importing" });

    while (true) {
      await checkCancelled();
      persist({ round, stage: "importing" });
      const importOutcome = await deps.importZip({
        carId,
        zip: currentZip,
        fileName: currentFileName,
        checkCancelled,
        onProgress: progress => {
          if (progress.step === "importar") activeRemotePhase = "import";
          if (
            progress.step === "import_poll" &&
            String(progress.data?.ImportacaoShapeStatus || "").includes(
              "CONCLUIDO"
            )
          ) {
            activeRemotePhase = null;
          }
          if (
            progress.step === "import_ok" ||
            progress.step === "import_fail" ||
            progress.step === "failed"
          )
            return;
          emit(mapPhaseProgress("import", progress, round, maxRounds), {
            stage: "importing",
          });
        },
      });
      activeRemotePhase = null;
      await checkCancelled();

      let importPdfKey: string | null = null;
      let importSummary: ErrorSummary[] = [];
      let importReportText = "";
      let importParseWarnings: string[] = [];
      if (importOutcome.pdfBuffer) {
        const artifact = createArtifact({
          uid: input.uid,
          jobId,
          round,
          key: `import-pdf-r${round}`,
          filename: "relatorio_importacao_sema.pdf",
          contentType: "application/pdf",
          buffer: importOutcome.pdfBuffer,
          source: "sema",
        });
        importPdfKey = artifact.key;
        addArtifact(artifact);
        const parsed = await deps.parseReportPdf(importOutcome.pdfBuffer);
        importSummary = parsed.resumo;
        importReportText = parsed.raw;
        importParseWarnings = parsed.warnings;
        if (parsed.warnings.length) {
          emit({
            step: "download_artifacts",
            message: `PDF de importação preservado, mas o parse gerou aviso: ${parsed.warnings.join(" ")}`,
          });
        }
      } else {
        importParseWarnings = [
          "PDF de importação não foi disponibilizado pela SEMA.",
        ];
      }
      const importRoundResult = {
        ok: importOutcome.ok,
        resultado: importOutcome.resultado,
        status: importOutcome.status,
        detalhes: importOutcome.detalhes,
        pdf: importPdfKey,
        errosResumo: importSummary,
        parseWarnings: importParseWarnings,
      };
      updateRound({ import: importRoundResult });
      updatePreviousFixPlanResult("import", {
        ok: importOutcome.ok,
        resultado: importOutcome.resultado,
        errosResumo: importSummary,
      });
      emit({
        step: importOutcome.ok ? "import_ok" : "import_fail",
        message: importOutcome.ok
          ? "Importação aprovada pela SEMA."
          : `Importação reprovada pela SEMA: ${importOutcome.resultado || importOutcome.detalhes}`,
        percent: mapPhaseProgress(
          "import",
          { step: "import_done", message: "", percent: 100 },
          round,
          maxRounds
        ).percent,
        data: {
          resultado: importOutcome.resultado,
          errosResumo: importSummary,
        },
      });
      await downloadOptionalArtifacts([
        {
          key: `enviado-zip-r${round}`,
          filename: "enviado.zip",
          pathname: `Requerimento/DownloadArquivoEnviado/${carId}`,
          label: "ZIP enviado",
        },
      ]);

      if (!importOutcome.ok) {
        const decision = await planAndApply({
          phase: "import",
          reportText: importReportText,
          errosResumo: importSummary,
          resultado: importOutcome.resultado,
        });
        if (decision.kind === "continue") {
          currentZip = decision.zip;
          currentFileName = decision.fileName;
          continue;
        }
        return finishRejected("import", importOutcome, decision);
      }

      if (input.autoProcess === false) {
        emit({
          step: "done",
          message:
            "Pipeline concluído após a importação (autoProcess desativado).",
          percent: 100,
        });
        return terminal("completed", {
          ok: true,
          importOk: true,
          processOk: null,
          resultado: importOutcome.resultado,
          round,
          autofixStopReason: null,
          autofixStopMessage: null,
          manualAutofixAvailable: false,
        });
      }

      persist({ stage: "processing" });
      await checkCancelled();
      const processOutcome = await deps.processGeo({
        carId,
        checkCancelled,
        onProgress: progress => {
          if (progress.step === "processar") activeRemotePhase = "process";
          if (
            progress.step === "process_poll" &&
            String(progress.data?.ProcessamentoStatus || "").includes(
              "CONCLUIDO"
            )
          ) {
            activeRemotePhase = null;
          }
          if (
            progress.step === "process_ok" ||
            progress.step === "process_fail" ||
            progress.step === "failed"
          )
            return;
          emit(mapPhaseProgress("process", progress, round, maxRounds), {
            stage: "processing",
          });
        },
      });
      activeRemotePhase = null;
      await checkCancelled();

      let processPdfKey: string | null = null;
      let processErrosZipKey: string | null = null;
      let processSummary: ErrorSummary[] = [];
      let processReportText = "";
      let processParseWarnings: string[] = [];
      if (processOutcome.pdfBuffer) {
        const artifact = createArtifact({
          uid: input.uid,
          jobId,
          round,
          key: `process-pdf-r${round}`,
          filename: "relatorio_processamento_sema.pdf",
          contentType: "application/pdf",
          buffer: processOutcome.pdfBuffer,
          source: "sema",
        });
        processPdfKey = artifact.key;
        addArtifact(artifact);
        const parsed = await deps.parseReportPdf(processOutcome.pdfBuffer);
        processSummary = parsed.resumo;
        processReportText = parsed.raw;
        processParseWarnings = parsed.warnings;
        if (parsed.warnings.length) {
          emit({
            step: "download_artifacts",
            message: `PDF de processamento preservado, mas o parse gerou aviso: ${parsed.warnings.join(" ")}`,
          });
        }
      } else {
        processParseWarnings = [
          "PDF de processamento não foi disponibilizado pela SEMA.",
        ];
      }
      if (processOutcome.errosZipBuffer) {
        const artifact = createArtifact({
          uid: input.uid,
          jobId,
          round,
          key: `erros-zip-r${round}`,
          filename: "erros_processamento_sema.zip",
          contentType: "application/zip",
          buffer: processOutcome.errosZipBuffer,
          source: "sema",
        });
        processErrosZipKey = artifact.key;
        addArtifact(artifact);
      }
      const processRoundResult = {
        ok: processOutcome.ok,
        resultado: processOutcome.resultado,
        status: processOutcome.status,
        detalhes: processOutcome.detalhes,
        pdf: processPdfKey,
        errosZip: processErrosZipKey,
        errosResumo: processSummary,
        parseWarnings: processParseWarnings,
      };
      updateRound({ process: processRoundResult });
      updatePreviousFixPlanResult("process", {
        ok: processOutcome.ok,
        resultado: processOutcome.resultado,
        errosResumo: processSummary,
      });
      emit({
        step: processOutcome.ok ? "process_ok" : "process_fail",
        message: processOutcome.ok
          ? "Processamento aprovado pela SEMA."
          : `Processamento concluído com pendência: ${processOutcome.resultado || processOutcome.detalhes}`,
        percent: mapPhaseProgress(
          "process",
          { step: "process_done", message: "", percent: 100 },
          round,
          maxRounds
        ).percent,
        data: {
          resultado: processOutcome.resultado,
          errosResumo: processSummary,
        },
      });
      await downloadOptionalArtifacts([
        {
          key: `processado-zip-r${round}`,
          filename: "arquivo_processado_sema.zip",
          pathname: `Requerimento/DownloadArquivoProcessado/${carId}`,
          label: "ZIP processado",
        },
        {
          key: `conferencia-zip-r${round}`,
          filename: "arquivo_conferencia_sema.zip",
          pathname: `Requerimento/DownloadArquivoConferencia/${carId}`,
          label: "ZIP de conferência",
        },
        {
          key: `pendencias-zip-r${round}`,
          filename: "arquivo_pendencias_sema.zip",
          pathname: `Requerimento/DownloadArquivoPendencias/${carId}`,
          label: "ZIP de pendências",
        },
      ]);

      if (!processOutcome.ok) {
        const decision = await planAndApply({
          phase: "process",
          reportText: processReportText,
          errosResumo: processSummary,
          resultado: processOutcome.resultado,
        });
        if (decision.kind === "continue") {
          currentZip = decision.zip;
          currentFileName = decision.fileName;
          continue;
        }
        return finishRejected("process", processOutcome, decision);
      }

      emit({
        step: "done",
        message: "Pipeline SIMCAR concluído com sucesso.",
        percent: 100,
      });
      return terminal("completed", {
        ok: true,
        importOk: true,
        processOk: true,
        resultado: processOutcome.resultado,
        round,
        autofixStopReason: null,
        autofixStopMessage: null,
        manualAutofixAvailable: false,
      });
    }
  } catch (error: any) {
    activeRemotePhase = null;
    if (isOraculoPipelineCancelledError(error)) {
      emit({
        step: "cancelled",
        message: error.message,
        percent: state.percent ?? 0,
      });
      return terminal("cancelled", { ok: false, error: null });
    }
    const message = error?.message || "Falha inesperada no pipeline SIMCAR.";
    emit({ step: "failed", message, percent: state.percent ?? 0 });
    return terminal("failed", { ok: false, error: message });
  }
}

/** Cria o job, salva o ZIP original e agenda a rodada inteira na fila serial global. */
export function startOraculoPipeline(args: StartOraculoPipelineArgs): StartedOraculoPipeline {
  const uid = String(args.uid || "").trim();
  const uploadId = String(args.uploadId || "").trim();
  const fileName = String(args.fileName || "projeto.zip").trim() || "projeto.zip";
  if (!uid || !uploadId || !Buffer.isBuffer(args.zip) || args.zip.length === 0) {
    throw new Error("UID, uploadId e ZIP válido são obrigatórios para o pipeline.");
  }
  const cfg = getSimcarOraculoConfig();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  const deps = dependencies(args.dependencies);
  const shape = args.shape || extractShapeContext(args.zip);
  const jobId = String(args.jobId || crypto.randomUUID()).trim();
  if (!jobId) throw new Error("jobId inválido.");
  const round = 1;
  const queuePosition = getSimcarQueueLength() + 1;
  const maxRounds = normalizeMaxRounds(args.maxRounds);
  const originalArtifact = createArtifact({
    uid,
    jobId,
    round,
    key: `enviado-zip-r${round}`,
    filename: "enviado.zip",
    contentType: "application/zip",
    buffer: args.zip,
    source: "upload",
  });
  const artifacts = { [originalArtifact.key]: originalArtifact };
  const rounds: OraculoRoundResult[] = [
    {
      n: round,
      zipArtifact: originalArtifact.key,
      import: null,
      process: null,
      artifactWarnings: [],
    },
  ];
  const queued = eventAt(deps, round, {
    step: "queued",
    message:
      queuePosition > 1
        ? `Na fila do SIMCAR (${queuePosition - 1} job(s) à frente)…`
        : "Na fila do SIMCAR; este job é o próximo.",
    percent: 0,
    data: { queuePosition },
  });
  const initial = persistOraculoJob(uid, jobId, {
    type: "pipeline",
    status: "queued",
    stage: "queued",
    ok: null,
    uploadId,
    sourceFilename: fileName,
    testCarId: carId,
    autoProcess: args.autoProcess !== false,
    autofix: args.autofix === true,
    maxRounds,
    shape,
    round,
    queuePosition,
    cancelRequested: false,
    prepare: null,
    rounds,
    artifacts,
    timeline: [queued],
    createdAt: deps.now().toISOString(),
  });
  args.onNotification?.({ type: "event", jobId, event: queued, job: initial });

  const completion = deps.enqueue(() =>
    executePipeline({
      input: {
        ...args,
        uid,
        uploadId,
        fileName,
        autoProcess: args.autoProcess !== false,
        maxRounds,
      },
      deps,
      jobId,
      carId,
      shape,
      initialRounds: rounds,
    }),
  );
  return { jobId, queuePosition, completion };
}

export function requestOraculoPipelineCancellation(
  uid: string,
  jobId: string,
  now = new Date(),
): {
  status: "requested" | "already_requested" | "already_finished" | "not_found";
  event?: OraculoEvent;
  job?: Record<string, any>;
} {
  const current = readOraculoJob(uid, jobId);
  if (!current) return { status: "not_found" };
  const status = String(current.status || "");
  if (TERMINAL_STATUSES.has(status)) return { status: "already_finished", job: current };
  if (current.cancelRequested || status === "cancel_requested") {
    return { status: "already_requested", job: current };
  }
  const event: OraculoEvent = {
    ts: now.toISOString(),
    round: Math.max(1, Number(current.round || 1)),
    step: "cancel_requested",
    message: "Cancelamento solicitado; o pipeline parará no próximo ponto seguro.",
    percent: Number(current.percent || 0),
  };
  const job = appendOraculoTimelineEvent(uid, jobId, event, {
    status: "cancel_requested",
    stage: "cancel_requested",
    cancelRequested: true,
    cancelRequestedAt: event.ts,
    lastStep: event.step,
    message: event.message,
  });
  return { status: "requested", event, job };
}

export function resolveOraculoArtifact(
  uid: string,
  jobId: string,
  key: string,
): { job: Record<string, any>; artifact: OraculoArtifact; absolutePath: string } | null {
  const job = readOraculoJob(uid, jobId);
  const artifact = job?.artifacts?.[key] as OraculoArtifact | undefined;
  if (!job || !artifact?.relativePath || artifact.key !== key) return null;
  const expectedPrefix = `users/${uid}/simcar-oraculo/${jobId}/`;
  if (!artifact.relativePath.startsWith(expectedPrefix)) return null;
  const absolutePath = getAbsoluteStoragePath(artifact.relativePath);
  const jobRoot = getAbsoluteStoragePath(expectedPrefix);
  const withinJob = path.relative(jobRoot, absolutePath);
  if (!withinJob || withinJob.startsWith("..") || path.isAbsolute(withinJob)) return null;
  return { job, artifact, absolutePath };
}
