/**
 * DOCX Report — laudo técnico SIMCAR em Word.
 *
 * Espelha o PDF (`report.ts`) **consumindo o mesmo modelo**: veredito, achados,
 * resumo executivo, linha do tempo e classificação de camadas saem todos de
 * `report-theme.ts`, que é puro e testado. Assim os dois formatos não podem
 * divergir no conteúdo — só no desenho.
 *
 * Sai no mesmo papel timbrado da IMAP do PDF (`report-imap-docx.ts`).
 *
 * Origem: rascunho não commitado que estava parado no checkout de produção
 * (2026-08-20). Foi retomado, corrigido (não compilava; a tabela de camadas era
 * montada e nunca inserida), religado ao `report-theme` e ao timbrado.
 */

import {
    AlignmentType,
    BorderStyle,
    Document,
    ImageRun,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from "docx";
import sharp from "sharp";

import { readPersistedSimcarClipForUid, hydrateCachedJob, persistSimcarClipArtifacts } from "./hydration";
import { uploadRawBufferToCloudinary } from "./cloudinary";
import { EXPORT_EXCLUDED_LAYERS, isExcludedFromExport, toPublicApiUrl } from "./constants";
import type { CachedJob } from "./types";
import {
    extractFirstAiText,
    normalizeReportImages,
    reportCleanText,
    reportPdfSafeText,
    reportSingleLineText,
    type SimcarReportImage,
} from "./report-text";
import {
    AC_VS_AUAS_GLOSSARY,
    LEGAL_BASIS_LINES,
    PALETTE,
    TONES,
    buildAcAvnFindings,
    buildAuasFindings,
    buildExecutiveBullets,
    buildTimelineModel,
    buildVerdictPanel,
    classifyLayerNature,
    detectReportKind,
    imageSourceNote,
    parseMarkdownBlocks,
    reportKindSectionTitle,
    reportPhotoAnnexHeading,
    vectorSourceNote,
    type Finding,
    type TimelineModel,
    type Tone,
} from "./report-theme";
import { imapDocxFooter, imapDocxHeader, imapDocxPageProperties } from "./report-imap-docx";

const SIMCAR_REPORT_DOCX_VERSION = "simcar-report-docx-v1";
export { SIMCAR_REPORT_DOCX_VERSION };
const REPORT_HEADER_TITLE = "LAUDO TÉCNICO SIMCAR";

/** OOXML não aceita `#` em cor. */
const hex = (color: string) => color.replace("#", "");

export type SimcarReportDocxArtifact = {
    reportDocxUrl: string;
    reportDocxDownloadUrl: string;
    reportDocxFilename: string;
    reportDocxGeneratedAt: string;
    reportDocxVersion: string;
    reportDocxStatus: "ready";
};

type Block = Paragraph | Table;

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
    const clean = toPublicApiUrl(url);
    if (!clean) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(clean, { signal: controller.signal });
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/* ─── Primitivas ─────────────────────────────────────────────── */

function sectionTitle(text: string, subtitle?: string): Block[] {
    const blocks: Block[] = [
        new Paragraph({
            spacing: { before: 320, after: subtitle ? 40 : 140 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(PALETTE.primary) } },
            children: [new TextRun({ text, bold: true, size: 26, color: hex(PALETTE.dark) })],
        }),
    ];
    if (subtitle) {
        blocks.push(
            new Paragraph({
                spacing: { after: 140 },
                children: [new TextRun({ text: subtitle, size: 16, color: hex(PALETTE.lightText) })],
            }),
        );
    }
    return blocks;
}

function bodyParagraph(text: string, opts: { size?: number; color?: string } = {}): Paragraph {
    return new Paragraph({
        spacing: { after: 120, line: 276, lineRule: "auto" },
        children: [
            new TextRun({ text, size: opts.size ?? 19, color: hex(opts.color ?? PALETTE.text) }),
        ],
    });
}

/** Bullet com marcador colorido pelo tom — o equivalente do círculo do PDF. */
function toneBullet(text: string, tone: Tone, size = 19): Paragraph {
    return new Paragraph({
        spacing: { after: 90, line: 276, lineRule: "auto" },
        indent: { left: 340, hanging: 200 },
        children: [
            new TextRun({ text: "■  ", size, color: hex(TONES[tone].fg) }),
            new TextRun({ text, size, color: hex(PALETTE.text) }),
        ],
    });
}

