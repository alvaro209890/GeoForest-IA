/**
 * SIMCAR Routes — endpoints do fluxo de recorte e análise SIMCAR.
 * Extraído de simcar-clip.ts (Plano 02, Fase 6b).
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  BillingError,
  applyCancelFloorDebit,
  createRequestId,
  estimateCloudinaryStorageReserve,
  estimateReserveForModels,
  estimateTokensFromMessages,
  estimateTokensFromText,
  getBillingUsageSessionRecords,
  refundReserve,
  reserveCredits,
  runWithBillingUsageSession,
  settleCloudinaryStorageReserve,
  settleReservedCredits,
} from "../billing";
import { getAuthUid } from "../auth";
import {
    finishJob,
    isCancelRequested,
    markDisconnected,
    startJob,
} from "../processing-jobs";
import { getAuasV2Config } from "../analise-pos-recorte";

import { countLayerPolygons } from "../analise-pos-recorte/polygons";
import { derivePhases } from "./phases";
import {
  ClientAbortError,
  jobCache,
  pruneJobCache,
  sendSSE,
  startSseHeartbeat,
  processClip,
  mapToObjectGeometry,
} from "./clip-pipeline";
import {
    readPersistedSimcarClipForUid,
    storagePathBelongsToUid,
    hydrateCachedJob,
    persistSimcarClipProcessingState,
    persistSimcarClipArtifacts,
    parseCachedContextFromOutputZip,
} from "./hydration";
import { generateAndPersistSimcarReport } from "./report";
import { generateAndPersistSimcarReportDocx } from "./report-docx";
import type { SimcarReportArtifact } from "./report";
import {
  getFixedAcAvnSatelliteKeys,
  getOrderedSatelliteKeys,
  normalizeAssistantContent,
  compactChatMessages,
  callTextFollowUp,
  streamTextFollowUp,
  buildAnalysisPrompt,
  processAuasAnalysis,
  handleAuasAnalyzeV2Route,
  sendAcAvnComplete,
  processAnalysis,
  buildEstimatedUsageForFallback,
  attachOptionalAuth,
} from "./analysis";
import { handlePos2008Route, handleAcVegetacaoRoute, handleImageryCatalogRoute } from "./phase2-3-handlers";
import {
    ANALYSIS_VISION_MODELS,
    GROQ_TEXT_MODELS,
    SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL,
    SIMCAR_SYNTHESIS_TEXT_MODELS,
    SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
} from "./analysis";
import {
  uploadRawBufferToCloudinary,
  uploadBufferToCloudinary,
  deleteFromCloudinary,
} from "./cloudinary";
import { CACHE_TTL_MS, DIRECT_COPY_LAYERS, isExcludedFromExport, SIMCAR_OPERATION_BILLING_MODEL, TEMPLATE_LAYERS } from "./constants";
import type { CachedJob, PersistedClipContextV1 } from "./types";
import type { Geometry } from "geojson";
import { toPublicApiUrl } from "./constants";
import { AUAS_SATELLITE_KEYS } from "./analysis";
import type { AcAvnAnalysisResult } from "./analysis";

export function registerSimcarClipRoutes(app: Express) {
    const sendSseHeaders = (res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
    };
    const simcarBillingModels = Array.from(
        new Set([
            ...ANALYSIS_VISION_MODELS,
            ...GROQ_TEXT_MODELS,
            ...SIMCAR_SYNTHESIS_TEXT_MODELS,
            ...SIMCAR_FINAL_UNIFIED_TEXT_MODELS,
        ]),
    );

    // SSE endpoint for clip processing
    app.post("/api/simcar/clip", attachOptionalAuth, async (req: Request, res: Response) => {
        let billingUid = "";
        let billingEnabled = false;
        let operationRequestId = "";
        let operationReserved = 0;
        let storageRequestId = "";
        let storageReserved = 0;
        let processingJobId = "";
        let totalChargedBrl = 0;
        let body: {
            propertyZip?: string;
            carNumber?: string;
            sigefParcelCode?: string;
            filename?: string;
            layerNames?: string[];
            airIdentificacao?: string;
        } = {};
        // SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
            const uid = String(req.authUid || "");
            billingEnabled = Boolean(uid);
            billingUid = uid;
            if (!billingEnabled) {
                console.warn("[SIMCAR CLIP] Sem token válido; processando sem cobrança.");
            }
            body = req.body as {
                propertyZip?: string;
                carNumber?: string;
                sigefParcelCode?: string;
                filename?: string;
                layerNames?: string[];
                airIdentificacao?: string;
            };

            if (!body.propertyZip && !body.carNumber && !body.sigefParcelCode) {
                sendSSE(res, { type: "error", message: "Campo propertyZip, carNumber ou sigefParcelCode é obrigatório." });
                res.end();
                return;
            }

            let zipBuffer: Buffer | null = null;
            if (body.propertyZip) {
                try {
                    zipBuffer = Buffer.from(body.propertyZip, "base64");
                } catch {
                    sendSSE(res, { type: "error", message: "Base64 do ZIP inválido." });
                    res.end();
                    return;
                }

                if (zipBuffer.length < 22) {
                    sendSSE(res, { type: "error", message: "ZIP muito pequeno para ser válido." });
                    res.end();
                    return;
                }
            }

            const processingJob = startJob({
                uid,
                endpoint: "/api/simcar/clip",
                metadata: { filename: body.filename || null },
            });
            processingJobId = processingJob.jobId;
            (res as any).__processingJobId = processingJobId;
            req.on("close", () => {
                markDisconnected(processingJobId);
            });
            sendSSE(res, { type: "job_started", jobId: processingJobId });
            if (billingEnabled) {
                await persistSimcarClipProcessingState({
                    uid,
                    jobId: processingJobId,
                    filename: body.filename,
                    sourceMode: "auto-clip",
                    status: "processing",
                });
            }

            console.log(
                `[SIMCAR CLIP] Processing: ${body.filename || "unknown"}, ` +
                `size=${zipBuffer?.length || "wfs_car"}, layers=${body.layerNames?.length || "all"}`,
            );

            if (billingEnabled) {
                operationRequestId = createRequestId("simcar_clip");
                operationReserved = await estimateReserveForModels({
                    models: [SIMCAR_OPERATION_BILLING_MODEL],
                    estimatedInputTokens: 2200,
                    estimatedOutputTokens: 700,
                    safetyMultiplier: 1.15,
                });
                await reserveCredits({
                    uid,
                    amountBrl: operationReserved,
                    requestId: operationRequestId,
                    endpoint: "/api/simcar/clip",
                });

                storageRequestId = createRequestId("simcar_clip_storage");
                const estimatedStorageBytes = zipBuffer ? Math.max(
                    zipBuffer.length * 3,
                    zipBuffer.length + 320_000,
                ) : 320_000;
                storageReserved = await estimateCloudinaryStorageReserve({
                    bytesStored: estimatedStorageBytes,
                    safetyMultiplier: 1.2,
                });
                if (storageReserved > 0) {
                    await reserveCredits({
                        uid,
                        amountBrl: storageReserved,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip",
                    });
                }
            }

            const clipResult = await processClip(
                res,
                uid,
                zipBuffer,
                body.carNumber || null,
                body.sigefParcelCode || null,
                body.layerNames || null,
                body.airIdentificacao || undefined,
                processingJobId || undefined,
            );
            if (billingEnabled && clipResult.ok && operationReserved > 0) {
                const fallbackUsage = buildEstimatedUsageForFallback({
                    endpoint: "/api/simcar/clip",
                    provider: "groq",
                    model: SIMCAR_OPERATION_BILLING_MODEL,
                    inputTokens: 1800 + Math.max(0, (body.layerNames?.length || TEMPLATE_LAYERS.length) * 25),
                    outputTokens: 250,
                });
                const billing = await settleReservedCredits({
                    uid,
                    requestId: operationRequestId,
                    endpoint: "/api/simcar/clip",
                    reservedBrl: operationReserved,
                    usageInputs: [fallbackUsage],
                });
                operationReserved = 0;
                totalChargedBrl += Number(billing.chargedBrl || 0);
                sendSSE(res, { type: "billing", billing });
            } else if (billingEnabled && operationReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: operationRequestId,
                    amountBrl: operationReserved,
                    endpoint: "/api/simcar/clip",
                    reason: "clip_failed_or_invalid",
                });
                operationReserved = 0;
            }

            if (billingEnabled && clipResult.ok && storageReserved > 0) {
                if (clipResult.cloudinaryStoredBytes > 0) {
                    const storageBilling = await settleCloudinaryStorageReserve({
                        uid,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip",
                        reservedBrl: storageReserved,
                        bytesStored: clipResult.cloudinaryStoredBytes,
                        assetKind: "simcar_zip_bundle",
                    });
                    storageReserved = 0;
                    totalChargedBrl += Number(storageBilling.chargedBrl || 0);
                    sendSSE(res, { type: "billing", billing: storageBilling });
                } else {
                    await refundReserve({
                        uid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "cloudinary_storage_not_persisted",
                    });
                    storageReserved = 0;
                }
            } else if (billingEnabled && storageReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: storageRequestId,
                    amountBrl: storageReserved,
                    endpoint: "/api/simcar/clip",
                    reason: "clip_failed_or_invalid",
                });
                storageReserved = 0;
            }
            finishJob({
                jobId: processingJobId,
                status: clipResult.ok ? "completed" : "failed",
                billingSummary: {
                    chargedBrl: Number(totalChargedBrl.toFixed(4)),
                },
                error: clipResult.ok ? undefined : "clip_failed_or_invalid",
            });
            if (billingEnabled) {
                await persistSimcarClipProcessingState({
                    uid,
                    jobId: processingJobId,
                    filename: body.filename,
                    sourceMode: "auto-clip",
                    status: clipResult.ok ? "completed" : "failed",
                    result: clipResult,
                    error: clipResult.ok ? undefined : "clip_failed_or_invalid",
                });
            }
        } catch (err: any) {
            if (err instanceof ClientAbortError) {
                if (billingUid && operationReserved > 0 && operationRequestId) {
                    try {
                        await refundReserve({
                            uid: billingUid,
                            requestId: operationRequestId,
                            amountBrl: operationReserved,
                            endpoint: "/api/simcar/clip",
                            reason: "cancel_requested",
                        });
                        operationReserved = 0;
                    } catch (refundErr) {
                        console.error("[SIMCAR CLIP] cancel refund error:", refundErr);
                    }
                }
                if (billingUid && storageReserved > 0 && storageRequestId) {
                    try {
                        await refundReserve({
                            uid: billingUid,
                            requestId: storageRequestId,
                            amountBrl: storageReserved,
                            endpoint: "/api/simcar/clip",
                            reason: "cancel_requested",
                        });
                        storageReserved = 0;
                    } catch (refundErr) {
                        console.error("[SIMCAR CLIP] cancel storage refund error:", refundErr);
                    }
                }
                if (billingUid && operationRequestId) {
                    try {
                        const cancelFloor = await applyCancelFloorDebit({
                            uid: billingUid,
                            requestId: operationRequestId,
                            endpoint: "/api/simcar/clip",
                            chargedBrl: totalChargedBrl,
                        });
                        totalChargedBrl = cancelFloor.finalChargedBrl;
                    } catch (cancelBillingErr) {
                        console.error("[SIMCAR CLIP] cancel floor billing error:", cancelBillingErr);
                    }
                }
                finishJob({
                    jobId: processingJobId,
                    status: "cancelled",
                    billingSummary: {
                        chargedBrl: Number(totalChargedBrl.toFixed(4)),
                    },
                    error: "cancel_requested",
                });
                if (billingEnabled) {
                    await persistSimcarClipProcessingState({
                        uid: billingUid,
                        jobId: processingJobId,
                        filename: body?.filename,
                        sourceMode: "auto-clip",
                        status: "cancelled",
                        error: "cancel_requested",
                    });
                }
                sendSSE(res, { type: "cancelled", message: "Cancelamento solicitado. Processamento interrompido." });
                return;
            }
            if (billingUid && operationReserved > 0 && operationRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: operationRequestId,
                        amountBrl: operationReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR CLIP] refund error:", refundErr);
                }
            }
            if (billingUid && storageReserved > 0 && storageRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR CLIP] storage refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                finishJob({
                    jobId: processingJobId,
                    status: "failed",
                    error: err.message,
                });
                if (billingEnabled) {
                    await persistSimcarClipProcessingState({
                        uid: billingUid,
                        jobId: processingJobId,
                        filename: body?.filename,
                        sourceMode: "auto-clip",
                        status: "failed",
                        error: err.message,
                    });
                }
                sendSSE(res, { type: "error", message: err.message, code: err.code });
                return;
            }
            console.error("[SIMCAR CLIP] Unexpected error:", err);
            finishJob({
                jobId: processingJobId,
                status: "failed",
                error: err?.message || "clip_unexpected_error",
            });
            if (billingEnabled) {
                await persistSimcarClipProcessingState({
                    uid: billingUid,
                    jobId: processingJobId,
                    filename: body?.filename,
                    sourceMode: "auto-clip",
                    status: "failed",
                    error: err?.message || "clip_unexpected_error",
                });
            }
            sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    // Import endpoint for pre-vectorized ZIP (no WFS clipping)
    app.post("/api/simcar/clip/import-vectorized", async (req: Request, res: Response) => {
        let billingUid = "";
        let storageRequestId = "";
        let storageReserved = 0;
        let processingJobId = "";
        let baseFilename = "";
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const body = req.body as { propertyZip?: string; filename?: string };
            if (!body.propertyZip || typeof body.propertyZip !== "string") {
                res.status(400).json({ error: "Campo propertyZip (base64) é obrigatório." });
                return;
            }

            let zipBuffer: Buffer;
            try {
                zipBuffer = Buffer.from(body.propertyZip, "base64");
            } catch {
                res.status(400).json({ error: "Base64 do ZIP inválido." });
                return;
            }
            if (zipBuffer.length < 22) {
                res.status(400).json({ error: "ZIP muito pequeno para ser válido." });
                return;
            }

            const baseName = String(body.filename || `simcar_vectorizado_${Date.now()}.zip`).trim();
            const safeFilename = baseName.toLowerCase().endsWith(".zip") ? baseName : `${baseName}.zip`;
            const jobId = crypto.randomUUID();
            processingJobId = jobId;
            baseFilename = safeFilename;
            await persistSimcarClipProcessingState({
                uid,
                jobId,
                filename: safeFilename,
                sourceMode: "vectorized-analysis",
                status: "processing",
            });

            let parsed: CachedJob | null = null;
            try {
                parsed = parseCachedContextFromOutputZip(zipBuffer, safeFilename);
            } catch (parseErr: any) {
                const message = String(parseErr?.message || "vectorized_zip_invalid");
                await persistSimcarClipProcessingState({
                    uid,
                    jobId,
                    filename: safeFilename,
                    sourceMode: "vectorized-analysis",
                    status: "failed",
                    error: message,
                });
                res.status(400).json({ error: message });
                return;
            }
            if (!parsed || !parsed.bbox || !parsed.polygon || !parsed.layerSummaries) {
                await persistSimcarClipProcessingState({
                    uid,
                    jobId,
                    filename: safeFilename,
                    sourceMode: "vectorized-analysis",
                    status: "failed",
                    error: "vectorized_zip_invalid",
                });
                res.status(400).json({
                    error:
                        "ZIP vetorizado inválido. É obrigatório conter camadas com geometria e ATP/AIR para reconstrução da propriedade.",
                });
                return;
            }

            storageRequestId = createRequestId("simcar_vectorized_storage");
            const estimatedStorageBytes = Math.max(zipBuffer.length + 220_000, Math.round(zipBuffer.length * 1.5));
            storageReserved = await estimateCloudinaryStorageReserve({
                bytesStored: estimatedStorageBytes,
                safetyMultiplier: 1.2,
            });
            if (storageReserved > 0) {
                await reserveCredits({
                    uid,
                    amountBrl: storageReserved,
                    requestId: storageRequestId,
                    endpoint: "/api/simcar/clip/import-vectorized",
                });
            }

            let inputZipUrl: string | undefined;
            let outputZipUrl: string | undefined;
            let contextJsonUrl: string | undefined;
            let cloudinaryStoredBytes = 0;
            try {
                const [inUrl, outUrl] = await Promise.all([
                    uploadBufferToCloudinary(
                        zipBuffer,
                        `simcar_vectorized_input_${jobId.slice(0, 8)}`,
                        uid,
                    ),
                    uploadBufferToCloudinary(
                        zipBuffer,
                        `simcar_vectorized_output_${jobId.slice(0, 8)}`,
                        uid,
                    ),
                ]);
                inputZipUrl = inUrl;
                outputZipUrl = outUrl;

                const persistedContext: PersistedClipContextV1 = {
                    version: 1,
                    jobId,
                    savedAtIso: new Date().toISOString(),
                    filename: safeFilename,
                    bbox: parsed.bbox,
                    polygon: parsed.polygon!,
                    layerSummaries: parsed.layerSummaries,
                    areaHa: Number(parsed.areaHa || 0),
                    clippedGeometries: mapToObjectGeometry(parsed.clippedGeometries || new Map<string, Geometry[]>()),
                    inputZipUrl,
                    outputZipUrl,
                    warnings: parsed.warnings,
                    propertySourceLayer: parsed.propertySourceLayer,
                };
                const contextBuffer = Buffer.from(JSON.stringify(persistedContext), "utf8");
                contextJsonUrl = await uploadRawBufferToCloudinary(
                    contextBuffer,
                    `simcar_vectorized_context_${jobId.slice(0, 8)}.json`,
                    "application/json",
                    uid,
                );
                cloudinaryStoredBytes = zipBuffer.length * 2 + contextBuffer.length;
            } catch (uploadErr: any) {
                console.warn("[SIMCAR VECTOR IMPORT] Cloudinary persist failed:", uploadErr?.message || uploadErr);
            }

            pruneJobCache();
            jobCache.set(jobId, {
                ...parsed,
                uid,
                buffer: zipBuffer,
                expiresAt: Date.now() + CACHE_TTL_MS,
                inputZipUrl,
                outputZipUrl,
                contextJsonUrl,
            });

            let billing: Awaited<ReturnType<typeof settleCloudinaryStorageReserve>> | null = null;
            if (storageReserved > 0) {
                if (cloudinaryStoredBytes > 0) {
                    billing = await settleCloudinaryStorageReserve({
                        uid,
                        requestId: storageRequestId,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reservedBrl: storageReserved,
                        bytesStored: cloudinaryStoredBytes,
                        assetKind: "simcar_vectorized_zip",
                    });
                } else {
                    await refundReserve({
                        uid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reason: "cloudinary_storage_not_persisted",
                    });
                }
                storageReserved = 0;
            }

            const layerSummaries = parsed.layerSummaries || [];
            const totalFeaturesClipped = layerSummaries.reduce((sum, layer) => sum + Number(layer.features || 0), 0);
            const layersWithData = layerSummaries.filter((layer) => Number(layer.features || 0) > 0).length;
            const summaryPayload = {
                propertyAreaHa: Number(parsed.areaHa || 0),
                crs: "EPSG:4674",
                layersProcessed: layerSummaries.length,
                layersWithData,
                totalFeaturesClipped,
                processingTimeMs: 0,
                layers: layerSummaries,
                warnings: parsed.warnings,
            };
            await persistSimcarClipProcessingState({
                uid,
                jobId,
                filename: safeFilename,
                sourceMode: "vectorized-analysis",
                status: "completed",
                result: {
                    filename: safeFilename,
                    downloadUrl: toPublicApiUrl(`/api/simcar/clip/download/${jobId}`),
                    inputZipUrl,
                    outputZipUrl,
                    contextUrl: contextJsonUrl,
                    summary: summaryPayload,
                },
            });

            res.json({
                jobId,
                downloadUrl: toPublicApiUrl(`/api/simcar/clip/download/${jobId}`),
                inputZipUrl,
                outputZipUrl,
                contextUrl: contextJsonUrl,
                summary: summaryPayload,
                billing: billing || undefined,
            });
        } catch (err: any) {
            if (billingUid && storageReserved > 0 && storageRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: storageRequestId,
                        amountBrl: storageReserved,
                        endpoint: "/api/simcar/clip/import-vectorized",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR VECTOR IMPORT] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                if (billingUid && processingJobId) {
                    await persistSimcarClipProcessingState({
                        uid: billingUid,
                        jobId: processingJobId,
                        filename: baseFilename || undefined,
                        sourceMode: "vectorized-analysis",
                        status: "failed",
                        error: err.message,
                    });
                }
                res.status(err.statusCode).json({ error: err.message, code: err.code });
                return;
            }
            console.error("[SIMCAR VECTOR IMPORT] Error:", err);
            if (billingUid && processingJobId) {
                await persistSimcarClipProcessingState({
                    uid: billingUid,
                    jobId: processingJobId,
                    filename: baseFilename || undefined,
                    sourceMode: "vectorized-analysis",
                    status: "failed",
                    error: err?.message || "vectorized_import_error",
                });
            }
            res.status(500).json({ error: err?.message || "Erro interno ao importar ZIP vetorizado." });
        }
    });

    // Download endpoint
    app.get("/api/simcar/clip/download/:jobId", (req: Request, res: Response) => {
        const { jobId } = req.params;
        const uid = String(req.authUid || "").trim();
        if (!uid) {
            res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
            return;
        }
        const cachedCandidate = jobCache.get(jobId);
        const cached = cachedCandidate && cachedCandidate.uid === uid ? cachedCandidate : undefined;

        if (!cached || cached.expiresAt <= Date.now()) {
            if (cached) jobCache.delete(jobId);
            const persisted = readPersistedSimcarClipForUid(uid, jobId);
            const persistedOutputUrl = String(
                persisted?.outputZipUrl ||
                persisted?.files?.outputZipUrl ||
                "",
            ).trim();
            const persistedDownloadUrl = String(persisted?.downloadUrl || "").trim();
            const persistedUrl = persistedOutputUrl ||
                (persistedDownloadUrl.includes(`/api/simcar/clip/download/${jobId}`) ? "" : persistedDownloadUrl);
            if (persistedUrl) {
                res.redirect(toPublicApiUrl(persistedUrl));
                return;
            }
            res.status(404).json({
                error: "Download expirado ou não encontrado. Processe novamente.",
            });
            return;
        }
        if (!cached.buffer) {
            if (cached.outputZipUrl) {
                res.redirect(toPublicApiUrl(cached.outputZipUrl));
                return;
            }
            res.status(404).json({ error: "Arquivo do recorte não disponível no cache." });
            return;
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${cached.filename}"`);
        res.setHeader("Content-Length", cached.buffer.length.toString());
        res.send(cached.buffer);
    });

    // Estado das 3 fases da análise pós-recorte (plano analise-pos-recorte, F0.5).
    // O painel do front monta os cards a partir daqui, sem baixar os laudos inteiros.
    app.get("/api/simcar/clip/phases/:jobId", async (req: Request, res: Response) => {
        const jobId = String(req.params.jobId || "").trim();
        if (!jobId) {
            res.status(400).json({ error: "jobId é obrigatório." });
            return;
        }
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            const persisted = (readPersistedSimcarClipForUid(uid, jobId) || {}) as Record<string, unknown>;
            const job = await hydrateCachedJob(jobId, undefined, undefined, uid);
            if (!job) {
                res.status(404).json({
                    error: "Job de recorte não encontrado. O servidor não localizou contexto ou ZIP persistido para reidratar o recorte.",
                    code: "JOB_NOT_FOUND",
                });
                return;
            }
            const phaseConfig = getAuasV2Config();
            res.json(
                derivePhases({
                    jobId,
                    auasPolygonCount: countLayerPolygons(job.clippedGeometries, "AUAS"),
                    acPolygonCount: countLayerPolygons(job.clippedGeometries, "AREA_CONSOLIDADA"),
                    auasMeta: (persisted as Record<string, unknown>).auasMeta,
                    auasPos2008Meta: (persisted as Record<string, unknown>).auasPos2008Meta,
                    acVegetacaoMeta: (persisted as Record<string, unknown>).acVegetacaoMeta,
                    pos2008Enabled: phaseConfig.phase2Enabled,
                    acVegetacaoEnabled: phaseConfig.phase3Enabled,
                    phaseReports: (persisted as Record<string, unknown>).phaseReports,
                }),
            );
        } catch (err: any) {
            console.error("[SIMCAR PHASES] erro ao montar estado das fases:", err?.message || err);
            res.status(500).json({ error: "Erro ao consultar o estado das fases do recorte." });
        }
    });

    // AUAS analysis endpoint (SSE stream)
    app.post("/api/simcar/clip/analyze-auas", async (req: Request, res: Response) => {
        if (getAuasV2Config().enabled) {
            await handleAuasAnalyzeV2Route(req, res, sendSseHeaders);
            return;
        }
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        let usageInputs: Array<any> = [];
        let chargedBrl = 0;
        let processingJobId = "";
        let sseHeartbeat: ReturnType<typeof setInterval> | null = null;
        let reportArtifact: SimcarReportArtifact | undefined;
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { jobId, previousAnalysis, acAvnMeta, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                previousAnalysis?: string;
                acAvnMeta?: any;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }

            billingRequestId = createRequestId("simcar_auas");
            // AUAS analysis: uses up to ~16 satellite images (8 satellites × 2 views each),
            // plus per-satellite prompts (~4k tokens each) and synthesis call (~8k output tokens)
            const auasSatCount = AUAS_SATELLITE_KEYS.length;
            const auasImagesPerSat = 2; // outline + context views
            billingReserved = await estimateReserveForModels({
                models: simcarBillingModels,
                estimatedInputTokens: 4_500 * auasSatCount,
                estimatedOutputTokens: 800 * auasSatCount + 8_000, // per-sat (~800) + synthesis (~8000)
                safetyMultiplier: 1.3,
                imageCount: auasSatCount * auasImagesPerSat,
                imageWidthPx: 1024,
                imageHeightPx: 768,
            });
            await reserveCredits({
                uid,
                amountBrl: billingReserved,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze-auas",
            });

            sendSseHeaders(res);
            sseHeartbeat = startSseHeartbeat(res);
            const processingJob = startJob({
                uid,
                endpoint: "/api/simcar/clip/analyze-auas",
                metadata: { clipJobId: jobId },
            });
            processingJobId = processingJob.jobId;
            (res as any).__processingJobId = processingJobId;
            req.on("close", () => {
                markDisconnected(processingJobId);
            });
            sendSSE(res, { type: "job_started", jobId: processingJobId });
            console.log(`[AUAS ANALYSIS] Starting AUAS analysis for job: ${jobId}`);
            const auasOutcome = await runWithBillingUsageSession(async () => {
                try {
                    return await processAuasAnalysis(res, jobId, previousAnalysis, contextUrl, outputZipUrl, acAvnMeta, uid);
                } finally {
                    usageInputs = getBillingUsageSessionRecords();
                }
            });
            if (!auasOutcome) {
                if (usageInputs.length > 0) {
                    const billing = await settleReservedCredits({
                        uid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        reservedBrl: billingReserved,
                        usageInputs,
                    });
                    billingReserved = 0;
                    chargedBrl = Number(billing.chargedBrl || 0);
                    sendSSE(res, { type: "billing", billing });
                } else if (billingReserved > 0) {
                    await refundReserve({
                        uid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        reason: "analysis_failed_before_usage",
                    });
                    billingReserved = 0;
                }
                finishJob({
                    jobId: processingJobId,
                    status: "failed",
                    billingSummary: {
                        chargedBrl: Number(chargedBrl.toFixed(4)),
                    },
                    error: "auas_analysis_failed",
                });
                return;
            }
            if (usageInputs.length > 0 || auasOutcome) {
                const usageForSettle = usageInputs.length > 0
                    ? usageInputs
                    : [
                        buildEstimatedUsageForFallback({
                            endpoint: "/api/simcar/clip/analyze-auas",
                            provider: "groq",
                            model: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || GROQ_TEXT_MODELS[0],
                            inputTokens: 120_000,
                            outputTokens: 5200,
                        }),
                    ];
                const billing = await settleReservedCredits({
                    uid,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reservedBrl: billingReserved,
                    usageInputs: usageForSettle,
                });
                billingReserved = 0;
                chargedBrl = Number(billing.chargedBrl || 0);
                sendSSE(res, { type: "billing", billing });
            } else if (billingReserved > 0) {
                await refundReserve({
                    uid,
                    requestId: billingRequestId,
                    amountBrl: billingReserved,
                    endpoint: "/api/simcar/clip/analyze-auas",
                    reason: "no_ai_usage",
                });
                billingReserved = 0;
            }
            await persistSimcarClipArtifacts({
                uid,
                jobId,
                patch: {
                    auasAnalysisImages: auasOutcome.images,
                    auasAnalysisMessages: [{
                        role: "ai",
                        text: auasOutcome.analysisText,
                        images: auasOutcome.images.map((item: { url: string }) => item.url),
                    }],
                    auasMeta: auasOutcome.auasMeta,
                },
            });
            let reportArtifact: SimcarReportArtifact | undefined;
            try {
                sendSSE(res, {
                    type: "progress",
                    step: "generating_report",
                    percent: 96,
                    message: "Gerando PDF técnico da análise...",
                });
                reportArtifact = await generateAndPersistSimcarReport({
                    uid,
                    jobId,
                    contextUrl,
                    outputZipUrl,
                    auasText: auasOutcome.analysisText,
                    auasImages: auasOutcome.images,
                    auasMeta: auasOutcome.auasMeta,
                });
            } catch (reportErr: any) {
                console.warn("[SIMCAR REPORT] AUAS report generation failed:", reportErr?.message || reportErr);
                sendSSE(res, {
                    type: "report_error",
                    message: reportErr?.message || "Falha ao gerar PDF técnico.",
                });
            }
            finishJob({
                jobId: processingJobId,
                status: "completed",
                billingSummary: {
                    chargedBrl: Number(chargedBrl.toFixed(4)),
                },
            });
            const auasSummary = auasOutcome.layerSummaries.find((l) => l.name === "AUAS");
            sendSSE(res, {
                type: "complete",
                percent: 100,
                analysis: auasOutcome.analysisText,
                images: auasOutcome.images,
                layerSummaries: auasOutcome.layerSummaries.filter((l) => ["AUAS", "AREA_CONSOLIDADA", "AVN", "ATP"].includes(l.name)),
                auasAreaHa: auasSummary?.areaHa ?? 0,
                auasMeta: auasOutcome.auasMeta,
                cloudWarnings: auasOutcome.cloudWarnings.length > 0 ? auasOutcome.cloudWarnings : undefined,
                ...(reportArtifact || {}),
            });
        } catch (err: any) {
            if (err instanceof ClientAbortError) {
                if (billingUid && billingReserved > 0 && billingRequestId) {
                    try {
                        if (usageInputs.length > 0) {
                            const billing = await settleReservedCredits({
                                uid: billingUid,
                                requestId: billingRequestId,
                                endpoint: "/api/simcar/clip/analyze-auas",
                                reservedBrl: billingReserved,
                                usageInputs,
                            });
                            chargedBrl = Number(billing.chargedBrl || 0);
                            billingReserved = 0;
                        } else {
                            await refundReserve({
                                uid: billingUid,
                                requestId: billingRequestId,
                                amountBrl: billingReserved,
                                endpoint: "/api/simcar/clip/analyze-auas",
                                reason: "client_abort_without_usage",
                            });
                            billingReserved = 0;
                        }
                        const cancelFloor = await applyCancelFloorDebit({
                            uid: billingUid,
                            requestId: billingRequestId,
                            endpoint: "/api/simcar/clip/analyze-auas",
                            chargedBrl,
                        });
                        chargedBrl = cancelFloor.finalChargedBrl;
                    } catch (billingErr) {
                        console.error("[AUAS ANALYSIS] client-abort billing error:", billingErr);
                    }
                }
                finishJob({
                    jobId: processingJobId,
                    status: "cancelled",
                    billingSummary: {
                        chargedBrl: Number(chargedBrl.toFixed(4)),
                    },
                    error: "cancel_requested",
                });
                return;
            }
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze-auas",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[AUAS ANALYSIS] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                finishJob({
                    jobId: processingJobId,
                    status: "failed",
                    error: err.message,
                });
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                }
                return;
            }
            console.error("[AUAS ANALYSIS] Unexpected error:", err);
            finishJob({
                jobId: processingJobId,
                status: "failed",
                error: err?.message || "unexpected_error",
            });
            if (res.headersSent) {
                sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
            } else {
                res.status(500).json({ error: err.message || "Erro interno inesperado." });
            }
        } finally {
            if (sseHeartbeat) clearInterval(sseHeartbeat);
            if (!res.writableEnded) res.end();
        }
    });

    // Fase 2 — datação 2009–2019 das AUAS (SSE stream, padrão V2 da Fase 1).
    app.post("/api/simcar/clip/analyze-auas-pos2008", async (req: Request, res: Response) => {
        await handlePos2008Route(req, res, sendSseHeaders);
    });

    // Fase 3 — vegetação na Área Consolidada (SSE stream).
    app.post("/api/simcar/clip/analyze-ac-vegetacao", async (req: Request, res: Response) => {
        await handleAcVegetacaoRoute(req, res, sendSseHeaders);
    });

    // Catálogo de imagens WMS resolvido (prévia/diagnóstico para o painel).
    app.get("/api/simcar/imagery/catalog", async (req: Request, res: Response) => {
        await handleImageryCatalogRoute(req, res);
    });

    // AI analysis endpoint (SSE stream)
    app.post("/api/simcar/clip/analyze", async (req: Request, res: Response) => {
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        let usageInputs: Array<any> = [];
        let chargedBrl = 0;
        let processingJobId = "";
        let sseHeartbeat: ReturnType<typeof setInterval> | null = null;
        let reportArtifact: SimcarReportArtifact | undefined;
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { jobId, selectedLayers, imageOnly, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                selectedLayers?: string[];
                imageOnly?: boolean;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }

            const requestedLayers = Array.isArray(selectedLayers) ? selectedLayers : [];
            const layers = requestedLayers.length > 0
                ? getOrderedSatelliteKeys(requestedLayers)
                : getFixedAcAvnSatelliteKeys();
            if (requestedLayers.length > 0) {
                console.log(
                    `[SIMCAR ANALYSIS] Using requested layers after sanitization (${layers.join(", ")}).`,
                );
            }
            const aiAnalysis = !imageOnly;

            if (aiAnalysis) {
                const satelliteFactor = Math.max(1, layers.length + 1);
                // Reserva por cena: desde o commit `0e429b3b` cada satelite gera
                // UM composite (1024x768) com AC + AVN + AUAS + ARL sobrepostos,
                // nao as 3 vistas antigas. Com a janela AC/AVN de 2003 a 2008 sao
                // 7 cenas — manter o 3 aqui inflava a reserva em 3x.
                const imagesPerSat = 1;
                const totalImages = layers.length * imagesPerSat;
                const promptTextTokens = 4_500; // buildAnalysisPrompt generates ~4.5k tokens
                const outputTokensPerCall = 6_000;
                billingRequestId = createRequestId("simcar_analyze");
                billingReserved = await estimateReserveForModels({
                    models: simcarBillingModels,
                    estimatedInputTokens: promptTextTokens * satelliteFactor,
                    estimatedOutputTokens: outputTokensPerCall * satelliteFactor,
                    safetyMultiplier: 1.3,
                    imageCount: totalImages,
                    imageWidthPx: 1024,
                    imageHeightPx: 768,
                });
                await reserveCredits({
                    uid,
                    amountBrl: billingReserved,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze",
                });
            }

            sendSseHeaders(res);
            sseHeartbeat = startSseHeartbeat(res);
            const processingJob = startJob({
                uid,
                endpoint: "/api/simcar/clip/analyze",
                metadata: { clipJobId: jobId, imageOnly: !aiAnalysis },
            });
            processingJobId = processingJob.jobId;
            (res as any).__processingJobId = processingJobId;
            req.on("close", () => {
                markDisconnected(processingJobId);
            });
            sendSSE(res, { type: "job_started", jobId: processingJobId });
            console.log(`[SIMCAR ANALYSIS] Starting analysis for job: ${jobId}, layers: ${layers.join(",")}, aiAnalysis: ${aiAnalysis}`);

            let analysisCompletePayload: AcAvnAnalysisResult | null = null;
            if (aiAnalysis) {
                const analysisOutcome = await runWithBillingUsageSession(async () => {
                    try {
                        return await processAnalysis(res, jobId, layers, true, contextUrl, outputZipUrl, uid);
                    } finally {
                        usageInputs = getBillingUsageSessionRecords();
                    }
                });
                if (!analysisOutcome) {
                    if (usageInputs.length > 0) {
                        const billing = await settleReservedCredits({
                            uid,
                            requestId: billingRequestId,
                            endpoint: "/api/simcar/clip/analyze",
                            reservedBrl: billingReserved,
                            usageInputs,
                        });
                        billingReserved = 0;
                        chargedBrl = Number(billing.chargedBrl || 0);
                        sendSSE(res, { type: "billing", billing });
                    } else if (billingReserved > 0) {
                        await refundReserve({
                            uid,
                            requestId: billingRequestId,
                            amountBrl: billingReserved,
                            endpoint: "/api/simcar/clip/analyze",
                            reason: "analysis_failed_before_usage",
                        });
                        billingReserved = 0;
                    }
                    finishJob({
                        jobId: processingJobId,
                        status: "failed",
                        billingSummary: {
                            chargedBrl: Number(chargedBrl.toFixed(4)),
                        },
                        error: "simcar_analysis_failed",
                    });
                    return;
                }
                analysisCompletePayload = analysisOutcome;
                sendSSE(res, {
                    type: "progress",
                    step: "finalizing",
                    percent: 96,
                    message: "Finalizando análise, cobrança e salvamento do histórico...",
                });
                if (usageInputs.length > 0 || analysisOutcome) {
                    const usageForSettle = usageInputs.length > 0
                        ? usageInputs
                        : [
                            buildEstimatedUsageForFallback({
                                endpoint: "/api/simcar/clip/analyze",
                                provider: "groq",
                                model: SIMCAR_SYNTHESIS_PRIMARY_TEXT_MODEL || GROQ_TEXT_MODELS[0],
                                inputTokens: 90_000 + Math.max(1, layers.length) * 26_000,
                                outputTokens: 4200,
                            }),
                        ];
                    const billing = await settleReservedCredits({
                        uid,
                        requestId: billingRequestId,
                        endpoint: "/api/simcar/clip/analyze",
                        reservedBrl: billingReserved,
                        usageInputs: usageForSettle,
                    });
                    billingReserved = 0;
                    chargedBrl = Number(billing.chargedBrl || 0);
                    sendSSE(res, { type: "billing", billing });
                } else if (billingReserved > 0) {
                    await refundReserve({
                        uid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze",
                        reason: "no_ai_usage",
                    });
                    billingReserved = 0;
                }
                if (!analysisOutcome.imageOnly) {
                    await persistSimcarClipArtifacts({
                        uid,
                        jobId,
                        patch: {
                            analysisImages: analysisOutcome.cloudinaryUrls,
                            analysisMessages: [{
                                role: "ai",
                                text: analysisOutcome.analysisText,
                                images: analysisOutcome.cloudinaryUrls.map((item: { url: string }) => item.url),
                            }],
                            analysisMeta: analysisOutcome.analysisMeta,
                            analysisRulesVersion: "acavn-fixed-v5",
                        },
                    });
                    try {
                        sendSSE(res, {
                            type: "progress",
                            step: "generating_report",
                            percent: 98,
                            message: "Gerando PDF técnico da análise...",
                        });
                        reportArtifact = await generateAndPersistSimcarReport({
                            uid,
                            jobId,
                            contextUrl,
                            outputZipUrl,
                            analysisText: analysisOutcome.analysisText,
                            analysisImages: analysisOutcome.cloudinaryUrls,
                            analysisMeta: analysisOutcome.analysisMeta,
                        });
                    } catch (reportErr: any) {
                        console.warn("[SIMCAR REPORT] AC/AVN report generation failed:", reportErr?.message || reportErr);
                        sendSSE(res, {
                            type: "report_error",
                            message: reportErr?.message || "Falha ao gerar PDF técnico.",
                        });
                    }
                }
            } else {
                const imageOnlyOutcome = await processAnalysis(res, jobId, layers, false, contextUrl, outputZipUrl, uid);
                if (!imageOnlyOutcome) {
                    finishJob({
                        jobId: processingJobId,
                        status: "failed",
                        error: "simcar_image_generation_failed",
                    });
                    return;
                }
                analysisCompletePayload = imageOnlyOutcome;
                sendSSE(res, {
                    type: "progress",
                    step: "finalizing",
                    percent: 96,
                    message: "Finalizando geração de imagens...",
                });
            }
            finishJob({
                jobId: processingJobId,
                status: "completed",
                billingSummary: {
                    chargedBrl: Number(chargedBrl.toFixed(4)),
                },
            });
            if (analysisCompletePayload) {
                sendAcAvnComplete(res, analysisCompletePayload, reportArtifact);
            }
        } catch (err: any) {
            if (err instanceof ClientAbortError) {
                if (billingUid && billingReserved > 0 && billingRequestId) {
                    try {
                        if (usageInputs.length > 0) {
                            const billing = await settleReservedCredits({
                                uid: billingUid,
                                requestId: billingRequestId,
                                endpoint: "/api/simcar/clip/analyze",
                                reservedBrl: billingReserved,
                                usageInputs,
                            });
                            chargedBrl = Number(billing.chargedBrl || 0);
                            billingReserved = 0;
                        } else {
                            await refundReserve({
                                uid: billingUid,
                                requestId: billingRequestId,
                                amountBrl: billingReserved,
                                endpoint: "/api/simcar/clip/analyze",
                                reason: "client_abort_without_usage",
                            });
                            billingReserved = 0;
                        }
                        const cancelFloor = await applyCancelFloorDebit({
                            uid: billingUid,
                            requestId: billingRequestId,
                            endpoint: "/api/simcar/clip/analyze",
                            chargedBrl,
                        });
                        chargedBrl = cancelFloor.finalChargedBrl;
                    } catch (billingErr) {
                        console.error("[SIMCAR ANALYSIS] client-abort billing error:", billingErr);
                    }
                }
                finishJob({
                    jobId: processingJobId,
                    status: "cancelled",
                    billingSummary: {
                        chargedBrl: Number(chargedBrl.toFixed(4)),
                    },
                    error: "cancel_requested",
                });
                return;
            }
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR ANALYSIS] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                finishJob({
                    jobId: processingJobId,
                    status: "failed",
                    error: err.message,
                });
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                }
                return;
            }
            console.error("[SIMCAR ANALYSIS] Unexpected error:", err);
            finishJob({
                jobId: processingJobId,
                status: "failed",
                error: err?.message || "unexpected_error",
            });
            if (res.headersSent) {
                sendSSE(res, { type: "error", message: err.message || "Erro interno inesperado." });
            } else {
                res.status(500).json({ error: err.message || "Erro interno inesperado." });
            }
        } finally {
            if (sseHeartbeat) clearInterval(sseHeartbeat);
            if (!res.writableEnded) res.end();
        }
    });

    // AI follow-up chat endpoint
    app.post("/api/simcar/clip/analyze/chat", async (req: Request, res: Response) => {
        const streamMode = String((req.query as any)?.stream || "").toLowerCase() === "1";
        let billingUid = "";
        let billingRequestId = "";
        let billingReserved = 0;
        let chargedBrl = 0;
        let processingJobId = "";
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            billingUid = uid;

            const { messages } = req.body as {
                messages?: Array<{ role: string; content: any }>;
            };

            if (!messages || !Array.isArray(messages) || messages.length === 0) {
                if (streamMode) {
                    sendSseHeaders(res);
                    sendSSE(res, { type: "error", message: "Mensagens inválidas." });
                    if (!res.writableEnded) res.end();
                    return;
                }
                res.status(400).json({ error: "Mensagens inválidas." });
                return;
            }

            const incomingChars = messages.reduce(
                (acc, msg) => acc + normalizeAssistantContent((msg as any)?.content).length,
                0,
            );
            const compactedMessages = compactChatMessages(messages);
            const compactedChars = compactedMessages.reduce((acc, msg) => acc + msg.content.length, 0);
            if (compactedMessages.length === 0) {
                if (streamMode) {
                    sendSseHeaders(res);
                    sendSSE(res, { type: "error", message: "Sem contexto textual válido para análise." });
                    if (!res.writableEnded) res.end();
                    return;
                }
                res.status(400).json({ error: "Sem contexto textual válido para análise." });
                return;
            }
            if (compactedMessages.length !== messages.length || compactedChars !== incomingChars) {
                console.log(
                    `[SIMCAR ANALYSIS CHAT] Context compacted: msgs ${messages.length} -> ${compactedMessages.length}, ` +
                    `chars ${incomingChars} -> ${compactedChars}`,
                );
            }
            const optimizedMessages = [
                {
                    role: "system",
                    content:
                        "Responda de forma objetiva e técnica. " +
                        "Nao inclua bloco <think>, cadeia de raciocinio interna ou repeticoes longas.",
                },
                ...compactedMessages,
            ];

            billingRequestId = createRequestId(streamMode ? "simcar_chat_stream" : "simcar_chat");
            billingReserved = await estimateReserveForModels({
                models: Array.from(new Set([...GROQ_TEXT_MODELS, ...SIMCAR_SYNTHESIS_TEXT_MODELS])),
                estimatedInputTokens: estimateTokensFromMessages(optimizedMessages),
                estimatedOutputTokens: 6600,
                safetyMultiplier: 1.2,
            });
            await reserveCredits({
                uid,
                amountBrl: billingReserved,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze/chat",
            });

            if (streamMode) {
                sendSseHeaders(res);
                const processingJob = startJob({
                    uid,
                    endpoint: "/api/simcar/clip/analyze/chat",
                    metadata: { mode: "stream" },
                });
                processingJobId = processingJob.jobId;
                (res as any).__processingJobId = processingJobId;
                req.on("close", () => {
                    markDisconnected(processingJobId);
                });
                sendSSE(res, { type: "job_started", jobId: processingJobId });
                await runWithBillingUsageSession(async () => {
                    await streamTextFollowUp(res, optimizedMessages, {
                        throwIfCancelled: () => {
                            if (processingJobId && isCancelRequested(processingJobId)) {
                                throw new ClientAbortError();
                            }
                        },
                    });
                });
                const usageInputs = getBillingUsageSessionRecords();
                const usageForSettle = usageInputs.length > 0
                    ? usageInputs
                    : [
                        buildEstimatedUsageForFallback({
                            endpoint: "/api/simcar/clip/analyze/chat",
                            provider: "groq",
                            model: GROQ_TEXT_MODELS[0] || "openai/gpt-oss-120b",
                            inputTokens: Math.max(1, estimateTokensFromMessages(optimizedMessages)),
                            outputTokens: 1800,
                        }),
                    ];
                const billing = await settleReservedCredits({
                    uid,
                    requestId: billingRequestId,
                    endpoint: "/api/simcar/clip/analyze/chat",
                    reservedBrl: billingReserved,
                    usageInputs: usageForSettle,
                });
                billingReserved = 0;
                chargedBrl = Number(billing.chargedBrl || 0);
                sendSSE(res, { type: "billing", billing });
                finishJob({
                    jobId: processingJobId,
                    status: "completed",
                    billingSummary: { chargedBrl: Number(chargedBrl.toFixed(4)) },
                });
                if (!res.writableEnded) res.end();
                return;
            }

            const reply = await runWithBillingUsageSession(async () =>
                callTextFollowUp(optimizedMessages, { contextLabel: "chat" }),
            );
            const usageInputs = getBillingUsageSessionRecords();
            const usageForSettle = usageInputs.length > 0
                ? usageInputs
                : [
                    {
                        provider: "groq" as const,
                        model: GROQ_TEXT_MODELS[0] || "openai/gpt-oss-120b",
                        inputTokens: Math.max(1, estimateTokensFromMessages(optimizedMessages)),
                        outputTokens: Math.max(1, estimateTokensFromText(reply)),
                        estimated: true,
                    },
                ];
            const billing = await settleReservedCredits({
                uid,
                requestId: billingRequestId,
                endpoint: "/api/simcar/clip/analyze/chat",
                reservedBrl: billingReserved,
                usageInputs: usageForSettle,
            });
            billingReserved = 0;
            res.json({ content: reply, billing });
        } catch (err: any) {
            if (err instanceof ClientAbortError && streamMode) {
                if (billingUid && billingReserved > 0 && billingRequestId) {
                    try {
                        const usageInputs = getBillingUsageSessionRecords();
                        if (usageInputs.length > 0) {
                            const settled = await settleReservedCredits({
                                uid: billingUid,
                                requestId: billingRequestId,
                                endpoint: "/api/simcar/clip/analyze/chat",
                                reservedBrl: billingReserved,
                                usageInputs,
                            });
                            chargedBrl = Number(settled.chargedBrl || 0);
                            billingReserved = 0;
                        } else {
                            await refundReserve({
                                uid: billingUid,
                                requestId: billingRequestId,
                                amountBrl: billingReserved,
                                endpoint: "/api/simcar/clip/analyze/chat",
                                reason: "cancel_requested_without_usage",
                            });
                            billingReserved = 0;
                        }
                        const cancelFloor = await applyCancelFloorDebit({
                            uid: billingUid,
                            requestId: billingRequestId,
                            endpoint: "/api/simcar/clip/analyze/chat",
                            chargedBrl,
                        });
                        chargedBrl = cancelFloor.finalChargedBrl;
                    } catch (cancelErr) {
                        console.error("[SIMCAR ANALYSIS CHAT] cancel billing error:", cancelErr);
                    }
                }
                finishJob({
                    jobId: processingJobId,
                    status: "cancelled",
                    billingSummary: { chargedBrl: Number(chargedBrl.toFixed(4)) },
                    error: "cancel_requested",
                });
                if (streamMode && !res.writableEnded) {
                    sendSSE(res, { type: "cancelled", message: "Cancelamento solicitado. Cobrança proporcional aplicada." });
                    res.end();
                }
                return;
            }
            if (billingUid && billingReserved > 0 && billingRequestId) {
                try {
                    await refundReserve({
                        uid: billingUid,
                        requestId: billingRequestId,
                        amountBrl: billingReserved,
                        endpoint: "/api/simcar/clip/analyze/chat",
                        reason: "exception",
                    });
                } catch (refundErr) {
                    console.error("[SIMCAR ANALYSIS CHAT] refund error:", refundErr);
                }
            }
            if (err instanceof BillingError) {
                finishJob({
                    jobId: processingJobId,
                    status: "failed",
                    error: err.message,
                });
                if (!res.headersSent) {
                    res.status(err.statusCode).json({ error: err.message, code: err.code });
                } else {
                    sendSSE(res, { type: "error", message: err.message, code: err.code });
                    if (!res.writableEnded) res.end();
                }
                return;
            }
            console.error("[SIMCAR ANALYSIS CHAT] Error:", err);
            finishJob({
                jobId: processingJobId,
                status: "failed",
                error: err?.message || "unexpected_error",
            });
            if (streamMode) {
                if (res.headersSent) {
                    sendSSE(res, { type: "error", message: err.message || "Erro interno." });
                    if (!res.writableEnded) res.end();
                } else {
                    res.status(500).json({ error: err.message || "Erro interno." });
                }
                return;
            }
            res.status(500).json({ error: err.message || "Erro interno." });
        }
    });

    app.post("/api/simcar/clip/report", async (req: Request, res: Response) => {
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            const { jobId, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                contextUrl?: string;
                outputZipUrl?: string;
                force?: boolean;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }
            const artifact = await generateAndPersistSimcarReport({
                uid,
                jobId,
                contextUrl,
                outputZipUrl,
            });
            res.json({ ok: true, ...artifact });
        } catch (err: any) {
            console.error("[SIMCAR REPORT] Error:", err);
            res.status(500).json({ error: err.message || "Falha ao gerar PDF técnico." });
        }
    });

    // Mesmo laudo do PDF, em Word. Compartilha o modelo (report-theme) e o
    // papel timbrado da IMAP — muda só o renderizador.
    app.post("/api/simcar/clip/report-docx", async (req: Request, res: Response) => {
        try {
            const uid = String(req.authUid || "");
            if (!uid) {
                res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
                return;
            }
            const { jobId, contextUrl, outputZipUrl } = req.body as {
                jobId?: string;
                contextUrl?: string;
                outputZipUrl?: string;
            };
            if (!jobId) {
                res.status(400).json({ error: "jobId é obrigatório." });
                return;
            }
            const artifact = await generateAndPersistSimcarReportDocx({
                uid,
                jobId,
                contextUrl,
                outputZipUrl,
            });
            res.json({ ok: true, ...artifact });
        } catch (err: any) {
            console.error("[SIMCAR REPORT DOCX] Error:", err);
            res.status(500).json({ error: err.message || "Falha ao gerar laudo em Word." });
        }
    });

    // Layer list endpoint (for frontend checkbox list)
    app.get("/api/simcar/layers", (_req: Request, res: Response) => {
        res.json({
            // TIPOLOGIA_VEGETAL não é oferecida: ela não sai em artefato
            // entregue (ver EXPORT_EXCLUDED_LAYERS), então marcá-la aqui só
            // criaria a expectativa de encontrá-la no ZIP.
            layers: TEMPLATE_LAYERS.filter((name) => !isExcludedFromExport(name)).map((name) => ({
                name,
                category: DIRECT_COPY_LAYERS.has(name) ? "property" : "wfs",
            })),
        });
    });

    // Delete clip endpoint: removes Cloudinary resources + cache
    app.delete("/api/simcar/clip/:jobId", async (req: Request, res: Response) => {
        const { jobId } = req.params;
        const { imageUrls, auasImageUrls, inputZipUrl, outputZipUrl, contextUrl, reportPdfUrl } = req.body as {
            imageUrls?: string[];
            auasImageUrls?: string[];
            inputZipUrl?: string;
            outputZipUrl?: string;
            contextUrl?: string;
            reportPdfUrl?: string;
        };

        // A rota apaga arquivos a partir de URLs vindas do corpo: sem uid e sem
        // checagem de posse, qualquer chamador apagaria artefato de outro usuário.
        let uid = "";
        try {
            uid = getAuthUid(req);
        } catch {
            res.status(401).json({ error: "Token de autenticação obrigatório.", code: "UNAUTHENTICATED" });
            return;
        }

        try {
            const cached = jobCache.get(jobId);
            const deletions: Promise<void>[] = [];
            const seen = new Set<string>();
            let skipped = 0;

            const queueDelete = (url: string | undefined, forcedType?: "raw" | "image") => {
                const clean = String(url || "").trim();
                if (!clean) return;
                if (!storagePathBelongsToUid(uid, clean)) {
                    skipped += 1;
                    return;
                }
                const inferredType: "raw" | "image" =
                    forcedType
                    || (/\/raw\/upload\//i.test(clean) || /\.(zip|json)(\?|$)/i.test(clean) ? "raw" : "image");
                const key = `${inferredType}:${clean}`;
                if (seen.has(key)) return;
                seen.add(key);
                deletions.push(deleteFromCloudinary(clean, inferredType));
            };

            // Delete ZIPs from Cloudinary (raw type)
            queueDelete(cached?.inputZipUrl || inputZipUrl, "raw");
            queueDelete(cached?.outputZipUrl || outputZipUrl, "raw");
            queueDelete(cached?.contextJsonUrl || contextUrl, "raw");
            queueDelete(reportPdfUrl || String(readPersistedSimcarClipForUid(uid, jobId)?.reportPdfUrl || ""), "raw");
            // O DOCX do laudo é gerado junto do PDF e precisa morrer junto: sem
            // isto o Word ficava órfão no storage depois de apagar o card.
            queueDelete(String(readPersistedSimcarClipForUid(uid, jobId)?.reportDocxUrl || ""), "raw");

            // Delete analysis images from Cloudinary (image type)
            if (Array.isArray(imageUrls)) {
                for (const url of imageUrls) {
                    queueDelete(url, "image");
                }
            }
            if (Array.isArray(auasImageUrls)) {
                for (const url of auasImageUrls) {
                    queueDelete(url, "image");
                }
            }

            await Promise.allSettled(deletions);
            jobCache.delete(jobId);

            console.log(
                `[SIMCAR CLIP] Deleted job ${jobId} + ${deletions.length} recursos`
                + (skipped ? ` (${skipped} ignorados por não pertencerem ao uid ${uid})` : ""),
            );
            res.json({ ok: true, deleted: deletions.length, skipped });
        } catch (err: any) {
            console.error("[SIMCAR CLIP DELETE] Error:", err);
            res.status(500).json({ error: err.message });
        }
    });
}
