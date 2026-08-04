/**
 * Rotas HTTP /api/geometry-errors/*.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { listPolygonLayersFromZip, visibleVerticesLayers } from "../vertices-proximas";
import { getAbsoluteStoragePath, readDocBySegments, removeStoragePath, saveUserBuffer } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { CACHE_TTL_MS } from "./constants";
import { runGeometryJob } from "./job";
import { persistGeometryJob, subscribers, writeSse } from "./sse";
import { GeometryChecks, GeometrySettings } from "./types";
import { parseBase64Zip, safeSegment } from "./utils";

export function registerGeometryErrorsRoutes(app: Express): void {
  app.post("/api/geometry-errors/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "geometria.zip")) || "geometria.zip";
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
        area: "geometry-errors/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistGeometryJob(uid, uploadId, {
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

  app.post("/api/geometry-errors/process", async (req: Request, res: Response) => {
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
      const upload = readDocBySegments(["users", uid, "geometry_errors_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload de geometria não encontrado." });
        return;
      }
      const layerIds = Array.isArray((req.body as any)?.layerIds)
        ? ((req.body as any).layerIds as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
      if (!layerIds.length) {
        res.status(400).json({ error: "Selecione ao menos uma camada para analisar." });
        return;
      }
      const checks = ((req.body as any)?.checks || {}) as GeometryChecks;
      const hasAnyCheck =
        checks.selfIntersection !== false ||
        checks.duplicateVertices !== false ||
        checks.overlaps !== false ||
        checks.gaps !== false ||
        checks.simcarConformity !== false ||
        checks.simcarContainment !== false ||
        checks.simcarCrossOverlaps !== false ||
        checks.airAtpArea !== false;
      if (!hasAnyCheck) {
        res.status(400).json({ error: "Selecione ao menos um tipo de erro para verificar." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/geometry-errors/process",
        metadata: { uploadId, filename: upload.filename, layers: layerIds.length },
      });
      persistGeometryJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de geometria enviada ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runGeometryJob({
        uid,
        jobId: job.jobId,
        upload,
        layerIds,
        checks,
        settings: ((req.body as any)?.settings || {}) as GeometrySettings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/geometry-errors/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de geometria não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/geometry-errors/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de geometria não encontrado." });
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

  app.get("/api/geometry-errors/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado de geometria não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `erros_geometria_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/geometry-errors/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "geometry_errors_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    persistGeometryJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
