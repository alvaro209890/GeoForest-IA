/**
 * Croqui de acesso — ATP → PDF + DOCX + KML
 *
 * Endpoints:
 *   POST /api/croqui/upload
 *   POST /api/croqui/route-options
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
import type { Polygon, MultiPolygon, Position } from "geojson";
import {
  getAbsoluteStoragePath,
  listCollectionBySegments,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import { parseUserShapefile } from "./simcar";
import { detectarMunicipioMtComFallback, getMunicipioFeatureByIbge } from "./simcar-oraculo/municipio-mt";
import { safeFileStem } from "./croqui/coords";
import { resolveLandmark } from "./croqui/landmarks";
import { buildCroquiNarrative } from "./croqui/narrative";
import {
  destinationOnPolygonBoundary,
  fetchDrivingRoute,
  trimRouteAtPolygon,
  type CroquiRoute,
} from "./croqui/routing";
import {
  decimateCoordinates,
  discoverRouteOptions,
  type RouteOption,
  type RouteOptionSummary,
} from "./croqui/route-options";
import { bboxOfPositions, fetchBasemapImage, resolveMapFrame } from "./croqui/basemap";
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

type CroquiContext = {
  municipioNome: string;
  landmark: ReturnType<typeof resolveLandmark>;
  centLon: number;
  centLat: number;
};

/** Município, ponto de partida e centroide — o que toda rota do croqui precisa. */
async function resolveCroquiContext(atpGeometry: Polygon | MultiPolygon): Promise<CroquiContext> {
  const c = centroid({ type: "Feature", properties: {}, geometry: atpGeometry });
  const [centLon, centLat] = c.geometry.coordinates;
  const municipio = (await detectarMunicipioMtComFallback([centLon, centLat])) || {
    nome: null,
    ibge: null,
    fonte: "nao-detectado" as const,
  };
  return {
    municipioNome: municipio.nome || "Mato Grosso",
    landmark: resolveLandmark(
      municipio.nome,
      municipio.ibge,
      getMunicipioFeatureByIbge(municipio.ibge),
    ),
    centLon,
    centLat,
  };
}

/**
 * Caminhos de acesso possíveis, para o usuário escolher antes de gerar. O mais
 * curto vem marcado como recomendado, mas nem sempre é o que se usa em campo.
 */
export async function buildCroquiRouteOptions(args: {
  atpGeometry: Polygon | MultiPolygon;
  onProgress?: (message: string) => void;
}): Promise<{ municipioNome: string; options: RouteOption[] }> {
  const context = await resolveCroquiContext(args.atpGeometry);
  const options = await discoverRouteOptions({
    startLon: context.landmark.lon,
    startLat: context.landmark.lat,
    destLon: context.centLon,
    destLat: context.centLat,
    atpGeometry: args.atpGeometry,
    onProgress: args.onProgress,
  });
  return { municipioNome: context.municipioNome, options };
}

/** Anéis externos do imóvel, leves, para o mapinha de escolha. */
export function outlineRings(geometry: Polygon | MultiPolygon): number[][][] {
  const rings =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((poly) => poly[0]);
  return rings.map((ring) => decimateCoordinates(ring, 120) as number[][]);
}

/** Só o que o front precisa para desenhar o mapinha e listar as opções. */
export function toRouteOptionPayload(
  option: RouteOption,
): RouteOptionSummary & { coordinates: number[][] } {
  return {
    id: option.id,
    label: option.label,
    side: option.side,
    totalDistanceM: option.totalDistanceM,
    roads: option.roads,
    recommended: option.recommended,
    coordinates: decimateCoordinates(option.route.coordinates) as number[][],
  };
}

/**
 * Roteia até o centroide e corta na divisa: o ponto de corte é o acesso real.
 * Quando a rota não chega a entrar no imóvel, cai para o ponto de divisa mais
 * próximo.
 */
async function routeToBoundary(
  atpGeometry: Polygon | MultiPolygon,
  landmark: CroquiContext["landmark"],
  centLon: number,
  centLat: number,
): Promise<CroquiRoute> {
  const toCentroid = await fetchDrivingRoute(landmark.lon, landmark.lat, centLon, centLat);
  const cut = trimRouteAtPolygon(toCentroid, atpGeometry);
  if (cut.trimmed) return cut.route;
  const dest = destinationOnPolygonBoundary(atpGeometry, landmark.lon, landmark.lat);
  return fetchDrivingRoute(landmark.lon, landmark.lat, dest.lon, dest.lat);
}

