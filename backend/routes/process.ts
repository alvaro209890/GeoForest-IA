import { Express, Request, Response } from "express";
import { requestCancel } from "../processing-jobs";

export function registerProcessRoutes(app: Express) {
  app.post("/api/process/cancel", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "");
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String((req.body as any)?.jobId || "").trim();
    if (!jobId) {
      res.status(400).json({ error: "jobId é obrigatório.", code: "INVALID_JOB_ID" });
      return;
    }
    const result = requestCancel(jobId, uid);
    if (!result.ok) {
      if (result.status === "forbidden") {
        res.status(403).json({ error: "Sem permissão para cancelar este processamento.", code: "FORBIDDEN" });
        return;
      }
      res.status(404).json({ error: "jobId não encontrado.", code: "JOB_NOT_FOUND" });
      return;
    }
    res.status(202).json({ ok: true, status: "cancel_requested" });
  });
}
