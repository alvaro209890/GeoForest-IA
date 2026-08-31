/**
 * Busca STAC (LandsatLook/USGS + Planetary Computer), assinatura SAS e estimativa de download.
 */
import path from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import { FETCH_TIMEOUT_MS, LANDSAT_PC_COLLECTION, LANDSAT_PC_SIGN_ROOT, LANDSAT_PC_STAC_ROOT, LANDSAT_SEARCH_LIMIT, LANDSAT_STAC_COLLECTION, LANDSAT_STAC_ROOT } from "./constants";
import { findLocalRecordForExternal, localRecordToScene, readLocalLandsatRecords } from "./local-archive";
import { compositionLabel, isoFromDateCompact, landsatAssetKeysForComposition, parseLandsatStacId, planetaryComputerItemIdFromLandsatId } from "./naming";
import { LandsatComposition, LandsatScene, PlainObject } from "./types";
import { bboxGeometry, computeSceneCoverage } from "./utils";
import { fetchJsonWithTimeout } from "../lib/http";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetchJsonWithTimeout<T>(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    init,
    defaultHeaders: { Accept: "application/json" },
    httpError: ({ status, body }) => `STAC Landsat ${status}: ${body.slice(0, 300)}`,
  });
}


export function sceneFromStacFeature(feature: any, composition: LandsatComposition, propertyGeometry?: Polygon | MultiPolygon): LandsatScene | null {
  const id = String(feature?.id || "").trim();
  const parsed = parseLandsatStacId(id);
  if (!parsed) return null;
  const assets = feature?.assets && typeof feature.assets === "object" ? feature.assets : {};
  const assetKeys = landsatAssetKeysForComposition(composition);
  if (!assetKeys.every((key) => Boolean(assets[key]?.href))) return null;
  const bbox = Array.isArray(feature?.bbox) && feature.bbox.length >= 4
    ? [Number(feature.bbox[0]), Number(feature.bbox[1]), Number(feature.bbox[2]), Number(feature.bbox[3])] as [number, number, number, number]
    : null;
  const geometry = feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon"
    ? feature.geometry as Polygon | MultiPolygon
    : bboxGeometry(bbox);
  const coverage = propertyGeometry && geometry
    ? computeSceneCoverage(propertyGeometry, geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  const platform = String(feature?.properties?.platform || parsed.platform || "").trim() || parsed.platform;
  const scene: LandsatScene = {
    id,
    source: "usgs_stac",
    collectionId: String(feature?.collection || LANDSAT_STAC_COLLECTION),
    platform,
    sensor: Array.isArray(feature?.properties?.instruments) ? feature.properties.instruments.join(", ") : undefined,
    path: parsed.path,
    row: parsed.row,
    orbit: parsed.orbit,
    year: parsed.year,
    date: parsed.date,
    datetime: String(feature?.properties?.datetime || isoFromDateCompact(parsed.date)),
    cloudCover: Number.isFinite(Number(feature?.properties?.["eo:cloud_cover"]))
      ? Number(feature.properties["eo:cloud_cover"])
      : null,
    composition,
    compositionLabel: compositionLabel(platform, composition),
    bbox,
    geometry,
    thumbnailUrl: assets.thumbnail?.href || assets.reduced_resolution_browse?.href,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
    assetKeys,
  };
  const local = findLocalRecordForExternal(scene);
  return local ? localRecordToScene(local, propertyGeometry) : scene;
}

export async function searchExternalLandsatScenes(args: {
  bbox: [number, number, number, number] | null;
  propertyGeometry?: Polygon | MultiPolygon;
  dateStart?: string | null;
  dateEnd?: string | null;
  orbit?: string | null;
  row?: string | null;
  maxCloud?: number | null;
  composition: LandsatComposition;
}): Promise<LandsatScene[]> {
  const body: PlainObject = {
    collections: [LANDSAT_STAC_COLLECTION],
    limit: LANDSAT_SEARCH_LIMIT,
  };
  if (args.bbox) body.bbox = args.bbox;
  if (args.dateStart || args.dateEnd) body.datetime = `${args.dateStart || ".."}/${args.dateEnd || ".."}`;
  if (args.orbit && args.row) {
    body.query = {
      "landsat:wrs_path": { eq: args.orbit },
      "landsat:wrs_row": { eq: args.row },
    };
  }
  const payload = await fetchJson<any>(`${LANDSAT_STAC_ROOT}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const byId = new Map<string, LandsatScene>();
  for (const feature of features) {
    const scene = sceneFromStacFeature(feature, args.composition, args.propertyGeometry);
    if (!scene) continue;
    if (args.orbit && scene.path !== args.orbit) continue;
    if (args.row && scene.row !== args.row) continue;
    if (args.maxCloud !== null && args.maxCloud !== undefined && scene.cloudCover !== null && scene.cloudCover > args.maxCloud) continue;
    byId.set(scene.id, scene);
  }
  return [...byId.values()];
}

export function searchLocalLandsatScenes(args: {
  propertyGeometry?: Polygon | MultiPolygon;
  dateStart?: string | null;
  dateEnd?: string | null;
  orbit?: string | null;
  row?: string | null;
  composition?: LandsatComposition | "any";
}): LandsatScene[] {
  const startMs = args.dateStart ? new Date(args.dateStart).getTime() : null;
  const endMs = args.dateEnd ? new Date(args.dateEnd).getTime() : null;
  return readLocalLandsatRecords()
    .filter((record) => {
      if (args.orbit && record.path !== args.orbit) return false;
      if (args.row && record.row !== args.row) return false;
      if (args.composition && args.composition !== "any" && record.composition !== args.composition) return false;
      const recordMs = record.date ? new Date(isoFromDateCompact(record.date)).getTime() : NaN;
      if (Number.isFinite(recordMs)) {
        if (startMs !== null && Number.isFinite(startMs) && recordMs < startMs) return false;
        if (endMs !== null && Number.isFinite(endMs) && recordMs > endMs) return false;
      }
      return true;
    })
    .map((record) => localRecordToScene(record, args.propertyGeometry))
    .filter((scene) => scene.coversArea !== false);
}

export async function getStacItem(itemId: string): Promise<any> {
  return fetchJson<any>(
    `${LANDSAT_STAC_ROOT}/collections/${encodeURIComponent(LANDSAT_STAC_COLLECTION)}/items/${encodeURIComponent(itemId)}`,
  );
}

export async function getPlanetaryComputerStacItem(itemId: string): Promise<any> {
  const pcItemId = planetaryComputerItemIdFromLandsatId(itemId);
  return fetchJson<any>(
    `${LANDSAT_PC_STAC_ROOT}/collections/${encodeURIComponent(LANDSAT_PC_COLLECTION)}/items/${encodeURIComponent(pcItemId)}`,
  );
}

export function isAzureBlobHref(href: string): boolean {
  return /^https:\/\/[^/]+\.blob\.core\.windows\.net\//i.test(String(href || ""));
}

export async function signPlanetaryComputerHref(href: string): Promise<string> {
  if (!isAzureBlobHref(href)) return href;
  const signed = await fetchJson<{ href?: string }>(
    `${LANDSAT_PC_SIGN_ROOT}?href=${encodeURIComponent(href)}`,
  );
  return signed.href || href;
}

export async function prepareDownloadableLandsatItem(item: any): Promise<any> {
  try {
    const pcItem = await getPlanetaryComputerStacItem(String(item?.id || ""));
    const assets = pcItem?.assets && typeof pcItem.assets === "object" ? pcItem.assets : {};
    const signedAssets: PlainObject = {};
    await Promise.all(Object.entries(assets).map(async ([key, asset]: [string, any]) => {
      const href = String(asset?.href || "");
      signedAssets[key] = href
        ? { ...asset, href: await signPlanetaryComputerHref(href) }
        : asset;
    }));
    return { ...pcItem, assets: signedAssets };
  } catch {
    return item;
  }
}

export async function estimateScene(scene: LandsatScene): Promise<LandsatScene> {
  if (scene.source === "local_wms") return scene;
  const item = await prepareDownloadableLandsatItem(await getStacItem(scene.id));
  const keys = landsatAssetKeysForComposition(scene.composition);
  let total = 0;
  let complete = true;
  for (const key of keys) {
    const href = item?.assets?.[key]?.href;
    if (!href) {
      complete = false;
      continue;
    }
    const size = await headContentLength(href);
    if (size === null) complete = false;
    else total += size;
  }
  return { ...scene, downloadBytes: complete ? total : null };
}

export async function headContentLength(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || "");
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
