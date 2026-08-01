/**
 * Solicitação de Prioridade SEMA — Auto-preenchimento de documentos.
 *
 * Endpoints:
 *   POST /api/solicitacao-prioridade/process
 *   GET  /api/solicitacao-prioridade/download/:jobId
 */
import type { Express, Request, Response } from "express";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractZipEntries } from "./geo-utils";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import { requireAuth } from "./auth";
import { stripUndefinedDeep, writeDocBySegments } from "./local-storage";
import type { Logger } from "./lib/logger";

const subscribers = new Map<string, Set<Response>>();

/** UID real vindo do requireAuth (req.authUid). Nunca usar req.user?.uid. */
function getAuthUid(req: Request): string {
  return String((req as any).authUid || "").trim() || "anonymous";
}

/** Persiste o job no "banco" (local-storage) igual ao recorte SIMCAR (simcar_clips). */
function persistSolicitacaoJob(args: {
  uid: string;
  jobId: string;
  patch: Record<string, unknown>;
}): void {
  const uid = String(args.uid || "").trim();
  const jobId = String(args.jobId || "").trim();
  if (!uid || !jobId || !args.patch || typeof args.patch !== "object") return;
  try {
    writeDocBySegments(
      ["users", uid, "solicitacao_prioridade_jobs", jobId],
      stripUndefinedDeep(args.patch),
      { merge: true }
    );
  } catch (error) {
    console.warn("[SOLICITACAO] falha ao persistir job:", error);
  }
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // ignore
  }
}

const PYTHON_EXE =
  process.platform === "win32"
    ? "C:\\Users\\Usuario\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"
    : "python3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILL_SCRIPT = path.resolve(__dirname, "solicitacao", "fill_templates.py");

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

