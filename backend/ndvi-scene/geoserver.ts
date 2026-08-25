/**
 * Publicação da cena completa no GeoServer.
 *
 * - `ensureNdfiStyle()` cria/atualiza o estilo `ndfi_ramp` (molde do
 *   `ensureNdviStyle` de `backend/ndvi/geoserver.ts`).
 * - `publishCompositionLayer()` chama `publishNdviGeoTiff` (do módulo NDVI) com
 *   storeName/layerName/estilo da composição e valida a publicação.
 *
 * A hierarquia de grupos (`RASTER → NDVI → ndvi_orbit_<path>_<row> → ..._y<ano>`)
 * é a mesma do NDVI pós-recorte — cada composição entra como um layer irmão.
 */
import fs from "node:fs";
import {
  authHeader,
  ensureNdviStyle,
  publishNdviGeoTiff,
  verifyNdviWmsPublication,
} from "../ndvi/geoserver";
import { GEOSERVER_WORKSPACE } from "../ndvi/constants";
import {
  GEOSERVER_NDFI_STYLE,
  GEOSERVER_NDVI_STYLE,
  GEOSERVER_PUBLIC_WMS_BASE,
  GEOSERVER_RASTER_STYLE,
  GEOSERVER_SAVI_STYLE,
  NDFI_SLD_PATH,
  SAVI_SLD_PATH,
} from "./constants";
import type { NdviSceneComposition } from "./constants";
import type { NdviSceneCompositionState } from "./types";