export async function generateCroquiArtifacts(args: {
  atpGeometry: Polygon | MultiPolygon;
  title: string;
  propertyName: string;
  /** Caminho escolhido pelo usuário; sem ele o croqui usa o mais curto. */
  route?: CroquiRoute | null;
}): Promise<{
  narrative: string;
  municipioNome: string;
  files: Array<{ name: string; buffer: Buffer }>;
}> {
  const { atpGeometry, title, propertyName } = args;
  const { municipioNome, landmark, centLon, centLat } = await resolveCroquiContext(atpGeometry);
  const route = args.route || (await routeToBoundary(atpGeometry, landmark, centLon, centLat));

  const narrative = buildCroquiNarrative({ municipioNome, propertyName, landmark, route });
  const fileStem = safeFileStem(title);

  const kml = buildCroquiKml({
    title,
    propertyName,
    atpGeometry,
    route,
    fileName: `${fileStem}.kml`,
  });
  const docx = await buildCroquiDocxBuffer(narrative);
  const pdf = await buildCroquiPdfBuffer({ title, narrative, atpGeometry, route });

  const pdfName = `${fileStem}.pdf`;
  const docxName = `${fileStem}.docx`;
  const kmlName = `${fileStem}.kml`;

  return {
    narrative,
    municipioNome,
    files: [
      { name: pdfName, buffer: pdf },
      { name: docxName, buffer: docx },
      { name: kmlName, buffer: Buffer.from(kml, "utf8") },
    ],
  };
}

/**
 * As opções ficam num JSON ao lado do upload: a geração precisa da rota exata
 * que o usuário viu na tela, e recalcular arriscaria devolver outro traçado.
 */
function saveRouteOptions(uid: string, uploadId: string, options: RouteOption[]): string {
  const stored = saveUserBuffer({
    uid,
    area: "croqui/routes",
    filename: `${uploadId}_rotas.json`,
    buffer: Buffer.from(JSON.stringify({ uploadId, options }), "utf8"),
  });
  return stored.relativePath;
}

function readRouteOption(relativePath: string, optionId: string): CroquiRoute | null {
  try {
    const raw = fs.readFileSync(getAbsoluteStoragePath(relativePath), "utf8");
    const parsed = JSON.parse(raw) as { options?: RouteOption[] };
    const found = (parsed.options || []).find((option) => option.id === optionId);
    return found?.route || null;
  } catch {
    return null;
  }
}

