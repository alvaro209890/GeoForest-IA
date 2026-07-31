import { validateGroqWindowObservation, type GroqWindowObservationParsed } from "./schemas";
import type { AuasWindowId, AuasYear } from "./types";

export const GROQ_VISION_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqVisionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "GroqVisionError";
  }
}

export type GroqVisionImageInput = {
  sceneId: string;
  year: AuasYear;
  sensor: "LANDSAT_5" | "SPOT";
  /** data URL (data:image/...;base64,...) — nunca logado. */
  dataUrl: string;
};

export type GroqVisionWindowRequest = {
  polygonId: string;
  windowId: AuasWindowId;
  images: GroqVisionImageInput[];
};

export type GroqVisionWindowResult =
  | {
      ok: true;
      observation: GroqWindowObservationParsed;
      requestId?: string;
      inputTokens?: number;
      outputTokens?: number;
      model: string;
    }
  | { ok: false; errorCode: string; message: string };

export type GroqVisionDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  maxImages?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parseia "7.66s", "1m2s", "500ms" (formato de header da Groq) para milissegundos. */
export function parseGroqDurationToMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?ms$/.test(trimmed)) return Number(trimmed.replace("ms", ""));
  const minutesMatch = trimmed.match(/^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (minutesMatch && (minutesMatch[1] || minutesMatch[2])) {
    const minutes = Number(minutesMatch[1] || 0);
    const seconds = Number(minutesMatch[2] || 0);
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) ? Math.round(asNumber * 1000) : null;
}

type RateLimitInfo = {
  remainingTokens: number | null;
  resetTokensMs: number | null;
  retryAfterMs: number | null;
};

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const remaining = headers.get("x-ratelimit-remaining-tokens");
  return {
    remainingTokens: remaining !== null ? Number(remaining) : null,
    resetTokensMs: parseGroqDurationToMs(headers.get("x-ratelimit-reset-tokens")),
    retryAfterMs: parseGroqDurationToMs(headers.get("retry-after")),
  };
}

/**
 * Serializa chamadas Groq Vision no processo (a conta observada tem apenas
 * 8.000 TPM). Um mutex simples garante que nunca há duas chamadas caras em voo.
 */
