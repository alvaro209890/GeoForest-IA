import type { Express, Request, Response as ExpressResponse } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "./local-storage";

type PlainObject = Record<string, any>;

export type CbersArchiveRecord = {
  imageId: string;
  uid: string;
  jobId: string;
  itemId: string;
  orbit: string;
  year: string;
  sourceFilename: string;
  archiveFilename: string;
  hdRelativePath: string;
  hdPath: string;
  bytes: number;
  wmsLayerName: string;
  wmsStoreName: string;
  wmsPublicUrl: string;
  createdAt: string;
  updatedAt: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
  adminDeleteError?: string;
};

const CBERS_ARCHIVE_ROOT = path.resolve(
  process.env.CBERS_ARCHIVE_ROOT || "/media/server/HD Backup/RASTER/CBERS_4A",
);
const CBERS_ARCHIVE_INDEX_DIR = path.join(STORAGE_ROOT, "cbers_archive", "images");
const GEOSERVER_BASE_URL = String(
  process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
).replace(/\/+$/, "");
const GEOSERVER_USER = process.env.GEOSERVER_USER || "admin";
const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || "geoserver";
const GEOSERVER_WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";
const GEOSERVER_STYLE = process.env.GEOSERVER_RASTER_STYLE || "raster";
const GEOSERVER_PUBLIC_WMS_BASE = String(
  process.env.GEOSERVER_PUBLIC_WMS_BASE ||
    "https://wms.cursar.space/geoserver/cbers/wms",
).trim();
const GEOSERVER_EXTERNAL_CBRS_ROOT = path.resolve(
  process.env.GEOSERVER_EXTERNAL_CBRS_ROOT ||
    "/home/server/.local/geoserver-work/data_dir/external/cbers",
);
const ROOT_CBRS_GROUP = "CBERS-4A-Apos_2019";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function safeSegment(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanLayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseCbersItemId(itemId: string): { orbit: string; year: string } {
  const match = String(itemId || "").match(/(20\d{2})\d{4}[_-](\d{3})[_-](\d{3})/);
  if (!match) throw new Error(`Item CBERS sem data/orbita valida: ${itemId}`);
  return { year: match[1], orbit: `${match[2]}_${match[3]}` };
}

function withJobSuffix(filename: string, jobId: string): string {
  const ext = path.extname(filename) || ".TIF";
  const stem = filename.slice(0, filename.length - ext.length);
  return `${stem}_J${safeSegment(jobId).slice(0, 8).toUpperCase()}${ext.toUpperCase()}`;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
}

async function geoserverFetch(
  restPath: string,
  options: RequestInit = {},
): Promise<globalThis.Response> {
  return fetch(`${GEOSERVER_BASE_URL}${restPath}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.headers || {}),
    },
  }) as Promise<globalThis.Response>;
}

async function geoserverJson(restPath: string): Promise<PlainObject | null> {
  const response = await geoserverFetch(restPath, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GeoServer GET ${restPath} falhou: ${response.status}`);
  return (await response.json()) as PlainObject;
}

async function geoserverWrite(
  restPath: string,
  method: "POST" | "PUT" | "DELETE",
  body?: string,
  contentType?: string,
): Promise<void> {
  const response = await geoserverFetch(restPath, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if ([200, 201, 202, 204, 409, 404].includes(response.status)) return;
  const text = await response.text().catch(() => "");
  throw new Error(`GeoServer ${method} ${restPath} falhou: ${response.status} ${text.slice(0, 300)}`);
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function groupPublished(payload: PlainObject | null): PlainObject[] {
  return asArray(payload?.layerGroup?.publishables?.published);
}

function groupStyles(payload: PlainObject | null): any[] {
  return asArray(payload?.layerGroup?.styles?.style);
}

async function upsertLayerGroup(args: {
  name: string;
  title: string;
  publishable: PlainObject;
  style: PlainObject | string;
}): Promise<void> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}.json`,
  );
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const alreadyAt = currentPublished.findIndex((item) => String(item?.name || "") === args.publishable.name);
  const published =
    alreadyAt >= 0
      ? currentPublished
      : [...currentPublished, args.publishable];
  const styles =
    alreadyAt >= 0
      ? currentStyles
      : [...currentStyles, args.style];

  const payload = {
    layerGroup: {
      name: args.name,
      mode: "NAMED",
      title: args.title,
      enabled: true,
      advertised: true,
      workspace: { name: GEOSERVER_WORKSPACE },
      publishables: { published },
      styles: { style: styles },
    },
  };
  const body = JSON.stringify(payload);
  if (existing) {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}`,
      "PUT",
      body,
      "application/json",
    );
  } else {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups`,
      "POST",
      body,
      "application/json",
    );
  }
}

async function deleteLayerGroup(name: string): Promise<void> {
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(name)}`,
    "DELETE",
  );
}

