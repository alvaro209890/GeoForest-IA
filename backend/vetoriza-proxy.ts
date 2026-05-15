import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { extractBearerToken, requireAuth } from "./auth";
import { adminAuth } from "./firebase-admin";

type VetorizaSession = {
  cookie: string;
  expiresAt: number;
};

type VetorizaCredentials = {
  nome: string;
  email: string;
  senha: string;
};

const VETORIZA_API_BASE = String(process.env.VETORIZA_API_BASE || "http://127.0.0.1:8080/api").replace(/\/+$/, "");
const VETORIZA_COOKIE_NAME = String(process.env.VETORIZA_COOKIE_NAME || "vetorizamat_token");
const VETORIZA_BRIDGE_SECRET =
  process.env.VETORIZA_BRIDGE_SECRET ||
  process.env.FIREBASE_PROJECT_ID ||
  "geoforest-vetoriza-local-bridge";
const SESSION_CACHE_TTL_MS = 23 * 60 * 60 * 1000;

const sessionCache = new Map<string, VetorizaSession>();

function upstreamPathFromRequest(req: Request): string {
  const prefix = "/api/vetoriza";
  const originalUrl = req.originalUrl || "";
  const idx = originalUrl.indexOf(prefix);
  if (idx < 0) return "/";
  const suffix = originalUrl.slice(idx + prefix.length);
  return suffix || "/";
}

function upstreamUrl(req: Request): string {
  const suffix = upstreamPathFromRequest(req);
  return `${VETORIZA_API_BASE}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function cookiePairFromResponse(response: globalThis.Response): string | null {
  const getSetCookie = (response.headers as any).getSetCookie;
  const rawCookies: string[] =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : response.headers.get("set-cookie")
        ? [String(response.headers.get("set-cookie"))]
        : [];

  for (const raw of rawCookies) {
    const pair = String(raw || "").split(";")[0]?.trim();
    if (pair.startsWith(`${VETORIZA_COOKIE_NAME}=`)) return pair;
  }
  return null;
}

async function readUpstreamText(response: globalThis.Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.detail || parsed?.message || text);
  } catch {
    return text;
  }
}

function buildCredentials(uid: string, decoded: any): VetorizaCredentials {
  const uidHash = crypto.createHash("sha256").update(uid).digest("hex").slice(0, 24);
  const senha = `${crypto.createHmac("sha256", VETORIZA_BRIDGE_SECRET).update(uid).digest("base64url")}Aa1!`;
  const rawName = String(decoded?.name || decoded?.email || `GeoForest ${uidHash.slice(0, 8)}`).trim();
  return {
    nome: rawName.slice(0, 255) || `GeoForest ${uidHash.slice(0, 8)}`,
    email: `geoforest.${uidHash}@vetorizamat.cursar.space`,
    senha,
  };
}

async function postVetorizaJson(pathname: string, body: unknown): Promise<globalThis.Response> {
  return fetch(`${VETORIZA_API_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

async function loginVetoriza(creds: VetorizaCredentials): Promise<string | null> {
  const response = await postVetorizaJson("/auth/login", { email: creds.email, senha: creds.senha });
  if (!response.ok) return null;
  return cookiePairFromResponse(response);
}

async function cadastroVetoriza(creds: VetorizaCredentials): Promise<string | null> {
  const response = await postVetorizaJson("/auth/cadastro", creds);
  if (!response.ok && response.status !== 409) {
    throw new Error(await readUpstreamText(response));
  }
  if (response.ok) return cookiePairFromResponse(response);
  return null;
}

async function ensureVetorizaSession(req: Request, force = false): Promise<string> {
  const uid = String(req.authUid || "").trim();
  if (!uid) throw new Error("Usuário GeoForest não autenticado.");

  const cached = sessionCache.get(uid);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.cookie;

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) throw new Error("Token Firebase ausente.");
  const decoded = await adminAuth.verifyIdToken(bearerToken);
  const creds = buildCredentials(uid, decoded);

  let cookie = await loginVetoriza(creds);
  if (!cookie) {
    await cadastroVetoriza(creds);
    cookie = await loginVetoriza(creds);
  }

  if (!cookie) {
    throw new Error(
      "Não foi possível autenticar a conta técnica no VetorizaMat. Verifique VETORIZA_BRIDGE_SECRET se a conta já existir.",
    );
  }

  sessionCache.set(uid, { cookie, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return cookie;
}

function hasRequestBody(req: Request): boolean {
  return !["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase());
}

function buildProxyInit(req: Request, cookie: string): RequestInit & { duplex?: "half" } {
  const headers = new Headers();
  const contentType = String(req.headers["content-type"] || "").trim();
  const accept = String(req.headers.accept || "").trim();
  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);
  headers.set("Cookie", cookie);
  headers.set("X-GeoForest-Bridge", "vetoriza-mat");

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
  };

  if (!hasRequestBody(req)) return init;

  if (/application\/json/i.test(contentType)) {
    init.body = JSON.stringify(req.body ?? {});
    return init;
  }

  init.body = req as any;
  init.duplex = "half";
  return init;
}

function forwardUpstreamResponse(upstream: globalThis.Response, res: Response): void {
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "set-cookie" ||
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "connection"
    ) {
      return;
    }
    res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body as any).on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).json({ error: String((error as any)?.message || error || "Falha no proxy VetorizaMat.") });
    } else {
      res.destroy(error as Error);
    }
  }).pipe(res);
}

async function proxyVetorizaRequest(req: Request, res: Response): Promise<void> {
  const cookie = await ensureVetorizaSession(req);
  let upstream = await fetch(upstreamUrl(req), buildProxyInit(req, cookie));

  if (upstream.status === 401 && /application\/json/i.test(String(req.headers["content-type"] || ""))) {
    const freshCookie = await ensureVetorizaSession(req, true);
    upstream = await fetch(upstreamUrl(req), buildProxyInit(req, freshCookie));
  }

  forwardUpstreamResponse(upstream, res);
}

export function registerVetorizaProxyRoutes(app: Express): void {
  app.use("/api/vetoriza", requireAuth, async (req, res) => {
    try {
      await proxyVetorizaRequest(req, res);
    } catch (error: any) {
      console.error("[VETORIZA PROXY]", error);
      if (!res.headersSent) {
        res.status(502).json({ error: error?.message || "Falha ao integrar com VetorizaMat." });
      }
    }
  });
}
