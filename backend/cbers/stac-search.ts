/**
 * Busca STAC no BDC/INPE: cenas por área/órbita-ponto, item e estimativa de download.
 */
import type { MultiPolygon, Polygon } from "geojson";
import { attachArchiveAvailability } from "./reuse";
import { assertCbersL4GenerationItem, inferCbersCollection } from "./collections";
import { CBERS_COLLECTIONS, CBERS_ORBIT_POINT_SEARCH_MAX_PAGES, CBERS_REQUIRED_ASSETS, CBERS_SEARCH_LIMIT, FETCH_TIMEOUT_MS, STAC_ROOT } from "./constants";
import { CbersCollectionConfig, CbersEstimate, CbersScene } from "./types";
import { computeSceneCoverage, fetchJson, normalizeStacGeometry } from "./utils";
import { cbersSceneMergeKey, parseCbersItemIdForWms } from "./wms";

export function sceneFromStacFeature(
  feature: any,
  propertyGeometry?: Polygon | MultiPolygon,
  collection?: CbersCollectionConfig,
): CbersScene | null {
  const assets = feature?.assets && typeof feature.assets === "object" ? feature.assets : {};
  const assetKeys = Object.keys(assets);
  if (!CBERS_REQUIRED_ASSETS.every((key) => Boolean(assets[key]?.href))) return null;
  const id = String(feature?.id || "").trim();
  const resolvedCollection = collection || inferCbersCollection(id, feature?.collection);
  const bbox = Array.isArray(feature?.bbox) && feature.bbox.length >= 4
    ? [
      Number(feature.bbox[0]),
      Number(feature.bbox[1]),
      Number(feature.bbox[2]),
      Number(feature.bbox[3]),
    ] as [number, number, number, number]
    : null;
  const geometry = normalizeStacGeometry(feature?.geometry, bbox);
  const coverage = propertyGeometry
    ? computeSceneCoverage(propertyGeometry, geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  return {
    id,
    collectionId: resolvedCollection.collectionId,
    level: resolvedCollection.level,
    datetime: String(feature?.properties?.datetime || feature?.properties?.start_datetime || "").trim(),
    cloudCover: Number.isFinite(Number(feature?.properties?.["eo:cloud_cover"]))
      ? Number(feature.properties["eo:cloud_cover"])
      : null,
    bbox,
    geometry,
    thumbnailUrl: assets.thumbnail?.href ? String(assets.thumbnail.href) : undefined,
    assetKeys,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
  };
}


export function normalizeDateParam(raw: unknown, endOfDay = false): string | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  const iso = `${value}${suffix}`;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? iso : null;
}

