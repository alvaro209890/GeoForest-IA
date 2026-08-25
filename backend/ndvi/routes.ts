/**
 * Rotas do NDVI.
 *
 * O gate é do **backend**, não do botão: com `SIMCAR_NDVI_ENABLED` desligada a rota
 * responde `409 PHASE_NOT_READY`, igual às três fases pós-recorte.
 */
import type { Express, Request, Response } from "express";
import { finishJob, isCancelRequested, requestCancel, startJob } from "../processing-jobs";
import { persistSimcarClipArtifacts, readPersistedSimcarClipForUid } from "../simcar/hydration";
import { SIMCAR_NDVI_ENABLED } from "./constants";
import { listNdviArchiveRecords } from "./archive";
import { runNdviJob } from "./job";
import { NdviCancelError, NdviFailure, NDVI_FAILURE_MESSAGES, type NdviProgressPatch } from "./types";

const assinantes = new Map<string, Set<Response>>();
const ultimoProgresso = new Map<string, NdviProgressPatch>();

function emitir(ndviJobId: string, patch: NdviProgressPatch): void {
  ultimoProgresso.set(ndviJobId, patch);
  const alvos = assinantes.get(ndviJobId);
  if (!alvos) return;
  const dados = `data: ${JSON.stringify(patch)}\n\n`;
  for (const res of alvos) {
    try {
      res.write(dados);
    } catch {
      /* assinante caiu */
    }
  }
}

function uidDe(req: Request): string | null {
  const uid = (req as any).authUid;
  return typeof uid === "string" && uid ? uid : null;
}

function gateDesligado(res: Response): boolean {
  if (SIMCAR_NDVI_ENABLED) return false;
  res.status(409).json({
    error: "A análise de NDVI ainda não está habilitada neste ambiente.",
    code: "PHASE_NOT_READY",
  });
  return true;
}

export function registerNdviRoutes(app: Express): void {
  /** Dispara o cálculo do NDVI para um recorte já concluído. */
  app.post("/api/simcar/clip/analyze-ndvi", async (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) return res.status(401).json({ error: "Não autenticado." });
    if (gateDesligado(res)) return;

    const clipJobId = String(req.body?.jobId || "").trim();
    if (!clipJobId) return res.status(400).json({ error: "jobId é obrigatório." });

    const persistido = readPersistedSimcarClipForUid(uid, clipJobId);
    if (!persistido) return res.status(404).json({ error: "Recorte não encontrado." });

    const ano = req.body?.ano === undefined || req.body?.ano === null ? null : Number(req.body.ano);
    const force = Boolean(req.body?.force);

    const { jobId: ndviJobId } = startJob({
      uid,
      endpoint: "/api/simcar/clip/analyze-ndvi",
      metadata: { clipJobId, ano },
    });

    res.status(202).json({ ok: true, jobId: clipJobId, ndviJobId });
    emitir(ndviJobId, { stage: "queued", percent: 0, status: "running" });

    // segue em background; o cliente acompanha por SSE
    void (async () => {
      try {
        await persistSimcarClipArtifacts({
          uid,
          jobId: clipJobId,
          patch: { ndviStatus: "running", ndviJobId, ndviError: null },
        });
        const resultado = await runNdviJob({
          uid,
          ndviJobId,
          clipJobId,
          year: ano,
          force,
          onProgress: (patch) => emitir(ndviJobId, patch),
        });
        await persistSimcarClipArtifacts({
          uid,
          jobId: clipJobId,
          patch: { ndvi: resultado, ndviStatus: "completed", ndviError: null },
        });
        emitir(ndviJobId, { stage: "done", percent: 100, status: "completed" });
        finishJob({ jobId: ndviJobId, status: "completed" });
      } catch (erro) {
        const cancelado = erro instanceof NdviCancelError;
        const mensagem =
          erro instanceof NdviFailure
            ? NDVI_FAILURE_MESSAGES[erro.code]
            : erro instanceof Error
              ? erro.message
              : String(erro);
        await persistSimcarClipArtifacts({
          uid,
          jobId: clipJobId,
          patch: {
            ndviStatus: cancelado ? "cancelled" : "failed",
            ndviError: mensagem,
            ndviFailureCode: erro instanceof NdviFailure ? erro.code : null,
          },
        }).catch(() => undefined);
        emitir(ndviJobId, {
          stage: "error",
          status: cancelado ? "cancelled" : "failed",
          error: mensagem,
        });
        finishJob({
          jobId: ndviJobId,
          status: cancelado ? "cancelled" : "failed",
          error: mensagem,
        });
      } finally {
        const alvos = assinantes.get(ndviJobId);
        if (alvos) {
          for (const alvo of alvos) {
            try {
              alvo.end();
            } catch {
              /* já fechado */
            }
          }
          assinantes.delete(ndviJobId);
        }
      }
    })();
  });

  /** Resultado persistido do NDVI de um recorte. */
  app.get("/api/simcar/clip/ndvi/:jobId", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) return res.status(401).json({ error: "Não autenticado." });
    const persistido = readPersistedSimcarClipForUid(uid, String(req.params.jobId));
    if (!persistido) return res.status(404).json({ error: "Recorte não encontrado." });
    return res.json({
      ok: true,
      ndvi: persistido.ndvi || null,
      status: persistido.ndviStatus || "idle",
      error: persistido.ndviError || null,
      enabled: SIMCAR_NDVI_ENABLED,
      ndviJobId: persistido.ndviJobId || persistido.ndvi?.ndviJobId || null,
    });
  });

  /** Progresso em tempo real. */
  app.get("/api/simcar/clip/ndvi/:jobId/events", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) return res.status(401).json({ error: "Não autenticado." });
    const clipJobId = String(req.params.jobId || "");
    const persistido = readPersistedSimcarClipForUid(uid, clipJobId);
    if (!persistido) return res.status(404).json({ error: "Recorte não encontrado." });
    const ndviJobId = String(req.query.ndviJobId || req.params.jobId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const snapshot: NdviProgressPatch = ultimoProgresso.get(ndviJobId) || {
      stage: "snapshot",
      message: "Aguardando progresso do NDVI.",
    };
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
      res.end();
      return;
    }

    if (!assinantes.has(ndviJobId)) assinantes.set(ndviJobId, new Set());
    assinantes.get(ndviJobId)!.add(res);

    const batida = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        /* ignora */
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(batida);
      assinantes.get(ndviJobId)?.delete(res);
    });
  });

  /** Cancela um job em andamento. */
  app.delete("/api/simcar/clip/ndvi/:ndviJobId", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) return res.status(401).json({ error: "Não autenticado." });
    const ndviJobId = String(req.params.ndviJobId);
    const resultado = requestCancel(ndviJobId, uid);
    return res.json({ ...resultado, ok: true, cancelling: isCancelRequested(ndviJobId) });
  });

  /** Índice do acervo NDVI — reuso e depuração. */
  app.get("/api/ndvi/archive", (req: Request, res: Response) => {
    const uid = uidDe(req);
    if (!uid) return res.status(401).json({ error: "Não autenticado." });
    const { path: p, row, year } = req.query as Record<string, string | undefined>;
    const registros = listNdviArchiveRecords().filter((r) => {
      if (r.uid !== uid) return false;
      if (p && r.path !== p) return false;
      if (row && r.row !== row) return false;
      if (year && r.year !== String(year)) return false;
      return true;
    });
    return res.json({ ok: true, total: registros.length, records: registros });
  });
}
