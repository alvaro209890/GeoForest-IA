/**
 * Núcleo compartilhado do cliente Groq Vision — transporte, mutex, retry e
 * rate-limit, parametrizado por fase (prompt + schema de validação).
 *
 * A Fase 1 (`groq-vision-client.ts`) e as fases 2/3 delegam aqui para não
 * duplicar o contrato HTTP nem o estado de rate limit do processo (8k TPM).
 * A API pública de cada cliente de fase continua igual para quem já a consome.
 */
/** URL da API de chat — Groq por padrão, sobrescrevível via env. */
export const GROQ_VISION_URL =
  process.env.VISION_API_URL || "https://api.groq.com/openai/v1/chat/completions";

/**
 * Os mosaicos anuais publicados pela SEMA-MT **não têm estilo em cor natural**:
 * o GetCapabilities mostra `semamt:LANDSAT_5`, `Mosaicos:LANDSAT_8`,
 * `RESOURCESAT_2012_432` e `Geoportal_Sentinel_2_<ano>_NIR` como estilo padrão
 * (e único) — todos composições em falsa-cor com o infravermelho próximo no
 * canal verde. Só o `MOSAICO_SPOT_SEPLAN` sai em cor natural.
 *
 * A chave de leitura abaixo foi medida, não suposta: cruzando o SPOT 2008 (cor
 * natural) com o Landsat 5 2007 sobre o mesmo recorte, os pixels de floresta
 * dão RGB≈(33,168,51) no Landsat e os de solo exposto RGB≈(117,119,176).
 *
 * Sem esse aviso o modelo trata a cena como corrompida ("gradiente de cor sem
 * dados visuais") e devolve NOT_OBSERVABLE.
 */
export const FALSE_COLOR_PROMPT_NOTE =
  "COMPOSICAO COLORIDA: os mosaicos Landsat 5, Landsat 8, ResourceSat e Sentinel-2 da SEMA-MT " +
  "sao publicados em FALSA-COR (infravermelho proximo no canal verde), nunca em cor natural. " +
  "Nessas cenas a vegetacao densa aparece VERDE FORTE/NEON e o solo exposto, pastagem seca ou " +
  "area antropizada aparece MAGENTA, ROXO, ROSA ou AZUL-ACINZENTADO. Essa e a aparencia CORRETA " +
  "e esperada: nunca classifique a cena como ilegivel, corrompida ou 'gradiente sem dados' por " +
  "causa dessas cores. Apenas o mosaico SPOT 2008 esta em cor natural (vegetacao verde-escuro, " +
  "solo claro).";

/**
 * Glossario AC x AUAS para os prompts.
 *
 * AC e AUAS descrevem o MESMO estado do terreno (solo sem vegetacao nativa) e
 * se distinguem so pelo marco de 22/07/2008. Sem essa definicao explicita o
 * modelo escreve "uso antropico" nos dois casos, e no vocabulario do SIMCAR
 * "antropizado" puxa para AUAS -- ou seja, para supressao que dependia de
 * autorizacao. Em laudo que vai para a SEMA, essa ambiguidade le como acusacao.
 *
 * Fonte legal: Lei 12.651/2012, art. 3o, IV (consolidada) e art. 26 (uso
 * alternativo do solo depende de autorizacao previa).
 */
export const AC_AUAS_PROMPT_GLOSSARY =
  "VOCABULARIO OBRIGATORIO (AC x AUAS): as duas camadas mostram solo sem vegetacao nativa e se " +
  "diferenciam APENAS pela data da conversao.\n" +
  "- AC (Area Consolidada) = conversao ANTERIOR a 22/07/2008. E uso REGULAR pelo art. 3o, IV da " +
  "Lei 12.651/2012. Ao descrever AC escreva sempre 'uso consolidado' -- NUNCA 'uso antropico', " +
  "'area antropizada', 'desmate' ou 'supressao'.\n" +
  "- AUAS (Area de Uso Alternativo do Solo) = supressao a partir de 22/07/2008, que dependia de " +
  "autorizacao previa (art. 26). Ao descrever AUAS escreva 'supressao pos-2008'.\n" +
  "- AVN (Area de Vegetacao Nativa) = remanescente nunca convertido.\n" +
  "Consequencia pratica: constatar uso consolidado NAO e apontar irregularidade. Nao use " +
  "linguagem de infracao, passivo ou dano ambiental para AC.";

