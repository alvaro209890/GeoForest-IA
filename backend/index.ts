import express from "express";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import proj4 from "proj4";
import { inflateRawSync } from "zlib";
import { fileURLToPath } from "url";
import { registerWfsIntersectionRoutes } from "./wfs-intersection";
import { createKnowledgeBase } from "./knowledge-base";
import { requireAuth, attachOptionalAuth } from "./auth";
import {
  BillingError,
  applyCancelFloorDebit,
  buildUsageFromGroq,
  createManualTopup,
  createRequestId,
  estimateCloudinaryStorageReserve,
  estimateReserveForModels,
  estimateTokensFromMessages,
  estimateTokensFromText,
  getBillingLedger,
  getBillingMe,
  getBillingPricingSnapshot,
  refundReserve,
  reserveCredits,
  settleCloudinaryStorageReserve,
  settleReservedCredits,
  chargeMapSnapshot,
} from "./billing";
import {
  extractZipEntries,
  isLatLonBbox,
  detectUtmProj,
  reprojectPolygon,
  reprojectBbox,
} from "./geo-utils";
import { adminAuth, isFirebaseConfigError } from "./firebase-admin";
import { PORT, IS_DEVELOPMENT, RENDER_INFO, KEEP_ALIVE_URL, KEEP_ALIVE_INTERVAL_MS } from "./config";
import { createCorsMiddleware } from "./middleware/cors";
import { createRequestLogger } from "./middleware/request-logger";
import { registerStoreRoutes } from "./routes/store";
import { registerAccountRoutes } from "./routes/account";
import { registerBillingRoutes } from "./routes/billing";
import { registerProcessRoutes } from "./routes/process";
import { registerModelsRoutes } from "./routes/models";
import { registerMapRoutes } from "./routes/map";
import { registerGeometryRoutes } from "./routes/geometry";
import {
  SEMA_WMS_BASE,
  SEMA_WMS_AUTHKEY,
  readPositiveInt,
  MAP_CAPABILITIES_TTL_MS,
  MAP_SNAPSHOT_TTL_MS,
  MAP_SNAPSHOT_CACHE_MAX_ITEMS,
  CURATED_IMAGERY_LAYER_NAMES,
  CURATED_IMAGERY_ORDER_MAP,
  parseLayersFromCapabilities,
  toImageryLayers,
  toShapeLayers,
  toSimcarDigitalLayers,
  getPdfParser,
  parsePdfSafe,
  getMapCapabilitiesData,
  fetchSemamtImageryLayers,
  fetchSemamtCapabilitiesXml,
  decodeDataUrl,
  parseKmlBbox,
  getCachedMapSnapshot,
  storeMapSnapshot,
  pruneMapSnapshotCache,
  mapCapabilitiesCache,
  mapSnapshotCache,
  cachedPdfParser,
} from "./lib/map-utils";
import type {
  MapCapabilitiesPayload,
  MapCapabilitiesCacheEntry,
  MapSnapshotPayload,
} from "./lib/map-utils";
import { MODEL_CATALOG, MODEL_IDS, IMAGE_ANALYSIS_MODEL, IMAGE_ANALYSIS_FALLBACKS } from "./lib/models-config";
import { getSimcarAiRuntimeConfig, registerSimcarClipRoutes } from "./simcar-clip";
import { registerSimcarReceiptRoutes } from "./simcar-receipts";
import { registerApfReceiptRoutes } from "./apf-receipts";
import { registerCbersWpmRoutes } from "./cbers-wpm";
import { registerLandsatRoutes } from "./landsat";
import { CBERS_ARCHIVE_ROOT, registerCbersArchiveAdminRoutes } from "./cbers-archive";
import { registerVerticesRoutes } from "./vertices-proximas";
import { registerContainmentRoutes } from "./containment-analysis";
import { registerOverlapRoutes } from "./overlap-analysis";
import { registerCroquiRoutes } from "./croqui";
import { registerGeometryErrorsRoutes } from "./geometry-errors";
import { registerProcessarProjetoRoutes } from "./processar-projeto";
import { registerSimcarOraculoRoutes } from "./simcar-oraculo";
import { registerAuasScconRoutes } from "./auas-sccon";
import {
  JobCancelledError,
  finishJob,
  isCancelRequested,
  markPersistedRunningJobsInterrupted,
  markDisconnected,
  requestCancel,
  startJob,
} from "./processing-jobs";
import {
  STORAGE_ROOT,
  deleteDocBySegments,
  ensureStorageRoot,
  listCollectionBySegments,
  readDocBySegments,
  saveUserBuffer,
  stripUndefinedDeep,
  upsertUserProfile,
  writeDocBySegments,
} from "./local-storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function estimateBytesFromDataUrl(dataUrl: string): number {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return 0;
  const base64Payload = String(match[2] || "").replace(/\s/g, "");
  if (!base64Payload) return 0;
  const padding = (base64Payload.match(/=+$/)?.[0]?.length || 0);
  return Math.max(0, Math.floor((base64Payload.length * 3) / 4) - padding);
}

type ServerStorageMetric = {
  device: string;
  kind: "ssd" | "hd";
  model?: string;
  mountpoint: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
};

type TemperatureReading = {
  label: string;
  valueC: number;
};

