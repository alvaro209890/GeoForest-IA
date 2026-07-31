import { buildDeterministicFallbackReport, requestDeepseekAuasReport, type DeepseekTextDeps } from "./deepseek-text-client";
import type { DeepseekReportParsed } from "./schemas";
import type { AuasPolygonResult, AuasPre2008AnalysisV2, DeepseekAuasReportInput, PropertyPre2008Status } from "./types";

export type BuildAuasReportInput = {
  rulesVersion: string;
  aggregateStatus: PropertyPre2008Status;
  pre2008Alert: boolean;
  summary: AuasPre2008AnalysisV2["summary"];
  sources: AuasPre2008AnalysisV2["sources"];
  polygons: AuasPolygonResult[];
  limitations: string[];
  acAvnContext?: { source: string; summary: string };
};

function toDeepseekInput(input: BuildAuasReportInput): DeepseekAuasReportInput {
  return {
    rulesVersion: input.rulesVersion,
    aggregateStatus: input.aggregateStatus,
    pre2008Alert: input.pre2008Alert,
    summary: input.summary,
    sources: input.sources,
    polygons: input.polygons.map((p) => ({
      polygonId: p.polygonId,
      areaHa: p.areaHa,
      status: p.status,
      evidenceKind: p.evidenceKind,
      observedInterval: p.observedInterval,
      confidence: p.confidence,
      evidence: p.evidence,
      limitations: p.limitations,
    })),
    limitations: input.limitations,
    acAvnContext: input.acAvnContext,
  };
}

function assembleMarkdown(report: DeepseekReportParsed): string {
  const sections = report.polygonSections.map((s) => `### ${s.polygonId}\n\n${s.markdown}`);
  return [report.summaryMarkdown, ...sections].join("\n\n");
}

/**
 * Monta o laudo textual final: tenta o DeepSeek (só texto, contrato validado)
 * e cai para um relatório determinístico se ele falhar. Nunca chama a Groq
 * para texto — se o DeepSeek falhar, o sistema não tenta outro LLM.
 */
export async function buildAuasReport(
  input: BuildAuasReportInput,
  deps: DeepseekTextDeps = {}
): Promise<AuasPre2008AnalysisV2["report"]> {
  const deepseekInput = toDeepseekInput(input);
  const result = await requestDeepseekAuasReport(deepseekInput, deps);

  if (result.ok) {
    return {
      model: "deepseek-v4-pro",
      markdown: assembleMarkdown(result.report),
      evidenceRefs: result.report.evidenceRefs,
    };
  }

  const fallback = buildDeterministicFallbackReport(deepseekInput);
  return {
    model: "deterministic-fallback",
    markdown: assembleMarkdown(fallback),
    evidenceRefs: fallback.evidenceRefs,
  };
}
