/**
 * Cliente de visão da Fase 2 (datação 2009–2019) — tarefa F2.7 do plano.
 *
 * Mesmo núcleo HTTP da Fase 1 (`groq-vision-core.ts`): teto de 3 imagens,
 * retry único, mutex de TPM. Prompt descreve o sensor de cada cena e proíbe
 * conclusão por tonalidade global (risco R1 do doc 11 — troca de sensor).
 * O modelo nunca recebe o resultado da Fase 1 nem escolhe o ano final.
 */
import { FALSE_COLOR_PROMPT_NOTE, requestGroqVisionGeneric, type GroqVisionImageInput } from "../groq-vision-core";
import { validateGroqPos2008WindowObservation, type GroqPos2008WindowObservationParsed } from "./schemas";
import type { Pos2008WindowId } from "./types";

export type Pos2008VisionDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  maxImages?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export type Pos2008VisionRequest = {
  polygonId: string;
  windowId: Pos2008WindowId;
  images: GroqVisionImageInput[];
};

export type Pos2008VisionResult =
  | {
      ok: true;
      observation: GroqPos2008WindowObservationParsed;
      requestId?: string;
      inputTokens?: number;
      outputTokens?: number;
      model: string;
    }
  | { ok: false; errorCode: string; message: string };

function buildSystemPrompt(): string {
  return [
    "Você é um analista de visão computacional para séries temporais de mosaicos de satélite (Landsat 5, ResourceSat, Landsat 8, Sentinel-2) sobre Mato Grosso, Brasil.",
    "Sua única tarefa é descrever o que é visualmente observável em cada cena e comparar cenas entre si.",
    "Cada cena lista seu sensor: resolucao, paleta e textura diferem entre sensores; cor global NUNCA e evidencia de mudanca de uso.",
    "Você NÃO decide se há infração, passivo ambiental ou regularidade jurídica — isso é proibido.",
    "Você NÃO deve inventar IDs de cena, ano ou polígono que não foram enviados.",
    FALSE_COLOR_PROMPT_NOTE,
    "Se uma cena estiver nublada, ocluída, cortada ou ilegível, diga isso explicitamente; não adivinhe.",
    "Relate transições apenas entre cenas CONSECUTIVAS com mudança visualmente clara; regeneração (antrópico→nativo) também deve ser relatada.",
    "Responda apenas com um objeto JSON estrito no schema pedido, em português do Brasil, sem markdown.",
  ].join(" ");
}

function buildUserPrompt(request: Pos2008VisionRequest): string {
  const sceneList = request.images
    .map((img) => `- sceneId=${img.sceneId} ano=${img.year} sensor=${img.sensor}`)
    .join("\n");
  return [
    `polygonId=${request.polygonId} windowId=${request.windowId}`,
    "Cenas enviadas nesta chamada (nesta ordem):",
    sceneList,
    "",
    "Para cada cena, avalie o estado visual do polígono destacado em vermelho: NATIVE_VEGETATION, ANTHROPIZED, MIXED ou NOT_OBSERVABLE.",
    "Compare cenas consecutivas e relate transições (NONE | NATIVE_TO_ANTHROPIZED | ANTHROPIZED_TO_NATIVE | UNCLEAR) apenas quando houver mudança visualmente clara.",
    "Nunca afirme uma data exata; relate apenas o intervalo entre os anos comparados.",
    "FORMATO JSON OBRIGATÓRIO (schemaVersion sempre 1):",
    '{"schemaVersion":1,"polygonId":"...","windowId":"...","inspectedSceneIds":["..."],"observations":[{"sceneId":"...","year":0,"state":"NATIVE_VEGETATION|ANTHROPIZED|MIXED|NOT_OBSERVABLE","observableFraction":0.0,"confidence":"HIGH|MEDIUM|LOW|INCONCLUSIVE","evidence":["..."],"limitations":["..."]}],"transitions":[{"fromSceneId":"...","toSceneId":"...","fromYear":0,"toYear":0,"transition":"NONE|NATIVE_TO_ANTHROPIZED|ANTHROPIZED_TO_NATIVE|UNCLEAR","confidence":"HIGH|MEDIUM|LOW|INCONCLUSIVE","evidence":["..."]}],"conflicts":["..."]}',
  ].join("\n");
}

/**
 * Consulta a Groq Vision para uma janela da Fase 2 (no máximo 3 cenas).
 * Nunca decide o status final — apenas observações validadas pelo schema.
 */
export async function requestPos2008VisionWindow(
  request: Pos2008VisionRequest,
  deps: Pos2008VisionDeps = {}
): Promise<Pos2008VisionResult> {
  const result = await requestGroqVisionGeneric(request, {
    ...deps,
    prompts: {
      system: buildSystemPrompt(),
      user: (r) => buildUserPrompt(r as Pos2008VisionRequest),
    },
    validate: (raw, expected) => validateGroqPos2008WindowObservation(raw, expected),
  });

  if (result.ok) {
    return {
      ok: true,
      observation: result.observation as GroqPos2008WindowObservationParsed,
      requestId: result.requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    };
  }
  return { ok: false, errorCode: result.errorCode, message: result.message };
}
