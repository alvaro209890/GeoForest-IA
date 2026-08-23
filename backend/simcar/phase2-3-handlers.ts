/**
 * Handlers das rotas de fase 2 (datação 2009–2019) e 3 (vegetação na AC) e do
 * catálogo de imagens — espelham o padrão de `handleAuasAnalyzeV2Route`:
 * billing no-op local, SSE, gates por fase, persistência e PDF.
 *
 * Contrato: `docs/planos/analise-pos-recorte/08-contratos-e-persistencia.md`.
 */
import type { Geometry } from "geojson";
import type { Request, Response } from "express";

import {
    BillingError,
    createRequestId,
    estimateReserveForModels,
    refundReserve,
    reserveCredits,
    runWithBillingUsageSession,
    settleReservedCredits,
    type UsageRecordInput,
} from "../billing";
import { finishJob, markDisconnected, startJob } from "../processing-jobs";
import { ClientAbortError, isSseConnectionClosed, sendSSE, startSseHeartbeat } from "./clip-pipeline";
import { readPersistedSimcarClipForUid, hydrateCachedJob, persistSimcarClipArtifacts } from "./hydration";
import { generateAndPersistSimcarReport, type SimcarReportArtifact } from "./report";
import { derivePhases, checkPhaseGate, type PhaseId } from "./phases";
import { createFileCheckpointStore } from "../analise-pos-recorte/checkpoint-store";
import { countLayerPolygons, extractPolygonsFromLayer } from "../analise-pos-recorte/polygons";
import {
    getAuasV2Config,
    runPos2008Analysis,
    runAcVegetacaoAnalysis,
    resolvePos2008Catalog,
    type PosCatalog,
    type Pos2008CheckpointStore,
    type AuasPos2008Analysis,
    type AuasPre2008AnalysisV2,
} from "../analise-pos-recorte";

const EP_POS2008 = "/api/simcar/clip/analyze-auas-pos2008";
const EP_AC_VEG = "/api/simcar/clip/analyze-ac-vegetacao";
const EP_CATALOG = "/api/simcar/imagery/catalog";
const phaseLocks = new Set<string>();

type PhaseContext = {
    uid: string;
    jobId: string;
    persisted: Record<string, unknown>;
    clippedGeometries: Map<string, Geometry[]>;
    bbox?: [number, number, number, number] | null;
    auasCount: number;
    acCount: number;
};

/** Leitura segura do uid do token (middleware de auth já validou). */
function authUidOf(req: Request): string {
    return String((req as any).authUid || "").trim();
}

/**
 * Valida auth + jobId + gate da fase e hidrata o recorte. Devolve null quando
 * respondeu erro (401/400/404/409).
 */
async function resolvePhaseContext(
    req: Request,
    res: Response,
    phase: PhaseId,
    availability: { phase2Enabled: boolean; phase3Enabled: boolean },
): Promise<PhaseContext | null> {
    const uid = authUidOf(req);
    if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return null;
    }
    const jobId = String((req.body as any)?.jobId || "").trim();
    if (!jobId) {
        res.status(400).json({ error: "jobId é obrigatório." });
        return null;
    }

    const persisted = (readPersistedSimcarClipForUid(uid, jobId) || {}) as Record<string, unknown>;
    // The job's persisted URLs are the only trusted hydration source. URLs from
    // the request body/query would let an authenticated user turn this route
    // into an SSRF primitive or attach another user's context to the job ID.
    const job = await hydrateCachedJob(jobId, undefined, undefined, uid);
    if (!job || !job.clippedGeometries) {
        res.status(404).json({ error: "Job de recorte não encontrado.", code: "JOB_NOT_FOUND" });
        return null;
    }
    const clippedGeometries = job.clippedGeometries;
    const auasCount = countLayerPolygons(clippedGeometries, "AUAS");
    const acCount = countLayerPolygons(clippedGeometries, "AREA_CONSOLIDADA");
    const phases = derivePhases({
        jobId,
        auasPolygonCount: auasCount,
        acPolygonCount: acCount,
        auasMeta: persisted.auasMeta,
        auasPos2008Meta: persisted.auasPos2008Meta,
        acVegetacaoMeta: persisted.acVegetacaoMeta,
        pos2008Enabled: availability.phase2Enabled,
        acVegetacaoEnabled: availability.phase3Enabled,
    });
    const gate = checkPhaseGate(phases, phase);
    if (gate) {
        res.status(gate.status).json(gate.body);
        return null;
    }
    return { uid, jobId, persisted, clippedGeometries, bbox: job.bbox ?? null, auasCount, acCount };
}