function cell(children: Paragraph[], opts: { fill?: string; width?: number; span?: number } = {}): TableCell {
    return new TableCell({
        children,
        ...(opts.fill ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(opts.fill) } } : {}),
        ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
        ...(opts.span ? { columnSpan: opts.span } : {}),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });
}

function textCell(
    text: string,
    opts: { bold?: boolean; size?: number; color?: string; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {},
): TableCell {
    return cell(
        [
            new Paragraph({
                alignment: opts.align,
                children: [
                    new TextRun({
                        text,
                        bold: opts.bold,
                        size: opts.size ?? 17,
                        color: hex(opts.color ?? PALETTE.darkText),
                    }),
                ],
            }),
        ],
        { fill: opts.fill, width: opts.width },
    );
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;

function fullWidthTable(rows: TableRow[], opts: { borderless?: boolean } = {}): Table {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        ...(opts.borderless
            ? {
                  borders: {
                      top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
                      insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
                  },
              }
            : {}),
        rows,
    });
}

/* ─── Seções ─────────────────────────────────────────────────── */

function aberturaBlocks(args: { jobId: string; filename: string }): Block[] {
    return [
        new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: "Laudo Técnico SIMCAR", bold: true, size: 38, color: hex(PALETTE.dark) })],
        }),
        new Paragraph({
            spacing: { after: 160 },
            children: [
                new TextRun({
                    text: "Análise geoespacial assistida por IA · documento de apoio ao responsável técnico",
                    size: 17,
                    color: hex(PALETTE.lightText),
                }),
            ],
        }),
        new Paragraph({
            spacing: { after: 40 },
            border: { top: { style: BorderStyle.SINGLE, size: 6, color: hex(PALETTE.border) } },
            children: [
                new TextRun({
                    text: reportSingleLineText(args.filename || "Recorte SIMCAR", 90),
                    bold: true,
                    size: 21,
                    color: hex(PALETTE.darkText),
                }),
            ],
        }),
        new Paragraph({
            spacing: { after: 240 },
            children: [
                new TextRun({
                    text: `Job: ${reportSingleLineText(args.jobId, 44)} · Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })} · ${SIMCAR_REPORT_DOCX_VERSION}`,
                    size: 15,
                    color: hex(PALETTE.lightText),
                }),
            ],
        }),
    ];
}

function veredictoBlocks(verdict: ReturnType<typeof buildVerdictPanel>): Block[] {
    const palette = TONES[verdict.tone];
    return [
        fullWidthTable([
            new TableRow({
                children: [
                    cell(
                        [
                            new Paragraph({
                                spacing: { after: 40 },
                                children: [
                                    new TextRun({ text: "VEREDITO GERAL DA ANÁLISE", size: 14, color: hex(PALETTE.lightText) }),
                                ],
                            }),
                            new Paragraph({
                                spacing: { after: 80 },
                                children: [
                                    new TextRun({ text: verdict.title, bold: true, size: 28, color: hex(palette.fg) }),
                                    new TextRun({ text: `     Confiança: ${verdict.confidence}`, bold: true, size: 16, color: hex(TONES[verdict.confidenceTone].fg) }),
                                ],
                            }),
                            new Paragraph({
                                children: [
                                    new TextRun({ text: reportPdfSafeText(verdict.headline, 600), size: 19, color: hex(PALETTE.darkText) }),
                                ],
                            }),
                        ],
                        { fill: palette.bg },
                    ),
                ],
            }),
        ]),
        new Paragraph({ spacing: { after: 160 } }),
    ];
}

