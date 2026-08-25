/**
 * Factory do Express app — middlewares, auth, static, rotas.
 * Extraído de backend/index.ts (plano 01).
 */
import express, { Express, Request, Response } from "express";
import { createCorsMiddleware } from "./middleware/cors";
import { createRequestLogger } from "./middleware/request-logger";
import { requireAuth, attachOptionalAuth } from "./auth";
import { STORAGE_ROOT } from "./local-storage";
import { CBERS_ARCHIVE_ROOT } from "./cbers/archive";
import { NDVI_ARCHIVE_ROOT } from "./ndvi/constants";
import { registerAllRoutes } from "./routes/_registry";
import { AUTH_REQUIRED_PATHS } from "./auth-required-paths";
import type { Logger } from "./lib/logger";


export function createApp(logBackend: Logger): Express {
  const app = express();

  app.use(express.json({ limit: "25mb" }));

  // CORS
  app.use(createCorsMiddleware());

  // HTTP request logger
  app.use(createRequestLogger(logBackend));

  // Auth middleware — só os paths listados exigem token
  app.use(AUTH_REQUIRED_PATHS, requireAuth);
  app.use(["/api/upload-image", "/api/upload-file"], attachOptionalAuth);

  // Artefatos do oráculo exigem ownership; nunca expostos via static genérico
  app.use("/api/storage/users/:uid/simcar-oraculo", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Arquivo não encontrado." });
  });
  app.use("/api/storage", express.static(STORAGE_ROOT));
  app.use("/api/raster", express.static(CBERS_ARCHIVE_ROOT));
  app.use("/api/raster-ndvi", express.static(NDVI_ARCHIVE_ROOT));

  registerAllRoutes(app);

  return app;
}
