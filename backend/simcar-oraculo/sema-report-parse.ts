import { SIMCAR_LAYERS, normalizeLayerName } from "../simcar-rules";

export type SemaErroResumo = {
  camada: string;
  erro: string;
  qtd: number;
};

export type SemaErroPorFeicao = {
  camada: string;
  feicao: number | string;
  erro: string;
};

export type SemaReportParseResult = {
  tipo: "importacao" | "processamento" | "desconhecido";
  situacao: string | null;
  resumo: SemaErroResumo[];
  porFeicao: SemaErroPorFeicao[];
  raw: string;
  warnings: string[];
};

const EXTRA_REPORT_LAYER_NAMES = [
  "UTILIDADE_PUBLICA",
  "INTERESSE_SOCIAL",
  "RIO_ATE_10",
  "RIO_10_A_50",
  "RIO_50_A_200",
  "RIO_200_A_600",
  "RIO_ACIMA_600",
  "LAGOA_NATURAL",
  "RESERVATORIO_ARTIFICIAL",
];

const REPORT_LAYER_NAMES = [
  ...new Set([
    ...EXTRA_REPORT_LAYER_NAMES,
    ...SIMCAR_LAYERS.flatMap((layer) => [layer.code, ...(layer.aliases || [])]),
  ]),
].sort((a, b) => b.length - a.length);

let cachedPdfParser: null | ((buffer: Buffer) => Promise<{ text?: string }>) = null;

async function pdfText(buffer: Buffer): Promise<string> {
  if (!cachedPdfParser) {
    const mod: any = await import("pdf-parse");
    const parser = (mod?.default || mod) as (input: Buffer) => Promise<{ text?: string }>;
    if (typeof parser !== "function") throw new Error("pdf-parse indisponível.");
    cachedPdfParser = parser;
  }
  const parsed = await cachedPdfParser(buffer);
  return String(parsed?.text || "");
}

function matchLayerAtStart(line: string): { camada: string; remainder: string } | null {
  const normalizedStart = normalizeLayerName(line).replace(/_+/g, "_");
  for (const layer of REPORT_LAYER_NAMES) {
    if (!normalizedStart.startsWith(layer)) continue;
    // Remove pelo comprimento do nome original tolerando espaços antes do erro. Nos PDFs
    // extraídos por pdf-parse a coluna seguinte vem colada (AREA_UMIDAA geometria...).
    const compactLayer = layer.replace(/_/g, "[_ ]?");
    const match = line.match(new RegExp(`^\\s*${compactLayer}`, "i"));
    if (!match) continue;
    return {
      camada: layer,
      remainder: line.slice(match[0].length).trim(),
    };
  }
  return null;
}

function isSectionNoise(line: string): boolean {
  const normalized = line.replace(/\s+/g, "").toLowerCase();
  return (
    !normalized ||
    normalized === "feiçãoerroquantidade" ||
    normalized === "feicaoerroquantidade" ||
    /^erros?(encontrados|espaciais|deatributos|desobreposicao)/.test(normalized)
  );
}

function parseErrorSection(lines: string[], warnings: string[]): SemaErroResumo[] {
  const parsed: SemaErroResumo[] = [];
  let current: { camada: string; parts: string[] } | null = null;

  const currentHasQuantity = (): boolean =>
    Boolean(current && /(?:Quantidade\s*:?\s*)?\d[\d.]*\s*$/i.test(current.parts.join(" ")));

  const flush = (): void => {
    if (!current) return;
    const joined = current.parts.join(" ").replace(/\s+/g, " ").trim();
    const quantityMatch = joined.match(/(?:Quantidade\s*:?\s*)?(\d[\d.]*)\s*$/i);
    if (!quantityMatch) {
      warnings.push(`Não identifiquei a quantidade do erro em ${current.camada}: ${joined}`);
      current = null;
      return;
    }
    const qtd = Number(quantityMatch[1].replace(/\./g, ""));
    const erro = joined
      .slice(0, quantityMatch.index)
      .replace(/\s+([.,;:])/g, "$1")
      .trim();
    if (!erro || !Number.isFinite(qtd)) {
      warnings.push(`Linha de erro incompleta em ${current.camada}: ${joined}`);
      current = null;
      return;
    }
    parsed.push({ camada: current.camada, erro, qtd });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (isSectionNoise(line)) continue;
    const start = matchLayerAtStart(line);
    // Uma camada também pode aparecer no começo da continuação da mensagem
    // (ex.: "AVN, AUAS..."). Só abrimos uma nova linha depois que a anterior já
    // terminou com a coluna Quantidade; a primeira linha não tem essa ambiguidade.
    if (start && (!current || currentHasQuantity())) {
      flush();
      current = { camada: start.camada, parts: start.remainder ? [start.remainder] : [] };
      continue;
    }
    if (current) current.parts.push(line);
  }
  flush();

  const aggregated = new Map<string, SemaErroResumo>();
  for (const item of parsed) {
    const key = `${item.camada}\u0000${item.erro}`;
    const previous = aggregated.get(key);
    if (previous) previous.qtd += item.qtd;
    else aggregated.set(key, { ...item });
  }
  return [...aggregated.values()];
}

export function parseSemaReportText(rawText: string): SemaReportParseResult {
  const raw = String(rawText || "").replace(/\r\n?/g, "\n");
  const warnings: string[] = [];
  const tipo = /Relat[oó]rio de importa[cç][aã]o/i.test(raw)
    ? "importacao"
    : /Relat[oó]rio de processamento/i.test(raw)
      ? "processamento"
      : "desconhecido";
  const situacaoMatch = raw.match(
    /Situa[cç][aã]o da (?:importa[cç][aã]o|processamento)\s*:\s*([^\n]+)/i,
  );
  const situacao = situacaoMatch?.[1]?.replace(/\s+/g, " ").trim() || null;
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => /Erros (?:encontrados|espaciais)/i.test(line));
  const end = start >= 0
    ? lines.findIndex((line, index) => index > start && /Geometrias encontradas/i.test(line))
    : -1;
  const hasRejectedSituation = /reprovad|pend[eê]ncia/i.test(situacao || "");
  let resumo: SemaErroResumo[] = [];
  if (start >= 0) {
    resumo = parseErrorSection(lines.slice(start + 1, end >= 0 ? end : undefined), warnings);
  }
  if (hasRejectedSituation && !resumo.length) {
    warnings.push("Relatório reprovado, mas nenhuma linha de erro pôde ser estruturada.");
  }
  if (tipo === "desconhecido") warnings.push("Tipo do relatório SEMA não reconhecido.");

  return { tipo, situacao, resumo, porFeicao: [], raw, warnings };
}

export async function parseSemaReportPdf(buffer: Buffer): Promise<SemaReportParseResult> {
  try {
    const text = await pdfText(buffer);
    if (!text.trim()) throw new Error("PDF sem texto extraível.");
    return parseSemaReportText(text);
  } catch (error: any) {
    return {
      tipo: "desconhecido",
      situacao: null,
      resumo: [],
      porFeicao: [],
      raw: "",
      warnings: [`Falha ao extrair relatório PDF da SEMA: ${error?.message || error}`],
    };
  }
}
