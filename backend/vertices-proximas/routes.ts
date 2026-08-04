/**
 * Rotas HTTP /api/vertices/*.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { getAbsoluteStoragePath, readDocBySegments, removeStoragePath, saveUserBuffer } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { CACHE_TTL_MS } from "./constants";
import { runVerticesJob } from "./job";
import { listPolygonLayersFromZip, parseBase64Zip, safeSegment, visibleVerticesLayers } from "./shapefile-io";
import { persistVerticesJob, subscribers, writeSse } from "./sse";
import { LayerSelection, ProcessSettings } from "./types";

export function registerVerticesRoutes(app: Express): void {
  app.post("/api/vertices/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "vertices.zip")) || "vertices.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({ error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile." });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "vertices/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistVerticesJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        layers,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      res.json({
        ok: true,
        uploadId,
        filename,
        layers: visibleLayers,
        warnings: layers
          .filter((layer) => layer.ignoredReason && layer.featureCount > 0)
          .map((layer) => `${layer.name}: ${layer.ignoredReason}`),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ZIP." });
    }
  });

  app.post("/api/vertices/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "vertices_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload de vértices não encontrado." });
        return;
      }
      const selections = Array.isArray((req.body as any)?.layers) ? (req.body as any).layers as LayerSelection[] : [];
      const activeSelections = selections.filter((item) => item?.analyze !== false);
      if (!activeSelections.length) {
        res.status(400).json({ error: "Selecione ao menos uma camada para analisar." });
        return;
      }
      for (const selection of activeSelections) {
        const pointCount = Number(selection.pointCount || 0);
        if (!Number.isFinite(pointCount) || pointCount <= 0) {
          res.status(400).json({ error: "Quantidade de pontos deve ser maior que zero." });
          return;
        }
      }
      const job = startJob({
        uid,
        endpoint: "/api/vertices/process",
        metadata: { uploadId, filename: upload.filename, layers: activeSelections.length },
      });
      persistVerticesJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento de vértices enviado ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runVerticesJob({
        uid,
        jobId: job.jobId,
        upload,
        selections,
        settings: ((req.body as any)?.settings || {}) as ProcessSettings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/vertices/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de vértices não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/vertices/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de vértices não encontrado." });
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

  app.get("/api/vertices/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado de vértices não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `vertices_proximas_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/vertices/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "vertices_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    persistVerticesJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
