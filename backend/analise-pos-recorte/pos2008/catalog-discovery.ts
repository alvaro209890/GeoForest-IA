/**
 * Descoberta do catálogo WMS da série anual (Fase 2: 2009–2019) — parte pura.
 *
 * Tarefa F0.1 do plano `docs/planos/analise-pos-recorte/`: nenhum ano pode ser
 * analisado sem estar no `GetCapabilities` **e** ter devolvido `GetMap` válido.
 * Aqui fica só a leitura do capabilities e a montagem do catálogo candidato; a
 * verificação `GetMap` ao vivo é do levantamento
 * (`scripts/levantamento-wms-pos-recorte.ts`) e, depois, da tarefa F2.1.
 *
 * Este módulo **não decide** qual sensor usar quando há mais de um no mesmo ano
 * (decisão A2, do Álvaro): ele lista o candidato preferido e os alternativos, e
 * marca o ano como fronteira de sensor.
 */
import crypto from "crypto";

export type SensorId = "LANDSAT_5" | "LANDSAT_7" | "LANDSAT_8" | "RESOURCESAT" | "SENTINEL_2" | "SPOT";

export type WmsLayerRef = {
  layer: string;
  sensor: SensorId;
  year: number;
  /** Mosaico de infravermelho (NIR), usado pela Fase 3 — não entra na série RGB. */
  nir: boolean;
};

export type YearCatalogEntry = {
  year: number;
  /** Candidato preferido pela ordem de sensor; `null` quando o ano não existe no servidor. */
  preferred: WmsLayerRef | null;
  /** Outros mosaicos RGB do mesmo ano (ex.: 2016 tem Landsat 8 e Sentinel-2). */
  alternates: WmsLayerRef[];
  /** Ano sem nenhum mosaico RGB publicado. */
  missing: boolean;
  /** O sensor preferido muda em relação ao ano anterior da série. */
  sensorBoundary: boolean;
};

/**
 * Ordem de preferência quando o ano tem mais de um mosaico. Landsat 8 antes de
 * Sentinel-2 em 2016/2017 mantém a série contínua com 2013–2015 (uma troca de
 * sensor a menos); a decisão final é A2 e pode inverter isso por env.
 */
export const SENSOR_PREFERENCE: SensorId[] = [
  "LANDSAT_5",
  "RESOURCESAT",
  "LANDSAT_8",
  "SENTINEL_2",
  "LANDSAT_7",
  "SPOT",
];

const LAYER_PATTERNS: Array<{ regex: RegExp; sensor: SensorId; nir?: boolean }> = [
  { regex: /^Mosaicos:Geoportal_Sentinel_2_(\d{4})_NIR$/i, sensor: "SENTINEL_2", nir: true },
  { regex: /^Mosaicos:SENTINEL_2_(\d{4})$/i, sensor: "SENTINEL_2" },
  { regex: /^Mosaicos:LANDSAT_5_(\d{4})$/i, sensor: "LANDSAT_5" },
  { regex: /^Mosaicos:LANDSAT_7_(\d{4})$/i, sensor: "LANDSAT_7" },
  { regex: /^Mosaicos:LANDSAT_8_(\d{4})$/i, sensor: "LANDSAT_8" },
  { regex: /^Mosaicos:RESOURCESAT_(\d{4})$/i, sensor: "RESOURCESAT" },
];

export type WmsStyleRef = {
  /** Nome do estilo, como vai no parâmetro `styles` do GetMap. */
  style: string;
  /** Camada a que o estilo pertence — é ela que vai em `layers`. */
  layer: string;
  year: number | null;
};

/**
 * Varre o GetCapabilities em ordem de documento separando **camadas** de
 * **estilos**. Distinção que custou caro no levantamento F0.1: os "mosaicos NIR"
 * da SEMA (`Mosaicos:Geoportal_Sentinel_2_2021_NIR`) são `<Style>` do mosaico
 * RGB do mesmo ano, não camadas — pedir GetMap com esse nome em `layers`
 * devolve `LayerNotDefined`.
 */
