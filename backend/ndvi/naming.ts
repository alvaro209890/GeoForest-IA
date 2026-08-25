/**
 * Nomes de arquivo, store e layer do NDVI.
 *
 * Convenção vinda da própria reunião de 31/07/2026 — "a órbita/ponto, o ano, o mês e o
 * dia, e a composição" (17:36) — e alinhada ao padrão já usado por CBERS e Landsat.
 *
 * ⚠️ Detecção de plataforma usa **lookaround, não `\b`**: `_` é caractere de palavra em
 * JS, então `\bl5\b` NUNCA casa em `..._l5_tm_...`. Esse bug já custou caro uma vez
 * (`backend/landsat/naming.ts`) — o ranqueamento premiou justamente a cena riscada.
 */

export function cleanLayerName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function safeSegment(value: unknown, fallback = "0"): string {
  const clean = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
  return clean || fallback;
}

/** Sufixo curto do job, para o acervo não sobrescrever. Igual ao CBERS. */
export function jobSuffix(jobId: string): string {
  return `J${String(jobId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
}

export type NdviPlatform = "LANDSAT_4" | "LANDSAT_5" | "LANDSAT_7" | "LANDSAT_8" | "LANDSAT_9" | "DESCONHECIDA";

const PLATFORM_LABELS: Record<NdviPlatform, string> = {
  LANDSAT_4: "Landsat 4 TM",
  LANDSAT_5: "Landsat 5 TM",
  LANDSAT_7: "Landsat 7 ETM+",
  LANDSAT_8: "Landsat 8 OLI",
  LANDSAT_9: "Landsat 9 OLI-2",
  DESCONHECIDA: "Plataforma não identificada",
};

/** Sigla curta usada no nome do arquivo. */
const PLATFORM_SHORT: Record<NdviPlatform, string> = {
  LANDSAT_4: "L4",
  LANDSAT_5: "L5",
  LANDSAT_7: "L7",
  LANDSAT_8: "L8",
  LANDSAT_9: "L9",
  DESCONHECIDA: "LX",
};

export function platformLabel(platform: NdviPlatform): string {
  return PLATFORM_LABELS[platform];
}

export function platformShort(platform: NdviPlatform): string {
  return PLATFORM_SHORT[platform];
}

/**
 * Detecta a plataforma a partir do id STAC ou de texto livre.
 * Ex.: `LT05_L2SP_224069_20080720_20200829_02_T1_SR` → LANDSAT_5
 */
export function platformFromText(value: unknown): NdviPlatform {
  const text = String(value || "").toLowerCase();
  if (!text) return "DESCONHECIDA";
  // ids STAC: LT04 LT05 LE07 LC08 LC09
  const stac = text.match(/\b(lt04|lt05|le07|lc08|lc09)/);
  if (stac) {
    const map: Record<string, NdviPlatform> = {
      lt04: "LANDSAT_4",
      lt05: "LANDSAT_5",
      le07: "LANDSAT_7",
      lc08: "LANDSAT_8",
      lc09: "LANDSAT_9",
    };
    return map[stac[1]];
  }
  // texto livre: "landsat-5", "landsat 8", "..._l7_etm_..."
  // lookaround em vez de \b, porque `_` é caractere de palavra
  const solto = text.match(/(?<![a-z0-9])(?:landsat[-_ ]?|l)([45789])(?![a-z0-9])/);
  if (solto) {
    const n = solto[1];
    if (n === "4") return "LANDSAT_4";
    if (n === "5") return "LANDSAT_5";
    if (n === "7") return "LANDSAT_7";
    if (n === "8") return "LANDSAT_8";
    if (n === "9") return "LANDSAT_9";
  }
  return "DESCONHECIDA";
}

/** Landsat 7 depois da falha do SLC (31/05/2003) tem faixas de vazio. */
export function isSlcOff(platform: NdviPlatform, acquiredAt: string): boolean {
  if (platform !== "LANDSAT_7") return false;
  const data = new Date(acquiredAt);
  if (Number.isNaN(data.getTime())) return false;
  return data.getTime() > Date.UTC(2003, 4, 31);
}

/** `LC08_L2SP_224069_20200907_...` → { path: "224", row: "069" } */
export function pathRowFromItemId(itemId: string): { path: string; row: string } | null {
  const m = String(itemId || "").match(/_(\d{3})(\d{3})_(\d{8})/);
  if (m) return { path: m[1], row: m[2] };
  const alt = String(itemId || "").match(/(?<![0-9])(\d{3})[_-](\d{3})(?![0-9])/);
  if (alt) return { path: alt[1], row: alt[2] };
  return null;
}

/** `LC08_L2SP_224069_20200907_...` → "20200907" */
export function dateCompactFromItemId(itemId: string): string | null {
  const m = String(itemId || "").match(/_\d{6}_(\d{8})_/);
  if (m) return m[1];
  const alt = String(itemId || "").match(/(?<![0-9])(20\d{6}|19\d{6})(?![0-9])/);
  return alt ? alt[1] : null;
}

/** "20080720" → "2008-07-20" */
export function isoFromCompact(compact: string): string | null {
  const m = String(compact || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export type NdviKind = "NDVI" | "RGB";

/**
 * `NDVI_224_069_20080720_L5_NDVI.TIF`
 * Com job: `NDVI_224_069_20080720_L5_NDVI_J47FA5471.TIF`
 */
export function buildNdviFilename(args: {
  path: string;
  row: string;
  dateCompact: string;
  platform: NdviPlatform;
  kind: NdviKind;
  jobId?: string | null;
}): string {
  const base = [
    "NDVI",
    safeSegment(args.path, "000"),
    safeSegment(args.row, "000"),
    safeSegment(args.dateCompact, "00000000"),
    platformShort(args.platform),
    args.kind,
  ].join("_");
  const suffix = args.jobId ? `_${jobSuffix(args.jobId)}` : "";
  return `${base}${suffix}.TIF`;
}

/** Nome do coveragestore/layer, minúsculo. Prefixo `ndvi_` separa do acervo Landsat. */
export function buildNdviStoreName(args: {
  path: string;
  row: string;
  year: string | number;
  filename: string;
}): string {
  const stem = String(args.filename).replace(/\.[^.]+$/, "");
  return cleanLayerName(`ndvi_${args.path}_${args.row}_${args.year}_${stem}`);
}

/** Órbita no formato usado pelos grupos do WMS: `224_069`. */
export function orbitKey(path: string, row: string): string {
  return `${safeSegment(path, "000")}_${safeSegment(row, "000")}`;
}
