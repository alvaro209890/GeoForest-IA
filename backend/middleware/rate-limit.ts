/**
 * Rate limit em memória — sem dependência externa.
 *
 * Por que existe: a API fica atrás do Cloudflare Tunnel e vários endpoints
 * públicos (recorte SIMCAR, uploads, busca de APF, WMS) gastam CPU, disco e
 * chamadas a terceiros. Sem limite, um único cliente derruba o server —
 * e o backend é a única cópia exposta.
 *
 * Identidade do cliente: atrás do tunnel o socket é sempre 127.0.0.1, então a
 * chave é `CF-Connecting-IP` → 1º item de `X-Forwarded-For` → `X-Real-IP` →
 * socket. Chamadas locais (scripts no próprio server) caem num balde próprio.
 *
 * Dois escopos:
 *  - `api`   — tudo em `/api`, limite generoso (não aparece no uso normal).
 *  - `heavy` — rotas caras (upload, process, analyze, chat, clip, WMS).
 *
 * Configurável por ambiente:
 *   RATE_LIMIT_ENABLED=0            desliga tudo
 *   RATE_LIMIT_GENERAL_PER_MIN=600  requisições/min por IP em /api
 *   RATE_LIMIT_HEAVY_PER_MIN=60     requisições/min por IP nas rotas caras
 *   RATE_LIMIT_WINDOW_MS=60000      tamanho da janela
 */
import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const ENABLED = String(process.env.RATE_LIMIT_ENABLED ?? "1") !== "0";
const WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000) || 60_000);
const GENERAL_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT_GENERAL_PER_MIN ?? 3000) || 3000);
const HEAVY_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT_HEAVY_PER_MIN ?? 60) || 60);

/** Rotas que gastam CPU/disco/terceiros. Casa pelo path sem query string. */
const HEAVY_PATTERNS: RegExp[] = [
  /^\/api\/chat(-stream)?$/,
  /^\/api\/(upload-file|upload-image)$/,
  /^\/api\/simcar\/clip(\/|$)/,
  /^\/api\/simcar-lotes\/(process|parse-recibos)$/,
  /^\/api\/(landsat|cbers-wpm|ndvi)\/(search|estimate|jobs)$/,
  /^\/api\/(landsat|cbers-wpm)\/wms-download$/,
  /^\/api\/map\/(snapshot|intersection-hectares)$/,
  /^\/api\/geometry\/bbox$/,
  /^\/api\/apf\/(search|download)$/,
  /^\/api\/(croqui|vertices|overlap|containment|fiscalizacao|geometry-errors|processar-projeto)\/(upload|process|processar|importar|parse-recibos|route-options)$/,
  /^\/api\/solicitacao-prioridade\/process$/,
  /^\/api\/auas-sccon\/process$/,
];

export function isHeavyPath(pathname: string): boolean {
  return HEAVY_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** IP real do cliente (o socket é o tunnel). Exportado para testes. */
export function clientKey(req: Request): string {
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cf) return cf;

  const xff = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xff) return xff;

  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real;

  return String(req.socket?.remoteAddress || "unknown");
}

/** Requisição feita no próprio server, sem passar pelo tunnel. */
export function isDirectLocalRequest(req: Request): boolean {
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) {
    return false;
  }
  const address = String(req.socket?.remoteAddress || "");
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function consume(key: string, limit: number, now: number): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0, remaining: limit - 1 };
  }
  current.count += 1;
  const allowed = current.count <= limit;
  return {
    allowed,
    retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - current.count),
  };
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

let lastSweep = Date.now();

function createLimiter(scope: string, limit: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!ENABLED) {
      next();
      return;
    }
    const pathname = String(req.originalUrl || req.url || "").split("?")[0];
    if (!pathname.startsWith("/api")) {
      next();
      return;
    }
    // Script de operação rodando no próprio server (loopback, sem headers de
    // proxy) é confiável e nunca deve tomar 429 no meio de um lote.
    if (isDirectLocalRequest(req)) {
      next();
      return;
    }
    const now = Date.now();
    if (now - lastSweep > WINDOW_MS) {
      lastSweep = now;
      sweep(now);
    }
    const result = consume(`${scope}:${clientKey(req)}`, limit, now);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      res.status(429).json({
        error: "Muitas requisições em pouco tempo. Tente novamente em instantes.",
        code: "RATE_LIMITED",
        retryAfterSec: result.retryAfterSec,
      });
      return;
    }
    next();
  };
}

/**
 * Middleware único para `/api`: aplica o balde geral e, se o path for caro,
 * também o balde `heavy`.
 */
export function createRateLimiters() {
  const general = createLimiter("api", GENERAL_LIMIT);
  const heavy = createLimiter("heavy", HEAVY_LIMIT);

  return (req: Request, res: Response, next: NextFunction) => {
    general(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (res.headersSent) return;
      const pathname = String(req.originalUrl || req.url || "").split("?")[0];
      if (!isHeavyPath(pathname)) {
        next();
        return;
      }
      heavy(req, res, next);
    });
  };
}

/** Só para testes: zera os contadores. */
export function __resetRateLimits(): void {
  buckets.clear();
  lastSweep = Date.now();
}
