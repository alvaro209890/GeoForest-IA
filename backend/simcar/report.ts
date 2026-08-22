/**
 * PDF Report — geração do laudo técnico SIMCAR em PDF (pdfkit) e persistência.
 * Extraído de simcar-clip.ts (Plano 02, Fase 5b).
 *
 * v2 (2026-08-20): laudo reorganizado para leitura de gestor — painel de
 * veredito com semáforo no topo, resumo executivo em bullets, quadro de
 * achados colorido, linha do tempo visual com o marco de 22/07/2008 e
 * renderização estruturada do markdown da IA (títulos e bullets preservados).
 * Toda a decisão de conteúdo/cor vive em `report-theme.ts`; aqui só se desenha.
 *
 * v3 (2026-08-20): o laudo passa a sair no papel timbrado oficial da IMAP — o
 * mesmo PNG e as mesmas margens/cabeçalho/rodapé que o sistema de
 * acompanhamento de processos usa nos .docx de parecer. A geometria e o
 * desenho do timbrado moram em `report-imap.ts`; a estrutura do laudo (v2)
 * segue igual, só reajustada à área útil do Ofício (453 pt em vez de 511 pt).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { readPersistedSimcarClipForUid, hydrateCachedJob, persistSimcarClipArtifacts, storagePathBelongsToUid } from "./hydration";
import { deleteFromCloudinary, uploadRawBufferToCloudinary } from "./cloudinary";
import { EXPORT_EXCLUDED_LAYERS, isExcludedFromExport, toPublicApiUrl } from "./constants";
import type { CachedJob } from "./types";
import {
    PALETTE,
    TONES,
    LEGAL_BASIS_LINES,
    buildAcAvnFindings,
    buildAuasFindings,
    AC_VS_AUAS_GLOSSARY,
    buildExecutiveBullets,
    buildTimelineModel,
    buildVerdictPanel,
    classifyLayerNature,
    detectReportKind,
    parseMarkdownBlocks,
    reportKindSectionTitle,
    splitLongParagraph,
    imageSourceNote,
    vectorSourceNote,
    type ExecutiveBullet,
    type Finding,
    type MarkdownBlock,
    type TimelineModel,
    type Tone,
} from "./report-theme";
import { createImapTimbrado, IMAP_CONTENT_WIDTH, IMAP_PAGE } from "./report-imap";
import { buildSimcarReportDocxBuffer, SIMCAR_REPORT_DOCX_VERSION } from "./report-docx";
import {
    extractFirstAiText,
    normalizeReportImages,
    reportCleanText,
    reportPdfSafeText,
    reportSingleLineText,
    type SimcarReportImage,
} from "./report-text";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIMCAR_REPORT_VERSION = "simcar-report-v3";

/** Título do cabeçalho de todas as páginas (o Ofício traz "ANÁLISE DE ÁREA"). */
const REPORT_HEADER_TITLE = "LAUDO TÉCNICO SIMCAR";

export type SimcarReportArtifact = {
    reportPdfUrl: string;
    reportPdfDownloadUrl: string;
    reportPdfFilename: string;
    reportPdfGeneratedAt: string;
    reportPdfVersion: string;
    reportPdfStatus: "ready";
    /**
     * DOCX do mesmo laudo, para o responsável técnico editar antes de assinar.
     * Opcional: se a geração do DOCX falhar, o PDF ainda é entregue — o laudo
     * não fica retido por causa do formato secundário.
     */
    reportDocxUrl?: string;
    reportDocxDownloadUrl?: string;
    reportDocxFilename?: string;
    reportDocxVersion?: string;
};

export type { SimcarReportImage };

/**
 * Escolhe as cenas que entram no Anexo Fotografico.
 *
 * A versao anterior pontuava por PALAVRA na legenda: +5 para "Visao Geral",
 * +3 para citar AC/AVN/AUAS/ARL, +1 para citar o sensor. Isso discriminava
 * quando cada satelite gerava 3 vistas com legendas diferentes ("Somente AC",
 * "Somente AVN"). Desde o commit `0e429b3b` cada satelite gera UM composite
 * rotulado "<sensor> — Visao Geral (AC + AVN + AUAS)": as tres regras passaram
 * a valer para TODAS as imagens, todas empataram em 9 pontos e o sort virou
 * no-op. Com o corte em 4, sobravam as 4 PRIMEIRAS por ordem de array — os anos
 * mais antigos — e o **SPOT 2008 caia fora do laudo**.
 *
 * Isso passou despercebido enquanto a janela tinha 4 cenas (2006, 2007, SPOT,
 * 2008), porque o corte de 4 nao cortava nada. Ao abrir a janela para 2003-2008
 * (7 cenas), o furo apareceu — e apareceu justamente na cena de maior peso
 * juridico. Mesma familia do bug de `reduceImageSet`: heuristica de legenda que
 * parou de discriminar depois do refactor de composite unico.
 *
 * Agora a ordem e por **peso probatorio**, nao por texto:
 *   1. SPOT 2008 — 2,5 m, base da Nota Tecnica 001/2017 da SEMA-MT;
 *   2. a cena do marco (2008);
 *   3. a cena de 2003 — marco do pousio quinquenal;
 *   4. o resto por ano decrescente (mais perto do marco decide primeiro).
 *
 * E o teto da etapa AC/AVN passou a caber a janela inteira: cortar cena da
 * serie temporal esconde justamente a evidencia que data a conversao.
 */
const AC_AVN_FIGURE_LIMIT = 8;
const AUAS_FIGURE_LIMIT = 5;

