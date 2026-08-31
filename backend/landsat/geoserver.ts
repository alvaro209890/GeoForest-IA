/**
 * Publicação no GeoServer: árvore de layer groups, store, camada e verificação do WMS.
 */
import { GEOSERVER_BASE_URL, GEOSERVER_LANDSAT_STYLE, GEOSERVER_PASSWORD, GEOSERVER_PUBLIC_WMS_BASE, GEOSERVER_USER, GEOSERVER_WORKSPACE, ROOT_LANDSAT_GROUP, ROOT_RASTER_GROUP } from "./constants";
import { readLocalLandsatRecords } from "./local-archive";
import { PlainObject } from "./types";
import { firstFiniteNumber, safeName, xmlValue } from "./utils";
import { asArray, xmlEscape } from "../lib/http";

export { asArray, xmlEscape } from "../lib/http";

export function publicWmsCapabilitiesUrl(): string {
  return `${GEOSERVER_PUBLIC_WMS_BASE.replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

export function wmsDownloadPathForLayer(layerName: string): string {
  return `/api/landsat/wms-download?layerName=${encodeURIComponent(layerName)}`;
}

export function authHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
}


export function decodeGeoserverFileUrl(rawUrl: string): string {
  const raw = String(rawUrl || "").trim().replace(/^file:/i, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw.replace(/%20/g, " ");
  }
}


export function parseBboxFromCoverageXml(xml: string): [number, number, number, number] | null {
  const block = String(xml.match(/<latLonBoundingBox>([\s\S]*?)<\/latLonBoundingBox>/i)?.[1] || "");
  const minx = firstFiniteNumber(xmlValue(block, "minx"));
  const miny = firstFiniteNumber(xmlValue(block, "miny"));
  const maxx = firstFiniteNumber(xmlValue(block, "maxx"));
  const maxy = firstFiniteNumber(xmlValue(block, "maxy"));
  if ([minx, miny, maxx, maxy].some((item) => item === null)) return null;
  if (!(Number(maxx) > Number(minx)) || !(Number(maxy) > Number(miny))) return null;
  return [Number(minx), Number(miny), Number(maxx), Number(maxy)];
}


export type LayerGroupUpsert = {
  name: string;
  title: string;
  publishable: PlainObject;
  style: PlainObject | string;
};

export function landsatLayerGroupNames(orbit: string, year: string): {
  rasterGroup: string;
  rootGroup: string;
  orbitGroup: string;
  yearGroup: string;
} {
  return {
    rasterGroup: ROOT_RASTER_GROUP,
    rootGroup: ROOT_LANDSAT_GROUP,
    orbitGroup: `landsat_orbit_${safeName(orbit, "000_000")}`,
    yearGroup: `landsat_orbit_${safeName(orbit, "000_000")}_y${safeName(year, "0000")}`,
  };
}

export function buildLandsatLayerGroupHierarchy(args: {
  storeName: string;
  orbit: string;
  year: string;
}): LayerGroupUpsert[] {
  const names = landsatLayerGroupNames(args.orbit, args.year);
  return [
    {
      name: names.yearGroup,
      title: args.year,
      publishable: {
        "@type": "layer",
        name: `${GEOSERVER_WORKSPACE}:${args.storeName}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layers/${args.storeName}.json`,
      },
      style: { name: GEOSERVER_LANDSAT_STYLE, href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_LANDSAT_STYLE}.json` },
    },
    {
      name: names.orbitGroup,
      title: args.orbit,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.yearGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.yearGroup}.json`,
      },
      style: "",
    },
    {
      name: names.rootGroup,
      title: names.rootGroup,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.orbitGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.orbitGroup}.json`,
      },
      style: "",
    },
    {
      name: names.rasterGroup,
      title: names.rasterGroup,
      publishable: {
        "@type": "layerGroup",
        name: `${GEOSERVER_WORKSPACE}:${names.rootGroup}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${names.rootGroup}.json`,
      },
      style: "",
    },
  ];
}

export async function geoserverFetch(restPath: string, options: RequestInit = {}): Promise<globalThis.Response> {
  return await fetch(`${GEOSERVER_BASE_URL}${restPath}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      ...(options.headers || {}),
    },
  }) as globalThis.Response;
}

export async function geoserverJson(restPath: string): Promise<PlainObject | null> {
  const response = await geoserverFetch(restPath, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GeoServer GET ${restPath} falhou: ${response.status}`);
  return await response.json() as PlainObject;
}