async function removePublishableFromGroup(groupName: string, publishableName: string): Promise<boolean> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}.json`,
  );
  if (!existing?.layerGroup) return false;
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const published: PlainObject[] = [];
  const styles: any[] = [];
  currentPublished.forEach((item, index) => {
    if (String(item?.name || "") === publishableName) return;
    published.push(item);
    styles.push(currentStyles[index] ?? "");
  });
  if (published.length === currentPublished.length) return published.length === 0;
  if (published.length === 0 && groupName !== "RASTER" && groupName !== ROOT_CBRS_GROUP) {
    await deleteLayerGroup(groupName);
    return true;
  }
  const previous = existing.layerGroup;
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}`,
    "PUT",
    JSON.stringify({
      layerGroup: {
        name: groupName,
        mode: previous.mode || "NAMED",
        title: previous.title || groupName,
        enabled: previous.enabled !== false,
        advertised: previous.advertised !== false,
        workspace: { name: GEOSERVER_WORKSPACE },
        publishables: { published },
        styles: { style: styles },
      },
    }),
    "application/json",
  );
  return false;
}

async function removeFromCbersGroups(record: CbersArchiveRecord): Promise<void> {
  const yearGroup = `orbit_${record.orbit}_y${record.year}`;
  const orbitGroup = `orbit_${record.orbit}`;
  const yearDeleted = await removePublishableFromGroup(yearGroup, `${GEOSERVER_WORKSPACE}:${record.wmsStoreName}`);
  if (yearDeleted) {
    const orbitDeleted = await removePublishableFromGroup(orbitGroup, `${GEOSERVER_WORKSPACE}:${yearGroup}`);
    if (orbitDeleted) {
      await removePublishableFromGroup(ROOT_CBRS_GROUP, `${GEOSERVER_WORKSPACE}:${orbitGroup}`);
    }
  }
}

