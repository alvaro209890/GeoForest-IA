import { Express, Request, Response } from "express";
import { normalizeStorePath, materializeServerTimestamps } from "../lib/store-helpers";
import {
  readDocBySegments,
  writeDocBySegments,
  deleteDocBySegments,
  listCollectionBySegments,
  stripUndefinedDeep,
} from "../local-storage";

export function registerStoreRoutes(app: Express) {
  app.get("/api/store/doc", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    const docData = readDocBySegments(pathSegments);
    res.json({ exists: Boolean(docData), data: docData, id: pathSegments[pathSegments.length - 1] || null });
  });

  app.put("/api/store/doc", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    if (pathSegments[2] === "simcar_oraculo_jobs") {
      res.status(403).json({ error: "Jobs do oráculo são gerenciados somente pelo backend." });
      return;
    }
    const data = materializeServerTimestamps((req.body as any)?.data || {});
    const merge = Boolean((req.body as any)?.merge);
    const saved = writeDocBySegments(pathSegments, data, { merge });
    res.json({ ok: true, data: saved });
  });

  app.delete("/api/store/doc", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    if (pathSegments[2] === "simcar_oraculo_jobs") {
      res.status(403).json({ error: "Jobs do oráculo são gerenciados somente pelo backend." });
      return;
    }
    deleteDocBySegments(pathSegments);
    res.json({ ok: true });
  });

  app.get("/api/store/collection", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    const docs = listCollectionBySegments(pathSegments, {
      orderBy: String(req.query.orderBy || "updatedAtMs"),
      direction: String(req.query.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc",
    });
    res.json({ docs });
  });
}
