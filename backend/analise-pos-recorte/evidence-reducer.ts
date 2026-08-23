import type {
  AuasPolygonResult,
  AuasWindowId,
  AuasYear,
  Confidence,
  GroqWindowObservation,
  PropertyPre2008Status,
  SceneUsability,
} from "./types";

const REQUIRED_YEARS: AuasYear[] = [2003, 2004, 2005, 2006, 2007, 2008];
const CONFIDENCE_RANK: Record<Confidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INCONCLUSIVE: 0,
};

export type ReducerWindowInput = {
  windowId: AuasWindowId;
  /** null = janela falhou (JSON inválido após retry, timeout, cancelamento, etc). */
  observation: GroqWindowObservation | null;
};

export type PolygonEvidenceInput = {
  polygonId: string;
  geometryHash: string;
  sourceIndex: number;
  areaHa: number;
  bbox: [number, number, number, number];
  sceneUsabilityByYear: Partial<Record<AuasYear, SceneUsability>>;
  sceneIdByYear: Partial<Record<AuasYear, string>>;
  windows: ReducerWindowInput[];
};

type MergedObservation = {
  year: number;
  state: GroqWindowObservation["observations"][number]["state"];
  confidence: Confidence;
  windowId: AuasWindowId;
  /** Fração observável do polígono com sinal de uso/solo exposto (0–1), se relatada. */
  observableFraction?: number | null;
};

type MergedTransition = GroqWindowObservation["transitions"][number] & {
  windowId: AuasWindowId;
};

function mergeObservationsByYear(windows: ReducerWindowInput[]): Map<number, MergedObservation[]> {
  const map = new Map<number, MergedObservation[]>();
  for (const w of windows) {
    if (!w.observation) continue;
    for (const obs of w.observation.observations) {
      const list = map.get(obs.year) || [];
      list.push({
        year: obs.year,
        state: obs.state,
        confidence: obs.confidence,
        windowId: w.windowId,
        observableFraction: obs.observableFraction ?? null,
      });
      map.set(obs.year, list);
    }
  }
  return map;
}

function mergeTransitions(windows: ReducerWindowInput[]): MergedTransition[] {
  const all: MergedTransition[] = [];
  for (const w of windows) {
    if (!w.observation) continue;
    for (const t of w.observation.transitions) {
      all.push({ ...t, windowId: w.windowId });
    }
  }
  return all;
}

