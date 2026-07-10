import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type PlainObject = Record<string, any>;

const DEFAULT_STORAGE_ROOT =
  "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest";

const PUBLIC_API_BASE_URL = String(
  process.env.PUBLIC_API_BASE_URL ||
  process.env.VITE_API_BASE ||
  "https://geoforest-api.cursar.space",
).trim().replace(/\/+$/, "");

export const STORAGE_ROOT = path.resolve(
  process.env.LOCAL_DATA_ROOT || DEFAULT_STORAGE_ROOT,
);

const USERS_DIR = path.join(STORAGE_ROOT, "users");

const USER_DIRS = [
  "settings",
  "conversations",
  "simcar_clips",
  "vertices_jobs",
  "processing_jobs",
  "attachments/images",
  "attachments/pdfs",
  "simcar/input",
  "simcar/output",
  "simcar/context",
  "simcar/analysis",
  "vertices/input",
  "vertices/output",
  "containment/input",
  "containment/output",
  "cbers/output",
  "trash",
] as const;

function isPlainObject(value: unknown): value is PlainObject {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (isPlainObject(value)) {
    const out: PlainObject = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = stripUndefinedDeep(item);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out as T;
  }
  return (value === undefined ? undefined : value) as T;
}

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function removeStaleTempCopies(dir: string, prefix: string): void {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp")) continue;
    const tempPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(tempPath);
      if (stat.mtimeMs < cutoff) fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function copyFileAtomic(sourcePath: string, absolutePath: string): number {
  const dir = path.dirname(absolutePath);
  ensureDir(dir);
  const sourceStat = fs.statSync(sourcePath);
  const tempPrefix = `.${path.basename(absolutePath)}.`;
  removeStaleTempCopies(dir, tempPrefix);
  const tempPath = path.join(dir, `${tempPrefix}${crypto.randomUUID()}.tmp`);
  try {
    fs.copyFileSync(sourcePath, tempPath);
    const tempStat = fs.statSync(tempPath);
    if (tempStat.size !== sourceStat.size) {
      throw new Error(`COPY_SIZE_MISMATCH:${tempStat.size}:${sourceStat.size}`);
    }
    fs.renameSync(tempPath, absolutePath);
    return tempStat.size;
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Keep the original copy error.
    }
    throw error;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function normalizeTimestampFields(payload: PlainObject, previous?: PlainObject): PlainObject {
  const nowIso = new Date().toISOString();
  const out = stripUndefinedDeep({ ...(previous || {}), ...payload }) as PlainObject;
  if (!out.createdAt) out.createdAt = previous?.createdAt || nowIso;
  out.updatedAt = nowIso;
  out.updatedAtMs = Date.now();
  return out;
}

export function ensureStorageRoot(): void {
  ensureDir(USERS_DIR);
}

export function getUserDir(uid: string): string {
  return path.join(USERS_DIR, safeSegment(uid));
}

export function ensureUserScaffold(uid: string): string {
  ensureStorageRoot();
  const userDir = getUserDir(uid);
  ensureDir(userDir);
  for (const rel of USER_DIRS) ensureDir(path.join(userDir, rel));
  return userDir;
}

export function upsertUserProfile(input: {
  uid: string;
  email?: string;
  fullName?: string;
  specialization?: string;
  creaNumber?: string;
}): PlainObject {
  const userDir = ensureUserScaffold(input.uid);
  const profilePath = path.join(userDir, "profile.json");
  const previous = readJsonSafe<PlainObject>(profilePath, {});
  const next = normalizeTimestampFields(
    {
      uid: safeSegment(input.uid),
      email: String(input.email || previous.email || "").trim(),
      fullName: String(input.fullName || previous.fullName || "").trim(),
      specialization:
        String(input.specialization || previous.specialization || "").trim() || undefined,
      creaNumber: String(input.creaNumber || previous.creaNumber || "").trim() || undefined,
    },
    previous,
  );
  writeJsonAtomic(profilePath, next);
  return next;
}

export function getUserProfile(uid: string): PlainObject | null {
  const profilePath = path.join(getUserDir(uid), "profile.json");
  if (!fs.existsSync(profilePath)) return null;
  return readJsonSafe<PlainObject | null>(profilePath, null);
}

function resolveDocPathFromSegments(segments: string[]): string | null {
  const parts = segments.filter(Boolean).map((part) => safeSegment(part));
  if (parts[0] !== "users" || !parts[1]) return null;
  const uid = parts[1];
  if (parts.length === 2) return path.join(getUserDir(uid), "profile.json");
  if (parts[2] === "settings" && parts[3] === "preferences") {
    return path.join(getUserDir(uid), "settings", "preferences.json");
  }
  const docId = parts[3];
  if (!docId) return null;
  const allowed = new Set(["conversations", "simcar_clips", "cbers_wpm_jobs", "landsat_jobs", "vertices_jobs", "processing_jobs"]);
  if (!allowed.has(parts[2])) return null;
  return path.join(getUserDir(uid), parts[2], `${docId}.json`);
}

function resolveCollectionDirFromSegments(segments: string[]): string | null {
  const parts = segments.filter(Boolean).map((part) => safeSegment(part));
  if (parts[0] !== "users" || !parts[1] || !parts[2]) return null;
  const allowed = new Set(["conversations", "simcar_clips", "cbers_wpm_jobs", "landsat_jobs", "vertices_jobs", "processing_jobs"]);
  if (!allowed.has(parts[2])) return null;
  return path.join(getUserDir(parts[1]), parts[2]);
}

export function readDocBySegments(segments: string[]): PlainObject | null {
  const filePath = resolveDocPathFromSegments(segments);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return readJsonSafe<PlainObject | null>(filePath, null);
}

export function writeDocBySegments(
  segments: string[],
  payload: PlainObject,
  options?: { merge?: boolean },
): PlainObject {
  const filePath = resolveDocPathFromSegments(segments);
  if (!filePath) {
    throw new Error("INVALID_DOC_PATH");
  }
  const previous = options?.merge ? readJsonSafe<PlainObject>(filePath, {}) : {};
  const next = normalizeTimestampFields(payload, previous);
  writeJsonAtomic(filePath, next);
  return next;
}

export function deleteDocBySegments(segments: string[]): void {
  const filePath = resolveDocPathFromSegments(segments);
  if (!filePath || !fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}

export function listCollectionBySegments(
  segments: string[],
  options?: { orderBy?: string; direction?: "asc" | "desc" },
): Array<{ id: string; data: PlainObject }> {
  const dirPath = resolveCollectionDirFromSegments(segments);
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const docs: Array<{ id: string; data: PlainObject }> = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(dirPath, entry);
      const data = readJsonSafe<PlainObject>(filePath, {});
      const id = entry.replace(/\.json$/i, "");
      return { id, data: { ...data, id } };
    });
  const field = String(options?.orderBy || "updatedAtMs").trim() || "updatedAtMs";
  const dir = options?.direction === "asc" ? 1 : -1;
  docs.sort((a, b) => {
    const av = (a.data as PlainObject)?.[field];
    const bv = (b.data as PlainObject)?.[field];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av || "").localeCompare(String(bv || "")) * dir;
  });
  return docs;
}