/**
 * Regra do pousio quinquenal — decide AC x AVN em area regenerada.
 *
 * O texto anterior era de UMA VIA SO: dizia que regeneracao sobre tracado antigo
 * de talhao e pousio e mandava "nunca classificar como vegetacao nativa". Falta
 * a outra metade da regra, que e a que protege o produtor de declarar AC onde a
 * area ja voltou a ser AVN: o pousio do art. 3o, XXIV da Lei 12.651/2012 vale
 * por NO MAXIMO 5 ANOS. Interrupcao maior que isso descaracteriza o uso
 * consolidado, e a vegetacao regenerada volta a ser AVN.
 *
 * O que decide e o ANO DA ULTIMA ATIVIDADE VISIVEL na serie 2003-2008 — e e
 * exatamente por isso que a serie precisa ser contigua ano a ano: pular um ano
 * pode mover a contagem de um lado ao outro do limite de 5 anos.
 *
 * Fronteira: 5 anos exatos ainda cabem no pousio ("por no maximo 5 anos"), mas
 * o caso fica sinalizado como limite para o responsavel tecnico decidir, em vez
 * de o laudo cravar sozinho uma questao juridica de fronteira.
 */
export const POUSIO_PROMPT_RULE =
  "REGRA DO POUSIO QUINQUENAL (decide AC x AVN em area coberta por vegetacao jovem):\n" +
  "- Toda area com uso implantado ate 22/07/2008 e CONSOLIDADA (AC). Nao existe piso: uso aberto " +
  "em 1990 ou em 2007 e igualmente consolidado.\n" +
  "- Interrupcao da atividade por ATE 5 ANOS e POUSIO (Lei 12.651/2012, art. 3o, XXIV) e NAO " +
  "descaracteriza o uso: a area continua AC mesmo aparecendo coberta por capoeira em 2008.\n" +
  "- Interrupcao SUPERIOR a 5 ANOS descaracteriza: a area deixou de ser consolidada e a vegetacao " +
  "que regenerou deve ser classificada como AVN (vegetacao nativa), nao como AC em descanso.\n" +
  "- O que decide e o ANO DA ULTIMA ATIVIDADE VISIVEL na serie, nao a aparencia da cena de 2008 " +
  "isolada. Aplique assim:\n" +
  "  * ultima atividade visivel em 2004 ou depois, com vegetacao jovem em 2008 -> interrupcao de " +
  "ate 4 anos -> POUSIO -> a area e AC.\n" +
  "  * ultima atividade visivel em 2003 e vegetacao de 2004 a 2008 -> interrupcao de 5 anos -> " +
  "limite do pousio -> tratar como AC, mas declarar no texto que o caso esta no limite legal e " +
  "depende de confirmacao do responsavel tecnico.\n" +
  "  * NENHUMA atividade visivel em NENHUM ano de 2003 a 2008, apenas vegetacao -> a ultima " +
  "atividade e anterior a 2003 -> interrupcao maior que 5 anos -> classifique como AVN, MESMO que " +
  "ainda existam tracos antigos de talhao (bordas retas, estradas remanescentes, forma geometrica).\n" +
  "- Traco antigo de talhao prova que a area JA foi usada; ele NAO prova que o uso continuava " +
  "dentro da janela de 5 anos. Sem atividade visivel na serie, o traco sozinho nao sustenta AC.\n" +
  "- Base: Lei 12.651/2012, art. 3o, IV e XXIV; IN SEMA-MT 04/2023, art. 42 e paragrafo 6o.";


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

/**
 * Extrai `error.code`/`error.message` de um 400 da Groq, mais um trecho curto
 * de `failed_generation`. Nunca devolve imagem nem o corpo inteiro.
 */
async function readGroqErrorDetail(response: Response): Promise<string> {
  try {
    const payload: any = await response.json();
    const code = String(payload?.error?.code || "").trim();
    const message = String(payload?.error?.message || "").trim();
    const failed = String(payload?.error?.failed_generation ?? "").trim();
    const parts = [code, message].filter(Boolean);
    if (failed) parts.push(`failed_generation="${failed.slice(0, 160)}"`);
    else if (payload?.error?.failed_generation !== undefined) parts.push("failed_generation vazio");
    return parts.join(" — ").slice(0, 400);
  } catch {
    return "";
  }
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
        ...(GROQ_VISION_URL.includes("groq.com") ? { reasoning_effort: "none" } : {}),
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
      throw new GroqVisionError("HTTP_401", "API recusou autenticação (verifique VISION_API_KEY / GROQ_API_KEY).", false);
    }
    if (response.status === 400) {
      // O 400 mais comum aqui é `json_validate_failed`: com `response_format`
      // json_object a Groq devolve `failed_generation` (às vezes vazio, quando
      // o modelo não produziu JSON algum). Sem esse detalhe no erro, a janela
      // aparece como HTTP_400 puro e não há como saber o que corrigir.
      const detail = await readGroqErrorDetail(response);
      throw new GroqVisionError(
        "HTTP_400",
        `Groq rejeitou o payload (HTTP 400)${detail ? `: ${detail}` : "."}`,
        false
      );
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

  const apiKey = String(options.apiKey ?? process.env.VISION_API_KEY ?? process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, errorCode: "MISSING_KEY", message: "VISION_API_KEY (ou GROQ_API_KEY) não configurada." };
  }
  const fetchImpl = options.fetchImpl || fetch;
  const model = options.model || process.env.VISION_MODEL || "google/gemini-2.5-flash";
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
