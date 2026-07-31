/**
 * Middleware de CORS para o backend GeoForest.
 *
 * Em desenvolvimento permite qualquer origem. Em produção valida contra
 * uma whitelist de origens (Firebase Hosting + localhost).
 */
import type { Request, Response, NextFunction } from "express";
import { IS_DEVELOPMENT, buildCorsOriginSet, CORS_ORIGIN_REGEX, isOriginAllowed } from "../config";

export function createCorsMiddleware() {
  const originSet = buildCorsOriginSet();

  return (req: Request, res: Response, next: NextFunction) => {
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : "";
    const originAllowed = IS_DEVELOPMENT || isOriginAllowed(origin, originSet, CORS_ORIGIN_REGEX);

    const requestedHeaders =
      typeof req.headers["access-control-request-headers"] === "string"
        ? req.headers["access-control-request-headers"]
        : "";

    if (IS_DEVELOPMENT) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    if (originAllowed) {
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        requestedHeaders || "Content-Type, Authorization, Accept, Origin"
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.status(originAllowed ? 204 : 403).end();
      return;
    }
    next();
  };
}