function metricasBlocks(args: {
    propertyAreaHa: number;
    layersWithData: number;
    totalLayers: number;
    totalFeatures: number;
    timeline: TimelineModel | null;
}): Block[] {
    const box = (label: string, value: string, tone: Tone) =>
        cell(
            [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 20 },
                    children: [new TextRun({ text: value, bold: true, size: 22, color: hex(TONES[tone].fg) })],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: label, size: 14, color: hex(PALETTE.lightText) })],
                }),
            ],
            { fill: TONES[tone].bg, width: 25 },
        );

    return [
        fullWidthTable([
            new TableRow({
                children: [
                    box("Área do imóvel", `${args.propertyAreaHa.toFixed(2)} ha`, "info"),
                    box("Camadas com dados", `${args.layersWithData}/${args.totalLayers}`, args.layersWithData > 0 ? "warn" : "ok"),
                    box("Feições recortadas", String(args.totalFeatures), "neutral"),
                    box("Janela temporal", args.timeline ? `${args.timeline.firstYear}–${args.timeline.lastYear}` : "Sem série", args.timeline ? "info" : "neutral"),
                ],
            }),
        ]),
        new Paragraph({ spacing: { after: 160 } }),
    ];
}

function achadosBlocks(findings: Finding[]): Block[] {
    if (findings.length === 0) return [];
    const rows = [
        new TableRow({
            tableHeader: true,
            children: [
                textCell("Achado", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, width: 34 }),
                textCell("Situação", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, width: 18 }),
                textCell("Leitura", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, width: 48 }),
            ],
        }),
        ...findings.map((finding) =>
            new TableRow({
                children: [
                    textCell(reportSingleLineText(finding.label, 60), { bold: true, size: 16 }),
                    textCell(finding.status, { bold: true, size: 15, color: TONES[finding.tone].fg, fill: TONES[finding.tone].bg }),
                    textCell(reportPdfSafeText(finding.detail, 400), { size: 16, color: PALETTE.text }),
                ],
            }),
        ),
    ];
    return [
        ...sectionTitle("Quadro de Achados", "Verde = conforme · Amarelo = pendente de confirmação · Vermelho = revisar antes de submeter."),
        fullWidthTable(rows),
        new Paragraph({ spacing: { after: 160 } }),
    ];
}

/**
 * Linha do tempo. O PDF desenha o eixo; no Word ela vira uma faixa de anos, que
 * é o que o formato faz bem — mesma informação (ano, cena utilizável, conversão
 * datada), sem fingir que é um gráfico.
 */
function linhaDoTempoBlocks(model: TimelineModel | null): Block[] {
    if (!model) return [];
    const marcador = (estado: string) =>
        estado === "event" ? "conversão" : estado === "missing" ? "sem cena" : "cena ok";
    const tomDoEstado = (estado: string): Tone =>
        estado === "event" ? "danger" : estado === "missing" ? "neutral" : "ok";

    const anos = model.years;
    const linhas: TableRow[] = [];
    const PORLINHA = 8;
    for (let i = 0; i < anos.length; i += PORLINHA) {
        const fatia = anos.slice(i, i + PORLINHA);
        linhas.push(
            new TableRow({
                children: fatia.map((ano) =>
                    textCell(String(ano.year), {
                        bold: true,
                        size: 16,
                        align: AlignmentType.CENTER,
                        color: ano.year === model.markerYear ? TONES.danger.fg : PALETTE.darkText,
                        fill: ano.year === model.markerYear ? TONES.danger.bg : PALETTE.bg,
                    }),
                ),
            }),
        );
        linhas.push(
            new TableRow({
                children: fatia.map((ano) =>
                    textCell(marcador(ano.state), {
                        size: 13,
                        align: AlignmentType.CENTER,
                        color: TONES[tomDoEstado(ano.state)].fg,
                    }),
                ),
            }),
        );
    }

    const usaveis = anos.filter((y) => y.state !== "missing").length;
    const blocks: Block[] = [
        ...sectionTitle(
            "Linha do Tempo da Análise",
            `${model.firstYear} a ${model.lastYear} · ${usaveis} de ${anos.length} ano(s) com cena utilizável · marco do Código Florestal (22/07/2008) destacado.`,
        ),
        fullWidthTable(linhas),
        new Paragraph({
            spacing: { before: 80, after: 120 },
            children: [new TextRun({ text: model.caption, size: 15, italics: true, color: hex(PALETTE.lightText) })],
        }),
    ];

    if (model.eventYears.length > 0) {
        const posMarco = model.markerYear !== null && model.eventYears.some((y) => y > model.markerYear!);
        blocks.push(
            fullWidthTable([
                new TableRow({
                    children: [
                        cell(
                            [
                                new Paragraph({
                                    spacing: { after: 40 },
                                    children: [new TextRun({ text: "Datação observada", bold: true, size: 18, color: hex(TONES.warn.fg) })],
                                }),
                                new Paragraph({
                                    children: [
                                        new TextRun({
                                            text: `Conversão de vegetação nativa observada em: ${model.eventYears.join(", ")}. ${
                                                posMarco
                                                    ? "Eventos posteriores a 2008 exigem autorização de supressão (Lei 12.651/2012, art. 26) — confrontar com AUTEX/AUAS emitidas."
                                                    : "Eventos anteriores ao marco reforçam a caracterização de área consolidada."
                                            }`,
                                            size: 17,
                                            color: hex(PALETTE.darkText),
                                        }),
                                    ],
                                }),
                            ],
                            { fill: TONES.warn.bg },
                        ),
                    ],
                }),
            ]),
        );
        blocks.push(new Paragraph({ spacing: { after: 160 } }));
    }
    return blocks;
}

