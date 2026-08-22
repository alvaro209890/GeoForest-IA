/**
 * Estado das 3 fases da análise pós-recorte SIMCAR (tarefa F0.5 do plano
 * `docs/planos/analise-pos-recorte/`).
 *
 * A regra de desbloqueio mora aqui, no backend — o botão desabilitado no front é
 * só reflexo (doc 02 §6). `derivePhases` é pura: recebe contagem de polígonos +
 * os blocos já persistidos no histórico do job e devolve o payload da rota
 * `GET /api/simcar/clip/phases/:jobId` (contrato do doc 08 §1).
 *
 * A Fase 2 (datação 2008–2019) **não exige** a Fase 1: as duas perguntas são
 * independentes (pré-marco vs. quando a AUAS foi aberta). Sem a Fase 1, a
 * datação trata todos os polígonos AUAS; com ela, os que já tinham alerta
 * pré-2008 entram como contexto. A Fase 3 continua encadeada na Fase 2.
 */

export type PhaseId = "PRE_2008" | "POS_2008" | "AC_VEG";

export type PhaseState = "BLOCKED" | "AVAILABLE" | "RUNNING" | "COMPLETED" | "FAILED" | "STALE";

/** Códigos estáveis de bloqueio — o front escolhe o texto, mas já vem um pronto. */
export type PhaseBlockedReason =
  | "layer_empty_AUAS"
  | "layer_empty_AREA_CONSOLIDADA"
  | "requires_PRE_2008"
  | "requires_POS_2008"
  | "phase_not_implemented"
  | "phase_running"
  | "other_phase_running"
  /** O resultado DESTA fase envelheceu — pode ser refeita agora. */
  | "phase_stale"
  /** A fase ANTERIOR envelheceu — refazer aquela primeiro; esta continua trancada. */
  | "previous_phase_stale";

export type PhaseEstimate = {
  polygons: number;
  scenesPerPolygon: number;
  windowsPerPolygon: number;
  etaSeconds: number;
};

export type PhaseStatus = {
  state: PhaseState;
  blockedReason: PhaseBlockedReason | null;
  blockedMessage: string | null;
  rulesVersion: string | null;
  completedAt: string | null;
  /** Resultado de uma execução anterior que a fase anterior invalidou. */
  stale: boolean;
  summary: Record<string, number | string | boolean> | null;
  estimate: PhaseEstimate | null;
};

export type PhasesResponse = {
  jobId: string;
  layers: { auasPolygonCount: number; acPolygonCount: number };
  phases: Record<PhaseId, PhaseStatus>;
};

export type DerivePhasesInput = {
  jobId: string;
  auasPolygonCount: number;
  acPolygonCount: number;
  /** Blocos persistidos no histórico do job (`users/<uid>/simcar_clips/<jobId>.json`). */
  auasMeta?: unknown;
  auasPos2008Meta?: unknown;
  acVegetacaoMeta?: unknown;
  /** Fase em execução agora para este job, quando conhecida. */
  runningPhase?: PhaseId | null;
  /** Flags de disponibilidade; ausentes preservam o comportamento puro/offline. */
  pos2008Enabled?: boolean;
  acVegetacaoEnabled?: boolean;
};

/** Fase 1: 3 janelas de visão por polígono sobre 6 cenas (2003–2007 + SPOT 2008). */
export const PHASE1_WINDOWS_PER_POLYGON = 3;
export const PHASE1_SCENES_PER_POLYGON = 6;
/** ~2–3 min por polígono medidos na validação live de 2026-07-30 (doc 01 §5). */
export const PHASE1_SECONDS_PER_POLYGON = 150;

/** Fase 2: 5 janelas de visão + até 1 janela-ponte por polígono, 2 cenas cada. */
export const PHASE2_WINDOWS_PER_POLYGON = 5;
export const PHASE2_BRIDGE_WINDOWS_PER_POLYGON = 1;
export const PHASE2_SCENES_PER_POLYGON = 12;
/** ~4–5 min por polígono (5 janelas + ponte, 2 cenas por janela). */
export const PHASE2_SECONDS_PER_POLYGON = 280;

/** Fase 3: 1 janela (WAVAC_ATUAL) com 3 cenas por polígono AC pós-2008. */
export const PHASE3_WINDOWS_PER_POLYGON = 1;
export const PHASE3_SCENES_PER_POLYGON = 3;
/** ~1 min por polígono (1 janela de 3 cenas + geometria determinística). */
export const PHASE3_SECONDS_PER_POLYGON = 60;

