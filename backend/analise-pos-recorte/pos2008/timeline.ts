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
export const POS2008_SERIES_END = 2019;

export type Pos2008WindowDef = {
  windowId: Pos2008WindowId;
  years: number[];
  /** Ano(s) compartilhados com a janela anterior (sem memória entre requisições). */
  sharedWithPrevious: number[];
};

/** As 5 janelas padrão da Fase 2 (doc 05 §4). */
export const POS2008_WINDOWS: Pos2008WindowDef[] = [
  { windowId: "W2009_2011", years: [2009, 2010, 2011], sharedWithPrevious: [] },
  { windowId: "W2011_2013", years: [2011, 2012, 2013], sharedWithPrevious: [2011] },
  { windowId: "W2013_2015", years: [2013, 2014, 2015], sharedWithPrevious: [2013] },
  { windowId: "W2015_2017", years: [2015, 2016, 2017], sharedWithPrevious: [2015] },
  { windowId: "W2017_2019", years: [2017, 2018, 2019], sharedWithPrevious: [2017] },
];

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
export function knownSensorBoundaries(catalog?: YearCatalogEntry[]): SensorBoundary[] {
  const dynamic: SensorBoundary[] = [];
  if (catalog && catalog.length > 0) {
    for (let i = 1; i < catalog.length; i++) {
      const prev = catalog[i - 1];
      const curr = catalog[i];
      if (!prev.preferred || !curr.preferred) continue;
      if (prev.preferred.sensor !== curr.preferred.sensor) {
        dynamic.push({ fromYear: prev.year, toYear: curr.year });
      }
    }
  }
  if (dynamic.length > 0) return dynamic;
  return POS2008_SENSOR_BOUNDARIES.filter(
    (b) => b.fromYear >= POS2008_SERIES_START && b.toYear <= POS2008_SERIES_END
  );
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
export function buildTimelinePlan(catalog: YearCatalogEntry[]): TimelinePlan {
  const enabledYears = new Set(catalog.filter((e) => e.preferred).map((e) => e.year));
  const missingYears = catalog.filter((e) => e.missing).map((e) => e.year);
  const boundaries = knownSensorBoundaries(catalog);

  const windows = POS2008_WINDOWS.map((w) => ({
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
