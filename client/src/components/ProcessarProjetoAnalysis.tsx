import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  FileArchive,
  FileStack,
  FileText,
  Loader2,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  StopCircle,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean }
) => Promise<Response>;

type GeometryLayer = {
  id: string;
  name: string;
  geometryType: string;
  featureCount: number;
  crsLabel: string;
  ignoredReason?: string;
};

type MunicipioDetectado = {
  nome: string | null;
  ibge: string | null;
  fonte: "malha-ibge" | "wfs-sema" | "manual" | "nao-detectado";
  chaveSimcar?: string | number;
};

type MunicipioOption = {
  chave: string | number;
  nome: string;
  ibge: string | null;
};

type ShapePreview = {
  bbox: [number, number, number, number];
  centroid: [number, number];
  areaHaApprox?: number;
  layers: string[];
  propertyLayer?: string;
  municipioDetectado: MunicipioDetectado;
  warnings: string[];
  crs?: string;
};

type OraculoHealth = {
  testCarId: string;
  simcarConfigured: boolean;
  deepseekConfigured: boolean;
  queueLength: number;
};

type OraculoEvent = {
  step: string;
  message: string;
  percent?: number;
  data?: Record<string, unknown>;
  ts: string;
  round: number;
};

type ErrorSummary = {
  camada: string;
  erro: string;
  qtd: number;
};

type FixActionType =
  | "remove_duplicate_vertices"
  | "clean_degenerate_rings"
  | "unkink_self_intersection"
  | "remove_glued_holes"
  | "clip_layer_to_cover"
  | "split_complex_polygon";

type FixAction = {
  type: FixActionType;
  layers: string[];
  motivo: string;
};

type FixPlan = {
  acoes: FixAction[];
  naoCorrigivel: Array<{
    erro: string;
    porque: string;
    orientacao: string;
  }>;
  explicacaoUsuario: string;
  confianca: "alta" | "media" | "baixa";
  fonte: "deepseek" | "fallback";
  modelo: string | null;
  avisos: string[];
};

type FixDiffSummary = {
  camada: string;
  acao: Exclude<FixActionType, "clip_layer_to_cover">;
  alterou: boolean;
  feicoesAfetadas: number[];
  registrosAntes: number;
  registrosDepois: number;
  verticesRemovidos: number;
  aneisRemovidos: number;
  registrosRemovidos: number;
  registrosCriados: number;
  identificadoresCriados: number;
  avisos: string[];
};

type RoundPhase = {
  ok: boolean;
  resultado: string;
  status: string;
  detalhes: string;
  pdf: string | null;
  errosZip?: string | null;
  errosResumo: ErrorSummary[];
  parseWarnings: string[];
};

type OraculoRound = {
  n: number;
  zipArtifact: string;
  import: RoundPhase | null;
  process: RoundPhase | null;
  artifactWarnings?: string[];
  fixplan?: string | null;
  fixPlan?: FixPlan | null;
  diffResumo?: FixDiffSummary[];
  autofixPhase?: "import" | "process" | null;
};

type OraculoArtifact = {
  key: string;
  round: number;
  filename: string;
  url: string;
  contentType: string;
  bytes: number;
  source: "upload" | "sema" | "autofix";
};

type OraculoJob = {
  jobId: string;
  type?: string;
  status: string;
  stage?: string;
  ok?: boolean | null;
  importOk?: boolean | null;
  processOk?: boolean | null;
  resultado?: string;
  error?: string | null;
  message?: string;
  percent?: number | null;
  uploadId?: string;
  sourceFilename?: string;
  filename?: string;
  testCarId?: string;
  queuePosition?: number;
  round?: number;
  maxRounds?: number;
  rounds?: OraculoRound[];
  artifacts?: Record<string, OraculoArtifact>;
  timeline?: OraculoEvent[];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  autofixStopReason?: string | null;
  autofixStopMessage?: string | null;
  manualAutofixAvailable?: boolean;
  manualAutofixReason?: string | null;
};

type RoundHistorySummary = {
  n: number;
  importOk: boolean | null;
  processOk: boolean | null;
  importResult?: string;
  processResult?: string;
  artifactKeys: string[];
};

export type ProcessarHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  status:
    | "processing"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "cancel_requested"
    | "interrupted"
    | "uploaded"
    | "deleted"
    | "queued"
    | "import_ok"
    | "import_failed";
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  type?: string;
  uploadId?: string;
  importId?: string;
  downloadUrl?: string;
  importPdfUrl?: string;
  resultRows?: Array<Record<string, unknown>>;
  importRows?: Array<Record<string, unknown>>;
  warnings?: string[];
  camadasReconhecidas?: Array<Record<string, unknown>>;
  importOk?: boolean | null;
  processOk?: boolean | null;
  importErrors?: number;
  processErrors?: number;
  totalErrors?: number;
  relatorioTexto?: string;
  resultado?: string;
  roundCount?: number;
  roundsSummary?: RoundHistorySummary[];
  artifactRefs?: OraculoArtifact[];
  sourceCollection?: "simcar_oraculo_jobs" | "processar_projeto_jobs";
};

type Props = {
  apiFetch: ApiFetch;
  onJobSnapshot?: (job: Record<string, unknown>) => void;
  selectedJobId?: string | null;
  historyEntry?: ProcessarHistoryItem | null;
};

type DraftState = {
  file: File | null;
  filename: string;
  fileSize: number;
  uploadId: string | null;
  layers: GeometryLayer[];
  warnings: string[];
  preview: ShapePreview | null;
};

type ConnectionMode = "idle" | "sse" | "reconnecting" | "polling";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const FAILURE_STEPS = new Set([
  "import_fail",
  "process_fail",
  "failed",
  "error",
  "cancelled",
]);
const ARTIFACT_ORDER = [
  "import-pdf",
  "process-pdf",
  "erros-zip",
  "enviado-zip",
  "processado-zip",
  "conferencia-zip",
  "pendencias-zip",
  "corrigido-zip",
  "fixplan",
];

function emptyDraft(): DraftState {
  return {
    file: null,
    filename: "",
    fileSize: 0,
    uploadId: null,
    layers: [],
    warnings: [],
    preview: null,
  };
}