export function parseWmsCapabilities(xml: string): { layers: string[]; styles: WmsStyleRef[] } {
  const tokens = /<Name>\s*([^<]+?)\s*<\/Name>|<Style>|<\/Style>/gi;
  const layers = new Set<string>();
  const styles: WmsStyleRef[] = [];
  let insideStyle = false;
  let currentLayer = "";
  let match: RegExpExecArray | null;

  while ((match = tokens.exec(xml))) {
    if (match[0] === "<Style>") {
      insideStyle = true;
      continue;
    }
    if (match[0] === "</Style>") {
      insideStyle = false;
      continue;
    }
    const name = match[1].trim();
    if (insideStyle) {
      if (currentLayer) {
        const year = /_(\d{4})(_[A-Z]+)?$/i.exec(name)?.[1];
        styles.push({ style: name, layer: currentLayer, year: year ? Number(year) : null });
      }
      continue;
    }
    // Só camadas renderizáveis: as sem ":" são nomes de grupo/serviço.
    if (name.includes(":")) {
      layers.add(name);
      currentLayer = name;
    }
  }

  return { layers: [...layers].sort(), styles };
}

/** Atalho para quem só precisa dos nomes de camada. */
export function parseWmsLayerNames(xml: string): string[] {
  return parseWmsCapabilities(xml).layers;
}

/** Reconhece ano e sensor pelo nome do mosaico. Nome fora do padrão → `null`. */
export function classifyMosaicLayer(layerName: string): WmsLayerRef | null {
  for (const pattern of LAYER_PATTERNS) {
    const match = pattern.regex.exec(layerName);
    if (!match) continue;
    const year = Number(match[1]);
    if (!Number.isInteger(year)) continue;
    return { layer: layerName, sensor: pattern.sensor, year, nir: pattern.nir === true };
  }
  return null;
}

function bySensorPreference(a: WmsLayerRef, b: WmsLayerRef): number {
  const rank = (ref: WmsLayerRef) => {
    const index = SENSOR_PREFERENCE.indexOf(ref.sensor);
    return index === -1 ? SENSOR_PREFERENCE.length : index;
  };
  return rank(a) - rank(b) || a.layer.localeCompare(b.layer);
}

export type BuildYearCatalogOptions = {
  startYear: number;
  endYear: number;
  /** Override por ano (env `SIMCAR_AUAS_LAYER_<ano>`), aplicado antes da preferência. */
  overrides?: Record<number, string>;
};

/**
 * Monta a série ano a ano a partir dos nomes publicados. Ano sem mosaico RGB
 * vira `missing: true` — nunca é silenciosamente pulado, porque a ausência entra
 * como limitação no laudo.
 */
export function buildYearCatalog(layerNames: string[], options: BuildYearCatalogOptions): YearCatalogEntry[] {
  const byYear = new Map<number, WmsLayerRef[]>();
  for (const name of layerNames) {
    const ref = classifyMosaicLayer(name);
    if (!ref || ref.nir) continue;
    if (ref.year < options.startYear || ref.year > options.endYear) continue;
    const list = byYear.get(ref.year) || [];
    list.push(ref);
    byYear.set(ref.year, list);
  }

  const entries: YearCatalogEntry[] = [];
  let previousSensor: SensorId | null = null;
  for (let year = options.startYear; year <= options.endYear; year += 1) {
    const candidates = (byYear.get(year) || []).slice().sort(bySensorPreference);
    const override = options.overrides?.[year];
    const overridden = override ? candidates.find((c) => c.layer === override) : undefined;
    const preferred =
      overridden ||
      (override && !overridden
        ? ({ layer: override, sensor: "SENTINEL_2", year, nir: false } as WmsLayerRef)
        : candidates[0]) ||
      null;
    const alternates = candidates.filter((c) => c.layer !== preferred?.layer);
    const sensorBoundary = !!preferred && previousSensor !== null && preferred.sensor !== previousSensor;
    entries.push({
      year,
      preferred: preferred || null,
      alternates,
      missing: !preferred,
      sensorBoundary,
    });
    if (preferred) previousSensor = preferred.sensor;
  }
  return entries;
}

/**
 * Estilos NIR disponíveis (insumo da Fase 3), do mais recente para o mais antigo.
 * Cada um é usado como `layers=<layer>&styles=<style>`.
 */
export function listNirStyles(xml: string): WmsStyleRef[] {
  return parseWmsCapabilities(xml)
    .styles.filter((ref) => /_NIR$/i.test(ref.style))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/**
 * Versão do catálogo: muda quando qualquer camada da série muda. É o que
 * invalida checkpoint entre execuções (ver `buildPhaseCheckpointKey`).
 */
export function computeCatalogVersion(entries: YearCatalogEntry[]): string {
  const payload = entries
    .map((entry) => `${entry.year}:${entry.preferred?.layer || "-"}:${(entry.alternates || []).map((alt) => alt.layer).sort().join(",")}`)
    .join("|");
  return `wms-${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12)}`;
}
