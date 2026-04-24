import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT, writeDocBySegments } from "./local-storage";

export type ProcessingJobStatus =
  | "running"
  | "cancel_requested"
  | "cancelled"
  | "completed"
  | "failed";

export type ProcessingJob = {
  jobId: string;
  uid: string;
  endpoint: string;
  status: ProcessingJobStatus;
  cancelRequested: boolean;
  clientDisconnected: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  billingSummary?: Record<string, unknown>;
};

export class JobCancelledError extends Error {
  constructor(message = "Cancelamento solicitado pelo usuário.") {
    super(message);
    this.name = "JobCancelledError";
  }
}

type StartJobInput = {
  uid: string;
  endpoint: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
};

type FinishJobInput = {
  jobId: string;
  status: Extract<ProcessingJobStatus, "completed" | "cancelled" | "failed">;
  error?: string;
  billingSummary?: Record<string, unknown>;
};

const JOB_TTL_MS =
  Number.parseInt(process.env.PROCESSING_JOBS_TTL_MS || "", 10) ||
  24 * 60 * 60 * 1000;
const JOB_MAX_ENTRIES =
  Number.parseInt(process.env.PROCESSING_JOBS_MAX || "", 10) || 3000;

const jobs = new Map<string, ProcessingJob>();

function safeTrim(value: unknown): string {
  return String(value || "").trim();
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === undefined) continue;
      const cleaned = stripUndefinedDeep(raw);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

async function persistJobSnapshot(job: ProcessingJob): Promise<void> {
  if (!job.uid) return;
  try {
    writeDocBySegments(
      ["users", job.uid, "processing_jobs", job.jobId],
      {
        jobId: job.jobId,
        uid: job.uid,
        endpoint: job.endpoint,
        status: job.status,
        cancelRequested: job.cancelRequested,
        clientDisconnected: job.clientDisconnected,
        error: job.error || null,
        metadata: (stripUndefinedDeep(job.metadata) as Record<string, unknown>) || null,
        billingSummary: (stripUndefinedDeep(job.billingSummary) as Record<string, unknown>) || null,
        createdAtMs: job.createdAtMs,
        updatedAtMs: job.updatedAtMs,
        finishedAtMs: job.finishedAtMs || null,
      },
      { merge: true },
    );
  } catch (error) {
    console.warn("[PROCESSING JOBS] failed to persist job snapshot:", error);
  }
}

function pruneJobsInMemory(): void {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (job.finishedAtMs && now - job.finishedAtMs > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
  while (jobs.size > JOB_MAX_ENTRIES) {
    const oldest = jobs.keys().next().value as string | undefined;
    if (!oldest) break;
    jobs.delete(oldest);
  }
}

setInterval(pruneJobsInMemory, 5 * 60 * 1000).unref();

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
  } catch {
    return null;
  }
}

export function markPersistedRunningJobsInterrupted(): number {
  const usersDir = path.join(STORAGE_ROOT, "users");
  if (!fs.existsSync(usersDir)) return 0;

  let count = 0;
  const now = Date.now();
  for (const uid of fs.readdirSync(usersDir)) {
    const processingDir = path.join(usersDir, uid, "processing_jobs");
    if (!fs.existsSync(processingDir)) continue;
    for (const entry of fs.readdirSync(processingDir)) {
      if (!entry.endsWith(".json")) continue;
      const jobId = entry.replace(/\.json$/i, "");
      const data = readJsonSafe(path.join(processingDir, entry));
      const status = safeTrim(data?.status).toLowerCase();
      if (status !== "running" && status !== "cancel_requested") continue;

      const endpoint = safeTrim(data?.endpoint);
      const error = "Processamento interrompido pelo reinicio do servidor.";
      writeDocBySegments(
        ["users", uid, "processing_jobs", jobId],
        {
          status: "failed",
          cancelRequested: false,
          error,
          updatedAtMs: now,
          finishedAtMs: now,
        },
        { merge: true },
      );

      const clipJobId = safeTrim(data?.metadata?.clipJobId);
      if (clipJobId && endpoint.startsWith("/api/simcar/clip")) {
        const clipData = readJsonSafe(path.join(usersDir, uid, "simcar_clips", `${clipJobId}.json`));
        const sourceMode = safeTrim(clipData?.sourceMode);
        const isAutoClipAuas = endpoint === "/api/simcar/clip/analyze-auas" && sourceMode === "auto-clip";
        writeDocBySegments(
          ["users", uid, "simcar_clips", clipJobId],
          {
            status: isAutoClipAuas ? "completed" : "failed",
            processingStage: isAutoClipAuas ? undefined : "error",
            error,
          },
          { merge: true },
        );
      }

      if (endpoint === "/api/auas/analyze") {
        writeDocBySegments(
          ["users", uid, "auas_jobs", jobId],
          {
            status: "failed",
            error,
          },
          { merge: true },
        );
      }

      count++;
    }
  }
  return count;
}

export function startJob(input: StartJobInput): ProcessingJob {
  const now = Date.now();
  const jobId = safeTrim(input.jobId) || crypto.randomUUID();
  const next: ProcessingJob = {
    jobId,
    uid: safeTrim(input.uid),
    endpoint: safeTrim(input.endpoint),
    status: "running",
    cancelRequested: false,
    clientDisconnected: false,
    createdAtMs: now,
    updatedAtMs: now,
    metadata: stripUndefinedDeep(input.metadata) as Record<string, unknown> | undefined,
  };
  jobs.set(jobId, next);
  void persistJobSnapshot(next);
  return next;
}

export function isCancelRequested(jobId: string): boolean {
  const key = safeTrim(jobId);
  if (!key) return false;
  return Boolean(jobs.get(key)?.cancelRequested);
}

export function markDisconnected(jobId: string): void {
  const key = safeTrim(jobId);
  if (!key) return;
  const job = jobs.get(key);
  if (!job) return;
  if (job.clientDisconnected) return;
  job.clientDisconnected = true;
  job.updatedAtMs = Date.now();
  jobs.set(key, job);
  void persistJobSnapshot(job);
}

export function requestCancel(jobId: string, uid: string): {
  ok: boolean;
  status: "cancel_requested" | "already_finished" | "not_found" | "forbidden";
} {
  const key = safeTrim(jobId);
  const ownerUid = safeTrim(uid);
  const job = key ? jobs.get(key) : undefined;
  if (!job) return { ok: false, status: "not_found" };
  if (!ownerUid || ownerUid !== safeTrim(job.uid)) {
    return { ok: false, status: "forbidden" };
  }
  if (job.status !== "running" && job.status !== "cancel_requested") {
    return { ok: true, status: "already_finished" };
  }
  job.cancelRequested = true;
  job.status = "cancel_requested";
  job.updatedAtMs = Date.now();
  jobs.set(key, job);
  void persistJobSnapshot(job);
  return { ok: true, status: "cancel_requested" };
}

export function finishJob(input: FinishJobInput): void {
  const key = safeTrim(input.jobId);
  const job = key ? jobs.get(key) : undefined;
  if (!job) return;
  job.status = input.status;
  job.error = safeTrim(input.error) || undefined;
  job.billingSummary = input.billingSummary;
  job.updatedAtMs = Date.now();
  job.finishedAtMs = Date.now();
  jobs.set(key, job);
  void persistJobSnapshot(job);
}
