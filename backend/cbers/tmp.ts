/**
 * Limpeza periódica do diretório temporário do CBERS.
 */
import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "../local-storage";
import { CBERS_TMP_CLEANUP_MAX_AGE_MS, CBERS_TMP_ROOT } from "./constants";
import { safeName } from "./utils";

export let cbersTmpCleanupStarted = false;

export function newestMtimeMs(dir: string, depth = 0): number {
  let newest = 0;
  try {
    const stat = fs.statSync(dir);
    newest = stat.mtimeMs;
  } catch {
    return newest;
  }
  if (depth >= 3) return newest;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(child);
      newest = Math.max(newest, stat.mtimeMs);
      if (entry.isDirectory()) newest = Math.max(newest, newestMtimeMs(child, depth + 1));
    } catch {
      // Ignore entries that disappeared while cleaning.
    }
  }
  return newest;
}

export function isPersistedCbersJobActive(jobId: string): boolean {
  const usersDir = path.join(STORAGE_ROOT, "users");
  if (!fs.existsSync(usersDir)) return false;
  try {
    for (const uid of fs.readdirSync(usersDir)) {
      const filePath = path.join(usersDir, uid, "processing_jobs", `${safeName(jobId)}.json`);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (String(data.endpoint || "") !== "/api/cbers-wpm/jobs") continue;
      const status = String(data.status || "").toLowerCase();
      if (status === "running" || status === "cancel_requested") return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function cleanupCbersTmpRoot(reason: string): number {
  if (!fs.existsSync(CBERS_TMP_ROOT)) return 0;
  const now = Date.now();
  let removed = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(CBERS_TMP_ROOT, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name;
    if (isPersistedCbersJobActive(jobId)) continue;
    const dir = path.join(CBERS_TMP_ROOT, jobId);
    const newest = newestMtimeMs(dir);
    if (newest && now - newest < CBERS_TMP_CLEANUP_MAX_AGE_MS) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "cbers_tmp_cleanup_failed",
        jobId,
        reason,
        message: String((error as Error)?.message || error),
      }));
    }
  }
  if (removed > 0) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "cbers_tmp_cleanup",
      reason,
      removed,
    }));
  }
  return removed;
}

export function startCbersTmpCleanup(): void {
  if (cbersTmpCleanupStarted) return;
  cbersTmpCleanupStarted = true;
  cleanupCbersTmpRoot("startup");
  setInterval(() => cleanupCbersTmpRoot("interval"), 30 * 60 * 1000).unref();
}
