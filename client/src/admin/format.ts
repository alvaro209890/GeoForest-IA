/**
 * Helpers do painel administrativo: URLs da API, formatação e normalização.
 */
import type { AdminStorageFile, UserSummary } from "./types";
import { RESERVED_USER_STORAGE_NAMES } from "./constants";

export function apiBase(): string {
  return String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

export function formatPercent(value?: number | null): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
}

export function formatTemperature(value?: number | null): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)} °C`;
}

export function formatUptime(seconds?: number): string {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "-";
  const total = Math.floor(Number(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function sourceLabel(source?: string): string {
  switch (source) {
    case "raster_archive":
      return "Raster compartilhado";
    case "user_storage":
      return "Conta local";
    default:
      return "Arquivo";
  }
}

export function sourceTone(source?: string): string {
  switch (source) {
    case "raster_archive":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "user_storage":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

export function storageKindLabel(kind: "ssd" | "hd"): string {
  return kind === "ssd" ? "SSD" : "HD";
}

export function storageKindTone(kind: "ssd" | "hd"): string {
  return kind === "ssd"
    ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
    : "border-amber-500/20 bg-amber-500/10 text-amber-200";
}

export function compactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  const units = ["B", "K", "M", "G", "T"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)}${units[unit]}`;
}

export function shortLabel(value: string, size = 16): string {
  const text = String(value || "").trim();
  if (text.length <= size) return text || "-";
  return `${text.slice(0, Math.max(1, size - 1))}...`;
}

export function isAdminUserSummary(item: UserSummary): boolean {
  const uid = String(item?.uid || "").trim();
  if (!uid || RESERVED_USER_STORAGE_NAMES.has(uid)) return false;
  return Boolean(item.email || item.fullName || Number(item.sharedRasterBytes || 0) > 0 || Number(item.fileCount || 0) > 0);
}

export async function fetchJson(path: string): Promise<any> {
  const response = await fetch(apiUrl(path));
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Resposta do backend nao e JSON.");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "Falha na requisicao.");
  return payload;
}

export function cbersImageToStorageFile(image: any): AdminStorageFile {
  const relativePath = String(image?.hdRelativePath || "");
  const publicUrl = relativePath ? `/api/raster/${relativePath}` : "";
  return {
    id: `cbers_archive:${String(image?.imageId || image?.archiveFilename || globalThis.crypto?.randomUUID?.() || Math.random())}`,
    uid: String(image?.uid || ""),
    name: String(image?.archiveFilename || image?.itemId || "CBERS"),
    relativePath,
    publicUrl,
    category: "Raster compartilhado",
    source: "raster_archive",
    extension: "tif",
    bytes: Number(image?.bytes || 0),
    createdAt: String(image?.createdAt || ""),
    modifiedAt: String(image?.updatedAt || image?.createdAt || ""),
    imageId: String(image?.imageId || ""),
    wmsPublicUrl: String(image?.wmsPublicUrl || ""),
    userDeletedAt: image?.userDeletedAt,
    adminDeletedAt: image?.adminDeletedAt,
  };
}


