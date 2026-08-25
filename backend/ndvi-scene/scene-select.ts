/**
 * Seleção de cena para a cena completa — reusa o ranqueamento do módulo NDVI
 * (`backend/ndvi/scene-select.ts`) e acrescenta a assinatura de TODAS as bandas
 * necessárias às composições (nir08, red, green, blue, swir16, qa_pixel).
 *
 * ⚠️ O token SAS do Planetary Computer **expira em ~1 h**. Assinar imediatamente
 * antes de usar; num job longo, reassinar antes de cada banda materializada.
 */
import type { Geometry } from "geojson";
import {
  searchCandidates,
  pickBest,
  toSceneRef,
  resolveAssetHrefs,
  signHref,
  seasonWindow,
  daysFromTarget,
  type NdviCandidate,
} from "../ndvi/scene-select";
import { allBandKeys } from "./compositions";
import { NdviSceneFailure } from "./errors";

export {
  searchCandidates,
  pickBest,
  toSceneRef,
  resolveAssetHrefs,
  seasonWindow,
  daysFromTarget,
};
export type { NdviCandidate };

const PC_STAC_ROOT = String(
  process.env.LANDSAT_PC_STAC_ROOT || "https://planetarycomputer.microsoft.com/api/stac/v1",
).replace(/\/+$/, "");
const PC_COLLECTION =
  process.env.NDVI_STAC_COLLECTION || process.env.LANDSAT_PC_COLLECTION || "landsat-c2-l2";
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.LANDSAT_FETCH_TIMEOUT_MS || 120000));

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`STAC ${url} respondeu ${res.status}.`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca o item STAC completo no Planetary Computer pela coleção Landsat C2 L2.
 * Falha declarada quando o item não existe.
 */
export async function getStacItem(itemId: string): Promise<{ item: any; collection: string }> {
  const url = `${PC_STAC_ROOT}/collections/${encodeURIComponent(PC_COLLECTION)}/items/${encodeURIComponent(itemId)}`;
  try {
    const item = await fetchJson<any>(url);
    if (!item?.id) throw new Error(`Item STAC sem id: ${itemId}`);
    return { item, collection: PC_COLLECTION };
  } catch (error) {
    throw new NdviSceneFailure(
      "cena_nao_encontrada",
      `Cena ${itemId} não encontrada no STAC do Planetary Computer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Todas as bandas que o pipeline de cena completa pode materializar. */
export const SCENE_BAND_KEYS = allBandKeys();

export type SceneBandHrefs = {
  nir08: string;
  red: string;
  green: string;
  blue: string;
  swir16: string;
  qa_pixel: string | null;
};

/**
 * Assina os hrefs de TODAS as bandas necessárias ao pipeline de cena completa.
 *
 * Landsat C2 L2 SR sempre traz blue, green, red, nir08 e swir16 (SR 16 bits), além
 * do qa_pixel. Se algum asset faltar (cena corrompida/parcial), declaramos falha
 * clara em vez de adivinhar.
 */
export async function resolveAllAssetHrefs(item: any): Promise<SceneBandHrefs> {
  const assets = item?.assets || {};
  const pegar = (chave: string): string | null => {
    const href = assets?.[chave]?.href;
    return href ? String(href) : null;
  };

  const obrigatorias = SCENE_BAND_KEYS.filter((key) => key !== "qa_pixel");
  const ausentes = obrigatorias.filter((key) => !pegar(key));
  if (ausentes.length > 0) {
    throw new NdviSceneFailure(
      "bandas_insuficientes",
      `A cena ${String(item?.id || "")} não traz as bandas ${ausentes.join(", ")}.`,
    );
  }

  const hrefs: SceneBandHrefs = {
    nir08: await signHref(pegar("nir08") as string),
    red: await signHref(pegar("red") as string),
    green: await signHref(pegar("green") as string),
    blue: await signHref(pegar("blue") as string),
    swir16: await signHref(pegar("swir16") as string),
    qa_pixel: null,
  };
  const qa = pegar("qa_pixel");
  if (qa) hrefs.qa_pixel = await signHref(qa);
  return hrefs;
}
