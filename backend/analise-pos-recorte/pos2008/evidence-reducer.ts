/**
 * Redutor determinístico da Fase 2 (datação 2009–2019) — puro, sem rede, sem LLM.
 *
 * Tarefa F2.5 do plano: implementa exatamente as 5 regras do doc 05 §6. A visão
 * observa; este módulo decide. O texto final (DeepSeek/fallback) apenas redige o
 * que já foi decidido aqui.
 */
import type {
  AuasPos2008PolygonResult,
  AuasPos2008Status,
  Confidence,
  Pos2008WindowId,
  Pos2008WindowObservation,
} from "./types";
import type { SceneUsability } from "../types";
import { POS2008_SERIES_END, POS2008_SERIES_START, type SensorBoundary } from "./timeline";

const CONFIDENCE_RANK: Record<Confidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INCONCLUSIVE: 0,
};

export type Pos2008ReducerWindowInput = {
  windowId: Pos2008WindowId;
  observation: Pos2008WindowObservation | null;
};

export type Pos2008BridgeInput = {
  /** Plano da série tem fronteira com candidato alternativo (janela-ponte possível). */
  available: boolean;
  /** A janela-ponte foi de fato executada nesta execução. */
  executed: boolean;
  windowId: string | null;
  observation?: Pos2008WindowObservation | null;
};

export type Pos2008ReducerInput = {
  polygonId: string;
  geometryHash: string;
  areaHa: number;
  pre2008: { status: string; pre2008Alert: boolean };
  sceneUsabilityByYear: Record<number, SceneUsability>;
  sceneIdByYear: Record<number, string>;
  windows: Pos2008ReducerWindowInput[];
  sensorBoundaries: SensorBoundary[];
  bridge: Pos2008BridgeInput;
};

type MergedObservation = {
  year: number;
  state: Pos2008WindowObservation["observations"][number]["state"];
  confidence: Confidence;
  windowId: Pos2008WindowId;
};

type MergedTransition = Pos2008WindowObservation["transitions"][number] & {
  windowId: Pos2008WindowId;
};

function mergeObservations(windows: Pos2008ReducerWindowInput[]): Map<number, MergedObservation[]> {
  const map = new Map<number, MergedObservation[]>();
  for (const w of windows) {
    if (!w.observation) continue;
    for (const obs of w.observation.observations) {
      const list = map.get(obs.year) || [];
      list.push({ year: obs.year, state: obs.state, confidence: obs.confidence, windowId: w.windowId });
      map.set(obs.year, list);
    }
  }
  return map;
}

function mergeTransitions(windows: Pos2008ReducerWindowInput[]): MergedTransition[] {
  const all: MergedTransition[] = [];
  for (const w of windows) {
    if (!w.observation) continue;
    for (const t of w.observation.transitions) {
      all.push({ ...t, windowId: w.windowId });
    }
  }
  return all;
}

/**
 * Regra dura do doc 05 §6: duas janelas que discordam do mesmo ano compartilhado
 * tornam aquele ano não observável para efeito de decisão + limitação registrada.
 */
function markDisagreementYears(
  byYear: Map<number, MergedObservation[]>,
  limitations: string[]
): Set<number> {
  const conflicts = new Set<number>();
  for (const [year, list] of byYear.entries()) {
    const definite = list.filter(
      (o) => o.state !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE"
    );
    const distinct = new Set(definite.map((o) => o.state));
    if (distinct.size > 1) {
      conflicts.add(year);
      limitations.push(
        `Ano ${year}: janelas divergem (${definite
          .map((o) => `${o.windowId}=${o.state}`)
          .join(" vs ")}); ano tratado como não observável.`
      );
    }
  }
  return conflicts;
}

function bestDefinite(list: MergedObservation[] | undefined): MergedObservation | null {
  if (!list || list.length === 0) return null;
  const definite = list.filter((o) => o.state !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE");
  if (definite.length === 0) return null;
  return definite.slice().sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0];
}

