/**
 * Redutor determinístico da Fase 3 (vegetação na AC) — F3.5.
 *
 * Precedência: a evidência geométrica (AVN ∪ TIPOLOGIA_VEGETAL declaradas dentro
 * da AC) vence sempre. A visão complementa. Bandas de área nunca são um número
 * falsamente preciso. Flags independentes (`AC_SOBREPOE_ARL`, `AC_SOBREPOE_AUAS`)
 * compõem o resultado, não o substituem.
 */
import type { AcPolygonResult, AcVegetacaoWindowObservation } from "./types";
import type { Confidence } from "../types";

export type AcReducerInput = {
  polygonId: string;
  geometryHash: string;
  areaHa: number;
  geometric: AcPolygonResult["geometric"];
  /** Observação da janela visual (null = visão falhou/ausente). */
  window: { observation: AcVegetacaoWindowObservation | null } | null;
  flags: string[];
  pos2008CompletedAt: string | null;
};

export type AcReducerConfig = {
  /** Limiar geométrico de alerta ALTO: fração (0..1) OU área em ha (>=). Default 1% ou 0.5ha. */
  declaredFractionThreshold?: number;
  declaredAreaHaThreshold?: number;
  /** Mínimo de cenas utilizáveis para considerar veredito visual. */
  minUsableScenes?: number;
};

const DEFAULT_FRACTION = 0.01;
const DEFAULT_AREA_HA = 0.5;
const DEFAULT_MIN_USABLE = 2;

/** Classifica bandas de área aparente (nunca um número preciso). */
export function areaToBand(areaHa: number | null | undefined): AcPolygonResult["visual"]["estimatedFractionBand"] {
  if (areaHa === null || areaHa === undefined) return null;
  if (areaHa < 0.5) return "<0.5ha";
  if (areaHa <= 2) return "0.5-2ha";
  if (areaHa <= 10) return "2-10ha";
  return ">10ha";
}

const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, INCONCLUSIVE: 0 };

function worstConfidenceOf(obs: AcVegetacaoWindowObservation["observations"]): Confidence {
  if (obs.length === 0) return "INCONCLUSIVE";
  let worst: Confidence = "HIGH";
  for (const o of obs) {
    if (CONFIDENCE_RANK[o.confidence] < CONFIDENCE_RANK[worst]) worst = o.confidence;
  }
  return worst;
}

function bestConfidenceOf(obs: AcVegetacaoWindowObservation["observations"]): Confidence {
  let best: Confidence = "INCONCLUSIVE";
  for (const o of obs) {
    if (CONFIDENCE_RANK[o.confidence] > CONFIDENCE_RANK[best]) best = o.confidence;
  }
  return best;
}

/**
 * Descola a observação visual agregada das cenas de um polígono AC.
 * `verdict` usa o vocabulário da visão (NONE/SPARSE/PATCHES/LARGE_BLOCK).
 */