async function createCoverageStore(storeName: string): Promise<void> {
  const body =
    `<coverageStore>` +
    `<name>${xmlEscape(storeName)}</name>` +
    `<type>GeoTIFF</type>` +
    `<enabled>true</enabled>` +
    `<workspace><name>${xmlEscape(GEOSERVER_WORKSPACE)}</name></workspace>` +
    `</coverageStore>`;
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores`,
    "POST",
    body,
    "application/xml",
  );
}

function linkForGeoserver(hdPath: string, orbit: string, year: string, storeName: string): string {
  const mirrorDir = path.join(GEOSERVER_EXTERNAL_CBRS_ROOT, orbit, year, storeName);
  ensureDir(mirrorDir);
  const target = path.join(mirrorDir, path.basename(hdPath));
  try {
    if (fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
  } catch {
    // Missing symlink is fine.
  }
  fs.symlinkSync(hdPath, target);
  return target;
}

async function publishGeoTiff(args: {
  storeName: string;
  hdPath: string;
  orbit: string;
  year: string;
  title: string;
}): Promise<void> {
  await createCoverageStore(args.storeName);
  const linkedFile = linkForGeoserver(args.hdPath, args.orbit, args.year, args.storeName);
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/external.geotiff` +
      `?configure=first&coverageName=${encodeURIComponent(args.storeName)}&recalculate=nativebbox,latlonbbox`,
    "PUT",
    linkedFile,
    "text/plain",
  );

  await geoserverWrite(
    `/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({
      layer: {
        enabled: true,
        advertised: true,
        defaultStyle: {
          name: GEOSERVER_STYLE,
          href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_STYLE}.json`,
        },
      },
    }),
    "application/json",
  );
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/coverages/${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({ coverage: { title: args.title, enabled: true } }),
    "application/json",
  );

  const yearGroup = `orbit_${args.orbit}_y${args.year}`;
  const orbitGroup = `orbit_${args.orbit}`;
  await upsertLayerGroup({
    name: yearGroup,
    title: args.year,
    publishable: {
      "@type": "layer",
      name: `${GEOSERVER_WORKSPACE}:${args.storeName}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layers/${args.storeName}.json`,
    },
    style: { name: GEOSERVER_STYLE, href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_STYLE}.json` },
  });
  await upsertLayerGroup({
    name: orbitGroup,
    title: args.orbit,
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${yearGroup}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${yearGroup}.json`,
    },
    style: "",
  });
  await upsertLayerGroup({
    name: ROOT_CBRS_GROUP,
    title: ROOT_CBRS_GROUP,
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${orbitGroup}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${orbitGroup}.json`,
    },
    style: "",
  });
  await upsertLayerGroup({
    name: "RASTER",
    title: "RASTER",
    publishable: {
      "@type": "layerGroup",
      name: `${GEOSERVER_WORKSPACE}:${ROOT_CBRS_GROUP}`,
      href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${ROOT_CBRS_GROUP}.json`,
    },
    style: "",
  });
}

function recordPath(imageId: string): string {
  return path.join(CBERS_ARCHIVE_INDEX_DIR, `${safeSegment(imageId)}.json`);
}

function saveRecord(record: CbersArchiveRecord): void {
  writeJsonAtomic(recordPath(record.imageId), record);
}