async function handleProcess(req: Request, res: Response): Promise<void> {
  const uid = getAuthUid(req);
  const job = startJob({ uid, endpoint: "/api/solicitacao-prioridade/process" });
  const jobId = job.jobId;

  // Persiste o job no banco assim que inicia (status: processing) — igual ao recorte SIMCAR.
  persistSolicitacaoJob({
    uid,
    jobId,
    patch: {
      id: jobId,
      jobId,
      kind: "solicitacao_prioridade",
      status: "processing",
      title: "Solicitação de Prioridade",
      filename: String((req.body as any)?.filename || "solicitacao.zip").trim(),
      downloadUrl: null,
      error: null,
      pdfCount: 0,
      timestamp: new Date().toISOString(),
      updatedAtMs: Date.now(),
    },
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  writeSse(res, { type: "jobId", jobId });

  const subSet = subscribers.get(jobId) || new Set();
  subSet.add(res);
  subscribers.set(jobId, subSet);

  req.on("close", () => {
    const s = subscribers.get(jobId);
    if (s) {
      s.delete(res);
      if (s.size === 0) subscribers.delete(jobId);
    }
    requestCancel(jobId, uid);
  });

  let tmpDir = "";
  try {
    const body = req.body as { zipBase64?: string; uid?: string };
    const zipBuffer = parseBase64Zip(body.zipBase64);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-solicitacao-"));
    writeSse(res, { type: "progress", stage: "extraindo", message: "Extraindo PDFs do ZIP..." });

    const entries = extractZipEntries(zipBuffer);
    const pdfFiles: string[] = [];
    for (const entry of entries) {
      if (entry.name.toLowerCase().endsWith(".pdf") && !entry.name.includes("__MACOSX")) {
        const filePath = path.join(tmpDir, path.basename(entry.name));
        fs.writeFileSync(filePath, entry.data);
        pdfFiles.push(filePath);
      }
    }

    if (pdfFiles.length === 0) {
      throw new Error(
        "Nenhum PDF encontrado no ZIP. Envie os PDFs: CAR, Matrícula, Procuração, CNH, Comprovante, AI/TE."
      );
    }

    writeSse(res, {
      type: "progress",
      stage: "extraindo",
      message: `${pdfFiles.length} PDF(s) encontrados.`,
    });

    if (isCancelRequested(jobId)) throw new Error("cancel_requested");

    const outputDir = path.join(tmpDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });

    writeSse(res, {
      type: "progress",
      stage: "processando",
      message: "Extraindo dados e preenchendo documentos...",
    });

    const pythonArgs = [FILL_SCRIPT, tmpDir, outputDir];
    let stdout = "";
    let stderr = "";
    try {
      const result = execFileSync(PYTHON_EXE, pythonArgs, {
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      stdout = (result && typeof result === "string" ? result : "").trim();
      // stderr is captured separately below — execFileSync returns stdout only
    } catch (pyErr: any) {
      stdout = pyErr.stdout?.trim() || "";
      stderr = pyErr.stderr?.trim() || "";
      const errMsg = stdout.startsWith("ERRO:") ? stdout.replace("ERRO: ", "") : (stderr || pyErr.message);
      throw new Error(errMsg || "Erro no script Python.");
    }

    // Parse stderr lines for progress
    if (stderr) {
      for (const line of stderr.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) writeSse(res, { type: "progress", stage: "diagnostico", message: trimmed });
      }
    }

    if (isCancelRequested(jobId)) throw new Error("cancel_requested");

    // Check for error in stdout
    if (stdout.startsWith("ERRO:")) {
      throw new Error(stdout.replace("ERRO: ", ""));
    }

    if (!stdout || !fs.existsSync(stdout)) {
      throw new Error("Script Python não gerou o ZIP de saída. Verifique os PDFs enviados.");
    }

    const outputZipPath = stdout;

    const resultBuffer = fs.readFileSync(outputZipPath);
    const storageDir = path.join(
      process.env.STORAGE_ROOT || os.tmpdir(),
      "solicitacao_prioridade_jobs",
      uid,
      jobId
    );
    fs.mkdirSync(storageDir, { recursive: true });
    const finalZipPath = path.join(storageDir, "documentos_preenchidos.zip");
    fs.writeFileSync(finalZipPath, resultBuffer);

    writeSse(res, {
      type: "complete",
      jobId,
      downloadUrl: `/api/solicitacao-prioridade/download/${jobId}`,
      message: "Documentos preenchidos com sucesso!",
    });

    // Persiste o job como concluído — fica salvo no banco para listar depois.
    persistSolicitacaoJob({
      uid,
      jobId,
      patch: {
        status: "completed",
        downloadUrl: `/api/solicitacao-prioridade/download/${jobId}`,
        pdfCount: pdfFiles.length,
        error: null,
        updatedAtMs: Date.now(),
      },
    });

    finishJob({ jobId, status: "completed" });
  } catch (err: any) {
    const message = err?.message || String(err);
    const cancelled = message === "cancel_requested";
    writeSse(res, { type: cancelled ? "cancelled" : "error", jobId, message });

    // Persiste falha/cancelamento no banco.
    persistSolicitacaoJob({
      uid,
      jobId,
      patch: {
        status: cancelled ? "cancelled" : "failed",
        error: message,
        updatedAtMs: Date.now(),
      },
    });

    finishJob({ jobId, status: cancelled ? "cancelled" : "failed", error: message });
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function handleDownload(req: Request, res: Response): Promise<void> {
  const { jobId } = req.params;
  const uid = getAuthUid(req);

  const storageDir = path.join(
    process.env.STORAGE_ROOT || os.tmpdir(),
    "solicitacao_prioridade_jobs",
    uid,
    jobId
  );
  const zipPath = path.join(storageDir, "documentos_preenchidos.zip");

  if (!fs.existsSync(zipPath)) {
    res.status(404).json({ error: "Job não encontrado ou expirado." });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="Solicitacao_Prioridade_${jobId.slice(0, 8)}.zip"`
  );
  fs.createReadStream(zipPath).pipe(res);
}

export function registerSolicitacaoPrioridadeRoutes(app: Express): void {
  app.post("/api/solicitacao-prioridade/process", requireAuth, handleProcess);
  app.get("/api/solicitacao-prioridade/download/:jobId", requireAuth, handleDownload);
}
