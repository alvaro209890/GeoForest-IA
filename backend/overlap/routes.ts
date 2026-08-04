/**
 * Rotas HTTP /api/overlap/*.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { getAbsoluteStoragePath, readDocBySegments, removeStoragePath, saveUserBuffer } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { parseUserShapefile } from "../simcar";
import { fetchSicarFeaturesByBbox } from "./car-intersection";
import { CACHE_TTL_MS, DEFAULT_BUFFER_METERS, SEMA_CAR_ATP_LAYER, SEMA_CAR_REQ_LAYER, SICAR_WFS_BASE_URL, SICAR_WFS_LAYER } from "./constants";
import { runOverlapJob } from "./pipeline";
import { persistJob, subscribers, writeSse } from "./sse";
import { OverlapMode } from "./types";
import { parseBase64Zip, safeSegment } from "./utils";

export function registerOverlapRoutes(app: Express): void {
  app.get("/api/overlap/sources/health", async (_req: Request, res: Response) => {
    const carFederal: {
      layer: string;
      baseUrl: string;
      ok: boolean;
      error: string;
      sampleFeatures?: number;
    } = {
      layer: SICAR_WFS_LAYER,
      baseUrl: SICAR_WFS_BASE_URL,
      ok: false,
      error: "",
    };
    try {
      const bbox: [number, number, number, number] = [-52.35, -12.75, -52.25, -12.65];
      const feats = await fetchSicarFeaturesByBbox(bbox);
      carFederal.ok = true;
      carFederal.sampleFeatures = feats.length;
    } catch (error: any) {
      carFederal.ok = false;
      carFederal.error = String(error?.message || error);
    }
    res.json({
      sigef: { source: "wfs-incra", ok: true },
      carEstadual: { layers: [SEMA_CAR_ATP_LAYER, SEMA_CAR_REQ_LAYER] },
      carFederal,
    });
  });

  app.post("/api/overlap/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }

      const parcelCodesRaw = (req.body as any)?.parcelCodes;
      const parcelCodes = Array.isArray(parcelCodesRaw)
        ? parcelCodesRaw.map((c: unknown) => String(c || "").trim()).filter(Boolean)
        : String((req.body as any)?.parcelCodesText || "")
            .split(/[\s,;]+/)
            .map((c) => c.trim())
            .filter(Boolean);

      const uploadId = crypto.randomUUID();
      let filename = "sigef_codigos.txt";
      let inputRelativePath = "";
      let inputUrl = "";
      let polygonCount = 0;

      if (parcelCodes.length) {
        polygonCount = parcelCodes.length;
        filename = `sigef_codigos_${parcelCodes.length}.txt`;
        const stored = saveUserBuffer({
          uid,
          area: "overlap/input",
          filename: `${uploadId}_${filename}`,
          buffer: Buffer.from(parcelCodes.join("\n"), "utf8"),
        });
        inputRelativePath = stored.relativePath;
        inputUrl = stored.publicUrl;
      } else {
        filename = safeSegment(String((req.body as any)?.filename || "sigef.zip")) || "sigef.zip";
        const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
        const parsed = parseUserShapefile(zipBuffer);
        polygonCount = parsed.polygons.length;
        const stored = saveUserBuffer({
          uid,
          area: "overlap/input",
          filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
          buffer: zipBuffer,
        });
        inputRelativePath = stored.relativePath;
        inputUrl = stored.publicUrl;
      }

      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath,
        inputUrl,
        parcelCodes: parcelCodes.length ? parcelCodes : undefined,
        polygonCount,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });

      res.json({
        ok: true,
        uploadId,
        filename,
        polygonCount,
        parcelCodes: parcelCodes.length ? parcelCodes : undefined,
        modes: [
          { id: "sigef-car-estadual", label: "SIGEF × CAR estadual" },
          { id: "sigef-car-federal", label: "SIGEF × CAR federal" },
          { id: "car-estadual-car-estadual", label: "CAR estadual × CAR estadual" },
        ],
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar dados." });
    }
  });

  app.post("/api/overlap/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      const modesRaw = Array.isArray((req.body as any)?.modes) ? (req.body as any).modes : [];
      const modes = modesRaw
        .map((m: unknown) => String(m))
        .filter((m: string): m is OverlapMode =>
          ["sigef-car-estadual", "sigef-car-federal", "car-estadual-car-estadual"].includes(m),
        );
      const bufferMeters = Number((req.body as any)?.bufferMeters);
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      if (!modes.length) {
        res.status(400).json({ error: "Selecione ao menos um modo de análise." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "overlap_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/overlap/process",
        metadata: { uploadId, filename: upload.filename, modes },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        modes,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de sobreposição enfileirada.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runOverlapJob({
        uid,
        jobId: job.jobId,
        upload,
        modes,
        bufferMeters: Number.isFinite(bufferMeters) ? bufferMeters : DEFAULT_BUFFER_METERS,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar análise." });
    }
  });

  app.get("/api/overlap/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/overlap/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
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

  app.get("/api/overlap/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `sobreposicoes_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/overlap/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
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
