/**
 * Núcleo compartilhado do cliente Groq Vision — transporte, mutex, retry e
 * rate-limit, parametrizado por fase (prompt + schema de validação).
 *
 * A Fase 1 (`groq-vision-client.ts`) e as fases 2/3 delegam aqui para não
 * duplicar o contrato HTTP nem o estado de rate limit do processo (8k TPM).
 * A API pública de cada cliente de fase continua igual para quem já a consome.
 */
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
  year: number;
  sensor: string;
  /** data URL (data:image/...;base64,...) — nunca logado. */
  dataUrl: string;
};

export type GroqVisionSceneMetadata = {
  year: number;
  sensor: string;
};

export type GroqVisionGenericRequest = {
  polygonId: string;
  windowId: string;
  images: GroqVisionImageInput[];
};

export type GroqVisionGenericResult =
  | {
      ok: true;
      observation: unknown;
      requestId?: string;
      inputTokens?: number;
      outputTokens?: number;
      model: string;
    }
  | { ok: false; errorCode: string; message: string };

export type GroqVisionGenericDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  maxImages?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

/** Prompt do sistema e do usuário, específicos da fase. */
export type GroqVisionPrompts = {
  system: string;
  user: (request: GroqVisionGenericRequest) => string;
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
 * Serializa chamadas Groq Vision no processo (conta observada com apenas
 * 8.000 TPM). Mutex compartilhado entre as fases.
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
  request: GroqVisionGenericRequest,
  prompts: GroqVisionPrompts,
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
          { role: "system", content: prompts.system },
          {
            role: "user",
            content: [
              { type: "text", text: prompts.user(request) },
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
      throw new GroqVisionError("RATE_LIMITED", "Groq retornou 429 (rate limit).", true);
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

export type RequestGroqVisionCoreOptions = GroqVisionGenericDeps & {
  prompts: GroqVisionPrompts;
  /** Valida a resposta bruta contra o schema da fase. Devolve `{ok:true,data}` ou `{ok:false,reason}`. */
  validate: (
    raw: unknown,
    expected: {
      polygonId: string;
      windowId: string;
      sentSceneIds: string[];
      sentSceneMetadata?: Record<string, GroqVisionSceneMetadata>;
    }
  ) => { ok: true; data: any } | { ok: false; reason: string };
};

/**
 * Consulta a Groq Vision para uma janela de no máximo 3 cenas com o prompt e o
 * schema da fase. Nunca decide o status final — apenas devolve observações
 * visuais validadas. Uma repetição em caso de JSON inválido ou 429 (respeitando
 * retry-after). Serializa chamadas no processo.
 */
export async function requestGroqVisionGeneric(
  request: GroqVisionGenericRequest,
  options: RequestGroqVisionCoreOptions
): Promise<GroqVisionGenericResult> {
  const maxImages = options.maxImages ?? 3;
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

  const apiKey = String(options.apiKey ?? process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, errorCode: "MISSING_KEY", message: "GROQ_API_KEY não configurada." };
  }
  const fetchImpl = options.fetchImpl || fetch;
  const model = options.model || "qwen/qwen3.6-27b";
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sleep = options.sleep || defaultSleep;
  const sentSceneIds = request.images.map((img) => img.sceneId);

  return withVisionMutex(async () => {
    let lastError: GroqVisionError | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (options.signal?.aborted) {
        return { ok: false, errorCode: "CANCELLED", message: "Cancelado antes da tentativa." };
      }

      if (attempt > 1 && lastError?.code === "RATE_LIMITED") {
        const waitMs = lastRateLimit.retryAfterMs ?? lastRateLimit.resetTokensMs ?? 1000;
        await sleep(waitMs);
      }

      try {
        const { raw, requestId, inputTokens, outputTokens } = await performAttempt(request, options.prompts, {
          apiKey,
          fetchImpl,
          model,
          timeoutMs,
          signal: options.signal,
        });
        const validation = options.validate(raw, {
          polygonId: request.polygonId,
          windowId: request.windowId,
          sentSceneIds,
          sentSceneMetadata: Object.fromEntries(
            request.images.map((image) => [image.sceneId, { year: image.year, sensor: image.sensor }]),
          ),
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
