/**
 * Chamada ao DeepSeek v4.1 Flash pelo OpenCode Go (`ocg/`) no 9Router.
 * Raciocínio máximo e stream ligado: pedido longo sem stream estoura o
 * tempo do primeiro byte no 9Router e volta 503.
 *
 * Endereço, modelo e esforço já ficam no código, como no Optimus-geo.
 * A chave é a mesma do Hermes/Optimus: variável de ambiente ou o .env
 * que esses serviços já usam. Quem abre o painel não configura nada.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RELATORIO_FOTO_MODEL_PADRAO,
  RELATORIO_FOTO_RACIOCINIO_PADRAO,
  RelatorioFotoError,
  type FotoPronta,
} from "./types";

/** Onde o Optimus e o Hermes deste PC já guardam a chave do 9Router. */
export function arquivosChaveNineRouter(): string[] {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || "";
  return [
    process.env.GEOFOREST_BACKEND_ENV || "",
    path.join(home, ".config", "geoforest", "backend.env"),
    "/srv/optimus-geo/optimus-geo.env",
    "/srv/optimus-geo/hermes/.env",
    "/srv/optimus/hermes-optimus/.env",
    local ? path.join(local, "hermes", ".env") : "",
    path.join(home, ".hermes", ".env"),
  ].filter((arquivo) => arquivo.length > 0);
}

export function lerVariavelEnv(texto: string, nome: string): string {
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const eq = limpa.indexOf("=");
    if (eq <= 0) continue;
    if (limpa.slice(0, eq).trim() !== nome) continue;
    let valor = limpa.slice(eq + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1).trim();
    }
    return valor;
  }
  return "";
}

export function chaveNineRouter(arquivos = arquivosChaveNineRouter()): string {
  const direta = String(process.env.NINEROUTER_API_KEY || "").trim();
  if (direta) return direta;
  for (const arquivo of arquivos) {
    try {
      const valor = lerVariavelEnv(fs.readFileSync(arquivo, "utf8"), "NINEROUTER_API_KEY");
      if (valor) return valor;
    } catch {
      // Arquivo de outra máquina, ou o Hermes ainda não gravou a chave ali.
    }
  }
  return "";
}

export type ChatColetado = {
  content: string;
  reasoning: string;
};

/** Em que ponto a IA está: raciocinando sobre as fotos ou já escrevendo a resposta. */
export type FaseIa = "pensando" | "escrevendo";

export function nineRouterConfig(overrides?: { apiKey?: string; baseUrl?: string; model?: string; reasoning?: string }) {
  const apiKey = String(overrides?.apiKey ?? chaveNineRouter()).trim();
  const baseUrl = String(
    overrides?.baseUrl ?? process.env.NINEROUTER_BASE_URL ?? "http://100.104.255.35:20128/v1",
  )
    .trim()
    .replace(/\/+$/, "");
  const model = String(overrides?.model ?? process.env.RELATORIO_FOTO_MODEL ?? RELATORIO_FOTO_MODEL_PADRAO).trim();
  const reasoning = String(
    overrides?.reasoning ?? process.env.RELATORIO_FOTO_REASONING ?? RELATORIO_FOTO_RACIOCINIO_PADRAO,
  ).trim();
  const timeoutMs = Math.max(
    30_000,
    Number(process.env.RELATORIO_FOTO_TIMEOUT_MS ?? 600_000) || 600_000,
  );
  const maxTokens = Math.max(2_000, Number(process.env.RELATORIO_FOTO_MAX_TOKENS ?? 32_000) || 32_000);
  return { apiKey, baseUrl, model, reasoning, timeoutMs, maxTokens };
}

function appendDelta(target: { content: string; reasoning: string }, payload: any): void {
  const choice = payload?.choices?.[0] || {};
  const delta = choice.delta || {};
  const message = choice.message || {};
  for (const piece of [delta, message]) {
    if (typeof piece.content === "string") target.content += piece.content;
    const reasoning =
      piece.reasoning_content ?? piece.reasoning ?? piece.reasoning_details;
    if (typeof reasoning === "string") target.reasoning += reasoning;
  }
}

/** Junta o texto de um stream SSE no formato da API da OpenAI. */
export async function collectOpenAiSse(
  stream: ReadableStream<Uint8Array>,
  onFase?: (fase: FaseIa) => void,
): Promise<ChatColetado> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const target = { content: "", reasoning: "" };
  let fase: FaseIa | null = null;
  const avisar = () => {
    const atual: FaseIa | null = target.content ? "escrevendo" : target.reasoning ? "pensando" : null;
    if (atual && atual !== fase) {
      fase = atual;
      onFase?.(atual);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        appendDelta(target, JSON.parse(data));
      } catch {
        // Linha que não é JSON.
      }
      avisar();
    }
  }
  return target;
}

