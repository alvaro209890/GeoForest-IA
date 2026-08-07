/**
 * Laudo da Fase 2 (datação 2009–2019) — tarefa F2.10.
 *
 * Mesmo contrato da Fase 1: DeepSeek (só texto, JSON validado) com fallback
 * determinístico que preserva todos os status calculados. Quando um polígono
 * ficou `SEM_MUDANCA_OBSERVADA`, o texto termina com o encaminhamento explícito
 * para a aba AUAS × SCCON (datação por alerta a partir de 2019).
 */
import { z } from "zod";

import type { AuasPos2008Analysis } from "./types";

export type BuildPos2008ReportInput = {
  rulesVersion: string;
  summary: AuasPos2008Analysis["summary"];
  catalog: AuasPos2008Analysis["catalog"];
  polygons: AuasPos2008Analysis["polygons"];
  limitations: string[];
  pre2008CompletedAt: string | null;
};

const polygonReportSchema = z.object({
  polygonId: z.string().trim().min(1).max(80),
  markdown: z.string().trim().min(1),
});

const reportSchema = z.object({
  summaryMarkdown: z.string().trim().min(1),
  polygonSections: z.array(polygonReportSchema).min(0),
  evidenceRefs: z.array(z.string()).max(120),
});

export type Pos2008ReportParsed = z.infer<typeof reportSchema>;

export function validatePos2008Report(
  raw: unknown,
  expected: { polygonIds: Set<string> }
): { ok: true; data: Pos2008ReportParsed } | { ok: false; reason: string } {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "raiz"}:${i.code}`).join(", ");
    return { ok: false, reason: `schema inválido (${issues})` };
  }
  const invented = parsed.data.polygonSections.find((s) => !expected.polygonIds.has(s.polygonId));
  if (invented) {
    return { ok: false, reason: `polygonId inventado no laudo: ${invented.polygonId}` };
  }
  return { ok: true, data: parsed.data };
}

export function assemblePos2008Markdown(report: Pos2008ReportParsed): string {
  const sections = report.polygonSections.map((s) => `### ${s.polygonId}\n\n${s.markdown}`);
  return [report.summaryMarkdown, ...sections].join("\n\n");
}

export type DeepseekPos2008Deps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

/**
 * Monta o laudo textual final da Fase 2: tenta DeepSeek (só texto) e cai para o
 * relatório determinístico. Nunca chama a Groq para texto.
 */
export async function buildPos2008Report(
  input: BuildPos2008ReportInput,
  deps: DeepseekPos2008Deps = {}
): Promise<AuasPos2008Analysis["report"]> {
  const deepseek = await requestPos2008DeepSeek(input, deps);
  if (deepseek.ok) {
    return {
      model: "deepseek-v4-pro",
      markdown: assemblePos2008Markdown(deepseek.report),
      evidenceRefs: deepseek.report.evidenceRefs,
    };
  }
  const fallback = buildDeterministicPos2008Report(input);
  return {
    model: "deterministic-fallback",
    markdown: assemblePos2008Markdown(fallback),
    evidenceRefs: fallback.evidenceRefs,
  };
}

async function requestPos2008DeepSeek(
  input: BuildPos2008ReportInput,
  deps: DeepseekPos2008Deps
): Promise<{ ok: true; report: Pos2008ReportParsed } | { ok: false; errorCode: string; message: string }> {
  const apiKey = String(deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, errorCode: "MISSING_KEY", message: "DEEPSEEK_API_KEY não configurada." };
  const fetchImpl = deps.fetchImpl || fetch;
  const model = deps.model || "deepseek-v4-pro";
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const knownPolygonIds = new Set(input.polygons.map((p) => p.polygonId));

  const url = "https://api.deepseek.com/v1/chat/completions";
  const body = {
    model,
    messages: [
      {
        role: "system" as const,
        content: [
          "Você redige o texto técnico da datação de desmate por polígono AUAS (série 2009–2019) em Mato Grosso.",
          "Você recebe SOMENTE metadados e evidências visuais já validadas — nunca imagens.",
          "Você NÃO pode alterar status, ano/intervalo observado, área ou confiança calculados pelo sistema.",
          "Você NÃO pode concluir infração, passivo ambiental, regularidade ou irregularidade jurídica.",
          "Quando o status for SEM_MUDANCA_OBSERVADA, encerre o trecho do polígono orientando a consultar a aba de alertas AUAS × SCCON para eventos a partir de 2019 (datação por alerta oficial), sem afirmar que 'não houve desmate'.",
          "Distinga claramente ano confirmado de intervalo observado.",
          "Cite apenas os polygonId realmente informados. Inclua aviso de revisão por responsável técnico.",
          "Retorne apenas um objeto JSON no contrato pedido, sem markdown, em português do Brasil.",
        ].join(" "),
      },
      {
        role: "user" as const,
        content: [
          "FORMATO RAIZ OBRIGATÓRIO:",
          '{"summaryMarkdown":"...","polygonSections":[{"polygonId":"...","markdown":"..."}],"evidenceRefs":["..."]}',
          "DADOS VALIDADOS (não altere status/ano/área — apenas descreva):",
          JSON.stringify({
            rulesVersion: input.rulesVersion,
            catalog: input.catalog,
            summary: input.summary,
            polygons: input.polygons,
            limitations: input.limitations,
            pre2008CompletedAt: input.pre2008CompletedAt,
          }),
        ].join("\n"),
      },
    ],
    response_format: { type: "json_object" as const },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      return { ok: false, errorCode: `HTTP_${res.status}`, message: `DeepSeek respondeu HTTP ${res.status}.` };
    }
    const payload: any = await res.json();
    const content = String(payload?.choices?.[0]?.message?.content || "");
    const trimmed = content.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return { ok: false, errorCode: "INVALID_JSON", message: "DeepSeek não retornou JSON." };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return { ok: false, errorCode: "INVALID_JSON", message: "DeepSeek retornou JSON inválido." };
    }
    const validation = validatePos2008Report(raw, { polygonIds: knownPolygonIds });
    if (!validation.ok) {
      return { ok: false, errorCode: "INVALID_SCHEMA", message: validation.reason };
    }
    return { ok: true, report: validation.data };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, errorCode: "TIMEOUT", message: `DeepSeek excedeu o timeout de ${timeoutMs} ms.` };
    }
    return { ok: false, errorCode: "NETWORK", message: String((err as any)?.message || "erro de rede") };
  } finally {
    clearTimeout(timer);
  }
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMADO_ANO: "Conversão confirmada em ano",
  CONFIRMADO_INTERVALO: "Conversão no intervalo",
  JA_ANTROPIZADO_NO_INICIO_DA_SERIE: "Já antropizado no início da série (2009)",
  SEM_MUDANCA_OBSERVADA: "Sem mudança observada até 2019",
  INCONCLUSIVO: "Inconclusivo",
};

