/**
 * Linha do tempo da Fase 2 (datação 2009–2019) — parte pura.
 *
 * Tarefa F2.4 do plano `docs/planos/analise-pos-recorte/`: monta as 5 janelas de
 * visão com ano compartilhado entre vizinhas, detecta fronteiras de sensor e
 * decide quando uma janela-ponte é necessária. Nada de rede aqui — só estrutura.
 */
import type { YearCatalogEntry } from "./catalog-discovery";
import { POS2008_SENSOR_BOUNDARIES, type Pos2008Sensor, type Pos2008WindowId } from "./types";

export const POS2008_SERIES_START = 2009;
/**
 * Fim padrão da série visual. Continua em 2019 de propósito: a partir daí a
 * datação oficial é a do alerta (aba AUAS × SCCON), e a imagem vira corroboração.
 * Quem quiser estender a série visual até o mosaico mais recente publicado pela
 * SEMA (2025) liga `SIMCAR_AUAS_POS2008_SERIES_END=2025` — decisão do Álvaro,
 * documentada em `docs/IMAGENS_E_CAMADAS_LAUDO.md`.
 */
export const POS2008_SERIES_END = 2019;

/** Limites físicos: fora disso não existe mosaico anual publicado pela SEMA-MT. */
const SERIES_MIN_YEAR = 2003;
const SERIES_MAX_YEAR = 2030;

export type Pos2008Series = { startYear: number; endYear: number };

function readSeriesYear(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < SERIES_MIN_YEAR || value > SERIES_MAX_YEAR) {
    throw new Error(
      `Variável de ambiente ${name} inválida: "${raw}". Use um ano inteiro entre ${SERIES_MIN_YEAR} e ${SERIES_MAX_YEAR}.`
    );
  }
  return value;
}

/** Série efetiva da Fase 2. Lida a cada chamada — env pode mudar entre testes. */
export function getPos2008Series(): Pos2008Series {
  const startYear = readSeriesYear("SIMCAR_AUAS_POS2008_SERIES_START", POS2008_SERIES_START);
  const endYear = readSeriesYear("SIMCAR_AUAS_POS2008_SERIES_END", POS2008_SERIES_END);
  if (endYear < startYear + 1) {
    throw new Error(
      `Série da Fase 2 inválida: ${startYear}–${endYear}. O fim precisa ser pelo menos um ano depois do início.`
    );
  }
  return { startYear, endYear };
}

export type Pos2008WindowDef = {
  windowId: Pos2008WindowId;
  years: number[];
  /** Ano(s) compartilhados com a janela anterior (sem memória entre requisições). */
  sharedWithPrevious: number[];
};

/**
 * Gera as janelas de visão da série: blocos de 3 anos com **um ano compartilhado**
 * com a janela anterior (doc 05 §4), o que dá continuidade à leitura sem repetir
 * a série inteira em cada chamada. A última janela pode ter só 2 anos quando a
 * série tem tamanho par. O teto de 3 cenas por janela é do modelo de visão.
 */
export function buildPos2008Windows(startYear: number, endYear: number): Pos2008WindowDef[] {
  const windows: Pos2008WindowDef[] = [];
  for (let first = startYear; first < endYear; first += 2) {
    const years: number[] = [];
    for (let year = first; year <= Math.min(first + 2, endYear); year += 1) years.push(year);
    if (years.length < 2) break;
    windows.push({
      windowId: `W${years[0]}_${years[years.length - 1]}`,
      years,
      sharedWithPrevious: windows.length === 0 ? [] : [first],
    });
  }
  return windows;
}

/** As janelas da série padrão 2009–2019 (5 janelas do doc 05 §4). */
export const POS2008_WINDOWS: Pos2008WindowDef[] = buildPos2008Windows(
  POS2008_SERIES_START,
  POS2008_SERIES_END
);

export type SensorBoundary = { fromYear: number; toYear: number };

/** Ano(s) publicado(s) para um par de anos — usado pela janela-ponte. */
export type BridgePairSpec = {
  boundary: SensorBoundary;
  /** Layer do sensor padrão da série, por ano (a usada nas janelas normais). */
  seriesLayers: Record<number, string>;
  /** Layer(s) alternativa(s) para cada ano (ex.: SENTINEL_2_2016 quando a série usa L8). */
  alternateLayers: Record<number, string[]>;
  /** Quem muda na fronteira (fromSensor → toSensor). */
  sensorChange: { from: Pos2008Sensor; to: Pos2008Sensor };
};

/**
 * Fronteiras de sensor efetivas dentro da série, na ordem do tempo.
 * O catálogo runtime pode confirmar ou acrescentar; as estáticas são conhecidas
 * do levantamento F0.1 (L5→ResourceSat em 2012, ResourceSat→L8 em 2013, L8→S2 em 2019).
 */
