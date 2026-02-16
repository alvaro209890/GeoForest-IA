import express from "express";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "12mb" }));

  // Basic CORS for local development
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const MODEL_CATALOG = [
    {
      id: "meta-llama/llama-3.3-70b-versatile",
      label: "Llama 3.3 70B",
      capabilities: ["text"],
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-guard-4-12b",
      label: "Llama Guard 4 12B",
      capabilities: ["text", "vision"],
    },
    {
      id: "qwen/qwen3-32b",
      label: "Qwen 3 32B",
      capabilities: ["text"],
    },
    {
      id: "moonshotai/kimi-k2-instruct-0905",
      label: "Kimi K2 Instruct (0905)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT-OSS 20B",
      capabilities: ["text"],
    },
  ] as const;

  const MODEL_IDS = new Set(MODEL_CATALOG.map((model) => model.id));

  app.get("/api/models", (_req, res) => {
    const defaultModel = process.env.GROQ_MODEL || "meta-llama/llama-3.3-70b-versatile";
    res.json({ models: MODEL_CATALOG, defaultModel });
  });

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

    const hasDataCue =
      /(shapefile|shape|geojson|csv|xlsx|planilha|tabela|dados|estat[ií]stica|an[áa]lise)/.test(text);
    if (hasDataCue) return "meta-llama/llama-3.3-70b-versatile";

    return "meta-llama/llama-3.3-70b-versatile";
  };

  const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-versatile";
  const TEMPERATURE = 0.1;
  const MAX_TOKENS = 800;
  const AUTO_MODEL = true;
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
    pendingPdf?: { dataUrl?: string; filename?: string }
  ) => {
    if (!pendingPdf?.dataUrl || typeof pendingPdf.dataUrl !== "string") return messages;
    const parts = pendingPdf.dataUrl.split(",");
    if (parts.length !== 2) return messages;

    let extractedText = "";
    try {
      const raw = Buffer.from(parts[1], "base64");
      const parsed = await pdfParse(raw);
      extractedText = (parsed?.text || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 25000);
    } catch (err) {
      console.warn("[/api/chat-stream] pendingPdf parse failed:", err);
    }

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
      const context =
        `\n\nDocumento PDF anexado pelo usuário (${pendingPdf.filename || "documento.pdf"}).` +
        (extractedText
          ? `\nUse o conteúdo extraído abaixo como base:\n${extractedText}`
          : "\nNão foi possível extrair texto automaticamente; informe essa limitação.");
      next[i] = { ...msg, content: `${baseText}${context}`.trim() };
      break;
    }

    return next;
  };

  app.post("/api/chat", async (req, res) => {
    try {
      console.log("[/api/chat] request received");
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

      const { messages, model, pendingPdf } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        console.error("[/api/chat] invalid messages payload");
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }

      const useAuto = model === "auto" || (!model && autoModel);
      const resolvedModel = useAuto ? autoSelectModel(messages) : model || defaultModel;
      if (!MODEL_IDS.has(resolvedModel)) {
        console.error("[/api/chat] model not allowed:", resolvedModel);
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      console.log("[/api/chat] model:", resolvedModel);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature,
          max_tokens: maxTokens,
          messages,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/chat] groq error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      console.log("[/api/chat] success");
      res.json({ content, model: resolvedModel });
    } catch (error: any) {
      console.error("Erro no /api/chat:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/chat-stream", async (req, res) => {
    try {
      console.log("[/api/chat-stream] request received");
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        console.error("[/api/chat-stream] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }

      const messagesForModel = await injectPendingPdfContext(messages, pendingPdf);

      const useAuto = model === "auto" || (!model && AUTO_MODEL);
      const resolvedModel = useAuto ? autoSelectModel(messagesForModel) : model || DEFAULT_MODEL;
      if (!MODEL_IDS.has(resolvedModel)) {
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          stream: true,
          messages: messagesForModel,
        }),
      });

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        console.error("[/api/chat-stream] groq error:", upstream.status, text);
        res.status(upstream.status || 500).json({ error: text || "Erro no streaming da IA." });
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();

      const writeChunk = (payload: Record<string, any>) => {
        res.write(`${JSON.stringify(payload)}\n`);
      };

      let rawModelText = "";
      let buffer = "";

      while (true) {
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
            const finalSplit = splitThinkProgress(rawModelText);
            writeChunk({
              type: "done",
              model: resolvedModel,
              thinkingText: finalSplit.thinkingText,
              content: finalSplit.answerText,
            });
            res.end();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              rawModelText += delta;
              const split = splitThinkProgress(rawModelText);
              writeChunk({
                type: "delta",
                model: resolvedModel,
                thinkingText: split.thinkingText,
                content: split.answerText,
              });
            }
          } catch {
            // Ignore malformed data chunks from upstream
          }
        }
      }

      const finalSplit = splitThinkProgress(rawModelText);
      res.write(
        encoder.encode(
          `${JSON.stringify({
            type: "done",
            model: resolvedModel,
            thinkingText: finalSplit.thinkingText,
            content: finalSplit.answerText,
          })}\n`
        )
      );
      res.end();
    } catch (error: any) {
      console.error("Erro no /api/chat-stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Erro interno" });
      } else {
        res.end();
      }
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.post("/api/upload-image", async (req, res) => {
    try {
      console.log("[/api/upload-image] request received");
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-image] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary não configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-image] dataUrl missing");
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      form.append("file", dataUrl);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-image] cloudinary error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      console.log("[/api/upload-image] success:", data?.public_id);
      res.json({
        public_id: data.public_id,
        secure_url: data.secure_url,
        width: data.width,
        height: data.height,
        format: data.format,
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-image:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/upload-file", async (req, res) => {
    try {
      console.log("[/api/upload-file] request received");
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-file] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary não configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-file] dataUrl missing");
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      let extractedText = "";
      let pageCount = 0;
      try {
        const parts = dataUrl.split(",");
        if (parts.length === 2) {
          const raw = Buffer.from(parts[1], "base64");
          const parsed = await pdfParse(raw);
          extractedText = (parsed?.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          pageCount = Number(parsed?.numpages || 0);
        }
      } catch (err) {
        console.warn("[/api/upload-file] failed to parse PDF text:", err);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      form.append("file", dataUrl);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      form.append("resource_type", "raw");
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-file] cloudinary error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      console.log("[/api/upload-file] success:", data?.public_id);
      const secureUrl = String(data?.secure_url || "");
      const downloadUrl = secureUrl.includes("/upload/")
        ? secureUrl.replace("/upload/", "/upload/fl_attachment/")
        : secureUrl;
      res.json({
        public_id: data.public_id,
        secure_url: secureUrl,
        download_url: downloadUrl,
        format: data.format,
        bytes: data.bytes,
        pages: pageCount,
        extracted_text: extractedText.slice(0, 25000),
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-file:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port =
    process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  const keepAliveUrl = process.env.KEEP_ALIVE_URL;
  const keepAliveInterval = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? "840000"); // 14 min
  if (keepAliveUrl) {
    setInterval(async () => {
      try {
        await fetch(keepAliveUrl, { method: "GET" });
      } catch (err) {
        console.warn("Keep-alive falhou:", err);
      }
    }, keepAliveInterval).unref();
  }
}

startServer().catch(console.error);
