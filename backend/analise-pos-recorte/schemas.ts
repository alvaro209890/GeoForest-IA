import { z } from "zod";
import { sanitizeVisionPayload, type SanitizeCounters } from "./text-sanitizer";

const limitationsArray = z.array(z.string().trim().min(1).max(280)).max(8);

// O texto já chega saneado por `sanitizeVisionPayload` (fronteira de palavra
// para conclusão jurídica + truncamento); aqui o schema só confere o formato.
const evidenceTextArray = z.array(z.string().trim().min(1).max(280)).max(8);

const windowIdSchema = z.enum(["W2003_2005", "W2005_2007", "W2007_2008"]);

const observationSchema = z.object({
  sceneId: z.string().trim().min(1).max(80),
  year: z.number().int().min(2003).max(2008),
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
    fromYear: z.number().int().min(2003).max(2008),
    toYear: z.number().int().min(2003).max(2008),
    change: z.enum([
      "ANTHROPIZATION_APPEARED",
      "NO_RELEVANT_CHANGE",
      "POSSIBLE_CHANGE",
      "NOT_OBSERVABLE",
    ]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INCONCLUSIVE"]),
    evidence: evidenceTextArray,
  })
  .refine((t) => t.toYear >= t.fromYear, {
    message: "Transição invertida: toYear deve ser >= fromYear.",
    path: ["toYear"],
  });

export const groqWindowObservationSchema = z.object({
  schemaVersion: z.literal(1),
  polygonId: z.string().trim().min(1).max(80),
  windowId: windowIdSchema,
  inspectedSceneIds: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
  observations: z.array(observationSchema).min(1).max(3),
  transitions: z.array(transitionSchema).max(3),
  conflicts: z.array(z.string().trim().min(1).max(280)).max(8),
});

export type GroqWindowObservationParsed = z.infer<typeof groqWindowObservationSchema>;

/**
 * Valida a resposta bruta da Groq contra o contrato de uma janela, garantindo
 * que ela só cite o polígono/janela solicitados e cenas que foram de fato
 * enviadas — nunca IDs inventados.
 */
export function validateGroqWindowObservation(
  raw: unknown,
  expected: { polygonId: string; windowId: string; sentSceneIds: string[] }
):
  | { ok: true; data: GroqWindowObservationParsed; sanitize: SanitizeCounters }
  | { ok: false; reason: string } {
  const { value, counters } = sanitizeVisionPayload(raw);
  const parsed = groqWindowObservationSchema.safeParse(value);
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
  const invented = data.inspectedSceneIds.filter((id) => !sentSet.has(id));
  if (invented.length > 0) {
    return { ok: false, reason: `sceneId(s) inventado(s): ${invented.join(", ")}` };
  }
  for (const obs of data.observations) {
    if (!sentSet.has(obs.sceneId)) {
      return { ok: false, reason: `observação cita sceneId não enviado: ${obs.sceneId}` };
    }
  }
  for (const tr of data.transitions) {
    if (!sentSet.has(tr.fromSceneId) || !sentSet.has(tr.toSceneId)) {
      return { ok: false, reason: `transição cita sceneId não enviado` };
    }
  }
  return { ok: true, data, sanitize: counters };
}

const polygonRefSchema = z.object({
  polygonId: z.string().trim().min(1).max(80),
  areaHa: z.number().nonnegative(),
  status: z.enum([
    "ALERTA_PRE_2008",
    "SEM_EVIDENCIA_PRE_2008",
    "INCONCLUSIVO_NO_MARCO_2008",
    "INCONCLUSIVO",
  ]),
});

const deepseekReportSchema = z.object({
  summaryMarkdown: z.string().trim().min(1).max(20_000),
  polygonSections: z
    .array(
      z.object({
        polygonId: z.string().trim().min(1).max(80),
        markdown: z.string().trim().min(1).max(4_000),
      })
    )
    .max(500),
  evidenceRefs: z.array(z.string().trim().min(1).max(80)).max(2_000),
});

export type DeepseekReportParsed = z.infer<typeof deepseekReportSchema>;

const LEGAL_CONCLUSION_TERMS = [
  "infração",
  "infracao",
  "passivo ambiental",
  "ilegal",
  "regularidade juridica",
  "regularidade jurídica",
];

/**
 * Valida que o laudo do DeepSeek só referencia polígonos existentes, não
 * altera status/área/intervalo e não conclui juridicamente.
 */
export function validateDeepseekReport(
  raw: unknown,
  expected: { knownPolygonIds: Set<string>; knownStatusByPolygon: Map<string, string> }
): { ok: true; data: DeepseekReportParsed } | { ok: false; reason: string } {
  const parsed = deepseekReportSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "raiz"}:${i.code}`)
      .join(", ");
    return { ok: false, reason: `schema inválido (${issues})` };
  }
  const data = parsed.data;
  for (const section of data.polygonSections) {
    if (!expected.knownPolygonIds.has(section.polygonId)) {
      return { ok: false, reason: `polygonId inexistente citado: ${section.polygonId}` };
    }
  }
  const fullText = [
    data.summaryMarkdown,
    ...data.polygonSections.map((s) => s.markdown),
  ]
    .join("\n")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hit = LEGAL_CONCLUSION_TERMS.find((term) => {
    const normalizedTerm = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return fullText.includes(normalizedTerm);
  });
  if (hit) {
    return { ok: false, reason: `laudo contém conclusão jurídica não permitida: "${hit}"` };
  }
  return { ok: true, data };
}

export { polygonRefSchema };