function acquirePhaseLock(req: Request): string | null {
    const uid = authUidOf(req);
    const jobId = String((req.body as any)?.jobId || "").trim();
    if (!uid || !jobId) return null;
    const key = `${uid}:${jobId}`;
    if (phaseLocks.has(key)) return "";
    phaseLocks.add(key);
    return key;
}

function releasePhaseLock(key: string | null): void {
    if (key) phaseLocks.delete(key);
}

/** Preço estimado por fase: poucos polígonos → reserva leve; muitos → teto. */
async function reserveForPhase(uid: string, requestId: string, endpoint: string, polygonCount: number): Promise<number> {
    const cfg = getAuasV2Config();
    const estInput = 3_000 + polygonCount * 900;
    const estOutput = 2_000 + polygonCount * 400;
    const reserved = await estimateReserveForModels({
        models: [cfg.visionModel, cfg.textModel],
        estimatedInputTokens: estInput,
        estimatedOutputTokens: estOutput,
        safetyMultiplier: 1.3,
        endpoint,
    });
    await reserveCredits({ uid, amountBrl: reserved, requestId, endpoint });
    return reserved;
}

type BillingState = {
    uid: string;
    requestId: string;
    reservedBrl: number;
    chargedBrl: number;
    jobId: string;
    processingJobId: string;
    endpoint: string;
    phase: PhaseId;
};

async function refundRemaining(state: BillingState): Promise<void> {
    if (state.uid && state.requestId && state.reservedBrl > 0) {
        try {
            await refundReserve({
                uid: state.uid,
                requestId: state.requestId,
                amountBrl: state.reservedBrl,
                endpoint: state.endpoint,
                reason: "analysis_failed_before_usage",
            });
            state.reservedBrl = 0;
        } catch (refundErr) {
            console.error(`[${state.endpoint}] refund error:`, refundErr);
        }
    }
}

async function finalizeBilling(state: BillingState, usageInputs: UsageRecordInput[]): Promise<void> {
    const billing = await settleReservedCredits({
        uid: state.uid,
        requestId: state.requestId,
        endpoint: state.endpoint,
        reservedBrl: state.reservedBrl,
        usageInputs,
    });
    state.reservedBrl = 0;
    state.chargedBrl = Number(billing.chargedBrl || 0);
}

/**
 * Fase 2 — datação 2009–2019 das AUAS (SSE streaming, padrão V2 da Fase 1).
 */