export async function geoserverWrite(restPath: string, method: "POST" | "PUT", body?: string, contentType?: string): Promise<void> {
  const response = await geoserverFetch(restPath, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if ([200, 201, 202, 204, 409].includes(response.status)) return;
  const text = await response.text().catch(() => "");
  throw new Error(`GeoServer ${method} ${restPath} falhou: ${response.status} ${text.slice(0, 300)}`);
}

export function groupPublished(payload: PlainObject | null): PlainObject[] {
  return asArray(payload?.layerGroup?.publishables?.published);
}

export function groupStyles(payload: PlainObject | null): any[] {
  return asArray(payload?.layerGroup?.styles?.style);
}

export async function upsertLayerGroup(args: LayerGroupUpsert): Promise<void> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}.json`,
  );
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const alreadyAt = currentPublished.findIndex((item) => String(item?.name || "") === args.publishable.name);
  const published = alreadyAt >= 0 ? currentPublished : [...currentPublished, args.publishable];
  const styles = alreadyAt >= 0 ? currentStyles : [...currentStyles, args.style];
  const body = JSON.stringify({
    layerGroup: {
      name: args.name,
      mode: "NAMED",
      title: args.title,
      enabled: true,
      advertised: true,
      workspace: { name: GEOSERVER_WORKSPACE },
      publishables: { published },
      styles: { style: styles },
    },
  });
  if (existing) {
    await geoserverWrite(
      `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(args.name)}`,
      "PUT",
      body,
      "application/json",
    );
  } else {
    await geoserverWrite(`/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups`, "POST", body, "application/json");
  }
}

export async function removeDirectLayersFromLayerGroup(groupName: string): Promise<number> {
  const existing = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}.json`,
  );
  if (!existing?.layerGroup) return 0;
  const currentPublished = groupPublished(existing);
  const currentStyles = groupStyles(existing);
  const published: PlainObject[] = [];
  const styles: any[] = [];
  let removed = 0;
  currentPublished.forEach((item, index) => {
    if (String(item?.["@type"] || "").toLowerCase() === "layer") {
      removed += 1;
      return;
    }
    published.push(item);
    styles.push(currentStyles[index] ?? "");
  });
  if (!removed) return 0;
  const previous = existing.layerGroup;
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/layergroups/${encodeURIComponent(groupName)}`,
    "PUT",
    JSON.stringify({
      layerGroup: {
        name: groupName,
        mode: previous.mode || "NAMED",
        title: previous.title || groupName,
        enabled: previous.enabled !== false,
        advertised: previous.advertised !== false,
        workspace: { name: GEOSERVER_WORKSPACE },
        publishables: { published },
        styles: { style: styles },
      },
    }),
    "application/json",
  );
  return removed;
}

export async function repairLandsatWmsTree(): Promise<{ records: number; directLayersRemoved: number }> {
  const records = readLocalLandsatRecords();
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.storeName}:${record.orbit}:${record.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const group of buildLandsatLayerGroupHierarchy({
      storeName: record.storeName,
      orbit: record.orbit,
      year: record.year,
    })) {
      await upsertLayerGroup(group);
    }
  }
  const directLayersRemoved = await removeDirectLayersFromLayerGroup(ROOT_LANDSAT_GROUP);
  return { records: seen.size, directLayersRemoved };
}

export async function publishLandsatGeoTiff(args: {
  storeName: string;
  title: string;
  hdPath: string;
  orbit: string;
  year: string;
}): Promise<void> {
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores`,
    "POST",
    `<coverageStore><name>${xmlEscape(args.storeName)}</name><type>GeoTIFF</type><enabled>true</enabled><workspace><name>${xmlEscape(GEOSERVER_WORKSPACE)}</name></workspace></coverageStore>`,
    "application/xml",
  );
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/external.geotiff` +
      `?configure=first&coverageName=${encodeURIComponent(args.storeName)}&recalculate=nativebbox,latlonbbox`,
    "PUT",
    args.hdPath,
    "text/plain",
  );
  await geoserverWrite(
    `/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({
      layer: {
        enabled: true,
        advertised: true,
        defaultStyle: {
          name: GEOSERVER_LANDSAT_STYLE,
          href: `${GEOSERVER_BASE_URL}/rest/styles/${GEOSERVER_LANDSAT_STYLE}.json`,
        },
      },
    }),
    "application/json",
  );
  await geoserverWrite(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(args.storeName)}/coverages/${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({ coverage: { title: args.title, enabled: true } }),
    "application/json",
  );
  for (const group of buildLandsatLayerGroupHierarchy(args)) {
    await upsertLayerGroup(group);
  }
  await removeDirectLayersFromLayerGroup(ROOT_LANDSAT_GROUP);
  await verifyLandsatWmsPublication(args.storeName);
}

export async function verifyLandsatWmsPublication(storeName: string): Promise<void> {
  const layer = await geoserverJson(`/rest/layers/${GEOSERVER_WORKSPACE}:${encodeURIComponent(storeName)}.json`);
  if (!layer?.layer) throw new Error(`GeoServer não retornou a layer Landsat ${GEOSERVER_WORKSPACE}:${storeName}.`);
  const coverage = await geoserverJson(
    `/rest/workspaces/${GEOSERVER_WORKSPACE}/coveragestores/${encodeURIComponent(storeName)}/coverages/${encodeURIComponent(storeName)}.json`,
  );
  const bbox = coverage?.coverage?.latLonBoundingBox || coverage?.coverage?.nativeBoundingBox || {};
  const minx = firstFiniteNumber(bbox.minx, bbox.minX);
  const miny = firstFiniteNumber(bbox.miny, bbox.minY);
  const maxx = firstFiniteNumber(bbox.maxx, bbox.maxX);
  const maxy = firstFiniteNumber(bbox.maxy, bbox.maxY);
  if ([minx, miny, maxx, maxy].some((value) => value === null)) throw new Error(`GeoServer não retornou bbox para ${storeName}.`);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: `${GEOSERVER_WORKSPACE}:${storeName}`,
    styles: "",
    srs: "EPSG:4326",
    bbox: `${minx},${miny},${maxx},${maxy}`,
    width: "64",
    height: "64",
    format: "image/png",
    transparent: "true",
  });
  const response = await fetch(`${GEOSERVER_BASE_URL}/${GEOSERVER_WORKSPACE}/wms?${params.toString()}`, {
    headers: { Authorization: authHeader() },
  }) as globalThis.Response;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer()).length;
  if (!response.ok || !contentType.startsWith("image/") || bytes < 100) {
    throw new Error(`WMS GetMap Landsat não validou ${storeName}: ${response.status} ${contentType} ${bytes}`);
  }
}