async function runCroquiJob(args: {
  uid: string;
  jobId: string;
  upload: Record<string, unknown>;
  title: string;
  propertyName: string;
  route?: CroquiRoute | null;
  routeLabel?: string;
}): Promise<void> {
  const { uid, jobId, upload, title, propertyName } = args;
  try {
    if (isCancelRequested(jobId)) {
      progress(uid, jobId, { status: "cancelled", percent: 100, message: "Cancelado." });
      finishJob({ jobId, status: "cancelled" });
      return;
    }

    progress(uid, jobId, { status: "processing", stage: "parse", percent: 10, message: "Lendo shapefile ATP..." });
    const inputPath = String(upload.inputRelativePath || "");
    const inputZipBuffer = fs.readFileSync(getAbsoluteStoragePath(inputPath));
    const parsed = parseUserShapefile(inputZipBuffer);
    if (parsed.polygons.length !== 1) {
      throw new Error("O ZIP deve conter exatamente um polígono ATP.");
    }

    progress(uid, jobId, {
      stage: "route",
      percent: 35,
      message: args.route
        ? `Usando o caminho escolhido${args.routeLabel ? ` (${args.routeLabel})` : ""}...`
        : "Calculando rota de acesso...",
    });
    const result = await generateCroquiArtifacts({
      atpGeometry: parsed.geometry,
      title,
      propertyName,
      route: args.route,
    });

    if (isCancelRequested(jobId)) {
      progress(uid, jobId, { status: "cancelled", percent: 100, message: "Cancelado." });
      finishJob({ jobId, status: "cancelled" });
      return;
    }

    progress(uid, jobId, { stage: "export", percent: 75, message: "Gerando PDF, Word e KML..." });
    const zipBuffer = await buildOutputZip(result.files);

    const stored = saveUserBuffer({
      uid,
      area: "croqui/output",
      filename: `${jobId}_croqui.zip`,
      buffer: zipBuffer,
    });

    const downloadUrl = stored.publicUrl;
    const fileNames = result.files.map((f) => f.name);
    progress(uid, jobId, {
      status: "completed",
      stage: "done",
      percent: 100,
      message: `Croqui gerado (${result.municipioNome}).`,
      municipioNome: result.municipioNome,
      title,
      propertyName,
      routeLabel: args.routeLabel || null,
      files: fileNames,
      outputRelativePath: stored.relativePath,
      outputUrl: downloadUrl,
      downloadUrl,
      outputBytes: zipBuffer.length,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const message = String(error?.message || error || "Falha ao gerar croqui.");
    progress(uid, jobId, {
      status: "failed",
      percent: 100,
      error: message,
      message,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "failed", error: message });
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

  app.post("/api/croqui/route-options", async (req: Request, res: Response) => {
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
      const upload = readDocBySegments(["users", uid, "croqui_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }

      const inputZipBuffer = fs.readFileSync(
        getAbsoluteStoragePath(String(upload.inputRelativePath || "")),
      );
      const parsed = parseUserShapefile(inputZipBuffer);
      if (parsed.polygons.length !== 1) {
        throw new Error("O ZIP deve conter exatamente um polígono ATP.");
      }

      const { municipioNome, options } = await buildCroquiRouteOptions({
        atpGeometry: parsed.geometry,
      });
      const routesRelativePath = saveRouteOptions(uid, uploadId, options);
      const payload = options.map(toRouteOptionPayload);

      // Basemap: imagem de satélite para o mapinha de escolha no frontend.
      // Usa o mesmo pipeline do PDF (resolveMapFrame + fetchBasemapImage),
      // mas em dimensão menor (640 px CSS) para caber em JSON base64.
      const allCoords: Position[] = [];
      for (const opt of options) allCoords.push(...opt.route.coordinates);
      const atpRings = outlineRings(parsed.geometry);
      for (const ring of atpRings) {
        for (const [lon, lat] of ring) allCoords.push([lon, lat]);
      }
      const frame = resolveMapFrame({
        contentBbox: bboxOfPositions(allCoords),
        widthPt: 560,
        heightPt: 420,
        paddingRatio: 0.04,
      });
      const basemapImage = await fetchBasemapImage(frame).catch(() => null);
      const basemap = basemapImage
        ? {
            dataUrl: `data:image/${basemapImage.provider === "google" ? "png" : "jpeg"};base64,${basemapImage.buffer.toString("base64")}`,
            provider: basemapImage.provider,
            bboxLonLat: frame.bboxLonLat,
            imageWidthPx: frame.imageWidthPx,
            imageHeightPx: frame.imageHeightPx,
            centerLon: frame.centerLon,
            centerLat: frame.centerLat,
            zoom: frame.zoom,
          }
        : null;

      persistJob(uid, uploadId, {
        municipioNome,
        routesRelativePath,
        routeOptions: payload.map(({ coordinates, ...rest }) => rest),
      });
      res.json({
        ok: true,
        municipioNome,
        options: payload,
        // Contorno do imóvel e ponto de partida: sem eles o mapinha de escolha
        // seria um punhado de linhas sem destino visível.
        atp: atpRings,
        start: options[0]?.route.coordinates[0] || null,
        basemap,
      });
    } catch (error: any) {
      console.error("[CROQUI] route-options failed:", error?.message || error);
      res.status(400).json({ error: error?.message || "Falha ao calcular os caminhos de acesso." });
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

      const routeOptionId = String((req.body as any)?.routeOptionId || "").trim();
      let route: CroquiRoute | null = null;
      let routeLabel = "";
      if (routeOptionId) {
        route = readRouteOption(String(upload.routesRelativePath || ""), routeOptionId);
        if (!route) {
          res.status(404).json({ error: "Caminho escolhido não encontrado. Recalcule os caminhos." });
          return;
        }
        const summaries = (upload.routeOptions || []) as RouteOptionSummary[];
        routeLabel = summaries.find((option) => option.id === routeOptionId)?.label || routeOptionId;
      }

      const job = startJob({
        uid,
        endpoint: "/api/croqui/process",
        metadata: { uploadId, title, propertyName, filename: upload.filename, routeOptionId },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        title,
        propertyName,
        routeOptionId: routeOptionId || null,
        routeLabel: routeLabel || null,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Croqui enfileirado.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runCroquiJob({ uid, jobId: job.jobId, upload, title, propertyName, route, routeLabel });
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

  app.get("/api/croqui/uploads", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const docs = listCollectionBySegments(
        ["users", uid, "croqui_jobs"],
        { orderBy: "updatedAtMs", direction: "desc" },
      );
      const now = Date.now();
      const uploads = docs
        .filter((d) => d.data.type === "upload" && d.data.status === "uploaded")
        .filter((d) => !d.data.expiresAtMs || Number(d.data.expiresAtMs) > now)
        .map((d) => ({
          uploadId: d.id,
          filename: String(d.data.filename || ""),
          polygonCount: Number(d.data.polygonCount || 0),
          municipioNome: d.data.municipioNome ? String(d.data.municipioNome) : null,
          createdAt: String(d.data.createdAt || ""),
        }));
      res.json({ ok: true, uploads });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao listar uploads." });
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
    removeStoragePath(String(data.routesRelativePath || ""));
    persistJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
