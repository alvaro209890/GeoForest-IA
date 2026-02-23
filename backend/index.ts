import express from "express";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import proj4 from "proj4";
import { inflateRawSync } from "zlib";
import { fileURLToPath } from "url";
import { registerWfsIntersectionRoutes } from "./wfs-intersection";
import { createKnowledgeBase } from "./knowledge-base";
import { requireAuth } from "./auth";
import {
  BillingError,
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
import { getSimcarGeminiRuntimeConfig, registerSimcarClipRoutes } from "./simcar-clip";
import { registerAuasRoutes } from "./auas-analysis";

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

async function attachOptionalAuth(req: any, _res: any, next: any) {
  try {
    const header = String(req?.headers?.authorization || "").trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (!token) {
      next();
      return;
    }
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUid = decoded.uid;
  } catch (error) {
    if (isFirebaseConfigError(error)) {
      console.warn("[AUTH] Firebase não configurado para auth opcional.");
    } else {
      console.warn("[AUTH] Token opcional inválido, seguindo sem auth.");
    }
  }
  next();
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const bootId = crypto.randomUUID();
  const renderInfo = {
    provider: process.env.RENDER ? "render" : "local",
    service: process.env.RENDER_SERVICE_NAME || null,
    instance: process.env.RENDER_INSTANCE_ID || null,
    region: process.env.RENDER_REGION || null,
    commit: process.env.RENDER_GIT_COMMIT || null,
  };
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

  app.use(express.json({ limit: "25mb" }));

  const isDevelopment = process.env.NODE_ENV !== "production";
  const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  const defaultCorsOrigins = [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:3000",
    "https://ia-florestal.web.app",
    "http://ia-florestal.web.app",
    "https://ia-florestal.firebaseapp.com",
    "http://ia-florestal.firebaseapp.com",
  ].map(normalizeOrigin);
  const corsOrigins = new Set(defaultCorsOrigins);
  const corsOriginRegex = [
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
    /^https?:\/\/ia-florestal\.web\.app$/i,
    /^https?:\/\/ia-florestal\.firebaseapp\.com$/i,
  ];
  const corsEnv = process.env.CORS_ORIGINS;
  if (corsEnv) {
    corsEnv
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .forEach((origin) => corsOrigins.add(normalizeOrigin(origin)));
  }
  const isOriginAllowed = (origin: string) => {
    if (!origin) return false;
    const normalized = normalizeOrigin(origin);
    if (corsOrigins.has(normalized)) return true;
    return corsOriginRegex.some((re) => re.test(normalized));
  };

  // CORS for browser clients
  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const originAllowed = isDevelopment || isOriginAllowed(origin);
    const requestedHeaders =
      typeof req.headers["access-control-request-headers"] === "string"
        ? req.headers["access-control-request-headers"]
        : "";

    if (isDevelopment) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        requestedHeaders || "Content-Type, Authorization, Accept, Origin",
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.status(originAllowed ? 204 : 403).end();
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const level =
        res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logBackend(
        "http_request",
        {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
          ip:
            String(req.headers["x-forwarded-for"] || "")
              .split(",")[0]
              .trim() || req.socket.remoteAddress || "",
          userAgent: String(req.headers["user-agent"] || ""),
          referer: String(req.headers.referer || ""),
        },
        level,
      );
    });
    next();
  });

  app.use(
    [
      "/api/chat",
      "/api/chat-stream",
      "/api/simcar/clip/import-vectorized",
      "/api/simcar/clip/analyze",
      "/api/simcar/clip/analyze-auas",
      "/api/simcar/clip/analyze/chat",
      "/api/auas/analyze",
      "/api/billing/me",
      "/api/billing/topups/manual",
      "/api/billing/ledger",
    ],
    requireAuth,
  );
  app.use(["/api/upload-image", "/api/upload-file"], attachOptionalAuth);

  registerWfsIntersectionRoutes(app);
  registerSimcarClipRoutes(app);
  registerAuasRoutes(app);

  const MODEL_CATALOG = [
    {
      id: "meta-llama/llama-3.3-70b-versatile",
      label: "Llama 3.3 70B",
      capabilities: ["text"],
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-guard-4-12b",
      label: "Llama Guard 4 12B",
      capabilities: ["text", "vision"],
    },
    {
      id: "qwen/qwen3-32b",
      label: "Qwen 3 32B",
      capabilities: ["text"],
    },
    {
      id: "moonshotai/kimi-k2-instruct-0905",
      label: "Kimi K2 Instruct (0905)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT-OSS 20B",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-120b",
      label: "GPT-OSS 120B",
      capabilities: ["text"],
    },
  ] as const;

  const MODEL_IDS = new Set<string>(MODEL_CATALOG.map((model) => model.id));
  const IMAGE_ANALYSIS_MODEL =
    process.env.IMAGE_ANALYSIS_MODEL || "openai/gpt-oss-120b";
  const IMAGE_ANALYSIS_FALLBACKS = (
    process.env.IMAGE_ANALYSIS_FALLBACKS ||
    "qwen/qwen3-32b,meta-llama/llama-4-maverick-17b-128e-instruct"
  )
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const knowledgeBase = createKnowledgeBase({
    dbRoot: path.resolve(__dirname, "..", "banco_de_dados"),
    zipPath: path.resolve(__dirname, "..", "banco_de_dados", "banco_de_dados_melhorado.zip"),
    summaryModel: process.env.DB_SUMMARY_MODEL || "openai/gpt-oss-20b",
    summaryMaxTokens: Number(process.env.DB_SUMMARY_MAX_TOKENS ?? "220"),
    summaryEnabled: String(process.env.DB_SUMMARY_ENABLED ?? "true") !== "false",
  });


  const SEMA_WMS_BASE =
    process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
  const SEMA_WMS_AUTHKEY =
    process.env.SEMA_WMS_AUTHKEY ||
    "541085de-9a2e-454e-bdba-eb3d57a2f492";
  const readPositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  };
  const MAP_CAPABILITIES_TTL_MS = readPositiveInt(
    process.env.MAP_CAPABILITIES_TTL_MS,
    5 * 60 * 1000,
  );
  const MAP_SNAPSHOT_TTL_MS = readPositiveInt(
    process.env.MAP_SNAPSHOT_TTL_MS,
    10 * 60 * 1000,
  );
  const MAP_SNAPSHOT_CACHE_MAX_ITEMS = readPositiveInt(
    process.env.MAP_SNAPSHOT_CACHE_MAX_ITEMS,
    40,
  );
  const CURATED_IMAGERY_LAYER_NAMES = [
    "SEMAMT:ALOS_PALSAR_DEM",
    "Geoportal:DECLIVIDADE_GEOPORTAL",
    "Mosaicos:LANDSAT_5_1984",
    "semamt:LANDSAT_5",
    "Mosaicos:LANDSAT_5_1985",
    "Mosaicos:LANDSAT_5_1986",
    "Mosaicos:LANDSAT_5_1987",
    "Mosaicos:LANDSAT_5_1988",
    "Mosaicos:LANDSAT_5_1989",
    "Mosaicos:LANDSAT_5_1990",
    "Mosaicos:LANDSAT_5_1991",
    "Mosaicos:LANDSAT_5_1992",
    "Mosaicos:LANDSAT_5_1993",
    "Mosaicos:LANDSAT_5_1994",
    "Mosaicos:LANDSAT_5_1995",
    "Mosaicos:LANDSAT_5_1996",
    "Mosaicos:LANDSAT_5_1997",
    "Mosaicos:LANDSAT_5_1998",
    "Mosaicos:LANDSAT_5_1999",
    "Mosaicos:LANDSAT_5_2000",
    "Mosaicos:LANDSAT_5_2003",
    "Mosaicos:LANDSAT_5_2004",
    "Mosaicos:LANDSAT_5_2005",
    "Mosaicos:LANDSAT_5_2006",
    "Mosaicos:LANDSAT_5_2007",
    "Mosaicos:LANDSAT_5_2008",
    "Mosaicos:LANDSAT_5_2009",
    "Mosaicos:LANDSAT_5_2010",
    "Mosaicos:LANDSAT_5_2011",
    "Mosaicos:LANDSAT_7_2002",
    "Mosaicos:LANDSAT_8_2013",
    "Mosaicos:LANDSAT_8_2014",
    "Mosaicos:LANDSAT_8_2015",
    "Mosaicos:LANDSAT_8_2016",
    "Mosaicos:LANDSAT_8_2017",
    "Mosaicos:MOSAICO_SPOT_SEPLAN",
    "Mosaicos:RESOURCESAT_2012",
    "Mosaicos:SENTINEL_2_2016",
    "Mosaicos:Geoportal_Sentinel_2_2016_NIR",
    "Mosaicos:SENTINEL_2_2017",
    "Mosaicos:Geoportal_Sentinel_2_2017_NIR",
    "Mosaicos:SENTINEL_2_2018",
    "Mosaicos:Geoportal_Sentinel_2_2018_NIR",
    "Mosaicos:SENTINEL_2_2019",
    "Mosaicos:SENTINEL_2_2020",
    "Mosaicos:Geoportal_Sentinel_2_2020_NIR",
    "Mosaicos:SENTINEL_2_2021",
    "Mosaicos:Geoportal_Sentinel_2_2021_NIR",
    "Mosaicos:SENTINEL_2_2022",
    "Mosaicos:SENTINEL_2_2023",
    "Mosaicos:SENTINEL_2_2024",
  ] as const;
  const CURATED_IMAGERY_ORDER_MAP = new Map<string, number>();
  for (const name of CURATED_IMAGERY_LAYER_NAMES) {
    const key = name.toLowerCase();
    if (!CURATED_IMAGERY_ORDER_MAP.has(key)) {
      CURATED_IMAGERY_ORDER_MAP.set(key, CURATED_IMAGERY_ORDER_MAP.size);
    }
  }

  const parseLayersFromCapabilities = (xml: string) => {
    type Node = {
      name?: string;
      title?: string;
      crs: string[];
      children: number;
    };
    const tokenRegex =
      /<Layer\b[^>]*>|<\/Layer>|<Style\b[^>]*>|<\/Style>|<Name>\s*([^<]+)\s*<\/Name>|<Title>\s*([^<]+)\s*<\/Title>|<(?:CRS|SRS)>\s*([^<]+)\s*<\/(?:CRS|SRS)>/gi;
    const stack: Node[] = [];
    let insideStyle = 0;
    const out: Array<{
      name: string;
      title: string;
      crs: string[];
      inferredYear?: string;
      group: "spot" | "landsat" | "sentinel" | "other";
      isLeaf: boolean;
      isRenderable: boolean;
      year?: number;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(xml)) !== null) {
      const token = match[0];
      if (/^<Style\b/i.test(token)) {
        insideStyle += 1;
        continue;
      }
      if (/^<\/Style>/i.test(token)) {
        insideStyle = Math.max(0, insideStyle - 1);
        continue;
      }
      if (insideStyle > 0) continue; // skip everything inside <Style>

      if (/^<Layer\b/i.test(token)) {
        const parent = stack[stack.length - 1];
        if (parent) parent.children += 1;
        stack.push({
          crs: parent ? [...parent.crs] : [],
          children: 0,
        });
        continue;
      }
      if (/^<\/Layer>/i.test(token)) {
        const node = stack.pop();
        if (!node || !node.name) continue;
        const name = node.name.trim();
        if (!name) continue;
        const title = (node.title || name).trim();
        const combined = `${name} ${title}`.toLowerCase();
        const yearMatch = combined.match(/\b(19|20)\d{2}\b/);
        const inferredYear = yearMatch?.[0];
        const year = inferredYear ? Number(inferredYear) : undefined;
        const group = /spot/.test(combined)
          ? "spot"
          : /landsat/.test(combined)
            ? "landsat"
            : /sentinel/.test(combined)
              ? "sentinel"
              : "other";
        const isLeaf = node.children === 0;
        const isRenderable = !!name.includes(":");
        out.push({
          name,
          title,
          crs: node.crs,
          inferredYear,
          group,
          isLeaf,
          isRenderable,
          year,
        });
        continue;
      }
      const current = stack[stack.length - 1];
      if (!current) continue;
      if (match[1]) {
        // Only set name on FIRST <Name> encounter (layer name, not style name)
        if (!current.name) current.name = String(match[1] || "").trim();
      } else if (match[2]) {
        if (!current.title) current.title = String(match[2] || "").trim();
      } else if (match[3]) {
        const code = String(match[3] || "").trim();
        if (code && !current.crs.includes(code)) current.crs.push(code);
      }
    }

    const uniq = new Map<string, (typeof out)[number]>();
    for (const item of out) {
      if (!uniq.has(item.name)) uniq.set(item.name, item);
    }
    return [...uniq.values()];
  };

  const toImageryLayers = (
    layers: ReturnType<typeof parseLayersFromCapabilities>
  ) => {
    const workspaceRank = (name: string) => {
      const ws = name.split(":")[0]?.toLowerCase() || "";
      if (ws === "semamt") return 0;
      if (ws === "geoportal") return 1;
      if (ws === "mosaicos") return 2;
      return 3;
    };

    return layers
      .filter((l) => l.isRenderable)
      .filter((l) => {
        const low = l.name.toLowerCase();
        const txt = `${l.name} ${l.title}`.toLowerCase();
        const hasKnownWorkspace =
          low.startsWith("mosaicos:") || low.startsWith("semamt:") || low.startsWith("geoportal:");
        if (!hasKnownWorkspace) return false;
        return /(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
      })
      .sort((a, b) => {
        const aOrder = CURATED_IMAGERY_ORDER_MAP.get(a.name.toLowerCase());
        const bOrder = CURATED_IMAGERY_ORDER_MAP.get(b.name.toLowerCase());
        if (aOrder !== undefined || bOrder !== undefined) {
          if (aOrder === undefined) return 1;
          if (bOrder === undefined) return -1;
          if (aOrder !== bOrder) return aOrder - bOrder;
        }

        const ws = workspaceRank(a.name) - workspaceRank(b.name);
        if (ws !== 0) return ws;

        const score = (x: (typeof layers)[number]) => {
          let s = 0;
          if (x.name === "Mosaicos:LANDSAT_5_2008") s += 1000;
          if (x.group === "landsat") s += 120;
          if (x.group === "spot") s += 100;
          if (x.group === "sentinel") s += 80;
          if (x.year === 2008) s += 400;
          if (x.year) s += Math.max(0, 2100 - x.year);
          return s;
        };
        return score(b) - score(a) || a.name.localeCompare(b.name);
      });
  };

  const toShapeLayers = (layers: ReturnType<typeof parseLayersFromCapabilities>) => {
    return layers
      .filter((l) => l.isRenderable)
      .filter((l) => !l.name.toLowerCase().startsWith("mosaicos:"))
      .filter((l) => {
        const txt = `${l.name} ${l.title}`.toLowerCase();
        return !/(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const toSimcarDigitalLayers = (layers: ReturnType<typeof parseLayersFromCapabilities>) => {
    return layers
      .filter((l) => l.isRenderable)
      .filter((l) => {
        const low = l.name.toLowerCase();
        return (
          low.startsWith("geoportal:simcar_") ||
          low.startsWith("geoportal:car_")
        );
      })
      .map((l) => ({
        name: l.name,
        title: l.title,
        crs: l.crs,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  };

  let cachedPdfParser: null | ((buffer: Buffer) => Promise<any>) = null;
  const getPdfParser = async () => {
    if (cachedPdfParser) return cachedPdfParser;
    try {
      const mod: any = await import("pdf-parse");
      const parser = (mod?.default || mod) as (buffer: Buffer) => Promise<any>;
      if (typeof parser === "function") {
        cachedPdfParser = parser;
        return cachedPdfParser;
      }
      return null;
    } catch {
      return null;
    }
  };

  const parsePdfSafe = async (buffer: Buffer) => {
    const parser = await getPdfParser();
    if (!parser) return null;
    try {
      return await parser(buffer);
    } catch {
      return null;
    }
  };

  type MapCapabilitiesPayload = {
    serviceTitle: string;
    layers: Array<{
      name: string;
      title: string;
      crs: string[];
      inferredYear?: string;
      group: "spot" | "landsat" | "sentinel" | "other";
    }>;
    imageLayers: Array<{
      name: string;
      title: string;
      crs: string[];
      inferredYear?: string;
      group: "spot" | "landsat" | "sentinel" | "other";
    }>;
    shapeLayers: Array<{
      name: string;
      title: string;
      crs: string[];
    }>;
    simcarDigitalLayers: Array<{
      name: string;
      title: string;
      crs: string[];
    }>;
    defaultLayer?: string;
    recommended: {
      legalMarco2008: string;
    };
  };
  type MapCapabilitiesCacheEntry = {
    expiresAt: number;
    xml: string;
    payload?: MapCapabilitiesPayload;
    allowedLayerNames?: Set<string>;
  };
  type MapSnapshotPayload = {
    dataUrl: string;
    mimeType: string;
    sourceUrl: string;
    mapContext: {
      layerName: string;
      bbox: [number, number, number, number];
      crs: string;
      width: number;
      height: number;
      source: "SEMA_WMS";
    };
  };
  let mapCapabilitiesCache: MapCapabilitiesCacheEntry | null = null;
  const mapSnapshotCache = new Map<string, { expiresAt: number; payload: MapSnapshotPayload }>();

  const pruneMapSnapshotCache = () => {
    const now = Date.now();
    for (const [key, entry] of mapSnapshotCache.entries()) {
      if (entry.expiresAt <= now) {
        mapSnapshotCache.delete(key);
      }
    }
    while (mapSnapshotCache.size > MAP_SNAPSHOT_CACHE_MAX_ITEMS) {
      const oldestKey = mapSnapshotCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      mapSnapshotCache.delete(oldestKey);
    }
  };

  const getCachedMapSnapshot = (cacheKey: string): MapSnapshotPayload | null => {
    const cached = mapSnapshotCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      mapSnapshotCache.delete(cacheKey);
      return null;
    }
    mapSnapshotCache.delete(cacheKey);
    mapSnapshotCache.set(cacheKey, cached);
    return cached.payload;
  };

  const storeMapSnapshot = (cacheKey: string, payload: MapSnapshotPayload) => {
    pruneMapSnapshotCache();
    if (mapSnapshotCache.has(cacheKey)) {
      mapSnapshotCache.delete(cacheKey);
    }
    mapSnapshotCache.set(cacheKey, {
      expiresAt: Date.now() + MAP_SNAPSHOT_TTL_MS,
      payload,
    });
    pruneMapSnapshotCache();
  };

  const fetchSemamtCapabilitiesXml = async () => {
    if (mapCapabilitiesCache && mapCapabilitiesCache.expiresAt > Date.now()) {
      return mapCapabilitiesCache.xml;
    }

    const capUrl = new URL(SEMA_WMS_BASE);
    capUrl.searchParams.set("service", "WMS");
    capUrl.searchParams.set("request", "GetCapabilities");
    capUrl.searchParams.set("version", "1.3.0");
    if (SEMA_WMS_AUTHKEY) {
      capUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
    }

    const finalUrl = capUrl.toString();
    console.log("[WMS] Fetching capabilities from:", finalUrl.replace(SEMA_WMS_AUTHKEY, "***"));
    const t0 = Date.now();

    let response: Response;
    try {
      response = await fetch(finalUrl);
    } catch (fetchErr: any) {
      console.error("[WMS] Network error fetching capabilities:", fetchErr?.message || fetchErr);
      throw new Error(`Erro de rede ao buscar capabilities: ${fetchErr?.message}`);
    }

    const elapsed = Date.now() - t0;
    console.log(`[WMS] Capabilities response: status=${response.status}, time=${elapsed}ms`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[WMS] Capabilities HTTP error ${response.status}:`, text.slice(0, 300));
      throw new Error(
        `Falha ao carregar capabilities da SEMA (${response.status}): ${text.slice(0, 220)}`
      );
    }

    const xml = await response.text();
    console.log(`[WMS] Capabilities XML received: ${xml.length} chars`);
    mapCapabilitiesCache = {
      expiresAt: Date.now() + MAP_CAPABILITIES_TTL_MS,
      xml,
    };
    return xml;
  };

  const getMapCapabilitiesData = async () => {
    if (
      mapCapabilitiesCache &&
      mapCapabilitiesCache.expiresAt > Date.now() &&
      mapCapabilitiesCache.payload &&
      mapCapabilitiesCache.allowedLayerNames
    ) {
      return mapCapabilitiesCache;
    }

    const xml = await fetchSemamtCapabilitiesXml();
    const parsed = parseLayersFromCapabilities(xml);
    console.log(`[API] Capabilities parsed: ${parsed.length} layers total`);

    const parsedImagery = toImageryLayers(parsed).map((l) => ({
      name: l.name,
      title: l.title,
      crs: l.crs,
      inferredYear: l.inferredYear,
      group: l.group,
    }));
    console.log(`[API] Imagery layers: ${parsedImagery.length}`);

    const byLowerName = new Map(parsedImagery.map((l) => [l.name.toLowerCase(), l]));
    const curatedImagery = CURATED_IMAGERY_LAYER_NAMES.map((name) => {
      const existing = byLowerName.get(name.toLowerCase());
      if (existing) return existing;
      return {
        name,
        title: name.split(":")[1] || name,
        crs: ["EPSG:4326"],
        inferredYear: String(name.match(/\b(19|20)\d{2}\b/)?.[0] || ""),
        group: /landsat/i.test(name)
          ? ("landsat" as const)
          : /spot/i.test(name)
            ? ("spot" as const)
            : /sentinel/i.test(name)
              ? ("sentinel" as const)
              : ("other" as const),
      };
    });
    const imagery = [...curatedImagery];
    for (const layer of parsedImagery) {
      if (!CURATED_IMAGERY_ORDER_MAP.has(layer.name.toLowerCase())) {
        imagery.push(layer);
      }
    }
    console.log(`[API] Final imagery count: ${imagery.length}`);

    const shapeLayers = toShapeLayers(parsed).map((l) => ({
      name: l.name,
      title: l.title,
      crs: l.crs,
    }));
    console.log(`[API] Shape layers: ${shapeLayers.length}`);

    const simcarDigitalLayers = toSimcarDigitalLayers(parsed);
    console.log(
      `[API] SIMCAR Digital layers: ${simcarDigitalLayers.length}`,
      simcarDigitalLayers.map((l) => l.name),
    );

    const defaultLayer =
      imagery.find((l) => l.name === "Mosaicos:LANDSAT_5_2008")?.name ||
      imagery.find((l) => l.group === "landsat")?.name ||
      imagery.find((l) => l.group === "spot")?.name ||
      imagery.find((l) => l.group === "sentinel")?.name ||
      imagery[0]?.name;

    const payload: MapCapabilitiesPayload = {
      serviceTitle: "SEMA WMS",
      layers: imagery,
      imageLayers: imagery,
      shapeLayers,
      simcarDigitalLayers,
      defaultLayer,
      recommended: {
        legalMarco2008: "Mosaicos:LANDSAT_5_2008",
      },
    };

    const allowedLayerNames = new Set<string>([
      ...imagery.map((l) => l.name.toLowerCase()),
      ...CURATED_IMAGERY_LAYER_NAMES.map((l) => l.toLowerCase()),
      ...simcarDigitalLayers.map((l) => l.name.toLowerCase()),
    ]);

    mapCapabilitiesCache = {
      expiresAt: Date.now() + MAP_CAPABILITIES_TTL_MS,
      xml,
      payload,
      allowedLayerNames,
    };
    return mapCapabilitiesCache;
  };

  const fetchSemamtImageryLayers = async () => {
    const capabilities = await getMapCapabilitiesData();
    return capabilities.payload?.imageLayers || [];
  };

  const decodeDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("dataUrl invÃ¡lido.");
    const mimeType = match[1] || "application/octet-stream";
    const payload = match[2];
    return { mimeType, buffer: Buffer.from(payload, "base64") };
  };

  const parseKmlBbox = (kml: string) => {
    const coordBlocks = [...kml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    if (!coordBlocks.length) {
      throw new Error("KML sem bloco <coordinates>.");
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const block of coordBlocks) {
      const raw = String(block[1] || "").trim();
      if (!raw) continue;
      const tuples = raw.split(/\s+/);
      for (const t of tuples) {
        const [xStr, yStr] = t.split(",");
        const x = Number(xStr);
        const y = Number(yStr);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      throw new Error("NÃ£o foi possÃ­vel extrair coordenadas vÃ¡lidas do KML.");
    }
    return [minX, minY, maxX, maxY] as [number, number, number, number];
  };

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



  app.get("/api/models", (_req, res) => {
    const defaultModel = process.env.GROQ_MODEL || "meta-llama/llama-3.3-70b-versatile";
    res.json({ models: MODEL_CATALOG, defaultModel });
  });

  app.get("/api/billing/pricing", async (_req, res) => {
    try {
      const pricing = await getBillingPricingSnapshot();
      res.json(pricing);
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/pricing:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar pricing." });
    }
  });

  app.get("/api/billing/me", async (req, res) => {
    try {
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const payload = await getBillingMe(uid);
      res.json(payload);
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/me:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar carteira." });
    }
  });

  app.post("/api/billing/topups/manual", async (req, res) => {
    try {
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const amountBrl = Number(req.body?.amountBrl);
      const idempotencyKey = String(req.body?.idempotencyKey || "");
      const topup = await createManualTopup({ uid, amountBrl, idempotencyKey });
      let wallet: Awaited<ReturnType<typeof getBillingMe>> | null = null;
      try {
        wallet = await getBillingMe(uid);
      } catch (walletErr: any) {
        const msg = String(walletErr?.message || walletErr || "");
        // Não bloquear recarga por falha secundária de leitura de analytics/usage.
        if (/FAILED_PRECONDITION/i.test(msg) && /requires an index/i.test(msg)) {
          console.warn(
            "[BILLING] getBillingMe falhou por índice após top-up; retornando carteira mínima.",
            walletErr,
          );
        } else if (isFirebaseConfigError(walletErr)) {
          console.warn("[BILLING] getBillingMe falhou por config Firebase após top-up.", walletErr);
        } else {
          throw walletErr;
        }
      }
      res.json({
        ok: true,
        topup,
        wallet: wallet?.wallet || {
          balanceBrl: Number(topup.balanceAfterBrl || 0),
          totalTopupBrl: null,
          totalSpentBrl: null,
          updatedAt: null,
          version: null,
        },
      });
    } catch (error: any) {
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/topups/manual:", error);
      res.status(500).json({ error: error?.message || "Erro ao adicionar créditos." });
    }
  });

  app.get("/api/billing/ledger", async (req, res) => {
    try {
      const uid = String(req.authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const limit = Number(req.query?.limit || 50);
      const entries = await getBillingLedger(uid, limit);
      res.json({ entries });
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/ledger:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar extrato." });
    }
  });

  app.get("/api/map/capabilities", async (_req, res) => {
    try {
      console.log("[API] GET /api/map/capabilities â€” iniciando...");
      const capabilities = await getMapCapabilitiesData();
      const payload = capabilities.payload;
      if (!payload) {
        throw new Error("Falha ao montar payload de capabilities.");
      }
      console.log(`[API] Default layer: ${payload.defaultLayer}`);
      console.log("[API] GET /api/map/capabilities â€” sucesso");
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(payload);
    } catch (error: any) {
      console.error("Erro no /api/map/capabilities:", error?.message || error);
      console.error("Stack:", error?.stack);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/map/snapshot", requireAuth, async (req, res) => {
    try {
      const {
        layerName,
        overlayLayers = [],
        bbox,
        crs = "EPSG:4326",
        width = 1200,
        height = 800,
        format = "image/png",
      } = req.body as {
        layerName?: string;
        overlayLayers?: string[];
        bbox?: [number, number, number, number];
        crs?: string;
        width?: number;
        height?: number;
        format?: "image/png" | "image/jpeg";
      };

      console.log(`[API] POST /api/map/snapshot â€” layer=${layerName}, bbox=${JSON.stringify(bbox)}, overlays=${JSON.stringify(overlayLayers)}, size=${width}x${height}`);

      if (!layerName || !bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        res.status(400).json({ error: "ParÃ¢metros invÃ¡lidos para snapshot de mapa." });
        return;
      }

      const [minX, minY, maxX, maxY] = bbox.map(Number);
      if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
        res.status(400).json({ error: "BBox invÃ¡lida." });
        return;
      }

      const safeWidth = Math.max(256, Math.min(4096, Math.floor(Number(width) || 1200)));
      const safeHeight = Math.max(256, Math.min(4096, Math.floor(Number(height) || 800)));
      const safeFormat = format === "image/jpeg" ? "image/jpeg" : "image/png";
      const safeCrs = typeof crs === "string" && crs.trim().length ? crs.trim() : "EPSG:4326";
      const normalizedLayerName = String(layerName);
      const safeOverlayLayers = Array.isArray(overlayLayers)
        ? [...new Set(overlayLayers.map((x) => String(x).trim()).filter((x) => x.length > 0))].slice(
          0,
          8,
        )
        : [];
      const snapshotCacheKey = [
        normalizedLayerName,
        safeOverlayLayers.join(","),
        `${minX},${minY},${maxX},${maxY}`,
        safeCrs,
        `${safeWidth}x${safeHeight}`,
        safeFormat,
      ].join("|");
      const cachedSnapshot = getCachedMapSnapshot(snapshotCacheKey);
      if (cachedSnapshot) {
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("x-map-cache", "hit");
        res.json(cachedSnapshot);
        return;
      }

      let capabilities: Awaited<ReturnType<typeof getMapCapabilitiesData>> | null = null;
      try {
        capabilities = await getMapCapabilitiesData();
      } catch (capErr) {
        console.warn("[/api/map/snapshot] capabilities check failed:", capErr);
      }
      if (
        capabilities?.allowedLayerNames &&
        !capabilities.allowedLayerNames.has(normalizedLayerName.toLowerCase())
      ) {
        res.status(400).json({
          error: `Layer '${normalizedLayerName}' nÃ£o Ã© uma camada disponÃ­vel.`,
          availableLayers: capabilities.payload?.imageLayers.slice(0, 50).map((l) => l.name) || [],
        });
        return;
      }

      const mapUrl = new URL(SEMA_WMS_BASE);
      mapUrl.searchParams.set("service", "WMS");
      mapUrl.searchParams.set("request", "GetMap");
      mapUrl.searchParams.set("version", "1.1.1");
      const allLayers = [normalizedLayerName, ...safeOverlayLayers];
      mapUrl.searchParams.set("layers", allLayers.join(","));
      mapUrl.searchParams.set("styles", new Array(allLayers.length).fill("").join(","));
      mapUrl.searchParams.set("format", safeFormat);
      mapUrl.searchParams.set("transparent", "false");
      mapUrl.searchParams.set("srs", safeCrs);
      mapUrl.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY}`);
      mapUrl.searchParams.set("width", String(safeWidth));
      mapUrl.searchParams.set("height", String(safeHeight));
      if (SEMA_WMS_AUTHKEY) {
        mapUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
      }

      const response = await fetch(mapUrl.toString());
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({
          error: "Falha ao obter imagem WMS da SEMA.",
          details: text.slice(0, 500),
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (!contentType.includes("image")) {
        const text = await response.text();
        const layerNotDefined = /LayerNotDefined|Could not find layer/i.test(text);
        if (layerNotDefined) {
          const available =
            capabilities?.payload?.imageLayers.slice(0, 50).map((l) => l.name) || [];
          res.status(400).json({
            error: `Layer '${normalizedLayerName}' nÃ£o existe no WMS da SEMA.`,
            availableLayers: available,
          });
          return;
        }
        res.status(502).json({
          error: "Resposta do WMS nÃ£o retornou imagem.",
          details: text.slice(0, 500),
        });
        return;
      }

      const arr = await response.arrayBuffer();
      const base64 = Buffer.from(arr).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;
      const payload: MapSnapshotPayload = {
        dataUrl,
        mimeType: contentType,
        sourceUrl: mapUrl.toString(),
        mapContext: {
          layerName: normalizedLayerName,
          bbox: [minX, minY, maxX, maxY],
          crs: safeCrs,
          width: safeWidth,
          height: safeHeight,
          source: "SEMA_WMS",
        },
      };
      storeMapSnapshot(snapshotCacheKey, payload);

      // Cobrar pelo processamento de mapa em background para não travar a UI
      if (req.authUid) {
        chargeMapSnapshot({
          uid: req.authUid,
          requestId: createRequestId("mapsnap"),
          endpoint: "/api/map/snapshot",
          feeBrl: 0.05
        }).catch(err => console.warn("[BILLING] Erro ao cobrar snapshot de mapa do usuário", req.authUid, err));
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("x-map-cache", "miss");
      res.json(payload);
    } catch (error: any) {
      console.error("Erro no /api/map/snapshot:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/geometry/bbox", async (req, res) => {
    try {
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl Ã© obrigatÃ³rio." });
        return;
      }
      const name = String(filename || "").toLowerCase();
      const { mimeType, buffer } = decodeDataUrl(dataUrl);

      if (name.endsWith(".kml") || mimeType.includes("kml") || mimeType.includes("xml")) {
        const text = buffer.toString("utf8");
        const bbox = parseKmlBbox(text);
        res.json({ bbox, crs: "EPSG:4326", source: "kml" });
        return;
      }

      if (name.endsWith(".zip") || mimeType.includes("zip")) {
        const entries = extractZipEntries(buffer);
        const shp = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
        const prj = entries.find((e) => e.name.toLowerCase().endsWith(".prj"));
        if (!shp) {
          const kmlInside = entries.find((e) => e.name.toLowerCase().endsWith(".kml"));
          if (kmlInside) {
            const bbox = parseKmlBbox(kmlInside.data.toString("utf8"));
            res.json({ bbox, crs: "EPSG:4326", source: "kml_zip" });
            return;
          }
          res.status(400).json({ error: "ZIP sem .shp ou .kml." });
          return;
        }
        if (shp.data.length < 100) {
          res.status(400).json({ error: "Arquivo .shp invÃ¡lido." });
          return;
        }
        // Shapefile main header bbox (bytes 36..67 little endian)
        const minX = shp.data.readDoubleLE(36);
        const minY = shp.data.readDoubleLE(44);
        const maxX = shp.data.readDoubleLE(52);
        const maxY = shp.data.readDoubleLE(60);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          res.status(400).json({ error: "NÃ£o foi possÃ­vel extrair bbox do shapefile." });
          return;
        }
        const polygon = parseShapefileFirstPolygon(shp.data) || undefined;
        let bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
        let polygonOut = polygon;
        let crs = "EPSG:4326";
        if (!isLatLonBbox(bbox) && prj?.data) {
          const projDef = detectUtmProj(prj.data.toString("utf8"));
          if (projDef) {
            bbox = reprojectBbox(bbox, projDef);
            if (polygonOut) {
              polygonOut = reprojectPolygon(polygonOut, projDef);
            }
            crs = "EPSG:4326";
          }
        }
        res.json({
          bbox,
          polygon: polygonOut,
          crs,
          source: "shapefile_zip_header",
        });
        return;
      }

      res.status(400).json({ error: "Formato nÃ£o suportado. Envie .kml ou .zip (shapefile)." });
    } catch (error: any) {
      console.error("Erro no /api/geometry/bbox:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

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

      const writeChunk = (payload: Record<string, any>) => {
        res.write(`${JSON.stringify(payload)}\n`);
      };

      const usageInputs: Array<{
        provider: "groq";
        model: string;
        inputTokens: number;
        outputTokens: number;
        estimated: boolean;
      }> = [];

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
        let segmentRaw = "";

        while (true) {
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
              usageInputs.push({
                provider: "groq",
                model: segmentModel,
                inputTokens: Math.max(1, segmentInputTokens),
                outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
                estimated: true,
              });
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

        usageInputs.push({
          provider: "groq",
          model: segmentModel,
          inputTokens: Math.max(1, segmentInputTokens),
          outputTokens: Math.max(1, estimateTokensFromText(segmentRaw)),
          estimated: true,
        });
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
      res.write(
        `${JSON.stringify({
          type: "done",
          model: clientModel,
          thinkingText: finalSplit.thinkingText,
          content: finalSplit.answerText,
          knowledge: knowledgeTelemetry,
          billing,
        })}\n`
      );
      res.end();
    } catch (error: any) {
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
        if (!res.headersSent) {
          res.status(error.statusCode).json({ error: error.message, code: error.code });
        } else {
          res.write(`${JSON.stringify({ type: "error", error: error.message, code: error.code })}\n`);
          res.end();
        }
        return;
      }
      console.error("Erro no /api/chat-stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Erro interno" });
      } else {
        res.end();
      }
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/knowledge/health", (_req, res) => {
    res.json(knowledgeBase.getHealth());
  });

  app.get("/api/runtime/version", (_req, res) => {
    const geminiRuntime = getSimcarGeminiRuntimeConfig();
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
      hasGeminiKey: geminiRuntime.hasGeminiApiKey,
      requireGemini: geminiRuntime.requireGemini,
      geminiApiBase: geminiRuntime.geminiApiBase,
      geminiImageShare: geminiRuntime.geminiImageShare,
      geminiVisionModels: geminiRuntime.geminiVisionModels,
      geminiTextSynthesisModels: geminiRuntime.geminiTextSynthesisModels,
      hasGroqKey: Boolean(process.env.GROQ_API_KEY),
      hasCloudinaryKey: Boolean(process.env.CLOUDINARY_API_KEY),
      hasCloudinarySecret: Boolean(process.env.CLOUDINARY_API_SECRET),
    });
  });

  app.post("/api/upload-image", async (req, res) => {
    let billingUid = "";
    let billingRequestId = "";
    let billingReserved = 0;
    try {
      console.log("[/api/upload-image] request received");
      const uid = String(req.authUid || "");
      const billingEnabled = Boolean(uid);
      billingUid = uid;
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-image] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary nÃ£o configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-image] dataUrl missing");
        res.status(400).json({ error: "dataUrl Ã© obrigatÃ³rio." });
        return;
      }

      billingRequestId = createRequestId("cloudinary_img");
      const estimatedBytes = Math.max(1, estimateBytesFromDataUrl(dataUrl));
      if (billingEnabled) {
        billingReserved = await estimateCloudinaryStorageReserve({
          bytesStored: estimatedBytes,
          safetyMultiplier: 1.12,
        });
        if (billingReserved > 0) {
          await reserveCredits({
            uid,
            amountBrl: billingReserved,
            requestId: billingRequestId,
            endpoint: "/api/upload-image",
          });
        }
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      form.append("file", dataUrl);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-image] cloudinary error:", response.status, text);
        if (billingReserved > 0) {
          await refundReserve({
            uid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/upload-image",
            reason: "cloudinary_upload_failed",
          });
          billingReserved = 0;
        }
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      const bytesStored = Math.max(1, Number(data?.bytes || estimatedBytes));
      let billing: Awaited<ReturnType<typeof settleCloudinaryStorageReserve>> | null = null;
      if (billingEnabled && billingReserved > 0) {
        billing = await settleCloudinaryStorageReserve({
          uid,
          requestId: billingRequestId,
          endpoint: "/api/upload-image",
          reservedBrl: billingReserved,
          bytesStored,
          assetKind: "chat_image",
        });
        billingReserved = 0;
      }

      console.log("[/api/upload-image] success:", data?.public_id);
      res.json({
        public_id: data.public_id,
        secure_url: data.secure_url,
        width: data.width,
        height: data.height,
        format: data.format,
        bytes: bytesStored,
        billing: billing || undefined,
      });
    } catch (error: any) {
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/upload-image",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/upload-image] refund error:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error("Erro no /api/upload-image:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/upload-file", async (req, res) => {
    let billingUid = "";
    let billingRequestId = "";
    let billingReserved = 0;
    try {
      console.log("[/api/upload-file] request received");
      const uid = String(req.authUid || "");
      const billingEnabled = Boolean(uid);
      billingUid = uid;
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-file] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary nÃ£o configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-file] dataUrl missing");
        res.status(400).json({ error: "dataUrl Ã© obrigatÃ³rio." });
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

      billingRequestId = createRequestId("cloudinary_file");
      if (billingEnabled) {
        billingReserved = await estimateCloudinaryStorageReserve({
          bytesStored: Math.max(1, fileBuffer.length),
          safetyMultiplier: 1.12,
        });
        if (billingReserved > 0) {
          await reserveCredits({
            uid,
            amountBrl: billingReserved,
            requestId: billingRequestId,
            endpoint: "/api/upload-file",
          });
        }
      }

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

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      const blob = new Blob([fileBuffer], { type: mimeType });
      const uploadFilename = filename && filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename || "documento"}.pdf`;
      form.append("file", blob, uploadFilename);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      form.append("resource_type", "raw");
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-file] cloudinary error:", response.status, text);
        if (billingReserved > 0) {
          await refundReserve({
            uid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/upload-file",
            reason: "cloudinary_upload_failed",
          });
          billingReserved = 0;
        }
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      const bytesStored = Math.max(1, Number(data?.bytes || fileBuffer.length));
      let billing: Awaited<ReturnType<typeof settleCloudinaryStorageReserve>> | null = null;
      if (billingEnabled && billingReserved > 0) {
        billing = await settleCloudinaryStorageReserve({
          uid,
          requestId: billingRequestId,
          endpoint: "/api/upload-file",
          reservedBrl: billingReserved,
          bytesStored,
          assetKind: "chat_file",
        });
        billingReserved = 0;
      }

      console.log("[/api/upload-file] success:", data?.public_id);
      const secureUrl = String(data?.secure_url || "");
      const fallbackExt = String(data?.format || "pdf").toLowerCase();
      const safeAttachmentName = String(filename || `arquivo.${fallbackExt}`).replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      const downloadUrl = secureUrl.includes("/upload/")
        ? secureUrl.replace(
          "/upload/",
          `/upload/fl_attachment:${encodeURIComponent(safeAttachmentName)}/`
        )
        : secureUrl;
      res.json({
        public_id: data.public_id,
        secure_url: secureUrl,
        download_url: downloadUrl,
        original_filename: safeAttachmentName,
        format: data.format,
        bytes: bytesStored,
        pages: pageCount,
        extracted_text: extractedText.slice(0, 25000),
        billing: billing || undefined,
      });
    } catch (error: any) {
      if (billingUid && billingReserved > 0 && billingRequestId) {
        try {
          await refundReserve({
            uid: billingUid,
            requestId: billingRequestId,
            amountBrl: billingReserved,
            endpoint: "/api/upload-file",
            reason: "exception",
          });
        } catch (refundErr) {
          console.error("[/api/upload-file] refund error:", refundErr);
        }
      }
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      console.error("Erro no /api/upload-file:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.get("/api/file-proxy", async (req, res) => {
    try {
      const mode = String(req.query.mode || "inline");
      const remoteUrl = String(req.query.url || "");
      const name = String(req.query.name || "arquivo.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

      if (!remoteUrl || !remoteUrl.startsWith("https://res.cloudinary.com/da19dwpgk/")) {
        res.status(400).json({ error: "URL de arquivo invÃ¡lida." });
        return;
      }

      const upstream = await fetch(remoteUrl);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        res.status(upstream.status || 502).send(text || "Falha ao obter arquivo.");
        return;
      }

      const isAttachment = mode === "download";
      const contentType = name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `${isAttachment ? "attachment" : "inline"}; filename="${name}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
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

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port =
    process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001);

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