/** Conflito real: duas janelas relatam estados distintos e conclusivos para o mesmo ano. */
function detectCrossWindowConflicts(byYear: Map<number, MergedObservation[]>): string[] {
  const conflicts: string[] = [];
  for (const [year, list] of byYear.entries()) {
    const definite = list.filter((o) => o.state !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE");
    const distinctStates = new Set(definite.map((o) => o.state));
    if (distinctStates.size > 1) {
      conflicts.push(
        `Ano ${year}: janelas divergem (${definite.map((o) => `${o.windowId}=${o.state}`).join(" vs ")}).`
      );
    }
  }
  return conflicts;
}

function bestDefiniteObservation(list: MergedObservation[] | undefined): MergedObservation | null {
  if (!list || list.length === 0) return null;
  const definite = list.filter((o) => o.state !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE");
  if (definite.length === 0) return null;
  return definite.slice().sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0];
}

/** Fração antropizada média por ano (só observações conclusivas). */
function anthropizedFractionByYear(
  usabilityByYear: Partial<Record<AuasYear, SceneUsability>>,
  observationsByYear: Map<number, MergedObservation[]>
): Partial<Record<AuasYear, number>> {
  const out: Partial<Record<AuasYear, number>> = {};
  for (const year of REQUIRED_YEARS) {
    const list = observationsByYear.get(year);
    if (!list || list.length === 0 || usabilityByYear[year as AuasYear] !== "USABLE") continue;
    const withFraction = list.filter((o) => typeof o.observableFraction === "number");
    if (withFraction.length === 0) continue;
    // Pondera pela confiança: HIGH=3, MEDIUM=2, LOW=1.
    let num = 0;
    let den = 0;
    for (const o of withFraction) {
      const w = Math.max(1, CONFIDENCE_RANK[o.confidence]);
      num += (o.observableFraction as number) * w;
      den += w;
    }
    if (den > 0) out[year as AuasYear] = num / den;
  }
  return out;
}

function yearCovered(
  year: AuasYear,
  usabilityByYear: Partial<Record<AuasYear, SceneUsability>>,
  observationsByYear: Map<number, MergedObservation[]>
): boolean {
  if (usabilityByYear[year] !== "USABLE") return false;
  return bestDefiniteObservation(observationsByYear.get(year)) !== null;
}

/**
 * Reduz as observações validadas da Groq (por janela) a um status determinístico
 * por polígono. Nenhuma decisão de alerta depende de texto livre — apenas dos
 * campos estruturados já validados pelo schema.
 */
export function reduceAuasPolygon(input: PolygonEvidenceInput): AuasPolygonResult {
  const observationsByYear = mergeObservationsByYear(input.windows);
  const transitions = mergeTransitions(input.windows);
  const selfReportedConflicts = input.windows.flatMap((w) => w.observation?.conflicts ?? []);
  const crossWindowConflicts = detectCrossWindowConflicts(observationsByYear);
  const allConflicts = [...selfReportedConflicts, ...crossWindowConflicts];

  const sceneIds = Object.values(input.sceneIdByYear).filter((v): v is string => Boolean(v));
  const windowIds = input.windows.map((w) => w.windowId);

  const base = {
    polygonId: input.polygonId,
    geometryHash: input.geometryHash,
    sourceIndex: input.sourceIndex,
    areaHa: input.areaHa,
    bbox: input.bbox,
    sceneIds,
    windowIds,
  };

  if (allConflicts.length > 0) {
    return {
      ...base,
      status: "INCONCLUSIVO",
      pre2008Alert: false,
      evidenceKind: "INSUFFICIENT_EVIDENCE",
      observedInterval: null,
      confidence: "INCONCLUSIVE",
      evidence: [],
      limitations: allConflicts,
    };
  }

  const obs2003 = bestDefiniteObservation(observationsByYear.get(2003));
  if (obs2003 && obs2003.state === "ANTHROPIZED") {
    return {
      ...base,
      status: "ALERTA_PRE_2008",
      pre2008Alert: true,
      evidenceKind: "ANTHROPIZED_BY_2003",
      observedInterval: {
        fromYear: null,
        toYear: 2003,
        wording: "antropização já observável no mosaico de 2003; início não datável por esta série",
      },
      confidence: obs2003.confidence,
      evidence: ["Antropização já observável no mosaico de 2003."],
      limitations: [],
    };
  }

  const alertTransition = transitions
    .filter((t) => t.change === "ANTHROPIZATION_APPEARED" && t.toYear <= 2007 && t.confidence !== "INCONCLUSIVE")
    .sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0];
  if (alertTransition) {
    return {
      ...base,
      status: "ALERTA_PRE_2008",
      pre2008Alert: true,
      evidenceKind: "TRANSITION_BEFORE_2008",
      observedInterval: {
        fromYear: alertTransition.fromYear,
        toYear: alertTransition.toYear,
        wording: `Transição observada entre ${alertTransition.fromYear} e ${alertTransition.toYear}; intervalo, não data exata.`,
      },
      confidence: alertTransition.confidence,
      evidence: alertTransition.evidence.length > 0
        ? alertTransition.evidence
        : [`Transição observada entre ${alertTransition.fromYear} e ${alertTransition.toYear}.`],
      limitations: [],
    };
  }

  const missingYears = REQUIRED_YEARS.filter((y) => !yearCovered(y, input.sceneUsabilityByYear, observationsByYear));
  if (missingYears.length > 0) {
    return {
      ...base,
      status: "INCONCLUSIVO",
      pre2008Alert: false,
      evidenceKind: "INSUFFICIENT_EVIDENCE",
      observedInterval: null,
      confidence: "INCONCLUSIVE",
      evidence: [],
      limitations: missingYears.map((y) => `Cena de ${y} ausente, ilegível ou sem observação conclusiva.`),
    };
  }

  const marcoTransition = transitions.find(
    (t) =>
      t.fromYear === 2007 &&
      t.toYear === 2008 &&
      (t.change === "ANTHROPIZATION_APPEARED" || t.change === "POSSIBLE_CHANGE") &&
      t.confidence !== "INCONCLUSIVE"
  );
  if (marcoTransition) {
    return {
      ...base,
      status: "INCONCLUSIVO_NO_MARCO_2008",
      pre2008Alert: false,
      evidenceKind: "ONLY_2007_TO_2008_CHANGE",
      observedInterval: {
        fromYear: 2007,
        toYear: 2008,
        wording:
          "Mudança observada apenas entre 2007 e o mosaico SPOT de 2008; não é possível determinar de qual lado de 22/07/2008 ela ocorreu.",
      },
      confidence: "INCONCLUSIVE",
      evidence: marcoTransition.evidence.length > 0
        ? marcoTransition.evidence
        : ["Mudança observada apenas na transição 2007 → SPOT 2008."],
      limitations: ["SPOT 2008 não prova de qual lado de 22/07/2008 a mudança ocorreu."],
    };
  }

  // ─── Sinais de dúvida (P1): desmate raso/gradual que não vira alerta pleno ──
  // A visão relata MIXED, POSSIBLE_CHANGE e observableFraction; antes esses
  // três sinais eram descartados silenciosamente. Agora viram o status
  // SINAL_DE_DUVIDA — área passível de discussão, sem acusar infração.
  const doubtSignals: string[] = [];
  const fractions = anthropizedFractionByYear(input.sceneUsabilityByYear, observationsByYear);
  const fractionYears = Object.keys(fractions).map(Number).sort((a, b) => a - b) as AuasYear[];

  // (a) Estado misto em algum ano com confiança razoável.
  const mixedObs = REQUIRED_YEARS.map((y) => ({ year: y, obs: bestDefiniteObservation(observationsByYear.get(y)) }))
    .filter((e) => e.obs?.state === "MIXED" && (e.obs!.confidence === "HIGH" || e.obs!.confidence === "MEDIUM"));
  for (const { year } of mixedObs) {
    const frac = fractions[year as AuasYear];
    doubtSignals.push(
      `Estado MISTO observado em ${year}${typeof frac === "number" ? ` (~${Math.round(frac * 100)}% com sinal de uso/solo exposto)` : ""} — indício de desmate parcial ou vegetação rala; passível de discussão.`
    );
  }

  // (b) POSSIBLE_CHANGE entre anos pré-2008 (fora do marco 2007→2008).
  const possiblePre = transitions.filter(
    (t) => t.change === "POSSIBLE_CHANGE" && t.confidence !== "INCONCLUSIVE" && !(t.fromYear === 2007 && t.toYear === 2008)
  );
  for (const t of possiblePre) {
    doubtSignals.push(
      `Possível alteração na cobertura entre ${t.fromYear} e ${t.toYear} (baixa definição da cena não permite afirmar) — ${t.evidence[0] || "sinal visual sutil"}.`
    );
  }

  // (c) Tendência crescente de fração antropizada ≥ 15 p.p. entre cenas —
  // assinatura típica de desmate raso progressivo.
  if (fractionYears.length >= 2) {
    let prev = fractionYears[0];
    for (const year of fractionYears.slice(1)) {
      const delta = (fractions[year] ?? 0) - (fractions[prev] ?? 0);
      if (delta >= 0.15) {
        doubtSignals.push(
          `Fração com sinal de uso/solo exposto subiu ~${Math.round((fractions[prev] ?? 0) * 100)}% → ~${Math.round((fractions[year] ?? 0) * 100)}% entre ${prev} e ${year} — progressão compatível com desmate gradual/raso.`
        );
        break; // um registro da tendência basta
      }
      prev = year;
    }
  }

  if (doubtSignals.length > 0) {
    return {
      ...base,
      anthropizedFractionByYear: fractionYears.length > 0 ? fractions : undefined,
      doubtSignals,
      status: "SINAL_DE_DUVIDA",
      pre2008Alert: false,
      evidenceKind: mixedObs.length > 0 ? "MIXED_STATE_OBSERVED" : possiblePre.length > 0 ? "POSSIBLE_CHANGE_PRE_2008" : "FRACTION_TREND_SUSPICIOUS",
      observedInterval: null,
      confidence: "LOW",
      evidence: doubtSignals,
      limitations: [
        "Sinal sutil na série 2003–2008: recomenda-se conferência visual pelo responsável técnico (imagens anexas por ano).",
      ],
    };
  }

  const worstConfidence = REQUIRED_YEARS
    .map((y) => bestDefiniteObservation(observationsByYear.get(y))?.confidence ?? "HIGH")
    .sort((a, b) => CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b])[0];

  return {
    ...base,
    status: "SEM_EVIDENCIA_PRE_2008",
    pre2008Alert: false,
    evidenceKind: "NO_PRE2008_CHANGE_OBSERVED",
    observedInterval: null,
    confidence: worstConfidence,
    evidence: ["Vegetação nativa/uso já consolidado observável em toda a série 2003–2008 analisada."],
    limitations: ["Ausência de evidência nesta série não certifica ausência de desmate."],
  };
}

