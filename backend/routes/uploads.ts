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
      const mimeType = match[1] || "image/png";
      const ext = mimeType.split("/")[1] || "png";
      const buffer = Buffer.from(match[2], "base64");
      const stored = saveUserBuffer({
        uid,
        area: "attachments/images",
        filename: `${Date.now()}_${filename || `image.${ext}`}`,
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
      const mimeType = match[1] || "application/pdf";
      const base64Payload = match[2];
      const fileBuffer = Buffer.from(base64Payload, "base64");

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
      const uploadFilename = filename && filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename || "documento"}.pdf`;
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
