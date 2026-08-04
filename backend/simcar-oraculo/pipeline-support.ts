/**
 * Suporte do pipeline do Oráculo SIMCAR: tipos públicos, dependências injetáveis, artefatos e helpers puros.
 */
import { saveSimcarOraculoArtifact } from "../local-storage";
import { assertTestCarId } from "./config";
import { applyFixActions } from "./autofix/apply";
import { buildFixPlan } from "./autofix/plan";
import type { ApplyFixPlanResult, FixAction, FixDiffSummary, FixPlan } from "./autofix/types";
import { simcarDownload, simcarPost, withSimcarAuthRetry } from "./client";
import { importZipOnTestProjectUnlocked } from "./import-shape";
import { prepareTestProject } from "./prepare-project";
import { processGeoOnTestProjectUnlocked } from "./process-geo";
import { enqueueSimcar } from "./queue";
import { parseSemaReportPdf } from "./sema-report-parse";
import type { AutofixStopReason, OraculoArtifact, OraculoEvent, OraculoProgress, ShapeContext, SimcarImportOutcome, SimcarProcessOutcome } from "./types";

export type Enqueue = <T>(fn: () => Promise<T>) => Promise<T>;
export type ImportOperation = (args: {
  carId?: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (event: OraculoProgress) => void;
  checkCancelled?: () => void | Promise<void>;
}) => Promise<SimcarImportOutcome>;
export type ProcessOperation = (args: {
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

export const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function defaultCancelRemote(phase: "import" | "process", carId: string): Promise<void> {
  assertTestCarId(carId);
  const pathname =
    phase === "import"
      ? `Requerimento/CancelarImportacaoShape/${carId}`
      : `Requerimento/CancelarProcessamentoGeo/${carId}`;
  return withSimcarAuthRetry(async (token) => {
    await simcarPost(token, pathname);
  });
}

export function dependencies(
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

export function eventAt(
  deps: OraculoPipelineDependencies,
  round: number,
  progress: OraculoProgress,
): OraculoEvent {
  return { ...progress, ts: deps.now().toISOString(), round };
}

export function artifactUrl(jobId: string, key: string): string {
  return `/api/simcar-oraculo/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(key)}`;
}

export function createArtifact(args: {
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

export function normalizeMaxRounds(value: number | undefined): number {
  const raw = value ?? Number(process.env.AUTOFIX_MAX_ROUNDS || 3);
  const rounded = Math.trunc(Number(raw));
  return Number.isFinite(rounded) ? Math.min(3, Math.max(1, rounded)) : 3;
}

export function mapPhaseProgress(
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

export type ErrorSummary = { camada: string; erro: string; qtd: number };
export type AutofixPhase = "import" | "process";

export type FixPlanArtifactPayload = {
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

export type AutofixDecision =
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

export function totalErrors(errors: ErrorSummary[]): number {
  return errors.reduce(
    (total, error) => total + Math.max(0, Number(error.qtd) || 0),
    0
  );
}

export function actionSignature(actions: FixAction[]): string {
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
