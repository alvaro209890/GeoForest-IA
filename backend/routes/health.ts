/**
 * Sondas de saúde e de versão do runtime
 * (`/api/health`, `/api/knowledge/health`, `/api/runtime/version`).
 *
 * Extraídas de `backend/index.ts` para o entrypoint ficar só com o boot.
 */
import type { Express } from "express";
import { getSimcarAiRuntimeConfig } from "../simcar";
import type { createKnowledgeBase } from "../knowledge-base";

type KnowledgeBase = ReturnType<typeof createKnowledgeBase>;

export function registerHealthRoutes(app: Express, knowledgeBase: KnowledgeBase): void {
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
}
