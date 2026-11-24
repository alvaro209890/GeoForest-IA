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
export async function collectOpenAiSse(stream: ReadableStream<Uint8Array>): Promise<ChatColetado> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const target = { content: "", reasoning: "" };
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
    }
  }
  return target;
}

const SYSTEM_PROMPT = `Você monta relatórios fotográficos da IMAP Engenharia e Soluções.
O usuário informa o objetivo. Você VÊ as fotografias e decide quais entram, em que ordem e com qual legenda.
Responda somente um JSON válido, sem markdown, neste formato:
{
  "resumo": "uma frase sobre a seleção",
  "parciais": [
    {
      "titulo": "nome curto da parcial",
      "legenda": "texto técnico repetido em cada figura desta parcial",
      "fotos": [{ "id": "id enviado", "motivo": "por que esta foto entra" }]
    }
  ],
  "excluidas": [{ "id": "id enviado", "motivo": "por que ficou de fora" }]
}
Regras:
- Use apenas ids recebidos. Cada foto no máximo uma vez.
- A legenda descreve só o que dá para ver e o que o objetivo pede. Não invente área, coordenada, espécie, data ou nome de imóvel que não esteja no objetivo.
- Legenda em português, uma ou duas frases, sem o prefixo "Figura".
- Retratos ficam melhor em quantidade par, duas por linha. Paisagens ocupam a linha sozinhas. Agrupe com isso em mente, sem forçar uma foto ruim.
- Exclua foto borrada, repetida, escura demais ou fora do objetivo, e diga o motivo.
- Se todas servirem ao objetivo, não exclua só para encurtar.
- Ordene as parciais na sequência em que o relatório deve ser lido.`;

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
      collected = await collectOpenAiSse(response.body);
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
