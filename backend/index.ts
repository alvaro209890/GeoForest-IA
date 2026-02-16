import express from "express";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

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
      id: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B (geral)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-120b",
      label: "GPT-OSS 120B (texto)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT-OSS 20B (texto)",
      capabilities: ["text"],
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout 17B (visão)",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick 17B (visão)",
      capabilities: ["text", "vision"],
    },
    {
      id: "groq/compound",
      label: "Compound (sistema)",
      capabilities: ["text"],
    },
    {
      id: "groq/compound-mini",
      label: "Compound Mini (sistema)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-safeguard-20b",
      label: "GPT-OSS Safeguard 20B (segurança)",
      capabilities: ["text"],
    },
    {
      id: "llama-3.2-90b-vision-preview",
      label: "Llama 3.2 90B (visão)",
      capabilities: ["text", "vision"],
    },
    {
      id: "llama-3.2-11b-vision-preview",
      label: "Llama 3.2 11B (visão leve)",
      capabilities: ["text", "vision"],
    },
    {
      id: "mixtral-8x7b-32768",
      label: "Mixtral 8x7B (texto)",
      capabilities: ["text"],
    },
  ] as const;

  const MODEL_IDS = new Set(MODEL_CATALOG.map((model) => model.id));

  app.get("/api/models", (_req, res) => {
    const defaultModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
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
    if (hasDataCue) return "llama-3.3-70b-versatile";

    return "llama-3.3-70b-versatile";
  };

  const DEFAULT_MODEL = "llama-3.3-70b-versatile";
  const TEMPERATURE = 0.1;
  const MAX_TOKENS = 800;
  const AUTO_MODEL = true;

  app.post("/api/chat", async (req, res) => {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      const defaultModel = DEFAULT_MODEL;
      const temperature = TEMPERATURE;
      const maxTokens = MAX_TOKENS;
      const autoModel = AUTO_MODEL;
      if (!apiKey) {
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

      const resolvedModel = model || (autoModel ? autoSelectModel(messages) : defaultModel);
      if (!MODEL_IDS.has(resolvedModel)) {
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

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
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      res.json({ content });
    } catch (error: any) {
      console.error("Erro no /api/chat:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.post("/api/upload-image", async (req, res) => {
    try {
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        res.status(500).json({ error: "Cloudinary não configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
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
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
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
