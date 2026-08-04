/**
 * Descoberta de camadas já publicadas no GeoServer local.
 */
import fs from "node:fs";
import path from "node:path";
import { GEOSERVER_DATA_DIR, GEOSERVER_WORKSPACE } from "./constants";
import { CbersWmsAvailability, normalizeLayerName, parseCbersItemIdForWms, publicWmsCapabilitiesUrl, wmsDownloadPathForItem } from "./wms";

export let geoserverLayerCache: { expiresAt: number; layers: string[] } | null = null;

export function listLocalGeoserverLayerNames(): string[] {
  const now = Date.now();
  if (geoserverLayerCache && geoserverLayerCache.expiresAt > now) return geoserverLayerCache.layers;
  const workspaceDir = path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE);
  let layers: string[] = [];
  try {
    layers = fs
      .readdirSync(workspaceDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(workspaceDir, name, name, "layer.xml")));
  } catch {
    layers = [];
  }
  geoserverLayerCache = { expiresAt: now + 60_000, layers };
  return layers;
}

export function stripWorkspaceFromLayer(layerName: string): string {
  const clean = String(layerName || "").trim();
  return clean.includes(":") ? clean.split(":").pop() || "" : clean;
}

export function decodeFileUrl(value: string): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  try {
    if (clean.startsWith("file:")) return decodeURIComponent(new URL(clean).pathname);
  } catch {
    // Fall through to the simple file: prefix handling below.
  }
  return decodeURIComponent(clean.replace(/^file:/i, ""));
}

export function resolveLocalGeoserverLayerFile(layerName: string): string | null {
  const name = stripWorkspaceFromLayer(layerName);
  if (!name || !listLocalGeoserverLayerNames().includes(name)) return null;
  const storePath = path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE, name, "coveragestore.xml");
  let xml = "";
  try {
    xml = fs.readFileSync(storePath, "utf8");
  } catch {
    return null;
  }
  const match = xml.match(/<url>([\s\S]*?)<\/url>/i);
  const resolved = decodeFileUrl(match?.[1] || "");
  return resolved && fs.existsSync(resolved) ? resolved : null;
}

export function layerMatchesCbersItem(layerName: string, itemId: string): boolean {
  const parsed = parseCbersItemIdForWms(itemId);
  if (!parsed) return false;
  const normalized = normalizeLayerName(layerName);
  const tokens = normalized.split("_").filter(Boolean);
  if ((!tokens.includes("cbers") && !tokens.includes("cbers4a")) || !tokens.includes("wpm")) return false;
  if (!normalized.includes(parsed.dateCompact) && !normalized.includes(parsed.dateUnderscore)) return false;
  const hasOrbitRow = tokens.some((token, idx) => token === parsed.orbit && tokens[idx + 1] === parsed.row);
  if (!hasOrbitRow) return false;
  const layerLevels = tokens.filter((token) => /^l\d+$/.test(token));
  if (parsed.level && layerLevels.length > 0 && !layerLevels.includes(parsed.level)) return false;
  return true;
}

export function findLocalGeoserverLayerForItem(itemId: string): CbersWmsAvailability | null {
  const layerName = listLocalGeoserverLayerNames()
    .filter((name) => layerMatchesCbersItem(name, itemId))
    .sort((a, b) => {
      const score = (name: string) => {
        const normalized = normalizeLayerName(name);
        return (normalized.includes("_pan") ? 2 : 0) + (normalized.includes("_c342") ? 1 : 0);
      };
      return score(b) - score(a) || a.localeCompare(b);
    })[0];
  if (!layerName) return null;
  return {
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${layerName}`,
    wmsUrl: publicWmsCapabilitiesUrl(),
    wmsDownloadUrl: wmsDownloadPathForItem(itemId),
    sourcePath: resolveLocalGeoserverLayerFile(layerName) || undefined,
  };
}
