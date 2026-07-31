import crypto from "crypto";
import fs from "fs";
import path from "path";

import { STORAGE_ROOT } from "../local-storage";
import type { CheckpointStore } from "./orchestrator";
import type { AuasWindowRun } from "./types";

const CHECKPOINT_DIR = path.join(STORAGE_ROOT, "auas_v2_checkpoints");

function ensureDir(): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function fileNameFor(jobId: string): string {
  const safe = crypto.createHash("sha256").update(jobId).digest("hex");
  return path.join(CHECKPOINT_DIR, `${safe}.json`);
}

function readAll(jobId: string): Record<string, AuasWindowRun> {
  try {
    const raw = fs.readFileSync(fileNameFor(jobId), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(jobId: string, data: Record<string, AuasWindowRun>): void {
  ensureDir();
  const filePath = fileNameFor(jobId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Checkpoint durável em disco (um arquivo JSON por job), para retomar jobs
 * AUAS V2 após reinício/queda sem repetir janelas concluídas.
 */
export function createFileCheckpointStore(jobId: string): CheckpointStore {
  return {
    get: (key) => readAll(jobId)[key],
    set: (key, value) => {
      const all = readAll(jobId);
      all[key] = value;
      writeAll(jobId, all);
    },
  };
}