function reportImageYear(caption: string): number {
    return Number(String(caption || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
}

function reportImageWeight(caption: string): number {
    const cap = String(caption || "");
    // Destaques do achado (ex.: "SPOT 2008 — Destaque AVN ..." / "SPOT 2008 —
    // Destaque Reservatório ...") têm prioridade máxima no anexo: vêm antes das
    // demais cenas, pois mostram o local e o ano do trecho apontado no laudo.
    if (/destaque avn|destaque reservatório/i.test(cap)) return -1;
    if (/spot/i.test(cap)) return 0;
    if (reportImageYear(cap) === 2008) return 1;
    if (reportImageYear(cap) === 2003) return 2;
    return 3;
}

export function selectPrincipalReportImages(
    acImages: SimcarReportImage[],
    auasImages: SimcarReportImage[],
): SimcarReportImage[] {
    const pick = (images: SimcarReportImage[], limit: number) =>
        images
            .filter((img, idx, arr) => img.url && arr.findIndex((other) => other.url === img.url) === idx)
            .sort((a, b) => {
                const porPeso = reportImageWeight(a.caption) - reportImageWeight(b.caption);
                if (porPeso !== 0) return porPeso;
                return reportImageYear(b.caption) - reportImageYear(a.caption);
            })
            .slice(0, limit);
    return [...pick(acImages, AC_AVN_FIGURE_LIMIT), ...pick(auasImages, AUAS_FIGURE_LIMIT)];
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
    // Em produção o bundle vira `dist/index.js` (raiz = `..`); em dev o módulo vive
    // em `backend/simcar/` e a logo está dois níveis acima. Resolver por candidatos
    // evita o laudo sair sem marca só porque mudou o ponto de entrada.
    const logoPath = [
        path.resolve(__dirname, "..", "geoforest_app_logo.png"),
        path.resolve(__dirname, "..", "..", "geoforest_app_logo.png"),
        path.resolve(process.cwd(), "geoforest_app_logo.png"),
    ].find((candidate) => fs.existsSync(candidate));
    const logoBuffer = logoPath ? fs.readFileSync(logoPath) : null;

    // `autoFirstPage: false` para que o handler de `pageAdded` já esteja ligado
    // quando a primeira página nascer — é ele que carimba o timbrado.
    const doc = new PDFDocument({
        size: "A4",
        margins: {
            top: IMAP_PAGE.marginTop,
            bottom: IMAP_PAGE.marginBottom,
            left: IMAP_PAGE.marginLeft,
            right: IMAP_PAGE.marginRight,
        },
        bufferPages: true,
        autoFirstPage: false,
        info: {
            Title: `Laudo Técnico SIMCAR - ${args.jobId}`,
            Author: "IMAP Engenharia e Soluções",
            Subject: "Relatório técnico de análise SIMCAR",
            Creator: "GeoForest IA",
        },
    });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });

    /* ─── Papel timbrado da IMAP ─────────────────────────────── */

    const timbrado = createImapTimbrado(doc, {
        headerTitle: REPORT_HEADER_TITLE,
        footerMeta: `GeoForest IA · ${SIMCAR_REPORT_VERSION} · Job ${reportSingleLineText(args.jobId, 40)}`,
    });
    doc.on("pageAdded", () => timbrado.drawHeader());
    doc.addPage();

    const pageW = IMAP_PAGE.width;
    const pageH = IMAP_PAGE.height;
    const margin = IMAP_PAGE.marginLeft;
    const marginTop = IMAP_PAGE.marginTop;
    const marginBottom = IMAP_PAGE.marginBottom;
    const contentW = IMAP_CONTENT_WIDTH;
    const colors = PALETTE;

    /* ─── Primitivas de desenho ──────────────────────────────── */

    // O identificador do laudo não é mais repetido no topo de cada página: o
    // cabeçalho do timbrado já assina a folha e o job vai no rodapé.
    const ensureSpace = (height: number) => {
        if (doc.y + height > pageH - marginBottom) {
            doc.addPage(); // `pageAdded` desenha o timbrado e recoloca x/y na margem
        }
    };

    const sectionTitle = (title: string, subtitle?: string) => {
        // Reserva o título MAIS um começo de corpo: na área útil do Ofício
        // (649 pt de altura útil) um `ensureSpace(56)` deixava título órfão no
        // pé da página e o conteúdo sozinho na seguinte.
        ensureSpace(86);
        doc.moveDown(0.8);
        const y = doc.y;
        doc.rect(margin, y + 2, 4, 16).fill(colors.primary);
        doc.font("Helvetica-Bold").fontSize(14).fillColor(colors.dark).text(title, margin + 12, y, {
            width: contentW - 12,
            align: "left",
        });
        if (subtitle) {
            doc.font("Helvetica").fontSize(8.5).fillColor(colors.lightText).text(subtitle, margin + 12, doc.y + 1, {
                width: contentW - 12,
                align: "left",
            });
        }
        doc.moveTo(margin, doc.y + 5).lineTo(pageW - margin, doc.y + 5).strokeColor(colors.border).lineWidth(1).stroke();
        doc.y += 12;
        doc.x = margin;
    };

    /** Pílula colorida de status. Devolve a largura ocupada. */
    const pill = (text: string, tone: Tone, x: number, y: number, minWidth = 0): number => {
        const label = reportSingleLineText(text, 26);
        doc.font("Helvetica-Bold").fontSize(7.5);
        const width = Math.max(minWidth, doc.widthOfString(label) + 14);
        const palette = TONES[tone];
        doc.roundedRect(x, y, width, 14, 7).fillAndStroke(palette.bg, palette.border);
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(palette.fg).text(label, x, y + 3.6, {
            width,
            align: "center",
        });
        return width;
    };

    /** Caixa de destaque com trilho colorido à esquerda. */
    const calloutBox = (title: string, lines: string[], tone: Tone, opts: { compact?: boolean } = {}) => {
        const palette = TONES[tone];
        const innerW = contentW - 34;
        const bodyFont = opts.compact ? 8.5 : 9;
        doc.font("Helvetica").fontSize(bodyFont);
        const safeLines = lines.map((line) => reportPdfSafeText(line, 900)).filter(Boolean);
        const bodyH = safeLines.reduce(
            (sum, line) => sum + doc.heightOfString(line, { width: innerW, lineGap: 2.5 }) + 3,
            0,
        );
        const titleH = title ? 15 : 0;
        const boxH = titleH + bodyH + 16;
        ensureSpace(boxH + 10);
        const y = doc.y;
        doc.roundedRect(margin, y, contentW, boxH, 7).fillAndStroke(palette.bg, palette.border);
        doc.rect(margin, y + 2, 3.5, boxH - 4).fill(palette.fg);
        let cursor = y + 9;
        if (title) {
            doc.font("Helvetica-Bold").fontSize(9.5).fillColor(palette.fg).text(title, margin + 16, cursor, {
                width: innerW,
            });
            cursor += titleH;
        }
        for (const line of safeLines) {
            doc.font("Helvetica").fontSize(bodyFont).fillColor(colors.darkText).text(line, margin + 16, cursor, {
                width: innerW,
                lineGap: 2.5,
            });
            cursor = doc.y + 3;
        }
        doc.x = margin;
        doc.y = y + boxH + 8;
    };

    /** Lista de bullets com marcador colorido por tom. */
    const bulletList = (items: ExecutiveBullet[], opts: { fontSize?: number } = {}) => {
        const fontSize = opts.fontSize ?? 9.5;
        for (const item of items) {
            const text = reportPdfSafeText(item.text, 700);
            if (!text) continue;
            doc.font("Helvetica").fontSize(fontSize);
            const h = doc.heightOfString(text, { width: contentW - 18, lineGap: 2.5 });
            ensureSpace(h + 8);
            const y = doc.y;
            doc.circle(margin + 4.5, y + fontSize * 0.55, 2.6).fill(TONES[item.tone].fg);
            doc.font("Helvetica").fontSize(fontSize).fillColor(colors.text).text(text, margin + 14, y, {
                width: contentW - 18,
                lineGap: 2.5,
                align: "left",
            });
            doc.x = margin;
            doc.y += 4;
        }
    };

    /** Renderiza markdown de IA preservando títulos e bullets. */
    const markdownBody = (markdown: string, maxChars = 9000) => {
        const blocks: MarkdownBlock[] = parseMarkdownBlocks(reportCleanText(markdown, maxChars));
        if (blocks.length === 0) {
            doc.font("Helvetica").fontSize(9.5).fillColor(colors.lightText).text("Não informado.", margin, doc.y, {
                width: contentW,
            });
            doc.x = margin;
            return;
        }
        for (const block of blocks) {
            if (block.type === "heading") {
                ensureSpace(44); // título + a 1ª linha do que vem embaixo
                doc.moveDown(0.35);
                const y = doc.y;
                doc.font("Helvetica-Bold").fontSize(10).fillColor(colors.primary).text(
                    reportSingleLineText(block.text, 90).toUpperCase(),
                    margin,
                    y,
                    { width: contentW },
                );
                doc.x = margin;
                doc.y += 3;
                continue;
            }
            if (block.type === "bullet") {
                const label = block.label ? `${reportSingleLineText(block.label, 60)}: ` : "";
                const text = reportPdfSafeText(block.text, 900);
                if (!label && !text) continue;
                doc.font("Helvetica").fontSize(9.5);
                const h = doc.heightOfString(label + text, { width: contentW - 18, lineGap: 2.5 });
                ensureSpace(h + 8);
                const y = doc.y;
                doc.circle(margin + 4.5, y + 5, 2.4).fill(colors.primary);
                if (label) {
                    // Rótulo em negrito e corpo normal na MESMA linha: o pdfkit aplica a
                    // fonte corrente a cada trecho, então o estilo é trocado entre as
                    // chamadas encadeadas por `continued`.
                    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(colors.darkText)
                        .text(label, margin + 14, y, { width: contentW - 18, continued: true, lineGap: 2.5 });
                    doc.font("Helvetica").fontSize(9.5).fillColor(colors.text).text(text, { lineGap: 2.5 });
                } else {
                    doc.font("Helvetica").fontSize(9.5).fillColor(colors.text)
                        .text(text, margin + 14, y, { width: contentW - 18, lineGap: 2.5 });
                }
                doc.x = margin;
                doc.y += 3;
                continue;
            }
            for (const part of splitLongParagraph(reportPdfSafeText(block.text, 1800))) {
                doc.font("Helvetica").fontSize(9.5);
                const h = doc.heightOfString(part, { width: contentW, lineGap: 3 });
                ensureSpace(Math.min(h + 10, pageH - marginTop - marginBottom));
                doc.font("Helvetica").fontSize(9.5).fillColor(colors.text).text(part, margin, doc.y, {
                    width: contentW,
                    lineGap: 3,
                    align: "left",
                });
                doc.x = margin;
                doc.y += 4;
            }
        }
    };

    const metric = (label: string, value: string, x: number, y: number, w: number, tone: Tone = "neutral") => {
        const palette = TONES[tone];
        doc.roundedRect(x, y, w, 58, 8).fillAndStroke(palette.bg, palette.border);
        // `lineBreak: false`: na área útil do Ofício a caixa tem ~106 pt e uma
        // área de 5 dígitos quebraria em duas linhas por cima do rótulo.
        doc.font("Helvetica-Bold").fontSize(12.5).fillColor(palette.fg).text(reportSingleLineText(value, 24), x + 9, y + 14, {
            width: w - 18,
            align: "left",
            lineBreak: false,
        });
        doc.font("Helvetica").fontSize(7.6).fillColor(colors.lightText).text(reportSingleLineText(label, 34), x + 9, y + 35, {
            width: w - 18,
            align: "left",
        });
    };

    /* ─── Abertura (só a 1ª página) ──────────────────────────── */

    // A faixa escura de página inteira da v2 cobria a logo do timbrado; a
    // abertura agora é um cartão que começa abaixo da margem do Ofício.
    {
        const cardH = 100;
        const y = marginTop;
        doc.roundedRect(margin, y, contentW, cardH, 8).fillAndStroke(colors.white, colors.border);
        doc.rect(margin + 1, y + 2, 4, cardH - 4).fill(colors.primary);
        if (logoBuffer) {
            try {
                doc.image(logoBuffer, margin + contentW - 48, y + 14, { fit: [32, 32] });
            } catch {
                // Ignora a imagem se não decodificar
            }
        }
        doc.font("Helvetica-Bold").fontSize(19).fillColor(colors.dark).text("Laudo Técnico SIMCAR", margin + 18, y + 15, {
            width: contentW - 84,
            lineBreak: false,
        });
        doc.font("Helvetica").fontSize(8.5).fillColor(colors.lightText).text(
            "Análise geoespacial assistida por IA · documento de apoio ao responsável técnico",
            margin + 18,
            y + 39,
            { width: contentW - 84 },
        );
        doc.moveTo(margin + 18, y + 58).lineTo(margin + contentW - 18, y + 58)
            .strokeColor(colors.border).lineWidth(0.8).stroke();
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(colors.darkText).text(
            reportSingleLineText(args.filename || "Recorte SIMCAR", 90),
            margin + 18,
            y + 65,
            { width: contentW - 36, lineBreak: false },
        );
        doc.font("Helvetica").fontSize(7.6).fillColor(colors.lightText).text(
            `Job: ${reportSingleLineText(args.jobId, 44)} · Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })} · ${SIMCAR_REPORT_VERSION}`,
            margin + 18,
            y + 81,
            { width: contentW - 36, lineBreak: false },
        );

        doc.x = margin;
        doc.y = y + cardH + 14;
    }

    /* ─── Modelo do laudo ────────────────────────────────────── */

    const summary = args.summary || {};
    // Camadas excluídas da entrega (hoje: TIPOLOGIA_VEGETAL) não entram no laudo
    // nem nos contadores — senão o laudo anuncia uma sobreposição que o ZIP não
    // tem. Ver `EXPORT_EXCLUDED_LAYERS` em `constants.ts`.
    const rawLayers = Array.isArray(summary.layers) ? summary.layers : (args.job?.layerSummaries || []);
    const layers = rawLayers.filter((l: any) => !isExcludedFromExport(l?.name));
    const excludedLayerCount = rawLayers.length - layers.length;
    const propertyAreaHa = Number(summary.propertyAreaHa || args.job?.areaHa || 0);
    const layersWithData = layers.filter((l: any) => Number(l?.features || 0) > 0).length;
    const totalFeatures = layers.reduce((sum: number, l: any) => sum + Number(l?.features || 0), 0);
    const totalLayers = Math.max(0, Number(summary.layersProcessed || rawLayers.length || 0) - excludedLayerCount);

    const auasKind = detectReportKind(args.auasMeta);
    const acAvnFindings: Finding[] = args.analysisText ? buildAcAvnFindings(args.analysisMeta) : [];
    const auasFindings: Finding[] = args.auasText ? buildAuasFindings(args.auasMeta, auasKind) : [];
    const findings = [...acAvnFindings, ...auasFindings];
    const timeline = buildTimelineModel({ analysisMeta: args.analysisMeta, auasMeta: args.auasMeta });
    const verdict = buildVerdictPanel({
        findings,
        kind: auasKind,
        analysisMeta: args.analysisMeta,
        auasMeta: args.auasMeta,
    });

    /* ─── Painel de veredito ─────────────────────────────────── */

    {
        const palette = TONES[verdict.tone];
        const innerW = contentW - 34;
        doc.font("Helvetica").fontSize(9.5);
        const headline = reportPdfSafeText(verdict.headline, 600);
        const headlineH = doc.heightOfString(headline, { width: innerW, lineGap: 2.5 });
        const boxH = 34 + headlineH + 18;
        const y = doc.y;
        doc.roundedRect(margin, y, contentW, boxH, 9).fillAndStroke(palette.bg, palette.border);
        doc.rect(margin, y + 2, 5, boxH - 4).fill(palette.fg);
        doc.font("Helvetica").fontSize(8).fillColor(colors.lightText).text("VEREDITO GERAL DA ANÁLISE", margin + 18, y + 10, {
            width: innerW,
        });
        doc.font("Helvetica-Bold").fontSize(15).fillColor(palette.fg).text(verdict.title, margin + 18, y + 21, {
            width: innerW - 130,
        });
        pill(`Confiança: ${verdict.confidence}`, verdict.confidenceTone, margin + contentW - 132, y + 24, 118);
        doc.font("Helvetica").fontSize(9.5).fillColor(colors.darkText).text(headline, margin + 18, y + 44, {
            width: innerW,
            lineGap: 2.5,
        });
        doc.x = margin;
        doc.y = y + boxH + 12;
    }

    /* ─── Métricas ───────────────────────────────────────────── */

    {
        const gap = 9;
        const metricW = (contentW - gap * 3) / 4;
        const y = doc.y;
        metric("Área do imóvel", `${propertyAreaHa.toFixed(2)} ha`, margin, y, metricW, "info");
        metric(
            "Camadas com dados",
            `${layersWithData}/${totalLayers}`,
            margin + (metricW + gap),
            y,
            metricW,
            layersWithData > 0 ? "warn" : "ok",
        );
        metric("Feições recortadas", String(totalFeatures), margin + (metricW + gap) * 2, y, metricW, "neutral");
        metric(
            "Janela temporal",
            timeline ? `${timeline.firstYear}–${timeline.lastYear}` : "Sem série",
            margin + (metricW + gap) * 3,
            y,
            metricW,
            timeline ? "info" : "neutral",
        );
        doc.x = margin;
        doc.y = y + 70;
    }

    /* ─── Resumo executivo ───────────────────────────────────── */

    sectionTitle("Resumo Executivo", "Leitura rápida: o que a análise encontrou e o que exige ação.");
    bulletList(
        buildExecutiveBullets({
            jobId: args.jobId,
            findings,
            timeline,
        }),
    );

    /* ─── Quadro de achados ──────────────────────────────────── */

    if (findings.length > 0) {
        sectionTitle("Quadro de Achados", "Verde = conforme · Amarelo = pendente de confirmação · Vermelho = revisar antes de submeter.");
        const colLabelW = 148;
        const colPillW = 86;
        const colDetailW = contentW - colLabelW - colPillW - 22;
        for (const finding of findings) {
            const detail = reportPdfSafeText(finding.detail, 400);
            doc.font("Helvetica").fontSize(8.5);
            const detailH = doc.heightOfString(detail, { width: colDetailW, lineGap: 2 });
            const rowH = Math.max(30, detailH + 14);
            ensureSpace(rowH + 4);
            const y = doc.y;
            doc.rect(margin, y, contentW, rowH).fillAndStroke(colors.white, colors.border);
            doc.rect(margin, y, 3, rowH).fill(TONES[finding.tone].fg);
            doc.font("Helvetica-Bold").fontSize(8.4).fillColor(colors.darkText).text(
                reportSingleLineText(finding.label, 46),
                margin + 11,
                y + 8,
                { width: colLabelW - 14 },
            );
            pill(finding.status, finding.tone, margin + colLabelW, y + 8, colPillW - 10);
            doc.font("Helvetica").fontSize(8.5).fillColor(colors.text).text(
                detail,
                margin + colLabelW + colPillW,
                y + 7,
                { width: colDetailW, lineGap: 2 },
            );
            doc.x = margin;
            doc.y = y + rowH + 3;
        }
        doc.moveDown(0.4);
    }

    /* ─── Linha do tempo ─────────────────────────────────────── */

    if (timeline) {
        drawTimeline(timeline);
    }

    function drawTimeline(model: TimelineModel) {
        sectionTitle(
            "Linha do Tempo da Análise",
            `${model.firstYear} a ${model.lastYear} · marco do Código Florestal (22/07/2008) destacado em vermelho.`,
        );
        const boxH = 104;
        ensureSpace(boxH + 12);
        const top = doc.y;
        doc.roundedRect(margin, top, contentW, boxH, 8).fillAndStroke(colors.bg, colors.border);

        const padX = 26;
        const axisX0 = margin + padX;
        const axisX1 = margin + contentW - padX;
        const axisY = top + 58;
        const span = Math.max(1, model.lastYear - model.firstYear);
        const xOf = (year: number) => axisX0 + ((year - model.firstYear) / span) * (axisX1 - axisX0);

        doc.moveTo(axisX0, axisY).lineTo(axisX1, axisY).strokeColor("#CBD5E1").lineWidth(2).stroke();

        if (model.markerYear !== null) {
            const mx = xOf(model.markerYear);
            doc.save();
            doc.dash(3, { space: 2 });
            // A tracejada para ANTES do ponto do ano: cruzando o marcador ela
            // riscava o rótulo do sensor e o do ano.
            const markerBottom = axisY - (model.years.length <= 14 ? 22 : 8);
            doc.moveTo(mx, top + 26).lineTo(mx, markerBottom).strokeColor(TONES.danger.fg).lineWidth(1.1).stroke();
            doc.undash();
            doc.restore();
            // O marco costuma cair na ponta da série; sem trava o rótulo vaza a margem.
            const labelW = 62;
            const labelX = Math.min(Math.max(mx - labelW / 2, margin + 6), margin + contentW - labelW - 6);
            doc.font("Helvetica-Bold").fontSize(7).fillColor(TONES.danger.fg).text("22/07/2008", labelX, top + 15, {
                width: labelW,
                align: "center",
            });
        }

        const usableYears = model.years.filter((y) => y.state !== "missing").length;
        const labelStep = Math.max(1, Math.ceil(model.years.length / Math.floor((axisX1 - axisX0) / 30)));
        model.years.forEach((item, idx) => {
            const x = xOf(item.year);
            if (item.state === "missing") {
                doc.circle(x, axisY, 3.4).lineWidth(1).fillAndStroke(colors.white, TONES.neutral.border);
            } else if (item.state === "event") {
                doc.circle(x, axisY, 4.6).fill(TONES.danger.fg);
            } else {
                doc.circle(x, axisY, 3.6).fill(TONES.ok.fg);
            }
            const showLabel = idx % labelStep === 0 || item.state === "event" || item.year === model.lastYear;
            if (showLabel) {
                doc.font(item.state === "event" ? "Helvetica-Bold" : "Helvetica").fontSize(6.6).fillColor(
                    item.state === "event" ? TONES.danger.fg : colors.lightText,
                ).text(String(item.year), x - 14, axisY + 9, { width: 28, align: "center" });
                if (item.label && model.years.length <= 14) {
                    doc.font("Helvetica").fontSize(6).fillColor(colors.lightText).text(item.label, x - 14, axisY - 17, {
                        width: 28,
                        align: "center",
                    });
                }
            }
        });

        // Legenda compactada: na largura do Ofício ela colidia com o contador.
        const legendY = top + boxH - 21;
        doc.circle(margin + 16, legendY + 3, 3.2).fill(TONES.ok.fg);
        doc.font("Helvetica").fontSize(7).fillColor(colors.lightText).text("cena utilizável", margin + 24, legendY, { width: 62, lineBreak: false });
        doc.circle(margin + 94, legendY + 3, 3.2).lineWidth(1).fillAndStroke(colors.white, TONES.neutral.border);
        doc.font("Helvetica").fontSize(7).fillColor(colors.lightText).text("sem cena no ano", margin + 102, legendY, { width: 68, lineBreak: false });
        doc.circle(margin + 178, legendY + 3, 3.8).fill(TONES.danger.fg);
        doc.font("Helvetica").fontSize(7).fillColor(colors.lightText).text("conversão datada", margin + 186, legendY, { width: 72, lineBreak: false });
        doc.font("Helvetica").fontSize(7).fillColor(colors.lightText).text(
            `${usableYears} de ${model.years.length} ano(s) com cena`,
            margin + contentW - 165,
            legendY,
            { width: 155, align: "right", lineBreak: false },
        );

        doc.x = margin;
        doc.y = top + boxH + 10;
        if (model.eventYears.length > 0) {
            calloutBox(
                "Datação observada",
                [
                    `Conversão de vegetação nativa observada em: ${model.eventYears.join(", ")}. ${
                        model.markerYear !== null && model.eventYears.some((y) => y > model.markerYear!)
                            ? "Eventos posteriores a 2008 exigem autorização de supressão (Lei 12.651/2012, art. 26) — confrontar com AUTEX/AUAS emitidas."
                            : "Eventos anteriores ao marco reforçam a caracterização de área consolidada."
                    }`,
                ],
                "warn",
                { compact: true },
            );
        }
    }

    /* ─── Quantitativos por camada ───────────────────────────── */

    // O cabeçalho preto da tabela precisa caber junto com o título da seção.
    ensureSpace(146);
    {
        // O leitor precisa saber se os polígonos são da base da SEMA ou da
        // vetorização que o próprio RT enviou — muda o que "divergência" quer
        // dizer. Ver `vectorSourceNote` em report-theme.ts.
        const origem = vectorSourceNote(args.sourceMode);
        ensureSpace(58);
        calloutBox(origem.label, [origem.detail], "neutral", { compact: true });

        // Idem para as cenas: acervo da IMAP, mosaico da SEMA, ou os dois no
        // mesmo laudo. Ver imageSourceNote em report-theme.ts.
        const origemImagens = imageSourceNote(
            [...args.analysisImages, ...args.auasImages].map((img) => String(img?.caption || "")),
        );
        if (origemImagens) {
            ensureSpace(58);
            calloutBox(origemImagens.label, [origemImagens.detail], "neutral", { compact: true });
        }
    }

    sectionTitle("Quantitativos por Camada", "Somente camadas com feição recortada dentro do imóvel.");
    const withData = layers.filter((l: any) => Number(l?.features || 0) > 0).slice(0, 24);
    if (withData.length === 0) {
        calloutBox(
            "Nenhuma sobreposição encontrada",
            ["Nenhuma camada ambiental estadual ou federal apresentou sobreposição com a área do imóvel analisado."],
            "ok",
        );
    } else {
        // Colunas dimensionadas para a área útil do Ofício (453 pt), não para os
        // 511 pt da margem de 42 pt da v2 — senão a coluna de % vazava a folha.
        const colX = {
            name: margin + 10,
            nature: margin + 186,
            features: margin + 258,
            area: margin + 312,
            pct: margin + 382,
        };
        const colW = { name: 172, nature: 68, features: 48, area: 64, pct: 58 };
        const drawHeader = (y: number) => {
            doc.rect(margin, y, contentW, 22).fill(colors.dark);
            doc.font("Helvetica-Bold").fontSize(7.6).fillColor("#FFFFFF");
            doc.text("Camada ambiental", colX.name, y + 7.5, { width: colW.name, lineBreak: false });
            doc.text("Natureza", colX.nature, y + 7.5, { width: colW.nature, lineBreak: false });
            doc.text("Feições", colX.features, y + 7.5, { width: colW.features, align: "right", lineBreak: false });
            doc.text("Área (ha)", colX.area, y + 7.5, { width: colW.area, align: "right", lineBreak: false });
            doc.text("% imóvel", colX.pct, y + 7.5, { width: colW.pct, align: "right", lineBreak: false });
            return y + 22;
        };

        ensureSpace(60);
        let currentY = drawHeader(doc.y);

        withData.forEach((layer: any, idx: number) => {
            if (currentY + 21 > pageH - marginBottom) {
                doc.y = currentY;
                ensureSpace(60);
                currentY = drawHeader(doc.y);
            }
            const areaHa = Number(layer.areaHa || 0);
            const pctValue = propertyAreaHa > 0 && areaHa > 0 ? (areaHa / propertyAreaHa) * 100 : 0;
            const pct = pctValue > 0 ? `${pctValue.toFixed(1)}%` : "-";
            const { nature, tone } = classifyLayerNature(layer.name);

            doc.rect(margin, currentY, contentW, 21).fillAndStroke(idx % 2 === 0 ? colors.bg : colors.white, colors.border);
            doc.rect(margin, currentY, 2.5, 21).fill(TONES[tone].fg);
            doc.font("Helvetica").fontSize(8).fillColor(colors.darkText);
            doc.text(reportSingleLineText(layer.name || "-", 34), colX.name, currentY + 6.5, { width: colW.name, lineBreak: false });
            doc.font("Helvetica-Bold").fontSize(7.2).fillColor(TONES[tone].fg);
            doc.text(nature, colX.nature, currentY + 7, { width: colW.nature, lineBreak: false });
            doc.font("Helvetica").fontSize(8).fillColor(colors.darkText);
            doc.text(String(Number(layer.features || 0)), colX.features, currentY + 6.5, { width: colW.features, align: "right", lineBreak: false });
            doc.text(areaHa > 0 ? areaHa.toFixed(2) : "-", colX.area, currentY + 6.5, { width: colW.area, align: "right", lineBreak: false });
            doc.font(pctValue >= 25 ? "Helvetica-Bold" : "Helvetica").fillColor(
                pctValue >= 25 ? TONES.warn.fg : colors.darkText,
            );
            doc.text(pct, colX.pct, currentY + 6.5, { width: colW.pct, align: "right", lineBreak: false });
            currentY += 21;
        });
        doc.x = margin;
        doc.y = currentY + 8;

        if (layers.filter((l: any) => Number(l?.features || 0) > 0).length > withData.length) {
            doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(colors.lightText).text(
                `Exibindo as ${withData.length} primeiras camadas com dados; a lista completa está no ZIP do recorte.`,
                margin,
                doc.y,
                { width: contentW },
            );
            doc.x = margin;
            doc.moveDown(0.6);
        }
    }

    /* ─── Gráfico de áreas ───────────────────────────────────── */

    const chartDataArray = layers.filter((l: any) => Number(l?.features || 0) > 0 && Number(l?.areaHa || 0) > 0);
    if (chartDataArray.length > 0) {
        chartDataArray.sort((a: any, b: any) => Number(b.areaHa || 0) - Number(a.areaHa || 0));
        const topChartLayers = chartDataArray.slice(0, 15);
        const chartConfig = {
            type: "horizontalBar",
            data: {
                labels: topChartLayers.map((l: any) => reportSingleLineText(l.name || "Desconhecido", 22)),
                datasets: [
                    {
                        label: "Área (ha)",
                        data: topChartLayers.map((l: any) => Number(l.areaHa || 0).toFixed(2)),
                        backgroundColor: topChartLayers.map((l: any) => TONES[classifyLayerNature(l.name).tone].fg),
                        borderWidth: 0,
                    },
                ],
            },
            options: {
                plugins: {
                    datalabels: { anchor: "end", align: "right", color: colors.darkText, font: { weight: "bold" } },
                },
                legend: { display: false },
                title: { display: false },
                scales: {
                    xAxes: [{ ticks: { beginAtZero: true, fontColor: colors.lightText }, gridLines: { color: colors.border } }],
                    yAxes: [{ ticks: { fontColor: colors.text, fontStyle: "bold" }, gridLines: { display: false } }],
                },
            },
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
                // Decodifica ANTES de escrever o título: imagem quebrada não pode
                // deixar uma seção vazia no laudo.
                (doc as any).openImage(chartBuf);
                const frameHeight = Math.max(160, topChartLayers.length * 22 + 50);
                // Título e moldura precisam caber juntos, senão o título fica órfão
                // no rodapé de uma página e o gráfico sozinho na seguinte.
                ensureSpace(frameHeight + 96);
                sectionTitle("Proporção de Áreas por Camada (ha)", "Cores seguem a natureza da camada: laranja = restrição legal, azul = uso, cinza = base.");
                const chartY = doc.y;
                doc.rect(margin, chartY, contentW, frameHeight).fillAndStroke("#FFFFFF", colors.border);
                doc.image(chartBuf, margin + 10, chartY + 10, {
                    fit: [contentW - 20, frameHeight - 20],
                    align: "center",
                    valign: "center",
                });
                doc.y = chartY + frameHeight + 10;
                doc.x = margin;
            }
        } catch (err) {
            console.warn("[SIMCAR PDF] Falha ao gerar gráfico via quickchart.io", err);
        }
    }

    /* ─── Textos das análises ────────────────────────────────── */

    if (args.analysisText) {
        sectionTitle(
            "Análise de Área Consolidada e Vegetação Nativa (AC/AVN)",
            "Interpretação das cenas em torno do marco de 22/07/2008.",
        );
        markdownBody(args.analysisText, 9000);
    }
    if (args.auasText) {
        sectionTitle(reportKindSectionTitle(auasKind), "Resultado por polígono, conforme calculado pelo sistema.");
        markdownBody(args.auasText, 9000);
    }

    /* ─── Reservatórios artificiais: quadro explícito ─────────── */

    // O encarte digital do CAR não transfere a lâmina d'água para a área
    // consolidada/AUAS automaticamente (regressão real: Lote 81, 21/08/2026).
    // Quando há reservatório no recorte, o laudo declara os números em quadro
    // próprio, além do texto gerado pela análise.
    const reservoirAnalysis: any = args.analysisMeta?.reservoirAnalysis || null;
    if (reservoirAnalysis?.hasReservoir) {
        ensureSpace(120);
        sectionTitle(
            "Reservatórios Artificiais — Enquadramento Legal",
            "Lâmina d'água presente no recorte e tratamento no CAR/SIMCAR.",
        );
        const feats = Number(reservoirAnalysis.totalFeatures || 0);
        const linhas: string[] = [
            `${feats} feição(ões) de reservatório artificial, total de ${Number(reservoirAnalysis.totalAreaHa || 0).toFixed(4)} ha (${Number(reservoirAnalysis.pctOfProperty || 0).toFixed(2)}% do imóvel).`,
            `Sobre Área Consolidada declarada: ${Number(reservoirAnalysis.overlapAcHa || 0).toFixed(4)} ha · Sobre AUAS declarada: ${Number(reservoirAnalysis.overlapAuasHa || 0).toFixed(4)} ha · Sobre AVN: ${Number(reservoirAnalysis.overlapAvnHa || 0).toFixed(4)} ha · Fora de camada declarada: ${Number(reservoirAnalysis.outsideDeclaredHa || 0).toFixed(4)} ha.`,
            "Lei 12.651/2012, art. 4º, III e §1º: reservatório artificial que NÃO decorre de barramento/represamento de curso d'água natural NÃO gera APP de entorno — a lâmina d'água enquadra-se como uso antrópico (área consolidada/AUAS).",
            "Art. 4º, §4º: acumulações naturais ou artificiais com superfície inferior a 1 ha ficam dispensadas da faixa de APP de entorno (vedada nova supressão de vegetação nativa).",
            "Manual do Projeto Geográfico do SIMCAR (SEMA-MT, 2018): seção 8.9 define AUAS = Área de Uso ANTROPIZADO do Solo (características originais alteradas por atividade humana); seção 8.14 define reservatório artificial = decorrente de barramento/represamento de curso d'água natural; Anexo 01 marca ÁREA INUNDADA sobre AUAS/AVN/AC como VALIDAÇÃO IMPEDITIVA.",
            "Lei 12.651/2012, art. 4º, §1º e §4º + Decreto 7.830/2012: reservatório artificial sem barramento não é APP de entorno; lâmina enquadra-se como AUAS/consolidada; acumulação < 1 ha dispensa faixa de APP.",
            "O encarte digital do CAR (origem deste recorte) NÃO transfere automaticamente a lâmina d'água para a área consolidada/AUAS — a validação impeditiva do SIMCAR bloqueia a sobreposição; a adequação do perímetro no CAR/SIMCAR deve ser feita pelo responsável técnico.",
        ];
        calloutBox("Reservatório artificial detectado", linhas, "info", { compact: false });
    }

    /* ─── Fundamentação legal ────────────────────────────────── */

    sectionTitle("Fundamentação Legal Aplicada", "Normas que definem os marcos temporais usados nesta análise.");
    bulletList(LEGAL_BASIS_LINES.map((text) => ({ text, tone: "info" as Tone })), { fontSize: 8.6 });

    ensureSpace(70);
    calloutBox(
        "Como ler AC, AUAS e AVN neste laudo",
        AC_VS_AUAS_GLOSSARY,
        "info",
        { compact: true },
    );

    /* ─── Anexo fotográfico ──────────────────────────────────── */

    // Cena que não desceu não pode sumir calada: o leitor precisa saber que a
    // evidência existe e ficou de fora, senão o anexo parece completo.
    const figurasIndisponiveis: string[] = [];
    if (imageBuffers.some((img) => img.buffer)) {
        sectionTitle("Anexo Fotográfico", "Cenas de satélite com os vetores do CAR sobrepostos.");
        let figureIndex = 0;
        for (const img of imageBuffers) {
            if (!img.buffer) {
                figurasIndisponiveis.push(reportSingleLineText(img.caption || "cena sem legenda", 90));
                continue;
            }
            try {
                const pdfImg = (doc as any).openImage(img.buffer);
                const aspectRatio = pdfImg.width / pdfImg.height;
                const MAX_HEIGHT = 430;
                let targetWidth = contentW - 4;
                let targetHeight = targetWidth / aspectRatio;
                if (targetHeight > MAX_HEIGHT) {
                    targetHeight = MAX_HEIGHT;
                    targetWidth = targetHeight * aspectRatio;
                }
                ensureSpace(targetHeight + 40);
                figureIndex += 1;
                const imgY = doc.y;
                const offsetX = margin + 2 + (contentW - 4 - targetWidth) / 2;
                doc.rect(margin, imgY, contentW, targetHeight + 4).fillAndStroke(colors.bg, colors.border);
                doc.image(img.buffer, offsetX, imgY + 2, { width: targetWidth, height: targetHeight });
                doc.y = imgY + targetHeight + 10;
                doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(colors.lightText).text(
                    `Figura ${figureIndex} — ${reportSingleLineText(img.caption || "Imagem de análise espacial", 140)}`,
                    margin,
                    doc.y,
                    { width: contentW, align: "center" },
                );
                doc.moveDown(1.2);
                doc.x = margin;
            } catch {
                figurasIndisponiveis.push(reportSingleLineText(img.caption || "cena sem legenda", 90));
            }
        }
    } else if (imageBuffers.length > 0) {
        sectionTitle("Anexo Fotográfico", "Cenas de satélite com os vetores do CAR sobrepostos.");
        for (const img of imageBuffers) {
            figurasIndisponiveis.push(reportSingleLineText(img.caption || "cena sem legenda", 90));
        }
    }
    if (figurasIndisponiveis.length > 0) {
        ensureSpace(70);
        calloutBox(
            `${figurasIndisponiveis.length} cena(s) não puderam ser anexadas`,
            [
                `Não foi possível recuperar a imagem de: ${figurasIndisponiveis.slice(0, 8).join("; ")}.`,
                "A análise considerou essas cenas; apenas a figura ficou de fora deste PDF. Regerar o laudo costuma resolver.",
            ],
            "warn",
            { compact: true },
        );
    }

    /* ─── Limitações ─────────────────────────────────────────── */

    // Avisos sobre camada excluída da entrega não fazem sentido no laudo: o
    // leitor não encontraria a camada no ZIP para conferir o aviso.
    const warnings = [
        ...(Array.isArray(summary.warnings) ? summary.warnings : []),
        ...(Array.isArray(args.job?.warnings) ? args.job!.warnings! : []),
    ]
        .filter(Boolean)
        .map((item: any) => String(item))
        .filter((text) => ![...EXPORT_EXCLUDED_LAYERS].some((layer) => text.includes(layer)));
    const metaLimitations = [
        ...(Array.isArray(args.auasMeta?.limitations) ? args.auasMeta.limitations : []),
    ]
        .filter(Boolean)
        .map((item: any) => String(item));

    sectionTitle("Limitações e Observações Técnicas");
    calloutBox(
        "Este laudo não substitui o parecer do responsável técnico",
        [
            "Documento técnico de apoio gerado automaticamente por algoritmos de geoprocessamento e Inteligência Artificial. Áreas, interseções e vereditos são indicativos e devem ser revisados por engenheiro ou responsável técnico antes de qualquer submissão a órgão ambiental, tomada de decisão ou uso como peça técnica oficial (ART).",
            "A análise por imagem não conclui infração, passivo ambiental ou irregularidade jurídica: ela indica onde a evidência visual diverge do vetor declarado. A GeoForest IA não se responsabiliza por autuações ou indeferimentos decorrentes do uso não revisado destes dados.",
        ],
        "warn",
    );
    if (warnings.length > 0 || metaLimitations.length > 0) {
        bulletList(
            [...metaLimitations.slice(0, 8), ...warnings.slice(0, 8)].map((text) => ({ text, tone: "neutral" as Tone })),
            { fontSize: 8.6 },
        );
    }

    /* ─── Rodapé do Ofício (endereço + página) ───────────────── */

    // Só aqui se conhece o total de páginas, então o rodapé é carimbado num
    // segundo passe — ele mora dentro da margem inferior, sem cobrir conteúdo.
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i += 1) {
        doc.switchToPage(i);
        timbrado.drawFooter(i + 1);
    }

    doc.end();
    return done;
}