function isTerminal(status: unknown): boolean {
  return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

function clampPercent(value: unknown): number {
  const parsed = Number(value || 0);
  return Math.min(
    100,
    Math.max(0, Number.isFinite(parsed) ? Math.round(parsed) : 0)
  );
}

function formatTime(value: string | undefined): string {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "arquivo";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactLabel(key: string): string {
  if (key.startsWith("import-pdf")) return "PDF importação SEMA";
  if (key.startsWith("process-pdf")) return "PDF processamento SEMA";
  if (key.startsWith("erros-zip")) return "ZIP de erros";
  if (key.startsWith("enviado-zip")) return "ZIP enviado";
  if (key.startsWith("processado-zip")) return "ZIP processado";
  if (key.startsWith("conferencia-zip")) return "ZIP conferência";
  if (key.startsWith("pendencias-zip")) return "ZIP pendências";
  if (key.startsWith("corrigido-zip")) return "ZIP corrigido";
  if (key.startsWith("fixplan")) return "Plano de correção";
  return "Baixar artefato";
}

function artifactSortValue(key: string): number {
  const index = ARTIFACT_ORDER.findIndex(prefix => key.startsWith(prefix));
  return index < 0 ? ARTIFACT_ORDER.length : index;
}

const FIX_ACTION_LABELS: Record<FixActionType, string> = {
  remove_duplicate_vertices: "Remover vértices repetidos",
  clean_degenerate_rings: "Limpar anéis degenerados",
  unkink_self_intersection: "Separar auto-interseções",
  remove_glued_holes: "Remover buracos colados",
  clip_layer_to_cover: "Recortar pela cobertura declarada",
  split_complex_polygon: "Separar polígono complexo",
};

function actionImpact(action: FixAction, diffResumo: FixDiffSummary[]): string {
  const matching = diffResumo.filter(
    diff =>
      diff.acao === action.type &&
      action.layers.some(layer => layer === diff.camada)
  );
  if (!matching.length) return "Ação planejada; nenhuma alteração aplicada.";
  const vertices = matching.reduce(
    (total, diff) => total + diff.verticesRemovidos,
    0
  );
  const affected = new Set(
    matching.flatMap(diff =>
      diff.feicoesAfetadas.map(feature => `${diff.camada}:${feature}`)
    )
  ).size;
  const created = matching.reduce(
    (total, diff) => total + diff.registrosCriados,
    0
  );
  const parts = [
    `${affected} feição(ões) afetada(s)`,
    vertices > 0 ? `${vertices} vértice(s) removido(s)` : null,
    created > 0 ? `${created} registro(s) criado(s)` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function countErrors(phase: RoundPhase | null): number {
  return (phase?.errosResumo || []).reduce(
    (total, item) => total + Math.max(0, Number(item.qtd || 0)),
    0
  );
}

function toHistorySnapshot(job: OraculoJob): Record<string, unknown> {
  const rounds = Array.isArray(job.rounds) ? job.rounds : [];
  const artifacts = Object.values(job.artifacts || {});
  const importErrors = rounds.reduce(
    (total, round) => total + countErrors(round.import),
    0
  );
  const processErrors = rounds.reduce(
    (total, round) => total + countErrors(round.process),
    0
  );
  const roundsSummary: RoundHistorySummary[] = rounds.map(round => ({
    n: round.n,
    importOk: typeof round.import?.ok === "boolean" ? round.import.ok : null,
    processOk: typeof round.process?.ok === "boolean" ? round.process.ok : null,
    importResult: round.import?.resultado || undefined,
    processResult: round.process?.resultado || undefined,
    artifactKeys: artifacts
      .filter(artifact => artifact.round === round.n)
      .map(artifact => artifact.key),
  }));
  return {
    jobId: job.jobId,
    type: "pipeline",
    status: job.status,
    stage: job.stage,
    filename: job.sourceFilename || job.filename || "Projeto SIMCAR",
    percent: clampPercent(job.percent),
    message: job.message,
    error: job.error || undefined,
    uploadId: job.uploadId,
    importOk: typeof job.importOk === "boolean" ? job.importOk : null,
    processOk: typeof job.processOk === "boolean" ? job.processOk : null,
    resultado: job.resultado,
    roundCount: rounds.length,
    roundsSummary,
    artifactRefs: artifacts,
    importErrors,
    processErrors,
    totalErrors: importErrors + processErrors,
    createdAt: job.createdAt,
    completedAt: job.finishedAt,
    sourceCollection: "simcar_oraculo_jobs",
  };
}

function historyEntryAsJob(entry: ProcessarHistoryItem): OraculoJob {
  return {
    jobId: entry.jobId,
    type: entry.type,
    status: entry.status,
    stage: entry.stage,
    percent: entry.percent,
    message: entry.message,
    error: entry.error,
    uploadId: entry.uploadId,
    filename: entry.filename,
    importOk: entry.importOk,
    processOk: entry.processOk,
    resultado: entry.resultado,
    createdAt: entry.timestamp,
    artifacts: Object.fromEntries(
      (entry.artifactRefs || []).map(artifact => [artifact.key, artifact])
    ),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

async function readApiError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `Erro ${response.status}`;
    try {
      const payload = JSON.parse(text) as { error?: string; message?: string };
      return payload.error || payload.message || text;
    } catch {
      return /^\s*</.test(text)
        ? `A API retornou uma resposta inválida (${response.status}).`
        : text;
    }
  } catch {
    return `Erro ${response.status}`;
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Operação cancelada.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Operação cancelada.", "AbortError"));
      },
      { once: true }
    );
  });
}

async function consumeJobStream(
  response: Response,
  jobId: string,
  onJob: (job: OraculoJob) => void
): Promise<void> {
  if (!response.body)
    throw new Error("O servidor não abriu o canal de eventos.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const envelope = JSON.parse(data) as {
          type?: string;
          jobId?: string;
          job?: Record<string, unknown>;
        };
        if (
          envelope.job &&
          (envelope.type === "snapshot" || envelope.type === "event")
        ) {
          onJob({
            ...(envelope.job as unknown as OraculoJob),
            jobId: envelope.jobId || jobId,
          });
        }
      } catch {
        // Um evento malformado não invalida os snapshots seguintes do mesmo stream.
      }
    }
  }
}

type TimelineProps = {
  timeline: OraculoEvent[];
  status: string;
  percent: number;
  round: number;
  maxRounds: number;
  connectionMode: ConnectionMode;
};

