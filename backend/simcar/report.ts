/**
 * PDF Report — geração do laudo técnico SIMCAR em PDF (pdfkit) e persistência.
 * Extraído de simcar-clip.ts (Plano 02, Fase 5b).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { readPersistedSimcarClip, hydrateCachedJob, persistSimcarClipArtifacts } from "./hydration";
import { uploadRawBufferToCloudinary } from "./cloudinary";
import { toPublicApiUrl } from "./constants";
import type { CachedJob, LayerSummary, PersistedClipContextV1 } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIMCAR_REPORT_VERSION = "simcar-report-v1";

export type SimcarReportArtifact = {
    reportPdfUrl: string;
    reportPdfDownloadUrl: string;
    reportPdfFilename: string;
    reportPdfGeneratedAt: string;
    reportPdfVersion: string;
    reportPdfStatus: "ready";
};

export type SimcarReportImage = { url: string; caption: string };

function extractFirstAiText(messages: unknown): string {
    if (!Array.isArray(messages)) return "";
    const found = messages.find((item: any) => item?.role === "ai" && String(item?.text || "").trim());
    return String((found as any)?.text || "").trim();
}

function normalizeReportImages(value: unknown): SimcarReportImage[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item: any) => ({
            url: String(item?.url || "").trim(),
            caption: String(item?.caption || "").trim(),
        }))
        .filter((item) => item.url);
}

function reportCleanText(value: unknown, maxChars = 5000): string {
    return String(value || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/\r/g, "")
        .replace(/\*\*/g, "")
        .replace(/^\s{0,3}#{1,6}\s*/gm, "")
        .replace(/^\s*[-*]\s+/gm, "- ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maxChars);
}

function breakLongPdfToken(token: string, chunkSize = 28): string {
    if (token.length <= chunkSize) return token;
    const chunks: string[] = [];
    for (let i = 0; i < token.length; i += chunkSize) {
        chunks.push(token.slice(i, i + chunkSize));
    }
    return chunks.join(" ");
}

function reportPdfSafeText(value: unknown, maxChars = 5000): string {
    return reportCleanText(value, maxChars)
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[imagem incorporada]")
        .replace(/https?:\/\/\S+/gi, (rawUrl) => {
            const cleanUrl = rawUrl.replace(/[),.;:]+$/g, "");
            try {
                const parsed = new URL(cleanUrl);
                return `[link: ${parsed.hostname}]`;
            } catch {
                return "[link externo]";
            }
        })
        .replace(/[^\s]{42,}/g, (token) => breakLongPdfToken(token))
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
}

