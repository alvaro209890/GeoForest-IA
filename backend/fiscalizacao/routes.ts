/**
 * Rotas HTTP /api/fiscalizacao/*.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
} from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { parseUserShapefile } from "../simcar";
import { parseBase64Zip, safeSegment } from "../overlap/utils";
import { CACHE_TTL_MS, DEFAULT_BUFFER_METERS, SOURCE_LABELS } from "./constants";
import { runFiscalizacaoJob } from "./pipeline";
import { persistJob, subscribers, writeSse } from "./sse";
import { FISCALIZACAO_SOURCES } from "./types";

function uidOf(req: Request): string {
  return String((req as any).authUid || "").trim();
}

export function registerFiscalizacaoRoutes(app: Express): void {
  app.get("/api/fiscalizacao/sources", async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      sources: FISCALIZACAO_SOURCES.map((id) => ({ id, label: SOURCE_LABELS[id] })),
    });
  });

  /** Recebe o ZIP da ATP (um imóvel por vez) e valida o shapefile na hora. */
  app.post("/api/fiscalizacao/upload", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }

      const rawName = safeSegment(String((req.body as any)?.filename || "atp.zip")) || "atp.zip";
      const filename = rawName.toLowerCase().endsWith(".zip") ? rawName : `${rawName}.zip`;
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);

      // Falha aqui devolve 400 com a mensagem do parser (CRS ausente, sem .shp
      // etc.), em vez de deixar o job quebrar depois.
      const parsed = parseUserShapefile(zipBuffer);
      if (!parsed.polygons.length) throw new Error("Shapefile não contém polígonos.");

      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "fiscalizacao/input",
        filename: `${uploadId}_${filename}`,
        buffer: zipBuffer,
      });

      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        polygonCount: parsed.polygons.length,
        areaHa: parsed.areaHa,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });

      res.json({
        ok: true,
        uploadId,
        filename,
        polygonCount: parsed.polygons.length,
        areaHa: parsed.areaHa,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar a ATP." });
    }
  });

  app.post("/api/fiscalizacao/process", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "fiscalizacao_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }

      const bufferMeters = Number((req.body as any)?.bufferMeters);
      const job = startJob({
        uid,
        endpoint: "/api/fiscalizacao/process",
        metadata: { uploadId, filename: upload.filename },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de fiscalização enfileirada.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });

      void runFiscalizacaoJob({
        uid,
        jobId: job.jobId,
        upload,
        bufferMeters: Number.isFinite(bufferMeters) ? bufferMeters : DEFAULT_BUFFER_METERS,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar a análise." });
    }
  });

  app.get("/api/fiscalizacao/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "fiscalizacao_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/fiscalizacao/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "fiscalizacao_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });

    const status = String(data.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) {
      res.end();
      return;
    }
    const set = subscribers.get(jobId) || new Set<Response>();
    set.add(res);
    subscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/fiscalizacao/download/:jobId", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "fiscalizacao_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `fiscalizacao_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar o ZIP." });
    }
  });

  app.delete("/api/fiscalizacao/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "fiscalizacao_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    removeStoragePath(String(data.inputRelativePath || ""));
    persistJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
