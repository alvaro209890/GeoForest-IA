/**
 * Rotas HTTP /api/simcar-lotes/*.
 *
 * As credenciais do SIMCAR chegam no corpo de `process` (o navegador as guarda em
 * localStorage) e ficam só na memória do job — nunca são logadas nem persistidas.
 */
import type { Express, Request, Response } from "express";
import { getAbsoluteStoragePath, readDocBySegments, removeStoragePath } from "../local-storage";
import { requestCancel, startJob } from "../processing-jobs";
import { runLotesJob } from "./job";
import { lerOcupacaoSimcarCached } from "./monitor";
import { parseRecibosDoEnvio } from "./recibo-parse";
import { persistLotesJob, subscribers, writeSse } from "./sse";

function authUid(req: Request): string {
  return String((req as any).authUid || "").trim();
}

function parseBase64Zip(value: unknown): Buffer {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Envie o(s) recibo(s) em PDF ou um ZIP.");
  const buffer = Buffer.from(raw.replace(/^data:[^,]+,/, ""), "base64");
  if (!buffer.length) throw new Error("Arquivo enviado está vazio.");
  return buffer;
}

function credenciais(body: any): { cpf: string; senha: string } {
  const cpf = String(body?.cpf || "").replace(/\D/g, "");
  const senha = String(body?.senha || "");
  if (cpf.length !== 11 || !senha) {
    throw new Error("Configure o CPF e a senha do SIMCAR antes de buscar.");
  }
  return { cpf, senha };
}

export function registerSimcarLotesRoutes(app: Express): void {
  /**
   * Status do Monitor SIMCAR (monitor-car.web.app) para o badge do painel.
   * Leitura pura, com cache de 5s no servidor — o navegador consulta a cada 15s.
   */
  app.get("/api/simcar-lotes/monitor-status", async (req: Request, res: Response) => {
    if (!authUid(req)) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    res.json({ ok: true, monitor: await lerOcupacaoSimcarCached() });
  });

  /** Fase 0 — lê os recibos sem tocar na SEMA. */
  app.post("/api/simcar-lotes/parse-recibos", async (req: Request, res: Response) => {
    try {
      if (!authUid(req)) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const buffer = parseBase64Zip((req.body as any)?.zipBase64);
      const filename = String((req.body as any)?.filename || "recibos.zip");
      const lotes = await parseRecibosDoEnvio(buffer, filename);
      res.json({ ok: true, lotes });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao ler os recibos." });
    }
  });

  /** Fase 1 — job em background que baixa os documentos de cada CAR. */
  app.post("/api/simcar-lotes/process", async (req: Request, res: Response) => {
    try {
      const uid = authUid(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const { cpf, senha } = credenciais(req.body);
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const filename = String((req.body as any)?.filename || "recibos.zip");
      const carsManuais = ((req.body as any)?.carsManuais || {}) as Record<string, string>;

      const job = startJob({
        uid,
        endpoint: "/api/simcar-lotes/process",
        metadata: { filename },
      });
      persistLotesJob(uid, job.jobId, {
        status: "processing",
        fase: "queued",
        percent: 1,
        filename,
        message: "Envio recebido pelo servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });

      void runLotesJob({ uid, jobId: job.jobId, zipBuffer, filename, cpf, senha, carsManuais });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar o download dos lotes." });
    }
  });

  app.get("/api/simcar-lotes/jobs/:jobId/status", async (req: Request, res: Response) => {
    const data = readDocBySegments(["users", authUid(req), "simcar_lotes_jobs", String(req.params.jobId || "")]);
    if (!data) {
      res.status(404).json({ error: "Job de lotes não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/simcar-lotes/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = authUid(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "simcar_lotes_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job de lotes não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });

    const status = String(data.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) {
      res.end();
      return;
    }
    const set = subscribers.get(jobId) || new Set<Response>();
    set.add(res);
    subscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/simcar-lotes/download/:jobId", async (req: Request, res: Response) => {
    const uid = authUid(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "simcar_lotes_jobs", jobId]);
    if (!data || !data.outputRelativePath) {
      res.status(404).json({ error: "ZIP dos lotes não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, String(data.outputFilename || `lotes_simcar_${jobId.slice(0, 8)}.zip`));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar o ZIP." });
    }
  });

  app.delete("/api/simcar-lotes/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = authUid(req);
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "simcar_lotes_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    const status = String(data.status || "").toLowerCase();
    // Cancelar um job em andamento preserva o ZIP parcial; remover um concluído apaga.
    if (status !== "processing") {
      removeStoragePath(String(data.outputRelativePath || ""));
      persistLotesJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    }
    res.json({ ok: true });
  });
}