function reportSingleLineText(value: unknown, maxChars = 120): string {
    const clean = reportPdfSafeText(value, maxChars * 2).replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function splitPdfTextChunks(value: string, maxChunkChars = 950): string[] {
    const chunks: string[] = [];
    for (const paragraph of value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
        let remaining = paragraph;
        while (remaining.length > maxChunkChars) {
            const splitAt = Math.max(
                remaining.lastIndexOf(". ", maxChunkChars),
                remaining.lastIndexOf("; ", maxChunkChars),
                remaining.lastIndexOf(", ", maxChunkChars),
                remaining.lastIndexOf(" ", maxChunkChars),
            );
            const safeSplit = splitAt > 160 ? splitAt + 1 : maxChunkChars;
            chunks.push(remaining.slice(0, safeSplit).trim());
            remaining = remaining.slice(safeSplit).trim();
        }
        if (remaining) chunks.push(remaining);
    }
    return chunks;
}

function reportStatusLabel(value: unknown): string {
    const clean = String(value || "").trim().toUpperCase();
    const labels: Record<string, string> = {
        SIM: "Sim",
        NAO: "Não",
        MEDIA: "Média",
        ALTA: "Alta",
        BAIXA: "Baixa",
        INCONCLUSIVO: "Inconclusivo",
        AUAS_VALIDA: "AUAS válida",
        AUAS_INVALIDA: "AUAS inválida",
        AUAS_PARCIAL: "AUAS parcial",
    };
    return labels[clean] || (clean ? clean : "Não informado");
}

const AUAS_PRE2008_STATUS_LABEL: Record<string, string> = {
    ALERTA_PRE_2008: "Alerta pré-2008",
    SEM_EVIDENCIA_PRE_2008: "Sem evidência pré-2008",
    INCONCLUSIVO: "Inconclusivo",
};

/**
 * Resumo executivo da seção AUAS no PDF. V2 (schemaVersion 2) usa
 * pre2008Status/pre2008Alert e nunca o texto "passivo pós-2008" do V1.
 */
function formatAuasExecutiveSummaryLine(auasMeta: any): string {
    if (auasMeta?.schemaVersion === 2) {
        const statusLabel = AUAS_PRE2008_STATUS_LABEL[String(auasMeta.status || "")] || "Não informado";
        const alertLabel = auasMeta.pre2008Alert === true ? "Sim" : auasMeta.pre2008Alert === false ? "Não" : "Não informado";
        const polygonCount = Number(auasMeta.summary?.polygonCount || 0);
        return `Síntese de AUAS (pré-2008, análise por polígono): ${statusLabel}. Alerta de antropização anterior a 2008: ${alertLabel}. Polígonos AUAS analisados individualmente: ${polygonCount}. O nível de confiança atribuído é ${reportStatusLabel(auasMeta.confidence)}.`;
    }
    return `Síntese de AUAS: ${reportStatusLabel(auasMeta.finalStatus)}. Identificação de passivo ambiental: ${auasMeta.passivoAmbiental === true ? "Sim" : auasMeta.passivoAmbiental === false ? "Não" : "Não informado"}. O nível de confiança atribuído a esta análise é ${reportStatusLabel(auasMeta.confidence)}.`;
}

function selectPrincipalReportImages(acImages: SimcarReportImage[], auasImages: SimcarReportImage[]): SimcarReportImage[] {
    const scoreImage = (img: SimcarReportImage) => {
        const cap = img.caption.toLowerCase();
        let score = 0;
        if (/vis[aã]o geral|context/i.test(cap)) score += 5;
        if (/auas|area consolidada|área consolidada|avn|arl/i.test(cap)) score += 3;
        if (/spot|landsat|sentinel/i.test(cap)) score += 1;
        return score;
    };
    const pick = (images: SimcarReportImage[], limit: number) =>
        images
            .filter((img, idx, arr) => img.url && arr.findIndex((other) => other.url === img.url) === idx)
            .sort((a, b) => scoreImage(b) - scoreImage(a))
            .slice(0, limit);
    return [...pick(acImages, 4), ...pick(auasImages, 4)].slice(0, 8);
}

async function fetchReportImageBuffer(url: string): Promise<Buffer | null> {
    const clean = toPublicApiUrl(url);
    if (!clean) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(clean, { signal: controller.signal });
        if (!response.ok) return null;
        const arr = await response.arrayBuffer();
        return Buffer.from(arr);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function buildSimcarReportPdfBuffer(args: {
    jobId: string;
    filename: string;
    sourceMode?: string;
    summary?: any;
    job?: CachedJob;
    analysisText?: string;
    analysisMeta?: any;
    analysisImages: SimcarReportImage[];
    auasText?: string;
    auasMeta?: any;
    auasImages: SimcarReportImage[];
}): Promise<Buffer> {
    const selectedImages = selectPrincipalReportImages(args.analysisImages, args.auasImages);
    const imageBuffers = await Promise.all(
        selectedImages.map(async (img) => ({ ...img, buffer: await fetchReportImageBuffer(img.url) })),
    );
    const logoPath = path.resolve(__dirname, "..", "geoforest_app_logo.png");
    const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    const doc = new PDFDocument({
        size: "A4",
        margin: 42,
        bufferPages: true,
        info: {
            Title: `Laudo Técnico SIMCAR - ${args.jobId}`,
            Author: "GeoForest IA",
            Subject: "Relatório técnico de análise SIMCAR",
        },
    });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 42;
    const contentW = pageW - margin * 2;
    
    // Paleta de Cores
    const colors = {
        primary: "#059669", // Emerald 600
        primaryLight: "#D1FAE5", // Emerald 100
        primaryBg: "#ECFDF5", // Emerald 50
        dark: "#0F172A", // Slate 900
        darkText: "#1E293B", // Slate 800
        text: "#334155", // Slate 700
        lightText: "#64748B", // Slate 500
        border: "#E2E8F0", // Slate 200
        bg: "#F8FAFC" // Slate 50
    };

    const ensureSpace = (height: number) => {
        if (doc.y + height > pageH - margin) {
            doc.addPage();
            doc.font("Helvetica").fillColor(colors.lightText).fontSize(8).text(`GeoForest IA | Laudo SIMCAR | Job ${reportSingleLineText(args.jobId, 44)}`, margin, 24, {
                width: contentW,
                align: "right",
            });
            doc.x = margin;
            doc.moveDown(1.5);
        }
    };

    const sectionTitle = (title: string) => {
        ensureSpace(40);
        doc.moveDown(1);
        doc.font("Helvetica-Bold").fontSize(15).fillColor(colors.dark).text(title, margin, doc.y, { align: "left" });
        doc.moveTo(margin, doc.y + 6).lineTo(pageW - margin, doc.y + 6).strokeColor(colors.primary).lineWidth(1.5).stroke();
        doc.moveDown(1.2);
        doc.x = margin;
    };

    const bodyText = (text: string, maxChars = 2800) => {
        const clean = reportPdfSafeText(text, maxChars);
        if (!clean) {
            doc.font("Helvetica").fontSize(10).fillColor(colors.lightText).text("Não informado.", margin, doc.y, { width: contentW, lineGap: 4, align: 'left' });
            doc.x = margin;
            return;
        }
        for (const block of splitPdfTextChunks(clean)) {
            doc.font("Helvetica").fontSize(10);
            const blockHeight = doc.heightOfString(block, { width: contentW, lineGap: 3, align: "left" });
            ensureSpace(Math.min(blockHeight + 16, pageH - margin * 2));
            doc.font("Helvetica").fontSize(10).fillColor(colors.text).text(block, margin, doc.y, {
                width: contentW,
                lineGap: 3,
                align: "left",
            });
            doc.x = margin;
            doc.moveDown(0.5);
        }
    };

    const metric = (label: string, value: string, x: number, y: number, w: number) => {
        doc.roundedRect(x, y, w, 60, 8).fillAndStroke(colors.primaryBg, colors.primaryLight);
        doc.font("Helvetica-Bold").fontSize(14).fillColor(colors.primary).text(reportSingleLineText(value, 24), x + 12, y + 14, { width: w - 24, align: "left" });
        doc.font("Helvetica").fontSize(8.5).fillColor(colors.lightText).text(reportSingleLineText(label, 34), x + 12, y + 36, { width: w - 24, align: "left" });
    };

    // --- Header ---
    doc.rect(0, 0, pageW, 180).fill(colors.dark);
    if (logoBuffer) {
        try {
            doc.image(logoBuffer, margin, 40, { fit: [52, 52] });
        } catch {
            // Ignora a imagem se não decodificar
        }
    }
    
    doc.font("Helvetica-Bold").fontSize(26).fillColor("#FFFFFF").text("Laudo Técnico SIMCAR", margin + 70, 44, {
        width: contentW - 70,
        align: "left"
    });
    doc.font("Helvetica").fontSize(11).fillColor(colors.primaryLight).text("Relatório executivo gerado automaticamente pela GeoForest IA", margin + 70, 78, {
        width: contentW - 70,
        align: "left"
    });
    
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#FFFFFF").text(reportSingleLineText(args.filename || "Recorte SIMCAR", 130), margin, 126, {
        width: contentW,
        align: "left"
    });
    doc.font("Helvetica").fontSize(9.5).fillColor(colors.lightText).text(
        `Job: ${reportSingleLineText(args.jobId, 44)} | Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })}`,
        margin,
        146,
        { width: contentW, align: "left" },
    );

    // Initial Y position after header
    doc.y = 210;
    doc.x = margin;
    
    // --- Metrics Section ---
    const summary = args.summary || {};
    const layers = Array.isArray(summary.layers) ? summary.layers : (args.job?.layerSummaries || []);
    const propertyAreaHa = Number(summary.propertyAreaHa || args.job?.areaHa || 0);
    const layersWithData = Number(summary.layersWithData || layers.filter((l: any) => Number(l?.features || 0) > 0).length || 0);
    const totalFeatures = Number(summary.totalFeaturesClipped || layers.reduce((sum: number, l: any) => sum + Number(l?.features || 0), 0));
    const totalLayers = Number(summary.layersProcessed || layers.length || 0);
    
    const metricGap = 12;
    const metricW = (contentW - metricGap * 3) / 4;
    
    const metricsStartY = doc.y; // Fixa a posição Y
    metric("Área do imóvel", `${propertyAreaHa.toFixed(2)} ha`, margin, metricsStartY, metricW);
    metric("Camadas com dados", `${layersWithData}/${totalLayers}`, margin + (metricW + metricGap), metricsStartY, metricW);
    metric("Feições recortadas", String(totalFeatures), margin + (metricW + metricGap) * 2, metricsStartY, metricW);
    metric("Modo de Análise", args.sourceMode === "vectorized-analysis" ? "Vetorizado" : "Recorte", margin + (metricW + metricGap) * 3, metricsStartY, metricW);
    
    // Restaura as coordenadas para debaixo das métricas
    doc.x = margin;
    doc.y = metricsStartY + 85;

    // --- Resumo Executivo ---
    const acMeta = args.analysisMeta?.globalVerdict || {};
    const auasMeta = args.auasMeta || {};
    sectionTitle("Resumo Executivo");
    const executive = [
        `A análise técnica SIMCAR foi processada com sucesso para o identificador de serviço ${args.jobId}.`,
        `Durante o processamento, foram avaliadas ${totalLayers} camadas ambientais. Identificou-se a presença de dados sobrepostos à propriedade em ${layersWithData} camada(s), resultando no recorte e extração de ${totalFeatures} feição(ões) vetorial(is).`,
        args.analysisText ? `Indicadores de Área Consolidada (AC): ${reportStatusLabel(acMeta.acForaShape)} para áreas fora da poligonal declarada. Indicadores de Vegetação Nativa (AVN): ${reportStatusLabel(acMeta.avnDentroShapeAntropizado)} para antropização dentro da poligonal. O nível de confiança atribuído a esta análise é ${reportStatusLabel(acMeta.confidence)}.` : "",
        args.auasText ? formatAuasExecutiveSummaryLine(auasMeta) : "",
    ].filter(Boolean).join("\n\n");
    bodyText(executive, 2200);

    // --- Tabela de Camadas ---
    sectionTitle("Quantitativos por Camada");
    const withData = layers.filter((l: any) => Number(l?.features || 0) > 0).slice(0, 20);
    if (withData.length === 0) {
        bodyText("Nenhuma camada ambiental estadual ou federal apresentou sobreposição com a área do imóvel analisado.", 800);
    } else {
        const tableStartY = doc.y;
        
        doc.rect(margin, tableStartY, contentW, 24).fill(colors.primary);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF");
        doc.text("Camada Ambiental", margin + 10, tableStartY + 8, { width: 180, align: "left" });
        doc.text("Origem", margin + 200, tableStartY + 8, { width: 70, align: "left" });
        doc.text("Feições", margin + 280, tableStartY + 8, { width: 60, align: "right" });
        doc.text("Área (ha)", margin + 350, tableStartY + 8, { width: 70, align: "right" });
        doc.text("% Imóvel", margin + 430, tableStartY + 8, { width: 65, align: "right" });
        
        let currentY = tableStartY + 24;
        
        withData.forEach((layer: any, idx: number) => {
            ensureSpace(24);
            if (doc.y < currentY) {
                currentY = doc.y;
                doc.rect(margin, currentY, contentW, 24).fill(colors.primary);
                doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF");
                doc.text("Camada Ambiental", margin + 10, currentY + 8, { width: 180, align: "left" });
                doc.text("Origem", margin + 200, currentY + 8, { width: 70, align: "left" });
                doc.text("Feições", margin + 280, currentY + 8, { width: 60, align: "right" });
                doc.text("Área (ha)", margin + 350, currentY + 8, { width: 70, align: "right" });
                doc.text("% Imóvel", margin + 430, currentY + 8, { width: 65, align: "right" });
                currentY += 24;
            }
            
            if (idx % 2 === 0) doc.rect(margin, currentY, contentW, 22).fill(colors.bg);
            else doc.rect(margin, currentY, contentW, 22).fill("#FFFFFF");
            
            doc.rect(margin, currentY, contentW, 22).strokeColor(colors.border).lineWidth(0.5).stroke();
            
            const areaHa = Number(layer.areaHa || 0);
            const pct = propertyAreaHa > 0 && areaHa > 0 ? `${((areaHa / propertyAreaHa) * 100).toFixed(1)}%` : "-";
            
            doc.font("Helvetica").fontSize(8.5).fillColor(colors.darkText);
            doc.text(reportSingleLineText(layer.name || "-", 42), margin + 10, currentY + 6, { width: 180, align: "left" });
            doc.text(reportSingleLineText(layer.source === "property" ? "Imóvel" : "WFS", 16), margin + 200, currentY + 6, { width: 70, align: "left" });
            doc.text(reportSingleLineText(String(Number(layer.features || 0)), 12), margin + 280, currentY + 6, { width: 60, align: "right" });
            doc.text(areaHa > 0 ? areaHa.toFixed(2) : "-", margin + 350, currentY + 6, { width: 70, align: "right" });
            doc.text(pct, margin + 430, currentY + 6, { width: 65, align: "right" });
            
            currentY += 22;
            doc.y = currentY;
            doc.x = margin;
        });
        doc.moveDown(1);
    }

    // --- Gráfico de Áreas ---
    const chartDataArray = layers.filter((l: any) => Number(l?.features || 0) > 0 && Number(l?.areaHa || 0) > 0);
    if (chartDataArray.length > 0) {
        chartDataArray.sort((a: any, b: any) => Number(b.areaHa || 0) - Number(a.areaHa || 0));
        
        // Vamos limitar as top 15 camadas para manter o gráfico legível
        const topChartLayers = chartDataArray.slice(0, 15);
        
        const chartConfig = {
            type: 'horizontalBar',
            data: {
                labels: topChartLayers.map((l: any) => reportSingleLineText(l.name || "Desconhecido", 22)),
                datasets: [{
                    label: 'Área (ha)',
                    data: topChartLayers.map((l: any) => Number(l.areaHa || 0).toFixed(2)),
                    backgroundColor: colors.primary,
                    borderWidth: 0,
                }]
            },
            options: {
                plugins: {
                    datalabels: { anchor: 'end', align: 'right', color: colors.darkText, font: { weight: 'bold' } }
                },
                legend: { display: false },
                title: { display: false },
                scales: {
                    xAxes: [{ ticks: { beginAtZero: true, fontColor: colors.lightText }, gridLines: { color: colors.border } }],
                    yAxes: [{ ticks: { fontColor: colors.text, fontStyle: 'bold' }, gridLines: { display: false } }]
                }
            }
        };
        
        const chartHeight = Math.max(220, topChartLayers.length * 28 + 60);
        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=${chartHeight}&bkg=white&devicePixelRatio=2.0`;
        
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(chartUrl, { signal: controller.signal });
            clearTimeout(timer);
            
            if (resp.ok) {
                const chartBuf = Buffer.from(await resp.arrayBuffer());
                sectionTitle("Proporção de Áreas por Camada (ha)");
                
                const frameHeight = Math.max(160, topChartLayers.length * 22 + 50);
                ensureSpace(frameHeight + 60);
                const chartY = doc.y;
                
                doc.rect(margin, chartY, contentW, frameHeight).fillAndStroke("#FFFFFF", colors.border);
                doc.image(chartBuf, margin + 10, chartY + 10, { fit: [contentW - 20, frameHeight - 20], align: "center", valign: "center" });
                
                doc.y = chartY + frameHeight + 10;
                doc.x = margin;
                doc.moveDown(0.5);
            }
        } catch (err) {
            console.warn("[SIMCAR PDF] Falha ao gerar gráfico via quickchart.io", err);
        }
    }

    // --- Análise IA Textos ---
    if (args.analysisText) {
        sectionTitle("Análise de Área Consolidada e Vegetação Nativa (AC/AVN)");
        bodyText(args.analysisText, 4000);
    }
    if (args.auasText) {
        sectionTitle("Análise de Área de Uso Alternativo do Solo (AUAS)");
        bodyText(args.auasText, 4000);
    }

    // --- Imagens ---
    if (imageBuffers.some((img) => img.buffer)) {
        sectionTitle("Anexo Fotográfico: Satélites e Vetores Analisados");
        for (const img of imageBuffers) {
            if (!img.buffer) continue;
            try {
                const pdfImg = (doc as any).openImage(img.buffer);
                const aspectRatio = pdfImg.width / pdfImg.height;
                const MAX_HEIGHT = 450;
                
                let targetWidth = contentW - 4;
                let targetHeight = targetWidth / aspectRatio;
                
                if (targetHeight > MAX_HEIGHT) {
                    targetHeight = MAX_HEIGHT;
                    targetWidth = targetHeight * aspectRatio;
                }

                ensureSpace(targetHeight + 40);
                const imgY = doc.y;
                
                const offsetX = margin + 2 + ((contentW - 4 - targetWidth) / 2);

                doc.rect(margin, imgY, contentW, targetHeight + 4).fillAndStroke(colors.bg, colors.border);
                doc.image(img.buffer, offsetX, imgY + 2, { width: targetWidth, height: targetHeight });
                
                doc.y = imgY + targetHeight + 12;
                doc.font("Helvetica-Oblique").fontSize(9).fillColor(colors.lightText).text(reportSingleLineText(img.caption || "Imagem de análise espacial", 150), margin, doc.y, {
                    width: contentW,
                    align: "center",
                });
                doc.moveDown(1.5);
                doc.x = margin;
            } catch {
                // Ignore broken image in report.
            }
        }
    }

    // --- Avisos e Footer ---
    const warnings = [
        ...(Array.isArray(summary.warnings) ? summary.warnings : []),
        ...(Array.isArray(args.job?.warnings) ? args.job!.warnings! : []),
    ].filter(Boolean);
    sectionTitle("Limitações e Observações Técnicas");
    bodyText([
        "Este laudo é um documento técnico de apoio gerado automaticamente por algoritmos de Inteligência Artificial e geoprocessamento. Os resultados extraídos (áreas, intersecções, validações de regras de negócio) são indicativos e devem ser rigorosamente revisados pelo Engenheiro ou Responsável Técnico antes de qualquer submissão a órgãos ambientais, tomada de decisão, ou uso como peça técnica oficial (ART). A GeoForest IA não se responsabiliza por autuações ou indeferimentos baseados no uso não revisado destes dados.",
        warnings.length > 0 ? `Alertas emitidos durante o processamento:\n• ${warnings.slice(0, 8).join("\n• ")}` : "",
    ].filter(Boolean).join("\n\n"), 2500);

    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i += 1) {
        doc.switchToPage(i);
        doc.font("Helvetica").fontSize(8).fillColor(colors.lightText).text(
            `GeoForest IA | ${SIMCAR_REPORT_VERSION} | Página ${i + 1} de ${totalPages}`,
            margin,
            pageH - 28,
            { width: contentW, align: "center" },
        );
    }

    doc.end();
    return done;
}

export async function generateAndPersistSimcarReport(args: {
    uid: string;
    jobId: string;
    contextUrl?: string;
    outputZipUrl?: string;
    analysisText?: string;
    analysisImages?: SimcarReportImage[];
    analysisMeta?: any;
    auasText?: string;
    auasImages?: SimcarReportImage[];
    auasMeta?: any;
}): Promise<SimcarReportArtifact> {
    const uid = String(args.uid || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!uid || !jobId) throw new Error("Usuário e jobId são obrigatórios para gerar PDF.");

    await persistSimcarClipArtifacts({
        uid,
        jobId,
        patch: { reportPdfStatus: "generating", reportPdfError: null },
    });

    try {
        const persisted = readPersistedSimcarClip(jobId) || {};
        const job = await hydrateCachedJob(
            jobId,
            args.contextUrl || persisted.contextUrl || persisted.files?.contextUrl,
            args.outputZipUrl || persisted.outputZipUrl || persisted.files?.outputZipUrl,
        );
        const summary = persisted.summary || (job?.layerSummaries ? {
            propertyAreaHa: job.areaHa || 0,
            crs: "EPSG:4674",
            layersProcessed: job.layerSummaries.length,
            layersWithData: job.layerSummaries.filter((l) => l.features > 0).length,
            totalFeaturesClipped: job.layerSummaries.reduce((sum, l) => sum + Number(l.features || 0), 0),
            processingTimeMs: 0,
            layers: job.layerSummaries,
            warnings: job.warnings,
        } : null);
        const analysisText = reportCleanText(args.analysisText || extractFirstAiText(persisted.analysisMessages), 7000);
        const auasText = reportCleanText(args.auasText || extractFirstAiText(persisted.auasAnalysisMessages), 7000);
        if (!analysisText && !auasText) {
            throw new Error("Nenhuma análise IA encontrada para gerar o PDF.");
        }
        const reportFilename = `SIMCAR_Laudo_Tecnico_${jobId.slice(0, 8)}.pdf`;
        const pdfBuffer = await buildSimcarReportPdfBuffer({
            jobId,
            filename: String(persisted.filename || persisted.title || `Recorte ${jobId.slice(0, 8)}`),
            sourceMode: String(persisted.sourceMode || ""),
            summary,
            job,
            analysisText,
            analysisMeta: args.analysisMeta || persisted.analysisMeta,
            analysisImages: args.analysisImages?.length ? args.analysisImages : normalizeReportImages(persisted.analysisImages),
            auasText,
            auasMeta: args.auasMeta || persisted.auasMeta,
            auasImages: args.auasImages?.length ? args.auasImages : normalizeReportImages(persisted.auasAnalysisImages),
        });
        const generatedAt = new Date().toISOString();
        const reportPdfUrl = await uploadRawBufferToCloudinary(
            pdfBuffer,
            reportFilename,
            "application/pdf",
            uid,
        );
        const artifact: SimcarReportArtifact = {
            reportPdfUrl,
            reportPdfDownloadUrl: reportPdfUrl,
            reportPdfFilename: reportFilename,
            reportPdfGeneratedAt: generatedAt,
            reportPdfVersion: SIMCAR_REPORT_VERSION,
            reportPdfStatus: "ready",
        };
        await persistSimcarClipArtifacts({
            uid,
            jobId,
            patch: {
                ...artifact,
                reportPdfError: null,
                files: {
                    ...(persisted.files || {}),
                    reportPdfUrl,
                    reportPdfDownloadUrl: reportPdfUrl,
                },
            },
        });
        return artifact;
    } catch (error: any) {
        const message = String(error?.message || "Falha ao gerar PDF técnico.");
        await persistSimcarClipArtifacts({
            uid,
            jobId,
            patch: {
                reportPdfStatus: "failed",
                reportPdfError: message,
            },
        });
        throw error;
    }
}