/**
 * Empacotamento ZIP dos arquivos de uma cena Landsat publicada.
 */
import type { Response } from "express";
import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { LandsatLocalRecord, LandsatWmsZipFile } from "./types";
import { safeName } from "./utils";

export function collectLandsatFiles(record: LandsatLocalRecord): LandsatWmsZipFile[] {
  const sourcePath = record.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const candidates = new Set([
    base,
    `${base}.aux.xml`,
    `${base}.ovr`,
    `${base}.xml`,
    `${base}.zip`,
    `${stem}.tfw`,
    `${stem}.tfwx`,
    `${stem}.TFwx`,
    `${stem}.tifw`,
    `${stem}.prj`,
    `${stem}.xml`,
  ]);
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => candidates.has(entry))
      .map((entry) => ({ absolutePath: path.join(dir, entry), name: entry }))
      .filter((entry) => fs.existsSync(entry.absolutePath) && fs.statSync(entry.absolutePath).isFile())
      .sort((a, b) => (a.name === base ? -1 : b.name === base ? 1 : a.name.localeCompare(b.name)));
  } catch {
    return [{ absolutePath: sourcePath, name: base }];
  }
}

export function zipFilenameForRecord(record: LandsatLocalRecord): string {
  const stem = path.basename(record.sourcePath, path.extname(record.sourcePath));
  return `${safeName(stem, record.layerName)}.zip`;
}

export function setZipHeaders(res: Response, filename: string, files: LandsatWmsZipFile[]): void {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Landsat-WMS-File-Count", String(files.length));
}

export async function streamZip(res: Response, filename: string, files: LandsatWmsZipFile[]): Promise<void> {
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
    setZipHeaders(res, filename, files);
    archive.pipe(res);
    for (const file of files) archive.file(file.absolutePath, { name: file.name });
    void archive.finalize().then(() => done()).catch(done);
  });
}
