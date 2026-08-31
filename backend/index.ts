import express from "express";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createKnowledgeBase } from "./knowledge-base";
import { PORT, RENDER_INFO, KEEP_ALIVE_URL, KEEP_ALIVE_INTERVAL_MS } from "./config";
import { createLogger } from "./lib/logger";
import { createApp } from "./app";
import { registerChatRoutes } from "./routes/chat";
import { registerHealthRoutes } from "./routes/health";
import { registerUploadRoutes } from "./routes/uploads";
import { markPersistedRunningJobsInterrupted } from "./processing-jobs";
import { ensureStorageRoot } from "./local-storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const bootId = crypto.randomUUID();
  const renderInfo = RENDER_INFO;
  const logBackend = createLogger(bootId, renderInfo);
  const app = createApp(logBackend);
  const server = createServer(app);
  // ZIP do WMS CBERS chega a vários GB. O default do Node 18+ (requestTimeout=5 min)
  // aborta o stream no meio do download.
  server.requestTimeout = 0;
  server.timeout = 0;

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

  const knowledgeBase = createKnowledgeBase({
    dbRoot: path.resolve(__dirname, "..", "banco_de_dados"),
    zipPath: path.resolve(__dirname, "..", "banco_de_dados", "banco_de_dados_melhorado.zip"),
    summaryModel: process.env.DB_SUMMARY_MODEL || "openai/gpt-oss-20b",
    summaryMaxTokens: Number(process.env.DB_SUMMARY_MAX_TOKENS ?? "220"),
    summaryEnabled: String(process.env.DB_SUMMARY_ENABLED ?? "true") !== "false",
  });

  registerChatRoutes(app, knowledgeBase);
  registerHealthRoutes(app, knowledgeBase);
  registerUploadRoutes(app);

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
