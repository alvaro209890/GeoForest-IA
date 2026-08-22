/**
 * Convenções de nomes: datas, plataforma, composição, camadas WMS e IDs STAC.
 */
import path from "node:path";
import { LandsatComposition } from "./types";
import { safeName } from "./utils";

export function parseDateCompact(value: string): string {
  const clean = String(value || "");
  const compact = clean.match(/(20\d{2}|19\d{2})(\d{2})(\d{2})/)?.[0];
  if (compact) return compact;
  const separated = clean.match(/(20\d{2}|19\d{2})[_-](\d{2})[_-](\d{2})/);
  return separated ? `${separated[1]}${separated[2]}${separated[3]}` : "";
}

export function isoFromDateCompact(dateCompact: string): string {
  if (!/^\d{8}$/.test(dateCompact)) return "";
  const iso = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}T00:00:00Z`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : "";
}

/**
 * ⚠️ Os limites usam lookaround, não `\b`.
 *
 * `_` é caractere de palavra em JS, então `\bl7\b` **nunca** casa em
 * `landsat_224_069_2003_l7_etm_...` — que é exatamente como o GeoServer da casa
 * nomeia as camadas. O efeito era todo o acervo voltar com plataforma
 * indefinida, e a escolha de cena do laudo acabou premiando uma cena Landsat 7
 * pós-falha do SLC (com faixas de vazio) por ela estar mais perto do 22/07.
 */
export function platformFromText(value: string): string | undefined {
  const text = String(value || "").toLowerCase();
  if (/lc09|landsat[_\s-]*9|(?<![a-z0-9])l9(?![a-z0-9])/.test(text)) return "landsat-9";
  if (/lc08|landsat[_\s-]*8|(?<![a-z0-9])l8(?![a-z0-9])|lo8/.test(text)) return "landsat-8";
  if (/le07|landsat[_\s-]*7|(?<![a-z0-9])l7(?![a-z0-9])/.test(text)) return "landsat-7";
  if (/lt05|landsat[_\s-]*5|lc[_\s-]+5|(?<![a-z0-9])l5(?![a-z0-9])|lt5/.test(text)) return "landsat-5";
  return undefined;
}

export function compositionFromText(value: string, fallback: LandsatComposition = "false_color"): LandsatComposition {
  const text = String(value || "").toLowerCase();
  if (/c(?:omp)?(?:432|321)|band3_2_1|b4_3_2/.test(text)) return "natural_color";
  if (/c(?:omp)?(?:654|543)|band5_4_3|b6_5_4/.test(text)) return "false_color";
  return fallback;
}

export function compositionLabel(platform: string | undefined, composition: LandsatComposition): string {
  const isOli = platform === "landsat-8" || platform === "landsat-9";
  if (composition === "natural_color") return isOli ? "C432" : "C321";
  return isOli ? "C654" : "C543";
}

export function parseLandsatLayerName(layerName: string): {
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
  composition: LandsatComposition;
  compositionLabel: string;
} | null {
  const name = safeName(layerName).toLowerCase();
  const match = name.match(/^landsat_(\d{3})_(\d{3})_(\d{4})_(.+)$/);
  if (!match) return null;
  const platform = platformFromText(name);
  const composition = compositionFromText(name);
  return {
    path: match[1],
    row: match[2],
    orbit: `${match[1]}_${match[2]}`,
    year: match[3],
    date: parseDateCompact(name),
    platform,
    composition,
    compositionLabel: compositionLabel(platform, composition),
  };
}

export function parseLandsatStacId(itemId: string): {
  path: string;
  row: string;
  orbit: string;
  year: string;
  date: string;
  platform?: string;
} | null {
  const id = String(itemId || "").trim();
  const match = id.match(/_(\d{3})(\d{3})_(\d{8})_/);
  if (!match) return null;
  return {
    path: match[1],
    row: match[2],
    orbit: `${match[1]}_${match[2]}`,
    year: match[3].slice(0, 4),
    date: match[3],
    platform: platformFromText(id),
  };
}

export function landsatAssetKeysForComposition(composition: LandsatComposition): [string, string, string] {
  return composition === "natural_color"
    ? ["red", "green", "blue"]
    : ["swir16", "nir08", "red"];
}

export function buildLandsatOutputFilename(itemId: string, composition: LandsatComposition): string {
  const parsed = parseLandsatStacId(itemId);
  const label = compositionLabel(parsed?.platform, composition);
  return `${safeName(itemId.replace(/_SR$/i, ""), "LANDSAT")}_${label}.TIF`;
}

export function planetaryComputerItemIdFromLandsatId(itemId: string): string {
  const id = String(itemId || "").trim();
  const match = id.match(/^([A-Z0-9]+_L2SP_\d{6}_\d{8})_\d{8}_(\d{2}_T[12])(?:_(?:SR|ST))?$/i);
  if (match) return `${match[1]}_${match[2]}`;
  return id.replace(/_(?:SR|ST)$/i, "");
}