export function listCbersArchiveRecords(): CbersArchiveRecord[] {
  if (!fs.existsSync(CBERS_ARCHIVE_INDEX_DIR)) return [];
  return fs
    .readdirSync(CBERS_ARCHIVE_INDEX_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJsonSafe<CbersArchiveRecord | null>(path.join(CBERS_ARCHIVE_INDEX_DIR, entry), null))
    .filter((item): item is CbersArchiveRecord => Boolean(item))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function publishCbersPanToArchive(args: {
  uid: string;
  jobId: string;
  itemId: string;
  outputFilename: string;
  sourcePath: string;
}): Promise<CbersArchiveRecord> {
  const { orbit, year } = parseCbersItemId(args.itemId);
  const archiveFilename = withJobSuffix(args.outputFilename, args.jobId);
  const archiveDir = path.join(CBERS_ARCHIVE_ROOT, orbit, year);
  ensureDir(archiveDir);
  const hdPath = path.join(archiveDir, archiveFilename);
  fs.copyFileSync(args.sourcePath, hdPath);
  const bytes = fs.statSync(hdPath).size;
  const storeName = cleanLayerName(`${orbit}_${year}_${path.basename(archiveFilename, path.extname(archiveFilename))}`);
  const imageId = storeName;

  await publishGeoTiff({
    storeName,
    hdPath,
    orbit,
    year,
    title: path.basename(archiveFilename, path.extname(archiveFilename)),
  });

  const now = new Date().toISOString();
  const record: CbersArchiveRecord = {
    imageId,
    uid: safeSegment(args.uid),
    jobId: safeSegment(args.jobId),
    itemId: args.itemId,
    orbit,
    year,
    sourceFilename: args.outputFilename,
    archiveFilename,
    hdRelativePath: path.relative(CBERS_ARCHIVE_ROOT, hdPath).split(path.sep).join("/"),
    hdPath,
    bytes,
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${storeName}`,
    wmsStoreName: storeName,
    wmsPublicUrl:
      `${GEOSERVER_PUBLIC_WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities`,
    createdAt: now,
    updatedAt: now,
  };
  saveRecord(record);
  return record;
}

export function markCbersArchiveUserDeleted(uid: string, jobId: string): void {
  const now = new Date().toISOString();
  for (const record of listCbersArchiveRecords()) {
    if (record.uid !== safeSegment(uid) || record.jobId !== safeSegment(jobId) || record.userDeletedAt) continue;
    saveRecord({ ...record, userDeletedAt: now, updatedAt: now });
  }
}

function listUserProfiles(): Record<string, PlainObject> {
  const usersDir = path.join(STORAGE_ROOT, "users");
  if (!fs.existsSync(usersDir)) return {};
  const profiles: Record<string, PlainObject> = {};
  for (const uid of fs.readdirSync(usersDir)) {
    const profilePath = path.join(usersDir, uid, "profile.json");
    profiles[uid] = readJsonSafe<PlainObject>(profilePath, { uid });
  }
  return profiles;
}

async function deleteCbersArchiveRecord(imageId: string): Promise<CbersArchiveRecord | null> {
  const record = listCbersArchiveRecords().find((item) => item.imageId === safeSegment(imageId));
  if (!record || record.adminDeletedAt) return record || null;
  const now = new Date().toISOString();
  try {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(record.wmsStoreName)}?recurse=true`,
      "DELETE",
    );
    await removeFromCbersGroups(record);
    if (record.hdPath.startsWith(CBERS_ARCHIVE_ROOT) && fs.existsSync(record.hdPath)) {
      fs.rmSync(record.hdPath, { force: true });
    }
    const deleted = { ...record, adminDeletedAt: now, updatedAt: now };
    saveRecord(deleted);
    return deleted;
  } catch (error: any) {
    const failed = {
      ...record,
      adminDeleteError: String(error?.message || error),
      updatedAt: now,
    };
    saveRecord(failed);
    throw error;
  }
}

export function registerCbersArchiveAdminRoutes(app: Express): void {
  app.get("/api/admin/cbers-storage/summary", (_req: Request, res: ExpressResponse) => {
    const profiles = listUserProfiles();
    const records = listCbersArchiveRecords();
    const byUser = new Map<string, PlainObject>();
    for (const record of records) {
      const current = byUser.get(record.uid) || {
        uid: record.uid,
        email: profiles[record.uid]?.email || "",
        fullName: profiles[record.uid]?.fullName || "",
        imageCount: 0,
        activeImageCount: 0,
        bytes: 0,
        deletedBytes: 0,
        lastCreatedAt: "",
      };
      current.imageCount += 1;
      if (record.adminDeletedAt) {
        current.deletedBytes += record.bytes || 0;
      } else {
        current.activeImageCount += 1;
        current.bytes += record.bytes || 0;
      }
      if (String(record.createdAt || "") > String(current.lastCreatedAt || "")) current.lastCreatedAt = record.createdAt;
      byUser.set(record.uid, current);
    }
    const users = [...byUser.values()].sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0));
    res.json({
      ok: true,
      totalBytes: users.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
      totalImages: records.filter((item) => !item.adminDeletedAt).length,
      users,
    });
  });

  app.get("/api/admin/cbers-storage/users/:uid/images", (req: Request, res: ExpressResponse) => {
    const uid = safeSegment(req.params.uid);
    res.json({
      ok: true,
      uid,
      images: listCbersArchiveRecords().filter((record) => record.uid === uid),
    });
  });

  app.delete("/api/admin/cbers-storage/images/:imageId", async (req: Request, res: ExpressResponse) => {
    try {
      const record = await deleteCbersArchiveRecord(String(req.params.imageId || ""));
      if (!record) {
        res.status(404).json({ error: "Imagem CBERS não encontrada." });
        return;
      }
      res.json({ ok: true, image: record });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao excluir imagem CBERS do acervo." });
    }
  });
}
