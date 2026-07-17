/**
 * Rotas do oráculo SIMCAR (backend no PC servidor).
 * Auth: mesmo padrão do processar-projeto (authUid no request).
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import { getSimcarOraculoConfig } from "./config";
import { getSimcarToken, simcarBuscar, clearSimcarTokenCache } from "./client";
import { getSimcarQueueLength } from "./queue";
import { extractShapeContext } from "./shape-context";
import { importZipOnTestProject } from "./import-shape";
import { processGeoOnTestProject } from "./process-geo";
import type { SimcarImportOutcome, SimcarProcessOutcome } from "./types";
import { saveUserBuffer, getAbsoluteStoragePath, readDocBySegments } from "../local-storage";
import { appendOraculoTimelineEvent, persistOraculoJob } from "./job-store";

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
        mode: c.mode,
        testCarId: c.testCarId,
        simcarConfigured: c.credentialsConfigured,
        queueLength: getSimcarQueueLength(),
        root: c.root,
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
      const token = await getSimcarToken();
      const raw = await simcarBuscar(token, c.testCarId);
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
      clearSimcarTokenCache();
      res.status(502).json({ error: e?.message || "Falha ao buscar projeto-teste no SIMCAR." });
    }
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
      const c = getSimcarOraculoConfig();
      res.json({ ok: true, shapePreview: ctx, mode: c.mode, testCarId: c.testCarId });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Falha no preview." });
    }
  });
}
