/**
 * Factory do Express app — middlewares, auth, static, rotas.
 * Extraído de backend/index.ts (plano 01).
 */
import express, { Express, Request, Response } from "express";
import { createCorsMiddleware } from "./middleware/cors";
import { createRequestLogger } from "./middleware/request-logger";
import { createRateLimiters } from "./middleware/rate-limit";
import { createSecurityHeaders, setStaticAssetHeaders } from "./middleware/security-headers";
import { isPrivateStoragePath } from "./middleware/storage-guard";
import { requireAuth, attachOptionalAuth } from "./auth";
import { STORAGE_ROOT } from "./local-storage";
import { CBERS_ARCHIVE_ROOT } from "./cbers/archive";
import { NDVI_ARCHIVE_ROOT } from "./ndvi/constants";
import { registerAllRoutes } from "./routes/_registry";
import { AUTH_REQUIRED_PATHS } from "./auth-required-paths";
import type { Logger } from "./lib/logger";

/**
 * O storage guarda JSON de perfil/jobs além dos arquivos que o app baixa.
 * Servir esse JSON por `/api/storage` publicava e-mail, CREA e metadados de
 * job para quem tivesse a URL. O único JSON que o app precisa baixar é o
 * contexto do recorte SIMCAR (`/simcar/context/`), usado para reexecutar as
 * fases — esse continua liberado. Regra detalhada em `middleware/storage-guard`.
 */
function blockPrivateStoragePaths(req: Request, res: Response, next: () => void): void {
  if (isPrivateStoragePath(req.originalUrl)) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }
  next();
}

const staticFileOptions = {
  dotfiles: "deny" as const,
  index: false,
  redirect: false,
  setHeaders: setStaticAssetHeaders,
};

export function createApp(logBackend: Logger): Express {
  const app = express();

  app.disable("x-powered-by");
  // Cloudflare Tunnel / proxy na frente: honra x-forwarded-proto no HSTS.
  app.set("trust proxy", true);

  // Cabeçalhos de segurança e rate limit antes de parsear corpo: um POST
  // grande de cliente abusivo não chega a virar JSON na memória.
  app.use(createSecurityHeaders());
  app.use("/api", createRateLimiters());

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
  app.use("/api/storage", blockPrivateStoragePaths);
  app.use("/api/storage", express.static(STORAGE_ROOT, staticFileOptions));
  app.use("/api/raster", express.static(CBERS_ARCHIVE_ROOT, staticFileOptions));
  app.use("/api/raster-ndvi", express.static(NDVI_ARCHIVE_ROOT, staticFileOptions));

  // Oráculo SIMCAR: desativado para sempre (decisão do Álvaro, 05/08/2026).
  // As rotas continuavam registradas e o fluxo usa a conta técnica da SEMA —
  // cada tentativa conta para a suspensão em 3 erros de senha. Fora do ar por
  // padrão; `SIMCAR_ORACULO_ROUTES_ENABLED=1` só se um dia for religado.
  if (String(process.env.SIMCAR_ORACULO_ROUTES_ENABLED ?? "0") !== "1") {
    app.use("/api/simcar-oraculo", (_req: Request, res: Response) => {
      res.status(410).json({
        error: "Fluxo do oráculo SIMCAR desativado.",
        code: "ORACULO_DISABLED",
      });
    });
  }

  registerAllRoutes(app);

  return app;
}
