/**
 * Rotas HTTP /api/cbers/*.
 */
import type { Express, Request, Response } from "express";
import type { Feature } from "geojson";
import { deleteDocBySegments, readDocBySegments, removeStoragePath } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import type { CbersArchiveRecord } from "../cbers-archive";
import { markCbersArchiveUserDeleted } from "../cbers-archive";
import { attachArchiveAvailability, buildReusedCbersSceneState, findActiveArchiveRecordForItem, persistCompletedCbersReuseJob } from "./archive";
import { assertCbersL4GenerationItem, inferCbersCollection } from "./collections";
import { CBERS_COLLECTIONS } from "./constants";
import { runCbersBatchJob, runCbersJob } from "./job";
import { eventSubscribers, persistCbersJob, writeSse } from "./sse";
import { estimateSceneAssets, getStacItem, normalizeDateParam, sceneFromStacFeature, searchCbersScenes } from "./stac-search";
import { startCbersTmpCleanup } from "./tmp";
import { CbersSceneJobState } from "./types";
import { featureBbox, resolveAreaContextFromRequest } from "./utils";
import { normalizeOrbitPointParam } from "./wms";
import { resolveWmsZipRequest, setWmsZipHeaders, streamWmsZip } from "./zip";

export function registerCbersWpmRoutes(app: Express): void {
  startCbersTmpCleanup();

  app.post("/api/cbers-wpm/search", async (req: Request, res: Response) => {
    try {
      const area = await resolveAreaContextFromRequest(req.body);
      const bbox = area.geometry ? featureBbox({ type: "Feature", properties: {}, geometry: area.geometry }) : null;
      const dateStart = normalizeDateParam((req.body as any)?.dateStart, false);
      const dateEnd = normalizeDateParam((req.body as any)?.dateEnd, true);
      const orbit = normalizeOrbitPointParam((req.body as any)?.orbit, "Órbita");
      const point = normalizeOrbitPointParam((req.body as any)?.point ?? (req.body as any)?.row, "Ponto");
      if (!bbox && (!orbit || !point)) {
        res.status(400).json({ error: "Envie um ZIP/SHP ou informe órbita e ponto para buscar sem SHP." });
        return;
      }
      const scenes = await searchCbersScenes(bbox, {
        dateStart,
        dateEnd,
        propertyGeometry: area.geometry,
        propertyGeometryHash: area.geometryHash,
        orbit,
        point,
      });
      res.json({
        ok: true,
        areaHa: area.areaHa,
        bbox,
        propertyGeometry: area.geometry,
        orbit,
        point,
        collections: CBERS_COLLECTIONS.map(({ level, collectionId }) => ({ level, collectionId })),
        dateStart,
        dateEnd,
        scenes,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao buscar cenas CBERS." });
    }
  });

  app.post("/api/cbers-wpm/estimate", async (req: Request, res: Response) => {
    try {
      const area = await resolveAreaContextFromRequest(req.body);
      const rawIds = Array.isArray((req.body as any)?.itemIds)
        ? (req.body as any).itemIds
        : [(req.body as any)?.itemId];
      const itemIds: string[] = Array.from(
        new Set(rawIds.map((item: any) => String(item || "").trim()).filter(Boolean)),
      );
      if (!itemIds.length) {
        res.status(400).json({ error: "itemIds é obrigatório." });
        return;
      }
      const estimates = await Promise.all(
        itemIds.map(async (itemId) => {
          const { item, collection } = await getStacItem(itemId);
          const rawScene = sceneFromStacFeature(item, area.geometry, collection);
          const scene = rawScene ? attachArchiveAvailability(rawScene, area.geometryHash) : null;
          if (!scene) throw new Error(`Cena ${itemId} sem bandas obrigatórias.`);
          const estimate = await estimateSceneAssets({ itemId, collectionId: collection.collectionId, areaHa: area.areaHa, scene });
          return { itemId, scene, estimate };
        }),
      );
      res.json({ ok: true, areaHa: area.areaHa, propertyGeometry: area.geometry, estimates });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao estimar cenas CBERS." });
    }
  });

  app.head("/api/cbers-wpm/wms-download", async (req: Request, res: Response) => {
    try {
      const itemId = String(req.query.itemId || "").trim();
      const imageId = String(req.query.imageId || "").trim();
      if (!itemId && !imageId) {
        res.status(400).end();
        return;
      }
      const resolved = resolveWmsZipRequest({ itemId, imageId });
      if (!resolved) {
        res.status(404).end();
        return;
      }
      setWmsZipHeaders(res, resolved.filename, resolved.files);
      res.status(200).end();
    } catch {
      res.status(500).end();
    }
  });

  app.get("/api/cbers-wpm/wms-download", async (req: Request, res: Response) => {
    try {
      const itemId = String(req.query.itemId || "").trim();
      const imageId = String(req.query.imageId || "").trim();
      if (!itemId && !imageId) {
        res.status(400).json({ error: "itemId ou imageId é obrigatório." });
        return;
      }
      const resolved = resolveWmsZipRequest({ itemId, imageId });
      if (!resolved) {
        res.status(404).json({ error: "Imagem CBERS não encontrada no WMS." });
        return;
      }
      await streamWmsZip(res, resolved.filename, resolved.files);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Falha ao baixar ZIP da imagem WMS." });
      } else {
        res.destroy(error);
      }
    }
  });

  app.post("/api/cbers-wpm/jobs", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const rawItemIds = Array.isArray((req.body as any)?.itemIds)
        ? (req.body as any).itemIds
        : [(req.body as any)?.itemId];
      const itemIds: string[] = Array.from(
        new Set(rawItemIds.map((item: any) => String(item || "").trim()).filter(Boolean)),
      );
      if (!itemIds.length) {
        res.status(400).json({ error: "itemId ou itemIds é obrigatório." });
        return;
      }
      for (const itemId of itemIds) assertCbersL4GenerationItem(itemId);
      const area = await resolveAreaContextFromRequest(req.body);
      const filename = String((req.body as any)?.filename || "CBERS-4A/WPM").trim();
      const archiveByItemId = new Map<string, CbersArchiveRecord>();
      for (const itemId of itemIds) {
        const archive = findActiveArchiveRecordForItem(itemId);
        if (archive) archiveByItemId.set(itemId, archive);
      }
      const reusedScenes = itemIds
        .map((itemId) => archiveByItemId.get(itemId))
        .filter((record): record is CbersArchiveRecord => Boolean(record))
        .map(buildReusedCbersSceneState);
      const newItemIds = itemIds.filter((itemId) => !archiveByItemId.has(itemId));
      const processingJob = startJob({
        uid,
        endpoint: "/api/cbers-wpm/jobs",
        metadata: {
          itemId: itemIds[0],
          itemIds,
          filename,
          hasPropertyGeometry: Boolean(area.geometry),
          reusedFromWms: reusedScenes.length,
          newScenes: newItemIds.length,
        },
      });
      const jobId = processingJob.jobId;

      if (newItemIds.length === 0) {
        persistCompletedCbersReuseJob({ uid, jobId, filename, area, itemIds, reusedScenes });
        res.status(200).json({ ok: true, jobId, reused: true, reusedCount: reusedScenes.length });
        return;
      }

      persistCbersJob(uid, jobId, {
        status: "processing",
        stage: "queued",
        percent: 1,
        message: reusedScenes.length
          ? `${reusedScenes.length} cena(s) já disponível(is) no WMS; processando ${newItemIds.length} cena(s) nova(s).`
          : "Processamento CBERS enviado para o servidor.",
        filename,
        itemId: itemIds[0],
        itemIds,
        mode: itemIds.length > 1 ? "batch" : "single",
        areaHa: area.areaHa || undefined,
        propertyGeometry: area.geometry,
        scenes: [
          ...reusedScenes,
          ...newItemIds.map((itemId): CbersSceneJobState => {
            const collection = inferCbersCollection(itemId);
            return {
              itemId,
              collectionId: collection.collectionId,
              level: collection.level,
              status: "processing",
              stage: "queued",
              percent: 1,
              message: "Aguardando processamento.",
            };
          }),
        ],
        collections: CBERS_COLLECTIONS.map(({ level, collectionId }) => ({ level, collectionId })),
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId, reused: reusedScenes.length > 0, reusedCount: reusedScenes.length });
      if (itemIds.length > 1 || reusedScenes.length > 0) {
        void runCbersBatchJob({ uid, jobId, filename, area, itemIds: newItemIds, reusedScenes });
      } else {
        void runCbersJob({ uid, jobId, filename, area, itemId: newItemIds[0] });
      }
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar job CBERS." });
    }
  });

  app.get("/api/cbers-wpm/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job CBERS não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/cbers-wpm/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job CBERS não encontrado." });
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

  app.delete("/api/cbers-wpm/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || data.outputUrl || ""));
    removeStoragePath(String(data.batchZipRelativePath || data.batchZipUrl || ""));
    if (Array.isArray(data.scenes)) {
      for (const scene of data.scenes) {
        removeStoragePath(String(scene?.outputRelativePath || scene?.outputUrl || ""));
        removeStoragePath(String(scene?.batchZipRelativePath || scene?.batchZipUrl || ""));
      }
    }
    markCbersArchiveUserDeleted(uid, jobId);
    deleteDocBySegments(["users", uid, "cbers_wpm_jobs", jobId]);
    res.json({ ok: true });
  });
}