/** Reexporta utilitários do módulo NDVI (sem reimplementar). */
export {
  authHeader,
  ensureNdviStyle,
  publishNdviGeoTiff,
  verifyNdviWmsPublication,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function geoserverFetch(restPath: string, options: RequestInit = {}): Promise<Response> {
  const base = String(
    process.env.GEOSERVER_BASE_URL || "http://127.0.0.1:8081/geoserver",
  ).replace(/\/+$/, "");
  const res = await fetch(`${base}${restPath}`, {
    ...options,
    headers: { Authorization: authHeader(), ...(options.headers || {}) },
  });
  return res;
}

/**
 * Cria ou atualiza o estilo `ndfi_ramp` a partir do SLD versionado
 * (`config/geoserver-styles/ndfi_ramp.sld`). Molde do `ensureNdviStyle`.
 */
export async function ensureNdfiStyle(): Promise<"created" | "updated"> {
  const sld = fs.readFileSync(NDFI_SLD_PATH, "utf8");
  const estilo = encodeURIComponent(GEOSERVER_NDFI_STYLE);
  const existente = await geoserverFetch(`/rest/styles/${estilo}.json`);
  if (existente.status === 404) {
    const res = await geoserverFetch(
      `/rest/styles?name=${estilo}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/vnd.ogc.sld+xml" },
        body: sld,
      },
    );
    if (![200, 201, 202, 204].includes(res.status)) {
      throw new Error(`Falha ao criar estilo ${GEOSERVER_NDFI_STYLE}: ${res.status}`);
    }
    return "created";
  }
  if (!existente.ok) {
    throw new Error(`Falha ao ler estilo ${GEOSERVER_NDFI_STYLE}: ${existente.status}`);
  }
  const res = await geoserverFetch(
    `/rest/styles/${estilo}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.ogc.sld+xml" },
      body: sld,
    },
  );
  if (![200, 201, 202, 204].includes(res.status)) {
    throw new Error(`Falha ao atualizar estilo ${GEOSERVER_NDFI_STYLE}: ${res.status}`);
  }
  return "updated";
}

/** Estilo GeoServer da composição (fonte: metadados das composições). */
export function styleNameForComposition(comp: NdviSceneComposition): string {
  switch (comp) {
    case "NDVI":
      return GEOSERVER_NDVI_STYLE;
    case "NDFI":
      return GEOSERVER_NDFI_STYLE;
    case "SAVI":
      return GEOSERVER_SAVI_STYLE;
    case "RGB":
    case "SWIR":
      return GEOSERVER_RASTER_STYLE;
  }
}

/**
 * Garante que o estilo necessário à composição exista no GeoServer.
 * NDVI → `ensureNdviStyle` (módulo NDVI); NDFI → `ensureNdfiStyle`; SAVI → `ensureSaviStyle`.
 */
export async function ensureStyleForComposition(comp: NdviSceneComposition): Promise<void> {
  if (comp === "NDVI") {
    await ensureNdviStyle();
    return;
  }
  if (comp === "NDFI") {
    await ensureNdfiStyle();
    return;
  }
  if (comp === "SAVI") {
    await ensureSaviStyle();
  }
}

/**
 * Cria ou atualiza o estilo `savi_ramp` a partir do SLD versionado
 * (`config/geoserver-styles/savi_ramp.sld`). Mesmo molde do `ensureNdfiStyle`.
 */
export async function ensureSaviStyle(): Promise<"created" | "updated"> {
  const sld = fs.readFileSync(SAVI_SLD_PATH, "utf8");
  const estilo = encodeURIComponent(GEOSERVER_SAVI_STYLE);
  const existente = await geoserverFetch(`/rest/styles/${estilo}.json`);
  if (existente.status === 404) {
    const res = await geoserverFetch(
      `/rest/styles?name=${estilo}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/vnd.ogc.sld+xml" },
        body: sld,
      },
    );
    if (![200, 201, 202, 204].includes(res.status)) {
      throw new Error(`Falha ao criar estilo ${GEOSERVER_SAVI_STYLE}: ${res.status}`);
    }
    return "created";
  }
  if (!existente.ok) {
    throw new Error(`Falha ao ler estilo ${GEOSERVER_SAVI_STYLE}: ${existente.status}`);
  }
  const res = await geoserverFetch(
    `/rest/styles/${estilo}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.ogc.sld+xml" },
      body: sld,
    },
  );
  if (![200, 201, 202, 204].includes(res.status)) {
    throw new Error(`Falha ao atualizar estilo ${GEOSERVER_SAVI_STYLE}: ${res.status}`);
  }
  return "updated";
}

/** URL pública de capabilities WMS (fonte: backend/ndvi/constants). */
export function publicWmsUrl(): string {
  return `${String(GEOSERVER_PUBLIC_WMS_BASE).replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

/**
 * Publica o GeoTIFF RGB 8 bits de uma composição via `publishNdviGeoTiff` (módulo NDVI)
 * e devolve o estado da composição com os nomes de store/layer.
 */
export async function publishCompositionLayer(args: {
  uid: string;
  jobId: string;
  comp: NdviSceneComposition;
  storeName: string;
  title: string;
  hdPath: string;
  path: string;
  row: string;
  year: string | number;
  archiveFilename: string;
  bytes: number;
}): Promise<NdviSceneCompositionState> {
  const styleName = styleNameForComposition(args.comp);
  await ensureStyleForComposition(args.comp);
  await publishNdviGeoTiff({
    storeName: args.storeName,
    title: args.title,
    hdPath: args.hdPath,
    path: args.path,
    row: args.row,
    year: args.year,
    styleName,
  });
  // Validação extra: GetMap com o estilo certo (mesma checagem do NDVI).
  await verifyNdviWmsPublication(args.storeName);

  const now = new Date().toISOString();
  return {
    composition: args.comp,
    status: "completed",
    stage: "completed",
    percent: 100,
    message: `Composição ${args.comp} publicada no WMS.`,
    archiveFilename: args.archiveFilename,
    archiveHdPath: args.hdPath,
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${args.storeName}`,
    wmsStoreName: args.storeName,
    wmsUrl: publicWmsUrl(),
    bytes: args.bytes,
    completedAt: now,
  };
}

// Mantém `sleep` utilizável fora (paridade com o módulo NDVI).
export { sleep };