export function reduceAuasAggregate(polygons: AuasPolygonResult[]): {
  status: PropertyPre2008Status;
  pre2008Alert: boolean;
  alertCount: number;
  doubtCount: number;
  doubtAreaHa: number;
  inconclusiveCount: number;
  noEvidenceCount: number;
  alertAreaHa: number;
  totalAuasAreaHa: number;
} {
  let alertCount = 0;
  let doubtCount = 0;
  let inconclusiveCount = 0;
  let noEvidenceCount = 0;
  let alertAreaHa = 0;
  let doubtAreaHa = 0;
  let totalAuasAreaHa = 0;

  for (const p of polygons) {
    totalAuasAreaHa += p.areaHa;
    if (p.status === "ALERTA_PRE_2008") {
      alertCount += 1;
      alertAreaHa += p.areaHa;
    } else if (p.status === "SINAL_DE_DUVIDA") {
      doubtCount += 1;
      doubtAreaHa += p.areaHa;
    } else if (p.status === "SEM_EVIDENCIA_PRE_2008") {
      noEvidenceCount += 1;
    } else {
      inconclusiveCount += 1; // INCONCLUSIVO ou INCONCLUSIVO_NO_MARCO_2008
    }
  }

  const status: PropertyPre2008Status =
    alertCount > 0
      ? "ALERTA_PRE_2008"
      : doubtCount > 0
        ? "SINAL_DE_DUVIDA"
        : inconclusiveCount > 0
          ? "INCONCLUSIVO"
          : "SEM_EVIDENCIA_PRE_2008";

  return {
    status,
    pre2008Alert: alertCount > 0,
    alertCount,
    doubtCount,
    doubtAreaHa,
    inconclusiveCount,
    noEvidenceCount,
    alertAreaHa,
    totalAuasAreaHa,
  };
}
