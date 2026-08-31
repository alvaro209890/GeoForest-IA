/**
 * Escolha da cena Landsat C2 L2 SR para o NDVI.
 *
 * Ranqueamento vindo da reunião (R7: "a melhor imagem, que é a que tem menos nuvem",
 * 15:42) e do critério já usado pelo acervo local — data mais próxima de 22/07, o marco
 * legal e o miolo da seca em MT.
 *
 * ⚠️ Usamos o STAC do **Planetary Computer**, não o do USGS e não o
 * `config/acervo-landsat.json`.
 *  - O `landsatlook.usgs.gov` devolve **302 para `ers.cr.usgs.gov`** nos assets: exige
 *    login ERS, então `/vsicurl/` não abre (medido no servidor em 25/08/2026).
 *  - O acervo local tem cenas deslocadas (até 4,3 km medidos) e o bbox não detecta
 *    desvio de 30–300 m; as cenas C2 L2 vêm ortorretificadas da origem.
 * O PC serve os mesmos GeoTIFF em Azure Blob e assina por SAS — validado com
 * `gdalinfo /vsicurl/<href>?<token>` numa cena real de 2008.
 */
import "../proj-defs";
import { bbox as turfBbox, booleanPointInPolygon, centroid } from "@turf/turf";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { NDVI_MAX_CLOUD_PCT, NDVI_SEASON_END, NDVI_SEASON_START, NDVI_TARGET_MONTH_DAY } from "./constants";
import {
  dateCompactFromItemId,
  isoFromCompact,
  isSlcOff,
  pathRowFromItemId,
  platformFromText,
  platformLabel,
  type NdviPlatform,
} from "./naming";
import { NdviFailure, type NdviSceneRef } from "./types";
import { fetchJsonWithTimeout } from "../lib/http";

const PC_STAC_ROOT = String(
  process.env.LANDSAT_PC_STAC_ROOT || "https://planetarycomputer.microsoft.com/api/stac/v1",
).replace(/\/+$/, "");
const PC_COLLECTION =
  process.env.NDVI_STAC_COLLECTION || process.env.LANDSAT_PC_COLLECTION || "landsat-c2-l2";
const PC_SIGN_ROOT = String(
  process.env.LANDSAT_PC_SIGN_ROOT || "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
).replace(/\/+$/, "");
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.LANDSAT_FETCH_TIMEOUT_MS || 120000));

export type NdviCandidate = {
  itemId: string;
  item: any;
  platform: NdviPlatform;
  acquiredAt: string;
  cloudCoverPct: number | null;
  path: string;
  row: string;
  slcOff: boolean;
  cobreImovel: boolean;
  score: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetchJsonWithTimeout<T>(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    init,
    httpError: ({ status }) => `STAC ${url} respondeu ${status}.`,
  });
}

/** Janela sazonal do ano: miolo da seca, onde a resposta espectral é comparável. */
export function seasonWindow(year: number): { start: string; end: string } {
  return { start: `${year}-${NDVI_SEASON_START}`, end: `${year}-${NDVI_SEASON_END}` };
}

/** Distância em dias até 22/07 do próprio ano. */
export function daysFromTarget(acquiredAt: string): number {
  const data = new Date(acquiredAt);
  if (Number.isNaN(data.getTime())) return 9999;
  const [mes, dia] = NDVI_TARGET_MONTH_DAY.split("-").map(Number);
  const alvo = new Date(Date.UTC(data.getUTCFullYear(), mes - 1, dia));
  return Math.abs((data.getTime() - alvo.getTime()) / 86_400_000);
}

/**
 * Score: menor é melhor.
 *   +1000  cena que não cobre o imóvel inteiro
 *   +500   Landsat 7 pós-SLC-off (faixas de vazio)
 *   +nuvem em %
 *   +dias/10 de distância do 22/07
 */
export function scoreCandidate(c: Omit<NdviCandidate, "score">): number {
  let score = 0;
  if (!c.cobreImovel) score += 1000;
  if (c.slcOff) score += 500;
  score += c.cloudCoverPct === null ? 25 : c.cloudCoverPct;
  score += daysFromTarget(c.acquiredAt) / 10;
  return score;
}

function geometryContemPonto(footprint: Geometry | null, ponto: [number, number]): boolean {
  if (!footprint) return false;
  try {
    return booleanPointInPolygon(ponto, footprint as Polygon | MultiPolygon);
  } catch {
    return false;
  }
}

/** Cobertura aproximada: o footprint contém o centroide e os 4 cantos do bbox do imóvel. */
export function cobreImovel(footprint: Geometry | null, imovel: Geometry): boolean {
  if (!footprint) return false;
  try {
    const [minX, minY, maxX, maxY] = turfBbox(imovel as any);
    const cantos: Array<[number, number]> = [
      [minX, minY],
      [minX, maxY],
      [maxX, minY],
      [maxX, maxY],
    ];
    const c = centroid(imovel as any).geometry.coordinates as [number, number];
    return [c, ...cantos].every((p) => geometryContemPonto(footprint, p));
  } catch {
    return false;
  }
}