function OraculoTimeline({
  timeline,
  status,
  percent,
  round,
  maxRounds,
  connectionMode,
}: TimelineProps): React.ReactElement {
  const terminal = isTerminal(status);
  const connectionLabel =
    connectionMode === "sse"
      ? "ao vivo"
      : connectionMode === "reconnecting"
        ? "reconectando"
        : connectionMode === "polling"
          ? "consulta periódica"
          : terminal
            ? "finalizado"
            : "aguardando";

  return (
    <section className="rounded-2xl border border-cyan-500/15 bg-[#0b1412]/85 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">
            Timeline do Oráculo
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Rodada {Math.max(1, round)}/{Math.max(1, maxRounds)} ·
            acompanhamento {connectionLabel}
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold tabular-nums text-cyan-200">
          {percent}%
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {timeline.length > 0 ? (
        <ol
          className="mt-5 max-h-[28rem] space-y-0 overflow-y-auto pr-1"
          aria-live="polite"
        >
          {timeline.map((event, index) => {
            const failed = FAILURE_STEPS.has(event.step);
            const current = index === timeline.length - 1 && !terminal;
            return (
              <li
                key={`${event.ts}-${event.step}-${index}`}
                className="relative flex gap-3 pb-5 last:pb-0"
              >
                {index < timeline.length - 1 ? (
                  <span className="absolute left-[9px] top-5 h-[calc(100%-0.25rem)] w-px bg-white/10" />
                ) : null}
                <span className="relative z-10 mt-0.5 shrink-0 bg-[#0b1412]">
                  {current ? (
                    <Loader2 size={19} className="animate-spin text-cyan-300" />
                  ) : failed ? (
                    <XCircle size={19} className="text-rose-300" />
                  ) : (
                    <CheckCircle2 size={19} className="text-emerald-300" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <time className="text-[10px] tabular-nums text-slate-500">
                      {formatTime(event.ts)}
                    </time>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Rodada {event.round || 1}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 text-sm ${failed ? "text-rose-100" : "text-slate-200"}`}
                  >
                    {event.message}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">
          <Clock3 size={17} />
          Aguardando o primeiro evento do servidor.
        </div>
      )}
    </section>
  );
}

type RoundCardProps = {
  round: OraculoRound;
  artifacts: OraculoArtifact[];
  current: boolean;
  onDownload: (artifact: OraculoArtifact) => void;
  onOpenFixPlan: (round: OraculoRound) => void;
};

function RoundCard({
  round,
  artifacts,
  current,
  onDownload,
  onOpenFixPlan,
}: RoundCardProps): React.ReactElement {
  const sortedArtifacts = useMemo(
    () =>
      [...artifacts].sort(
        (a, b) => artifactSortValue(a.key) - artifactSortValue(b.key)
      ),
    [artifacts]
  );
  const importErrors = countErrors(round.import);
  const processErrors = countErrors(round.process);
  const rejected = round.import?.ok === false || round.process?.ok === false;
  const approved =
    round.process?.ok === true ||
    (round.import?.ok === true && round.process === null);
  const stateLabel = rejected
    ? "com pendência"
    : approved
      ? "aprovada"
      : "em andamento";

  return (
    <details
      className="group rounded-2xl border border-white/10 bg-[#0b1412]/85 open:border-cyan-500/20"
      open={current}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        <span
          className={`rounded-xl p-2 ${
            rejected
              ? "bg-rose-500/10 text-rose-300"
              : approved
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-cyan-500/10 text-cyan-300"
          }`}
        >
          {rejected ? (
            <XCircle size={18} />
          ) : approved ? (
            <CheckCircle2 size={18} />
          ) : (
            <Loader2 size={18} className="animate-spin" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Rodada {round.n}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {stateLabel} · {importErrors} erro(s) na importação ·{" "}
            {processErrors} no processamento
          </p>
        </div>
        <ChevronDown
          size={18}
          className="shrink-0 text-slate-500 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="space-y-4 border-t border-white/5 px-4 pb-5 pt-4 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              {round.import?.ok === true ? (
                <CheckCircle2 size={15} className="text-emerald-300" />
              ) : round.import?.ok === false ? (
                <XCircle size={15} className="text-rose-300" />
              ) : (
                <Circle size={15} className="text-slate-600" />
              )}
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Importação SEMA
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-200">
              {round.import?.resultado ||
                (round.import ? round.import.status : "Aguardando resultado")}
            </p>
            {round.import?.detalhes ? (
              <p className="mt-1 text-xs text-slate-500">
                {round.import.detalhes}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              {round.process?.ok === true ? (
                <CheckCircle2 size={15} className="text-emerald-300" />
              ) : round.process?.ok === false ? (
                <XCircle size={15} className="text-rose-300" />
              ) : (
                <Circle size={15} className="text-slate-600" />
              )}
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Processamento SEMA
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-200">
              {round.process?.resultado ||
                (round.process ? round.process.status : "Ainda não executado")}
            </p>
            {round.process?.detalhes ? (
              <p className="mt-1 text-xs text-slate-500">
                {round.process.detalhes}
              </p>
            ) : null}
          </div>
        </div>

        {[
          ...(round.import?.errosResumo || []),
          ...(round.process?.errosResumo || []),
        ].length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-rose-500/15">
            {[
              ...(round.import?.errosResumo || []),
              ...(round.process?.errosResumo || []),
            ].map((item, index) => (
              <div
                key={`${item.camada}-${item.erro}-${index}`}
                className="flex flex-col gap-1 border-t border-white/5 px-3 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-xs text-slate-300">
                  <span className="font-semibold text-rose-200">
                    {item.camada}
                  </span>{" "}
                  · {item.erro}
                </p>
                <span className="shrink-0 text-xs font-bold tabular-nums text-rose-300">
                  ×{item.qtd}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {round.fixPlan ? (
          <button
            type="button"
            onClick={() => onOpenFixPlan(round)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2.5 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-500/20 sm:w-auto"
          >
            <Sparkles size={14} />O que a IA entendeu
          </button>
        ) : null}

        {sortedArtifacts.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Artefatos da rodada
            </p>
            <div className="flex flex-wrap gap-2">
              {sortedArtifacts.map(artifact => (
                <button
                  key={artifact.key}
                  type="button"
                  onClick={() => onDownload(artifact)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20 sm:w-auto"
                  title={`${artifact.filename} · ${formatBytes(artifact.bytes)}`}
                >
                  {artifact.contentType === "application/pdf" ? (
                    <FileText size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {artifactLabel(artifact.key)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {(round.artifactWarnings || []).length > 0 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90">
            {(round.artifactWarnings || []).map((warning, index) => (
              <p key={`${warning}-${index}`} className="mt-1 first:mt-0">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

type FixPlanDialogProps = {
  round: OraculoRound | null;
  onClose: () => void;
};

function FixPlanDialog({
  round,
  onClose,
}: FixPlanDialogProps): React.ReactElement {
  const plan = round?.fixPlan || null;
  const diffResumo = round?.diffResumo || [];

  return (
    <Dialog
      open={Boolean(round && plan)}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[88vh] max-w-2xl overflow-y-auto border-violet-400/20 bg-[#0b1412] p-0 text-slate-100"
      >
        <DialogHeader className="border-b border-white/10 px-5 py-4 pr-14 text-left">
          <DialogTitle className="flex items-center gap-2 text-base text-white">
            <Sparkles size={18} className="text-violet-300" />O que a IA
            entendeu — rodada {round?.n || 1}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            Plano explicado pela IA e limitado às correções mecânicas que o
            GeoForest reconhece com segurança.
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <button
            type="button"
            aria-label="Fechar plano de correção"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            <XCircle size={18} />
          </button>
        </DialogClose>

        {plan ? (
          <div className="space-y-5 px-5 pb-5">
            <div className="rounded-xl border border-violet-400/15 bg-violet-500/5 p-4">
              <p className="text-sm leading-relaxed text-violet-50">
                {plan.explicacaoUsuario}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wider">
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                  Fonte:{" "}
                  {plan.fonte === "deepseek"
                    ? "DeepSeek"
                    : "fallback determinístico"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                  Confiança {plan.confianca}
                </span>
                {plan.modelo ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                    {plan.modelo}
                  </span>
                ) : null}
              </div>
            </div>

            <section aria-labelledby="fix-plan-actions">
              <h4
                id="fix-plan-actions"
                className="text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                Ações mecânicas
              </h4>
              {plan.acoes.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {plan.acoes.map(action => (
                    <div
                      key={`${action.type}-${action.layers.join("-")}`}
                      className="rounded-xl border border-cyan-400/15 bg-cyan-500/5 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-cyan-100">
                          {FIX_ACTION_LABELS[action.type]}
                        </p>
                        {action.layers.map(layer => (
                          <span
                            key={`${action.type}-${layer}`}
                            className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-200"
                          >
                            {layer}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {action.motivo}
                      </p>
                      <p className="mt-2 text-[11px] font-medium text-cyan-200/80">
                        {actionImpact(action, diffResumo)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-100">
                  Nenhuma ação mecânica segura foi mapeada.
                </p>
              )}
            </section>

            {plan.naoCorrigivel.length > 0 ? (
              <section aria-labelledby="fix-plan-manual">
                <h4
                  id="fix-plan-manual"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  Exige decisão técnica
                </h4>
                <div className="mt-2 space-y-2">
                  {plan.naoCorrigivel.map((issue, index) => (
                    <div
                      key={`${issue.erro}-${index}`}
                      className="rounded-xl border border-amber-400/15 bg-amber-500/5 p-3"
                    >
                      <p className="text-xs font-semibold text-amber-100">
                        {issue.erro}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {issue.porque}
                      </p>
                      <p className="mt-2 text-xs text-amber-100/80">
                        {issue.orientacao}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {plan.avisos.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
                {plan.avisos.map((warning, index) => (
                  <p key={`${warning}-${index}`} className="mt-1 first:mt-0">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const ProcessarProjetoAnalysis: React.FC<Props> = ({
  apiFetch,
  onJobSnapshot,
  selectedJobId = null,
  historyEntry = null,
}) => {
  const [health, setHealth] = useState<OraculoHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedMunicipioKey, setSelectedMunicipioKey] = useState("");
  const [municipios, setMunicipios] = useState<MunicipioOption[]>([]);
  const [municipiosLoading, setMunicipiosLoading] = useState(false);
  const [municipiosError, setMunicipiosError] = useState<string | null>(null);
  const [job, setJob] = useState<OraculoJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("idle");
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legacyView, setLegacyView] = useState(false);
  const [selectedFixPlanRound, setSelectedFixPlanRound] =
    useState<OraculoRound | null>(null);
  const [requestingAutofix, setRequestingAutofix] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const healthAbortRef = useRef<AbortController | null>(null);
  const monitorAbortRef = useRef<AbortController | null>(null);
  const monitorSerialRef = useRef(0);
  const jobRef = useRef<OraculoJob | null>(null);
  const onJobSnapshotRef = useRef(onJobSnapshot);
  const historyEntryRef = useRef(historyEntry);
  const lastRestoredJobRef = useRef<string | null>(null);
  const municipiosLoadedRef = useRef(false);

  useEffect(() => {
    onJobSnapshotRef.current = onJobSnapshot;
  }, [onJobSnapshot]);

  useEffect(() => {
    historyEntryRef.current = historyEntry;
  }, [historyEntry]);

  const applyJobSnapshot = useCallback((incoming: OraculoJob) => {
    const normalized = {
      ...incoming,
      jobId: String(incoming.jobId || "").trim(),
      status: String(incoming.status || "queued").toLowerCase(),
    };
    if (!normalized.jobId) return;
    jobRef.current = normalized;
    setJob(normalized);
    setDraft(current => ({
      ...current,
      uploadId: normalized.uploadId || current.uploadId,
      filename:
        normalized.sourceFilename || normalized.filename || current.filename,
    }));
    setError(
      normalized.status === "failed"
        ? normalized.error || normalized.message || "Falha no pipeline SIMCAR."
        : null
    );
    onJobSnapshotRef.current?.(toHistorySnapshot(normalized));
  }, []);

  const loadHealth = useCallback(async () => {
    healthAbortRef.current?.abort();
    const controller = new AbortController();
    healthAbortRef.current = controller;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const response = await apiFetch("/api/simcar-oraculo/health", {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      if (controller.signal.aborted) return;
      setHealth({
        testCarId: String(payload?.testCarId || "270069"),
        simcarConfigured: payload?.simcarConfigured === true,
        deepseekConfigured: payload?.deepseekConfigured === true,
        queueLength: Math.max(0, Number(payload?.queueLength || 0)),
      });
    } catch (caught: unknown) {
      if ((caught as { name?: string })?.name !== "AbortError") {
        setHealthError(
          caught instanceof Error
            ? caught.message
            : "Falha ao consultar o servidor do Oráculo."
        );
      }
    } finally {
      if (healthAbortRef.current === controller) {
        healthAbortRef.current = null;
        setHealthLoading(false);
      }
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadHealth();
    return () => healthAbortRef.current?.abort();
  }, [loadHealth]);

  const loadMunicipios = useCallback(async () => {
    if (municipiosLoadedRef.current) return;
    municipiosLoadedRef.current = true;
    setMunicipiosLoading(true);
    setMunicipiosError(null);
    try {
      const response = await apiFetch("/api/simcar-oraculo/municipios");
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const options: MunicipioOption[] = Array.isArray(payload?.municipios)
        ? payload.municipios
            .map((item: Record<string, unknown>) => ({
              chave: String(item.chave ?? ""),
              nome: String(item.nome ?? "").trim(),
              ibge: item.ibge ? String(item.ibge) : null,
            }))
            .filter(
              (item: MunicipioOption) =>
                item.chave !== "" && item.nome && item.ibge
            )
        : [];
      if (!options.length)
        throw new Error("O SIMCAR não retornou municípios utilizáveis.");
      setMunicipios(options);
    } catch (caught: unknown) {
      municipiosLoadedRef.current = false;
      setMunicipiosError(
        caught instanceof Error
          ? caught.message
          : "Falha ao carregar municípios de Mato Grosso."
      );
    } finally {
      setMunicipiosLoading(false);
    }
  }, [apiFetch]);

  const monitorJob = useCallback(
    (jobId: string) => {
      monitorAbortRef.current?.abort();
      const controller = new AbortController();
      const serial = monitorSerialRef.current + 1;
      monitorSerialRef.current = serial;
      monitorAbortRef.current = controller;
      setMonitorError(null);

      void (async () => {
        let streamFailures = 0;
        while (!controller.signal.aborted && streamFailures < 3) {
          try {
            setConnectionMode(streamFailures === 0 ? "sse" : "reconnecting");
            const response = await apiFetch(
              `/api/simcar-oraculo/jobs/${encodeURIComponent(jobId)}/events`,
              {
                signal: controller.signal,
                headers: { Accept: "text/event-stream" },
              }
            );
            if (!response.ok) throw new Error(await readApiError(response));
            await consumeJobStream(response, jobId, applyJobSnapshot);
            if (isTerminal(jobRef.current?.status)) break;
            throw new Error(
              "O canal de eventos foi encerrado antes do resultado final."
            );
          } catch (caught: unknown) {
            if (
              controller.signal.aborted ||
              (caught as { name?: string })?.name === "AbortError"
            )
              return;
            streamFailures += 1;
            if (streamFailures < 3) {
              setConnectionMode("reconnecting");
              await abortableDelay(
                1000 * 2 ** (streamFailures - 1),
                controller.signal
              );
            }
          }
        }

        if (controller.signal.aborted || isTerminal(jobRef.current?.status)) {
          setConnectionMode("idle");
          return;
        }

        setConnectionMode("polling");
        while (!controller.signal.aborted) {
          try {
            const response = await apiFetch(
              `/api/simcar-oraculo/jobs/${encodeURIComponent(jobId)}`,
              {
                signal: controller.signal,
              }
            );
            if (!response.ok) throw new Error(await readApiError(response));
            const payload = await response.json();
            if (payload?.job)
              applyJobSnapshot({ ...(payload.job as OraculoJob), jobId });
            setMonitorError(null);
            if (isTerminal(jobRef.current?.status)) break;
          } catch (caught: unknown) {
            if (
              controller.signal.aborted ||
              (caught as { name?: string })?.name === "AbortError"
            )
              return;
            setMonitorError(
              caught instanceof Error
                ? `Acompanhamento temporariamente indisponível: ${caught.message}`
                : "Acompanhamento temporariamente indisponível."
            );
          }
          await abortableDelay(5000, controller.signal);
        }
        if (monitorSerialRef.current === serial) setConnectionMode("idle");
      })().catch((caught: unknown) => {
        if (
          (caught as { name?: string })?.name !== "AbortError" &&
          monitorSerialRef.current === serial
        ) {
          setMonitorError(
            caught instanceof Error
              ? caught.message
              : "Falha ao acompanhar o job."
          );
          setConnectionMode("polling");
        }
      });
    },
    [apiFetch, applyJobSnapshot]
  );

  useEffect(
    () => () => {
      monitorAbortRef.current?.abort();
      monitorSerialRef.current += 1;
    },
    []
  );

  const selectedId = String(selectedJobId || historyEntry?.jobId || "").trim();
  useEffect(() => {
    if (
      !selectedId ||
      lastRestoredJobRef.current === selectedId ||
      jobRef.current?.jobId === selectedId
    )
      return;
    lastRestoredJobRef.current = selectedId;
    monitorAbortRef.current?.abort();
    setConnectionMode("idle");
    setMonitorError(null);
    setError(null);
    setLegacyView(false);
    setSelectedFixPlanRound(null);
    setRestoring(true);
    setJob(null);
    jobRef.current = null;
    const entry = historyEntryRef.current;
    setDraft({ ...emptyDraft(), filename: entry?.filename || "" });
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await apiFetch(
          `/api/simcar-oraculo/jobs/${encodeURIComponent(selectedId)}`,
          {
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          if (response.status === 404 && entry?.jobId === selectedId) {
            const legacyJob = historyEntryAsJob(entry);
            setLegacyView(true);
            applyJobSnapshot(legacyJob);
            return;
          }
          throw new Error(await readApiError(response));
        }
        const payload = await response.json();
        const restored = { ...(payload?.job as OraculoJob), jobId: selectedId };
        applyJobSnapshot(restored);
        if (!isTerminal(restored.status)) monitorJob(selectedId);
      } catch (caught: unknown) {
        if ((caught as { name?: string })?.name !== "AbortError") {
          setError(
            caught instanceof Error
              ? caught.message
              : "Falha ao restaurar o job do histórico."
          );
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();

    return () => controller.abort();
  }, [apiFetch, applyJobSnapshot, monitorJob, selectedId]);

  const resetWorkspace = useCallback(() => {
    monitorAbortRef.current?.abort();
    monitorSerialRef.current += 1;
    jobRef.current = null;
    lastRestoredJobRef.current = null;
    setJob(null);
    setDraft(emptyDraft());
    setSelectedMunicipioKey("");
    setUploading(false);
    setSubmitting(false);
    setCancelling(false);
    setConnectionMode("idle");
    setMonitorError(null);
    setError(null);
    setLegacyView(false);
    setSelectedFixPlanRound(null);
    setRequestingAutofix(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const startNewZip = useCallback(() => {
    resetWorkspace();
    window.setTimeout(() => fileInputRef.current?.click(), 50);
  }, [resetWorkspace]);

  const applyZipFile = useCallback(
    async (picked: File | null) => {
      if (
        !picked ||
        uploading ||
        submitting ||
        (jobRef.current && !isTerminal(jobRef.current.status))
      )
        return;
      if (!picked.name.toLowerCase().endsWith(".zip")) {
        toast.error("Envie um arquivo .zip com os shapefiles.");
        return;
      }
      monitorAbortRef.current?.abort();
      monitorSerialRef.current += 1;
      jobRef.current = null;
      setJob(null);
      setLegacyView(false);
      setSelectedFixPlanRound(null);
      setError(null);
      setMonitorError(null);
      setSelectedMunicipioKey("");
      setDraft({
        ...emptyDraft(),
        file: picked,
        filename: picked.name,
        fileSize: picked.size,
      });
      setUploading(true);
      try {
        const zipBase64 = await fileToBase64(picked);
        const response = await apiFetch("/api/processar-projeto/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: picked.name, zipBase64 }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const payload = await response.json();
        const layers: GeometryLayer[] = Array.isArray(payload?.layers)
          ? payload.layers
          : [];
        const preview = payload?.shapePreview
          ? (payload.shapePreview as ShapePreview)
          : null;
        setDraft({
          file: picked,
          filename: String(payload?.filename || picked.name),
          fileSize: picked.size,
          uploadId: String(payload?.uploadId || ""),
          layers,
          warnings: [
            ...(Array.isArray(payload?.warnings)
              ? payload.warnings.map(String)
              : []),
            ...(Array.isArray(preview?.warnings)
              ? preview.warnings.map(String)
              : []),
          ],
          preview,
        });
        setHealth(current => ({
          testCarId: String(
            payload?.testCarId || current?.testCarId || "270069"
          ),
          simcarConfigured: payload?.simcarConfigured === true,
          deepseekConfigured: current?.deepseekConfigured === true,
          queueLength: current?.queueLength || 0,
        }));
        if (!preview) {
          setError(
            "Não foi possível ler o recorte geográfico do ZIP. Revise o arquivo e envie novamente."
          );
        } else if (
          !preview.municipioDetectado?.nome ||
          !preview.municipioDetectado?.ibge
        ) {
          void loadMunicipios();
        }
        toast.success(
          "Preview pronto. Revise o município antes de enviar ao SIMCAR."
        );
      } catch (caught: unknown) {
        const message =
          caught instanceof Error ? caught.message : "Falha ao enviar o ZIP.";
        setError(message);
        setDraft(emptyDraft());
        if (fileInputRef.current) fileInputRef.current.value = "";
      } finally {
        setUploading(false);
      }
    },
    [apiFetch, loadMunicipios, submitting, uploading]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    []
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
    },
    []
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
      void applyZipFile(event.dataTransfer.files?.[0] || null);
    },
    [applyZipFile]
  );

  const selectedMunicipio = useMemo(
    () =>
      municipios.find(item => String(item.chave) === selectedMunicipioKey) ||
      null,
    [municipios, selectedMunicipioKey]
  );
  const detectedMunicipio = draft.preview?.municipioDetectado || null;
  const needsManualMunicipio = Boolean(
    draft.preview &&
    (!detectedMunicipio?.nome ||
      !detectedMunicipio?.ibge ||
      detectedMunicipio.fonte === "nao-detectado")
  );
  const activeJob = Boolean(job && !isTerminal(job.status));
  const canSubmit = Boolean(
    draft.uploadId &&
    draft.preview &&
    health?.simcarConfigured &&
    !uploading &&
    !submitting &&
    !activeJob &&
    (!needsManualMunicipio || selectedMunicipio?.ibge)
  );

  const startPipeline = useCallback(async () => {
    const uploadId = draft.uploadId || jobRef.current?.uploadId;
    if (!uploadId) {
      toast.error("Envie o ZIP antes de iniciar o Oráculo.");
      return;
    }
    if (needsManualMunicipio && !selectedMunicipio?.ibge) {
      toast.error("Selecione o município do imóvel.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMonitorError(null);
    try {
      const response = await apiFetch("/api/simcar-oraculo/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          autoProcess: true,
          autofix: true,
          municipio: selectedMunicipio
            ? {
                nome: selectedMunicipio.nome,
                ibge: selectedMunicipio.ibge,
                chaveSimcar: selectedMunicipio.chave,
              }
            : undefined,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const newJobId = String(payload?.jobId || "").trim();
      if (!newJobId)
        throw new Error("O servidor não devolveu o identificador do job.");
      lastRestoredJobRef.current = newJobId;
      setLegacyView(false);
      applyJobSnapshot({
        jobId: newJobId,
        type: "pipeline",
        status: "queued",
        stage: "queued",
        percent: 0,
        uploadId,
        sourceFilename:
          draft.filename || jobRef.current?.sourceFilename || "Projeto SIMCAR",
        testCarId: String(payload?.testCarId || health?.testCarId || "270069"),
        queuePosition: Number(payload?.queuePosition || 1),
        round: 1,
        maxRounds: 3,
        rounds: [],
        artifacts: {},
        timeline: [],
        message:
          Number(payload?.queuePosition || 1) > 1
            ? `Na fila do SIMCAR (${Number(payload.queuePosition) - 1} job(s) à frente).`
            : "Na fila do SIMCAR; este job é o próximo.",
        createdAt: new Date().toISOString(),
      });
      monitorJob(newJobId);
      toast.success("Projeto enviado ao Oráculo SIMCAR.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao iniciar o pipeline SIMCAR."
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    apiFetch,
    applyJobSnapshot,
    draft.filename,
    draft.uploadId,
    health?.testCarId,
    monitorJob,
    needsManualMunicipio,
    selectedMunicipio,
  ]);

  const cancelJob = useCallback(async () => {
    const current = jobRef.current;
    if (!current || isTerminal(current.status)) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/simcar-oraculo/jobs/${encodeURIComponent(current.jobId)}`,
        {
          method: "DELETE",
        }
      );
      if (!response.ok) throw new Error(await readApiError(response));
      applyJobSnapshot({
        ...current,
        status: "cancel_requested",
        stage: "cancel_requested",
        message:
          "Cancelamento solicitado; aguardando um ponto seguro do pipeline.",
      });
      toast.success("Cancelamento solicitado.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao cancelar o job."
      );
    } finally {
      setCancelling(false);
    }
  }, [apiFetch, applyJobSnapshot]);

  const openFixPlan = useCallback((round: OraculoRound) => {
    setSelectedFixPlanRound(round);
  }, []);

  const closeFixPlan = useCallback(() => {
    setSelectedFixPlanRound(null);
  }, []);

  const requestManualAutofix = useCallback(async () => {
    const current = jobRef.current;
    if (
      !current ||
      !isTerminal(current.status) ||
      current.manualAutofixAvailable !== true
    )
      return;
    setRequestingAutofix(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/simcar-oraculo/jobs/${encodeURIComponent(current.jobId)}/autofix`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      const resumedJobId = String(payload?.jobId || current.jobId).trim();
      const resumed = payload?.job
        ? ({ ...payload.job, jobId: resumedJobId } as OraculoJob)
        : {
            ...current,
            jobId: resumedJobId,
            status: "queued",
            stage: "queued",
            ok: null,
            message: "Correção manual adicionada à fila do SIMCAR.",
          };
      applyJobSnapshot(resumed);
      monitorJob(resumedJobId);
      toast.success("Correção adicionada à fila do SIMCAR.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao solicitar a correção assistida."
      );
    } finally {
      setRequestingAutofix(false);
    }
  }, [apiFetch, applyJobSnapshot, monitorJob]);

  const downloadArtifact = useCallback(
    async (artifact: OraculoArtifact) => {
      try {
        const response = await apiFetch(artifact.url);
        if (!response.ok) throw new Error(await readApiError(response));
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = artifact.filename || artifact.key;
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        toast.success("Download iniciado.");
      } catch (caught: unknown) {
        toast.error(
          caught instanceof Error
            ? caught.message
            : "Falha ao baixar o artefato."
        );
      }
    },
    [apiFetch]
  );

  const timeline = Array.isArray(job?.timeline) ? job.timeline : [];
  const rounds = Array.isArray(job?.rounds) ? job.rounds : [];
  const lastFixPlanRound = rounds.findLast(round => Boolean(round.fixPlan));
  const artifacts = Object.values(job?.artifacts || {});
  const currentRound = Math.max(1, Number(job?.round || rounds.at(-1)?.n || 1));
  const maxRounds = Math.max(1, Number(job?.maxRounds || 3));
  const percent = clampPercent(
    job?.percent ??
      timeline.at(-1)?.percent ??
      (job?.status === "completed" ? 100 : 0)
  );
  const jobSucceeded = job?.status === "completed" && job.ok === true;
  const jobRejected = job?.status === "completed" && job.ok === false;
  const testCarId = job?.testCarId || health?.testCarId || "270069";
  const municipalitySourceLabel =
    detectedMunicipio?.fonte === "malha-ibge"
      ? "malha oficial IBGE"
      : detectedMunicipio?.fonte === "wfs-sema"
        ? "consulta WFS da SEMA"
        : detectedMunicipio?.fonte === "manual"
          ? "seleção manual"
          : "não detectado";

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-2xl border border-cyan-500/15 bg-[#0a1214]/85 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
              <Bot size={13} />
              Oráculo SIMCAR
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Processar projeto — SIMCAR real (SEMA)
            </h2>
            <p className="max-w-3xl text-sm text-slate-400">
              Um único envio prepara o projeto-teste, importa o ZIP, executa o
              ProcessarGeo e preserva os relatórios e arquivos oficiais de cada
              rodada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
              CAR de teste <strong className="text-white">{testCarId}</strong>
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
              Fila{" "}
              <strong className="text-white">
                {job?.queuePosition
                  ? `posição ${job.queuePosition}`
                  : `${health?.queueLength || 0} job(s)`}
              </strong>
            </span>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/90">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <p>
            O shape será enviado ao{" "}
            <strong>projeto-teste do escritório (CAR {testCarId})</strong>,
            nunca ao CAR do cliente. Os jobs entram em fila e usam a conta
            técnica; uma sessão manual aberta no SIMCAR pode ser encerrada
            enquanto o robô trabalha.
          </p>
        </div>
      </section>

      {healthLoading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1412]/80 px-5 py-10 text-sm text-slate-400">
          <Loader2 size={19} className="animate-spin text-cyan-300" />
          Conferindo o servidor do Oráculo…
        </div>
      ) : healthError ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-rose-100 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {healthError}
          </span>
          <button
            type="button"
            onClick={() => void loadHealth()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 font-semibold hover:bg-white/10 sm:w-auto"
          >
            <RefreshCw size={15} /> Tentar novamente
          </button>
        </div>
      ) : health?.simcarConfigured === false ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-6 text-center">
          <ShieldAlert size={28} className="mx-auto text-amber-300" />
          <h3 className="mt-3 text-base font-semibold text-amber-100">
            O servidor não está configurado para falar com o SIMCAR
          </h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-amber-100/70">
            Configure as credenciais técnicas no backend. Esta aba não executa
            validação local nem oferece um resultado alternativo.
          </p>
        </div>
      ) : null}

      {health?.simcarConfigured ? (
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-white">
              ZIP do recorte SIMCAR
            </h3>
            <p className="text-xs text-slate-500">
              Arraste o pacote de shapefiles e confira o preview antes de
              iniciar a fila oficial.
            </p>
          </div>

          <label
            className={`group mt-4 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-7 text-center transition-all ${
              activeJob || uploading || submitting
                ? "cursor-not-allowed border-white/5 bg-white/[0.01] opacity-60"
                : dragging
                  ? "cursor-copy border-cyan-400/60 bg-cyan-500/10"
                  : draft.filename
                    ? "cursor-pointer border-cyan-500/35 bg-cyan-500/5"
                    : "cursor-pointer border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-white/[0.03]"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              disabled={activeJob || uploading || submitting}
              onChange={event =>
                void applyZipFile(event.target.files?.[0] || null)
              }
            />
            <span
              className={`rounded-xl p-3 ${draft.filename ? "bg-cyan-500/15 text-cyan-200" : "bg-white/5 text-slate-400 group-hover:text-cyan-300"}`}
            >
              {uploading ? (
                <Loader2 size={23} className="animate-spin" />
              ) : (
                <Upload size={23} />
              )}
            </span>
            <div className="min-w-0 max-w-full">
              <p className="truncate text-sm font-semibold text-white">
                {draft.filename ||
                  "Arraste ou selecione o ZIP do recorte SIMCAR"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {uploading
                  ? "Lendo camadas e localização…"
                  : draft.filename
                    ? `${draft.fileSize > 0 ? formatBytes(draft.fileSize) : "restaurado do histórico"} · ${draft.layers.length} camada(s) no preview`
                    : "Arquivo .zip com os shapefiles do projeto"}
              </p>
            </div>
          </label>

          {draft.uploadId && draft.preview ? (
            <div className="mt-4 space-y-4 rounded-xl border border-cyan-500/15 bg-black/20 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Camadas
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {draft.preview.layers.length || draft.layers.length}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Área aproximada
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {draft.preview.areaHaApprox
                      ? `${draft.preview.areaHaApprox.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`
                      : "não informada"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Município detectado
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
                    <MapPin size={14} className="text-cyan-300" />
                    {detectedMunicipio?.nome || "Não detectado"}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {detectedMunicipio?.ibge
                      ? `IBGE ${detectedMunicipio.ibge} · ${municipalitySourceLabel}`
                      : "selecione manualmente abaixo"}
                  </p>
                </div>
              </div>

              {needsManualMunicipio ? (
                <div>
                  <label
                    htmlFor="oraculo-municipio"
                    className="text-xs font-semibold text-slate-300"
                  >
                    Município do imóvel em Mato Grosso
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <select
                      id="oraculo-municipio"
                      value={selectedMunicipioKey}
                      onChange={event =>
                        setSelectedMunicipioKey(event.target.value)
                      }
                      disabled={municipiosLoading || municipios.length === 0}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#101817] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400/50 disabled:opacity-50"
                    >
                      <option value="">Selecione o município…</option>
                      {municipios.map(municipio => (
                        <option
                          key={`${municipio.ibge}-${municipio.chave}`}
                          value={String(municipio.chave)}
                        >
                          {municipio.nome} · IBGE {municipio.ibge}
                        </option>
                      ))}
                    </select>
                    {municipiosLoading ? (
                      <span className="inline-flex items-center gap-2 px-3 text-xs text-slate-400">
                        <Loader2 size={15} className="animate-spin" />
                        Carregando…
                      </span>
                    ) : null}
                  </div>
                  {municipiosError ? (
                    <button
                      type="button"
                      onClick={() => void loadMunicipios()}
                      className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-rose-300 hover:text-rose-200"
                    >
                      <RefreshCw size={13} />
                      {municipiosError} Tentar novamente
                    </button>
                  ) : null}
                </div>
              ) : null}

              {draft.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90">
                  {draft.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`} className="mt-1 first:mt-0">
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-white/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-xs text-slate-500">
                  Fluxo automático: prepara o CAR de teste, importa, processa e
                  aplica correções mecânicas elegíveis em até 3 rodadas.
                </p>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => void startPipeline()}
                  className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                >
                  {submitting ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Play size={17} />
                  )}
                  Enviar ao SIMCAR
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {restoring ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1412]/80 px-5 py-10 text-sm text-slate-400">
          <Loader2 size={19} className="animate-spin text-cyan-300" />
          Restaurando job do histórico…
        </div>
      ) : null}

      {legacyView ? (
        <div className="flex items-start gap-3 rounded-xl border border-slate-500/20 bg-slate-500/5 px-4 py-3 text-xs text-slate-300">
          <FileArchive size={17} className="mt-0.5 shrink-0" />
          <p>
            Este registro pertence ao fluxo legado e está disponível somente
            para consulta. Novos envios usam exclusivamente o Oráculo SIMCAR.
          </p>
        </div>
      ) : null}

      {job && !legacyView ? (
        <OraculoTimeline
          timeline={timeline}
          status={job.status}
          percent={percent}
          round={currentRound}
          maxRounds={maxRounds}
          connectionMode={connectionMode}
        />
      ) : null}

      {monitorError ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {monitorError} O navegador continuará tentando pelo snapshot do job.
        </div>
      ) : null}

      {job && isTerminal(job.status) ? (
        <div
          className={`flex items-start gap-3 rounded-2xl border p-5 ${
            jobSucceeded
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
              : jobRejected
                ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
                : job.status === "cancelled"
                  ? "border-orange-500/25 bg-orange-500/10 text-orange-100"
                  : "border-rose-500/25 bg-rose-500/10 text-rose-100"
          }`}
        >
          {jobSucceeded ? (
            <CheckCircle2 size={22} className="shrink-0" />
          ) : job.status === "cancelled" ? (
            <StopCircle size={22} className="shrink-0" />
          ) : (
            <AlertTriangle size={22} className="shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold">
              {jobSucceeded
                ? "Projeto aprovado pelo SIMCAR"
                : jobRejected
                  ? job.importOk === false
                    ? "Importação reprovada pela SEMA"
                    : "Processamento concluído com pendências"
                  : job.status === "cancelled"
                    ? "Job cancelado"
                    : job.status === "interrupted"
                      ? "Job interrompido durante reinício do servidor"
                      : "Falha de infraestrutura no Oráculo"}
            </p>
            <p className="mt-1 text-xs opacity-80">
              {job.error ||
                job.message ||
                job.resultado ||
                "Consulte as rodadas e os artefatos abaixo."}
            </p>
          </div>
        </div>
      ) : null}

      {rounds.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <FileStack size={17} className="text-cyan-300" />
            <h3 className="text-base font-semibold text-white">
              Resultado por rodada
            </h3>
          </div>
          {rounds.map(round => (
            <RoundCard
              key={round.n}
              round={round}
              artifacts={artifacts.filter(
                artifact => artifact.round === round.n
              )}
              current={round.n === currentRound}
              onDownload={downloadArtifact}
              onOpenFixPlan={openFixPlan}
            />
          ))}
        </section>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {job || draft.uploadId ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {activeJob ? (
            <button
              type="button"
              disabled={cancelling}
              onClick={() => void cancelJob()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-40 sm:w-auto"
            >
              {cancelling ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <StopCircle size={16} />
              )}
              Cancelar job
            </button>
          ) : null}
          {job?.status === "failed" && job.uploadId ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void startPipeline()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40 sm:w-auto"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Tentar novamente
            </button>
          ) : null}
          {!activeJob ? (
            <button
              type="button"
              onClick={startNewZip}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-white/[0.08] sm:w-auto"
            >
              <Plus size={16} />
              Novo projeto (outro ZIP)
            </button>
          ) : null}
        </div>
      ) : null}

      {job?.status === "completed" && job.ok === false ? (
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 text-xs text-violet-100/80">
          <div className="flex items-center gap-2 font-semibold text-violet-100">
            <Sparkles size={16} />
            Correção assistida
          </div>
          <p className="mt-2 leading-relaxed">
            {job.autofixStopMessage ||
              "O loop automático terminou. Consulte o plano e os artefatos antes de editar o projeto no GIS."}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {lastFixPlanRound ? (
              <button
                type="button"
                onClick={() => openFixPlan(lastFixPlanRound)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2.5 font-semibold text-violet-50 hover:bg-violet-500/20 sm:w-auto"
              >
                <Sparkles size={15} /> Ver último plano
              </button>
            ) : null}
            <button
              type="button"
              disabled={
                job.manualAutofixAvailable !== true || requestingAutofix
              }
              onClick={() => void requestManualAutofix()}
              title={
                job.manualAutofixAvailable
                  ? "Aplicar a nova ação mapeada e reenviar"
                  : job.manualAutofixReason ||
                    "Sem ação mecânica nova; edite o ZIP no GIS e inicie outro job."
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              {requestingAutofix ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Corrigir e reenviar
            </button>
          </div>
          {job.manualAutofixAvailable !== true ? (
            <p className="mt-2 text-[11px] text-violet-100/60">
              {job.manualAutofixReason ||
                "O botão fica bloqueado quando não existe uma ação nova e segura para aplicar."}
            </p>
          ) : null}
        </section>
      ) : null}

      <FixPlanDialog round={selectedFixPlanRound} onClose={closeFixPlan} />
    </div>
  );
};

export default ProcessarProjetoAnalysis;