function aggregateVisual(
  obs: AcVegetacaoWindowObservation["observations"] | undefined,
  areaHa: number
): AcPolygonResult["visual"] {
  const entries = obs || [];
  const usable = entries.filter((o) => o.vegetationInside !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE");

  let verdict: AcPolygonResult["visual"]["verdict"] = "NOT_OBSERVABLE";
  if (usable.length > 0) {
    const larges = usable.filter((o) => o.vegetationInside === "LARGE_BLOCK");
    const patches = usable.filter((o) => o.vegetationInside === "PATCHES");
    if (larges.length > 0) verdict = "LARGE_BLOCK";
    else if (patches.length > 0) verdict = "PATCHES";
    else if (usable.some((o) => o.vegetationInside === "SPARSE")) verdict = "SPARSE";
    else verdict = "NONE";
  }

  const maxFraction = usable.reduce((max, o) => (o.estimatedFraction ?? 0) > max ? (o.estimatedFraction ?? 0) : max, 0);
  const distribution = usable.find((o) => o.distribution)?.distribution ?? null;

  return {
    verdict,
    estimatedFractionBand: usable.length > 0 ? areaToBand(areaHa * maxFraction) : null,
    distribution,
    sceneIds: usable.map((o) => o.sceneId),
  };
}

/**
 * Reduz a evidência (geométrica + visual) a um veredito determinístico por AC.
 * Ordem de precedência:
 *   1. Projeto declara vegetação dentro da AC (geométrica) → ALTO.
 *   2. Zonas prioritárias flag + visão com vegetação não declarada → ALTO.
 *   3. Visão confiável concorda sobre presença → MEDIO.
 *   4. Visão confiável concorda sobre ausência → NENHUM.
 *   5. Resto → INDETERMINADO.
 */
export function reduceAcVegetacao(input: AcReducerInput, config: AcReducerConfig = {}): AcPolygonResult {
  const fractionThreshold = config.declaredFractionThreshold ?? DEFAULT_FRACTION;
  const areaThreshold = config.declaredAreaHaThreshold ?? DEFAULT_AREA_HA;
  const minUsable = config.minUsableScenes ?? DEFAULT_MIN_USABLE;

  const declaredAreaHa = input.geometric.declaredVegetationAreaHa;
  const declaredFraction = input.geometric.declaredVegetationFraction;
  const declaredAlarm = declaredAreaHa >= areaThreshold || declaredFraction >= fractionThreshold;

  const flags = [...input.flags];
  const contextLimitations: string[] = [];
  // A tipologia da SEMA cobrindo a AC inteira é mapa de cobertura, não declaração
  // de vegetação nativa: registra-se para quem lê o laudo não confundir os números.
  if (input.geometric.tipologiaCoversWholeAc) {
    contextLimitations.push(
      `TIPOLOGIA_VEGETAL cobre ${(input.geometric.tipologiaFraction * 100).toFixed(0)}% desta AC — ` +
        "camada de cobertura do imóvel, não mancha declarada; " +
        `área declarada considerada apenas de: ${input.geometric.declaredSources.join(", ")}.`
    );
  }
  // A sobreposição com ARL/AUAS vale para QUALQUER veredito: uma AC inteira
  // dentro da Reserva Legal é o fato mais relevante do laudo daquele polígono, e
  // antes só aparecia no ramo de alerta ALTO — nos demais o `flags` ficava mudo
  // e a evidência saía vazia.
  const overlapEvidence: string[] = [];
  if (flags.includes("AC_SOBREPOE_ARL")) {
    const arl = input.geometric.arlAreaHa;
    const share = input.areaHa > 0 ? (arl / input.areaHa) * 100 : 0;
    overlapEvidence.push(
      `A AC sobrepõe Área de Reserva Legal (ARL/ARLREM) declarada: ${arl.toFixed(2)} ha (${share.toFixed(1)}% da AC).`
    );
  }
  if (flags.includes("AC_SOBREPOE_AUAS")) {
    const auas = input.geometric.auasAreaHa;
    const share = input.areaHa > 0 ? (auas / input.areaHa) * 100 : 0;
    overlapEvidence.push(
      `A AC sobrepõe Área de Uso Alternativo do Solo (AUAS) declarada: ${auas.toFixed(2)} ha (${share.toFixed(1)}% da AC).`
    );
  }

  const obs = input.window?.observation?.observations;
  const conflicts = input.window?.observation?.conflicts ?? [];
  const usable = (obs || []).filter((o) => o.vegetationInside !== "NOT_OBSERVABLE" && o.confidence !== "INCONCLUSIVE");
  const reliable = usable.filter((o) => CONFIDENCE_RANK[o.confidence] >= CONFIDENCE_RANK.MEDIUM);
  const visual = aggregateVisual(obs, input.areaHa);

  // 1. Declarada geométrica dentro da AC → ALTO.
  if (declaredAlarm) {
    return {
      polygonId: input.polygonId,
      geometryHash: input.geometryHash,
      areaHa: input.areaHa,
      status: "VEGETACAO_DECLARADA_DENTRO_DA_AC",
      alertLevel: "ALTO",
      geometric: input.geometric,
      visual,
      flags,
      confidence: "HIGH",
      evidence: [
        `O próprio projeto declara vegetação dentro da Área Consolidada: ${declaredAreaHa.toFixed(2)} ha (${(declaredFraction * 100).toFixed(1)}% da AC).`,
        ...overlapEvidence,
      ],
      limitations: contextLimitations,
    };
  }

  // 2) Visão confiável (≥ minUsable cenas) e alguma indica vegetação → veredito por presença.
  const visualVerdict = visual.verdict;
  const positive = reliable.filter((o) => o.vegetationInside === "LARGE_BLOCK" || o.vegetationInside === "PATCHES");
  const negative = reliable.filter((o) => o.vegetationInside === "NONE" || o.vegetationInside === "SPARSE");
  const hasVisualConflict = positive.length > 0 && negative.length > 0;
  const hasVisualVerdictSignal =
    conflicts.length === 0 &&
    !hasVisualConflict &&
    positive.length >= minUsable &&
    (visualVerdict === "LARGE_BLOCK" || visualVerdict === "PATCHES");

  if (hasVisualVerdictSignal) {
    const isLargeBlock = visualVerdict === "LARGE_BLOCK";
    return {
      polygonId: input.polygonId,
      geometryHash: input.geometryHash,
      areaHa: input.areaHa,
      status: "VEGETACAO_APARENTE_DENTRO_DA_AC",
      alertLevel: isLargeBlock ? "ALTO" : "MEDIO",
      geometric: input.geometric,
      visual,
      flags,
      confidence: bestConfidenceOf(usable),
      evidence: [
        `Visão registrou vegetação de aparência nativa dentro da AC em ${usable.filter((o) => o.vegetationInside !== "NONE").length} de ${usable.length} cenas utilizáveis (${visualVerdict}).`,
        "Evidências geométricas não declararam vegetação; conferir em campo.",
      ],
      limitations: contextLimitations,
    };
  }

  // 3) Visão confiável concordando com ausência (≥2 cenas, todas NONE).
  const allNone =
    conflicts.length === 0 &&
    reliable.length >= minUsable &&
    reliable.every((o) => o.vegetationInside === "NONE" || o.vegetationInside === "SPARSE") &&
    !hasVisualConflict;
  if (allNone) {
    return {
      polygonId: input.polygonId,
      geometryHash: input.geometryHash,
      areaHa: input.areaHa,
      status: "SEM_VEGETACAO_APARENTE",
      alertLevel: "NENHUM",
      geometric: input.geometric,
      visual,
      flags,
      // A pior confiança entre as cenas que sustentam a ausência. Fixar "HIGH"
      // aqui carimbava certeza alta num laudo apoiado em cenas MEDIUM.
      confidence: worstConfidenceOf(reliable),
      evidence: [
        `Nenhuma vegetação de aparência nativa observada dentro da AC (${input.areaHa.toFixed(2)} ha) nas cenas utilizáveis.`,
        ...overlapEvidence,
      ],
      limitations: contextLimitations,
    };
  }

  // 4) Cenas insuficiente/conflitiva → INCONCLUSIVO.
  return {
    polygonId: input.polygonId,
    geometryHash: input.geometryHash,
    areaHa: input.areaHa,
    status: "INCONCLUSIVO",
    alertLevel: "INDETERMINADO",
    geometric: input.geometric,
    visual,
    flags,
    confidence: "INCONCLUSIVE",
    // Mesmo sem veredito visual, a evidência geométrica é medida e vale no laudo.
    evidence: overlapEvidence,
    limitations: [
      "Visão sem cenas utilizáveis, cenas conflitantes ou observação insuficiente.",
      ...conflicts,
      ...contextLimitations,
    ],
  };
}