export async function handlePos2008Route(
    req: Request,
    res: Response,
    sendSseHeaders: (res: Response) => void,
): Promise<void> {
    const state: BillingState = {
        uid: "",
        requestId: "",
        reservedBrl: 0,
        chargedBrl: 0,
        jobId: "",
        processingJobId: "",
        endpoint: EP_POS2008,
        phase: "POS_2008",
    };
    let sseHeartbeat: ReturnType<typeof setInterval> | null = null;
    let phaseLock: string | null = null;
    try {
        phaseLock = acquirePhaseLock(req);
        if (phaseLock === "") {
            res.status(409).json({ error: "Análise deste recorte já está em andamento.", code: "PHASE_ALREADY_RUNNING" });
            return;
        }
        const cfg = getAuasV2Config();
        const ctx = await resolvePhaseContext(req, res, "POS_2008", cfg);
        if (!ctx) return;
        state.uid = ctx.uid;
        state.jobId = ctx.jobId;

        if (!cfg.phase2Enabled) {
            res.status(409).json({ error: "Fase 2 não habilitada nesta versão do GeoForest.", code: "PHASE_NOT_READY" });
            return;
        }
        if (cfg.maxPolygonsPerJob > 0 && ctx.auasCount > cfg.maxPolygonsPerJob) {
            res.status(400).json({
                error: `O recorte possui ${ctx.auasCount} polígonos AUAS; o limite configurado é ${cfg.maxPolygonsPerJob}.`,
                code: "TOO_MANY_POLYGONS",
            });
            return;
        }

        state.requestId = createRequestId("simcar_pos2008");
        state.reservedBrl = await reserveForPhase(ctx.uid, state.requestId, EP_POS2008, ctx.auasCount);

        sendSseHeaders(res);
        sseHeartbeat = startSseHeartbeat(res);
        const processingJob = startJob({ uid: ctx.uid, endpoint: EP_POS2008, metadata: { clipJobId: ctx.jobId, phase: "POS_2008" } });
        state.processingJobId = processingJob.jobId;
        (res as any).__processingJobId = processingJob.jobId;
        req.on("close", () => markDisconnected(state.processingJobId));
        sendSSE(res, { type: "job_started", jobId: state.processingJobId });

        const pre2008Meta = (ctx.persisted.auasMeta as AuasPre2008AnalysisV2) || null;
        const checkpointStore = createFileCheckpointStore(ctx.jobId) as unknown as Pos2008CheckpointStore;

        let usageInputs: UsageRecordInput[] = [];
        const result = await runWithBillingUsageSession(async () => {
            const outcome = await runPos2008Analysis(
                {
                    jobId: ctx.jobId,
                    clippedGeometries: ctx.clippedGeometries,
                    pre2008Meta,
                    sampleBbox: ctx.bbox ?? undefined,
                },
                {
                    checkpointStore,
                    onProgress: (progress) => {
                        if (isSseConnectionClosed(res)) throw new ClientAbortError("Cliente desconectou.");
                        sendSSE(res, { type: "progress", phase: "POS_2008", ...progress });
                    },
                },
            );
            usageInputs = outcome.windows
                .filter((w) => w.status === "COMPLETED")
                .map((w) => ({
                    provider: "groq" as const,
                    model: w.model,
                    inputTokens: w.inputTokens || 0,
                    outputTokens: w.outputTokens || 0,
                    endpoint: EP_POS2008,
                }));
            if (outcome.report.model === "deepseek-v4-pro") {
                usageInputs.push({
                    provider: "groq" as const,
                    model: "deepseek-v4-pro",
                    inputTokens: 0,
                    outputTokens: 0,
                    endpoint: EP_POS2008,
                    estimated: true,
                });
            }
            return outcome;
        });

        if (!result) {
            await refundRemaining(state);
            finishJob({ jobId: state.processingJobId, status: "failed", error: "pos2008_analysis_failed" });
            return;
        }

        const persisted = await persistSimcarClipArtifacts({
            uid: ctx.uid,
            jobId: ctx.jobId,
            patch: { auasPos2008Meta: result },
        });
        if (!persisted) throw new Error("Não foi possível persistir o resultado da Fase 2.");
        await finalizeBilling(state, usageInputs);
        sendSSE(res, { type: "billing", billing: { chargedBrl: Number(state.chargedBrl.toFixed(4)) } });

        let reportArtifact: SimcarReportArtifact | undefined;
        try {
            sendSSE(res, { type: "progress", phase: "POS_2008", percent: 99, message: "Gerando PDF técnico da datação..." });
            reportArtifact = await generateAndPersistSimcarReport({
                uid: ctx.uid,
                jobId: ctx.jobId,
                auasText: result.report.markdown,
                auasMeta: result,
                phase: "POS_2008",
            });
        } catch (reportErr: any) {
            console.warn("[POS2008] report generation failed:", reportErr?.message || reportErr);
            sendSSE(res, { type: "report_error", message: reportErr?.message || "Falha ao gerar PDF técnico." });
        }

        finishJob({
            jobId: state.processingJobId,
            status: "completed",
            billingSummary: { chargedBrl: Number(state.chargedBrl.toFixed(4)) },
        });
        sendSSE(res, {
            type: "complete",
            percent: 100,
            phase: "POS_2008",
            auasPos2008Meta: result,
            analysis: result.report.markdown,
            ...(reportArtifact || {}),
        });
    } catch (err: any) {
        await routeErrorFallback(res, err, state);
    } finally {
        if (sseHeartbeat) clearInterval(sseHeartbeat);
        releasePhaseLock(phaseLock);
        if (!res.writableEnded) res.end();
    }
}

