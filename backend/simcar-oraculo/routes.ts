/**
 * Rotas do oráculo SIMCAR (backend no PC servidor).
 * Auth: mesmo padrão do processar-projeto (authUid no request).
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSimcarOraculoConfig } from "./config";
import { simcarBuscar, withSimcarAuthRetry } from "./client";
import { getSimcarQueueLength } from "./queue";
import { extractShapeContext } from "./shape-context";
import { importZipOnTestProject } from "./import-shape";
import { processGeoOnTestProject } from "./process-geo";
import type { SimcarImportOutcome, SimcarProcessOutcome } from "./types";
import { saveUserBuffer, getAbsoluteStoragePath, readDocBySegments } from "../local-storage";
import {
  appendOraculoTimelineEvent,
  persistOraculoJob,
  readOraculoJob,
} from "./job-store";
import { detectarMunicipioWfsSema, listarMunicipiosSimcar } from "./municipio-mt";
import {
  requestOraculoPipelineCancellation,
  resolveOraculoArtifact,
  startOraculoPipeline,
  type OraculoPipelineNotification,
} from "./pipeline";

const pipelineSubscribers = new Map<string, Set<Response>>();
const PIPELINE_TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function writePipelineSse(res: Response, payload: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closePipelineSubscribers(jobId: string): void {
  const subscribers = pipelineSubscribers.get(jobId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    if (!subscriber.writableEnded) subscriber.end();
  }
  pipelineSubscribers.delete(jobId);
}

export function publishOraculoPipelineNotification(
  notification: OraculoPipelineNotification,
): void {
  const subscribers = pipelineSubscribers.get(notification.jobId);
  if (subscribers) {
    for (const subscriber of subscribers) writePipelineSse(subscriber, notification);
  }
  if (
    notification.type === "snapshot" &&
    PIPELINE_TERMINAL_STATUSES.has(String(notification.job.status || ""))
  ) {
    closePipelineSubscribers(notification.jobId);
  }
}

function uidOf(req: Request): string {
  return String((req as any).authUid || "").trim();
}

export function buildImportCompletionPatch(args: {
  outcome: SimcarImportOutcome;
  importPdfRelativePath: string | null;
  importPdfUrl: string | null;
  finishedAt?: string;
}): Record<string, unknown> {
  return {
    // Reprovação da regra SEMA é um resultado concluído; somente falha de infraestrutura
    // leva o job a `failed`.
    status: "completed",
    ok: args.outcome.ok,
    importOk: args.outcome.ok,
    resultado: args.outcome.resultado,
    detalhes: args.outcome.detalhes,
    simcarStatus: args.outcome.status,
    timeline: args.outcome.timeline,
    importPdfRelativePath: args.importPdfRelativePath,
    importPdfUrl: args.importPdfUrl,
    finishedAt: args.finishedAt || new Date().toISOString(),
  };
}

export function buildProcessCompletionPatch(args: {
  outcome: SimcarProcessOutcome;
  processPdfRelativePath: string | null;
  processPdfUrl: string | null;
  errosZipRelativePath: string | null;
  errosZipUrl: string | null;
  finishedAt?: string;
}): Record<string, unknown> {
  return {
    status: "completed",
    ok: args.outcome.ok,
    processOk: args.outcome.ok,
    resultado: args.outcome.resultado,
    detalhes: args.outcome.detalhes,
    simcarStatus: args.outcome.status,
    timeline: args.outcome.timeline,
    processPdfRelativePath: args.processPdfRelativePath,
    processPdfUrl: args.processPdfUrl,
    errosZipRelativePath: args.errosZipRelativePath,
    errosZipUrl: args.errosZipUrl,
    finishedAt: args.finishedAt || new Date().toISOString(),
  };
}

export function registerSimcarOraculoRoutes(app: Express): void {
  app.get("/api/simcar-oraculo/health", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const c = getSimcarOraculoConfig();
      res.json({
        ok: true,
        testCarId: c.testCarId,
        simcarConfigured: c.credentialsConfigured,
        deepseekConfigured: Boolean(String(process.env.DEEPSEEK_API_KEY || "").trim()),
        queueLength: getSimcarQueueLength(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "health failed" });
    }
  });

  app.get("/api/simcar-oraculo/test-project", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const c = getSimcarOraculoConfig();
      if (!c.credentialsConfigured) {
        res.status(503).json({
          error: "SIMCAR_CPF/SIMCAR_SENHA não configurados no servidor.",
          code: "SIMCAR_NOT_CONFIGURED",
        });
        return;
      }
      const raw = await withSimcarAuthRetry((token) => simcarBuscar(token, c.testCarId));
      res.json({
        ok: true,
        testCarId: c.testCarId,
        Id: raw.Id ?? c.testCarId,
        Nome: raw.Nome ?? raw.PropriedadeNome ?? null,
        MunicipioTexto: raw.MunicipioTexto ?? raw.Municipio ?? null,
        Situacao: raw.Situacao ?? raw.SituacaoCompleta ?? null,
        ImportacaoResultado: raw.ImportacaoResultado ?? null,
        ProcessamentoResultado: raw.ProcessamentoResultado ?? null,
      });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Falha ao buscar projeto-teste no SIMCAR." });
    }
  });

  app.get("/api/simcar-oraculo/municipios", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const c = getSimcarOraculoConfig();
      if (!c.credentialsConfigured) {
        res.status(503).json({
          error: "Oráculo SIMCAR não configurado no servidor.",
          code: "SIMCAR_NOT_CONFIGURED",
        });
        return;
      }
      const municipios = await listarMunicipiosSimcar();
      res.json({ ok: true, municipios });
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Falha ao listar municípios do SIMCAR." });
    }
  });

  app.post("/api/simcar-oraculo/pipeline", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const cfg = getSimcarOraculoConfig();
      if (!cfg.credentialsConfigured) {
        res.status(503).json({
          error: "Oráculo SIMCAR não configurado no servidor.",
          code: "SIMCAR_NOT_CONFIGURED",
        });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado ou expirado. Envie o ZIP novamente." });
        return;
      }
      const inputRelativePath = String(upload.inputRelativePath || "").trim();
      const absolutePath = getAbsoluteStoragePath(inputRelativePath);
      if (!inputRelativePath || !fs.existsSync(absolutePath)) {
        res.status(404).json({ error: "Arquivo do upload expirou. Envie o ZIP novamente." });
        return;
      }
      const zip = fs.readFileSync(absolutePath);
      const shape = extractShapeContext(zip);
      const selected = (req.body as any)?.municipio;
      if (selected?.ibge && selected?.nome) {
        shape.municipioDetectado = {
          nome: String(selected.nome).trim(),
          ibge: String(selected.ibge).replace(/\D/g, ""),
          chaveSimcar: selected.chaveSimcar ?? selected.chave,
          fonte: "manual",
        };
      } else if (shape.municipioDetectado.fonte === "nao-detectado") {
        try {
          const fallback = await detectarMunicipioWfsSema(shape.centroid);
          if (fallback) shape.municipioDetectado = fallback;
        } catch (error: any) {
          shape.warnings.push(
            `Fallback municipal WFS indisponível: ${error?.message || "falha de rede"}`,
          );
        }
      }
      const started = startOraculoPipeline({
        uid,
        uploadId,
        zip,
        fileName: String(upload.filename || "projeto.zip"),
        shape,
        carId: cfg.testCarId,
        autoProcess: (req.body as any)?.autoProcess !== false,
        autofix: (req.body as any)?.autofix === true,
        onNotification: publishOraculoPipelineNotification,
      });
      // O executor converte falha/cancelamento em snapshot terminal; o catch evita rejeição
      // não observada se a própria infraestrutura da fila falhar fora do executor.
      void started.completion.catch((error: any) => {
        const job = persistOraculoJob(uid, started.jobId, {
          status: "failed",
          stage: "failed",
          ok: false,
          error: error?.message || "Falha na fila do pipeline SIMCAR.",
          finishedAt: new Date().toISOString(),
        });
        publishOraculoPipelineNotification({ type: "snapshot", jobId: started.jobId, job });
      });
      res.status(202).json({
        ok: true,
        jobId: started.jobId,
        queuePosition: started.queuePosition,
        testCarId: cfg.testCarId,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar pipeline SIMCAR." });
    }
  });

  app.get("/api/simcar-oraculo/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const job = readOraculoJob(uid, jobId);
    if (!job) {
      res.status(404).json({ error: "Job oráculo não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writePipelineSse(res, { type: "snapshot", jobId, job });
    if (PIPELINE_TERMINAL_STATUSES.has(String(job.status || ""))) {
      res.end();
      return;
    }
    const subscribers = pipelineSubscribers.get(jobId) || new Set<Response>();
    subscribers.add(res);
    pipelineSubscribers.set(jobId, subscribers);
    const heartbeat = setInterval(
      () => writePipelineSse(res, { type: "heartbeat", jobId, ts: new Date().toISOString() }),
      15_000,
    );
    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(res);
      if (subscribers.size === 0) pipelineSubscribers.delete(jobId);
    });
  });

  app.get(
    "/api/simcar-oraculo/jobs/:jobId/artifact/:key",
    async (req: Request, res: Response) => {
      try {
        const uid = uidOf(req);
        if (!uid) {
          res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
          return;
        }
        const jobId = String(req.params.jobId || "").trim();
        const key = String(req.params.key || "").trim();
        const resolved = resolveOraculoArtifact(uid, jobId, key);
        if (!resolved || !fs.existsSync(resolved.absolutePath)) {
          res.status(404).json({ error: "Artefato não encontrado para este job." });
          return;
        }
        const allowedContentTypes = new Set([
          "application/pdf",
          "application/zip",
          "application/json",
          "application/octet-stream",
        ]);
        const contentType = allowedContentTypes.has(resolved.artifact.contentType)
          ? resolved.artifact.contentType
          : "application/octet-stream";
        const downloadName = path
          .basename(String(resolved.artifact.filename || "artefato.bin"))
          .replace(/[^a-zA-Z0-9._-]/g, "_");
        const bytes = fs.statSync(resolved.absolutePath).size;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", String(bytes));
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${downloadName || "artefato.bin"}"`,
        );
        fs.createReadStream(resolved.absolutePath).pipe(res);
      } catch (error: any) {
        res.status(400).json({ error: error?.message || "Falha ao baixar artefato." });
      }
    },
  );

  app.post(
    "/api/simcar-oraculo/jobs/:jobId/autofix",
    async (req: Request, res: Response) => {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const jobId = String(req.params.jobId || "").trim();
      const job = readOraculoJob(uid, jobId);
      if (!job) {
        res.status(404).json({ error: "Job oráculo não encontrado." });
        return;
      }
      if (!PIPELINE_TERMINAL_STATUSES.has(String(job.status || ""))) {
        res.status(409).json({
          error: "O loop automático ainda está em execução.",
          code: "AUTOFIX_JOB_ACTIVE",
        });
        return;
      }
      if (job.ok === true) {
        res.status(409).json({
          error: "O projeto já foi aprovado; nenhuma correção é necessária.",
          code: "AUTOFIX_NOT_NEEDED",
        });
        return;
      }
      res.status(409).json({
        error:
          String(job.manualAutofixReason || "").trim() ||
          "Nenhuma ação mecânica nova está disponível para este snapshot.",
        code: "AUTOFIX_NO_NEW_ACTION",
        stopReason: job.autofixStopReason || null,
        hint:
          "Baixe os artefatos, edite o ZIP no GIS e inicie um novo job; a mesma ação não será repetida após uma parada segura.",
      });
    },
  );

  app.delete("/api/simcar-oraculo/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const result = requestOraculoPipelineCancellation(uid, jobId);
    if (result.status === "not_found") {
      res.status(404).json({ error: "Job oráculo não encontrado." });
      return;
    }
    if (result.event && result.job) {
      publishOraculoPipelineNotification({
        type: "event",
        jobId,
        event: result.event,
        job: result.job,
      });
    } else if (result.job) {
      publishOraculoPipelineNotification({ type: "snapshot", jobId, job: result.job });
    }
    res.status(result.status === "requested" ? 202 : 200).json({
      ok: true,
      status: result.status,
    });
  });

  /**
   * Importa o ZIP de um upload processar-projeto no projeto-teste SIMCAR.
   * Body: { uploadId } — reutiliza storage de processar-projeto.
   */
  app.post("/api/simcar-oraculo/importar", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const c = getSimcarOraculoConfig();
      if (!c.credentialsConfigured) {
        res.status(503).json({
          error: "Oráculo SIMCAR não configurado (SIMCAR_CPF/SENHA).",
          code: "SIMCAR_NOT_CONFIGURED",
        });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado. Envie o ZIP em /api/processar-projeto/upload." });
        return;
      }
      const abs = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: "Arquivo do upload não está mais no storage." });
        return;
      }
      const zip = fs.readFileSync(abs);
      const fileName = String(upload.filename || "projeto.zip");
      const jobId = crypto.randomUUID();
      persistOraculoJob(uid, jobId, {
        type: "import",
        status: "running",
        uploadId,
        fileName,
        testCarId: c.testCarId,
        timeline: [],
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({
        ok: true,
        jobId,
        mode: "ORACULO",
        testCarId: c.testCarId,
        queueLength: getSimcarQueueLength(),
      });

      void (async () => {
        try {
          const outcome = await importZipOnTestProject({
            zip,
            fileName,
            onProgress: (ev) => {
              appendOraculoTimelineEvent(uid, jobId, ev, {
                status: "running",
                lastStep: ev.step,
                message: ev.message,
                percent: ev.percent ?? null,
              });
            },
          });
          let importPdfUrl: string | null = null;
          let importPdfRelativePath: string | null = null;
          if (outcome.pdfBuffer) {
            const stored = saveUserBuffer({
              uid,
              area: "simcar-oraculo/import-pdf",
              filename: `sema_import_${jobId.slice(0, 8)}.pdf`,
              buffer: outcome.pdfBuffer,
            });
            importPdfRelativePath = stored.relativePath;
            importPdfUrl = `/api/simcar-oraculo/jobs/${jobId}/pdf-import`;
          }
          persistOraculoJob(
            uid,
            jobId,
            buildImportCompletionPatch({ outcome, importPdfRelativePath, importPdfUrl }),
          );
        } catch (e: any) {
          persistOraculoJob(uid, jobId, {
            status: "failed",
            ok: false,
            error: e?.message || "Falha no import SIMCAR",
            finishedAt: new Date().toISOString(),
          });
        }
      })();
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Falha ao iniciar import oráculo." });
    }
  });

  app.post("/api/simcar-oraculo/processar", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const c = getSimcarOraculoConfig();
      if (!c.credentialsConfigured) {
        res.status(503).json({
          error: "Oráculo SIMCAR não configurado.",
          code: "SIMCAR_NOT_CONFIGURED",
        });
        return;
      }
      const jobId = crypto.randomUUID();
      persistOraculoJob(uid, jobId, {
        type: "process",
        status: "running",
        testCarId: c.testCarId,
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId, testCarId: c.testCarId });

      void (async () => {
        try {
          const outcome = await processGeoOnTestProject({
            onProgress: (ev) => {
              appendOraculoTimelineEvent(uid, jobId, ev, {
                status: "running",
                lastStep: ev.step,
                message: ev.message,
                percent: ev.percent ?? null,
              });
            },
          });
          let processPdfUrl: string | null = null;
          let processPdfRelativePath: string | null = null;
          let errosZipUrl: string | null = null;
          let errosZipRelativePath: string | null = null;
          if (outcome.pdfBuffer) {
            const stored = saveUserBuffer({
              uid,
              area: "simcar-oraculo/process-pdf",
              filename: `sema_process_${jobId.slice(0, 8)}.pdf`,
              buffer: outcome.pdfBuffer,
            });
            processPdfRelativePath = stored.relativePath;
            processPdfUrl = `/api/simcar-oraculo/jobs/${jobId}/pdf-process`;
          }
          if (outcome.errosZipBuffer) {
            const stored = saveUserBuffer({
              uid,
              area: "simcar-oraculo/erros-zip",
              filename: `sema_erros_${jobId.slice(0, 8)}.zip`,
              buffer: outcome.errosZipBuffer,
            });
            errosZipRelativePath = stored.relativePath;
            errosZipUrl = `/api/simcar-oraculo/jobs/${jobId}/erros-zip`;
          }
          persistOraculoJob(
            uid,
            jobId,
            buildProcessCompletionPatch({
              outcome,
              processPdfRelativePath,
              processPdfUrl,
              errosZipRelativePath,
              errosZipUrl,
            }),
          );
        } catch (e: any) {
          persistOraculoJob(uid, jobId, {
            status: "failed",
            ok: false,
            error: e?.message || "Falha no process SIMCAR",
            finishedAt: new Date().toISOString(),
          });
        }
      })();
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Falha ao iniciar process oráculo." });
    }
  });

  app.get("/api/simcar-oraculo/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = uidOf(req);
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "simcar_oraculo_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job oráculo não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  const sendStored = (field: string) => async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const jobId = String(req.params.jobId || "").trim();
      const data = readDocBySegments(["users", uid, "simcar_oraculo_jobs", jobId]);
      if (!data) {
        res.status(404).json({ error: "Job não encontrado." });
        return;
      }
      const rel = String((data as any)[field] || "").trim();
      if (!rel) {
        res.status(404).json({ error: "Artefato não disponível." });
        return;
      }
      const abs = getAbsoluteStoragePath(rel);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: "Arquivo ausente no storage." });
        return;
      }
      if (field.includes("pdf") || field.includes("Pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      } else {
        res.setHeader("Content-Type", "application/zip");
      }
      res.setHeader("Cache-Control", "private, max-age=300");
      fs.createReadStream(abs).pipe(res);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "download failed" });
    }
  };

  app.get("/api/simcar-oraculo/jobs/:jobId/pdf-import", sendStored("importPdfRelativePath"));
  app.get("/api/simcar-oraculo/jobs/:jobId/pdf-process", sendStored("processPdfRelativePath"));
  app.get("/api/simcar-oraculo/jobs/:jobId/erros-zip", sendStored("errosZipRelativePath"));

  /** Preview local do ZIP (sem SEMA). Body: { zipBase64 } ou usa uploadId */
  app.post("/api/simcar-oraculo/shape-preview", async (req: Request, res: Response) => {
    try {
      const uid = uidOf(req);
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      let zip: Buffer | null = null;
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (uploadId) {
        const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
        if (upload?.inputRelativePath) {
          zip = fs.readFileSync(getAbsoluteStoragePath(String(upload.inputRelativePath)));
        }
      }
      if (!zip && (req.body as any)?.zipBase64) {
        const b64 = String((req.body as any).zipBase64).replace(/^data:.*?;base64,/, "");
        zip = Buffer.from(b64, "base64");
      }
      if (!zip) {
        res.status(400).json({ error: "Envie uploadId ou zipBase64." });
        return;
      }
      const ctx = extractShapeContext(zip);
      if (ctx.municipioDetectado.fonte === "nao-detectado") {
        try {
          const fallback = await detectarMunicipioWfsSema(ctx.centroid);
          if (fallback) ctx.municipioDetectado = fallback;
        } catch (error: any) {
          ctx.warnings.push(
            `Fallback municipal WFS indisponível: ${error?.message || "falha de rede"}`,
          );
        }
      }
      const c = getSimcarOraculoConfig();
      res.json({ ok: true, shapePreview: ctx, mode: c.mode, testCarId: c.testCarId });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Falha no preview." });
    }
  });
}