/** Nota em caixa neutra sem borda (origem dos dados, origem das imagens, glossário). */
function notaCallout(note: { label: string; detail: string | string[] }): Table {
    const details = Array.isArray(note.detail) ? note.detail : [note.detail];
    return fullWidthTable(
        [
            new TableRow({
                children: [
                    cell(
                        [
                            new Paragraph({
                                spacing: { after: 60 },
                                children: [new TextRun({ text: note.label, bold: true, size: 19, color: hex(TONES.neutral.fg) })],
                            }),
                            ...details.map((detail, i) =>
                                new Paragraph({
                                    spacing: { after: i === details.length - 1 ? 0 : 60 },
                                    children: [new TextRun({ text: detail, size: 18, color: hex(PALETTE.text) })],
                                }),
                            ),
                        ],
                        { fill: TONES.neutral.bg },
                    ),
                ],
            }),
        ],
        { borderless: true },
    );
}

function camadasBlocks(
    layers: any[],
    propertyAreaHa: number,
    opts: { sourceMode?: string; imageCaptions?: string[] } = {},
): Block[] {
    // Mesma nota de origem do PDF: base da SEMA x ZIP vetorizado do RT,
    // mais a origem das cenas de satélite usadas pela análise.
    const origem = vectorSourceNote(opts.sourceMode);
    const origemImagens = imageSourceNote(opts.imageCaptions || []);
    const blocks: Block[] = [
        notaCallout(origem),
        ...(origemImagens ? [notaCallout(origemImagens)] : []),
        ...sectionTitle("Quantitativos por Camada", "Somente camadas com feição recortada dentro do imóvel."),
    ];
    const withData = layers.filter((l: any) => Number(l?.features || 0) > 0).slice(0, 24);
    if (withData.length === 0) {
        blocks.push(
            fullWidthTable([
                new TableRow({
                    children: [
                        cell(
                            [
                                new Paragraph({
                                    spacing: { after: 60 },
                                    children: [new TextRun({ text: "Nenhuma sobreposição encontrada", bold: true, size: 19, color: hex(TONES.ok.fg) })],
                                }),
                                bodyParagraph("Nenhuma camada ambiental estadual ou federal apresentou sobreposição com a área do imóvel analisado."),
                            ],
                            { fill: TONES.ok.bg },
                        ),
                    ],
                }),
            ]),
        );
        blocks.push(new Paragraph({ spacing: { after: 160 } }));
        return blocks;
    }

    // Era aqui que o rascunho quebrava: a tabela era construída e nunca entrava
    // no documento, então a seção saía só com o título.
    const rows = [
        new TableRow({
            tableHeader: true,
            children: [
                textCell("Camada ambiental", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, width: 36 }),
                textCell("Natureza", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, width: 16 }),
                textCell("Feições", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, align: AlignmentType.RIGHT, width: 14 }),
                textCell("Área (ha)", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, align: AlignmentType.RIGHT, width: 18 }),
                textCell("% imóvel", { bold: true, size: 15, color: PALETTE.white, fill: PALETTE.dark, align: AlignmentType.RIGHT, width: 16 }),
            ],
        }),
        ...withData.map((layer: any, idx: number) => {
            const areaHa = Number(layer.areaHa || 0);
            const pctValue = propertyAreaHa > 0 && areaHa > 0 ? (areaHa / propertyAreaHa) * 100 : 0;
            const { nature, tone } = classifyLayerNature(layer.name);
            const fill = idx % 2 === 0 ? PALETTE.bg : PALETTE.white;
            return new TableRow({
                children: [
                    textCell(reportSingleLineText(layer.name || "-", 40), { size: 16, fill }),
                    textCell(nature, { bold: true, size: 14, color: TONES[tone].fg, fill }),
                    textCell(String(Number(layer.features || 0)), { size: 16, align: AlignmentType.RIGHT, fill }),
                    textCell(areaHa > 0 ? areaHa.toFixed(2) : "-", { size: 16, align: AlignmentType.RIGHT, fill }),
                    textCell(pctValue > 0 ? `${pctValue.toFixed(1)}%` : "-", {
                        size: 16,
                        bold: pctValue >= 25,
                        color: pctValue >= 25 ? TONES.warn.fg : PALETTE.darkText,
                        align: AlignmentType.RIGHT,
                        fill,
                    }),
                ],
            });
        }),
    ];
    blocks.push(fullWidthTable(rows));
    const comDados = layers.filter((l: any) => Number(l?.features || 0) > 0).length;
    if (comDados > withData.length) {
        blocks.push(
            new Paragraph({
                spacing: { before: 80, after: 120 },
                children: [
                    new TextRun({
                        text: `Exibindo as ${withData.length} primeiras camadas com dados; a lista completa está no ZIP do recorte.`,
                        italics: true,
                        size: 15,
                        color: hex(PALETTE.lightText),
                    }),
                ],
            }),
        );
    }
    blocks.push(new Paragraph({ spacing: { after: 160 } }));
    return blocks;
}

