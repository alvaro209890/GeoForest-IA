/**
 * Rotas HTTP /api/processar-projeto/*.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import type { GeometryErrorRow } from "../geometry-errors";
import { getAbsoluteStoragePath, readDocBySegments, removeStoragePath, saveUserBuffer } from "../local-storage";
import { requestCancel } from "../processing-jobs";
import { getSimcarOraculoConfig } from "../simcar-oraculo/config";
import { extractShapeContext } from "../simcar-oraculo/shape-context";
import { detectarMunicipioWfsSema } from "../simcar-oraculo/municipio-mt";
import { listPolygonLayersFromZip, visibleVerticesLayers } from "../vertices-proximas";
import { buildImportReportPdf } from "../import-report-pdf";
import { CACHE_TTL_MS } from "./constants";
import { closeSubscribers, persistJob, sendLocalProcessingGone, subscribers, writeSse } from "./sse";
import { parseBase64Zip, safeSegment } from "./utils";

export function registerProcessarProjetoRoutes(app: Express): void {
  app.post("/api/processar-projeto/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "projeto.zip")) || "projeto.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({
          error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile.",
        });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "processar-projeto/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        layers,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      const oraculoCfg = getSimcarOraculoConfig();
      let shapePreview: ReturnType<typeof extractShapeContext> | null = null;
      try {
        shapePreview = extractShapeContext(zipBuffer);
        if (shapePreview.municipioDetectado.fonte === "nao-detectado") {
          try {
            const fallback = await detectarMunicipioWfsSema(shapePreview.centroid);
            if (fallback) shapePreview.municipioDetectado = fallback;
          } catch (error: any) {
            shapePreview.warnings.push(
              `Fallback municipal WFS indisponível: ${error?.message || "falha de rede"}`,
            );
          }
        }
      } catch {
        shapePreview = null;
      }
      res.json({
        ok: true,
        uploadId,
        filename,
        layers: visibleLayers,
        testCarId: oraculoCfg.testCarId,
        simcarConfigured: oraculoCfg.credentialsConfigured,
        deepseekConfigured: oraculoCfg.deepseekConfigured,
        shapePreview,
        warnings: layers
          .filter((layer) => layer.ignoredReason && layer.featureCount > 0)
          .map((layer) => `${layer.name}: ${layer.ignoredReason}`),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ZIP." });
    }
  });

  app.post("/api/processar-projeto/importar", sendLocalProcessingGone);

  // Download legado: não integra o fluxo da aba nova nem produz o veredito exibido ao usuário.
  app.get("/api/processar-projeto/import/:importId/pdf", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const importId = String(req.params.importId || "").trim();
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", importId]);
      if (!data || data.type !== "import") {
        res.status(404).json({ error: "Importação não encontrada." });
        return;
      }

      let pdfPath = String(data.pdfRelativePath || "").trim();
      if (!pdfPath || !fs.existsSync(getAbsoluteStoragePath(pdfPath))) {
        // regenera sob demanda
        const pdfBuffer = await buildImportReportPdf({
          filename: String(data.filename || "projeto.zip"),
          ok: Boolean(data.ok),
          rows: Array.isArray(data.rows) ? (data.rows as GeometryErrorRow[]) : [],
          camadas: Array.isArray(data.camadasReconhecidas) ? data.camadasReconhecidas : [],
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          reportId: importId.slice(0, 8),
        });
        const stored = saveUserBuffer({
          uid,
          area: "processar-projeto/import-pdf",
          filename: `relatorio_importacao_${importId.slice(0, 8)}.pdf`,
          buffer: pdfBuffer,
        });
        pdfPath = stored.relativePath;
        persistJob(uid, importId, {
          pdfRelativePath: pdfPath,
          pdfUrl: `/api/processar-projeto/import/${importId}/pdf`,
        });
      }

      const abs = getAbsoluteStoragePath(pdfPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="relatorio_importacao_geoforest_${importId.slice(0, 8)}.pdf"`,
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      fs.createReadStream(abs).pipe(res);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao baixar PDF de importação." });
    }
  });

  app.post("/api/processar-projeto/processar", sendLocalProcessingGone);

  app.get("/api/processar-projeto/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/processar-projeto/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let set = subscribers.get(jobId);
    if (!set) {
      set = new Set();
      subscribers.set(jobId, set);
    }
    set.add(res);
    writeSse(res, { type: "snapshot", jobId, job: data });

    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId, t: Date.now() }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set?.delete(res);
      if (set && set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/processar-projeto/download/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (!data?.outputRelativePath) {
        res.status(404).json({ error: "Resultado não disponível." });
        return;
      }
      const abs = getAbsoluteStoragePath(String(data.outputRelativePath));
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: "Arquivo de resultado não encontrado." });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="processar_projeto_${jobId.slice(0, 8)}.zip"`,
      );
      fs.createReadStream(abs).pipe(res);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha no download." });
    }
  });

  app.delete("/api/processar-projeto/jobs/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      requestCancel(jobId, uid);
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (data?.inputRelativePath) removeStoragePath(String(data.inputRelativePath));
      if (data?.outputRelativePath) removeStoragePath(String(data.outputRelativePath));
      persistJob(uid, jobId, { status: "deleted", message: "Removido." });
      closeSubscribers(jobId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao remover job." });
    }
  });
}
