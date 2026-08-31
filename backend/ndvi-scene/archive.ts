/**
 * Acervo da cena completa no raster compartilhado + índice JSON para reuso.
 *
 * Reusa o mecanismo de `backend/ndvi/archive.ts` (gravação atômica, subdir por
 * órbita/ponto/ano, índice em `ndvi_archive/images`) — aqui cada composição vira
 * um arquivo GeoTIFF RGB 8 bits da cena INTEIRA, não um recorte.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NDVI_INDEX_DIR } from "../ndvi/archive";
import { safeSegment } from "../ndvi/naming";
import { NDVI_SCENE_ARCHIVE_ROOT } from "./constants";
import type { NdviSceneComposition } from "./constants";
import { ensureDir, writeJsonAtomic } from "../lib/fs-json";

/** Raiz do acervo da cena completa (default: mesma do NDVI pós-recorte). */
export { NDVI_SCENE_ARCHIVE_ROOT };

const SCENE_INDEX_DIR = path.join(
  process.env.NDVI_SCENE_INDEX_DIR || path.dirname(NDVI_INDEX_DIR),
  "ndvi_scene_archive",
  "images"
);

export type NdviSceneArchiveRecord = {
  archiveId: string;
  uid: string;
  ndviSceneJobId: string;
  itemId: string;
  composition: NdviSceneComposition;
  platform: string;
  path: string;
  row: string;
  year: string;
  acquiredAt: string;
  cloudCoverPct: number | null;
  filename: string;
  hdPath: string;
  bytes: number;
  wmsLayerName: string;
  wmsStoreName: string;
  wmsPublicUrl: string;
  createdAt: string;
  updatedAt: string;
  userDeletedAt?: string | null;
};

/**
 * Copia o GeoTIFF RGB 8 bits da composição para `NDVI_SCENE_ARCHIVE_ROOT/<path>_<row>/<ano>/`,
 * com conferência de tamanho e levando junto o `.ovr` quando existir.
 */
export function saveNdviSceneArchiveAsset(args: {
  subdir: string;
  filename: string;
  sourcePath: string;
}): { absolutePath: string; bytes: number } {
  const destinoDir = path.join(NDVI_SCENE_ARCHIVE_ROOT, args.subdir);
  ensureDir(destinoDir);
  const destino = path.join(destinoDir, args.filename);
  const tmp = path.join(
    destinoDir,
    `.${args.filename}.${crypto.randomUUID()}.tmp`
  );

  fs.copyFileSync(args.sourcePath, tmp);
  const origem = fs.statSync(args.sourcePath).size;
  const copiado = fs.statSync(tmp).size;
  if (origem !== copiado) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignora */
    }
    throw new Error(
      `Cópia incompleta de ${args.filename}: ${copiado} de ${origem} bytes.`
    );
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

/** `ndvi_224_069` / `2008` — mesmo layout do NDVI pós-recorte. */
export function ndviSceneArchiveSubdir(
  pathId: string,
  row: string,
  year: string | number
): string {
  return path.join(
    `ndvi_${safeSegment(pathId, "000")}_${safeSegment(row, "000")}`,
    safeSegment(year, "0000")
  );
}

function recordPath(archiveId: string): string {
  return path.join(
    SCENE_INDEX_DIR,
    `${safeSegment(archiveId, "ndvi-scene")}.json`
  );
}

export function saveNdviSceneArchiveRecord(
  record: NdviSceneArchiveRecord
): void {
  writeJsonAtomic(recordPath(record.archiveId), record);
}

export function deleteNdviSceneArchiveRecord(archiveId: string): void {
  fs.rmSync(recordPath(archiveId), { force: true });
}

/** Exclui somente um arquivo do acervo e seu overview, recusando caminhos externos. */
export function deleteNdviSceneArchiveAsset(absolutePath: string): void {
  const root = path.resolve(NDVI_SCENE_ARCHIVE_ROOT);
  const target = path.resolve(absolutePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Recusa ao excluir artefato fora do acervo NDVI: ${target}`
    );
  }
  fs.rmSync(`${target}.ovr`, { force: true });
  fs.rmSync(target, { force: true });
}

export function readNdviSceneArchiveRecord(
  archiveId: string
): NdviSceneArchiveRecord | null {
  try {
    const arquivo = recordPath(archiveId);
    if (!fs.existsSync(arquivo)) return null;
    return JSON.parse(
      fs.readFileSync(arquivo, "utf8")
    ) as NdviSceneArchiveRecord;
  } catch {
    return null;
  }
}

export function listNdviSceneArchiveRecords(): NdviSceneArchiveRecord[] {
  try {
    if (!fs.existsSync(SCENE_INDEX_DIR)) return [];
    return fs
      .readdirSync(SCENE_INDEX_DIR)
      .filter(n => n.endsWith(".json"))
      .map(n => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(SCENE_INDEX_DIR, n), "utf8")
          ) as NdviSceneArchiveRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is NdviSceneArchiveRecord => Boolean(r))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

export function markNdviSceneArchiveUserDeleted(
  uid: string,
  jobId: string
): void {
  const agora = new Date().toISOString();
  for (const record of listNdviSceneArchiveRecords()) {
    if (
      record.uid !== uid ||
      record.ndviSceneJobId !== jobId ||
      record.userDeletedAt
    )
      continue;
    saveNdviSceneArchiveRecord({
      ...record,
      userDeletedAt: agora,
      updatedAt: agora,
    });
  }
}