/** Markdown da IA → títulos, bullets e parágrafos (mesmo parser do PDF). */
function markdownBlocks(markdown: string, maxChars = 9000): Block[] {
    const blocks: Block[] = [];
    const parsed = parseMarkdownBlocks(reportCleanText(markdown, maxChars));
    if (parsed.length === 0) return [bodyParagraph("Não informado.", { color: PALETTE.lightText })];
    for (const block of parsed) {
        if (block.type === "heading") {
            blocks.push(
                new Paragraph({
                    spacing: { before: 200, after: 80 },
                    children: [
                        new TextRun({
                            text: reportSingleLineText(block.text, 90).toUpperCase(),
                            bold: true,
                            size: 19,
                            color: hex(PALETTE.primary),
                        }),
                    ],
                }),
            );
            continue;
        }
        if (block.type === "bullet") {
            const label = block.label ? `${reportSingleLineText(block.label, 60)}: ` : "";
            const text = reportPdfSafeText(block.text, 900);
            if (!label && !text) continue;
            blocks.push(
                new Paragraph({
                    spacing: { after: 90, line: 276, lineRule: "auto" },
                    indent: { left: 340, hanging: 200 },
                    children: [
                        new TextRun({ text: "■  ", size: 19, color: hex(PALETTE.primary) }),
                        ...(label ? [new TextRun({ text: label, bold: true, size: 19, color: hex(PALETTE.darkText) })] : []),
                        new TextRun({ text, size: 19, color: hex(PALETTE.text) }),
                    ],
                }),
            );
            continue;
        }
        blocks.push(bodyParagraph(reportPdfSafeText(block.text, 1800)));
    }
    return blocks;
}

