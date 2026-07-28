/**
 * Croqui de acesso — ATP → PDF + DOCX + KML
 *
 * Endpoints:
 *   POST /api/croqui/upload
 *   POST /api/croqui/process
 *   GET  /api/croqui/jobs/:id/status
 *   GET  /api/croqui/jobs/:id/events
 *   GET  /api/croqui/download/:id
 *   DELETE /api/croqui/jobs/:id
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { centroid } from "@turf/turf";
import type { Polygon, MultiPolygon } from "geojson";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import { parseUserShapefile } from "./simcar-clip";
import { detectarMunicipioMtComFallback } from "./simcar-oraculo/municipio-mt";
import { formatDmsPair } from "./croqui/coords";
import { resolveLandmark } from "./croqui/landmarks";
import { buildCroquiNarrative } from "./croqui/narrative";
import { destinationOnPolygonBoundary, fetchDrivingRoute } from "./croqui/routing";
import { buildCroquiDocxBuffer } from "./croqui/render-docx";
import { buildCroquiKml } from "./croqui/render-kml";
import { buildCroquiPdfBuffer } from "./croqui/render-pdf";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const subscribers = new Map<string, Set<Response>>();

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // ignore
  }
}

function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) writeSse(r, data);
}

function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) {
    if (!r.writableEnded) r.end();
  }
  subscribers.delete(jobId);
}

function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "croqui_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function buildOutputZip(files: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c) => chunks.push(c));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const f of files) archive.append(f.buffer, { name: f.name });
    void archive.finalize();
  });
}

export async function generateCroquiArtifacts(args: {
  atpGeometry: Polygon | MultiPolygon;
  title: string;
  propertyName: string;
}): Promise<{
  narrative: string;
  municipioNome: string;
  files: Array<{ name: string; buffer: Buffer }>;
}> {
  const { atpGeometry, title, propertyName } = args;
  const c = centroid({ type: "Feature", properties: {}, geometry: atpGeometry });
  const [centLon, centLat] = c.geometry.coordinates;

  const municipio = (await detectarMunicipioMtComFallback([centLon, centLat])) || {
    nome: null,
    ibge: null,
    fonte: "nao-detectado" as const,
  };
  const municipioNome = municipio.nome || "Mato Grosso";
  const landmark = resolveLandmark(municipio.nome, municipio.ibge, null);
  const dest = destinationOnPolygonBoundary(atpGeometry, landmark.lon, landmark.lat);
  const route = await fetchDrivingRoute(landmark.lon, landmark.lat, dest.lon, dest.lat);
  const startDms = formatDmsPair(landmark.lon, landmark.lat);
  const narrative = buildCroquiNarrative({
    municipioNome,
    propertyName,
    landmark,
    route,
    startDms,
  });
  const coordinateLines = route.waypoints.map((w) => w.dms.replace(/^\(|\)$/g, ""));

  const kml = buildCroquiKml({ title, propertyName, atpGeometry, route });
  const docx = await buildCroquiDocxBuffer(narrative);
  const pdf = await buildCroquiPdfBuffer({
    title,
    narrative,
    coordinateLines,
    atpGeometry,
    route,
  });

  return {
    narrative,
    municipioNome,
    files: [
      { name: "croqui.pdf", buffer: pdf },
      { name: "croqui.docx", buffer: docx },
      { name: "croqui.kml", buffer: Buffer.from(kml, "utf8") },
    ],
  };
}

async function runCroquiJob(args: {
  uid: string;
  jobId: string;
  upload: Record<string, unknown>;
  title: string;
  propertyName: string;
}): Promise<void> {
  const { uid, jobId, upload, title, propertyName } = args;
  try {
    if (isCancelRequested(jobId)) {
      progress(uid, jobId, { status: "cancelled", percent: 100, message: "Cancelado." });
      finishJob(jobId, "cancelled");
      return;
    }

    progress(uid, jobId, { status: "processing", stage: "parse", percent: 10, message: "Lendo shapefile ATP..." });
    const inputPath = String(upload.inputRelativePath || "");
    const inputZipBuffer = fs.readFileSync(getAbsoluteStoragePath(inputPath));
    const parsed = parseUserShapefile(inputZipBuffer);
    if (parsed.polygons.length !== 1) {
      throw new Error("O ZIP deve conter exatamente um polígono ATP.");
    }

    progress(uid, jobId, { stage: "route", percent: 35, message: "Calculando rota de acesso..." });
    const result = await generateCroquiArtifacts({
      atpGeometry: parsed.geometry,
      title,
      propertyName,
    });

    if (isCancelRequested(jobId)) {
      progress(uid, jobId, { status: "cancelled", percent: 100, message: "Cancelado." });
      finishJob(jobId, "cancelled");
      return;
    }

    progress(uid, jobId, { stage: "export", percent: 75, message: "Gerando PDF, Word e KML..." });
    const zipBuffer = await buildOutputZip([
      { name: "croqui.pdf", buffer: result.files.find((f) => f.name === "croqui.pdf")!.buffer },
      { name: "croqui.docx", buffer: result.files.find((f) => f.name === "croqui.docx")!.buffer },
      { name: "croqui.kml", buffer: result.files.find((f) => f.name === "croqui.kml")!.buffer },
    ]);

    const stored = saveUserBuffer({
      uid,
      area: "croqui/output",
      filename: `${jobId}_croqui.zip`,
      buffer: zipBuffer,
    });

    const downloadUrl = stored.publicUrl;
    progress(uid, jobId, {
      status: "completed",
      stage: "done",
      percent: 100,
      message: `Croqui gerado (${result.municipioNome}).`,
      municipioNome: result.municipioNome,
      title,
      propertyName,
      files: ["croqui.pdf", "croqui.docx", "croqui.kml"],
      outputRelativePath: stored.relativePath,
      outputUrl: downloadUrl,
      downloadUrl,
      outputBytes: zipBuffer.length,
      completedAt: new Date().toISOString(),
    });
    finishJob(jobId, "completed");
  } catch (error: any) {
    const message = String(error?.message || error || "Falha ao gerar croqui.");
    progress(uid, jobId, {
      status: "failed",
      percent: 100,
      error: message,
      message,
      completedAt: new Date().toISOString(),
    });
    finishJob(jobId, "failed", message);
  } finally {
    closeSubscribers(jobId);
  }
}

export function registerCroquiRoutes(app: Express): void {
  app.post("/api/croqui/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "atp.zip")) || "atp.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const parsed = parseUserShapefile(zipBuffer);
      if (!parsed.polygons.length) throw new Error("Shapefile ATP inválido.");
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "croqui/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        polygonCount: parsed.polygons.length,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      res.json({
        ok: true,
        uploadId,
        filename,
        polygonCount: parsed.polygons.length,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ATP." });
    }
  });

  app.post("/api/croqui/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      const title = String((req.body as any)?.title || "").trim();
      const propertyName = String((req.body as any)?.propertyName || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      if (!title) {
        res.status(400).json({ error: "Informe o título do croqui." });
        return;
      }
      if (!propertyName) {
        res.status(400).json({ error: "Informe o nome da propriedade." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "croqui_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/croqui/process",
        metadata: { uploadId, title, propertyName, filename: upload.filename },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        title,
        propertyName,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Croqui enfileirado.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runCroquiJob({ uid, jobId: job.jobId, upload, title, propertyName });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar croqui." });
    }
  });

  app.get("/api/croqui/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "croqui_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/croqui/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "croqui_jobs", jobId]);
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

  app.get("/api/croqui/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "croqui_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      const stem = safeSegment(String(data.title || data.propertyName || "croqui")) || "croqui";
      res.download(absolute, `${stem}_croqui.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/croqui/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "croqui_jobs", jobId]);
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
