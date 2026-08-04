/**
 * Nomes de camada e URLs WMS públicas das cenas CBERS.
 */
import { GEOSERVER_PUBLIC_WMS_BASE } from "./constants";

export type CbersWmsAvailability = {
  wmsLayerName: string;
  wmsUrl: string;
  wmsDownloadUrl: string;
  sourcePath?: string;
  archiveImageId?: string;
  archiveFilename?: string;
};

export type CbersWmsZipFile = {
  absolutePath: string;
  name: string;
};

export function publicWmsCapabilitiesUrl(): string {
  return `${GEOSERVER_PUBLIC_WMS_BASE.replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

export function wmsDownloadPathForArchiveImage(imageId: string): string {
  return `/api/cbers-wpm/wms-download?imageId=${encodeURIComponent(imageId)}`;
}

export function wmsDownloadPathForItem(itemId: string): string {
  return `/api/cbers-wpm/wms-download?itemId=${encodeURIComponent(itemId)}`;
}

export function normalizeLayerName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCbersItemIdForWms(itemId: string): {
  dateCompact: string;
  dateUnderscore: string;
  orbit: string;
  row: string;
  level?: string;
} | null {
  const match = String(itemId || "").match(/CBERS[_-]?4A[_-]WPM[_-](\d{8})[_-](\d{3})[_-](\d{3})(?:[_-](L\d+))?/i);
  if (!match) return null;
  const dateCompact = match[1];
  return {
    dateCompact,
    dateUnderscore: `${dateCompact.slice(0, 4)}_${dateCompact.slice(4, 6)}_${dateCompact.slice(6, 8)}`,
    orbit: match[2],
    row: match[3],
    level: match[4]?.toLowerCase(),
  };
}

export function cbersSceneMergeKey(itemId: string): string {
  const parsed = parseCbersItemIdForWms(itemId);
  if (!parsed) return normalizeLayerName(itemId);
  const level = parsed.level || "l4";
  return [parsed.dateCompact, parsed.orbit, parsed.row, level].join("_");
}

export function normalizeOrbitPointParam(raw: unknown, label: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  if (!/^\d{1,3}$/.test(digits)) {
    throw new Error(`${label} deve conter 1 a 3 dígitos.`);
  }
  return digits.padStart(3, "0");
}