const SYSTEM_PROMPT = `Você monta o relatório fotográfico de campo da IMAP Engenharia e Soluções (consultoria ambiental e fundiária em Mato Grosso).
A pessoa escreve o objetivo do relatório. Você VÊ cada fotografia e decide:
1. quais fotos entram e quais ficam de fora;
2. em que ordem elas aparecem;
3. como elas se agrupam em parciais.

Parcial = grupo de fotos do mesmo assunto (ex.: acesso, sede, área de vegetação nativa, curso d'água, cerca, área aberta). Todas as fotos de uma parcial recebem a mesma legenda, que o Word numera como "Figura N. <legenda>".

Como o Word é montado (use isso para ordenar):
- fotos em pé (retrato) seguidas: quatro por página, duas em cima e duas embaixo;
- fotos deitadas (paisagem) seguidas: duas por página, uma embaixo da outra;
- deixe as fotos em pé juntas, para a página encher.

Responda somente um JSON válido, sem markdown, neste formato:
{
  "resumo": "uma frase simples: quantas fotos entraram, em quantas parciais, e quantas ficaram de fora",
  "parciais": [
    {
      "titulo": "assunto em 2 a 5 palavras",
      "legenda": "frase técnica repetida em cada figura desta parcial",
      "fotos": [{ "id": "id enviado", "motivo": "o que a foto mostra, em até 15 palavras" }]
    }
  ],
  "excluidas": [{ "id": "id enviado", "motivo": "por que ficou de fora, em até 15 palavras" }]
}
Regras:
- Use apenas ids recebidos. Cada foto no máximo uma vez.
- Legenda: uma frase em português, no estilo dos relatórios de vistoria (ex.: "Vista parcial da área de vegetação nativa vistoriada."). Descreva só o que aparece na foto e o que o objetivo pede. Não invente área, coordenada, espécie, data ou nome de imóvel que não esteja no objetivo. Não escreva "Figura".
- Motivo em linguagem simples, para quem não é técnico entender.
- Ordene as parciais na sequência de uma vistoria: acesso, depois estruturas, depois a área objeto do relatório, por fim os detalhes.
- Exclua foto borrada, repetida (quase igual a outra), escura demais ou sem relação com o objetivo, e diga o motivo.
- Se todas servirem ao objetivo, não exclua só para encurtar.`;

function imageContent(foto: FotoPronta): Array<Record<string, unknown>> {
  return [
    {
      type: "text",
      text: `FOTO id=${foto.id} arquivo=${foto.nome} orientacao=${foto.orientation} ${foto.width}x${foto.height}`,
    },
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${foto.jpeg.toString("base64")}` },
    },
  ];
}

export async function requestSelecaoFotos(args: {
  projeto: string;
  objetivo: string;
  fotos: FotoPronta[];
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  onFase?: (fase: FaseIa) => void;
}): Promise<{ content: string; model: string; reasoning: string }> {
  const config = nineRouterConfig({ apiKey: args.apiKey, baseUrl: args.baseUrl });
  if (!config.apiKey) {
    console.error("[relatorio-fotografico] chave do 9Router ausente nos arquivos do Hermes/Optimus");
    throw new RelatorioFotoError(
      "A seleção de fotos está indisponível neste momento.",
      503,
      "NINEROUTER_SEM_CHAVE",
    );
  }

  const fetchImpl = args.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onParentAbort = () => controller.abort();
  args.signal?.addEventListener("abort", onParentAbort);

  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Empreendimento: ${args.projeto || "não informado"}\nObjetivo do relatório:\n${args.objetivo}\n\nA seguir, cada fotografia vem identificada e depois a imagem.`,
    },
  ];
  for (const foto of args.fotos) userContent.push(...imageContent(foto));

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        reasoning_effort: config.reasoning,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 280);
      throw new RelatorioFotoError(
        `O 9Router recusou a análise (HTTP ${response.status}). ${detail}`.trim(),
        502,
        "NINEROUTER_HTTP",
      );
    }

    const contentType = String(response.headers.get("content-type") || "");
    let collected: ChatColetado;
    if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
      const payload = await response.json();
      collected = { content: "", reasoning: "" };
      appendDelta(collected, payload);
    } else if (response.body) {
      collected = await collectOpenAiSse(response.body, args.onFase);
    } else {
      throw new RelatorioFotoError("O 9Router respondeu sem corpo.", 502, "NINEROUTER_VAZIO");
    }

    const content = collected.content.trim() || collected.reasoning.trim();
    if (!content) {
      throw new RelatorioFotoError(
        "O DeepSeek não devolveu texto. Tente de novo.",
        502,
        "NINEROUTER_SEM_TEXTO",
      );
    }
    return { content, model: config.model, reasoning: config.reasoning };
  } catch (error) {
    if (error instanceof RelatorioFotoError) throw error;
    if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") {
      throw new RelatorioFotoError(
        "A análise foi cancelada ou passou de 10 minutos.",
        504,
        "NINEROUTER_TIMEOUT",
      );
    }
    throw new RelatorioFotoError(
      `Falha ao falar com o 9Router: ${(error as Error).message || "erro de rede"}`,
      502,
      "NINEROUTER_REDE",
    );
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onParentAbort);
  }
}
