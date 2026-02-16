import express from "express";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import { inflateRawSync } from "zlib";
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
  const SEMA_WMS_BASE =
    process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
  const SEMA_WMS_AUTHKEY =
    process.env.SEMA_WMS_AUTHKEY ||
    "541085de-9a2e-454e-bdba-eb3d57a2f492";

  const parseLayersFromCapabilities = (xml: string) => {
    const layerRegex = /<Layer\b[\s\S]*?<\/Layer>/g;
    const nameRegex = /<Name>\s*([^<]+)\s*<\/Name>/i;
    const titleRegex = /<Title>\s*([^<]+)\s*<\/Title>/i;
    const crsRegex = /<(?:CRS|SRS)>\s*([^<]+)\s*<\/(?:CRS|SRS)>/gi;
    const out: Array<{
      name: string;
      title: string;
      crs: string[];
      inferredYear?: string;
      group: "spot" | "landsat" | "other";
    }> = [];

    const blocks = xml.match(layerRegex) || [];
    for (const block of blocks) {
      const nameMatch = block.match(nameRegex);
      if (!nameMatch) continue;
      const rawName = (nameMatch[1] || "").trim();
      if (!rawName) continue;
      if (/^(spot|landsat|mosaico|satelite|satelite|imagem)$/i.test(rawName)) {
        continue;
      }

      const titleMatch = block.match(titleRegex);
      const title = (titleMatch?.[1] || rawName).trim();

      const crs: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = crsRegex.exec(block)) !== null) {
        const code = String(m[1] || "").trim();
        if (code && !crs.includes(code)) crs.push(code);
      }

      const combined = `${rawName} ${title}`.toLowerCase();
      const yearMatch = combined.match(/\b(19|20)\d{2}\b/);
      const inferredYear = yearMatch?.[0];
      const group = /spot/.test(combined)
        ? "spot"
        : /landsat/.test(combined)
          ? "landsat"
          : "other";

      out.push({ name: rawName, title, crs, inferredYear, group });
    }

    const uniq = new Map<string, (typeof out)[number]>();
    for (const item of out) {
      if (!uniq.has(item.name)) uniq.set(item.name, item);
    }

    return [...uniq.values()].sort((a, b) => {
      const score = (x: typeof a) => {
        let s = 0;
        if (x.group === "spot") s += 50;
        if (x.group === "landsat") s += 40;
        if (x.inferredYear === "2008") s += 100;
        return s;
      };
      return score(b) - score(a) || a.name.localeCompare(b.name);
    });
  };

  const decodeDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("dataUrl inválido.");
    const mimeType = match[1] || "application/octet-stream";
    const payload = match[2];
    return { mimeType, buffer: Buffer.from(payload, "base64") };
  };

  const parseKmlBbox = (kml: string) => {
    const coordBlocks = [...kml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    if (!coordBlocks.length) {
      throw new Error("KML sem bloco <coordinates>.");
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const block of coordBlocks) {
      const raw = String(block[1] || "").trim();
      if (!raw) continue;
      const tuples = raw.split(/\s+/);
      for (const t of tuples) {
        const [xStr, yStr] = t.split(",");
        const x = Number(xStr);
        const y = Number(yStr);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      throw new Error("Não foi possível extrair coordenadas válidas do KML.");
    }
    return [minX, minY, maxX, maxY] as [number, number, number, number];
  };

  const extractZipEntries = (zipBuffer: Buffer) => {
    // Minimal ZIP parser for local file headers (supports "stored" and "deflate")
    const entries: Array<{ name: string; data: Buffer }> = [];
    let offset = 0;
    while (offset + 30 <= zipBuffer.length) {
      const signature = zipBuffer.readUInt32LE(offset);
      if (signature !== 0x04034b50) break;
      const method = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
      const extraLength = zipBuffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const nameEnd = nameStart + fileNameLength;
      const fileName = zipBuffer.subarray(nameStart, nameEnd).toString("utf8");
      const dataStart = nameEnd + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBuffer.length) break;
      const compressed = zipBuffer.subarray(dataStart, dataEnd);
      let data: Buffer;
      if (method === 0) {
        data = Buffer.from(compressed);
      } else if (method === 8) {
        data = Buffer.from(inflateRawSync(compressed));
      } else {
        offset = dataEnd;
        continue;
      }
      entries.push({ name: fileName, data });
      offset = dataEnd;
    }
    return entries;
  };

  app.get("/api/models", (_req, res) => {
    const defaultModel = process.env.GROQ_MODEL || "meta-llama/llama-3.3-70b-versatile";
    res.json({ models: MODEL_CATALOG, defaultModel });
  });

  app.get("/api/map/capabilities", async (_req, res) => {
    try {
      const capUrl = new URL(SEMA_WMS_BASE);
      capUrl.searchParams.set("service", "WMS");
      capUrl.searchParams.set("request", "GetCapabilities");
      capUrl.searchParams.set("version", "1.3.0");
      if (SEMA_WMS_AUTHKEY) {
        capUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
      }

      const response = await fetch(capUrl.toString());
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({
          error: "Falha ao carregar capabilities da SEMA.",
          details: text.slice(0, 500),
        });
        return;
      }

      const xml = await response.text();
      const layers = parseLayersFromCapabilities(xml).map((l) => ({
        name: l.name,
        title: l.title,
        crs: l.crs,
        inferredYear: l.inferredYear,
        group: l.group,
      }));

      const defaultLayer =
        layers.find((l) => l.group === "spot" && l.inferredYear === "2008")?.name ||
        layers.find((l) => l.group === "spot")?.name ||
        layers.find((l) => l.group === "landsat")?.name ||
        layers[0]?.name;

      res.json({
        serviceTitle: "SEMA WMS",
        layers,
        defaultLayer,
      });
    } catch (error: any) {
      console.error("Erro no /api/map/capabilities:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/map/snapshot", async (req, res) => {
    try {
      const {
        layerName,
        bbox,
        crs = "EPSG:4326",
        width = 1200,
        height = 800,
        format = "image/png",
      } = req.body as {
        layerName?: string;
        bbox?: [number, number, number, number];
        crs?: string;
        width?: number;
        height?: number;
        format?: "image/png" | "image/jpeg";
      };

      if (!layerName || !bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        res.status(400).json({ error: "Parâmetros inválidos para snapshot de mapa." });
        return;
      }

      const [minX, minY, maxX, maxY] = bbox.map(Number);
      if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
        res.status(400).json({ error: "BBox inválida." });
        return;
      }

      const mapUrl = new URL(SEMA_WMS_BASE);
      mapUrl.searchParams.set("service", "WMS");
      mapUrl.searchParams.set("request", "GetMap");
      mapUrl.searchParams.set("version", "1.1.1");
      mapUrl.searchParams.set("layers", layerName);
      mapUrl.searchParams.set("styles", "");
      mapUrl.searchParams.set("format", format);
      mapUrl.searchParams.set("transparent", "false");
      mapUrl.searchParams.set("srs", crs);
      mapUrl.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY}`);
      mapUrl.searchParams.set("width", String(Math.max(256, Math.min(4096, Math.floor(width)))));
      mapUrl.searchParams.set("height", String(Math.max(256, Math.min(4096, Math.floor(height)))));
      if (SEMA_WMS_AUTHKEY) {
        mapUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
      }

      const response = await fetch(mapUrl.toString());
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({
          error: "Falha ao obter imagem WMS da SEMA.",
          details: text.slice(0, 500),
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (!contentType.includes("image")) {
        const text = await response.text();
        const layerNotDefined = /LayerNotDefined|Could not find layer/i.test(text);
        if (layerNotDefined) {
          const capUrl = new URL(SEMA_WMS_BASE);
          capUrl.searchParams.set("service", "WMS");
          capUrl.searchParams.set("request", "GetCapabilities");
          capUrl.searchParams.set("version", "1.3.0");
          if (SEMA_WMS_AUTHKEY) capUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
          const capRes = await fetch(capUrl.toString());
          const capText = capRes.ok ? await capRes.text() : "";
          const available = parseLayersFromCapabilities(capText).slice(0, 12).map((l) => l.name);
          res.status(400).json({
            error: `Layer '${layerName}' não existe no WMS da SEMA.`,
            availableLayers: available,
          });
          return;
        }
        res.status(502).json({
          error: "Resposta do WMS não retornou imagem.",
          details: text.slice(0, 500),
        });
        return;
      }

      const arr = await response.arrayBuffer();
      const base64 = Buffer.from(arr).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;

      res.json({
        dataUrl,
        mimeType: contentType,
        sourceUrl: mapUrl.toString(),
        mapContext: {
          layerName,
          bbox: [minX, minY, maxX, maxY],
          crs,
          width,
          height,
          source: "SEMA_WMS",
        },
      });
    } catch (error: any) {
      console.error("Erro no /api/map/snapshot:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/geometry/bbox", async (req, res) => {
    try {
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }
      const name = String(filename || "").toLowerCase();
      const { mimeType, buffer } = decodeDataUrl(dataUrl);

      if (name.endsWith(".kml") || mimeType.includes("kml") || mimeType.includes("xml")) {
        const text = buffer.toString("utf8");
        const bbox = parseKmlBbox(text);
        res.json({ bbox, crs: "EPSG:4326", source: "kml" });
        return;
      }

      if (name.endsWith(".zip") || mimeType.includes("zip")) {
        const entries = extractZipEntries(buffer);
        const shp = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
        if (!shp) {
          const kmlInside = entries.find((e) => e.name.toLowerCase().endsWith(".kml"));
          if (kmlInside) {
            const bbox = parseKmlBbox(kmlInside.data.toString("utf8"));
            res.json({ bbox, crs: "EPSG:4326", source: "kml_zip" });
            return;
          }
          res.status(400).json({ error: "ZIP sem .shp ou .kml." });
          return;
        }
        if (shp.data.length < 100) {
          res.status(400).json({ error: "Arquivo .shp inválido." });
          return;
        }
        // Shapefile main header bbox (bytes 36..67 little endian)
        const minX = shp.data.readDoubleLE(36);
        const minY = shp.data.readDoubleLE(44);
        const maxX = shp.data.readDoubleLE(52);
        const maxY = shp.data.readDoubleLE(60);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          res.status(400).json({ error: "Não foi possível extrair bbox do shapefile." });
          return;
        }
        res.json({ bbox: [minX, minY, maxX, maxY], crs: "EPSG:4326", source: "shapefile_zip_header" });
        return;
      }

      res.status(400).json({ error: "Formato não suportado. Envie .kml ou .zip (shapefile)." });
    } catch (error: any) {
      console.error("Erro no /api/geometry/bbox:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
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

      const { messages, model, pendingPdf } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
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

      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl de PDF inválido." });
        return;
      }
      const mimeType = match[1] || "application/pdf";
      const base64Payload = match[2];
      const fileBuffer = Buffer.from(base64Payload, "base64");

      let extractedText = "";
      let pageCount = 0;
      try {
        const parsed = await pdfParse(fileBuffer);
        extractedText = (parsed?.text || "")
          .replace(/\r/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        pageCount = Number(parsed?.numpages || 0);
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
      const blob = new Blob([fileBuffer], { type: mimeType });
      const uploadFilename = filename && filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename || "documento"}.pdf`;
      form.append("file", blob, uploadFilename);
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
      const fallbackExt = String(data?.format || "pdf").toLowerCase();
      const safeAttachmentName = String(filename || `arquivo.${fallbackExt}`).replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      const downloadUrl = secureUrl.includes("/upload/")
        ? secureUrl.replace(
            "/upload/",
            `/upload/fl_attachment:${encodeURIComponent(safeAttachmentName)}/`
          )
        : secureUrl;
      res.json({
        public_id: data.public_id,
        secure_url: secureUrl,
        download_url: downloadUrl,
        original_filename: safeAttachmentName,
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

  app.get("/api/file-proxy", async (req, res) => {
    try {
      const mode = String(req.query.mode || "inline");
      const remoteUrl = String(req.query.url || "");
      const name = String(req.query.name || "arquivo.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

      if (!remoteUrl || !remoteUrl.startsWith("https://res.cloudinary.com/da19dwpgk/")) {
        res.status(400).json({ error: "URL de arquivo inválida." });
        return;
      }

      const upstream = await fetch(remoteUrl);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        res.status(upstream.status || 502).send(text || "Falha ao obter arquivo.");
        return;
      }

      const isAttachment = mode === "download";
      const contentType = name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `${isAttachment ? "attachment" : "inline"}; filename="${name}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (error: any) {
      console.error("Erro no /api/file-proxy:", error);
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