let visionMutexTail: Promise<void> = Promise.resolve();
function withVisionMutex<T>(fn: () => Promise<T>): Promise<T> {
  const result = visionMutexTail.then(fn, fn);
  visionMutexTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

let lastRateLimit: RateLimitInfo = { remainingTokens: null, resetTokensMs: null, retryAfterMs: null };

/** Exposto apenas para testes: reseta o estado de rate limit compartilhado do módulo. */
export function resetGroqVisionRateLimitStateForTests(): void {
  lastRateLimit = { remainingTokens: null, resetTokensMs: null, retryAfterMs: null };
}

function buildSystemPrompt(): string {
  return [
    "Você é um analista de visão computacional para mosaicos de satélite Landsat 5 e SPOT sobre Mato Grosso, Brasil.",
    "Sua única tarefa é descrever o que é visualmente observável em cada cena e comparar cenas entre si.",
    "Você NÃO decide se há infração, passivo ambiental ou regularidade jurídica — isso é proibido.",
    "Você NÃO deve inventar IDs de cena, ano ou polígono que não foram enviados.",
    "Se uma cena estiver nublada, ocluída, cortada ou ilegível, diga isso explicitamente; não adivinhe.",
    "Responda apenas com um objeto JSON estrito no schema pedido, em português do Brasil, sem markdown.",
  ].join(" ");
}

function buildUserPrompt(request: GroqVisionWindowRequest): string {
  const sceneList = request.images
    .map((img) => `- sceneId=${img.sceneId} ano=${img.year} sensor=${img.sensor}`)
    .join("\n");
  return [
    `polygonId=${request.polygonId} windowId=${request.windowId}`,
    "Cenas enviadas nesta chamada (nesta ordem):",
    sceneList,
    "",
    "Para cada cena, avalie o estado visual do polígono destacado em vermelho: NATIVE_VEGETATION, ANTHROPIZED, MIXED ou NOT_OBSERVABLE.",
    "Compare cenas consecutivas e relate transições apenas quando houver mudança visualmente clara.",
    "Nunca afirme uma data exata; relate apenas o intervalo entre os anos comparados.",
    "FORMATO JSON OBRIGATÓRIO (schemaVersion sempre 1):",
    '{"schemaVersion":1,"polygonId":"...","windowId":"...","inspectedSceneIds":["..."],"observations":[{"sceneId":"...","year":0,"state":"NATIVE_VEGETATION|ANTHROPIZED|MIXED|NOT_OBSERVABLE","observableFraction":0.0,"confidence":"HIGH|MEDIUM|LOW|INCONCLUSIVE","evidence":["..."],"limitations":["..."]}],"transitions":[{"fromSceneId":"...","toSceneId":"...","fromYear":0,"toYear":0,"change":"ANTHROPIZATION_APPEARED|NO_RELEVANT_CHANGE|POSSIBLE_CHANGE|NOT_OBSERVABLE","confidence":"HIGH|MEDIUM|LOW|INCONCLUSIVE","evidence":["..."]}],"conflicts":["..."]}',
  ].join("\n");
}

function extractJsonPayload(content: string): unknown {
  const trimmed = String(content || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new GroqVisionError("INVALID_JSON", "Groq não retornou um objeto JSON.", true);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function performAttempt(
  request: GroqVisionWindowRequest,
  args: { apiKey: string; fetchImpl: typeof fetch; model: string; timeoutMs: number; signal?: AbortSignal }
): Promise<{ raw: unknown; requestId?: string; inputTokens?: number; outputTokens?: number }> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (args.signal) {
    if (args.signal.aborted) throw new GroqVisionError("CANCELLED", "Cancelado antes da chamada à Groq.", false);
    args.signal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await args.fetchImpl(GROQ_VISION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        reasoning_effort: "none",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: [
              { type: "text", text: buildUserPrompt(request) },
              ...request.images.map((img) => ({
                type: "image_url" as const,
                image_url: { url: img.dataUrl },
              })),
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    lastRateLimit = parseRateLimitHeaders(response.headers);

    if (response.status === 429) {
      throw new GroqVisionError(
        "RATE_LIMITED",
        "Groq retornou 429 (rate limit).",
        true
      );
    }
    if (response.status === 401) {
      throw new GroqVisionError("HTTP_401", "Groq recusou autenticação (verifique GROQ_API_KEY).", false);
    }
    if (response.status === 400) {
      throw new GroqVisionError("HTTP_400", "Groq rejeitou o payload (HTTP 400).", false);
    }
    if (!response.ok) {
      throw new GroqVisionError(`HTTP_${response.status}`, `Groq respondeu HTTP ${response.status}.`, response.status >= 500);
    }

    const payload: any = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const raw = extractJsonPayload(String(content ?? ""));
    return {
      raw,
      requestId: payload?.id,
      inputTokens: payload?.usage?.prompt_tokens,
      outputTokens: payload?.usage?.completion_tokens,
    };
  } catch (err) {
    if (err instanceof GroqVisionError) throw err;
    if (controller.signal.aborted && args.signal?.aborted) {
      throw new GroqVisionError("CANCELLED", "Cancelado durante a chamada à Groq.", false);
    }
    if (controller.signal.aborted) {
      throw new GroqVisionError("TIMEOUT", `Groq excedeu o timeout de ${args.timeoutMs} ms.`, true);
    }
    throw new GroqVisionError("NETWORK", `Falha de rede ao consultar Groq: ${(err as any)?.message || "erro desconhecido"}.`, true);
  } finally {
    clearTimeout(timer);
    if (args.signal) args.signal.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Consulta a Groq Vision para uma janela de no máximo 3 cenas. Nunca decide o
 * status final — apenas devolve observações visuais validadas pelo schema.
 * Faz no máximo uma repetição em caso de JSON inválido ou 429 (respeitando
 * retry-after). Serializa chamadas no processo para respeitar o limite de TPM.
 */
export async function requestGroqVisionWindow(
  request: GroqVisionWindowRequest,
  deps: GroqVisionDeps = {}
): Promise<GroqVisionWindowResult> {
  const maxImages = deps.maxImages ?? 3;
  if (maxImages > 3) {
    throw new GroqVisionError("CONFIG_INVALID", "maxImages não pode exceder 3 nesta fase.", false);
  }
  if (request.images.length > maxImages) {
    return {
      ok: false,
      errorCode: "TOO_MANY_IMAGES",
      message: `Janela ${request.windowId} enviaria ${request.images.length} imagens; teto local é ${maxImages}.`,
    };
  }
  if (request.images.length === 0) {
    return { ok: false, errorCode: "NO_IMAGES", message: "Nenhuma imagem utilizável para esta janela." };
  }

  const apiKey = String(deps.apiKey ?? process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, errorCode: "MISSING_KEY", message: "GROQ_API_KEY não configurada." };
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const model = deps.model || "qwen/qwen3.6-27b";
  const timeoutMs = deps.timeoutMs ?? 120_000;
  const sleep = deps.sleep || defaultSleep;
  const sentSceneIds = request.images.map((img) => img.sceneId);

  return withVisionMutex(async () => {
    let lastError: GroqVisionError | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (deps.signal?.aborted) {
        return { ok: false, errorCode: "CANCELLED", message: "Cancelado antes da tentativa." };
      }

      if (
        attempt > 1 &&
        lastError?.code === "RATE_LIMITED"
      ) {
        const waitMs = lastRateLimit.retryAfterMs ?? lastRateLimit.resetTokensMs ?? 1000;
        await sleep(waitMs);
      }

      try {
        const { raw, requestId, inputTokens, outputTokens } = await performAttempt(request, {
          apiKey,
          fetchImpl,
          model,
          timeoutMs,
          signal: deps.signal,
        });
        const validation = validateGroqWindowObservation(raw, {
          polygonId: request.polygonId,
          windowId: request.windowId,
          sentSceneIds,
        });
        if (!validation.ok) {
          lastError = new GroqVisionError("INVALID_SCHEMA", validation.reason, true);
          if (attempt >= 2) {
            return { ok: false, errorCode: "INVALID_SCHEMA", message: validation.reason };
          }
          continue;
        }
        return { ok: true, observation: validation.data, requestId, inputTokens, outputTokens, model };
      } catch (err) {
        lastError = err instanceof GroqVisionError ? err : new GroqVisionError("UNKNOWN", String(err), false);
        if (!lastError.retryable || attempt >= 2) {
          return { ok: false, errorCode: lastError.code, message: lastError.message };
        }
      }
    }

    return {
      ok: false,
      errorCode: lastError?.code || "UNKNOWN",
      message: lastError?.message || "Falha desconhecida na Groq Vision.",
    };
  });
}
