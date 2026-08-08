/**
 * Schemas Zod da Fase 2 (datação 2009–2019) — validação do JSON estrito da
 * visão, no mesmo espírito da Fase 1 (`../schemas.ts`). Design F2.3 do plano
 * `docs/planos/analise-pos-recorte/05-fase2-2008-2019.md` §5.
 */
import { z } from "zod";
import { sanitizeVisionPayload, type SanitizeCounters } from "../text-sanitizer";

const limitationsArray = z.array(z.string().trim().min(1).max(280)).max(8);

// Texto já saneado por `sanitizeVisionPayload`; o schema só confere formato.
const evidenceTextArray = z.array(z.string().trim().min(1).max(280)).max(8);

const windowIdSchema = z.enum(["W2009_2011", "W2011_2013", "W2013_2015", "W2015_2017", "W2017_2019", "WBRIDGE"]);

const observationSchema = z.object({
  sceneId: z.string().trim().min(1).max(80),
  year: z.number().int().min(2008).max(2019),
  state: z.enum(["NATIVE_VEGETATION", "ANTHROPIZED", "MIXED", "NOT_OBSERVABLE"]),
  observableFraction: z.number().min(0).max(1).nullable(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INCONCLUSIVE"]),
  evidence: evidenceTextArray,
  limitations: limitationsArray,
});

const transitionSchema = z
  .object({
    fromSceneId: z.string().trim().min(1).max(80),
    toSceneId: z.string().trim().min(1).max(80),
    fromYear: z.number().int().min(2008).max(2019),
    toYear: z.number().int().min(2008).max(2019),
    transition: z.enum(["NONE", "NATIVE_TO_ANTHROPIZED", "ANTHROPIZED_TO_NATIVE", "UNCLEAR"]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INCONCLUSIVE"]),
    evidence: evidenceTextArray,
  })
  .refine((t) => t.toYear > t.fromYear, {
    message: "Transição invertida: toYear deve ser > fromYear.",
    path: ["toYear"],
  });

export const groqPos2008WindowObservationSchema = z.object({
  schemaVersion: z.literal(1),
  polygonId: z.string().trim().min(1).max(80),
  windowId: windowIdSchema,
  inspectedSceneIds: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
  observations: z.array(observationSchema).min(1).max(3),
  transitions: z.array(transitionSchema).max(3),
  conflicts: z.array(z.string().trim().min(1).max(280)).max(8),
});

export type GroqPos2008WindowObservationParsed = z.infer<typeof groqPos2008WindowObservationSchema>;

/**
 * Valida a resposta bruta da Groq contra o contrato de uma janela da Fase 2,
 * garantindo que ela só cite o polígono/janela solicitados e cenas enviadas.
 */
export function validateGroqPos2008WindowObservation(
  raw: unknown,
  expected: {
    polygonId: string;
    windowId: string;
    sentSceneIds: string[];
    sentSceneMetadata?: Record<string, { year: number; sensor: string }>;
  }
):
  | { ok: true; data: GroqPos2008WindowObservationParsed; sanitize: SanitizeCounters }
  | { ok: false; reason: string } {
  const { value, counters } = sanitizeVisionPayload(raw);
  const parsed = groqPos2008WindowObservationSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "raiz"}:${i.code}`)
      .join(", ");
    return { ok: false, reason: `schema inválido (${issues})` };
  }
  const data = parsed.data;
  if (data.polygonId !== expected.polygonId) {
    return { ok: false, reason: `polygonId inesperado: ${data.polygonId}` };
  }
  if (data.windowId !== expected.windowId) {
    return { ok: false, reason: `windowId inesperado: ${data.windowId}` };
  }
  const sentSet = new Set(expected.sentSceneIds);
  const sceneOrder = new Map(expected.sentSceneIds.map((id, index) => [id, index]));
  const invented = data.inspectedSceneIds.filter((id) => !sentSet.has(id));
  if (invented.length > 0) {
    return { ok: false, reason: `sceneId(s) inventado(s): ${invented.join(", ")}` };
  }
  for (const obs of data.observations) {
    if (!sentSet.has(obs.sceneId)) {
      return { ok: false, reason: `observação cita sceneId não enviado: ${obs.sceneId}` };
    }
    const metadata = expected.sentSceneMetadata?.[obs.sceneId];
    if (metadata && metadata.year !== obs.year) {
      return { ok: false, reason: `ano incompatível com a cena ${obs.sceneId}: ${obs.year}` };
    }
  }
  for (const tr of data.transitions) {
    if (!sentSet.has(tr.fromSceneId) || !sentSet.has(tr.toSceneId)) {
      return { ok: false, reason: `transição cita sceneId não enviado` };
    }
    const fromMetadata = expected.sentSceneMetadata?.[tr.fromSceneId];
    const toMetadata = expected.sentSceneMetadata?.[tr.toSceneId];
    if (fromMetadata && fromMetadata.year !== tr.fromYear) {
      return { ok: false, reason: `ano inicial incompatível com a cena ${tr.fromSceneId}` };
    }
    if (toMetadata && toMetadata.year !== tr.toYear) {
      return { ok: false, reason: `ano final incompatível com a cena ${tr.toSceneId}` };
    }
    const fromIndex = sceneOrder.get(tr.fromSceneId);
    const toIndex = sceneOrder.get(tr.toSceneId);
    if (fromIndex !== undefined && toIndex !== undefined && toIndex !== fromIndex + 1) {
      return { ok: false, reason: "transição deve ligar cenas consecutivas" };
    }
  }
  return { ok: true, data, sanitize: counters };
}