export async function searchCbersScenes(
  bbox: [number, number, number, number] | null,
  options?: {
    dateStart?: string | null;
    dateEnd?: string | null;
    propertyGeometry?: Polygon | MultiPolygon;
    propertyGeometryHash?: string | null;
    orbit?: string | null;
    point?: string | null;
  },
): Promise<CbersScene[]> {
  const params = new URLSearchParams({ limit: String(CBERS_SEARCH_LIMIT) });
  if (bbox) params.set("bbox", bbox.join(","));
  if (options?.dateStart || options?.dateEnd) {
    params.set("datetime", `${options.dateStart || ".."}/${options.dateEnd || ".."}`);
  }
  const requestedOrbit = options?.orbit || null;
  const requestedPoint = options?.point || null;
  const maxPages = bbox ? 1 : CBERS_ORBIT_POINT_SEARCH_MAX_PAGES;
  const outputLimit = CBERS_SEARCH_LIMIT * CBERS_COLLECTIONS.length;
  const byEquivalentScene = new Map<string, CbersScene>();
  const seen = new Set<string>();
  for (const collection of [...CBERS_COLLECTIONS].sort((a, b) => a.priority - b.priority)) {
    let url: string | null = `${STAC_ROOT}/collections/${encodeURIComponent(collection.collectionId)}/items?${params.toString()}`;
    for (let page = 0; url && page < maxPages && byEquivalentScene.size < outputLimit; page += 1) {
      const payload: any = await fetchJson<any>(url);
      const features: any[] = Array.isArray(payload?.features) ? payload.features : [];
      for (const feature of features) {
        const scene = sceneFromStacFeature(feature, options?.propertyGeometry, collection);
        if (!scene?.id || seen.has(scene.id)) continue;
        const parsed = parseCbersItemIdForWms(scene.id);
        if (requestedOrbit && parsed?.orbit !== requestedOrbit) continue;
        if (requestedPoint && parsed?.row !== requestedPoint) continue;
        seen.add(scene.id);
        const next = attachArchiveAvailability(scene, options?.propertyGeometryHash);
        const key = cbersSceneMergeKey(next.id);
        const current = byEquivalentScene.get(key);
        const currentPriority = current ? inferCbersCollection(current.id, current.collectionId).priority : Number.POSITIVE_INFINITY;
        if (!current || collection.priority < currentPriority) {
          byEquivalentScene.set(key, {
            ...next,
            fallbackFromL2: false,
          });
        }
        if (byEquivalentScene.size >= outputLimit) break;
      }
      const nextHref: string = Array.isArray(payload?.links)
        ? String(payload.links.find((link: any) => String(link?.rel || "").toLowerCase() === "next")?.href || "")
        : "";
      url = nextHref ? new URL(nextHref, STAC_ROOT).toString() : null;
    }
  }

  const scenes = [...byEquivalentScene.values()];
  return scenes.sort((a: CbersScene, b: CbersScene) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
}

export async function getStacItem(itemId: string, collectionId?: string | null): Promise<{ item: any; collection: CbersCollectionConfig }> {
  assertCbersL4GenerationItem(itemId, collectionId);
  const first = inferCbersCollection(itemId, collectionId);
  const candidates = [
    first,
    ...CBERS_COLLECTIONS.filter((collection) => collection.collectionId !== first.collectionId),
  ];
  let lastError: unknown = null;
  for (const collection of candidates) {
    const url = `${STAC_ROOT}/collections/${encodeURIComponent(collection.collectionId)}/items/${encodeURIComponent(itemId)}`;
    try {
      return { item: await fetchJson<any>(url), collection };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Cena ${itemId} não encontrada no STAC CBERS.`);
}

export async function headContentLength(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!response.ok) return null;
    const value = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function estimateFallbackDownloadBytes(areaHa: number): number {
  void areaHa;
  return 3_000_000_000;
}

export async function estimateSceneAssets(args: {
  itemId: string;
  collectionId?: string | null;
  areaHa: number;
  scene?: CbersScene | null;
}): Promise<CbersEstimate> {
  const { item } = await getStacItem(args.itemId, args.collectionId || args.scene?.collectionId);
  const assets = item.assets || {};
  const assetSizes: Record<string, number | null> = {};
  for (const key of CBERS_REQUIRED_ASSETS) {
    const href = String(assets[key]?.href || "");
    assetSizes[key] = href ? await headContentLength(href) : null;
  }
  const completeAssetSizes = CBERS_REQUIRED_ASSETS.every((key) => Number.isFinite(assetSizes[key] || NaN));
  const knownBytes = Object.values(assetSizes).reduce<number>((acc, value) => acc + Number(value || 0), 0);
  const downloadBytes: number = completeAssetSizes
    ? knownBytes
    : Math.max(knownBytes, estimateFallbackDownloadBytes(args.areaHa));
  const panBytes = Number(assetSizes.BAND0 || 0);
  const outputBytesEstimated = Math.max(100_000_000, Math.round((panBytes || knownBytes || downloadBytes) * 0.75));
  const downloadMb = Number((downloadBytes / 1024 / 1024).toFixed(2));
  const outputMbEstimated = Number((outputBytesEstimated / 1024 / 1024).toFixed(2));
  return {
    downloadBytes,
    downloadMb,
    outputBytesEstimated,
    outputMbEstimated,
    timeSecondsEstimated: Math.max(30, Math.round(downloadMb / 8 + outputMbEstimated / 4 + 45)),
    completeAssetSizes,
    assetSizes,
  };
}
