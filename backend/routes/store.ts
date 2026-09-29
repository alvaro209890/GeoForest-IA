import { Express, Request, Response } from "express";
import { normalizeStorePath, materializeServerTimestamps } from "../lib/store-helpers";
import {
  readDocBySegments,
  writeDocBySegments,
  deleteDocBySegments,
  listCollectionBySegments,
} from "../local-storage";

/**
 * Express 4 não captura rejeição de handler async: sem este try/catch um
 * `INVALID_DOC_PATH` (coleção fora de `ALLOWED_COLLECTIONS`) ou erro de disco
 * deixava a requisição pendurada e o front recebia só "Load failed".
 */
export function sendStoreError(res: Response, error: unknown, action: string, segments: string[]): void {
  const code = String((error as any)?.code || (error as any)?.message || "").trim();
  const target = segments.join("/") || "(vazio)";
  if (code === "INVALID_DOC_PATH") {
    res.status(400).json({
      error: `Caminho inválido para ${action}: "${target}". A coleção "${segments[2] || ""}" não está liberada no banco local (ALLOWED_COLLECTIONS) ou falta o id do documento.`,
      code: "INVALID_DOC_PATH",
    });
    return;
  }
  console.error(`[/api/store] falha ao ${action} ${target}:`, error);
  res.status(500).json({
    error: `Falha ao ${action} "${target}" no banco local: ${code || "erro sem mensagem"}.`,
    code: "STORE_IO_ERROR",
  });
}

export function registerStoreRoutes(app: Express) {
  app.get("/api/store/doc", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    try {
      const docData = readDocBySegments(pathSegments);
      res.json({ exists: Boolean(docData), data: docData, id: pathSegments[pathSegments.length - 1] || null });
    } catch (error) {
      sendStoreError(res, error, "ler o documento", pathSegments);
    }
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
    try {
      const data = materializeServerTimestamps((req.body as any)?.data || {});
      const merge = Boolean((req.body as any)?.merge);
      const saved = writeDocBySegments(pathSegments, data, { merge });
      res.json({ ok: true, data: saved });
    } catch (error) {
      sendStoreError(res, error, "gravar o documento", pathSegments);
    }
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
    try {
      deleteDocBySegments(pathSegments);
      res.json({ ok: true });
    } catch (error) {
      sendStoreError(res, error, "apagar o documento", pathSegments);
    }
  });

  app.get("/api/store/collection", async (req: Request, res: Response) => {
    const pathSegments = normalizeStorePath(req.query.path);
    const uid = String((req as any).authUid || "").trim();
    if (pathSegments[0] !== "users" || pathSegments[1] !== uid) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    try {
      const docs = listCollectionBySegments(pathSegments, {
        orderBy: String(req.query.orderBy || "updatedAtMs"),
        direction: String(req.query.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc",
      });
      res.json({ docs });
    } catch (error) {
      sendStoreError(res, error, "listar a coleção", pathSegments);
    }
  });
}
