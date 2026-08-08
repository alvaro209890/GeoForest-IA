/**
 * Cliente de visão da Fase 1 (AUAS pré-2008) — mantém a API pública histórica
 * e delega o transporte/retry/mutex no núcleo compartilhado
 * (`groq-vision-core.ts`). Escreve só o prompt e a validação específicos da fase.
 */
import { FALSE_COLOR_PROMPT_NOTE, requestGroqVisionGeneric, type GroqVisionImageInput } from "./groq-vision-core";
import { validateGroqWindowObservation, type GroqWindowObservationParsed } from "./schemas";
import type { AuasWindowId, AuasYear } from "./types";

export { parseGroqDurationToMs, resetGroqVisionRateLimitStateForTests, GroqVisionError } from "./groq-vision-core";

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

function buildSystemPrompt(): string {
  return [
    "Você é um analista de visão computacional para mosaicos de satélite Landsat 5 e SPOT sobre Mato Grosso, Brasil.",
    "Sua única tarefa é descrever o que é visualmente observável em cada cena e comparar cenas entre si.",
    "Você NÃO decide se há infração, passivo ambiental ou regularidade jurídica — isso é proibido.",
    "Você NÃO deve inventar IDs de cena, ano ou polígono que não foram enviados.",
    FALSE_COLOR_PROMPT_NOTE,
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

/**
 * Consulta a Groq Vision para uma janela de no máximo 3 cenas. Nunca decide o
 * status final — apenas observações visuais validadas pelo schema da Fase 1.
 */
export async function requestGroqVisionWindow(
  request: GroqVisionWindowRequest,
  deps: GroqVisionDeps = {}
): Promise<GroqVisionWindowResult> {
  const result = await requestGroqVisionGeneric(request, {
    ...deps,
    prompts: {
      system: buildSystemPrompt(),
      user: (r) => buildUserPrompt(r as GroqVisionWindowRequest),
    },
    validate: (raw, expected) => validateGroqWindowObservation(raw, expected),
  });

  if (result.ok) {
    return {
      ok: true,
      observation: result.observation as GroqWindowObservationParsed,
      requestId: result.requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    };
  }
  return { ok: false, errorCode: result.errorCode, message: result.message };
}

export type { GroqVisionImageInput };