export async function searchCandidates(args: {
  geometry: Geometry;
  year: number;
}): Promise<NdviCandidate[]> {
  const [minX, minY, maxX, maxY] = turfBbox(args.geometry as any);
  const janela = seasonWindow(args.year);
  const corpo = {
    collections: [PC_COLLECTION],
    bbox: [minX, minY, maxX, maxY],
    datetime: `${janela.start}T00:00:00Z/${janela.end}T23:59:59Z`,
    limit: 50,
  };
  const resposta = await fetchJson<any>(`${PC_STAC_ROOT}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  const feats: any[] = Array.isArray(resposta?.features) ? resposta.features : [];
  const candidatos: NdviCandidate[] = [];
  for (const item of feats) {
    const itemId = String(item?.id || "");
    if (!itemId) continue;
    const wrsPath = String(item?.properties?.["landsat:wrs_path"] || "").padStart(3, "0");
    const wrsRow = String(item?.properties?.["landsat:wrs_row"] || "").padStart(3, "0");
    const pr =
      wrsPath !== "000" && wrsRow !== "000"
        ? { path: wrsPath, row: wrsRow }
        : pathRowFromItemId(itemId);
    if (!pr) continue;
    if (!pr.path || !pr.row) continue;

    const compact = dateCompactFromItemId(itemId);
    const acquiredAt =
      String(item?.properties?.datetime || "").slice(0, 10) ||
      (compact ? isoFromCompact(compact) : null) ||
      "";
    if (!acquiredAt) continue;

    const platform = platformFromText(itemId || item?.properties?.platform);
    const nuvemBruta = item?.properties?.["eo:cloud_cover"];
    const cloudCoverPct = Number.isFinite(Number(nuvemBruta)) ? Number(nuvemBruta) : null;

    const parcial: Omit<NdviCandidate, "score"> = {
      itemId,
      item,
      platform,
      acquiredAt,
      cloudCoverPct,
      path: pr.path,
      row: pr.row,
      slcOff: isSlcOff(platform, acquiredAt),
      cobreImovel: cobreImovel(item?.geometry || null, args.geometry),
    };
    candidatos.push({ ...parcial, score: scoreCandidate(parcial) });
  }
  return candidatos.sort((a, b) => a.score - b.score);
}

/**
 * Descarta o que é nuvem demais e devolve a melhor. Falha declarando quando não há.
 *
 * Ordena por conta própria em vez de confiar na ordem do chamador — uma função chamada
 * `pickBest` que devolve o primeiro item de um vetor desordenado é uma armadilha.
 *
 * Quando TODAS passam do teto de nuvem, ainda devolvemos a melhor: quem decide se a
 * medida presta é o `validPct` por feição, medido no pixel, não a nuvem declarada da
 * cena inteira. Medimos ao vivo uma cena de 13% de nuvem global que tinha ~70% de
 * nuvem sobre o polígono analisado.
 */
export function pickBest(candidatos: NdviCandidate[]): NdviCandidate {
  const porScore = [...candidatos].sort((a, b) => a.score - b.score);
  const aceitaveis = porScore.filter(
    (c) => c.cloudCoverPct === null || c.cloudCoverPct <= NDVI_MAX_CLOUD_PCT,
  );
  const melhor = (aceitaveis.length > 0 ? aceitaveis : porScore)[0];
  if (!melhor) throw new NdviFailure("sem_cena_nir");
  return melhor;
}

export function toSceneRef(c: NdviCandidate): NdviSceneRef {
  return {
    itemId: c.itemId,
    collection: PC_COLLECTION,
    platform: c.platform,
    platformLabel: platformLabel(c.platform),
    path: c.path,
    row: c.row,
    acquiredAt: c.acquiredAt,
    year: Number(String(c.acquiredAt).slice(0, 4)) || 0,
    cloudCoverPct: c.cloudCoverPct,
    epsg: null,
    coberturaParcial: !c.cobreImovel,
    sensorDegradado: c.slcOff,
  };
}

/** Assina um href do Azure Blob pelo serviço SAS do Planetary Computer. */
export async function signHref(href: string): Promise<string> {
  if (!/blob\.core\.windows\.net/i.test(href)) return href;
  if (/[?&]sig=/i.test(href)) return href;
  const resposta = await fetchJson<{ href?: string; token?: string }>(
    `${PC_SIGN_ROOT}?href=${encodeURIComponent(href)}`,
  );
  if (resposta?.href) return resposta.href;
  if (resposta?.token) return `${href}?${resposta.token}`;
  return href;
}

/**
 * URLs assinadas dos três assets do NDVI.
 *
 * ⚠️ O token SAS **expira em ~1 h**. Assinar imediatamente antes de usar; num job longo,
 * reassinar antes de cada banda.
 */
export async function resolveAssetHrefs(item: any): Promise<{
  nir08: string;
  red: string;
  qa_pixel: string | null;
}> {
  const assets = item?.assets || {};
  const pegar = (chave: string): string | null => {
    const href = assets?.[chave]?.href;
    return href ? String(href) : null;
  };
  const nir08 = pegar("nir08");
  const red = pegar("red");
  if (!nir08 || !red) throw new NdviFailure("fonte_sem_reflectancia");
  const qa = pegar("qa_pixel");
  return {
    nir08: await signHref(nir08),
    red: await signHref(red),
    qa_pixel: qa ? await signHref(qa) : null,
  };
}
