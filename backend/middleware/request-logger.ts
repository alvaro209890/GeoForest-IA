/**
 * Middleware de logging de requisições HTTP.
 *
 * Gera requestId, adiciona header x-request-id, e loga duração +
 * status code de cada requisição à API.
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

type LogFn = (
  event: string,
  payload: Record<string, unknown>,
  level?: "info" | "warn" | "error"
) => void;

export function createRequestLogger(logBackend: LogFn) {
  return (req: Request, res: Response, next: NextFunction) => {
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
        res.statusCode >= 500
          ? "error"
          : res.statusCode >= 400
            ? "warn"
            : "info";
      logBackend("http_request", {
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
      }, level);
    });
    next();
  };
}
