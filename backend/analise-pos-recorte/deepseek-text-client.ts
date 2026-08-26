import { validateDeepseekReport, type DeepseekReportParsed } from "./schemas";
import type { DeepseekAuasReportInput } from "./types";

export const DEEPSEEK_AUAS_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_BASE_OUTPUT_TOKENS = 3_000;
const DEEPSEEK_REASONING_HEADROOM = 1_600;

/**
 * Teto de tamanho do laudo. O relatório é `summaryMarkdown` + uma seção por
 * polígono, então limitar só o resumo não segura o total: um recorte com dezenas
 * de polígonos continuava saindo com páginas de texto.
 */
export const SUMMARY_MIN_WORDS = 150;
export const SUMMARY_MAX_WORDS = 250;
export const POLYGON_SECTION_MAX_SENTENCES = 2;
export const POLYGON_SECTION_MAX_WORDS = 40;

export class DeepseekTextError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "DeepseekTextError";
  }
}

export type DeepseekAuasReportResult =
  | { ok: true; report: DeepseekReportParsed; model: string; attempts: number }
  | { ok: false; errorCode: string; message: string };

export type DeepseekTextDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

function buildSystemPrompt(): string {
  return [
    "Você redige o texto técnico de um alerta de pré-2008 para AUAS (Área de Uso Antropizado do Solo) em Mato Grosso.",
    "Você recebe SOMENTE metadados, geometria resumida e evidências visuais já validadas — nunca imagens.",
    "Você NÃO pode alterar status, intervalo observado, área ou confiança calculados pelo sistema.",
    "Você NÃO pode concluir infração, passivo ambiental, regularidade ou irregularidade jurídica.",
    "Você NÃO pode afirmar que viu uma imagem — apenas relatar o que já foi observado e validado.",
    "Distinga claramente 'não foi observada evidência nesta série' de 'não existe desmate'.",
    "Cite apenas os polygonId realmente informados. Inclua um aviso de revisão por responsável técnico.",
    // O laudo é lido junto do painel, que já mostra status, área e cenas de cada
    // polígono. Sem teto explícito o modelo repetia esses números em prosa e o
    // texto crescia com o nº de polígonos, virando parede de texto.
    `Seja enxuto: "summaryMarkdown" deve ter de ${SUMMARY_MIN_WORDS} a ${SUMMARY_MAX_WORDS} palavras, em prosa corrida.`,
    `Cada item de "polygonSections" deve ter no máximo ${POLYGON_SECTION_MAX_SENTENCES} frases e ${POLYGON_SECTION_MAX_WORDS} palavras.`,
    "Não repita no texto os números que já estão nos dados: cite um valor só quando ele sustentar a conclusão daquele trecho.",
    "Sem títulos de seção, sem listas e sem tabelas: escreva parágrafos.",
    "Retorne apenas um objeto JSON no contrato pedido, sem markdown, em português do Brasil.",
  ].join(" ");
}

function buildUserPrompt(input: DeepseekAuasReportInput): string {
  return [
    "FORMATO RAIZ OBRIGATÓRIO:",
    '{"summaryMarkdown":"...","polygonSections":[{"polygonId":"...","markdown":"..."}],"evidenceRefs":["..."]}',
    "DADOS VALIDADOS PARA REDIGIR O TEXTO (não altere nenhum valor, apenas descreva-os):",
    JSON.stringify(input),
  ].join("\n");
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new DeepseekTextError("TIMEOUT", `DeepSeek excedeu o timeout de ${timeoutMs} ms.`, true);
    }
    throw new DeepseekTextError("NETWORK", `Falha de rede ao consultar DeepSeek: ${err?.message || "erro desconhecido"}.`, true);
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonPayload(content: string): unknown {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new DeepseekTextError("EMPTY_CONTENT", "DeepSeek retornou conteúdo vazio.", true);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new DeepseekTextError("INVALID_JSON", "DeepSeek não retornou um objeto JSON.", true);
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new DeepseekTextError("INVALID_JSON", "DeepSeek retornou JSON inválido.", true);
  }
}

async function requestAttempt(
  input: DeepseekAuasReportInput,
  args: { apiKey: string; fetchImpl: typeof fetch; model: string; timeoutMs: number; attempt: number }
): Promise<unknown> {
  // Payload contém somente texto/metadados: nunca image_url, base64 ou reasoning_content de entrada.
  const body = {
    model: args.model,
    messages: [
      { role: "system" as const, content: buildSystemPrompt() },
      { role: "user" as const, content: buildUserPrompt(input) },
    ],
    max_tokens: DEEPSEEK_BASE_OUTPUT_TOKENS + DEEPSEEK_REASONING_HEADROOM * args.attempt,
    response_format: { type: "json_object" as const },
  };
  const response = await fetchWithTimeout(
    args.fetchImpl,
    DEEPSEEK_AUAS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    args.timeoutMs
  );
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new DeepseekTextError(`HTTP_${response.status}`, `DeepSeek respondeu HTTP ${response.status}.`, retryable);
  }
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new DeepseekTextError("INVALID_RESPONSE", "DeepSeek retornou resposta sem JSON válido.", true);
  }
  // reasoning_content nunca é persistido nem lido — mesmo se presente no payload.
  return extractJsonPayload(payload?.choices?.[0]?.message?.content);
}