const BLOCKED_MESSAGES: Record<PhaseBlockedReason, string> = {
  layer_empty_AUAS: "Este recorte não tem camada AUAS com polígonos.",
  layer_empty_AREA_CONSOLIDADA: "Este recorte não tem Área Consolidada.",
  requires_PRE_2008: "Conclua a Fase 1 (AUAS 2003–2008) para liberar.",
  requires_POS_2008: "Conclua a Fase 2 (AUAS 2008–2019) para liberar.",
  phase_not_implemented: "Fase ainda não disponível nesta versão do GeoForest.",
  phase_running: "Análise desta fase em andamento.",
  other_phase_running: "Aguardando a fase em execução terminar.",
  phase_stale: "O resultado anterior ficou desatualizado. Refaça esta fase.",
  previous_phase_stale: "A fase anterior ficou desatualizada. Refaça a fase anterior para liberar esta.",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Fase 1 concluída = bloco V2 persistido com `completedAt`. Card antigo (V1,
 * sem `schemaVersion`) não conta: a janela dele é 2008–2024, outra pergunta.
 */
export function isPhase1Completed(auasMeta: unknown): boolean {
  return isPlainObject(auasMeta) && auasMeta.schemaVersion === 2 && !!readString(auasMeta.completedAt);
}

function phase1Summary(auasMeta: unknown): PhaseStatus["summary"] {
  if (!isPlainObject(auasMeta)) return null;
  const summary = isPlainObject(auasMeta.summary) ? auasMeta.summary : {};
  return {
    polygonCount: readNumber(summary.polygonCount),
    alertCount: readNumber(summary.alertCount),
    inconclusiveCount: readNumber(summary.inconclusiveCount),
    noEvidenceCount: readNumber(summary.noEvidenceCount),
    status: readString(auasMeta.status) || "INCONCLUSIVO",
    pre2008Alert: auasMeta.pre2008Alert === true,
  };
}

function blocked(reason: PhaseBlockedReason, extra: Partial<PhaseStatus> = {}): PhaseStatus {
  return {
    state: "BLOCKED",
    blockedReason: reason,
    blockedMessage: BLOCKED_MESSAGES[reason],
    rulesVersion: null,
    completedAt: null,
    stale: false,
    summary: null,
    estimate: null,
    ...extra,
  };
}

export function estimatePhase1(polygons: number): PhaseEstimate {
  return {
    polygons,
    scenesPerPolygon: PHASE1_SCENES_PER_POLYGON,
    windowsPerPolygon: PHASE1_WINDOWS_PER_POLYGON,
    etaSeconds: polygons * PHASE1_SECONDS_PER_POLYGON,
  };
}

export function estimatePhase2(polygons: number): PhaseEstimate {
  return {
    polygons,
    scenesPerPolygon: PHASE2_SCENES_PER_POLYGON,
    windowsPerPolygon: PHASE2_WINDOWS_PER_POLYGON + PHASE2_BRIDGE_WINDOWS_PER_POLYGON,
    etaSeconds: polygons * PHASE2_SECONDS_PER_POLYGON,
  };
}

export function estimatePhase3(polygons: number): PhaseEstimate {
  return {
    polygons,
    scenesPerPolygon: PHASE3_SCENES_PER_POLYGON,
    windowsPerPolygon: PHASE3_WINDOWS_PER_POLYGON,
    etaSeconds: polygons * PHASE3_SECONDS_PER_POLYGON,
  };
}

function phase2Summary(meta: Record<string, unknown>): PhaseStatus["summary"] {
  const summary = isPlainObject(meta.summary) ? (meta.summary as Record<string, unknown>) : {};
  const areaByStatus = isPlainObject(summary.areaByStatusHa)
    ? (summary.areaByStatusHa as Record<string, unknown>)
    : {};
  const yearHistogram = isPlainObject(summary.yearHistogram)
    ? (summary.yearHistogram as Record<string, unknown>)
    : {};
  const topYears = Object.entries(yearHistogram)
    .map(([year, v]) => ({
      year: Number(year),
      count: readNumber(isPlainObject(v) ? v.count : v),
    }))
    .filter((y) => y.year >= 2009 && y.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((y) => `${y.year}(${y.count})`)
    .join(", ");
  const catalogVersion = readString(
    meta.catalog && typeof meta.catalog === "object" ? (meta.catalog as Record<string, unknown>).version : null
  );
  return {
    polygonCount: readNumber(summary.polygonCount),
    confirmedYearCount: readNumber(summary.confirmedYearCount),
    intervalCount: readNumber(summary.intervalCount),
    alreadyAnthropizedCount: readNumber(summary.alreadyAnthropizedCount),
    noChangeCount: readNumber(summary.noChangeCount),
    inconclusiveCount: readNumber(summary.inconclusiveCount),
    totalAuasAreaHa: readNumber(summary.totalAuasAreaHa),
    areaByStatusHa: JSON.stringify(areaByStatus),
    catalogVersion: catalogVersion || "",
    topYears,
  };
}

function acSummary(meta: Record<string, unknown>): PhaseStatus["summary"] {
  const summary = isPlainObject(meta.summary) ? (meta.summary as Record<string, unknown>) : {};
  return {
    polygonCount: readNumber(summary.polygonCount),
    declaredVegetationCount: readNumber(summary.declaredVegetationCount),
    declaredVegetationAreaHa: readNumber(summary.declaredVegetationAreaHa),
    apparentVegetationCount: readNumber(summary.apparentVegetationCount),
    cleanCount: readNumber(summary.cleanCount),
    inconclusiveCount: readNumber(summary.inconclusiveCount),
    totalAcAreaHa: readNumber(summary.totalAcAreaHa),
  };
}

function derivePhase1(input: DerivePhasesInput): PhaseStatus {
  if (input.runningPhase === "PRE_2008") {
    return {
      ...blocked("phase_running"),
      state: "RUNNING",
      estimate: estimatePhase1(input.auasPolygonCount),
    };
  }
  if (input.auasPolygonCount <= 0) return blocked("layer_empty_AUAS");
  if (isPhase1Completed(input.auasMeta)) {
    const meta = input.auasMeta as Record<string, unknown>;
    return {
      state: "COMPLETED",
      blockedReason: null,
      blockedMessage: null,
      rulesVersion: readString(meta.rulesVersion),
      completedAt: readString(meta.completedAt),
      stale: false,
      summary: phase1Summary(meta),
      estimate: estimatePhase1(input.auasPolygonCount),
    };
  }
  if (input.runningPhase) return blocked("other_phase_running");
  return {
    state: "AVAILABLE",
    blockedReason: null,
    blockedMessage: null,
    rulesVersion: null,
    completedAt: null,
    stale: false,
    summary: null,
    estimate: estimatePhase1(input.auasPolygonCount),
  };
}

/**
 * Fase 2 — datação 2009–2019 das AUAS. Não depende da Fase 1: dá para datar
 * a supressão sem ter classificado o pré-2008. Se a Fase 1 já rodou, o
 * orquestrador usa o alerta como contexto (`alreadyAnthropized`).
 */
function derivePhase2(input: DerivePhasesInput): PhaseStatus {
  if (input.auasPolygonCount <= 0) return blocked("layer_empty_AUAS");

  const meta = isPlainObject(input.auasPos2008Meta) ? (input.auasPos2008Meta as Record<string, unknown>) : null;
  const completedAt = meta ? readString(meta.completedAt) : null;

  if (input.runningPhase === "POS_2008") {
    return {
      ...blocked("phase_running"),
      state: "RUNNING",
      estimate: estimatePhase2(input.auasPolygonCount),
    };
  }

  if (meta && completedAt) {
    const summary = phase2Summary(meta);
    const stale = isStaleAfter(meta, input.auasMeta, "pre2008JobRef");
    if (stale) {
      return blocked("phase_stale", {
        state: "STALE",
        stale: true,
        rulesVersion: readString(meta.rulesVersion),
        completedAt,
        summary,
        estimate: estimatePhase2(input.auasPolygonCount),
      });
    }
    return {
      state: "COMPLETED",
      blockedReason: null,
      blockedMessage: null,
      rulesVersion: readString(meta.rulesVersion),
      completedAt,
      stale: false,
      summary,
      estimate: estimatePhase2(input.auasPolygonCount),
    };
  }

  if (input.runningPhase) return blocked("other_phase_running");
  if (input.pos2008Enabled === false) return blocked("phase_not_implemented");
  return {
    state: "AVAILABLE",
    blockedReason: null,
    blockedMessage: null,
    rulesVersion: null,
    completedAt: null,
    stale: false,
    summary: null,
    estimate: estimatePhase2(input.auasPolygonCount),
  };
}

function derivePhase3(input: DerivePhasesInput): PhaseStatus {
  if (input.acPolygonCount <= 0) return blocked("layer_empty_AREA_CONSOLIDADA");
  if (!isPhase1Completed(input.auasMeta)) return blocked("requires_PRE_2008");

  const pos2008Meta = isPlainObject(input.auasPos2008Meta) ? (input.auasPos2008Meta as Record<string, unknown>) : null;
  if (!pos2008Meta || !readString(pos2008Meta.completedAt)) return blocked("requires_POS_2008");

  if (input.runningPhase && input.runningPhase !== "AC_VEG") return blocked("other_phase_running");
  // Fase 2 envelhecida: a Fase 3 consumiria uma datação que já não corresponde ao
  // recorte. Motivo próprio (`previous_phase_stale`) porque, ao contrário do
  // `phase_stale`, refazer ESTA fase não resolve — quem tem de rodar é a Fase 2.
  if (isStaleAfter(pos2008Meta, input.auasMeta, "pre2008JobRef")) {
    return blocked("previous_phase_stale", {
      state: "STALE",
      stale: true,
      estimate: estimatePhase3(input.acPolygonCount),
    });
  }

  const meta = isPlainObject(input.acVegetacaoMeta) ? (input.acVegetacaoMeta as Record<string, unknown>) : null;
  const hasAcCompleted = meta && readString(meta.completedAt);

  if (input.runningPhase === "AC_VEG") {
    return {
      ...blocked("phase_running"),
      state: "RUNNING",
      estimate: estimatePhase3(input.acPolygonCount),
    };
  }

  if (meta && hasAcCompleted) {
    const stale = isStaleAfter(meta, pos2008Meta, "pos2008JobRef");
    if (stale) {
      return blocked("phase_stale", {
        state: "STALE",
        stale: true,
        rulesVersion: readString(meta.rulesVersion),
        completedAt: hasAcCompleted,
        summary: acSummary(meta),
        estimate: estimatePhase3(input.acPolygonCount),
      });
    }
    return {
      state: "COMPLETED",
      blockedReason: null,
      blockedMessage: null,
      rulesVersion: readString(meta.rulesVersion),
      completedAt: hasAcCompleted,
      stale: false,
      summary: acSummary(meta),
      estimate: estimatePhase3(input.acPolygonCount),
    };
  }

  if (input.runningPhase) return blocked("other_phase_running");
  if (input.acVegetacaoEnabled === false) return blocked("phase_not_implemented");
  return {
    state: "AVAILABLE",
    blockedReason: null,
    blockedMessage: null,
    rulesVersion: null,
    completedAt: null,
    stale: false,
    summary: null,
    estimate: estimatePhase3(input.acPolygonCount),
  };
}

/**
 * Bloco desta fase existe mas a fase anterior foi refeita (completedAt mais
 * recente) ⇒ resultado já não reflete o recorte atual.
 */
function isStaleAfter(
  meta: unknown,
  previousMeta: unknown,
  referenceKey: "pre2008JobRef" | "pos2008JobRef",
): boolean {
  if (!isPlainObject(meta) || !isPlainObject(previousMeta)) return false;
  const thisCompleted = readString(meta.completedAt);
  const prevCompleted = readString(previousMeta.completedAt);
  if (!thisCompleted || !prevCompleted) return false;
  const reference = isPlainObject(meta[referenceKey]) ? meta[referenceKey] : null;
  const referencedCompleted = reference ? readString(reference.completedAt) : null;
  if (referencedCompleted) return referencedCompleted !== prevCompleted;
  return new Date(prevCompleted).getTime() > new Date(thisCompleted).getTime();
}

export function derivePhases(input: DerivePhasesInput): PhasesResponse {
  return {
    jobId: input.jobId,
    layers: {
      auasPolygonCount: input.auasPolygonCount,
      acPolygonCount: input.acPolygonCount,
    },
    phases: {
      PRE_2008: derivePhase1(input),
      POS_2008: derivePhase2(input),
      AC_VEG: derivePhase3(input),
    },
  };
}

/**
 * Gate das rotas de fase: a porta trancada é a rota, não o botão (doc 02 §6).
 * Devolve `null` quando a fase pode rodar.
 */
export function checkPhaseGate(
  phases: PhasesResponse,
  phase: PhaseId
): { status: number; body: { error: string; code: string; requires?: PhaseId } } | null {
  const status = phases.phases[phase];
  if (status.state === "AVAILABLE" || status.state === "COMPLETED") return null;
  // STALE do próprio resultado libera: o estado diz "Refaça esta fase", então a
  // rota tem de aceitar a re-execução. Recusar trancava a fase para sempre —
  // refazer a fase anterior só deixava esta ainda mais velha. Já o STALE herdado
  // (`previous_phase_stale`) continua barrado: quem precisa rodar é a fase de trás.
  if (status.state === "STALE" && status.blockedReason === "phase_stale") return null;
  if (status.blockedReason === "phase_running") {
    return {
      status: 409,
      body: { error: BLOCKED_MESSAGES.phase_running, code: "PHASE_ALREADY_RUNNING" },
    };
  }
  if (status.blockedReason === "requires_PRE_2008" || status.blockedReason === "requires_POS_2008") {
    return {
      status: 409,
      body: {
        error: status.blockedMessage || "Fase anterior não concluída.",
        code: "PHASE_NOT_READY",
        requires: status.blockedReason === "requires_PRE_2008" ? "PRE_2008" : "POS_2008",
      },
    };
  }
  return {
    status: 409,
    body: { error: status.blockedMessage || "Fase indisponível.", code: "PHASE_NOT_READY" },
  };
}
