/**
 * A conta do NDVI e a expressão passada ao `gdal_calc.py`.
 *
 * ⚠️ **A armadilha desta feature mora aqui.** Landsat Collection 2 Level-2 entrega
 * reflectância como inteiro escalado: `ρ = DN * a + b`, com `a = 0.0000275` e
 * `b = -0.2`. O instinto é dizer "NDVI é razão, a escala cancela". O **fator** cancela;
 * o **offset não**:
 *
 *     ρn - ρr = a*(DNn - DNr)                 ← b cancela
 *     ρn + ρr = a*(DNn + DNr) + 2b            ← b NÃO cancela
 *
 * Como `b = -0.2` é grande perto das reflectâncias típicas (0,02–0,45), o erro varia
 * com o brilho da cena — erra mais em uns polígonos que em outros, e nada denuncia na
 * saída. Converter para reflectância SEMPRE antes de dividir.
 *
 * `ndviFromDn` × `ndviFromDnWrong` existem lado a lado de propósito: o teste exige que
 * as duas difiram, para que ninguém "simplifique" a expressão de volta ao bug.
 */
import { NDVI_QA_CIRRUS_BIT, NDVI_QA_MASK_BITS_BASE, NDVI_NODATA, NDVI_SR_OFFSET, NDVI_SR_SCALE } from "./constants";

/** Faixa válida do DN em C2 L2 SR; fora disso é saturação ou artefato. */
export const SR_VALID_MIN = 7273;
export const SR_VALID_MAX = 43636;

/** DN → reflectância de superfície. */
export function dnToReflectance(dn: number, scale = NDVI_SR_SCALE, offset = NDVI_SR_OFFSET): number {
  return dn * scale + offset;
}

/** NDVI a partir de reflectâncias já convertidas. */
export function ndviFromReflectance(nir: number, red: number): number | null {
  const denom = nir + red;
  if (!Number.isFinite(denom) || denom === 0) return null;
  const value = (nir - red) / denom;
  if (!Number.isFinite(value)) return null;
  return value;
}

/** O caminho correto: DN → reflectância → NDVI. */
export function ndviFromDn(
  dnNir: number,
  dnRed: number,
  scale = NDVI_SR_SCALE,
  offset = NDVI_SR_OFFSET,
): number | null {
  if (!Number.isFinite(dnNir) || !Number.isFinite(dnRed)) return null;
  if (dnNir <= 0 || dnRed <= 0) return null;
  return ndviFromReflectance(dnToReflectance(dnNir, scale, offset), dnToReflectance(dnRed, scale, offset));
}

/**
 * O caminho ERRADO — razão direta no DN cru, sem aplicar o offset.
 * Só existe para o teste provar que difere de `ndviFromDn`. Nunca usar em produção.
 */
export function ndviFromDnWrong(dnNir: number, dnRed: number): number | null {
  const denom = dnNir + dnRed;
  if (!Number.isFinite(denom) || denom === 0) return null;
  return (dnNir - dnRed) / denom;
}

/** Máscara de QA da plataforma: L8/L9 têm cirrus (bit 2), os antigos não. */
export function qaMaskForPlatform(platform: string | null | undefined): number {
  const text = String(platform || "").toLowerCase();
  const temCirrus = /landsat[-_ ]?(8|9)|lc0?[89]/.test(text);
  return temCirrus ? NDVI_QA_MASK_BITS_BASE | NDVI_QA_CIRRUS_BIT : NDVI_QA_MASK_BITS_BASE;
}

/** `true` quando o pixel deve virar nodata pelo bitmask do `qa_pixel`. */
export function qaPixelIsMasked(qa: number, mask: number): boolean {
  return (qa & mask) > 0;
}

/**
 * Expressão do `gdal_calc.py`. A: NIR, B: RED, C: qa_pixel.
 *
 * `gdal_calc` faz `from numpy import *`, então `where` e `bitwise_and` estão no escopo.
 * O denominador passa por um `where` para evitar divisão por zero sem mascarar o pixel.
 */
export function buildGdalCalcExpression(args: {
  qaMask: number;
  scale?: number;
  offset?: number;
  nodata?: number;
  comQa?: boolean;
}): string {
  const scale = args.scale ?? NDVI_SR_SCALE;
  const offset = args.offset ?? NDVI_SR_OFFSET;
  const nodata = args.nodata ?? NDVI_NODATA;
  const nir = `(A.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const red = `(B.astype(float32)*${scale}${offset >= 0 ? "+" : ""}${offset})`;
  const soma = `(${nir}+${red})`;
  const invalido = args.comQa === false
    ? `(A<=0)|(B<=0)`
    : `(A<=0)|(B<=0)|(bitwise_and(C.astype(uint16),${args.qaMask})>0)`;
  return `where(${invalido},${nodata},(${nir}-${red})/where(${soma}==0,1e-10,${soma}))`;
}

/** Faixas de interpretação; ver plano doc 03 §3.10. Descritivas, nunca conclusivas. */
export type NdviClassId = "agua" | "solo" | "rala" | "intermediaria" | "arborea" | "densa";

export type NdviClassBand = {
  id: NdviClassId;
  label: string;
  min: number;
  max: number;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
};

export const NDVI_CLASS_BANDS: readonly NdviClassBand[] = [
  { id: "agua", label: "Água ou superfície não vegetada", min: -1, max: 0, tone: "info" },
  { id: "solo", label: "Solo exposto ou vegetação ausente", min: 0, max: 0.2, tone: "danger" },
  { id: "rala", label: "Vegetação rala, pastagem degradada ou regeneração inicial", min: 0.2, max: 0.4, tone: "warn" },
  { id: "intermediaria", label: "Vegetação intermediária, pastagem vigorosa ou regeneração", min: 0.4, max: 0.6, tone: "warn" },
  { id: "arborea", label: "Vegetação arbórea", min: 0.6, max: 0.75, tone: "ok" },
  { id: "densa", label: "Vegetação arbórea densa", min: 0.75, max: 1.0001, tone: "ok" },
];

export function classifyNdvi(mean: number | null | undefined): NdviClassBand | null {
  if (mean === null || mean === undefined || !Number.isFinite(mean)) return null;
  return NDVI_CLASS_BANDS.find((band) => mean >= band.min && mean < band.max) || null;
}

/** Formata NDVI em pt-BR com 2 casas. */
export function formatNdvi(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2).replace(".", ",");
}
