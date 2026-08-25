/**
 * Rotas HTTP /api/ndvi/* da cena completa (padrão da aba CBERS).
 *
 *   POST   /api/ndvi/search            — busca de cenas no STAC do Planetary Computer
 *   POST   /api/ndvi/jobs              — inicia job (cena única ou lote) e roda em background
 *   GET    /api/ndvi/jobs/:jobId/status
 *   GET    /api/ndvi/jobs/:jobId/events — SSE (snapshot + heartbeat 15s)
 *   DELETE /api/ndvi/jobs/:jobId        — cancela + remove storage
 *   GET    /api/ndvi/archive            — índice do acervo filtrado por uid
 *
 * Observação: o registro em `backend/routes/_registry.ts` é feito por quem integra
 * o módulo (fora do escopo desta entrega) — ver `registerNdviSceneRoutes`.
 */
import type { Express, Request, Response } from "express";
import { deleteDocBySegments, readDocBySegments, removeStoragePath } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { resolveAreaContextFromRequest, featureBbox } from "../cbers/utils";
import { seasonWindow, searchCandidates, toSceneRef } from "./scene-select";
import { NDVI_SCENE_DEFAULT_COMPOSITIONS, compositionMeta } from "./constants";
import type { NdviSceneComposition } from "./constants";
import { listNdviSceneArchiveRecords, markNdviSceneArchiveUserDeleted } from "./archive";
import { runNdviSceneJob, persistNdviSceneJob } from "./job";
import type { NdviSceneJobScene } from "./types";
import { writeSse } from "../cbers/sse";

const eventSubscribers = new Map<string, Set<Response>>();

function uidDe(req: Request): string | null {
  const uid = (req as any).authUid;
  return typeof uid === "string" && uid ? uid : null;
}

function parseCompositions(raw: unknown): NdviSceneComposition[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...NDVI_SCENE_DEFAULT_COMPOSITIONS];
  const out: NdviSceneComposition[] = [];
  for (const value of raw) {
    const id = String(value || "").trim().toUpperCase();
    if (compositionMeta(id)) out.push(id as NdviSceneComposition);
  }
  return out.length ? out : [...NDVI_SCENE_DEFAULT_COMPOSITIONS];
}

/** Emite evento para os assinantes SSE de um job. */
function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const subscribers = eventSubscribers.get(jobId);
  if (!subscribers) return;
  for (const res of subscribers) writeSse(res, data);
}

export function registerNdviSceneRoutes(app: Express): void {
  /** Busca cenas Landsat C2 L2 no Planetary Computer para a área do usuário. */
  app.post("/api/ndvi/search", async (req: Request, res: Response) => {
    try {
      const area = await resolveAreaContextFromRequest(req.body);
      const bbox = area.geometry
        ? featureBbox({ type: "Feature", properties: {}, geometry: area.geometry })
        : null;
      if (!bbox) {
        res.status(400).json({ error: "Envie ZIP/SHP ou Nº do CAR para buscar cenas." });
        return;
      }

      const agora = new Date();
      const anoBase = agora.getUTCMonth() >= 9 ? agora.getUTCFullYear() : agora.getUTCFullYear() - 1;
      const janela = seasonWindow(anoBase);
      const dateStart = String((req.body as any)?.dateStart || janela.start);
      const dateEnd = String((req.body as any)?.dateEnd || janela.end);
      const orbit = String((req.body as any)?.orbit || "").trim();
      const point = String((req.body as any)?.point || "").trim();

      const candidatos = await searchCandidates({ geometry: area.geometry!, year: anoBase });
      const scenes = candidatos
        .filter((c) => {
          const data = c.acquiredAt.slice(0, 10);
          if (dateStart && data < dateStart) return false;
          if (dateEnd && data > dateEnd) return false;
          if (orbit && c.path !== orbit) return false;
          if (point && c.row !== point) return false;
          return true;
        })
        .map((c) => ({
          ...toSceneRef(c),
          score: c.score,
          cloudCoverPct: c.cloudCoverPct,
        }));

      res.json({
        ok: true,
        areaHa: area.areaHa,
        bbox,
        propertyGeometry: area.geometry,
        dateStart,
        dateEnd,
        orbit: orbit || undefined,
        point: point || undefined,
        collections: ["landsat-c2-l2"],
        compositions: NDVI_SCENE_DEFAULT_COMPOSITIONS,
        scenes,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao buscar cenas Landsat." });
    }
  });

  /** Inicia o job (cena única ou lote) e roda em background. */
  app.post("/api/ndvi/jobs", async (req: Request, res: Response) => {
    try {
      const uid = uidDe(req);
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
      const area = await resolveAreaContextFromRequest(req.body);
      const filename = String((req.body as any)?.filename || "NDVI").trim();
      const compositions = parseCompositions((req.body as any)?.compositions);

      const processingJob = startJob({
        uid,
        endpoint: "/api/ndvi/jobs",
        metadata: {
          itemId: itemIds[0],
          itemIds,
          filename,
          compositions,
          hasPropertyGeometry: Boolean(area.geometry),
          mode: itemIds.length > 1 ? "batch" : "single",
        },
      });
      const jobId = processingJob.jobId;

      persistNdviSceneJob(uid, jobId, {
        status: "processing",
        mode: itemIds.length > 1 ? "batch" : "single",
        stage: "queued",
        percent: 1,
        message: "Processamento NDVI enviado para o servidor.",
        filename,
        itemId: itemIds[0],
        itemIds,
        compositions,
        areaHa: area.areaHa || undefined,
        propertyGeometry: area.geometry,
        scenes: itemIds.map((itemId): NdviSceneJobScene => ({
          itemId,
          status: "processing",
          stage: "queued",
          percent: 1,
          message: "Aguardando processamento.",
        })),
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId, mode: itemIds.length > 1 ? "batch" : "single" });
      void runNdviSceneJob({ uid, jobId, filename, area, itemIds, compositions }, emitJobEvent);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar job NDVI." });
    }
  });

  /** Estado persistido do job. */
  app.get("/api/ndvi/jobs/:jobId/status", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "ndvi_scene_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job NDVI não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  /** SSE de progresso — snapshot + heartbeat 15s. */
  app.get("/api/ndvi/jobs/:jobId/events", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "ndvi_scene_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job NDVI não encontrado." });
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

  /** Cancela + remove storage do job. */
  app.delete("/api/ndvi/jobs/:jobId", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "ndvi_scene_jobs", jobId]);
    if (data) {
      requestCancel(jobId, uid);
      removeStoragePath(String(data.outputRelativePath || data.outputUrl || ""));
      if (Array.isArray(data.scenes)) {
        for (const scene of data.scenes) {
          removeStoragePath(String(scene?.outputRelativePath || scene?.outputUrl || ""));
        }
      }
      markNdviSceneArchiveUserDeleted(uid, jobId);
      deleteDocBySegments(["users", uid, "ndvi_scene_jobs", jobId]);
    } else {
      requestCancel(jobId, uid);
    }
    res.json({ ok: true });
  });

  /** Índice do acervo da cena completa, filtrado por uid. */
  app.get("/api/ndvi/archive", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const { path: p, row, year, composition } = req.query as Record<string, string | undefined>;
    const records = listNdviSceneArchiveRecords().filter((r) => {
      if (r.uid !== uid) return false;
      if (p && r.path !== p) return false;
      if (row && r.row !== row) return false;
      if (year && r.year !== String(year)) return false;
      if (composition && r.composition !== composition) return false;
      return true;
    });
    res.json({ ok: true, total: records.length, records });
  });
}
