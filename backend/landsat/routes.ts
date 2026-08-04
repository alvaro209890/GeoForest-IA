/**
 * Rotas HTTP /api/landsat/*.
 */
import type { Express, Request, Response } from "express";
import type { Feature } from "geojson";
import { deleteDocBySegments, readDocBySegments, removeStoragePath } from "../local-storage";
import { finishJob, requestCancel, startJob } from "../processing-jobs";
import { buildReuseState, parseComposition, processLandsatJob } from "./job";
import { findLocalRecordByLayerName, localRecordToScene } from "./local-archive";
import { eventSubscribers, persistLandsatJob, writeSse } from "./sse";
import { estimateScene, getStacItem, sceneFromStacFeature, searchExternalLandsatScenes, searchLocalLandsatScenes } from "./stac-search";
import { LandsatScene } from "./types";
import { featureBbox, normalizeDateParam, normalizeOrbitPointParam, resolveAreaContextFromRequest } from "./utils";
import { collectLandsatFiles, setZipHeaders, streamZip, zipFilenameForRecord } from "./zip";

export function registerLandsatRoutes(app: Express): void {
  app.post("/api/landsat/search", async (req: Request, res: Response) => {
    try {
      const area = await resolveAreaContextFromRequest(req.body);
      const bbox = area.geometry ? featureBbox({ type: "Feature", properties: {}, geometry: area.geometry }) : null;
      const orbit = normalizeOrbitPointParam((req.body as any)?.orbit, "Órbita");
      const row = normalizeOrbitPointParam((req.body as any)?.row ?? (req.body as any)?.point, "Ponto");
      const dateStart = normalizeDateParam((req.body as any)?.dateStart, false);
      const dateEnd = normalizeDateParam((req.body as any)?.dateEnd, true);
      const maxCloud = Number.isFinite(Number((req.body as any)?.maxCloudCover))
        ? Math.max(0, Math.min(100, Number((req.body as any).maxCloudCover)))
        : null;
      const composition = parseComposition((req.body as any)?.composition);
      if (!bbox && (!orbit || !row)) {
        res.status(400).json({ error: "Envie ZIP/SHP, Nº do CAR ou informe órbita e ponto." });
        return;
      }
      const localScenes = searchLocalLandsatScenes({
        propertyGeometry: area.geometry,
        dateStart,
        dateEnd,
        orbit,
        row,
        composition,
      });
      const externalComposition = composition === "any" ? "false_color" : composition;
      const externalScenes = await searchExternalLandsatScenes({
        bbox,
        propertyGeometry: area.geometry,
        dateStart,
        dateEnd,
        orbit,
        row,
        maxCloud,
        composition: externalComposition,
      }).catch((error) => {
        console.warn("[LANDSAT] busca STAC externa falhou:", error);
        return [] as LandsatScene[];
      });
      const byId = new Map<string, LandsatScene>();
      for (const scene of [...localScenes, ...externalScenes]) {
        if (maxCloud !== null && scene.cloudCover !== null && scene.cloudCover > maxCloud) continue;
        byId.set(scene.id, scene);
      }
      const scenes = [...byId.values()].sort((a, b) => String(b.datetime || "").localeCompare(String(a.datetime || "")));
      res.json({
        ok: true,
        areaHa: area.areaHa,
        bbox,
        propertyGeometry: area.geometry,
        orbit,
        row,
        dateStart,
        dateEnd,
        composition,
        localCount: localScenes.length,
        externalCount: externalScenes.length,
        scenes,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao buscar Landsat." });
    }
  });

  app.post("/api/landsat/estimate", async (req: Request, res: Response) => {
    try {
      const sceneId = String((req.body as any)?.sceneId || "").trim();
      if (!sceneId) {
        res.status(400).json({ error: "sceneId é obrigatório." });
        return;
      }
      const composition = parseComposition((req.body as any)?.composition);
      if (composition === "any") throw new Error("Escolha composição falsa-cor ou natural para estimar.");
      const local = findLocalRecordByLayerName(sceneId);
      const scene = local
        ? localRecordToScene(local)
        : sceneFromStacFeature(await getStacItem(sceneId), composition);
      if (!scene) throw new Error("Cena Landsat não encontrada.");
      res.json({ ok: true, scene: await estimateScene(scene) });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao estimar Landsat." });
    }
  });

  app.head("/api/landsat/wms-download", async (req: Request, res: Response) => {
    try {
      const record = findLocalRecordByLayerName(String(req.query.layerName || req.query.sceneId || ""));
      if (!record) {
        res.status(404).end();
        return;
      }
      const files = collectLandsatFiles(record);
      if (!files.length) {
        res.status(404).end();
        return;
      }
      setZipHeaders(res, zipFilenameForRecord(record), files);
      res.status(200).end();
    } catch {
      res.status(500).end();
    }
  });

  app.get("/api/landsat/wms-download", async (req: Request, res: Response) => {
    try {
      const record = findLocalRecordByLayerName(String(req.query.layerName || req.query.sceneId || ""));
      if (!record) {
        res.status(404).json({ error: "Imagem Landsat não encontrada no WMS." });
        return;
      }
      const files = collectLandsatFiles(record);
      if (!files.length) {
        res.status(404).json({ error: "Arquivos Landsat não encontrados no HD." });
        return;
      }
      await streamZip(res, zipFilenameForRecord(record), files);
    } catch (error: any) {
      if (!res.headersSent) res.status(500).json({ error: error?.message || "Falha ao baixar ZIP Landsat." });
      else res.destroy(error);
    }
  });

  app.post("/api/landsat/jobs", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const sceneId = String((req.body as any)?.sceneId || (req.body as any)?.itemId || "").trim();
      if (!sceneId) {
        res.status(400).json({ error: "sceneId é obrigatório." });
        return;
      }
      const composition = parseComposition((req.body as any)?.composition);
      if (composition === "any") throw new Error("Escolha composição falsa-cor ou natural para gerar.");
      const filename = String((req.body as any)?.filename || "LANDSAT").trim();
      const processingJob = startJob({
        uid,
        endpoint: "/api/landsat/jobs",
        metadata: { sceneId, filename, composition },
      });
      const jobId = processingJob.jobId;
      const local = findLocalRecordByLayerName(sceneId);
      if (local) {
        const state = buildReuseState(local);
        persistLandsatJob(uid, jobId, {
          ...state,
          filename,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        finishJob({ jobId, status: "completed" });
        res.status(200).json({ ok: true, jobId, reused: true });
        return;
      }
      persistLandsatJob(uid, jobId, {
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento Landsat enviado para o servidor.",
        filename,
        sceneId,
        composition,
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId, reused: false });
      void processLandsatJob({ uid, jobId, sceneId, filename, composition });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar job Landsat." });
    }
  });

  app.get("/api/landsat/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job Landsat não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/landsat/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job Landsat não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });
    const status = String(data.status || "").toLowerCase();
    if (status === "completed" || status === "failed" || status === "cancelled") {
      res.end();
      return;
    }
    const set = eventSubscribers.get(jobId) || new Set<Response>();
    set.add(res);
    eventSubscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) eventSubscribers.delete(jobId);
    });
  });

  app.delete("/api/landsat/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    requestCancel(jobId, uid);
    const data = readDocBySegments(["users", uid, "landsat_jobs", jobId]);
    removeStoragePath(String(data?.outputRelativePath || data?.outputUrl || ""));
    deleteDocBySegments(["users", uid, "landsat_jobs", jobId]);
    res.json({ ok: true });
  });
}