/** Anexo fotográfico com proporção preservada (o rascunho forçava 520×340). */
async function anexoBlocks(images: { url: string; caption: string; buffer: Buffer | null }[]): Promise<Block[]> {
    const usaveis = images.filter((img) => img.buffer);
    if (usaveis.length === 0) return [];
    const blocks: Block[] = [...sectionTitle("Anexo Fotográfico", "Cenas de satélite com os vetores do CAR sobrepostos.")];
    const LARGURA_MAX = 600; // px, ~ largura útil do Ofício
    const ALTURA_MAX = 430;
    let figura = 0;
    for (const img of usaveis) {
        let largura = LARGURA_MAX;
        let altura = Math.round(LARGURA_MAX * 0.66);
        try {
            const meta = await sharp(img.buffer!).metadata();
            if (meta.width && meta.height) {
                const proporcao = meta.width / meta.height;
                altura = Math.round(largura / proporcao);
                if (altura > ALTURA_MAX) {
                    altura = ALTURA_MAX;
                    largura = Math.round(ALTURA_MAX * proporcao);
                }
            }
        } catch {
            // sem metadata: fica no tamanho padrão
        }
        try {
            figura += 1;
            blocks.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 160, after: 40 },
                    children: [new ImageRun({ type: "png", data: img.buffer!, transformation: { width: largura, height: altura } })],
                }),
            );
            blocks.push(
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 160 },
                    children: [
                        new TextRun({
                            text: `Figura ${figura} — ${reportSingleLineText(img.caption || "Imagem de análise espacial", 140)}`,
                            italics: true,
                            size: 16,
                            color: hex(PALETTE.lightText),
                        }),
                    ],
                }),
            );
        } catch {
            figura -= 1; // imagem que não decodifica não consome número de figura
        }
    }
    return blocks;
}

/* ─── Documento ──────────────────────────────────────────────── */

