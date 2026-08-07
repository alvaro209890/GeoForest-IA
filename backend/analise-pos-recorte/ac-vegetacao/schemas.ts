/**
 * Schemas Zod da Fase 3 (vegetação na AC) — validação do JSON de visão.
 * F3.4 do plano. O modelo devolve apenas vocabulário visual; o veredito é do
 * redutor determinístico.
 */
import { z } from "zod";
import type { z as zNS } from "zod";

const FORBIDDEN_LEGAL_TERMS = [
  "infração",
  "infracao",
  "passivo",
  "regular",
  "irregular",
  "ilegal",
  "legal",
  "multa",
  "embargo",
];

function rejectLegalLanguage(value: string, ctx: zNS.RefinementCtx): void {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hit = FORBIDDEN_LEGAL_TERMS.find((term) => {
    const normalizedTerm = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalized.includes(normalizedTerm);
  });
  if (hit) {
    ctx.addIssue({
      code: "custom" as const,
      message: `Termo jurídico não permitido na observação visual: "${hit}".`,
    });
  }
}

export const acVegetacaoWindowObservationSchema = z.object({
  schemaVersion: z.literal(1),
  polygonId: z.string().trim().min(1).max(80),
  windowId: z.literal("WAVAC_ATUAL"),
  inspectedSceneIds: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
  observations: z
    .array(
      z.object({
        sceneId: z.string().trim().min(1).max(80),
        year: z.number().int().min(2008).max(2030),
        vegetationInside: z.enum(["NONE", "SPARSE", "PATCHES", "LARGE_BLOCK", "NOT_OBSERVABLE"]),
        estimatedFraction: z.number().min(0).max(1).nullable(),
        distribution: z.enum(["EDGE", "INTERIOR", "RIPARIAN", "SCATTERED"]).nullable(),
        confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INCONCLUSIVE"]),
        evidence: z.array(z.string().trim().min(1).max(280).superRefine(rejectLegalLanguage)).max(8),
        limitations: z.array(z.string().trim().min(1).max(280)).max(8),
      })
    )
    .min(1)
    .max(3),
  conflicts: z.array(z.string().trim().min(1).max(280)).max(8),
});

export type AcVegetacaoWindowObservationParsed = z.infer<typeof acVegetacaoWindowObservationSchema>;

export function validateAcVegetacaoWindowObservation(
  raw: unknown,
  expected: {
    polygonId: string;
    windowId: string;
    sentSceneIds: string[];
    sentSceneMetadata?: Record<string, { year: number; sensor: string }>;
  }
): { ok: true; data: AcVegetacaoWindowObservationParsed } | { ok: false; reason: string } {
  const parsed = acVegetacaoWindowObservationSchema.safeParse(raw);
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
    const metadata = expected.sentSceneMetadata?.[obs.sceneId];
    if (metadata && metadata.year !== obs.year) {
      return { ok: false, reason: `ano incompatível com a cena ${obs.sceneId}: ${obs.year}` };
    }
  }
  return { ok: true, data };
}
