/**
 * Catálogo runtime da Fase 2 (anos 2009–2019) — descoberta obrigatória.
 *
 * Tarefas F2.1/F2.2 do plano `docs/planos/analise-pos-recorte/` e regras do
 * doc 03: antes de analisar qualquer ano, ele precisa (a) existir no
 * `GetCapabilities` da SEMA e (b) devolver `GetMap` válido (PNG, não uniforme)
 * na bbox do primeiro polígono. Ano reprovado sai da série e vira limitação —
 * nunca um "sem mudança".
 */
import { fetchSemamtCapabilitiesXml } from "../../lib/map-utils";
import { detectUniformImage } from "../image-quality";
import {
  buildYearCatalog,
  computeCatalogVersion as computeDiscoveryCatalogVersion,
  parseWmsCapabilities,
  type WmsLayerRef,
  type YearCatalogEntry,
} from "./catalog-discovery";
import { POS2008_SERIES_END, POS2008_SERIES_START } from "./timeline";
import { buildWmsGetMapUrl } from "../wms-scenes";

export type PosCatalog = {
  version: string;
  years: number[];
  layerByYear: Record<number, string>;
  sensorByYear: Record<number, string>;
  missingYears: number[];
  alternativesAvailable: Record<number, string[]>;
  entries: YearCatalogEntry[];
  expiresAt: string;
  limitations: string[];
};

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

let cachedCatalog: { expiresAt: number; payload: PosCatalog } | null = null;

export type CatalogDeps = {
  now?: () => number;
  fetchCapabilitiesXml?: () => Promise<string>;
  /** Validação GetMap de um ano candidato. Default: chamada real na SEMA. */
  isLayerUsable?: (ref: WmsLayerRef, bbox: [number, number, number, number]) => Promise<boolean>;
  /** Bbox do primeiro polígono AUAS do job — unidade espacial da validação. */
  sampleBbox?: [number, number, number, number];
};

function defaultNow(): number {
  return Date.now();
}

async function defaultIsLayerUsable(
  ref: WmsLayerRef,
  bbox: [number, number, number, number]
): Promise<boolean> {
  try {
    const url = buildWmsGetMapUrl([ref.layer], bbox, 512, 512);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) return false;
      const uniform = await detectUniformImage(buf);
      return !uniform.isUniform;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function entriesToCatalog(entries: YearCatalogEntry[], nowMs: number): PosCatalog {
  const years: number[] = [];
  const layerByYear: Record<number, string> = {};
  const sensorByYear: Record<number, string> = {};
  const missingYears: number[] = [];
  const alternativesAvailable: Record<number, string[]> = {};

  for (const entry of entries) {
    if (entry.missing || !entry.preferred) {
      missingYears.push(entry.year);
      continue;
    }
    years.push(entry.year);
    layerByYear[entry.year] = entry.preferred.layer;
    sensorByYear[entry.year] = entry.preferred.sensor;
    const alts = (entry.alternates || []).map((a) => a.layer);
    if (alts.length > 0) alternativesAvailable[entry.year] = alts;
  }

  return {
    version: computeDiscoveryCatalogVersion(entries),
    years,
    layerByYear,
    sensorByYear,
    missingYears,
    alternativesAvailable,
    entries,
    expiresAt: new Date(nowMs + CATALOG_TTL_MS).toISOString(),
    limitations: missingYears.length > 0
      ? [`Anos sem mosaico RGB publicado: ${missingYears.join(", ")}.`]
      : [],
  };
}

async function discoverEntries(deps: CatalogDeps): Promise<YearCatalogEntry[]> {
  const xml = await (deps.fetchCapabilitiesXml || fetchSemamtCapabilitiesXml)();
  const layerNames = parseWmsCapabilities(xml).layers;
  return buildYearCatalog(layerNames, {
    startYear: POS2008_SERIES_START,
    endYear: POS2008_SERIES_END,
  });
}

/**
 * Resolve o catálogo da Fase 2 com cache TTL (6 h) e validação GetMap por ano
 * na bbox do primeiro polígono do job. Anos reprovados saem da série e entram
 * como limitação global — o redutor nunca os trata como "sem mudança".
 */
export async function resolvePos2008Catalog(deps: CatalogDeps = {}): Promise<PosCatalog> {
  const now = deps.now || defaultNow;
  const nowMs = now();
  if (cachedCatalog && cachedCatalog.expiresAt > nowMs) return cachedCatalog.payload;

  const entries = await discoverEntries(deps);
  const isUsable = deps.isLayerUsable || defaultIsLayerUsable;
  const bbox = deps.sampleBbox;
  const limitations: string[] = [];

  if (bbox) {
    const failed = new Set<number>();
    for (const entry of entries) {
      if (!entry.preferred) continue;
      const ok = await isUsable(entry.preferred, bbox);
      if (!ok) {
        failed.add(entry.year);
        limitations.push(
          `GetMap de ${entry.year} (${entry.preferred.layer}) reprovado na bbox do recorte — ano fora da série.`
        );
      }
    }
    if (failed.size > 0) {
      for (const entry of entries) {
        if (entry.preferred && failed.has(entry.year)) {
          entry.preferred = null;
          entry.alternates = [];
          entry.missing = true;
        }
      }
    }
  }

  const payload = entriesToCatalog(entries, nowMs);
  payload.limitations = payload.limitations.concat(limitations);
  payload.version = computeDiscoveryCatalogVersion(entries);
  cachedCatalog = { expiresAt: nowMs + CATALOG_TTL_MS, payload };
  return payload;
}

/** Limpa o cache do catálogo (testes live e reciclagem). */
export function clearPos2008CatalogCache(): void {
  cachedCatalog = null;
}

/** Expõe o `fetchSemamtCapabilitiesXml` para depuração e testes. */
export function fetchCapabilitiesXml(): Promise<string> {
  return fetchSemamtCapabilitiesXml();
}