export async function buildSimcarReportDocxBuffer(args: {
    jobId: string;
    filename: string;
    sourceMode?: string;
    summary?: any;
    job?: CachedJob;
    analysisText?: string;
    analysisMeta?: any;
    /** Só as legendas interessam no glossário; as imagens entram no anexo. */
    analysisImages?: SimcarReportImage[];
    auasText?: string;
    auasMeta?: any;
    auasImages?: SimcarReportImage[];
}): Promise<Buffer> {
    const summary = args.summary || {};
    const analysisImages = args.analysisImages || [];
    const auasImages = args.auasImages || [];

    // Mesma exclusão do PDF e do ZIP: o laudo não anuncia camada que a entrega
    // não contém. Ver `EXPORT_EXCLUDED_LAYERS` em `constants.ts`.
    const rawLayers: any[] = Array.isArray(summary.layers) ? summary.layers : (args.job?.layerSummaries || []);
    const layers = rawLayers.filter((l: any) => !isExcludedFromExport(l?.name));
    const excludedLayerCount = rawLayers.length - layers.length;
    const propertyAreaHa = Number(summary.propertyAreaHa || args.job?.areaHa || 0);
    // Mesmos quantitativos do PDF (`report.ts`) — os dois formatos não podem divergir.
    const layersWithData = layers.filter((l: any) => Number(l?.features || 0) > 0).length;
    const totalFeatures = layers.reduce((sum: number, l: any) => sum + Number(l?.features || 0), 0);
    const totalLayers = Math.max(0, Number(summary.layersProcessed || rawLayers.length || 0) - excludedLayerCount);

    const auasKind = detectReportKind(args.auasMeta);
    const findings: Finding[] = [
        ...(args.analysisText ? buildAcAvnFindings(args.analysisMeta) : []),
        ...(args.auasText ? buildAuasFindings(args.auasMeta, auasKind) : []),
    ];
    const timeline = buildTimelineModel({ analysisMeta: args.analysisMeta, auasMeta: args.auasMeta });
    const verdict = buildVerdictPanel({ findings, kind: auasKind, analysisMeta: args.analysisMeta, auasMeta: args.auasMeta });

    const selecionadas = [...analysisImages, ...auasImages]
        .filter((img, idx, arr) => img.url && arr.findIndex((o) => o.url === img.url) === idx)
        .slice(0, 8);
    const imagens = await Promise.all(
        selecionadas.map(async (img) => ({ ...img, buffer: await fetchImageBuffer(img.url) })),
    );

    const blocks: Block[] = [
        ...aberturaBlocks({ jobId: args.jobId, filename: args.filename }),
        ...veredictoBlocks(verdict),
        ...metricasBlocks({ propertyAreaHa, layersWithData, totalLayers, totalFeatures, timeline }),
        ...sectionTitle("Resumo Executivo", "Leitura rápida: o que a análise encontrou e o que exige ação."),
        ...buildExecutiveBullets({
            jobId: args.jobId,
            findings,
            timeline,
        }).map((item) => toneBullet(reportPdfSafeText(item.text, 700), item.tone)),
        ...achadosBlocks(findings),
        ...linhaDoTempoBlocks(timeline),
        ...camadasBlocks(layers, propertyAreaHa, {
            sourceMode: args.sourceMode,
            imageCaptions: [...analysisImages, ...auasImages].map((img) => String(img?.caption || "")),
        }),
    ];

    if (args.analysisText) {
        blocks.push(
            ...sectionTitle("Análise de Área Consolidada e Vegetação Nativa (AC/AVN)", "Interpretação das cenas em torno do marco de 22/07/2008."),
            ...markdownBlocks(args.analysisText),
        );
    }
    if (args.auasText) {
        blocks.push(
            ...sectionTitle(reportKindSectionTitle(auasKind), "Resultado por polígono, conforme calculado pelo sistema."),
            ...markdownBlocks(args.auasText),
        );
    }

    // Seção de dúvidas (só a Fase 1 tem `doubtSignals`) + anexo fotográfico por
    // polígono/ano, este comum às TRÊS fases — todas guardam em
    // `scenes[].publicImageUrl` a mesma imagem que a visão analisou.
    const annexHeading = reportPhotoAnnexHeading(auasKind);
    if (args.auasMeta && annexHeading) {
        try {
            const { auasDoubtBlocks, auasScenesGalleryBlocks } = await import("./report-docx-auas");
            const doubtPolygons: any[] = auasKind !== "AUAS_PRE2008" ? [] :
                (Array.isArray(args.auasMeta.polygons) ? args.auasMeta.polygons : [])
                .filter((p: any) => p?.status === "SINAL_DE_DUVIDA" || Number(p?.geometryChecks?.overlapAcHa || 0) > 0.01 || Number(p?.geometryChecks?.overlapAvnHa || 0) > 0.01);
            const doubtBlocks = auasDoubtBlocks(doubtPolygons);
            if (doubtBlocks.length > 0) blocks.push(...doubtBlocks);
            const gallery = await auasScenesGalleryBlocks(
                Array.isArray(args.auasMeta.scenes) ? args.auasMeta.scenes : [],
                doubtPolygons.length > 0 ? doubtPolygons : args.auasMeta.polygons || [],
                annexHeading,
            );
            if (gallery.length > 0) blocks.push(...gallery);
        } catch (auasDocxErr) {
            console.warn(`[SIMCAR DOCX] anexo fotográfico de ${auasKind} falhou (não-fatal):`, auasDocxErr instanceof Error ? auasDocxErr.message : auasDocxErr);
        }
    }

    blocks.push(
        ...sectionTitle("Fundamentação Legal Aplicada", "Normas que definem os marcos temporais usados nesta análise."),
        ...LEGAL_BASIS_LINES.map((text) => toneBullet(text, "info", 16)),
        notaCallout({ label: "Como ler AC, AUAS e AVN neste laudo", detail: [...AC_VS_AUAS_GLOSSARY] }),
    );
    blocks.push(...(await anexoBlocks(imagens)));

    const warnings = [
        ...(Array.isArray(summary.warnings) ? summary.warnings : []),
        ...(Array.isArray(args.job?.warnings) ? args.job!.warnings! : []),
    ]
        .filter(Boolean)
        .map(String)
        // Mesmo filtro do PDF: o laudo não comenta camada que a entrega não contém.
        .filter((item) => ![...EXPORT_EXCLUDED_LAYERS].some((layer) => item.includes(layer)));
    const metaLimitations = (Array.isArray(args.auasMeta?.limitations) ? args.auasMeta.limitations : []).filter(Boolean).map(String);

    blocks.push(...sectionTitle("Limitações e Observações Técnicas"));
    blocks.push(
        fullWidthTable([
            new TableRow({
                children: [
                    cell(
                        [
                            new Paragraph({
                                spacing: { after: 60 },
                                children: [
                                    new TextRun({
                                        text: "Este laudo não substitui o parecer do responsável técnico",
                                        bold: true,
                                        size: 18,
                                        color: hex(TONES.warn.fg),
                                    }),
                                ],
                            }),
                            bodyParagraph(
                                "Documento técnico de apoio gerado automaticamente por algoritmos de geoprocessamento e Inteligência Artificial. Áreas, interseções e vereditos são indicativos e devem ser revisados por engenheiro ou responsável técnico antes de qualquer submissão a órgão ambiental, tomada de decisão ou uso como peça técnica oficial (ART).",
                                { size: 17, color: PALETTE.darkText },
                            ),
                            bodyParagraph(
                                "A análise por imagem não conclui infração, passivo ambiental ou irregularidade jurídica: ela indica onde a evidência visual diverge do vetor declarado.",
                                { size: 17, color: PALETTE.darkText },
                            ),
                        ],
                        { fill: TONES.warn.bg },
                    ),
                ],
            }),
        ]),
    );
    const observacoes = [...metaLimitations.slice(0, 8), ...warnings.slice(0, 8)];
    if (observacoes.length > 0) {
        blocks.push(new Paragraph({ spacing: { after: 100 } }));
        blocks.push(...observacoes.map((text) => toneBullet(reportPdfSafeText(text, 500), "neutral", 16)));
    }

    const doc = new Document({
        creator: "GeoForest IA",
        title: `Laudo Técnico SIMCAR - ${args.jobId}`,
        description: "Relatório técnico de análise SIMCAR",
        styles: { default: { document: { run: { font: "Tahoma", size: 19 } } } },
        sections: [
            {
                properties: imapDocxPageProperties(),
                headers: { default: imapDocxHeader(REPORT_HEADER_TITLE) },
                footers: {
                    default: imapDocxFooter(
                        `GeoForest IA · ${SIMCAR_REPORT_DOCX_VERSION} · Job ${reportSingleLineText(args.jobId, 40)}`,
                    ),
                },
                children: blocks,
            },
        ],
    });

    return Buffer.from(await Packer.toBuffer(doc));
}

