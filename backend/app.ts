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
import { registerAllRoutes } from "./routes/_registry";
import type { Logger } from "./lib/logger";

/** Paths que exigem autenticação Firebase. */
const AUTH_REQUIRED_PATHS: (string | RegExp)[] = [
  "/api/chat",
  "/api/chat-stream",
  "/api/simcar/clip/import-vectorized",
  "/api/simcar/clip/analyze",
  "/api/simcar/clip/analyze-auas",
  "/api/simcar/clip/analyze/chat",
  "/api/simcar/clip/report",
  // DELETE de um job de recorte: apaga arquivos a partir de URLs do corpo.
  /^\/api\/simcar\/clip\/[^/]+$/,
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
  "/api/simcar-lotes/parse-recibos",
  "/api/simcar-lotes/process",
  /^\/api\/simcar-lotes\/jobs\/[^/]+\/(status|events)$/,
  /^\/api\/simcar-lotes\/jobs\/[^/]+$/,
  /^\/api\/simcar-lotes\/download\/[^/]+$/,
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
  "/api/solicitacao-prioridade/process",
  /^\/api\/solicitacao-prioridade\/download\/[^/]+$/,
];

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

  registerAllRoutes(app);

  return app;
}
