/**
 * Estado das 3 fases da análise pós-recorte SIMCAR (tarefa F0.5 do plano
 * `docs/planos/analise-pos-recorte/`).
 *
 * A regra de desbloqueio mora aqui, no backend — o botão desabilitado no front é
 * só reflexo (doc 02 §6). `derivePhases` é pura: recebe contagem de polígonos +
 * os blocos já persistidos no histórico do job e devolve o payload da rota
 * `GET /api/simcar/clip/phases/:jobId` (contrato do doc 08 §1).
 *
 * **As 3 fases são independentes entre si** (pedido do Álvaro, 2026-08-23):
 * cada uma responde a uma pergunta própria e nenhuma tranca a outra.
 *   F1  o polígono AUAS já era usado antes de 22/07/2008?
 *   F2  em que ano a supressão ocorreu (2009–2019)?
 *   F3  sobrou vegetação nativa dentro da Área Consolidada declarada?
 * O único pré-requisito de cada fase é a **camada que ela lê** (AUAS para F1/F2,
 * AREA_CONSOLIDADA para F3) e não haver outra fase rodando no mesmo job.
 *
 * Quando uma fase vizinha já rodou, o resultado dela entra como **contexto**
 * (a F2 usa o alerta pré-2008 da F1; a F3 usa a data da F2 quando existe, e
 * `null` quando não existe) — contexto opcional, nunca requisito.
 */

export type PhaseId = "PRE_2008" | "POS_2008" | "AC_VEG";

/**
 * `STALE` sobrevive no contrato (o front já o trata e payloads antigos podem
 * trazê-lo), mas nada mais o emite: ele só existia para invalidação cruzada
 * entre fases, que acabou junto com o encadeamento.
 */
export type PhaseState = "BLOCKED" | "AVAILABLE" | "RUNNING" | "COMPLETED" | "FAILED" | "STALE";

/** Códigos estáveis de bloqueio — o front escolhe o texto, mas já vem um pronto. */
export type PhaseBlockedReason =
  | "layer_empty_AUAS"
  | "layer_empty_AREA_CONSOLIDADA"
  | "phase_not_implemented"
  | "phase_running"
  | "other_phase_running";

export type PhaseEstimate = {
  polygons: number;
  scenesPerPolygon: number;
  windowsPerPolygon: number;
  etaSeconds: number;
};

/** Laudo já gerado por esta fase (`phaseReports[fase]` no JSON do job). */
export type PhaseReportLinks = {
  pdfUrl: string;
  docxUrl: string | null;
  generatedAt: string | null;
  filename: string | null;
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
  /** `null` enquanto a fase não gerou laudo. Cada fase guarda o seu. */
  report: PhaseReportLinks | null;
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
  /** `phaseReports` do JSON do job — laudo já gerado por fase. */
  phaseReports?: unknown;
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
    report: null,
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
      report: null,
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
    report: null,
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
    // Refazer a Fase 1 não invalida esta datação: são perguntas independentes
    // (pré-marco vs. em que ano). O botão continua "Refazer" para quem quiser.
    return {
      state: "COMPLETED",
      blockedReason: null,
      blockedMessage: null,
      rulesVersion: readString(meta.rulesVersion),
      completedAt,
      stale: false,
      report: null,
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
    report: null,
    summary: null,
    estimate: estimatePhase2(input.auasPolygonCount),
  };
}

/**
 * Fase 3 — vegetação remanescente na Área Consolidada. Depende só da camada
 * AREA_CONSOLIDADA: o orquestrador já aceita `pos2008CompletedAt: null` quando
 * a Fase 2 não rodou (ele apenas não carimba a referência de datação no laudo).
 * Antes ela exigia F1 **e** F2 concluídas — trancava a pergunta mais simples
 * das três atrás de ~7 min de análise que não respondem a ela.
 */
function derivePhase3(input: DerivePhasesInput): PhaseStatus {
  if (input.acPolygonCount <= 0) return blocked("layer_empty_AREA_CONSOLIDADA");

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
    return {
      state: "COMPLETED",
      blockedReason: null,
      blockedMessage: null,
      rulesVersion: readString(meta.rulesVersion),
      completedAt: hasAcCompleted,
      stale: false,
      report: null,
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
    report: null,
    summary: null,
    estimate: estimatePhase3(input.acPolygonCount),
  };
}

export function readPhaseReport(phaseReports: unknown, phase: PhaseId): PhaseReportLinks | null {
  if (!isPlainObject(phaseReports)) return null;
  const artifact = phaseReports[phase];
  if (!isPlainObject(artifact)) return null;
  const pdfUrl = readString(artifact.reportPdfUrl);
  if (!pdfUrl) return null;
  return {
    pdfUrl,
    docxUrl: readString(artifact.reportDocxUrl),
    generatedAt: readString(artifact.reportPdfGeneratedAt),
    filename: readString(artifact.reportPdfFilename),
  };
}

export function derivePhases(input: DerivePhasesInput): PhasesResponse {
  const withReport = (phase: PhaseId, status: PhaseStatus): PhaseStatus => ({
    ...status,
    report: readPhaseReport(input.phaseReports, phase),
  });
  return {
    jobId: input.jobId,
    layers: {
      auasPolygonCount: input.auasPolygonCount,
      acPolygonCount: input.acPolygonCount,
    },
    phases: {
      PRE_2008: withReport("PRE_2008", derivePhase1(input)),
      POS_2008: withReport("POS_2008", derivePhase2(input)),
      AC_VEG: withReport("AC_VEG", derivePhase3(input)),
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
  // Uma fase por job, sempre. Com as 3 independentes esta é a ÚNICA exclusão que
  // resta — e ela virou obrigatória aqui: uma fase já COMPLETED continua
  // COMPLETED enquanto outra roda (o resultado existe), então sem esta checagem
  // o "Refazer" dela iniciaria uma segunda análise em paralelo, e as duas
  // gravam o mesmo JSON do job (`persistSimcarClipArtifacts`) — lost update.
  const outraRodando = (Object.keys(phases.phases) as PhaseId[]).some(
    (id) => id !== phase && phases.phases[id].state === "RUNNING"
  );
  if (outraRodando) {
    return {
      status: 409,
      body: { error: BLOCKED_MESSAGES.other_phase_running, code: "PHASE_ALREADY_RUNNING" },
    };
  }
  if (status.state === "AVAILABLE" || status.state === "COMPLETED") return null;
  // Nenhuma fase depende de outra, então STALE só pode ser do próprio resultado
  // e sempre libera a re-execução — recusar trancaria a fase para sempre.
  if (status.state === "STALE") return null;
  if (status.blockedReason === "phase_running") {
    return {
      status: 409,
      body: { error: BLOCKED_MESSAGES.phase_running, code: "PHASE_ALREADY_RUNNING" },
    };
  }
  return {
    status: 409,
    body: { error: status.blockedMessage || "Fase indisponível.", code: "PHASE_NOT_READY" },
  };
}
