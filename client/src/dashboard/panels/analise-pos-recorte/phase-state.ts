/**
 * Estado de exibição das 3 fases da análise pós-recorte SIMCAR.
 *
 * A regra de desbloqueio é do backend (`GET /api/simcar/clip/phases/:jobId`) —
 * aqui só se traduz o payload em cards. Nada de decidir liberação no front:
 * botão desabilitado é conveniência, a porta trancada é a rota
 * (`docs/planos/analise-pos-recorte/02-arquitetura.md` §6).
 */

export type PhaseId = 'PRE_2008' | 'POS_2008' | 'AC_VEG';

export type PhaseState = 'BLOCKED' | 'AVAILABLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE';

export type PhaseEstimate = {
  polygons: number;
  scenesPerPolygon: number;
  windowsPerPolygon: number;
  etaSeconds: number;
};

export type PhaseStatus = {
  state: PhaseState;
  blockedReason: string | null;
  blockedMessage: string | null;
  rulesVersion: string | null;
  completedAt: string | null;
  stale: boolean;
  summary: Record<string, number | string | boolean> | null;
  estimate: PhaseEstimate | null;
};

export type PhasesResponse = {
  jobId: string;
  layers: { auasPolygonCount: number; acPolygonCount: number };
  phases: Record<PhaseId, PhaseStatus>;
};

export type PhaseCard = {
  id: PhaseId;
  order: 1 | 2 | 3;
  title: string;
  question: string;
  state: PhaseState;
  /** Prévia do que a fase vai fazer, antes do clique. */
  preview: string;
  /** Resultado quando a fase já rodou. */
  resultLine: string | null;
  /** Motivo do bloqueio, sempre em texto — nunca botão morto sem explicação. */
  blockedMessage: string | null;
  actionLabel: string;
  actionEnabled: boolean;
  /** `true` quando a fase ainda não existe nesta versão (não é bloqueio do usuário). */
  notImplemented: boolean;
  stale: boolean;
};

const PHASE_TITLES: Record<PhaseId, { order: 1 | 2 | 3; title: string; question: string }> = {
  PRE_2008: {
    order: 1,
    title: 'Análise de AUAS (2003–2008)',
    question: 'Já havia desmate ou antropização antes do marco de 2008?',
  },
  POS_2008: {
    order: 2,
    title: 'Quando ocorreu o desmate (2008–2019)',
    question: 'Em que ano a vegetação virou uso antrópico?',
  },
  AC_VEG: {
    order: 3,
    title: 'Vegetação dentro da Área Consolidada',
    question: 'Sobrou vegetação nativa dentro da AC declarada?',
  },
};

export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `~${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours} h ${rest} min` : `~${hours} h`;
}

export function formatCompletedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function previewFor(id: PhaseId, status: PhaseStatus | undefined, layers: PhasesResponse['layers'] | null): string {
  const estimate = status?.estimate;
  if (id === 'PRE_2008') {
    const polygons = estimate?.polygons ?? layers?.auasPolygonCount ?? 0;
    if (polygons <= 0) return 'Nenhum polígono AUAS neste recorte.';
    const scenes = estimate?.scenesPerPolygon ?? 6;
    const eta = estimate ? ` · ${formatEta(estimate.etaSeconds)}` : '';
    return `${polygons} polígono(s) AUAS · ${scenes} imagens cada${eta}`;
  }
  if (id === 'POS_2008') {
    const est = status?.estimate;
    const polygons = est?.polygons ?? layers?.auasPolygonCount ?? 0;
    if (polygons <= 0) return 'Nenhum polígono AUAS neste recorte.';
    const janelas = est?.windowsPerPolygon ?? 6;
    const eta = est ? ` · ${formatEta(est.etaSeconds)}` : '';
    return `${polygons} polígono(s) AUAS · ${janelas} janelas cada${eta}`;
  }
  const est3 = status?.estimate;
  const polygonsAc = est3?.polygons ?? layers?.acPolygonCount ?? 0;
  if (polygonsAc <= 0) return 'Este recorte não tem Área Consolidada.';
  const cenas3 = est3?.scenesPerPolygon ?? 3;
  const eta3 = est3 ? ` · ${formatEta(est3.etaSeconds)}` : '';
  return `${polygonsAc} Área(s) Consolidada(s) · cruzamento com AVN + ${cenas3} imagens${eta3}`;
}

