/**
 * Upload de imagem/PDF do chat e proxy de download
 * (`/api/upload-image`, `/api/upload-file`, `/api/file-proxy`).
 *
 * Extraído de `backend/index.ts` pelo mesmo motivo do `chat.ts`.
 */
import type { Express } from "express";
import path from "node:path";
import { parsePdfSafe } from "../lib/map-utils";
import { saveUserBuffer } from "../local-storage";

/**
 * Teto do arquivo decodificado. O corpo JSON já é limitado a 25 MB pelo
 * `express.json`; aqui garantimos que o base64 não vire um arquivo maior.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Extensão só sai daqui — nunca do nome que o cliente mandou. Antes, um
 * `data:text/html;base64,…` com `filename: "x.html"` era gravado em
 * `/api/storage` e servido como HTML (XSS armazenado no domínio da API).
 */
const ALLOWED_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function safeBaseName(raw: unknown, fallback: string): string {
  const base = path
    .basename(String(raw || fallback))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.[^.]+$/, "")
    .slice(0, 120);
  return base || fallback;
}

function estimateBytesFromDataUrl(dataUrl: string): number {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return 0;
  const base64Payload = String(match[2] || "").replace(/\s/g, "");
  if (!base64Payload) return 0;
  const padding = (base64Payload.match(/=+$/)?.[0]?.length || 0);
  return Math.max(0, Math.floor((base64Payload.length * 3) / 4) - padding);
}

export function registerUploadRoutes(app: Express): void {
  app.post("/api/upload-image", async (req, res) => {
    try {
      console.log("[/api/upload-image] request received");
      const uid = String(req.authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl inválido." });
        return;
      }
      const mimeType = String(match[1] || "").split(";")[0].trim().toLowerCase();
      const ext = ALLOWED_IMAGE_MIME[mimeType];
      if (!ext) {
        res.status(400).json({
          error: "Formato de imagem não suportado. Envie PNG, JPEG, WebP ou GIF.",
          code: "UNSUPPORTED_IMAGE_TYPE",
        });
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "Imagem maior que o limite de 25 MB." });
        return;
      }
      const stored = saveUserBuffer({
        uid,
        area: "attachments/images",
        filename: `${Date.now()}_${safeBaseName(filename, "image")}.${ext}`,
        buffer,
      });
      res.json({
        public_id: path.basename(stored.relativePath),
        secure_url: stored.publicUrl,
        width: null,
        height: null,
        format: ext,
        bytes: Math.max(1, estimateBytesFromDataUrl(dataUrl)),
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-image:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/upload-file", async (req, res) => {
    try {
      console.log("[/api/upload-file] request received");
      const uid = String(req.authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl de PDF inválido." });
        return;
      }
      const base64Payload = match[2];
      const fileBuffer = Buffer.from(base64Payload, "base64");
      if (fileBuffer.length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "PDF maior que o limite de 25 MB." });
        return;
      }
      if (fileBuffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        res.status(400).json({
          error: "O arquivo enviado não é um PDF válido.",
          code: "INVALID_PDF_SIGNATURE",
        });
        return;
      }

      let extractedText = "";
      let pageCount = 0;
      try {
        const parsed = await parsePdfSafe(fileBuffer);
        if (parsed?.text) {
          extractedText = (parsed.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          pageCount = Number(parsed?.numpages || 0);
        }
      } catch (err) {
        console.warn("[/api/upload-file] failed to parse PDF text:", err);
      }
      // Nome e extensão são normalizados aqui: o cliente nunca escolhe o path.
      const uploadFilename = `${safeBaseName(filename, "documento")}.pdf`;
      const stored = saveUserBuffer({
        uid,
        area: "attachments/pdfs",
        filename: `${Date.now()}_${uploadFilename}`,
        buffer: fileBuffer,
      });
      const safeAttachmentName = String(filename || "arquivo.pdf").replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      const downloadUrl = stored.publicUrl;
      res.json({
        public_id: path.basename(stored.relativePath),
        secure_url: stored.publicUrl,
        download_url: downloadUrl,
        original_filename: safeAttachmentName,
        format: "pdf",
        bytes: Math.max(1, fileBuffer.length),
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
      let remoteUrl = String(req.query.url || "").trim();
      const name = String(req.query.name || "arquivo.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      if (/^https?:\/\//i.test(remoteUrl)) {
        try {
          const parsed = new URL(remoteUrl);
          if (parsed.pathname.startsWith("/api/storage/")) {
            remoteUrl = `${parsed.pathname}${parsed.search}`;
          }
        } catch {
          remoteUrl = "";
        }
      }
      if (!remoteUrl || !remoteUrl.startsWith("/api/storage/")) {
        res.status(400).json({ error: "URL de arquivo inválida." });
        return;
      }
      res.redirect(
        mode === "download"
          ? `${remoteUrl}${remoteUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`
          : remoteUrl,
      );
    } catch (error: any) {
      console.error("Erro no /api/file-proxy:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });
}