function isUsableYear(usability: SceneUsability | undefined): boolean {
  return usability === "USABLE";
}

function crossesSensorBoundary(
  fromYear: number,
  toYear: number,
  boundaries: SensorBoundary[]
): boolean {
  return boundaries.some((b) => b.fromYear === fromYear && b.toYear === toYear);
}

/**
 * Reduz observações da série 2009–2019 a um veredito determinístico por polígono.
 * Ordem rígida das regras 1–5 do doc 05 §6; nenhuma decisão depende de texto livre.
 */
export function reducePos2008Polygon(input: Pos2008ReducerInput): AuasPos2008PolygonResult {
  const observationsByYear = mergeObservations(input.windows);
  const transitions = mergeTransitions(input.windows);
  const limitations: string[] = [];

  const selfReportedConflicts = input.windows.flatMap((w) => w.observation?.conflicts ?? []);
  for (const c of selfReportedConflicts) limitations.push(c);
  const disagreementYears = markDisagreementYears(observationsByYear, limitations);
  for (const y of disagreementYears) observationsByYear.delete(y);

  const sceneIds = Object.values(input.sceneIdByYear).filter((v): v is string => Boolean(v));
  const windowIds = input.windows.map((w) => w.windowId);

  const base = {
    polygonId: input.polygonId,
    geometryHash: input.geometryHash,
    areaHa: input.areaHa,
    pre2008: input.pre2008,
    sceneIds,
    windowIds,
  };

  const definiteByYear = new Map<number, MergedObservation>();
  for (const [year, list] of observationsByYear.entries()) {
    const best = bestDefinite(list);
    if (best) definiteByYear.set(year, best);
  }

  const sortedYears = [...definiteByYear.keys()].sort((a, b) => a - b);

  // ── Regra 1: já antropizado no início da série (primeiro ano observável = 2009) ──
  const firstYear = sortedYears[0];
  const firstObs = firstYear !== undefined ? definiteByYear.get(firstYear) : undefined;
  if (
    firstYear === POS2008_SERIES_START &&
    firstObs &&
    firstObs.state === "ANTHROPIZED" &&
    isUsableYear(input.sceneUsabilityByYear[POS2008_SERIES_START])
  ) {
    const evidence: string[] = [];
    if (input.pre2008.pre2008Alert) {
      evidence.push(
        `Polígono já antropizado no mosaico de ${POS2008_SERIES_START}; coerente com o alerta pré-2008 da Fase 1 (evento anterior ao marco).`
      );
    } else {
      evidence.push(`Polígono já antropizado no mosaico de ${POS2008_SERIES_START} — primeiro ano observável da série.`);
    }
    return {
      ...base,
      status: "JA_ANTROPIZADO_NO_INICIO_DA_SERIE",
      firstDetectedYear: POS2008_SERIES_START,
      observedInterval: null,
      confidence: firstObs.confidence,
      crossedSensorBoundary: false,
      bridgeWindowUsed: null,
      evidence,
      limitations,
    };
  }

  // ── Transições decisivas (N→A), da mais antiga para a mais recente ──
  const nativeToAnthropized = transitions
    .filter((t) => t.transition === "NATIVE_TO_ANTHROPIZED" && t.confidence !== "INCONCLUSIVE")
    .sort((a, b) => a.fromYear - b.fromYear);

  if (nativeToAnthropized.length > 0) {
    const t = nativeToAnthropized[0];
    const yPrev = t.fromYear;
    const y = t.toYear;

    const prevState = definiteByYear.get(yPrev)?.state;
    const curState = definiteByYear.get(y)?.state;
    const prevUsable = isUsableYear(input.sceneUsabilityByYear[yPrev]);
    const curUsable = isUsableYear(input.sceneUsabilityByYear[y]);

    const endpointsAgree =
      prevUsable && curUsable && prevState === "NATIVE_VEGETATION" && curState === "ANTHROPIZED";

    // ── Regra 2: ano exato exige dois anos CONSECUTIVOS utilizáveis concordando ──
    // Sem o teste de consecutividade, uma transição relatada como 2010→2015 (anos
    // não vizinhos, porque os intermediários caíram do catálogo) virava
    // "CONFIRMADO_ANO 2015" — precisão que a série não sustenta. Não-consecutivo
    // é intervalo, tratado na regra 3.
    if (endpointsAgree && y === yPrev + 1) {
      const crossed = crossesSensorBoundary(yPrev, y, input.sensorBoundaries);
      const bridgeConfirmed =
        input.bridge.executed &&
        !!input.bridge.observation &&
        input.bridge.observation.transitions.some(
          (bt) =>
            bt.fromYear === yPrev &&
            bt.toYear === y &&
            bt.transition === "NATIVE_TO_ANTHROPIZED" &&
            bt.confidence !== "INCONCLUSIVE"
        );

      if (crossed && !bridgeConfirmed) {
        const lim = input.bridge.available
          ? `Transição ${yPrev}→${y} cruza troca de sensor e a janela-ponte não confirmou; status rebaixado para intervalo.`
          : `Transição ${yPrev}→${y} cruza troca de sensor sem candidato alternativo publicado; status rebaixado para intervalo.`;
        limitations.push(lim);
        return {
          ...base,
          status: "CONFIRMADO_INTERVALO",
          firstDetectedYear: null,
          observedInterval: { fromYear: yPrev, toYear: y },
          confidence: t.confidence,
          crossedSensorBoundary: true,
          bridgeWindowUsed: input.bridge.executed ? input.bridge.windowId : null,
          evidence: [
            `Conversão observada entre ${yPrev} e ${y}; sem confirmação de ano exato por troca de sensor.`,
          ],
          limitations,
        };
      }

      return {
        ...base,
        status: "CONFIRMADO_ANO",
        firstDetectedYear: y,
        observedInterval: null,
        confidence: t.confidence,
        crossedSensorBoundary: crossed,
        bridgeWindowUsed: crossed ? (bridgeConfirmed ? input.bridge.windowId : null) : null,
        evidence: [
          `Vegetação nativa em ${yPrev} convertida para uso antrópico em ${y} (${t.evidence.length > 0 ? t.evidence.join("; ") : "transição visual consecutiva"}).`,
        ],
        limitations,
      };
    }

    // ── Regra 3: nativo em A + antrópico em B, B > A+1 (intermediários não utilizáveis) ──
    // Os DOIS extremos precisam ser observáveis e concordantes; sem isso o
    // intervalo se apoiaria numa transição que nenhuma cena utilizável sustenta,
    // e um par nublado virava "CONFIRMADO_INTERVALO".
    const yA = yPrev;
    const yB = y;
    if (endpointsAgree && yB > yA + 1) {
      return {
        ...base,
        status: "CONFIRMADO_INTERVALO",
        firstDetectedYear: null,
        observedInterval: { fromYear: yA, toYear: yB },
        confidence: t.confidence,
        crossedSensorBoundary: crossesSensorBoundary(yA, yB, input.sensorBoundaries),
        bridgeWindowUsed: null,
        evidence: [
          `Vegetação nativa observável em ${yA} e uso antrópico em ${yB}; anos intermediários não utilizáveis.`,
        ],
        limitations: [
          ...limitations,
          `Anos intermediários entre ${yA} e ${yB} sem cena utilizável; intervalo, não data exata.`,
        ],
      };
    }

    // Transição N→A relatada mas sem os dois anos consecutivos utilizáveis/concordantes.
    limitations.push(
      `Transição ${yPrev}→${y} relatada pela visão, mas ${yPrev} e/ou ${y} sem cena utilizável conclusiva; sem ano exato.`
    );
  }

  // ── Lacunas críticas: série exigida com algum ano não utilizável ──
  // A série cobrada é a INTEIRA (constantes do plano), não só os anos que vieram
  // no catálogo: ano que sequer foi olhado não pode virar "sem mudança".
  const seriesYears = Array.from(
    { length: POS2008_SERIES_END - POS2008_SERIES_START + 1 },
    (_, i) => POS2008_SERIES_START + i
  );
  const missingUsable = seriesYears.filter(
    (y) => !isUsableYear(input.sceneUsabilityByYear[y]) || !definiteByYear.has(y)
  );
  if (missingUsable.length > 0) {
    return {
      ...base,
      status: "INCONCLUSIVO",
      firstDetectedYear: null,
      observedInterval: null,
      confidence: "INCONCLUSIVE",
      crossedSensorBoundary: false,
      bridgeWindowUsed: null,
      evidence: [],
      limitations: [
        ...limitations,
        `Ano(s) sem cena utilizável ou observação conclusiva: ${missingUsable.join(", ")}; impossível descartar conversão nesse(s) ano(s).`,
      ],
    };
  }

  // ── Regra 4: nenhuma transição em toda a série utilizável ──
  const worstConfidence =
    seriesYears
      .map((y) => definiteByYear.get(y)?.confidence ?? "HIGH")
      .sort((a, b) => CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b])[0];

  return {
    ...base,
    status: "SEM_MUDANCA_OBSERVADA",
    firstDetectedYear: null,
    observedInterval: null,
    confidence: worstConfidence,
    crossedSensorBoundary: false,
    bridgeWindowUsed: null,
    evidence: [`Nenhuma conversão de vegetação nativa observada na série ${POS2008_SERIES_START}–${POS2008_SERIES_END} analisada.`],
    limitations: [
      ...limitations,
      "Ausência de mudança observada nesta série não certifica ausência de desmate; para eventos a partir de 2019, consultar a aba AUAS × SCCON (datação por alerta oficial).",
    ],
  };
}