/**
 * Gera o laudo técnico a partir do resultado determinístico já calculado.
 * O DeepSeek nunca recebe imagens e nunca pode alterar status/área/intervalo —
 * a validação do schema garante isso rejeitando qualquer polygonId desconhecido
 * e qualquer conclusão jurídica.
 */
export async function requestDeepseekAuasReport(
  input: DeepseekAuasReportInput,
  deps: DeepseekTextDeps = {}
): Promise<DeepseekAuasReportResult> {
  const apiKey = String(deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, errorCode: "MISSING_KEY", message: "DEEPSEEK_API_KEY não configurada." };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const model = deps.model || "deepseek-v4-pro";
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const knownPolygonIds = new Set(input.polygons.map((p) => p.polygonId));
  const knownStatusByPolygon = new Map(input.polygons.map((p) => [p.polygonId, p.status]));

  let lastError: DeepseekTextError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await requestAttempt(input, { apiKey, fetchImpl, model, timeoutMs, attempt });
      const validation = validateDeepseekReport(raw, { knownPolygonIds, knownStatusByPolygon });
      if (!validation.ok) {
        lastError = new DeepseekTextError("INVALID_SCHEMA", validation.reason, true);
        if (attempt >= 2) return { ok: false, errorCode: "INVALID_SCHEMA", message: validation.reason };
        continue;
      }
      return { ok: true, report: validation.data, model, attempts: attempt };
    } catch (err) {
      lastError = err instanceof DeepseekTextError ? err : new DeepseekTextError("UNKNOWN", String(err), false);
      if (!lastError.retryable || attempt >= 2) {
        return { ok: false, errorCode: lastError.code, message: lastError.message };
      }
    }
  }
  return { ok: false, errorCode: lastError?.code || "UNKNOWN", message: lastError?.message || "Falha desconhecida no DeepSeek." };
}

const STATUS_LABEL: Record<string, string> = {
  ALERTA_PRE_2008: "Alerta pré-2008",
  // Faltava desde que o status nasceu: o laudo determinístico imprimia o enum
  // cru ("SINAL_DE_DUVIDA") justamente na linha que o RT lê para saber se houve
  // desmate parcial/vegetação mexida no polígono.
  SINAL_DE_DUVIDA: "Sinal de dúvida (área passível de discussão)",
  SEM_EVIDENCIA_PRE_2008: "Sem evidência pré-2008",
  INCONCLUSIVO_NO_MARCO_2008: "Inconclusivo no marco 2008",
  INCONCLUSIVO: "Inconclusivo",
};

/**
 * Relatório determinístico simples, usado quando o DeepSeek falha. Preserva
 * todos os status calculados; nunca chama um modelo de texto da Groq.
 */
export function buildDeterministicFallbackReport(input: DeepseekAuasReportInput): DeepseekReportParsed {
  const summaryMarkdown = [
    `## Resumo executivo (relatório determinístico — DeepSeek indisponível)`,
    `Status agregado: **${STATUS_LABEL[input.aggregateStatus] || input.aggregateStatus}**.`,
    `Polígonos analisados: ${input.summary.polygonCount}. Com alerta: ${input.summary.alertCount}. Com sinal de dúvida: ${input.summary.doubtCount ?? 0}. Inconclusivos: ${input.summary.inconclusiveCount}. Sem evidência: ${input.summary.noEvidenceCount}.`,
    `Área total AUAS analisada: ${input.summary.totalAuasAreaHa.toFixed(2)} ha. Área em alerta: ${input.summary.alertAreaHa.toFixed(2)} ha.`,
    `Fontes usadas: ${input.sources.used.join(", ") || "nenhuma"}. Fontes ausentes: ${input.sources.missing.join(", ") || "nenhuma"}.`,
    input.limitations.length > 0 ? `Limitações: ${input.limitations.join("; ")}.` : "",
    "Este resumo é gerado automaticamente sem síntese textual de IA e requer revisão por responsável técnico antes de qualquer uso formal.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const polygonSections = input.polygons.map((p) => ({
    polygonId: p.polygonId,
    markdown: [
      `Status: ${STATUS_LABEL[p.status] || p.status}.`,
      `Área: ${p.areaHa.toFixed(2)} ha.`,
      p.observedInterval ? `Intervalo observado: ${p.observedInterval.wording}` : "Nenhum intervalo determinado.",
      p.evidence.length > 0 ? `Evidência: ${p.evidence.join("; ")}.` : "",
      // Os sinais de dúvida dizem EM QUE polígono a vegetação foi mexida — sem
      // isto eles só existiam na seção visual, não no corpo do laudo.
      Array.isArray(p.doubtSignals) && p.doubtSignals.length > 0
        ? `Sinais de dúvida: ${p.doubtSignals.join("; ")}.`
        : "",
      p.limitations.length > 0 ? `Limitações: ${p.limitations.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  }));

  return {
    summaryMarkdown,
    polygonSections,
    evidenceRefs: input.polygons.map((p) => p.polygonId),
  };
}