export function knownSensorBoundaries(catalog?: YearCatalogEntry[], series?: Pos2008Series): SensorBoundary[] {
  const dynamic: SensorBoundary[] = [];
  if (catalog && catalog.length > 0) {
    // Compara anos HABILITADOS consecutivos, não posições vizinhas no array: um
    // ano reprovado no GetMap vira `preferred: null` no meio da série, e comparar
    // só vizinhos de array fazia a fronteira sumir junto com ele. Ex.: 2012
    // (ResourceSat) cai → 2011 (L5) e 2013 (L8) deixavam de acusar troca de
    // sensor, e o redutor confirmava ano exato atravessando a troca sem ponte.
    let previous: YearCatalogEntry | null = null;
    for (const entry of catalog) {
      if (!entry.preferred) continue;
      if (previous?.preferred && previous.preferred.sensor !== entry.preferred.sensor) {
        dynamic.push({ fromYear: previous.year, toYear: entry.year });
      }
      previous = entry;
    }
    // Catálogo presente manda, inclusive quando a resposta é "nenhuma fronteira".
    // Cair na lista estática aqui inventava trocas de sensor que aquele catálogo
    // não tem (ex.: série curta, toda Landsat 5), e fronteira falsa rebaixa
    // CONFIRMADO_ANO para CONFIRMADO_INTERVALO sem motivo.
    return dynamic;
  }
  const { startYear, endYear } = series ?? getPos2008Series();
  return POS2008_SENSOR_BOUNDARIES.filter((b) => b.fromYear >= startYear && b.toYear <= endYear);
}

export type TimelinePlan = {
  /** Janelas efetivas: anos do catálogo habilitado, na ordem. Anos ausentes saem. */
  windows: Pos2008WindowDef[];
  /** Anos da série que não estão habilitados no catálogo runtime. */
  missingYears: number[];
  /** Fronteiras de sensor dentro da série. */
  boundaries: SensorBoundary[];
  /**
   * Pares de anos que cruzam fronteira de sensor — quando o redutor apontar
   * transição num desses pares, exige janela-ponte antes de confirmar o ano.
   */
  bridgeCandidates: BridgePairSpec[];
  /** Janela-ponte: um par de anos em volta da fronteira com candidato alternativo. */
  bridgeWindow: Pos2008WindowDef | null;
};

/**
 * Monta o plano de janelas a partir do catálogo runtime habilitado.
 * Ano ausente (não habilitado) sai da janela — nunca é silenciosamente pulado:
 * sai em `missingYears` e vira limitação no laudo.
 */
export function buildTimelinePlan(catalog: YearCatalogEntry[], series?: Pos2008Series): TimelinePlan {
  const enabledYears = new Set(catalog.filter((e) => e.preferred).map((e) => e.year));
  const missingYears = catalog.filter((e) => e.missing).map((e) => e.year);
  const boundaries = knownSensorBoundaries(catalog, series);
  const effectiveSeries = series ?? getPos2008Series();

  const windows = buildPos2008Windows(effectiveSeries.startYear, effectiveSeries.endYear).map((w) => ({
    ...w,
    years: w.years.filter((y) => enabledYears.has(y)),
  }));

  // Janela-ponte: primeiro par de anos com fronteira de sensor onde ambos os
  // anos existem na série e há candidato alternativo publicável para pelo menos
  // um deles. Uma única ponte por análise — a de maior fronteira, primeiro no tempo.
  const bridgeCandidates: BridgePairSpec[] = [];
  let bridgeWindow: Pos2008WindowDef | null = null;

  for (const boundary of boundaries) {
    const fromEntry = catalog.find((e) => e.year === boundary.fromYear);
    const toEntry = catalog.find((e) => e.year === boundary.toYear);
    if (!fromEntry?.preferred || !toEntry?.preferred) continue;

    const alternatesByYear: Record<number, string[]> = {};
    for (const entry of [fromEntry, toEntry]) {
      const alts = (entry.alternates || []).map((a) => a.layer);
      if (alts.length > 0) alternatesByYear[entry.year] = alts;
    }

    bridgeCandidates.push({
      boundary,
      seriesLayers: {
        [boundary.fromYear]: fromEntry.preferred.layer,
        [boundary.toYear]: toEntry.preferred.layer,
      },
      alternateLayers: alternatesByYear,
      sensorChange: {
        from: fromEntry.preferred.sensor,
        to: toEntry.preferred.sensor,
      },
    });

    if (!bridgeWindow && Object.keys(alternatesByYear).length > 0) {
      bridgeWindow = { windowId: "WBRIDGE", years: [boundary.fromYear, boundary.toYear], sharedWithPrevious: [] };
    }
  }

  return {
    windows,
    missingYears,
    boundaries,
    bridgeCandidates,
    bridgeWindow,
  };
}