function resultLineFor(id: PhaseId, status: PhaseStatus | undefined): string | null {
  if (!status || status.state !== 'COMPLETED') return null;
  const quando = formatCompletedAt(status.completedAt);
  const prefixo = quando ? `Concluída em ${quando}` : 'Concluída';
  const summary = status.summary;
  if (id === 'PRE_2008') {
    if (!summary) return prefixo;
    const alertas = Number(summary.alertCount || 0);
    const inconclusivos = Number(summary.inconclusiveCount || 0);
    const partes = [
      alertas > 0 ? `${alertas} com evidência pré-2008` : 'nenhuma evidência pré-2008',
      inconclusivos > 0 ? `${inconclusivos} inconclusivo(s)` : '',
    ].filter(Boolean);
    return `${prefixo} — ${partes.join(' · ')}`;
  }
  if (id === 'POS_2008') {
    if (!summary) return prefixo;
    const confirmados = Number(summary.confirmedYearCount || 0);
    const intervalos = Number(summary.intervalCount || 0);
    const jaAntrop = Number(summary.alreadyAnthropizedCount || 0);
    const partes = [
      confirmados > 0 ? `${confirmados} ano confirmado` : '',
      intervalos > 0 ? `${intervalos} intervalo` : '',
      jaAntrop > 0 ? `${jaAntrop} já antropizado em 2009` : '',
    ].filter(Boolean);
    return `${prefixo} — ${partes.join(' · ') || 'sem datação'}`;
  }
  if (!summary) return prefixo;
  const declaradas = Number(summary.declaredVegetationCount || 0);
  const aparentes = Number(summary.apparentVegetationCount || 0);
  const limpas = Number(summary.cleanCount || 0);
  const partes = [
    declaradas > 0 ? `${declaradas} declaradas` : '',
    aparentes > 0 ? `${aparentes} aparentes` : '',
    limpas > 0 ? `${limpas} limpas` : '',
  ].filter(Boolean);
  return `${prefixo} — ${partes.join(' · ') || 'sem vegetação aparente'}`;
}

/** Bloco V2 da Fase 1 já concluído? Card antigo (V1) não conta — outra janela. */
export function isPhase1MetaCompleted(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const record = meta as Record<string, unknown>;
  return record.schemaVersion === 2 && typeof record.completedAt === 'string' && record.completedAt.length > 0;
}

export type BuildPhaseCardsOptions = {
  /** Fase 1 em execução agora nesta aba (estado local do SSE). */
  runningPhase?: PhaseId | null;
  /** Consulta ao servidor ainda em andamento. */
  loading?: boolean;
  /** Consulta ao servidor falhou — não pode sumir com o botão da Fase 1. */
  error?: boolean;
  /** Contagem conhecida antes da resposta do servidor (fallback). */
  fallbackLayers?: PhasesResponse['layers'] | null;
};

export function buildPhaseCards(
  payload: PhasesResponse | null,
  options: BuildPhaseCardsOptions = {},
): PhaseCard[] {
  const layers = payload?.layers ?? options.fallbackLayers ?? null;
  const ids: PhaseId[] = ['PRE_2008', 'POS_2008', 'AC_VEG'];

  return ids.map((id) => {
    const meta = PHASE_TITLES[id];
    const status = payload?.phases?.[id];
    const running = options.runningPhase === id;
    const otherRunning = !!options.runningPhase && !running;

    let state: PhaseState = status?.state ?? 'BLOCKED';
    let blockedMessage = status?.blockedMessage ?? null;
    let actionEnabled = state === 'AVAILABLE' || state === 'COMPLETED';
    const notImplemented = status?.blockedReason === 'phase_not_implemented' || false;

    if (!payload) {
      if (options.loading) {
        state = 'BLOCKED';
        blockedMessage = 'Consultando o estado das fases…';
        actionEnabled = false;
      } else if (options.error) {
        // Falha de consulta não pode esconder a Fase 1: ela continua clicável.
        state = id === 'PRE_2008' ? 'AVAILABLE' : 'BLOCKED';
        blockedMessage =
          id === 'PRE_2008'
            ? 'Não foi possível consultar o estado das fases; a Fase 1 continua disponível.'
            : 'Estado das fases indisponível no momento.';
        actionEnabled = id === 'PRE_2008';
      } else {
        blockedMessage = 'Conclua o recorte para liberar as análises.';
        actionEnabled = false;
      }
    }

    if (running) {
      state = 'RUNNING';
      actionEnabled = false;
      blockedMessage = null;
    } else if (otherRunning && state !== 'COMPLETED') {
      actionEnabled = false;
      blockedMessage = `Aguardando a Fase ${PHASE_TITLES[options.runningPhase as PhaseId].order} terminar.`;
    }

    if (notImplemented) actionEnabled = false;

    let actionLabel = 'Analisar';
    if (running) actionLabel = 'Analisando…';
    else if (state === 'COMPLETED') actionLabel = 'Refazer';
    else if (id !== 'PRE_2008') actionLabel = 'Continuar';

    return {
      id,
      order: meta.order,
      title: meta.title,
      question: meta.question,
      state,
      preview: previewFor(id, status, layers),
      resultLine: resultLineFor(id, status),
      blockedMessage,
      actionLabel,
      actionEnabled,
      notImplemented,
      stale: status?.stale === true,
    };
  });
}