export async function generateAndPersistSimcarReportDocx(args: {
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
}): Promise<SimcarReportDocxArtifact> {
    const uid = String(args.uid || "").trim();
    const jobId = String(args.jobId || "").trim();
    if (!uid || !jobId) throw new Error("Usuário e jobId são obrigatórios para gerar DOCX.");

    await persistSimcarClipArtifacts({ uid, jobId, patch: { reportDocxStatus: "generating", reportDocxError: null } });

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
            layers: job.layerSummaries,
            warnings: job.warnings,
        } : null);

        const analysisText = reportCleanText(args.analysisText || extractFirstAiText(persisted.analysisMessages), 12000);
        const auasText = reportCleanText(args.auasText || extractFirstAiText(persisted.auasAnalysisMessages), 12000);
        if (!analysisText && !auasText) {
            throw new Error("Nenhuma análise IA encontrada para gerar o DOCX.");
        }

        const reportFilename = `SIMCAR_Laudo_Tecnico_${jobId.slice(0, 8)}.docx`;
        const docxBuffer = await buildSimcarReportDocxBuffer({
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
        const reportDocxUrl = await uploadRawBufferToCloudinary(
            docxBuffer,
            reportFilename,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            uid,
        );
        const artifact: SimcarReportDocxArtifact = {
            reportDocxUrl,
            reportDocxDownloadUrl: reportDocxUrl,
            reportDocxFilename: reportFilename,
            reportDocxGeneratedAt: generatedAt,
            reportDocxVersion: SIMCAR_REPORT_DOCX_VERSION,
            reportDocxStatus: "ready",
        };
        await persistSimcarClipArtifacts({
            uid,
            jobId,
            patch: {
                ...artifact,
                reportDocxError: null,
                files: {
                    ...(persisted.files || {}),
                    reportDocxUrl,
                    reportDocxDownloadUrl: reportDocxUrl,
                },
            },
        });
        return artifact;
    } catch (error: any) {
        const message = String(error?.message || "Falha ao gerar DOCX técnico.");
        await persistSimcarClipArtifacts({ uid, jobId, patch: { reportDocxStatus: "failed", reportDocxError: message } });
        throw error;
    }
}
