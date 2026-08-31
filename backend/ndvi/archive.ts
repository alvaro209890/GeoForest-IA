/**
 * Acervo permanente do NDVI no HD Backup + índice JSON para reuso.
 *
 * `/media/server/HD Backup/RASTER/NDVI/<path>_<row>/<ano>/` — irmão de
 * `RASTER/CBERS_4A` e `RASTER/LANDSAT`.
 *
 * O recorte acontece ANTES do cálculo, então o arquivo arquivado cobre só o imóvel,
 * não a cena de 180×180 km: um imóvel de 1.000 ha em 30 m dá ~11 mil pixels, dezenas
 * de KB em Float32.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NDVI_ARCHIVE_ROOT } from "./constants";
import { orbitKey, safeSegment } from "./naming";
import type { NdviArchiveRecord } from "./types";
import { ensureDir, writeJsonAtomic } from "../lib/fs-json";

const STORAGE_ROOT =
  process.env.LOCAL_DATA_ROOT ||
  "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest";

const NDVI_INDEX_DIR = path.join(STORAGE_ROOT, "ndvi_archive", "images");

/** Cópia atômica com conferência de tamanho, no molde do `saveCbersArchiveAsset`. */
export function saveNdviArchiveAsset(args: {
  subdir: string;
  filename: string;
  sourcePath: string;
}): { absolutePath: string; bytes: number } {
  const destinoDir = path.join(NDVI_ARCHIVE_ROOT, args.subdir);
  ensureDir(destinoDir);
  const destino = path.join(destinoDir, args.filename);
  const tmp = path.join(destinoDir, `.${args.filename}.${crypto.randomUUID()}.tmp`);

  fs.copyFileSync(args.sourcePath, tmp);
  const origem = fs.statSync(args.sourcePath).size;
  const copiado = fs.statSync(tmp).size;
  if (origem !== copiado) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignora */
    }
    throw new Error(`Cópia incompleta de ${args.filename}: ${copiado} de ${origem} bytes.`);
  }
  fs.renameSync(tmp, destino);

  // leva junto o .ovr, quando existe
  const ovrOrigem = `${args.sourcePath}.ovr`;
  if (fs.existsSync(ovrOrigem)) {
    const ovrDestino = `${destino}.ovr`;
    const ovrTmp = `${ovrDestino}.${crypto.randomUUID()}.tmp`;
    fs.copyFileSync(ovrOrigem, ovrTmp);
    fs.renameSync(ovrTmp, ovrDestino);
  }

  return { absolutePath: destino, bytes: copiado };
}

export function ndviArchiveSubdir(pathId: string, row: string, year: string | number): string {
  return path.join(orbitKey(pathId, row), safeSegment(year, "0000"));
}

function recordPath(ndviId: string): string {
  return path.join(NDVI_INDEX_DIR, `${safeSegment(ndviId, "ndvi")}.json`);
}

export function saveNdviArchiveRecord(record: NdviArchiveRecord): void {
  writeJsonAtomic(recordPath(record.ndviId), record);
}

export function readNdviArchiveRecord(ndviId: string): NdviArchiveRecord | null {
  try {
    const arquivo = recordPath(ndviId);
    if (!fs.existsSync(arquivo)) return null;
    return JSON.parse(fs.readFileSync(arquivo, "utf8")) as NdviArchiveRecord;
  } catch {
    return null;
  }
}

export function listNdviArchiveRecords(): NdviArchiveRecord[] {
  try {
    if (!fs.existsSync(NDVI_INDEX_DIR)) return [];
    return fs
      .readdirSync(NDVI_INDEX_DIR)
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(NDVI_INDEX_DIR, n), "utf8")) as NdviArchiveRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is NdviArchiveRecord => Boolean(r))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

/**
 * Reuso: recalcular NDVI de uma cena já processada para o mesmo recorte é desperdício.
 * Mesma regra do CBERS (`docs/WMS_CBERS.md`).
 */
export function findReusableNdvi(args: {
  itemId: string;
  clipJobId: string;
}): NdviArchiveRecord | null {
  return (
    listNdviArchiveRecords().find(
      (r) =>
        r.itemId === args.itemId &&
        r.clipJobId === args.clipJobId &&
        !r.userDeletedAt &&
        fs.existsSync(r.ndviHdPath),
    ) || null
  );
}

export function markNdviArchiveUserDeleted(ndviId: string): void {
  const atual = readNdviArchiveRecord(ndviId);
  if (!atual) return;
  saveNdviArchiveRecord({ ...atual, userDeletedAt: new Date().toISOString() });
}

export { NDVI_ARCHIVE_ROOT, NDVI_INDEX_DIR };