/**
 * Fase 3 — vegetação na Área Consolidada (SSE streaming).
 */
export async function handleAcVegetacaoRoute(
    req: Request,
    res: Response,
    sendSseHeaders: (res: Response) => void,
): Promise<void> {
    const state: BillingState = {
        uid: "",
        requestId: "",
        reservedBrl: 0,
        chargedBrl: 0,
        jobId: "",
        processingJobId: "",
        endpoint: EP_AC_VEG,
        phase: "AC_VEG",
    };
    let sseHeartbeat: ReturnType<typeof setInterval> | null = null;
    let phaseLock: string | null = null;
    try {
        phaseLock = acquirePhaseLock(req);
        if (phaseLock === "") {
            res.status(409).json({ error: "Análise deste recorte já está em andamento.", code: "PHASE_ALREADY_RUNNING" });
            return;
        }
        const cfg = getAuasV2Config();
        const ctx = await resolvePhaseContext(req, res, "AC_VEG", cfg);
        if (!ctx) return;
        state.uid = ctx.uid;
        state.jobId = ctx.jobId;

        if (!cfg.phase3Enabled) {
            res.status(409).json({ error: "Fase 3 não habilitada nesta versão do GeoForest.", code: "PHASE_NOT_READY" });
            return;
        }
        if (cfg.maxPolygonsPerJob > 0 && ctx.acCount > cfg.maxPolygonsPerJob) {
            res.status(400).json({
                error: `O recorte possui ${ctx.acCount} polígonos de Área Consolidada; o limite configurado é ${cfg.maxPolygonsPerJob}.`,
                code: "TOO_MANY_POLYGONS",
            });
            return;
        }

        const pos2008Meta = ctx.persisted.auasPos2008Meta as AuasPos2008Analysis | undefined;
        const acPolygons = extractPolygonsFromLayer(ctx.clippedGeometries, "AREA_CONSOLIDADA", "AC");

        state.requestId = createRequestId("simcar_ac_veg");
        state.reservedBrl = await reserveForPhase(ctx.uid, state.requestId, EP_AC_VEG, acPolygons.length);

        sendSseHeaders(res);
        sseHeartbeat = startSseHeartbeat(res);
        const processingJob = startJob({ uid: ctx.uid, endpoint: EP_AC_VEG, metadata: { clipJobId: ctx.jobId, phase: "AC_VEG" } });
        state.processingJobId = processingJob.jobId;
        (res as any).__processingJobId = processingJob.jobId;
        req.on("close", () => markDisconnected(state.processingJobId));
        sendSSE(res, { type: "job_started", jobId: state.processingJobId });

        let usageInputs: UsageRecordInput[] = [];
        const result = await runWithBillingUsageSession(async () => {
            const outcome = await runAcVegetacaoAnalysis(
                {
                    jobId: ctx.jobId,
                    clippedGeometries: ctx.clippedGeometries,
                    // Sem Fase 2 concluída vai `null`: usar "agora" carimbava no
                    // laudo uma referência de datação que nunca existiu.
                    pos2008CompletedAt: pos2008Meta?.completedAt || null,
                    polygons: acPolygons,
                },
                {
                    onProgress: (progress) => {
                        if (isSseConnectionClosed(res)) throw new ClientAbortError("Cliente desconectou.");
                        sendSSE(res, { type: "progress", phase: "AC_VEG", ...progress });
                    },
                },
            );
            usageInputs = outcome.windows
                .filter((w) => w.status === "COMPLETED")
                .map((w) => ({
                    provider: "groq" as const,
                    model: w.model,
                    inputTokens: w.inputTokens || 0,
                    outputTokens: w.outputTokens || 0,
                    endpoint: EP_AC_VEG,
                }));
            return outcome;
        });

        if (!result) {
            await refundRemaining(state);
            finishJob({ jobId: state.processingJobId, status: "failed", error: "ac_vegetacao_analysis_failed" });
            return;
        }

        const persisted = await persistSimcarClipArtifacts({
            uid: ctx.uid,
            jobId: ctx.jobId,
            patch: { acVegetacaoMeta: result },
        });
        if (!persisted) throw new Error("Não foi possível persistir o resultado da Fase 3.");
        await finalizeBilling(state, usageInputs);
        sendSSE(res, { type: "billing", billing: { chargedBrl: Number(state.chargedBrl.toFixed(4)) } });

        let reportArtifact: SimcarReportArtifact | undefined;
        try {
            sendSSE(res, { type: "progress", phase: "AC_VEG", percent: 99, message: "Gerando PDF técnico da vegetação na AC..." });
            reportArtifact = await generateAndPersistSimcarReport({
                uid: ctx.uid,
                jobId: ctx.jobId,
                auasText: result.report.markdown,
                auasMeta: result,
                phase: "AC_VEG",
            });
        } catch (reportErr: any) {
            console.warn("[AC_VEG] report generation failed:", reportErr?.message || reportErr);
            sendSSE(res, { type: "report_error", message: reportErr?.message || "Falha ao gerar PDF técnico." });
        }

        finishJob({
            jobId: state.processingJobId,
            status: "completed",
            billingSummary: { chargedBrl: Number(state.chargedBrl.toFixed(4)) },
        });
        sendSSE(res, {
            type: "complete",
            percent: 100,
            phase: "AC_VEG",
            acVegetacaoMeta: result,
            analysis: result.report.markdown,
            ...(reportArtifact || {}),
        });
    } catch (err: any) {
        await routeErrorFallback(res, err, state);
    } finally {
        if (sseHeartbeat) clearInterval(sseHeartbeat);
        releasePhaseLock(phaseLock);
        if (!res.writableEnded) res.end();
    }
}

