/**
 * Chat do GeoForest (`/api/chat` e `/api/chat-stream`).
 *
 * Extraído de `backend/index.ts`: eram 885 linhas dentro de `startServer()`,
 * o que deixava o entrypoint com ~1.500 linhas e a feature sem fronteira.
 * Registrado depois do `createApp()` porque depende da Base de Conhecimento,
 * montada no boot.
 */
import type { Express } from "express";
import {
  BillingError,
  applyCancelFloorDebit,
  buildUsageFromGroq,
  createRequestId,
  estimateReserveForModels,
  estimateTokensFromMessages,
  estimateTokensFromText,
  refundReserve,
  reserveCredits,
  settleReservedCredits,
} from "../billing";
import { parsePdfSafe } from "../lib/map-utils";
import { MODEL_IDS, IMAGE_ANALYSIS_MODEL, IMAGE_ANALYSIS_FALLBACKS } from "../lib/models-config";
import type { createKnowledgeBase } from "../knowledge-base";
import {
  JobCancelledError,
  finishJob,
  isCancelRequested,
  markDisconnected,
  startJob,
} from "../processing-jobs";

type KnowledgeBase = ReturnType<typeof createKnowledgeBase>;

export function registerChatRoutes(app: Express, knowledgeBase: KnowledgeBase): void {
  const autoSelectModel = (messages: Array<{ role: string; content: any }>) => {
    let hasImage = false;
    const text = messages
      .map((m) => {
        const content = m.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((part) => {
              if (part?.type === "image_url") hasImage = true;
              if (part?.type === "text") return String(part?.text ?? "");
              return "";
            })
            .join(" ");
        }
        return "";
      })
      .join(" ")
      .toLowerCase();

    const hasVisionCue =
      /(imagem|foto|sat[eé]lite|ortomosaico|drone|a[eé]reo|mapa|png|jpg|jpeg|tif|tiff)/.test(text);
    if (hasImage || hasVisionCue) return "meta-llama/llama-4-maverick-17b-128e-instruct";
    const hasGeoCue =
      /(bbox|coordenad|epsg|wms|landsat|sentinel|declividade|demarca[cç][aã]o|pol[ií]gono)/.test(text);
    if (hasGeoCue) return "meta-llama/llama-4-maverick-17b-128e-instruct";

    const hasHighComplexityCue =
      /(an[aá]lise profunda|laudo|relat[oó]rio t[eé]cnico|multi[ -]?arquivo|muitos anexos|comparativo)/.test(
        text
      );
    if (hasHighComplexityCue) return "openai/gpt-oss-120b";

    const hasDataCue =
      /(shapefile|shape|geojson|csv|xlsx|planilha|tabela|dados|estat[ií]stica|an[áa]lise)/.test(text);
    if (hasDataCue) return "openai/gpt-oss-120b";

    return "meta-llama/llama-3.3-70b-versatile";
  };

  const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-versatile";
  const TEMPERATURE = 0.02;
  const MAX_TOKENS = 1800;
  const AUTO_MODEL = true;
  /** Trim text to the last complete sentence to avoid garbled continuation joins */
  const trimToLastCompleteSentence = (text: string): string => {
    const trimmed = text.trimEnd();
    if (!trimmed) return trimmed;
    // If it already ends with sentence-ending punctuation, return as-is
    if (/[.!?:;\n]$/.test(trimmed)) return trimmed;
    // Find the last sentence-ending punctuation
    const lastSentenceEnd = Math.max(
      trimmed.lastIndexOf(". "),
      trimmed.lastIndexOf(".\n"),
      trimmed.lastIndexOf("! "),
      trimmed.lastIndexOf("?\n"),
      trimmed.lastIndexOf("? "),
      trimmed.lastIndexOf(":\n"),
      trimmed.lastIndexOf(";\n"),
    );
    if (lastSentenceEnd > trimmed.length * 0.5) {
      // Only trim if we'd keep at least 50% of the content
      return trimmed.slice(0, lastSentenceEnd + 1).trimEnd();
    }
    return trimmed;
  };

  const splitThinkProgress = (raw: string) => {
    let visible = "";
    const thinkParts: string[] = [];
    let cursor = 0;

    while (cursor < raw.length) {
      const start = raw.indexOf("<think>", cursor);
      if (start === -1) {
        visible += raw.slice(cursor);
        break;
      }
      visible += raw.slice(cursor, start);
      const thinkStart = start + "<think>".length;
      const end = raw.indexOf("</think>", thinkStart);
      if (end === -1) {
        thinkParts.push(raw.slice(thinkStart));
        break;
      }
      thinkParts.push(raw.slice(thinkStart, end));
      cursor = end + "</think>".length;
    }

    return {
      thinkingText: thinkParts.join("\n\n").trim(),
      answerText: visible.trim(),
    };
  };

  const injectPendingPdfContext = async (
    messages: Array<{ role: string; content: any }>,
    pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>
  ) => {
    const docs = Array.isArray(pendingPdfs)
      ? pendingPdfs.filter((p) => p?.dataUrl && typeof p.dataUrl === "string")
      : [];
    if (!docs.length) return messages;

    const contexts: string[] = [];
    for (const pendingPdf of docs) {
      const parts = String(pendingPdf.dataUrl || "").split(",");
      if (parts.length !== 2) continue;

      let extractedText = "";
      try {
        const raw = Buffer.from(parts[1], "base64");
        const parsed = await parsePdfSafe(raw);
        if (parsed?.text) {
          extractedText = (parsed.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 25000);
        }
      } catch (err) {
        console.warn("[/api/chat-stream] pendingPdf parse failed:", err);
      }

      const context =
        `Documento PDF anexado pelo usuário (${pendingPdf.filename || "documento.pdf"}).` +
        (extractedText
          ? `\nUse o conteúdo extraído abaixo como base:\n${extractedText}`
          : "\nNão foi possível extrair texto automaticamente; informe essa limitação.");
      contexts.push(context);
    }
    if (!contexts.length) return messages;

    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const msg = next[i];
      if (msg.role !== "user") continue;
      const baseText =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
              .map((part) => (part?.type === "text" ? String(part?.text || "") : ""))
              .join("\n")
            : "";
      next[i] = { ...msg, content: `${baseText}\n\n${contexts.join("\n\n")}`.trim() };
      break;
    }

    return next;
  };

  const insertSystemContext = (
    messages: Array<{ role: string; content: any }>,
    systemMessage: { role: "system"; content: string }
  ) => {
    let idx = 0;
    while (idx < messages.length && messages[idx]?.role === "system") idx += 1;
    return [...messages.slice(0, idx), systemMessage, ...messages.slice(idx)];
  };

  const GUARDRAIL_SYSTEM_MESSAGE = {
    role: "system" as const,
    content: [
      "## VERIFICAÇÃO FINAL ANTES DE RESPONDER",
      "Antes de entregar sua resposta, verifique cada afirmação:",
      "- Cada lei/norma citada tem número e ano corretos? Se não tem certeza, remova ou diga 'verificar na legislação vigente'.",
      "- Cada dado numérico (área, percentual, coordenada) veio do usuário ou da Base de Conhecimento? Se não, remova.",
      "- Cada fonte citada [arquivo.md] existe nos excertos fornecidos? Se não, remova a citação.",
      "- Há afirmações categóricas sem evidência? Reformule como hipótese com nível de confiança.",
      "- Se você não tem informação suficiente, é MELHOR dizer 'não sei / preciso de mais dados' do que inventar uma resposta plausível.",
    ].join("\n"),
  };

  const ASSISTANT_STYLE_SYSTEM_MESSAGE = {
    role: "system" as const,
    content: [
      "## FORMATO DE RESPOSTA",
      "- Responda em portugues claro, direto e tecnico.",
      "- Quando houver comparacao de itens (anos, areas, limites, prazos, documentos), prefira tabela Markdown.",
      "- Em tabela Markdown, use cabecalho + linha separadora e no maximo 6 colunas.",
      "- Nao quebre celulas em multiplas linhas; mantenha cada celula curta e objetiva.",
      "- Depois da tabela, inclua um bloco curto de conclusao pratica em 2 a 4 bullets.",
    ].join("\n"),
  };

  const callGroqChat = async (
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: any }>,
    maxTokens: number,
    temperature: number
  ) => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Erro ${response.status}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || "");
  };

  app.post("/api/chat", async (req, res) => {
    let billingRequestId = "";
    let billingReserved = 0;
    let billingUid = "";
    try {
      console.log("[/api/chat] request received");
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      billingUid = uid;

      const apiKey = process.env.GROQ_API_KEY;
      const defaultModel = DEFAULT_MODEL;
      const temperature = TEMPERATURE;
      const maxTokens = MAX_TOKENS;
      const autoModel = AUTO_MODEL;
      if (!apiKey) {
        console.error("[/api/chat] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf, pendingPdfs } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
        pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>;
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        console.error("[/api/chat] invalid messages payload");
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }
      const normalizedPendingPdfs = Array.isArray(pendingPdfs)
        ? pendingPdfs
        : pendingPdf
          ? [pendingPdf]
          : [];
      let messagesForModel = await injectPendingPdfContext(messages, normalizedPendingPdfs);
      const requestStartedAt = Date.now();
      const knowledgeSelection = knowledgeBase.selectForMessages(messagesForModel);
      let knowledgeSummaryUsed = false;
      if (knowledgeSelection) {
        const knowledgeContextMessage = knowledgeBase.buildContextSystemMessage(knowledgeSelection);
        if (knowledgeContextMessage) {
          messagesForModel = insertSystemContext(messagesForModel, knowledgeContextMessage);
        }
        const guidedSummary = await knowledgeBase.maybeBuildGuidedSummary(
          knowledgeSelection,
          async ({ model: summaryModel, messages: summaryMessages, maxTokens: summaryMaxTokens, temperature: summaryTemperature }) =>
            callGroqChat(apiKey, summaryModel, summaryMessages, summaryMaxTokens, summaryTemperature),
        );
        if (guidedSummary.message) {
          messagesForModel = insertSystemContext(messagesForModel, guidedSummary.message);
        }
        knowledgeSummaryUsed = guidedSummary.summaryUsed;
      }
      const knowledgeTelemetry = knowledgeBase.toTelemetry(knowledgeSelection, knowledgeSummaryUsed);
      messagesForModel = insertSystemContext(messagesForModel, GUARDRAIL_SYSTEM_MESSAGE);
      messagesForModel = insertSystemContext(messagesForModel, ASSISTANT_STYLE_SYSTEM_MESSAGE);

      const useAuto = model === "auto" || (!model && autoModel);
      const hasImageInput = messagesForModel.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((part: any) => part?.type === "image_url" && part?.image_url?.url)
      );
      const resolvedModel = hasImageInput
        ? IMAGE_ANALYSIS_MODEL
        : useAuto
          ? autoSelectModel(messagesForModel)
          : model || defaultModel;
      if (!MODEL_IDS.has(resolvedModel)) {
        console.error("[/api/chat] model not allowed:", resolvedModel);
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      console.log("[/api/chat] model:", resolvedModel);
      const fallbackOrder = hasImageInput
        ? [IMAGE_ANALYSIS_MODEL, ...IMAGE_ANALYSIS_FALLBACKS]
        : resolvedModel === "openai/gpt-oss-120b"
          ? ["openai/gpt-oss-120b", "qwen/qwen3-32b", "meta-llama/llama-3.3-70b-versatile"]
          : [resolvedModel, "openai/gpt-oss-120b", "qwen/qwen3-32b"];
      const uniqueCandidates = fallbackOrder.filter((m, i, arr) => arr.indexOf(m) === i).filter((m) => MODEL_IDS.has(m));

      billingRequestId = createRequestId("chat");
      billingReserved = await estimateReserveForModels({
        models: uniqueCandidates,
        estimatedInputTokens: estimateTokensFromMessages(messagesForModel),
        estimatedOutputTokens: maxTokens,
        safetyMultiplier: 1.3,
        endpoint: "/api/chat",
      });
      await reserveCredits({
        uid,
        amountBrl: billingReserved,
        requestId: billingRequestId,
        endpoint: "/api/chat",
      });

      let data: any = null;
      let usedModel = resolvedModel;
      let lastErr = "";
      for (const candidate of uniqueCandidates) {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: candidate,
            temperature,
            max_tokens: maxTokens,
            messages: messagesForModel,
          }),
        });
        if (!response.ok) {
          const text = await response.text();
          lastErr = text || `Erro ${response.status}`;
          console.warn(`[ /api/chat ] model fallback failed (${candidate}):`, response.status);
          continue;
        }
        data = await response.json();
        usedModel = candidate;
        break;
      }
      if (!data) {
        await refundReserve({
          uid,
          requestId: billingRequestId,
          amountBrl: billingReserved,
          endpoint: "/api/chat",
          reason: "no_model_succeeded",
        });
        billingReserved = 0;
        res.status(502).json({ error: lastErr || "Falha ao consultar IA." });
        return;
      }

      const content = String(data?.choices?.[0]?.message?.content ?? "");
      const usageFromProvider = buildUsageFromGroq(usedModel, data?.usage, "/api/chat");
      if (usageFromProvider.estimated) {
        usageFromProvider.inputTokens = Math.max(usageFromProvider.inputTokens || 0, estimateTokensFromMessages(messagesForModel));
        usageFromProvider.outputTokens = Math.max(usageFromProvider.outputTokens || 0, estimateTokensFromText(content));
      }
      const billing = await settleReservedCredits({
        uid,
        requestId: billingRequestId,
        endpoint: "/api/chat",
        reservedBrl: billingReserved,
        usageInputs: [usageFromProvider],
      });
      billingReserved = 0;

      console.log(
        "[/api/chat] knowledge:",
        JSON.stringify({
          docsUsed: knowledgeTelemetry.docsUsed,
          contextChars: knowledgeTelemetry.contextChars,
          summaryUsed: knowledgeTelemetry.summaryUsed,
          policy: knowledgeTelemetry.policy,
          latencyMs: Date.now() - requestStartedAt,
        }),
      );
      console.log("[/api/chat] success");
      res.json({ content, model: usedModel, knowledge: knowledgeTelemetry, billing });
    } catch (error: any) {
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/chat",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/chat] falha no refund:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error("Erro no /api/chat:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/chat-stream", async (req, res) => {
    let billingRequestId = "";
    let billingReserved = 0;
    let billingUid = "";
    let processingJobId = "";
    const usageInputs: Array<{
      provider: "groq";
      model: string;
      inputTokens: number;
      outputTokens: number;
      estimated: boolean;
    }> = [];
    const writeChunk = (payload: Record<string, any>) => {
      if (res.writableEnded || (res as any).destroyed || (res as any)?.socket?.destroyed) return;
      try {
        res.write(`${JSON.stringify(payload)}\n`);
      } catch {
        // Cliente pode ter desconectado; o processamento segue no backend.
      }
    };
    try {
      console.log("[/api/chat-stream] request received");
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      billingUid = uid;

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        console.error("[/api/chat-stream] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf, pendingPdfs } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
        pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>;
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }

      const normalizedPendingPdfs = Array.isArray(pendingPdfs)
        ? pendingPdfs
        : pendingPdf
          ? [pendingPdf]
          : [];
      let messagesForModel = await injectPendingPdfContext(messages, normalizedPendingPdfs);
      const requestStartedAt = Date.now();
      const knowledgeSelection = knowledgeBase.selectForMessages(messagesForModel);
      let knowledgeSummaryUsed = false;
      if (knowledgeSelection) {
        const knowledgeContextMessage = knowledgeBase.buildContextSystemMessage(knowledgeSelection);
        if (knowledgeContextMessage) {
          messagesForModel = insertSystemContext(messagesForModel, knowledgeContextMessage);
        }
        const guidedSummary = await knowledgeBase.maybeBuildGuidedSummary(
          knowledgeSelection,
          async ({ model: summaryModel, messages: summaryMessages, maxTokens: summaryMaxTokens, temperature: summaryTemperature }) =>
            callGroqChat(apiKey, summaryModel, summaryMessages, summaryMaxTokens, summaryTemperature),
        );
        if (guidedSummary.message) {
          messagesForModel = insertSystemContext(messagesForModel, guidedSummary.message);
        }
        knowledgeSummaryUsed = guidedSummary.summaryUsed;
      }
      const knowledgeTelemetry = knowledgeBase.toTelemetry(knowledgeSelection, knowledgeSummaryUsed);
      messagesForModel = insertSystemContext(messagesForModel, GUARDRAIL_SYSTEM_MESSAGE);
      messagesForModel = insertSystemContext(messagesForModel, ASSISTANT_STYLE_SYSTEM_MESSAGE);

      const useAuto = model === "auto" || (!model && AUTO_MODEL);
      const hasImageInput = messagesForModel.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((part: any) => part?.type === "image_url" && part?.image_url?.url)
      );
      const resolvedModel = hasImageInput
        ? IMAGE_ANALYSIS_MODEL
        : useAuto
          ? autoSelectModel(messagesForModel)
          : model || DEFAULT_MODEL;
      if (!MODEL_IDS.has(resolvedModel)) {
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      const fallbackModels = hasImageInput
        ? [
          ...IMAGE_ANALYSIS_FALLBACKS,
          "meta-llama/llama-4-scout-17b-16e-instruct",
        ]
        : [
          "openai/gpt-oss-120b",
          "meta-llama/llama-3.3-70b-versatile",
          "qwen/qwen3-32b",
          "moonshotai/kimi-k2-instruct-0905",
        ];
      const startupCandidates = [resolvedModel, ...fallbackModels.filter((m) => m !== resolvedModel)];
      const MAX_CONTINUATIONS = 2;
      const maxResponseTokensEstimate = MAX_TOKENS * (MAX_CONTINUATIONS + 1);

      billingRequestId = createRequestId("chat_stream");
      billingReserved = await estimateReserveForModels({
        models: startupCandidates,
        estimatedInputTokens: estimateTokensFromMessages(messagesForModel),
        estimatedOutputTokens: maxResponseTokensEstimate,
        safetyMultiplier: 1.15,
        endpoint: "/api/chat-stream",
      });
      await reserveCredits({
        uid,
        amountBrl: billingReserved,
        requestId: billingRequestId,
        endpoint: "/api/chat-stream",
      });

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const processingJob = startJob({
        uid,
        endpoint: "/api/chat-stream",
        metadata: { model: resolvedModel },
      });
      processingJobId = processingJob.jobId;
      req.on("close", () => {
        markDisconnected(processingJobId);
      });

      const throwIfCancelled = () => {
        if (processingJobId && isCancelRequested(processingJobId)) {
          throw new JobCancelledError();
        }
      };

      writeChunk({ type: "job_started", jobId: processingJobId });

      // --- Accumulated answer (visible to user) and thinking (hidden) ---
      let accumulatedAnswer = "";
      let accumulatedThinking = "";
      const clientModel = resolvedModel;

      /**
       * Streams one model segment. Returns { finishReason, segmentText }.
       * segmentText is the RAW text this segment produced (may contain <think> tags).
       * Deltas are emitted to the client using the accumulated answer so far.
       */
      const streamModelSegment = async (
        segmentModel: string,
        segmentMessages: Array<{ role: string; content: any }>
      ): Promise<{ finishReason: string; segmentText: string }> => {
        const segmentInputTokens = estimateTokensFromMessages(segmentMessages);
        let segmentRaw = "";
        let usageRecorded = false;
        const recordUsage = () => {
          if (usageRecorded) return;
          usageRecorded = true;
          usageInputs.push({
            provider: "groq",
            model: segmentModel,
            inputTokens: Math.max(1, segmentInputTokens),
            outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
            estimated: true,
          });
        };
        throwIfCancelled();
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: segmentModel,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: true,
            messages: segmentMessages,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          throw new Error(`groq ${segmentModel} ${upstream.status}: ${text.slice(0, 500)}`);
        }

        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        let buffer = "";
        let finishReason = "";

        while (true) {
          if (processingJobId && isCancelRequested(processingJobId)) {
            recordUsage();
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new JobCancelledError();
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              recordUsage();
              return { finishReason: finishReason || "stop", segmentText: segmentRaw };
            }
            try {
              const parsed = JSON.parse(data);
              const choice = parsed?.choices?.[0];
              const delta = choice?.delta?.content;
              const fr = choice?.finish_reason;
              if (typeof fr === "string" && fr) finishReason = fr;
              if (typeof delta === "string" && delta.length > 0) {
                segmentRaw += delta;
                // Parse this segment's think tags separately
                const segSplit = splitThinkProgress(segmentRaw);
                // Emit combined accumulated + this segment's visible text
                writeChunk({
                  type: "delta",
                  model: clientModel,
                  thinkingText: accumulatedThinking + (segSplit.thinkingText ? "\n\n" + segSplit.thinkingText : ""),
                  content: accumulatedAnswer + segSplit.answerText,
                });
              }
            } catch {
              // Ignore malformed data chunks from upstream
            }
          }
        }

        recordUsage();
        return { finishReason: finishReason || "stop", segmentText: segmentRaw };
      };

      // --- Phase 1: Start streaming with the first available model ---
      let activeModel = "";
      let firstResult: { finishReason: string; segmentText: string } | null = null;
      for (const candidate of startupCandidates) {
        if (!MODEL_IDS.has(candidate)) continue;
        try {
          firstResult = await streamModelSegment(candidate, messagesForModel);
          activeModel = candidate;
          break;
        } catch (err) {
          if (err instanceof JobCancelledError) throw err;
          console.warn(`[chat-stream] startup model failed (${candidate})`, err);
        }
      }
      if (!firstResult) {
        throw new Error("Nenhum modelo disponível para iniciar streaming.");
      }

      // Commit first segment's output
      const firstSplit = splitThinkProgress(firstResult.segmentText);
      accumulatedAnswer += firstSplit.answerText;
      if (firstSplit.thinkingText) {
        accumulatedThinking += (accumulatedThinking ? "\n\n" : "") + firstSplit.thinkingText;
      }

      // --- Phase 2: Continue if the model hit max_tokens (finish_reason: "length") ---
      let continuationsUsed = 0;
      let lastFinishReason = firstResult.finishReason;

      while (lastFinishReason === "length" && continuationsUsed < MAX_CONTINUATIONS) {
        throwIfCancelled();
        continuationsUsed += 1;

        // Trim trailing incomplete sentence to avoid garbled joins
        const trimmedAnswer = trimToLastCompleteSentence(accumulatedAnswer);

        const continuationInstruction =
          "Sua resposta anterior foi cortada. Continue EXATAMENTE de onde parou.\n" +
          "REGRAS:\n" +
          "- NÃO repita nenhum conteúdo já escrito.\n" +
          "- Mantenha o mesmo idioma, tom, formato (markdown/bullets/tabelas) e contexto técnico.\n" +
          "- Entregue SOMENTE a continuação, começando da próxima palavra/frase.\n" +
          "- NÃO adicione informações novas que não faziam parte do raciocínio original.\n" +
          "- NÃO invente dados, normas ou fontes.";

        const continuationMessages = [
          ...messagesForModel,
          { role: "assistant" as const, content: trimmedAnswer },
          { role: "user" as const, content: continuationInstruction },
        ];

        // Try the SAME model first, then fallback to others
        const candidatesForContinuation = [activeModel, ...startupCandidates.filter((m) => m !== activeModel)];
        let contResult: { finishReason: string; segmentText: string } | null = null;

        for (const candidate of candidatesForContinuation) {
          if (!MODEL_IDS.has(candidate)) continue;
          try {
            contResult = await streamModelSegment(candidate, continuationMessages);
            activeModel = candidate;
            break;
          } catch (err) {
            if (err instanceof JobCancelledError) throw err;
            console.warn(`[chat-stream] continuation model failed (${candidate})`, err);
          }
        }

        if (!contResult) {
          console.warn("[chat-stream] No model available for continuation, stopping.");
          break;
        }

        // Commit continuation segment
        const contSplit = splitThinkProgress(contResult.segmentText);
        accumulatedAnswer += contSplit.answerText;
        if (contSplit.thinkingText) {
          accumulatedThinking += (accumulatedThinking ? "\n\n" : "") + contSplit.thinkingText;
        }
        lastFinishReason = contResult.finishReason;
      }

      const finalSplit = { thinkingText: accumulatedThinking.trim(), answerText: accumulatedAnswer.trim() };
      if (!usageInputs.length) {
        usageInputs.push({
          provider: "groq",
          model: activeModel || resolvedModel,
          inputTokens: Math.max(1, estimateTokensFromMessages(messagesForModel)),
          outputTokens: Math.max(1, estimateTokensFromText(finalSplit.answerText)),
          estimated: true,
        });
      }
      const billing = await settleReservedCredits({
        uid,
        requestId: billingRequestId,
        endpoint: "/api/chat-stream",
        reservedBrl: billingReserved,
        usageInputs,
      });
      billingReserved = 0;
      finishJob({
        jobId: processingJobId,
        status: "completed",
        billingSummary: {
          chargedBrl: billing.chargedBrl,
          balanceAfterBrl: billing.balanceAfterBrl,
        },
      });

      console.log(
        "[/api/chat-stream] knowledge:",
        JSON.stringify({
          docsUsed: knowledgeTelemetry.docsUsed,
          contextChars: knowledgeTelemetry.contextChars,
          summaryUsed: knowledgeTelemetry.summaryUsed,
          policy: knowledgeTelemetry.policy,
          latencyMs: Date.now() - requestStartedAt,
        }),
      );
      writeChunk({
        type: "done",
        model: clientModel,
        thinkingText: finalSplit.thinkingText,
        content: finalSplit.answerText,
        knowledge: knowledgeTelemetry,
        billing,
      });
      if (!res.writableEnded && !(res as any).destroyed) res.end();
    } catch (error: any) {
      if (error instanceof JobCancelledError) {
        let chargedBrl = 0;
        try {
          if (billingUid && billingReserved > 0 && billingRequestId) {
            if (usageInputs.length > 0) {
              const settled = await settleReservedCredits({
                uid: billingUid,
                requestId: billingRequestId,
                endpoint: "/api/chat-stream",
                reservedBrl: billingReserved,
                usageInputs,
              });
              chargedBrl = settled.chargedBrl;
              billingReserved = 0;
            } else {
              await refundReserve({
                uid: billingUid,
                requestId: billingRequestId,
                amountBrl: billingReserved,
                endpoint: "/api/chat-stream",
                reason: "cancel_requested_without_usage",
              });
              billingReserved = 0;
            }
            const cancelFloor = await applyCancelFloorDebit({
              uid: billingUid,
              requestId: billingRequestId,
              endpoint: "/api/chat-stream",
              chargedBrl,
            });
            finishJob({
              jobId: processingJobId,
              status: "cancelled",
              billingSummary: {
                chargedBrl,
                finalChargedBrl: cancelFloor.finalChargedBrl,
                floorDeltaBrl: cancelFloor.floorDeltaBrl,
                balanceAfterBrl: cancelFloor.balanceAfterBrl,
              },
            });
          } else {
            finishJob({ jobId: processingJobId, status: "cancelled" });
          }
        } catch (billingErr) {
          console.error("[/api/chat-stream] cancel billing error:", billingErr);
          finishJob({
            jobId: processingJobId,
            status: "failed",
            error: (billingErr as any)?.message || "cancel_billing_failed",
          });
        }
        writeChunk({
          type: "cancelled",
          message: "Cancelamento solicitado. Cobrança proporcional aplicada.",
        });
        if (!res.writableEnded && !(res as any).destroyed) res.end();
        return;
      }
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/chat-stream",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/chat-stream] falha no refund:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        finishJob({
          jobId: processingJobId,
          status: "failed",
          error: error.message,
        });
        if (!res.headersSent) {
          res.status(error.statusCode).json({ error: error.message, code: error.code });
        } else {
          writeChunk({ type: "error", error: error.message, code: error.code });
          if (!res.writableEnded && !(res as any).destroyed) res.end();
        }
        return;
      }
      console.error("Erro no /api/chat-stream:", error);
      finishJob({
        jobId: processingJobId,
        status: "failed",
        error: error?.message || "stream_failed",
      });
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Erro interno" });
      } else {
        if (!res.writableEnded && !(res as any).destroyed) res.end();
      }
    }
  });
}