export const SCCON_ENCAMINHAMENTO =
  "Encaminhamento: para eventos a partir de 2019, consultar a aba AUAS × SCCON — a datação vem do alerta oficial, não de interpretação de imagem.";

/** Fallback determinístico — preserva todos os status; nunca chama outro LLM. */
export function buildDeterministicPos2008Report(input: BuildPos2008ReportInput): Pos2008ReportParsed {
  const histogram = Object.entries(input.summary.yearHistogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, v]) => `${year}=${v.count} polígono(s)`)
    .join(", ");

  const summaryMarkdown = [
    `## Resumo executivo (relatório determinístico — DeepSeek indisponível)`,
    `Polígonos analisados: ${input.summary.polygonCount}. Ano confirmado: ${input.summary.confirmedYearCount}. Intervalo: ${input.summary.intervalCount}. Já antropizados em 2009: ${input.summary.alreadyAnthropizedCount}. Sem mudança observada: ${input.summary.noChangeCount}. Inconclusivos: ${input.summary.inconclusiveCount}.`,
    `Área total AUAS analisada: ${input.summary.totalAuasAreaHa.toFixed(2)} ha.`,
    input.summary.confirmedYearCount > 0 && histogram ? `Distribuição por ano confirmado: ${histogram}.` : "",
    input.summary.inconclusiveCount > 0
      ? `Atenção: ${input.summary.inconclusiveCount} polígono(s) inconclusivo(s) — impossível descartar conversão nesses casos.`
      : "",
    input.catalog.missingYears.length > 0
      ? `Anos sem cena na série: ${input.catalog.missingYears.join(", ")}.`
      : "",
    input.limitations.length > 0 ? `Limitações: ${input.limitations.join("; ")}.` : "",
    "Este resumo é gerado automaticamente sem síntese textual de IA e requer revisão por responsável técnico antes de qualquer uso formal.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const polygonSections = input.polygons.map((p) => {
    const parts = [
      `Status: **${STATUS_LABEL[p.status] || p.status}**.`,
      `Área: ${p.areaHa.toFixed(2)} ha.`,
      p.firstDetectedYear ? `Primeiro ano observado de conversão: ${p.firstDetectedYear}.` : "",
      p.observedInterval
        ? `Intervalo observado: ${p.observedInterval.fromYear} → ${p.observedInterval.toYear}.`
        : "",
      p.crossedSensorBoundary
        ? `Transição atravessou troca de sensor (janela-ponte: ${p.bridgeWindowUsed || "não confirmada"}).`
        : "",
      p.pre2008.pre2008Alert
        ? "Coerente com o alerta pré-2008 da Fase 1 (evento anterior ao marco)."
        : "",
      p.evidence.length > 0 ? `Evidência: ${p.evidence.join("; ")}.` : "",
      p.limitations.length > 0 ? `Limitações: ${p.limitations.join("; ")}.` : "",
      p.status === "SEM_MUDANCA_OBSERVADA" ? SCCON_ENCAMINHAMENTO : "",
    ];
    return { polygonId: p.polygonId, markdown: parts.filter(Boolean).join(" ") };
  });

  return {
    summaryMarkdown,
    polygonSections,
    evidenceRefs: input.polygons.map((p) => p.polygonId),
  };
}