export type Pos2008Aggregate = {
  polygonCount: number;
  confirmedYearCount: number;
  intervalCount: number;
  alreadyAnthropizedCount: number;
  noChangeCount: number;
  inconclusiveCount: number;
  totalAuasAreaHa: number;
  areaByStatusHa: Record<AuasPos2008Status, number>;
  yearHistogram: Record<number, { count: number; areaHa: number }>;
};

/** Agregado do imóvel (doc 05 §7) — nunca substitui a tabela por polígono. */
export function reducePos2008Aggregate(polygons: AuasPos2008PolygonResult[]): Pos2008Aggregate {
  const areaByStatusHa: Record<AuasPos2008Status, number> = {
    CONFIRMADO_ANO: 0,
    CONFIRMADO_INTERVALO: 0,
    JA_ANTROPIZADO_NO_INICIO_DA_SERIE: 0,
    SEM_MUDANCA_OBSERVADA: 0,
    INCONCLUSIVO: 0,
  };
  const yearHistogram: Record<number, { count: number; areaHa: number }> = {};
  let totalAuasAreaHa = 0;

  for (const p of polygons) {
    totalAuasAreaHa += p.areaHa;
    areaByStatusHa[p.status] = (areaByStatusHa[p.status] || 0) + p.areaHa;
    if (p.firstDetectedYear) {
      const entry = yearHistogram[p.firstDetectedYear] || { count: 0, areaHa: 0 };
      entry.count += 1;
      entry.areaHa += p.areaHa;
      yearHistogram[p.firstDetectedYear] = entry;
    }
  }

  return {
    polygonCount: polygons.length,
    confirmedYearCount: polygons.filter((p) => p.status === "CONFIRMADO_ANO").length,
    intervalCount: polygons.filter((p) => p.status === "CONFIRMADO_INTERVALO").length,
    alreadyAnthropizedCount: polygons.filter((p) => p.status === "JA_ANTROPIZADO_NO_INICIO_DA_SERIE").length,
    noChangeCount: polygons.filter((p) => p.status === "SEM_MUDANCA_OBSERVADA").length,
    inconclusiveCount: polygons.filter((p) => p.status === "INCONCLUSIVO").length,
    totalAuasAreaHa,
    areaByStatusHa,
    yearHistogram,
  };
}