function runCommandText(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function readCpuTotals(): { idle: number; total: number } | null {
  try {
    const line = fs
      .readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("cpu "));
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map((value) => Number(value) || 0);
    if (parts.length < 4) return null;
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function sampleCpuUsagePercent(): Promise<number | null> {
  const start = readCpuTotals();
  if (!start) return null;
  await new Promise((resolve) => setTimeout(resolve, 180));
  const end = readCpuTotals();
  if (!end) return null;
  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (totalDelta <= 0) return null;
  return Number((((totalDelta - idleDelta) / totalDelta) * 100).toFixed(1));
}

function parseTemperatureReadings(raw: string | null): {
  available: boolean;
  cpuPackageC: number | null;
  hottestCoreC: number | null;
  readings: TemperatureReading[];
} {
  if (!raw) {
    return { available: false, cpuPackageC: null, hottestCoreC: null, readings: [] };
  }

  const readings: TemperatureReading[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([^:]+):\s*\+?(-?\d+(?:\.\d+)?)°C/i);
    if (!match) continue;
    readings.push({
      label: String(match[1] || "").trim(),
      valueC: Number(match[2] || 0),
    });
  }

  if (!readings.length) {
    return { available: false, cpuPackageC: null, hottestCoreC: null, readings: [] };
  }

  const cpuPackage = readings.find((item) => /package id/i.test(item.label)) || null;
  const coreReadings = readings.filter((item) => /^core\s+\d+/i.test(item.label));
  const hottestCore = coreReadings.reduce<number | null>(
    (current, item) => (current === null || item.valueC > current ? item.valueC : current),
    null,
  );

  return {
    available: true,
    cpuPackageC: cpuPackage?.valueC ?? null,
    hottestCoreC: hottestCore,
    readings,
  };
}

function collectMountedChildren(device: any): any[] {
  const nodes: any[] = [];
  if (device?.mountpoint) nodes.push(device);
  for (const child of Array.isArray(device?.children) ? device.children : []) {
    nodes.push(...collectMountedChildren(child));
  }
  return nodes;
}

function parseStorageMetrics(): ServerStorageMetric[] {
  const lsblkRaw = runCommandText("lsblk", ["-J", "-b", "-o", "NAME,PATH,ROTA,TYPE,SIZE,MOUNTPOINT,MODEL"]);
  const dfRaw = runCommandText("df", ["-B1", "--output=source,size,used,avail,pcent,target"]);
  if (!lsblkRaw || !dfRaw) return [];

  let lsblkPayload: any;
  try {
    lsblkPayload = JSON.parse(lsblkRaw);
  } catch {
    return [];
  }

  const dfByMount = new Map<
    string,
    { filesystem: string; totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number }
  >();

  for (const line of dfRaw.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const filesystem = parts[0];
    const totalBytes = Number(parts[1] || 0);
    const usedBytes = Number(parts[2] || 0);
    const freeBytes = Number(parts[3] || 0);
    const usagePercent = Number(String(parts[4] || "").replace(/[^\d.]/g, "")) || 0;
    const mountpoint = parts.slice(5).join(" ");
    if (!mountpoint) continue;
    dfByMount.set(mountpoint, { filesystem, totalBytes, usedBytes, freeBytes, usagePercent });
  }

  const devices = Array.isArray(lsblkPayload?.blockdevices) ? lsblkPayload.blockdevices : [];
  const metrics: ServerStorageMetric[] = [];

  for (const disk of devices) {
    if (String(disk?.type || "") !== "disk") continue;
    const kind: "ssd" | "hd" = Number(disk?.rota) === 0 ? "ssd" : "hd";
    const model = String(disk?.model || "").trim() || undefined;
    for (const mounted of collectMountedChildren(disk)) {
      const mountpoint = String(mounted?.mountpoint || "").trim();
      if (!mountpoint) continue;
      const dfStats = dfByMount.get(mountpoint);
      if (!dfStats) continue;
      metrics.push({
        device: String(dfStats.filesystem || mounted?.path || mounted?.name || "").trim(),
        kind,
        model,
        mountpoint,
        totalBytes: dfStats.totalBytes,
        usedBytes: dfStats.usedBytes,
        freeBytes: dfStats.freeBytes,
        usagePercent: dfStats.usagePercent,
      });
    }
  }

  const priority = (item: ServerStorageMetric) => {
    if (item.mountpoint === "/") return 0;
    if (item.mountpoint === "/media/server/HD Backup") return 1;
    return 2;
  };

  return metrics.sort((a, b) => {
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.mountpoint.localeCompare(b.mountpoint);
  });
}

function parseProcesses(): {
  totalVisible: number;
  top: Array<{ pid: number; command: string; cpuPercent: number; memPercent: number }>;
} {
  const raw = runCommandText("ps", ["-eo", "pid=,comm=,pcpu=,pmem=", "--sort=-pcpu"]);
  if (!raw) return { totalVisible: 0, top: [] };

  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        pid: Number(parts[0] || 0),
        command: String(parts[1] || "").trim(),
        cpuPercent: Number(parts[2] || 0),
        memPercent: Number(parts[3] || 0),
      };
    })
    .filter((item) => item.pid > 0 && item.command);

  return {
    totalVisible: rows.length,
    top: rows.slice(0, 12),
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const bootId = crypto.randomUUID();
  const renderInfo = RENDER_INFO;
  const logBackend = (
    event: string,
    payload: Record<string, unknown>,
    level: "info" | "warn" | "error" = "info",
  ) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      bootId,
      ...renderInfo,
      ...payload,
    });
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };
  process.on("unhandledRejection", (reason: unknown) => {
    logBackend(
      "process_unhandled_rejection",
      {
        reason:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack || "" }
            : String(reason),
      },
      "error",
    );
  });
  process.on("uncaughtException", (error: Error) => {
    logBackend(
      "process_uncaught_exception",
      { message: error.message, stack: error.stack || "" },
      "error",
    );
  });

  ensureStorageRoot();
  const interruptedJobs = markPersistedRunningJobsInterrupted();
  if (interruptedJobs > 0) {
    logBackend("processing_jobs_interrupted_on_boot", { count: interruptedJobs }, "warn");
  }
  app.use(express.json({ limit: "25mb" }));

  // CORS
  app.use(createCorsMiddleware());

  // HTTP request logger
  app.use(createRequestLogger(logBackend));

  app.use(
    [
      "/api/chat",
      "/api/chat-stream",
      "/api/simcar/clip/import-vectorized",
      "/api/simcar/clip/analyze",
      "/api/simcar/clip/analyze-auas",
      "/api/simcar/clip/analyze/chat",
      "/api/simcar/clip/report",
      "/api/simcar/receipts/search",
      /^\/api\/simcar\/receipts\/download\/[^/]+$/,
      "/api/cbers-wpm/search",
      "/api/cbers-wpm/estimate",
      "/api/cbers-wpm/jobs",
      /^\/api\/cbers-wpm\/jobs\/[^/]+\/status$/,
      /^\/api\/cbers-wpm\/jobs\/[^/]+\/events$/,
      /^\/api\/cbers-wpm\/jobs\/[^/]+$/,
      "/api/landsat/search",
      "/api/landsat/estimate",
      "/api/landsat/jobs",
      /^\/api\/landsat\/jobs\/[^/]+\/status$/,
      /^\/api\/landsat\/jobs\/[^/]+\/events$/,
      /^\/api\/landsat\/jobs\/[^/]+$/,
      "/api/vertices/upload",
      "/api/vertices/process",
      /^\/api\/vertices\/jobs\/[^/]+\/status$/,
      /^\/api\/vertices\/jobs\/[^/]+\/events$/,
      /^\/api\/vertices\/jobs\/[^/]+$/,
      /^\/api\/vertices\/download\/[^/]+$/,
      "/api/containment/upload",
      "/api/containment/process",
      /^\/api\/containment\/jobs\/[^/]+\/status$/,
      /^\/api\/containment\/jobs\/[^/]+\/events$/,
      /^\/api\/containment\/download\/[^/]+$/,
      /^\/api\/containment\/jobs\/[^/]+$/,
      "/api/overlap/upload",
      "/api/overlap/process",
      "/api/overlap/sources/health",
      /^\/api\/overlap\/jobs\/[^/]+\/status$/,
      /^\/api\/overlap\/jobs\/[^/]+\/events$/,
      /^\/api\/overlap\/download\/[^/]+$/,
      /^\/api\/overlap\/jobs\/[^/]+$/,
      "/api/croqui/upload",
      "/api/croqui/route-options",
      "/api/croqui/process",
      /^\/api\/croqui\/jobs\/[^/]+\/status$/,
      /^\/api\/croqui\/jobs\/[^/]+\/events$/,
      /^\/api\/croqui\/download\/[^/]+$/,
      /^\/api\/croqui\/jobs\/[^/]+$/,
      "/api/croqui/uploads",
      "/api/geometry-errors/upload",
      "/api/geometry-errors/process",
      /^\/api\/geometry-errors\/jobs\/[^/]+\/status$/,
      /^\/api\/geometry-errors\/jobs\/[^/]+\/events$/,
      /^\/api\/geometry-errors\/download\/[^/]+$/,
      /^\/api\/geometry-errors\/jobs\/[^/]+$/,
      "/api/processar-projeto/upload",
      "/api/processar-projeto/importar",
      "/api/processar-projeto/processar",
      /^\/api\/processar-projeto\/import\/[^/]+\/pdf$/,
      /^\/api\/processar-projeto\/jobs\/[^/]+\/status$/,
      /^\/api\/processar-projeto\/jobs\/[^/]+\/events$/,
      /^\/api\/processar-projeto\/download\/[^/]+$/,
      /^\/api\/processar-projeto\/jobs\/[^/]+$/,
      "/api/simcar-oraculo/health",
      "/api/simcar-oraculo/test-project",
      "/api/simcar-oraculo/municipios",
      "/api/simcar-oraculo/pipeline",
      "/api/simcar-oraculo/importar",
      "/api/simcar-oraculo/processar",
      "/api/simcar-oraculo/shape-preview",
      /^\/api\/simcar-oraculo\/jobs\/[^/]+$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/events$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/artifact\/[^/]+$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/autofix$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/pdf-import$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/pdf-process$/,
      /^\/api\/simcar-oraculo\/jobs\/[^/]+\/erros-zip$/,
      "/api/croqui/upload",
      "/api/croqui/route-options",
      "/api/croqui/process",
      /^\/api\/croqui\/jobs\/[^/]+\/status$/,
      /^\/api\/croqui\/jobs\/[^/]+\/events$/,
      /^\/api\/croqui\/download\/[^/]+\$/,
      /^\/api\/croqui\/jobs\/[^/]+\$/,
      "/api/croqui/uploads",
      "/api/auas-sccon/process",
      /^\/api\/auas-sccon\/download\/[^/]+$/,
      "/api/process/cancel",
      "/api/account/bootstrap",
      "/api/me",
      "/api/store/doc",
      "/api/store/collection",
      "/api/billing/me",
      "/api/billing/topups/manual",
      "/api/billing/ledger",
    ],
    requireAuth,
  );
  app.use(["/api/upload-image", "/api/upload-file"], attachOptionalAuth);
  // Artefatos do oráculo exigem ownership via /jobs/:id/artifact/:key; nunca ficam expostos
  // pelo servidor estático genérico, mesmo que alguém descubra o path relativo no disco.
  app.use("/api/storage/users/:uid/simcar-oraculo", (_req, res) => {
    res.status(404).json({ error: "Arquivo não encontrado." });
  });
  app.use("/api/storage", express.static(STORAGE_ROOT));
  app.use("/api/raster", express.static(CBERS_ARCHIVE_ROOT));

  registerAccountRoutes(app);
  registerStoreRoutes(app);
  registerProcessRoutes(app);

  registerWfsIntersectionRoutes(app);
  registerSimcarClipRoutes(app);
  registerSimcarReceiptRoutes(app);
  registerApfReceiptRoutes(app);
  registerCbersWpmRoutes(app);
  registerLandsatRoutes(app);
  registerVerticesRoutes(app);
  registerContainmentRoutes(app);
  registerOverlapRoutes(app);
  registerCroquiRoutes(app);
  registerGeometryErrorsRoutes(app);
  registerProcessarProjetoRoutes(app);
  registerSimcarOraculoRoutes(app);
  registerAuasScconRoutes(app);
  registerCbersArchiveAdminRoutes(app);

  const knowledgeBase = createKnowledgeBase({
    dbRoot: path.resolve(__dirname, "..", "banco_de_dados"),
    zipPath: path.resolve(__dirname, "..", "banco_de_dados", "banco_de_dados_melhorado.zip"),
    summaryModel: process.env.DB_SUMMARY_MODEL || "openai/gpt-oss-20b",
    summaryMaxTokens: Number(process.env.DB_SUMMARY_MAX_TOKENS ?? "220"),
    summaryEnabled: String(process.env.DB_SUMMARY_ENABLED ?? "true") !== "false",
  });



  const parseShapefileFirstPolygon = (shpBuffer: Buffer) => {
    // Returns first polygon ring found (lon/lat), limited to avoid oversized payloads.
    if (shpBuffer.length < 120) return null;
    const pointsLimit = 6000;
    let offset = 100; // skip .shp header
    while (offset + 12 <= shpBuffer.length) {
      const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
      const contentLengthBytes = contentLengthWords * 2;
      const recStart = offset + 8;
      const recEnd = recStart + contentLengthBytes;
      if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

      const shapeType = shpBuffer.readInt32LE(recStart);
      if ((shapeType === 5 || shapeType === 15) && contentLengthBytes >= 44) {
        const numParts = shpBuffer.readInt32LE(recStart + 36);
        const numPoints = shpBuffer.readInt32LE(recStart + 40);
        if (numParts > 0 && numPoints > 2) {
          const partsOffset = recStart + 44;
          const pointsOffset = partsOffset + numParts * 4;
          if (pointsOffset + numPoints * 16 <= recEnd) {
            const partStart = shpBuffer.readInt32LE(partsOffset);
            const partEnd = numParts > 1 ? shpBuffer.readInt32LE(partsOffset + 4) : numPoints;
            const end = Math.min(partEnd, numPoints, partStart + pointsLimit);
            const ring: Array<[number, number]> = [];
            for (let i = partStart; i < end; i += 1) {
              const pOff = pointsOffset + i * 16;
              const x = shpBuffer.readDoubleLE(pOff);
              const y = shpBuffer.readDoubleLE(pOff + 8);
              if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
            }
            if (ring.length >= 3) return ring;
          }
        }
      }

      offset = recEnd;
    }
    return null;
  };



  registerModelsRoutes(app);
  registerBillingRoutes(app);

  registerMapRoutes(app);
  registerGeometryRoutes(app);

  const autoSelectModel = (messages: Array<{ role: string; content: any }>) => {
    let hasImage = false;
    const text = messages
      .map((m) => {
        const content = m.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((part) => {
              if (part?.type === "image_url") hasImage = true;
              if (part?.type === "text") return String(part?.text ?? "");
              return "";
            })
            .join(" ");
        }
        return "";
      })
      .join(" ")
      .toLowerCase();

    const hasVisionCue =
      /(imagem|foto|sat[eÃ©]lite|ortomosaico|drone|a[eÃ©]reo|mapa|png|jpg|jpeg|tif|tiff)/.test(text);
    if (hasImage || hasVisionCue) return "meta-llama/llama-4-maverick-17b-128e-instruct";
    const hasGeoCue =
      /(bbox|coordenad|epsg|wms|landsat|sentinel|declividade|demarca[cÃ§][aÃ£]o|pol[iÃ­]gono)/.test(text);
    if (hasGeoCue) return "meta-llama/llama-4-maverick-17b-128e-instruct";

    const hasHighComplexityCue =
      /(an[aÃ¡]lise profunda|laudo|relat[oÃ³]rio t[eÃ©]cnico|multi[ -]?arquivo|muitos anexos|comparativo)/.test(
        text
      );
    if (hasHighComplexityCue) return "openai/gpt-oss-120b";

    const hasDataCue =
      /(shapefile|shape|geojson|csv|xlsx|planilha|tabela|dados|estat[iÃ­]stica|an[Ã¡a]lise)/.test(text);
    if (hasDataCue) return "openai/gpt-oss-120b";

    return "meta-llama/llama-3.3-70b-versatile";
  };

  const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-versatile";
  const TEMPERATURE = 0.02;
  const MAX_TOKENS = 1800;
  const AUTO_MODEL = true;
  /** Trim text to the last complete sentence to avoid garbled continuation joins */
  const trimToLastCompleteSentence = (text: string): string => {
    const trimmed = text.trimEnd();
    if (!trimmed) return trimmed;
    // If it already ends with sentence-ending punctuation, return as-is
    if (/[.!?:;\n]$/.test(trimmed)) return trimmed;
    // Find the last sentence-ending punctuation
    const lastSentenceEnd = Math.max(
      trimmed.lastIndexOf(". "),
      trimmed.lastIndexOf(".\n"),
      trimmed.lastIndexOf("! "),
      trimmed.lastIndexOf("?\n"),
      trimmed.lastIndexOf("? "),
      trimmed.lastIndexOf(":\n"),
      trimmed.lastIndexOf(";\n"),
    );
    if (lastSentenceEnd > trimmed.length * 0.5) {
      // Only trim if we'd keep at least 50% of the content
      return trimmed.slice(0, lastSentenceEnd + 1).trimEnd();
    }
    return trimmed;
  };

  const splitThinkProgress = (raw: string) => {
    let visible = "";
    const thinkParts: string[] = [];
    let cursor = 0;

    while (cursor < raw.length) {
      const start = raw.indexOf("<think>", cursor);
      if (start === -1) {
        visible += raw.slice(cursor);
        break;
      }
      visible += raw.slice(cursor, start);
      const thinkStart = start + "<think>".length;
      const end = raw.indexOf("</think>", thinkStart);
      if (end === -1) {
        thinkParts.push(raw.slice(thinkStart));
        break;
      }
      thinkParts.push(raw.slice(thinkStart, end));
      cursor = end + "</think>".length;
    }

    return {
      thinkingText: thinkParts.join("\n\n").trim(),
      answerText: visible.trim(),
    };
  };

  const injectPendingPdfContext = async (
    messages: Array<{ role: string; content: any }>,
    pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>
  ) => {
    const docs = Array.isArray(pendingPdfs)
      ? pendingPdfs.filter((p) => p?.dataUrl && typeof p.dataUrl === "string")
      : [];
    if (!docs.length) return messages;

    const contexts: string[] = [];
    for (const pendingPdf of docs) {
      const parts = String(pendingPdf.dataUrl || "").split(",");
      if (parts.length !== 2) continue;

      let extractedText = "";
      try {
        const raw = Buffer.from(parts[1], "base64");
        const parsed = await parsePdfSafe(raw);
        if (parsed?.text) {
          extractedText = (parsed.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 25000);
        }
      } catch (err) {
        console.warn("[/api/chat-stream] pendingPdf parse failed:", err);
      }

      const context =
        `Documento PDF anexado pelo usuÃ¡rio (${pendingPdf.filename || "documento.pdf"}).` +
        (extractedText
          ? `\nUse o conteÃºdo extraÃ­do abaixo como base:\n${extractedText}`
          : "\nNÃ£o foi possÃ­vel extrair texto automaticamente; informe essa limitaÃ§Ã£o.");
      contexts.push(context);
    }
    if (!contexts.length) return messages;

    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const msg = next[i];
      if (msg.role !== "user") continue;
      const baseText =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
              .map((part) => (part?.type === "text" ? String(part?.text || "") : ""))
              .join("\n")
            : "";
      next[i] = { ...msg, content: `${baseText}\n\n${contexts.join("\n\n")}`.trim() };
      break;
    }

    return next;
  };

  const insertSystemContext = (
    messages: Array<{ role: string; content: any }>,
    systemMessage: { role: "system"; content: string }
  ) => {
    let idx = 0;
    while (idx < messages.length && messages[idx]?.role === "system") idx += 1;
    return [...messages.slice(0, idx), systemMessage, ...messages.slice(idx)];
  };

  const GUARDRAIL_SYSTEM_MESSAGE = {
    role: "system" as const,
    content: [
      "## VERIFICAÃ‡ÃƒO FINAL ANTES DE RESPONDER",
      "Antes de entregar sua resposta, verifique cada afirmaÃ§Ã£o:",
      "- Cada lei/norma citada tem nÃºmero e ano corretos? Se nÃ£o tem certeza, remova ou diga 'verificar na legislaÃ§Ã£o vigente'.",
      "- Cada dado numÃ©rico (Ã¡rea, percentual, coordenada) veio do usuÃ¡rio ou da Base de Conhecimento? Se nÃ£o, remova.",
      "- Cada fonte citada [arquivo.md] existe nos excertos fornecidos? Se nÃ£o, remova a citaÃ§Ã£o.",
      "- HÃ¡ afirmaÃ§Ãµes categÃ³ricas sem evidÃªncia? Reformule como hipÃ³tese com nÃ­vel de confianÃ§a.",
      "- Se vocÃª nÃ£o tem informaÃ§Ã£o suficiente, Ã© MELHOR dizer 'nÃ£o sei / preciso de mais dados' do que inventar uma resposta plausÃ­vel.",
    ].join("\n"),
  };

  const ASSISTANT_STYLE_SYSTEM_MESSAGE = {
    role: "system" as const,
    content: [
      "## FORMATO DE RESPOSTA",
      "- Responda em portugues claro, direto e tecnico.",
      "- Quando houver comparacao de itens (anos, areas, limites, prazos, documentos), prefira tabela Markdown.",
      "- Em tabela Markdown, use cabecalho + linha separadora e no maximo 6 colunas.",
      "- Nao quebre celulas em multiplas linhas; mantenha cada celula curta e objetiva.",
      "- Depois da tabela, inclua um bloco curto de conclusao pratica em 2 a 4 bullets.",
    ].join("\n"),
  };

  const callGroqChat = async (
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: any }>,
    maxTokens: number,
    temperature: number
  ) => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Erro ${response.status}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || "");
  };

  app.post("/api/chat", async (req, res) => {
    let billingRequestId = "";
    let billingReserved = 0;
    let billingUid = "";
    try {
      console.log("[/api/chat] request received");
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      billingUid = uid;

      const apiKey = process.env.GROQ_API_KEY;
      const defaultModel = DEFAULT_MODEL;
      const temperature = TEMPERATURE;
      const maxTokens = MAX_TOKENS;
      const autoModel = AUTO_MODEL;
      if (!apiKey) {
        console.error("[/api/chat] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf, pendingPdfs } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
        pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>;
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        console.error("[/api/chat] invalid messages payload");
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }
      const normalizedPendingPdfs = Array.isArray(pendingPdfs)
        ? pendingPdfs
        : pendingPdf
          ? [pendingPdf]
          : [];
      let messagesForModel = await injectPendingPdfContext(messages, normalizedPendingPdfs);
      const requestStartedAt = Date.now();
      const knowledgeSelection = knowledgeBase.selectForMessages(messagesForModel);
      let knowledgeSummaryUsed = false;
      if (knowledgeSelection) {
        const knowledgeContextMessage = knowledgeBase.buildContextSystemMessage(knowledgeSelection);
        if (knowledgeContextMessage) {
          messagesForModel = insertSystemContext(messagesForModel, knowledgeContextMessage);
        }
        const guidedSummary = await knowledgeBase.maybeBuildGuidedSummary(
          knowledgeSelection,
          async ({ model: summaryModel, messages: summaryMessages, maxTokens: summaryMaxTokens, temperature: summaryTemperature }) =>
            callGroqChat(apiKey, summaryModel, summaryMessages, summaryMaxTokens, summaryTemperature),
        );
        if (guidedSummary.message) {
          messagesForModel = insertSystemContext(messagesForModel, guidedSummary.message);
        }
        knowledgeSummaryUsed = guidedSummary.summaryUsed;
      }
      const knowledgeTelemetry = knowledgeBase.toTelemetry(knowledgeSelection, knowledgeSummaryUsed);
      messagesForModel = insertSystemContext(messagesForModel, GUARDRAIL_SYSTEM_MESSAGE);
      messagesForModel = insertSystemContext(messagesForModel, ASSISTANT_STYLE_SYSTEM_MESSAGE);

      const useAuto = model === "auto" || (!model && autoModel);
      const hasImageInput = messagesForModel.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((part: any) => part?.type === "image_url" && part?.image_url?.url)
      );
      const resolvedModel = hasImageInput
        ? IMAGE_ANALYSIS_MODEL
        : useAuto
          ? autoSelectModel(messagesForModel)
          : model || defaultModel;
      if (!MODEL_IDS.has(resolvedModel)) {
        console.error("[/api/chat] model not allowed:", resolvedModel);
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      console.log("[/api/chat] model:", resolvedModel);
      const fallbackOrder = hasImageInput
        ? [IMAGE_ANALYSIS_MODEL, ...IMAGE_ANALYSIS_FALLBACKS]
        : resolvedModel === "openai/gpt-oss-120b"
          ? ["openai/gpt-oss-120b", "qwen/qwen3-32b", "meta-llama/llama-3.3-70b-versatile"]
          : [resolvedModel, "openai/gpt-oss-120b", "qwen/qwen3-32b"];
      const uniqueCandidates = fallbackOrder.filter((m, i, arr) => arr.indexOf(m) === i).filter((m) => MODEL_IDS.has(m));

      billingRequestId = createRequestId("chat");
      billingReserved = await estimateReserveForModels({
        models: uniqueCandidates,
        estimatedInputTokens: estimateTokensFromMessages(messagesForModel),
        estimatedOutputTokens: maxTokens,
        safetyMultiplier: 1.3,
        endpoint: "/api/chat",
      });
      await reserveCredits({
        uid,
        amountBrl: billingReserved,
        requestId: billingRequestId,
        endpoint: "/api/chat",
      });

      let data: any = null;
      let usedModel = resolvedModel;
      let lastErr = "";
      for (const candidate of uniqueCandidates) {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: candidate,
            temperature,
            max_tokens: maxTokens,
            messages: messagesForModel,
          }),
        });
        if (!response.ok) {
          const text = await response.text();
          lastErr = text || `Erro ${response.status}`;
          console.warn(`[ /api/chat ] model fallback failed (${candidate}):`, response.status);
          continue;
        }
        data = await response.json();
        usedModel = candidate;
        break;
      }
      if (!data) {
        await refundReserve({
          uid,
          requestId: billingRequestId,
          amountBrl: billingReserved,
          endpoint: "/api/chat",
          reason: "no_model_succeeded",
        });
        billingReserved = 0;
        res.status(502).json({ error: lastErr || "Falha ao consultar IA." });
        return;
      }

      const content = String(data?.choices?.[0]?.message?.content ?? "");
      const usageFromProvider = buildUsageFromGroq(usedModel, data?.usage, "/api/chat");
      if (usageFromProvider.estimated) {
        usageFromProvider.inputTokens = Math.max(usageFromProvider.inputTokens || 0, estimateTokensFromMessages(messagesForModel));
        usageFromProvider.outputTokens = Math.max(usageFromProvider.outputTokens || 0, estimateTokensFromText(content));
      }
      const billing = await settleReservedCredits({
        uid,
        requestId: billingRequestId,
        endpoint: "/api/chat",
        reservedBrl: billingReserved,
        usageInputs: [usageFromProvider],
      });
      billingReserved = 0;

      console.log(
        "[/api/chat] knowledge:",
        JSON.stringify({
          docsUsed: knowledgeTelemetry.docsUsed,
          contextChars: knowledgeTelemetry.contextChars,
          summaryUsed: knowledgeTelemetry.summaryUsed,
          policy: knowledgeTelemetry.policy,
          latencyMs: Date.now() - requestStartedAt,
        }),
      );
      console.log("[/api/chat] success");
      res.json({ content, model: usedModel, knowledge: knowledgeTelemetry, billing });
    } catch (error: any) {
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/chat",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/chat] falha no refund:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error("Erro no /api/chat:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/chat-stream", async (req, res) => {
    let billingRequestId = "";
    let billingReserved = 0;
    let billingUid = "";
    let processingJobId = "";
    const usageInputs: Array<{
      provider: "groq";
      model: string;
      inputTokens: number;
      outputTokens: number;
      estimated: boolean;
    }> = [];
    const writeChunk = (payload: Record<string, any>) => {
      if (res.writableEnded || (res as any).destroyed || (res as any)?.socket?.destroyed) return;
      try {
        res.write(`${JSON.stringify(payload)}\n`);
      } catch {
        // Cliente pode ter desconectado; o processamento segue no backend.
      }
    };
    try {
      console.log("[/api/chat-stream] request received");
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      billingUid = uid;

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        console.error("[/api/chat-stream] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY nÃ£o configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf, pendingPdfs } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
        pendingPdfs?: Array<{ dataUrl?: string; filename?: string }>;
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Mensagens invÃ¡lidas." });
        return;
      }

      const normalizedPendingPdfs = Array.isArray(pendingPdfs)
        ? pendingPdfs
        : pendingPdf
          ? [pendingPdf]
          : [];
      let messagesForModel = await injectPendingPdfContext(messages, normalizedPendingPdfs);
      const requestStartedAt = Date.now();
      const knowledgeSelection = knowledgeBase.selectForMessages(messagesForModel);
      let knowledgeSummaryUsed = false;
      if (knowledgeSelection) {
        const knowledgeContextMessage = knowledgeBase.buildContextSystemMessage(knowledgeSelection);
        if (knowledgeContextMessage) {
          messagesForModel = insertSystemContext(messagesForModel, knowledgeContextMessage);
        }
        const guidedSummary = await knowledgeBase.maybeBuildGuidedSummary(
          knowledgeSelection,
          async ({ model: summaryModel, messages: summaryMessages, maxTokens: summaryMaxTokens, temperature: summaryTemperature }) =>
            callGroqChat(apiKey, summaryModel, summaryMessages, summaryMaxTokens, summaryTemperature),
        );
        if (guidedSummary.message) {
          messagesForModel = insertSystemContext(messagesForModel, guidedSummary.message);
        }
        knowledgeSummaryUsed = guidedSummary.summaryUsed;
      }
      const knowledgeTelemetry = knowledgeBase.toTelemetry(knowledgeSelection, knowledgeSummaryUsed);
      messagesForModel = insertSystemContext(messagesForModel, GUARDRAIL_SYSTEM_MESSAGE);
      messagesForModel = insertSystemContext(messagesForModel, ASSISTANT_STYLE_SYSTEM_MESSAGE);

      const useAuto = model === "auto" || (!model && AUTO_MODEL);
      const hasImageInput = messagesForModel.some(
        (m) =>
          Array.isArray(m?.content) &&
          m.content.some((part: any) => part?.type === "image_url" && part?.image_url?.url)
      );
      const resolvedModel = hasImageInput
        ? IMAGE_ANALYSIS_MODEL
        : useAuto
          ? autoSelectModel(messagesForModel)
          : model || DEFAULT_MODEL;
      if (!MODEL_IDS.has(resolvedModel)) {
        res.status(400).json({ error: "Modelo nÃ£o permitido." });
        return;
      }

      const fallbackModels = hasImageInput
        ? [
          ...IMAGE_ANALYSIS_FALLBACKS,
          "meta-llama/llama-4-scout-17b-16e-instruct",
        ]
        : [
          "openai/gpt-oss-120b",
          "meta-llama/llama-3.3-70b-versatile",
          "qwen/qwen3-32b",
          "moonshotai/kimi-k2-instruct-0905",
        ];
      const startupCandidates = [resolvedModel, ...fallbackModels.filter((m) => m !== resolvedModel)];
      const MAX_CONTINUATIONS = 2;
      const maxResponseTokensEstimate = MAX_TOKENS * (MAX_CONTINUATIONS + 1);

      billingRequestId = createRequestId("chat_stream");
      billingReserved = await estimateReserveForModels({
        models: startupCandidates,
        estimatedInputTokens: estimateTokensFromMessages(messagesForModel),
        estimatedOutputTokens: maxResponseTokensEstimate,
        safetyMultiplier: 1.15,
        endpoint: "/api/chat-stream",
      });
      await reserveCredits({
        uid,
        amountBrl: billingReserved,
        requestId: billingRequestId,
        endpoint: "/api/chat-stream",
      });

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const processingJob = startJob({
        uid,
        endpoint: "/api/chat-stream",
        metadata: { model: resolvedModel },
      });
      processingJobId = processingJob.jobId;
      req.on("close", () => {
        markDisconnected(processingJobId);
      });

      const throwIfCancelled = () => {
        if (processingJobId && isCancelRequested(processingJobId)) {
          throw new JobCancelledError();
        }
      };

      writeChunk({ type: "job_started", jobId: processingJobId });

      // --- Accumulated answer (visible to user) and thinking (hidden) ---
      let accumulatedAnswer = "";
      let accumulatedThinking = "";
      const clientModel = resolvedModel;

      /**
       * Streams one model segment. Returns { finishReason, segmentText }.
       * segmentText is the RAW text this segment produced (may contain <think> tags).
       * Deltas are emitted to the client using the accumulated answer so far.
       */
      const streamModelSegment = async (
        segmentModel: string,
        segmentMessages: Array<{ role: string; content: any }>
      ): Promise<{ finishReason: string; segmentText: string }> => {
        const segmentInputTokens = estimateTokensFromMessages(segmentMessages);
        let segmentRaw = "";
        let usageRecorded = false;
        const recordUsage = () => {
          if (usageRecorded) return;
          usageRecorded = true;
          usageInputs.push({
            provider: "groq",
            model: segmentModel,
            inputTokens: Math.max(1, segmentInputTokens),
            outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
            estimated: true,
          });
        };
        throwIfCancelled();
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: segmentModel,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: true,
            messages: segmentMessages,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          throw new Error(`groq ${segmentModel} ${upstream.status}: ${text.slice(0, 500)}`);
        }

        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        let buffer = "";
        let finishReason = "";

        while (true) {
          if (processingJobId && isCancelRequested(processingJobId)) {
            recordUsage();
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new JobCancelledError();
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              recordUsage();
              return { finishReason: finishReason || "stop", segmentText: segmentRaw };
            }
            try {
              const parsed = JSON.parse(data);
              const choice = parsed?.choices?.[0];
              const delta = choice?.delta?.content;
              const fr = choice?.finish_reason;
              if (typeof fr === "string" && fr) finishReason = fr;
              if (typeof delta === "string" && delta.length > 0) {
                segmentRaw += delta;
                // Parse this segment's think tags separately
                const segSplit = splitThinkProgress(segmentRaw);
                // Emit combined accumulated + this segment's visible text
                writeChunk({
                  type: "delta",
                  model: clientModel,
                  thinkingText: accumulatedThinking + (segSplit.thinkingText ? "\n\n" + segSplit.thinkingText : ""),
                  content: accumulatedAnswer + segSplit.answerText,
                });
              }
            } catch {
              // Ignore malformed data chunks from upstream
            }
          }
        }

        recordUsage();
        return { finishReason: finishReason || "stop", segmentText: segmentRaw };
      };

      // --- Phase 1: Start streaming with the first available model ---
      let activeModel = "";
      let firstResult: { finishReason: string; segmentText: string } | null = null;
      for (const candidate of startupCandidates) {
        if (!MODEL_IDS.has(candidate)) continue;
        try {
          firstResult = await streamModelSegment(candidate, messagesForModel);
          activeModel = candidate;
          break;
        } catch (err) {
          if (err instanceof JobCancelledError) throw err;
          console.warn(`[chat-stream] startup model failed (${candidate})`, err);
        }
      }
      if (!firstResult) {
        throw new Error("Nenhum modelo disponÃ­vel para iniciar streaming.");
      }

      // Commit first segment's output
      const firstSplit = splitThinkProgress(firstResult.segmentText);
      accumulatedAnswer += firstSplit.answerText;
      if (firstSplit.thinkingText) {
        accumulatedThinking += (accumulatedThinking ? "\n\n" : "") + firstSplit.thinkingText;
      }

      // --- Phase 2: Continue if the model hit max_tokens (finish_reason: "length") ---
      let continuationsUsed = 0;
      let lastFinishReason = firstResult.finishReason;

      while (lastFinishReason === "length" && continuationsUsed < MAX_CONTINUATIONS) {
        throwIfCancelled();
        continuationsUsed += 1;

        // Trim trailing incomplete sentence to avoid garbled joins
        const trimmedAnswer = trimToLastCompleteSentence(accumulatedAnswer);

        const continuationInstruction =
          "Sua resposta anterior foi cortada. Continue EXATAMENTE de onde parou.\n" +
          "REGRAS:\n" +
          "- NÃƒO repita nenhum conteÃºdo jÃ¡ escrito.\n" +
          "- Mantenha o mesmo idioma, tom, formato (markdown/bullets/tabelas) e contexto tÃ©cnico.\n" +
          "- Entregue SOMENTE a continuaÃ§Ã£o, comeÃ§ando da prÃ³xima palavra/frase.\n" +
          "- NÃƒO adicione informaÃ§Ãµes novas que nÃ£o faziam parte do raciocÃ­nio original.\n" +
          "- NÃƒO invente dados, normas ou fontes.";

        const continuationMessages = [
          ...messagesForModel,
          { role: "assistant" as const, content: trimmedAnswer },
          { role: "user" as const, content: continuationInstruction },
        ];

        // Try the SAME model first, then fallback to others
        const candidatesForContinuation = [activeModel, ...startupCandidates.filter((m) => m !== activeModel)];
        let contResult: { finishReason: string; segmentText: string } | null = null;

        for (const candidate of candidatesForContinuation) {
          if (!MODEL_IDS.has(candidate)) continue;
          try {
            contResult = await streamModelSegment(candidate, continuationMessages);
            activeModel = candidate;
            break;
          } catch (err) {
            if (err instanceof JobCancelledError) throw err;
            console.warn(`[chat-stream] continuation model failed (${candidate})`, err);
          }
        }

        if (!contResult) {
          console.warn("[chat-stream] No model available for continuation, stopping.");
          break;
        }

        // Commit continuation segment
        const contSplit = splitThinkProgress(contResult.segmentText);
        accumulatedAnswer += contSplit.answerText;
        if (contSplit.thinkingText) {
          accumulatedThinking += (accumulatedThinking ? "\n\n" : "") + contSplit.thinkingText;
        }
        lastFinishReason = contResult.finishReason;
      }

      const finalSplit = { thinkingText: accumulatedThinking.trim(), answerText: accumulatedAnswer.trim() };
      if (!usageInputs.length) {
        usageInputs.push({
          provider: "groq",
          model: activeModel || resolvedModel,
          inputTokens: Math.max(1, estimateTokensFromMessages(messagesForModel)),
          outputTokens: Math.max(1, estimateTokensFromText(finalSplit.answerText)),
          estimated: true,
        });
      }
      const billing = await settleReservedCredits({
        uid,
        requestId: billingRequestId,
        endpoint: "/api/chat-stream",
        reservedBrl: billingReserved,
        usageInputs,
      });
      billingReserved = 0;
      finishJob({
        jobId: processingJobId,
        status: "completed",
        billingSummary: {
          chargedBrl: billing.chargedBrl,
          balanceAfterBrl: billing.balanceAfterBrl,
        },
      });

      console.log(
        "[/api/chat-stream] knowledge:",
        JSON.stringify({
          docsUsed: knowledgeTelemetry.docsUsed,
          contextChars: knowledgeTelemetry.contextChars,
          summaryUsed: knowledgeTelemetry.summaryUsed,
          policy: knowledgeTelemetry.policy,
          latencyMs: Date.now() - requestStartedAt,
        }),
      );
      writeChunk({
        type: "done",
        model: clientModel,
        thinkingText: finalSplit.thinkingText,
        content: finalSplit.answerText,
        knowledge: knowledgeTelemetry,
        billing,
      });
      if (!res.writableEnded && !(res as any).destroyed) res.end();
    } catch (error: any) {
      if (error instanceof JobCancelledError) {
        let chargedBrl = 0;
        try {
          if (billingUid && billingReserved > 0 && billingRequestId) {
            if (usageInputs.length > 0) {
              const settled = await settleReservedCredits({
                uid: billingUid,
                requestId: billingRequestId,
                endpoint: "/api/chat-stream",
                reservedBrl: billingReserved,
                usageInputs,
              });
              chargedBrl = settled.chargedBrl;
              billingReserved = 0;
            } else {
              await refundReserve({
                uid: billingUid,
                requestId: billingRequestId,
                amountBrl: billingReserved,
                endpoint: "/api/chat-stream",
                reason: "cancel_requested_without_usage",
              });
              billingReserved = 0;
            }
            const cancelFloor = await applyCancelFloorDebit({
              uid: billingUid,
              requestId: billingRequestId,
              endpoint: "/api/chat-stream",
              chargedBrl,
            });
            finishJob({
              jobId: processingJobId,
              status: "cancelled",
              billingSummary: {
                chargedBrl,
                finalChargedBrl: cancelFloor.finalChargedBrl,
                floorDeltaBrl: cancelFloor.floorDeltaBrl,
                balanceAfterBrl: cancelFloor.balanceAfterBrl,
              },
            });
          } else {
            finishJob({ jobId: processingJobId, status: "cancelled" });
          }
        } catch (billingErr) {
          console.error("[/api/chat-stream] cancel billing error:", billingErr);
          finishJob({
            jobId: processingJobId,
            status: "failed",
            error: (billingErr as any)?.message || "cancel_billing_failed",
          });
        }
        writeChunk({
          type: "cancelled",
          message: "Cancelamento solicitado. Cobrança proporcional aplicada.",
        });
        if (!res.writableEnded && !(res as any).destroyed) res.end();
        return;
      }
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/chat-stream",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/chat-stream] falha no refund:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        finishJob({
          jobId: processingJobId,
          status: "failed",
          error: error.message,
        });
        if (!res.headersSent) {
          res.status(error.statusCode).json({ error: error.message, code: error.code });
        } else {
          writeChunk({ type: "error", error: error.message, code: error.code });
          if (!res.writableEnded && !(res as any).destroyed) res.end();
        }
        return;
      }
      console.error("Erro no /api/chat-stream:", error);
      finishJob({
        jobId: processingJobId,
        status: "failed",
        error: error?.message || "stream_failed",
      });
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Erro interno" });
      } else {
        if (!res.writableEnded && !(res as any).destroyed) res.end();
      }
    }
  });

  app.get("/api/admin/server/metrics", async (_req, res) => {
    try {
      const cpuInfo = os.cpus();
      const totalBytes = os.totalmem();
      const freeBytes = os.freemem();
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const cpuUsagePercent = await sampleCpuUsagePercent();
      const temperature = parseTemperatureReadings(runCommandText("sensors", []));

      res.json({
        ok: true,
        updatedAt: new Date().toISOString(),
        host: {
          hostname: os.hostname(),
          platform: os.platform(),
          release: os.release(),
          uptimeSec: os.uptime(),
        },
        cpu: {
          model: String(cpuInfo[0]?.model || "").trim(),
          cores: cpuInfo.length,
          loadAvg: os.loadavg().map((value) => Number(value.toFixed(2))),
          usagePercent: cpuUsagePercent,
        },
        memory: {
          totalBytes,
          usedBytes,
          freeBytes,
          usagePercent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0,
        },
        temperature,
        storage: parseStorageMetrics(),
        processes: parseProcesses(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao coletar metricas do servidor." });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/knowledge/health", (_req, res) => {
    res.json(knowledgeBase.getHealth());
  });

  app.get("/api/runtime/version", (_req, res) => {
    const aiRuntime = getSimcarAiRuntimeConfig();
    res.json({
      ok: true,
      ts: Date.now(),
      node: process.version,
      env: process.env.NODE_ENV || "development",
      hasChatStream: true,
      hasGeometryBbox: true,
      hasMapSnapshot: true,
      hasMapCapabilities: true,
      hasKnowledgeHealth: true,
      hasSimcarContextRehydrate: true,
      analysisMode: aiRuntime.analysisMode,
      visionModels: aiRuntime.visionModels,
      textModels: aiRuntime.textModels,
      synthesisTextModels: aiRuntime.synthesisTextModels,
      hasGroqKey: aiRuntime.hasGroqApiKey,
      hasCloudinaryKey: Boolean(process.env.CLOUDINARY_API_KEY),
      hasCloudinarySecret: Boolean(process.env.CLOUDINARY_API_SECRET),
    });
  });

  app.post("/api/upload-image", async (req, res) => {
    try {
      console.log("[/api/upload-image] request received");
      const uid = String(req.authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl inválido." });
        return;
      }
      const mimeType = match[1] || "image/png";
      const ext = mimeType.split("/")[1] || "png";
      const buffer = Buffer.from(match[2], "base64");
      const stored = saveUserBuffer({
        uid,
        area: "attachments/images",
        filename: `${Date.now()}_${filename || `image.${ext}`}`,
        buffer,
      });
      res.json({
        public_id: path.basename(stored.relativePath),
        secure_url: stored.publicUrl,
        width: null,
        height: null,
        format: ext,
        bytes: Math.max(1, estimateBytesFromDataUrl(dataUrl)),
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-image:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/upload-file", async (req, res) => {
    try {
      console.log("[/api/upload-file] request received");
      const uid = String(req.authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl de PDF invÃ¡lido." });
        return;
      }
      const mimeType = match[1] || "application/pdf";
      const base64Payload = match[2];
      const fileBuffer = Buffer.from(base64Payload, "base64");

      let extractedText = "";
      let pageCount = 0;
      try {
        const parsed = await parsePdfSafe(fileBuffer);
        if (parsed?.text) {
          extractedText = (parsed.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          pageCount = Number(parsed?.numpages || 0);
        }
      } catch (err) {
        console.warn("[/api/upload-file] failed to parse PDF text:", err);
      }
      const uploadFilename = filename && filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename || "documento"}.pdf`;
      const stored = saveUserBuffer({
        uid,
        area: "attachments/pdfs",
        filename: `${Date.now()}_${uploadFilename}`,
        buffer: fileBuffer,
      });
      const safeAttachmentName = String(filename || "arquivo.pdf").replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      const downloadUrl = stored.publicUrl;
      res.json({
        public_id: path.basename(stored.relativePath),
        secure_url: stored.publicUrl,
        download_url: downloadUrl,
        original_filename: safeAttachmentName,
        format: "pdf",
        bytes: Math.max(1, fileBuffer.length),
        pages: pageCount,
        extracted_text: extractedText.slice(0, 25000),
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-file:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.get("/api/file-proxy", async (req, res) => {
    try {
      const mode = String(req.query.mode || "inline");
      let remoteUrl = String(req.query.url || "").trim();
      const name = String(req.query.name || "arquivo.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      if (/^https?:\/\//i.test(remoteUrl)) {
        try {
          const parsed = new URL(remoteUrl);
          if (parsed.pathname.startsWith("/api/storage/")) {
            remoteUrl = `${parsed.pathname}${parsed.search}`;
          }
        } catch {
          remoteUrl = "";
        }
      }
      if (!remoteUrl || !remoteUrl.startsWith("/api/storage/")) {
        res.status(400).json({ error: "URL de arquivo inválida." });
        return;
      }
      res.redirect(
        mode === "download"
          ? `${remoteUrl}${remoteUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`
          : remoteUrl,
      );
    } catch (error: any) {
      console.error("Erro no /api/file-proxy:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");
  const adminStaticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "admin")
      : path.resolve(__dirname, "..", "dist", "admin");

  app.use("/assets", express.static(path.join(adminStaticPath, "assets")));
  app.use(express.static(staticPath));
  app.get(["/admin", "/admin/", "/admin/*"], (_req, res) => {
    res.sendFile(path.join(adminStaticPath, "admin.html"));
  });

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = PORT;

  server.listen(port, () => {
    logBackend("server_started", {
      port,
      node: process.version,
      env: process.env.NODE_ENV || "development",
      baseUrl: `http://localhost:${port}/`,
    });
  });

  const keepAliveUrl = process.env.KEEP_ALIVE_URL;
  const keepAliveInterval = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? "300000"); // 5 min
  if (keepAliveUrl) {
    const ping = async () => {
      try {
        const startedAt = Date.now();
        const res = await fetch(keepAliveUrl, { method: "GET" });
        if (!res.ok) {
          logBackend(
            "keep_alive_ping",
            {
              url: keepAliveUrl,
              status: res.status,
              statusText: res.statusText,
              durationMs: Date.now() - startedAt,
            },
            "warn",
          );
        } else {
          logBackend("keep_alive_ping", {
            url: keepAliveUrl,
            status: res.status,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (err) {
        logBackend(
          "keep_alive_ping",
          { url: keepAliveUrl, error: err instanceof Error ? err.message : String(err) },
          "warn",
        );
      }
    };

    logBackend("keep_alive_enabled", { url: keepAliveUrl, intervalMs: keepAliveInterval });
    ping().catch(() => undefined);
    setInterval(ping, keepAliveInterval).unref();
  } else {
    logBackend("keep_alive_disabled", { reason: "KEEP_ALIVE_URL not configured" }, "warn");
  }
}

startServer().catch(console.error);