export function saveUserBuffer(args: {
  uid: string;
  area:
    | "attachments/images"
    | "attachments/pdfs"
    | "simcar/input"
    | "simcar/output"
    | "simcar/context"
    | "simcar/analysis"
    | "vertices/input"
    | "vertices/output"
    | "containment/input"
    | "containment/output"
    | "auas/input"
    | "auas/output"
    | "auas/context"
    | "cbers/output";
  filename: string;
  buffer: Buffer;
}): { relativePath: string; absolutePath: string; publicUrl: string } {
  const userDir = ensureUserScaffold(args.uid);
  const cleanName = safeSegment(args.filename) || crypto.randomUUID();
  const relativePath = path.posix.join("users", safeSegment(args.uid), args.area, cleanName);
  const absolutePath = path.join(userDir, args.area, cleanName);
  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, args.buffer);
  return {
    relativePath,
    absolutePath,
    publicUrl: `${PUBLIC_API_BASE_URL}/api/storage/${relativePath.split(path.sep).join("/")}`,
  };
}

export function saveUserFileFromPath(args: {
  uid: string;
  area: "cbers/output";
  filename: string;
  sourcePath: string;
}): { relativePath: string; absolutePath: string; publicUrl: string; bytes: number } {
  const userDir = ensureUserScaffold(args.uid);
  const cleanName = safeSegment(args.filename) || crypto.randomUUID();
  const relativePath = path.posix.join("users", safeSegment(args.uid), args.area, cleanName);
  const absolutePath = path.join(userDir, args.area, cleanName);
  const bytes = copyFileAtomic(args.sourcePath, absolutePath);
  return {
    relativePath,
    absolutePath,
    publicUrl: `${PUBLIC_API_BASE_URL}/api/storage/${relativePath.split(path.sep).join("/")}`,
    bytes,
  };
}

export function getAbsoluteStoragePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.resolve(STORAGE_ROOT, normalized);
  if (!absolute.startsWith(STORAGE_ROOT)) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  return absolute;
}

export function removeStoragePath(relativePath: string | undefined | null): void {
  const clean = storageUrlToRelativePath(relativePath) || String(relativePath || "").trim().replace(/^\/api\/storage\//, "");
  if (!clean) return;
  const absolute = getAbsoluteStoragePath(clean);
  if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
}

export function storageUrlToRelativePath(urlOrPath: string | undefined | null): string | null {
  let raw = String(urlOrPath || "").trim();
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname;
  } catch {
    return null;
  }
  if (raw.startsWith("/api/storage/")) return raw.slice("/api/storage/".length);
  if (raw.startsWith("users/")) return raw;
  return null;
}
