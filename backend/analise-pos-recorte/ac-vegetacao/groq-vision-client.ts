/**
 * Cliente de visão da Fase 3 (vegetação na AC) — mesmo núcleo HTTP das fases 1 e 2.
 * Prompt proíbe conclusão jurídica (risco R1 do doc 11); o modelo apenas descreve.
 */
import { FALSE_COLOR_PROMPT_NOTE, requestGroqVisionGeneric, type GroqVisionGenericRequest, type GroqVisionImageInput } from "../groq-vision-core";
import { validateAcVegetacaoWindowObservation, type AcVegetacaoWindowObservationParsed } from "./schemas";
import { AC_VEGETATION_WINDOW_ID } from "./types";

export type AcVegetacaoVisionDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  maxImages?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

export type AcVegetacaoVisionRequest = {
  polygonId: string;
  images: GroqVisionImageInput[];
};

export type AcVegetacaoVisionResult =
  | {
      ok: true;
      observation: AcVegetacaoWindowObservationParsed;
      requestId?: string;
      inputTokens?: number;
      outputTokens?: number;
      model: string;
    }
  | { ok: false; errorCode: string; message: string };

function buildSystemPrompt(): string {
  return [
    "Você é um analista de visão computacional para imagens de satélite (Sentinel-2, SPOT) sobre Mato Grosso, Brasil.",
    "Sua única tarefa é descrever a vegetação de aparência nativa visível DENTRO do polígono destacado em vermelho.",
    "Você NÃO decide se há infração, passivo ambiental ou regularidade jurídica — isso é proibido.",
    "Você NÃO deve inventar IDs de cena, ano ou polígono que não foram enviados.",
    FALSE_COLOR_PROMPT_NOTE,
    "OVERLAY AVN: na cena do estado atual, polígonos amarelos representam a camada AVN declarada pelo projeto; o contorno vermelho representa a AC analisada. Compare a vegetação visível dentro da AC com a área AVN amarela e descreva coincidências ou divergências em evidence, sem transformar isso em conclusão jurídica.",
    "Se uma cena estiver nublada, ocluída, cortada ou ilegível, diga explicitamente; não adivinhe.",
    "Responda apenas com um objeto JSON estrito no schema pedido, em português do Brasil, sem markdown.",
  ].join(" ");
}

function buildUserPrompt(request: AcVegetacaoVisionRequest): string {
  const sceneList = request.images
    .map((img) => `- sceneId=${img.sceneId} ano=${img.year} sensor=${img.sensor}`)
    .join("\n");
  return [
    `polygonId=${request.polygonId} windowId=${AC_VEGETATION_WINDOW_ID}`,
    "Cenas enviadas nesta chamada (nesta ordem):",
    sceneList,
    "",
    "Para cada cena, avalie a vegetação de aparência nativa DENTRO do polígono destacado: vegetationInside = NONE | SPARSE | PATCHES | LARGE_BLOCK | NOT_OBSERVABLE.",
    "estimatedFraction = fração da área do polígono coberta (0..1). distribution = EDGE | INTERIOR | RIPARIAN | SCATTERED.",
    "confidence = HIGH | MEDIUM | LOW | INCONCLUSIVE. Se houver conflito entre cenas, descreva em conflicts.",
    "FORMATO JSON OBRIGATÓRIO (schemaVersion sempre 1):",
    '{"schemaVersion":1,"polygonId":"...","windowId":"WAVAC_ATUAL","inspectedSceneIds":["..."],"observations":[{"sceneId":"...","year":0,"vegetationInside":"NONE|SPARSE|PATCHES|LARGE_BLOCK|NOT_OBSERVABLE","estimatedFraction":0.0,"distribution":"EDGE|INTERIOR|RIPARIAN|SCATTERED","confidence":"HIGH|MEDIUM|LOW|INCONCLUSIVE","evidence":["..."],"limitations":["..."]}],"conflicts":["..."]}',
  ].join("\n");
}

/**
 * Consulta a Groq Vision para a janela atual de um polígono AC.
 * Nunca decide o status final — apenas observações validadas pelo schema.
 */
export async function requestAcVegetacaoVisionWindow(
  request: AcVegetacaoVisionRequest,
  deps: AcVegetacaoVisionDeps = {}
): Promise<AcVegetacaoVisionResult> {
  const genericRequest: GroqVisionGenericRequest = {
    polygonId: request.polygonId,
    windowId: AC_VEGETATION_WINDOW_ID,
    images: request.images,
  };
  const result = await requestGroqVisionGeneric(genericRequest, {
    ...deps,
    prompts: {
      system: buildSystemPrompt(),
      user: (r) => buildUserPrompt(r as AcVegetacaoVisionRequest),
    },
    validate: (raw, expected) => validateAcVegetacaoWindowObservation(raw, expected),
  });

  if (result.ok) {
    return {
      ok: true,
      observation: result.observation as AcVegetacaoWindowObservationParsed,
      requestId: result.requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    };
  }
  return { ok: false, errorCode: result.errorCode, message: result.message };
}
