/**
 * Coleções CBERS (L4/L2): resolução por item, validação de nível e nomes de saída.
 */
import { CBERS_COLLECTIONS, CBERS_GENERATION_LEVEL } from "./constants";
import { CbersCollectionConfig, CbersCollectionLevel } from "./types";
import { safeName } from "./utils";

export function cbersCollectionByLevel(level: CbersCollectionLevel): CbersCollectionConfig {
  return CBERS_COLLECTIONS.find((collection) => collection.level === level) || CBERS_COLLECTIONS[0];
}

export function cbersCollectionById(collectionId?: string | null): CbersCollectionConfig | null {
  const clean = String(collectionId || "").trim();
  if (!clean) return null;
  return CBERS_COLLECTIONS.find((collection) => collection.collectionId === clean) || null;
}

export function cbersLevelFromItemId(itemId: string): CbersCollectionLevel | null {
  const match = String(itemId || "").match(/[_-](L[24])(?:$|[_-])/i);
  const level = match?.[1]?.toUpperCase();
  return level === "L2" || level === "L4" ? level : null;
}

export function assertCbersL4GenerationItem(itemId: string, collectionId?: string | null): void {
  const itemLevel = cbersLevelFromItemId(itemId);
  const cleanCollectionId = String(collectionId || "").trim();
  const collection = cleanCollectionId ? cbersCollectionById(cleanCollectionId) : null;
  const requestedLevel = collection?.level || itemLevel || CBERS_GENERATION_LEVEL;
  if (requestedLevel !== CBERS_GENERATION_LEVEL) {
    throw new Error(
      `A geração CBERS está restrita a cenas L4. Cena recusada: ${itemId || cleanCollectionId || "sem identificador"}.`,
    );
  }
}

export function inferCbersCollection(itemId: string, collectionId?: string | null): CbersCollectionConfig {
  const explicit = cbersCollectionById(collectionId);
  if (explicit) return explicit;
  const level = cbersLevelFromItemId(itemId);
  return level ? cbersCollectionByLevel(level) : cbersCollectionByLevel("L4");
}

export function cbersOutputFilename(itemId: string, level?: CbersCollectionLevel | null): string {
  const desiredLevel = level || cbersLevelFromItemId(itemId);
  let stem = safeName(itemId, "CBERS_4A_WPM")
    .replace(/\.(tif|tiff)$/i, "")
    .replace(/_C?342(?:_PAN)?$/i, "")
    .replace(/_PAN$/i, "");
  if (desiredLevel) {
    stem = /[_-]L[24]$/i.test(stem)
      ? stem.replace(/([_-])L[24]$/i, `$1${desiredLevel}`)
      : `${stem}_${desiredLevel}`;
  }
  return `${stem}_C342_PAN.TIF`;
}

export function cbersBatchZipFilename(jobId: string): string {
  return safeName(`CBERS_4A_WPM_LOTE_${jobId.slice(0, 8)}_C342_PAN.zip`, "CBERS_4A_WPM_LOTE_C342_PAN.zip");
}
