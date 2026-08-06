/**
 * Estado das 3 fases da análise pós-recorte SIMCAR (tarefa F0.5 do plano
 * `docs/planos/analise-pos-recorte/`).
 *
 * A regra de desbloqueio mora aqui, no backend — o botão desabilitado no front é
 * só reflexo (doc 02 §6). `derivePhases` é pura: recebe contagem de polígonos +
 * os blocos já persistidos no histórico do job e devolve o payload da rota
 * `GET /api/simcar/clip/phases/:jobId` (contrato do doc 08 §1).
 *
 * Nesta rodada só a Fase 1 está implementada; as fases 2 e 3 aparecem com
 * `state: "BLOCKED"` e motivo explícito, nunca escondidas.
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
  | "other_phase_running";

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
};

/** Fase 1: 3 janelas de visão por polígono sobre 6 cenas (2003–2007 + SPOT 2008). */
export const PHASE1_WINDOWS_PER_POLYGON = 3;
export const PHASE1_SCENES_PER_POLYGON = 6;
/** ~2–3 min por polígono medidos na validação live de 2026-07-30 (doc 01 §5). */
export const PHASE1_SECONDS_PER_POLYGON = 150;

const BLOCKED_MESSAGES: Record<PhaseBlockedReason, string> = {
  layer_empty_AUAS: "Este recorte não tem camada AUAS com polígonos.",
  layer_empty_AREA_CONSOLIDADA: "Este recorte não tem Área Consolidada.",
  requires_PRE_2008: "Conclua a Fase 1 (AUAS 2003–2008) para liberar.",
  requires_POS_2008: "Conclua a Fase 2 (AUAS 2008–2019) para liberar.",
  phase_not_implemented: "Fase ainda não disponível nesta versão do GeoForest.",
  phase_running: "Análise desta fase em andamento.",
  other_phase_running: "Aguardando a fase em execução terminar.",
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
 * Fases 2 e 3: por enquanto só a pré-condição encadeada e o aviso de que ainda
 * não existem. Quando forem implementadas, o `phase_not_implemented` sai daqui.
 */
function derivePhase2(input: DerivePhasesInput): PhaseStatus {
  if (input.auasPolygonCount <= 0) return blocked("layer_empty_AUAS");
  if (!isPhase1Completed(input.auasMeta)) return blocked("requires_PRE_2008");
  const stale = isPlainObject(input.auasPos2008Meta);
  return blocked("phase_not_implemented", {
    stale,
    completedAt: stale ? readString((input.auasPos2008Meta as Record<string, unknown>).completedAt) : null,
  });
}

function derivePhase3(input: DerivePhasesInput): PhaseStatus {
  if (input.acPolygonCount <= 0) return blocked("layer_empty_AREA_CONSOLIDADA");
  if (!isPhase1Completed(input.auasMeta)) return blocked("requires_PRE_2008");
  if (!isPlainObject(input.auasPos2008Meta) || !readString((input.auasPos2008Meta as Record<string, unknown>).completedAt)) {
    return blocked("requires_POS_2008");
  }
  const stale = isPlainObject(input.acVegetacaoMeta);
  return blocked("phase_not_implemented", { stale });
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
