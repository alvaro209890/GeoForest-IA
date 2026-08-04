/**
 * Empacotamento ZIP: imagem WMS, cena privada e lote.
 */
import type { Response } from "express";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { saveUserFileFromPath } from "../local-storage";
import { saveCbersArchiveAsset } from "./archive";
import { archiveAvailabilityFromRecord, findAnyActiveArchiveForItem, findArchiveRecordByImageId } from "./reuse";
import { cbersBatchZipFilename, cbersOutputFilename } from "./collections";
import { resolveLocalGeoserverLayerFile } from "./geoserver";
import { CbersAlignmentResult, CbersScene, CbersSceneJobState } from "./types";
import { safeName } from "./utils";
import { CbersWmsAvailability, CbersWmsZipFile } from "./wms";

export function collectWmsImageFiles(availability: CbersWmsAvailability): CbersWmsZipFile[] {
  const sourcePath = availability.sourcePath || resolveLocalGeoserverLayerFile(availability.wmsLayerName);
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const wanted = new Set<string>([
    base,
    `${base}.aux.xml`,
    `${base}.ovr`,
    `${base}.xml`,
    `${stem}.tfw`,
    `${stem}.tifw`,
    `${stem}.prj`,
    `${stem}.xml`,
  ]);
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => wanted.has(entry))
      .map((entry) => ({
        absolutePath: path.join(dir, entry),
        name: entry,
      }))
      .filter((entry) => fs.existsSync(entry.absolutePath) && fs.statSync(entry.absolutePath).isFile())
      .sort((a, b) => {
        if (a.name === base) return -1;
        if (b.name === base) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return fs.existsSync(sourcePath) ? [{ absolutePath: sourcePath, name: base }] : [];
  }
}

export function zipFilenameForWmsImage(files: CbersWmsZipFile[], itemId: string): string {
  const primary = files[0]?.name || cbersOutputFilename(itemId);
  const ext = path.extname(primary);
  const stem = (ext ? primary.slice(0, -ext.length) : primary)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${stem || safeName(itemId, "CBERS_4A_WPM")}.zip`;
}

export async function streamWmsZip(res: Response, filename: string, files: CbersWmsZipFile[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 0 } });
    let finished = false;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (error) reject(error);
      else resolve();
    };
    archive.on("error", done);
    res.on("close", () => done());
    setWmsZipHeaders(res, filename, files);
    archive.pipe(res);
    for (const file of files) archive.file(file.absolutePath, { name: file.name });
    void archive.finalize().then(() => done()).catch(done);
  });
}

export function setWmsZipHeaders(res: Response, filename: string, files: CbersWmsZipFile[]): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-CBERS-WMS-File-Count", String(files.length));
}

export function resolveWmsZipRequest(args: {
  imageId?: string | null;
  itemId?: string | null;
}): { availability: CbersWmsAvailability; files: CbersWmsZipFile[]; filename: string } | null {
  const cleanImageId = String(args.imageId || "").trim();
  const cleanItemId = String(args.itemId || "").trim();
  const availability =
    (cleanImageId ? (() => {
      const archive = findArchiveRecordByImageId(cleanImageId);
      return archive ? archiveAvailabilityFromRecord(archive) : null;
    })() : null) ||
    (cleanItemId ? findAnyActiveArchiveForItem(cleanItemId) : null);
  if (!availability) return null;
  const files = collectWmsImageFiles(availability);
  if (!files.length) return null;
  return { availability, files, filename: zipFilenameForWmsImage(files, cleanImageId || cleanItemId) };
}


export async function createPrivateCbersZip(args: {
  uid: string;
  jobId: string;
  scene: CbersScene;
  sourcePath: string;
  outputFilename: string;
  sceneDir: string;
  alignment: CbersAlignmentResult;
}): Promise<{ url: string; relativePath: string; filename: string; bytes: number }> {
  const zipFilename = safeName(`${path.basename(args.outputFilename, path.extname(args.outputFilename))}_SEM_WMS_${args.jobId.slice(0, 8)}.zip`);
  const tempZipPath = path.join(args.sceneDir, zipFilename);
  const output = fs.createWriteStream(tempZipPath);
  const archive = archiver("zip", { zlib: { level: 0 } });
  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(args.sourcePath, { name: args.outputFilename });
    archive.append(
      [
        "AVISO: imagem CBERS entregue apenas ao usuario.",
        "Motivo: o georreferenciamento gerado nao pode ser validado para publicacao no WMS.",
        `Cena: ${args.scene.id}`,
        `Status: ${args.alignment.status}`,
        args.alignment.warning ? `Diagnostico: ${args.alignment.warning}` : "",
        args.alignment.offsetMeters !== undefined ? `Divergencia da footprint STAC: ${args.alignment.offsetMeters} m` : "",
      ].filter(Boolean).join("\n"),
      { name: "AVISO_GEORREFERENCIAMENTO.txt" },
    );
    void archive.finalize().catch(reject);
  });
  const stored = saveUserFileFromPath({
    uid: args.uid,
    area: "cbers/output",
    filename: zipFilename,
    sourcePath: tempZipPath,
  });
  return {
    url: stored.publicUrl,
    relativePath: stored.relativePath,
    filename: zipFilename,
    bytes: stored.bytes,
  };
}


export async function createCbersBatchZip(args: {
  uid: string;
  jobId: string;
  tmpDir: string;
  scenes: CbersSceneJobState[];
}): Promise<{
  url: string;
  relativePath: string;
  filename: string;
  bytes: number;
  fileCount: number;
} | null> {
  const entries = args.scenes
    .filter((scene) => scene.status === "completed" && scene.archive?.hdPath)
    .map((scene) => {
      const absolutePath = String(scene.archive?.hdPath || "");
      return {
        absolutePath,
        name: scene.outputFilename || cbersOutputFilename(scene.scene?.id || scene.itemId),
      };
    })
    .filter((entry) => fs.existsSync(entry.absolutePath));
  if (!entries.length) return null;

  const filename = cbersBatchZipFilename(args.jobId);
  const tempZipPath = path.join(args.tmpDir, filename);
  const output = fs.createWriteStream(tempZipPath);
  const archive = archiver("zip", { zlib: { level: 0 } });

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const entry of entries) archive.file(entry.absolutePath, { name: entry.name });
    void archive.finalize().catch(reject);
  });

  if (!fs.existsSync(tempZipPath)) return null;
  const stored = saveCbersArchiveAsset({
    subdir: path.join("jobs", args.jobId),
    filename,
    sourcePath: tempZipPath,
  });
  return {
    url: stored.publicUrl,
    relativePath: stored.relativePath,
    filename,
    bytes: stored.bytes,
    fileCount: entries.length,
  };
}
