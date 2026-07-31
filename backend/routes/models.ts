import { Express, Request, Response } from "express";
import { MODEL_CATALOG } from "../lib/models-config";

export function registerModelsRoutes(app: Express) {
  app.get("/api/models", (_req: Request, res: Response) => {
    const defaultModel = process.env.GROQ_MODEL || "meta-llama/llama-3.3-70b-versatile";
    res.json({ models: MODEL_CATALOG, defaultModel });
  });
}