/**
 * Catálogo de imagens WMS resolvido (prévia/diagnóstico para o painel).
 */
export async function handleImageryCatalogRoute(_req: Request, res: Response): Promise<void> {
    try {
        const catalog: PosCatalog = await resolvePos2008Catalog({});
        res.json({
            version: catalog.version,
            years: catalog.years,
            layerByYear: catalog.layerByYear,
            sensorByYear: catalog.sensorByYear,
            missingYears: catalog.missingYears,
            alternativesAvailable: catalog.alternativesAvailable,
            expiresAt: catalog.expiresAt,
            limitations: catalog.limitations,
        });
    } catch (err: any) {
        res.status(503).json({
            error: "Catálogo de imagens indisponível no momento.",
            code: "CATALOG_UNAVAILABLE",
            detail: String(err?.message || err).slice(0, 300),
        });
    }
}

/** Tratamento de erro comum das rotas de fase (mesmo contrato do V2). */
async function routeErrorFallback(res: Response, err: any, state: BillingState): Promise<void> {
    if (err instanceof ClientAbortError) {
        if (state.uid && state.reservedBrl > 0 && state.requestId) {
            try {
                await refundReserve({
                    uid: state.uid,
                    requestId: state.requestId,
                    amountBrl: state.reservedBrl,
                    endpoint: state.endpoint,
                    reason: "client_abort_without_usage",
                });
            } catch (billingErr) {
                console.error(`[${state.endpoint}] client-abort billing error:`, billingErr);
            }
            state.reservedBrl = 0;
        }
        finishJob({ jobId: state.processingJobId, status: "cancelled", error: "cancel_requested" });
        return;
    }
    await refundRemaining(state);
    if (err instanceof BillingError) {
        finishJob({ jobId: state.processingJobId, status: "failed", error: err.message });
        if (!res.headersSent) res.status(err.statusCode).json({ error: err.message, code: err.code });
        else sendSSE(res, { type: "error", message: err.message, code: err.code });
        return;
    }
    console.error(`[${state.endpoint}] Unexpected error:`, err);
    finishJob({ jobId: state.processingJobId, status: "failed", error: err?.message || "unexpected_error" });
    if (res.headersSent) sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
    else res.status(500).json({ error: err.message || "Erro interno inesperado." });
}