/**
 * Remove do storage o PDF/DOCX da geração anterior deste mesmo job.
 *
 * Silencioso de propósito: falhar em apagar um arquivo velho não pode derrubar
 * a entrega do laudo novo, que já está pronto e persistido.
 */
async function discardSupersededReportFiles(
    uid: string,
    persisted: any,
    atuais: { reportPdfUrl: string; reportDocxUrl: string },
): Promise<void> {
    const anteriores = [
        String(persisted?.reportPdfUrl || ""),
        String(persisted?.files?.reportPdfUrl || ""),
        String(persisted?.reportDocxUrl || ""),
        String(persisted?.files?.reportDocxUrl || ""),
    ];
    const manter = new Set([atuais.reportPdfUrl, atuais.reportDocxUrl].filter(Boolean));
    const alvos = Array.from(new Set(anteriores.filter(Boolean)))
        .filter((url) => !manter.has(url))
        .filter((url) => storagePathBelongsToUid(uid, url));
    for (const url of alvos) {
        try {
            await deleteFromCloudinary(url, "raw");
        } catch (err: any) {
            console.warn("[SIMCAR REPORT] não deu para apagar laudo anterior:", err?.message || err);
        }
    }
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
        const persisted = readPersistedSimcarClipForUid(uid, jobId) || {};
        const job = await hydrateCachedJob(
            jobId,
            args.contextUrl || persisted.contextUrl || persisted.files?.contextUrl,
            args.outputZipUrl || persisted.outputZipUrl || persisted.files?.outputZipUrl,
            uid,
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
        const analysisText = reportCleanText(args.analysisText || extractFirstAiText(persisted.analysisMessages), 12000);
        const auasText = reportCleanText(args.auasText || extractFirstAiText(persisted.auasAnalysisMessages), 12000);
        if (!analysisText && !auasText) {
            throw new Error("Nenhuma análise IA encontrada para gerar o PDF.");
        }
        // Uma resolução só para os dois formatos: o DOCX não desenha as figuras,
        // mas declara a origem das cenas a partir das mesmas legendas.
        const analysisImages = args.analysisImages?.length
            ? args.analysisImages
            : normalizeReportImages(persisted.analysisImages);
        const auasImages = args.auasImages?.length
            ? args.auasImages
            : normalizeReportImages(persisted.auasAnalysisImages);
        const reportFilename = `SIMCAR_Laudo_Tecnico_${jobId.slice(0, 8)}.pdf`;
        const pdfBuffer = await buildSimcarReportPdfBuffer({
            jobId,
            filename: String(persisted.filename || persisted.title || `Recorte ${jobId.slice(0, 8)}`),
            sourceMode: String(persisted.sourceMode || ""),
            summary,
            job,
            analysisText,
            analysisMeta: args.analysisMeta || persisted.analysisMeta,
            analysisImages,
            auasText,
            auasMeta: args.auasMeta || persisted.auasMeta,
            auasImages,
        });
        const generatedAt = new Date().toISOString();
        const reportPdfUrl = await uploadRawBufferToCloudinary(
            pdfBuffer,
            reportFilename,
            "application/pdf",
            uid,
        );

        // O DOCX é o formato editável do MESMO laudo. Falha nele não retém a
        // entrega: o PDF já está pronto e é a peça final.
        const docxFilename = `SIMCAR_Laudo_Tecnico_${jobId.slice(0, 8)}.docx`;
        let reportDocxUrl = "";
        try {
            const docxBuffer = await buildSimcarReportDocxBuffer({
                jobId,
                filename: String(persisted.filename || persisted.title || `Recorte ${jobId.slice(0, 8)}`),
                sourceMode: String(persisted.sourceMode || ""),
                summary,
                job,
                analysisText,
                analysisMeta: args.analysisMeta || persisted.analysisMeta,
                auasText,
                auasMeta: args.auasMeta || persisted.auasMeta,
                analysisImages,
                auasImages,
            });
            reportDocxUrl = await uploadRawBufferToCloudinary(
                docxBuffer,
                docxFilename,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                uid,
            );
        } catch (docxError: any) {
            console.error("[SIMCAR REPORT] DOCX build failed (PDF segue válido):", docxError?.message || docxError);
        }

        const artifact: SimcarReportArtifact = {
            reportPdfUrl,
            reportPdfDownloadUrl: reportPdfUrl,
            reportPdfFilename: reportFilename,
            reportPdfGeneratedAt: generatedAt,
            reportPdfVersion: SIMCAR_REPORT_VERSION,
            reportPdfStatus: "ready",
            ...(reportDocxUrl
                ? {
                    reportDocxUrl,
                    reportDocxDownloadUrl: reportDocxUrl,
                    reportDocxFilename: docxFilename,
                    reportDocxVersion: SIMCAR_REPORT_DOCX_VERSION,
                }
                : {}),
        };
        // Cada geração sobe um arquivo novo (o nome leva `Date.now()`), então sem
        // isto o laudo anterior fica órfão no storage para sempre — e o fluxo
        // vetorizado gera DUAS vezes por rodada (uma ao fim do AC/AVN, outra ao
        // fim do AUAS), o que dobrava o lixo a cada análise.
        await discardSupersededReportFiles(uid, persisted, { reportPdfUrl, reportDocxUrl });

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
                    ...(reportDocxUrl ? { reportDocxUrl, reportDocxDownloadUrl: reportDocxUrl } : {}),
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
