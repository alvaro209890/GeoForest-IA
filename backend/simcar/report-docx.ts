/**
 * Laudo técnico SIMCAR em **DOCX** — mesma estrutura e mesmo conteúdo do PDF
 * (`report.ts`), no papel timbrado da IMAP.
 *
 * Por que existe: o PDF é a peça final, mas o responsável técnico precisa
 * **editar** o laudo antes de assinar — trocar uma frase da conclusão, somar
 * uma observação de campo, ajustar a recomendação. Reescrever o laudo inteiro
 * no Word para mudar um parágrafo era o que acontecia até aqui.
 *
 * A decisão de conteúdo NÃO é duplicada: veredito, achados, bullets, linha do
 * tempo, natureza de camada e glossário vêm todos de `report-theme.ts`, os
 * mesmos que o PDF consome. Aqui só se traduz aquele modelo para os objetos do
 * pacote `docx`. Se o texto mudar no tema, muda nos dois formatos junto.
 *
 * Diferenças inevitáveis em relação ao PDF:
 * - a linha do tempo vira **tabela de anos** (não há canvas para desenhar o
 *   eixo com o marco tracejado);
 * - o gráfico de barras não é reproduzido — os mesmos números já estão na
 *   tabela de quantitativos;
 * - o anexo fotográfico não entra, porque exigiria baixar e embutir os PNGs,
 *   dobrando o tamanho do arquivo que o RT vai editar. O PDF segue sendo a peça
 *   com as imagens.
 */

import {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from "docx";

import { EXPORT_EXCLUDED_LAYERS, isExcludedFromExport } from "./constants";
import type { CachedJob } from "./types";
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
    parseMarkdownBlocks,
    reportKindSectionTitle,
    splitLongParagraph,
    type Finding,
    type Tone,
} from "./report-theme";
import { IMAP_ADDRESS_LINES, IMAP_COLORS, loadTimbradoImapPng } from "./report-imap";

export const SIMCAR_REPORT_DOCX_VERSION = "simcar-report-docx-v1";

/** Word mede em twips: 1 pt = 20 twips. As margens são as mesmas do Ofício. */
const PT = 20;

/**
 * Margens do Ofício da IMAP, em twips (`IMAP_PAGE` guarda os mesmos valores em
 * pontos, já convertidos a partir do XML original).
 */
const DOCX_MARGINS = {
    top: 2154,
    bottom: 1700,
    left: 1418,
    right: 1418,
} as const;

/** Largura útil da página, em twips — usada nas tabelas. */
const CONTENT_WIDTH = 11906 - DOCX_MARGINS.left - DOCX_MARGINS.right;

/** `docx` quer a cor sem `#`. */
function hex(color: string): string {
    return String(color || "").replace("#", "").toUpperCase();
}

function toneShading(tone: Tone) {
    return { type: ShadingType.CLEAR, color: "auto", fill: hex(TONES[tone].bg) };
}

/**
 * Limpeza mínima do texto da IA. Menos agressiva que a do PDF: o Word quebra
 * linha sozinho, então não é preciso picotar token longo — só tirar o bloco de
 * raciocínio e as URLs cruas, que no laudo não têm serventia.
 */
function docxSafeText(value: unknown, maxChars = 5000): string {
    return String(value || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/\r/g, "")
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[imagem incorporada]")
        .replace(/https?:\/\/\S+/gi, (rawUrl) => {
            try {
                return `[link: ${new URL(rawUrl.replace(/[),.;:]+$/g, "")).hostname}]`;
            } catch {
                return "[link externo]";
            }
        })
        .replace(/[ \t]{2,}/g, " ")
        .trim()
        .slice(0, maxChars);
}

function text(value: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): TextRun {
    return new TextRun({
        text: value,
        bold: opts.bold,
        italics: opts.italics,
        // `docx` conta em meios-pontos.
        size: (opts.size ?? 10) * 2,
        color: hex(opts.color ?? PALETTE.text),
        font: "Calibri",
    });
}

function sectionHeading(title: string, subtitle?: string): Paragraph[] {
    const out = [
        new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: subtitle ? 40 : 120 },
            children: [text(title, { bold: true, size: 12.5, color: PALETTE.dark })],
        }),
    ];
    if (subtitle) {
        out.push(
            new Paragraph({
                spacing: { after: 140 },
                children: [text(subtitle, { size: 8.5, color: PALETTE.lightText, italics: true })],
            }),
        );
    }
    return out;
}

function bullet(value: string, tone: Tone = "neutral", size = 9.5): Paragraph {
    return new Paragraph({
        spacing: { after: 70 },
        indent: { left: 260, hanging: 180 },
        children: [
            text("• ", { bold: true, size, color: TONES[tone].fg }),
            text(docxSafeText(value, 900), { size }),
        ],
    });
}

/** Caixa de destaque — no Word vira tabela de 1 célula com fundo e borda. */
function calloutTable(title: string, lines: string[], tone: Tone): Table {
    const palette = TONES[tone];
    const children: Paragraph[] = [];
    if (title) {
        children.push(
            new Paragraph({
                spacing: { after: 60 },
                children: [text(title, { bold: true, size: 9.5, color: palette.fg })],
            }),
        );
    }
    for (const line of lines) {
        children.push(
            new Paragraph({
                spacing: { after: 60 },
                children: [text(docxSafeText(line, 900), { size: 9 })],
            }),
        );
    }
    return new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: hex(palette.border) },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(palette.border) },
            left: { style: BorderStyle.SINGLE, size: 18, color: hex(palette.fg) },
            right: { style: BorderStyle.SINGLE, size: 6, color: hex(palette.border) },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
        },
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        shading: toneShading(tone),
                        margins: { top: 120, bottom: 120, left: 160, right: 160 },
                        children: children.length > 0 ? children : [new Paragraph("")],
                    }),
                ],
            }),
        ],
    });
}

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

function headerCell(value: string, width: number, align: Align = AlignmentType.LEFT): TableCell {
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.dark) },
        margins: { top: 70, bottom: 70, left: 90, right: 90 },
        children: [
            new Paragraph({
                alignment: align,
                children: [text(value, { bold: true, size: 8, color: "#FFFFFF" })],
            }),
        ],
    });
}

function bodyCell(
    value: string,
    width: number,
    opts: { align?: Align; bold?: boolean; color?: string; fill?: string } = {},
): TableCell {
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 90, right: 90 },
        shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: hex(opts.fill) } : undefined,
        children: [
            new Paragraph({
                alignment: opts.align ?? AlignmentType.LEFT,
                children: [text(value, { size: 8.5, bold: opts.bold, color: opts.color })],
            }),
        ],
    });
}

const TABLE_BORDERS = {
    top: { style: BorderStyle.SINGLE, size: 2, color: hex(PALETTE.border) },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: hex(PALETTE.border) },
    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: hex(PALETTE.border) },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
} as const;

/** Blocos markdown da IA → parágrafos do Word, preservando título e rótulo. */
function markdownParagraphs(markdown: string): Paragraph[] {
    const blocks = parseMarkdownBlocks(markdown);
    if (blocks.length === 0) {
        return [new Paragraph({ children: [text("Não informado.", { size: 9.5, color: PALETTE.lightText })] })];
    }
    const out: Paragraph[] = [];
    for (const block of blocks) {
        if (block.type === "heading") {
            out.push(
                new Paragraph({
                    spacing: { before: 180, after: 80 },
                    children: [text(docxSafeText(block.text, 200), { bold: true, size: 10.5, color: PALETTE.primary })],
                }),
            );
            continue;
        }
        if (block.type === "bullet") {
            out.push(
                new Paragraph({
                    spacing: { after: 70 },
                    indent: { left: 260, hanging: 180 },
                    children: [
                        text("• ", { bold: true, size: 9.5, color: PALETTE.primary }),
                        ...(block.label
                            ? [text(`${docxSafeText(block.label, 120)}: `, { bold: true, size: 9.5, color: PALETTE.darkText })]
                            : []),
                        text(docxSafeText(block.text, 900), { size: 9.5 }),
                    ],
                }),
            );
            continue;
        }
        for (const part of splitLongParagraph(docxSafeText(block.text, 2400))) {
            out.push(
                new Paragraph({
                    spacing: { after: 90 },
                    alignment: AlignmentType.JUSTIFIED,
                    children: [text(part, { size: 9.5 })],
                }),
            );
        }
    }
    return out;
}

export async function buildSimcarReportDocxBuffer(args: {
    jobId: string;
    filename: string;
    sourceMode?: string;
    summary?: any;
    job?: CachedJob;
    analysisText?: string;
    analysisMeta?: any;
    auasText?: string;
    auasMeta?: any;
}): Promise<Buffer> {
    const summary = args.summary || {};

    // Mesma exclusão do PDF e do ZIP: o laudo não anuncia camada que a entrega
    // não contém. Ver `EXPORT_EXCLUDED_LAYERS` em `constants.ts`.
    const rawLayers: any[] = Array.isArray(summary.layers) ? summary.layers : (args.job?.layerSummaries || []);
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

    const body: Array<Paragraph | Table> = [];

    /* ─── Capa ───────────────────────────────────────────────── */

    body.push(
        new Paragraph({
            spacing: { after: 40 },
            children: [text("Laudo Técnico SIMCAR", { bold: true, size: 19, color: PALETTE.dark })],
        }),
        new Paragraph({
            spacing: { after: 160 },
            children: [
                text("Análise geoespacial assistida por IA · documento de apoio ao responsável técnico", {
                    size: 8.5,
                    color: PALETTE.lightText,
                }),
            ],
        }),
        new Paragraph({
            spacing: { after: 30 },
            children: [text(docxSafeText(args.filename || "Recorte SIMCAR", 120), { bold: true, size: 10.5, color: PALETTE.darkText })],
        }),
        new Paragraph({
            spacing: { after: 220 },
            children: [
                text(
                    `Job: ${docxSafeText(args.jobId, 60)} · Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })} · ${SIMCAR_REPORT_DOCX_VERSION}`,
                    { size: 7.6, color: PALETTE.lightText },
                ),
            ],
        }),
    );

    /* ─── Painel de veredito ─────────────────────────────────── */

    body.push(
        calloutTable(
            `VEREDITO GERAL DA ANÁLISE — ${verdict.title} (confiança: ${verdict.confidence})`,
            [verdict.headline],
            verdict.tone,
        ),
        new Paragraph({ spacing: { after: 160 }, children: [] }),
    );

    /* ─── Métricas ───────────────────────────────────────────── */

    const metricW = Math.floor(CONTENT_WIDTH / 4);
    const metricLabels = ["Área do imóvel", "Camadas com dados", "Feições recortadas", "Janela temporal"];
    const metricValues = [
        `${propertyAreaHa.toFixed(2)} ha`,
        `${layersWithData}/${totalLayers}`,
        String(totalFeatures),
        timeline ? `${timeline.firstYear}–${timeline.lastYear}` : "Sem série",
    ];
    body.push(
        new Table({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            borders: TABLE_BORDERS,
            rows: [
                new TableRow({
                    children: metricValues.map((value) =>
                        bodyCell(value, metricW, { bold: true, color: PALETTE.dark, align: AlignmentType.CENTER }),
                    ),
                }),
                new TableRow({
                    children: metricLabels.map((label) =>
                        bodyCell(label, metricW, { color: PALETTE.lightText, align: AlignmentType.CENTER }),
                    ),
                }),
            ],
        }),
    );

    /* ─── Resumo executivo ───────────────────────────────────── */

    body.push(...sectionHeading("Resumo Executivo", "Leitura rápida: o que a análise encontrou e o que exige ação."));
    for (const item of buildExecutiveBullets({ jobId: args.jobId, findings, timeline })) {
        body.push(bullet(item.text, item.tone));
    }

    /* ─── Quadro de achados ──────────────────────────────────── */

    if (findings.length > 0) {
        body.push(
            ...sectionHeading(
                "Quadro de Achados",
                "Verde = conforme · Amarelo = pendente de confirmação · Vermelho = revisar antes de submeter.",
            ),
        );
        const wLabel = Math.floor(CONTENT_WIDTH * 0.34);
        const wStatus = Math.floor(CONTENT_WIDTH * 0.16);
        const wDetail = CONTENT_WIDTH - wLabel - wStatus;
        body.push(
            new Table({
                width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                borders: TABLE_BORDERS,
                rows: [
                    new TableRow({
                        children: [
                            headerCell("Indicador", wLabel),
                            headerCell("Situação", wStatus),
                            headerCell("Consequência", wDetail),
                        ],
                    }),
                    ...findings.map(
                        (finding) =>
                            new TableRow({
                                children: [
                                    bodyCell(finding.label, wLabel, { bold: true, color: PALETTE.darkText }),
                                    bodyCell(finding.status, wStatus, {
                                        bold: true,
                                        color: TONES[finding.tone].fg,
                                        fill: TONES[finding.tone].bg,
                                    }),
                                    bodyCell(docxSafeText(finding.detail, 400), wDetail),
                                ],
                            }),
                    ),
                ],
            }),
        );
    }

    /* ─── Linha do tempo ─────────────────────────────────────── */

    if (timeline && timeline.years.length > 0) {
        body.push(
            ...sectionHeading(
                "Linha do Tempo da Análise",
                `${timeline.caption} Marco do Código Florestal: 22/07/2008.`,
            ),
        );
        const cellW = Math.max(340, Math.floor(CONTENT_WIDTH / timeline.years.length));
        const stateLabel = (state: string) =>
            state === "event" ? "conversão" : state === "missing" ? "sem cena" : "cena";
        const stateTone = (state: string): Tone => (state === "event" ? "danger" : state === "missing" ? "neutral" : "ok");
        body.push(
            new Table({
                width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                borders: TABLE_BORDERS,
                rows: [
                    new TableRow({
                        children: timeline.years.map((year) =>
                            bodyCell(String(year.year), cellW, {
                                bold: true,
                                align: AlignmentType.CENTER,
                                color: year.year === timeline.markerYear ? TONES.danger.fg : PALETTE.dark,
                            }),
                        ),
                    }),
                    new TableRow({
                        children: timeline.years.map((year) =>
                            bodyCell(stateLabel(year.state), cellW, {
                                align: AlignmentType.CENTER,
                                color: TONES[stateTone(year.state)].fg,
                                fill: TONES[stateTone(year.state)].bg,
                            }),
                        ),
                    }),
                ],
            }),
        );
        if (timeline.eventYears.length > 0) {
            const posMarco = timeline.eventYears.some((year) => year > 2008);
            body.push(
                new Paragraph({ spacing: { after: 80 }, children: [] }),
                calloutTable(
                    "Datação observada",
                    [
                        `Conversão datada em: ${timeline.eventYears.join(", ")}.`,
                        posMarco
                            ? "Eventos posteriores a 2008 exigem autorização de supressão (Lei 12.651/2012, art. 26) — confrontar com AUTEX/AUAS emitidas."
                            : "Eventos anteriores ao marco reforçam a caracterização de área consolidada.",
                    ],
                    posMarco ? "warn" : "info",
                ),
            );
        }
    }

    /* ─── Quantitativos por camada ───────────────────────────── */

    body.push(...sectionHeading("Quantitativos por Camada", "Somente camadas com feição recortada dentro do imóvel."));
    const withData = layers.filter((l: any) => Number(l?.features || 0) > 0).slice(0, 40);
    if (withData.length === 0) {
        body.push(
            calloutTable(
                "Nenhuma sobreposição encontrada",
                ["Nenhuma camada ambiental estadual ou federal apresentou sobreposição com a área do imóvel analisado."],
                "ok",
            ),
        );
    } else {
        const wName = Math.floor(CONTENT_WIDTH * 0.36);
        const wNature = Math.floor(CONTENT_WIDTH * 0.16);
        const wFeat = Math.floor(CONTENT_WIDTH * 0.13);
        const wArea = Math.floor(CONTENT_WIDTH * 0.19);
        const wPct = CONTENT_WIDTH - wName - wNature - wFeat - wArea;
        body.push(
            new Table({
                width: { size: CONTENT_WIDTH, type: WidthType.DXA },
                borders: TABLE_BORDERS,
                rows: [
                    new TableRow({
                        children: [
                            headerCell("Camada ambiental", wName),
                            headerCell("Natureza", wNature),
                            headerCell("Feições", wFeat, AlignmentType.RIGHT),
                            headerCell("Área (ha)", wArea, AlignmentType.RIGHT),
                            headerCell("% imóvel", wPct, AlignmentType.RIGHT),
                        ],
                    }),
                    ...withData.map((layer: any) => {
                        const areaHa = Number(layer?.areaHa || 0);
                        const pct = propertyAreaHa > 0 ? (areaHa / propertyAreaHa) * 100 : 0;
                        const { nature, tone } = classifyLayerNature(String(layer?.name || ""));
                        return new TableRow({
                            children: [
                                bodyCell(String(layer?.name || "Desconhecido"), wName, { color: PALETTE.darkText }),
                                bodyCell(nature, wNature, { bold: true, color: TONES[tone].fg }),
                                bodyCell(String(Number(layer?.features || 0)), wFeat, { align: AlignmentType.RIGHT }),
                                bodyCell(areaHa.toFixed(2), wArea, { align: AlignmentType.RIGHT }),
                                bodyCell(`${pct.toFixed(1)}%`, wPct, {
                                    align: AlignmentType.RIGHT,
                                    bold: pct >= 25,
                                    color: pct >= 25 ? TONES.warn.fg : PALETTE.text,
                                }),
                            ],
                        });
                    }),
                ],
            }),
        );
    }

    /* ─── Texto das análises ─────────────────────────────────── */

    if (args.analysisText) {
        body.push(
            ...sectionHeading(
                "Análise de Área Consolidada e Vegetação Nativa (AC/AVN)",
                "Interpretação das cenas em torno do marco de 22/07/2008.",
            ),
            ...markdownParagraphs(args.analysisText),
        );
    }
    if (args.auasText) {
        body.push(
            ...sectionHeading(reportKindSectionTitle(auasKind), "Resultado por polígono, conforme calculado pelo sistema."),
            ...markdownParagraphs(args.auasText),
        );
    }

    /* ─── Fundamentação legal + glossário ────────────────────── */

    body.push(...sectionHeading("Fundamentação Legal Aplicada", "Normas que definem os marcos temporais usados nesta análise."));
    for (const line of LEGAL_BASIS_LINES) body.push(bullet(line, "info", 8.6));
    body.push(
        new Paragraph({ spacing: { after: 100 }, children: [] }),
        calloutTable("Como ler AC, AUAS e AVN neste laudo", AC_VS_AUAS_GLOSSARY, "info"),
    );

    /* ─── Limitações ─────────────────────────────────────────── */

    const warnings = [
        ...(Array.isArray(summary.warnings) ? summary.warnings : []),
        ...(Array.isArray(args.job?.warnings) ? args.job!.warnings! : []),
    ]
        .filter(Boolean)
        .map((item: any) => String(item))
        .filter((item) => ![...EXPORT_EXCLUDED_LAYERS].some((layer) => item.includes(layer)));
    const metaLimitations = (Array.isArray(args.auasMeta?.limitations) ? args.auasMeta.limitations : [])
        .filter(Boolean)
        .map((item: any) => String(item));

    body.push(
        ...sectionHeading("Limitações e Observações Técnicas"),
        calloutTable(
            "Este laudo não substitui o parecer do responsável técnico",
            [
                "Documento técnico de apoio gerado automaticamente por algoritmos de geoprocessamento e Inteligência Artificial. Áreas, interseções e vereditos são indicativos e devem ser revisados por engenheiro ou responsável técnico antes de qualquer submissão a órgão ambiental, tomada de decisão ou uso como peça técnica oficial (ART).",
                "A análise por imagem não conclui infração, passivo ambiental ou irregularidade jurídica: ela indica onde a evidência visual diverge do vetor declarado. A GeoForest IA não se responsabiliza por autuações ou indeferimentos decorrentes do uso não revisado destes dados.",
            ],
            "warn",
        ),
    );
    if (warnings.length > 0 || metaLimitations.length > 0) {
        body.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
        for (const line of [...metaLimitations.slice(0, 8), ...warnings.slice(0, 8)]) {
            body.push(bullet(line, "neutral", 8.6));
        }
    }

    /* ─── Timbrado: cabeçalho e rodapé ───────────────────────── */

    const timbrado = loadTimbradoImapPng();
    const headerChildren: Paragraph[] = [];
    if (timbrado) {
        headerChildren.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new ImageRun({
                        // O PNG do timbrado cobre a folha inteira (A4 em 96 dpi).
                        type: "png",
                        data: timbrado,
                        transformation: { width: 595, height: 842 },
                        floating: {
                            horizontalPosition: { offset: 0 },
                            verticalPosition: { offset: 0 },
                            behindDocument: true,
                        },
                    }),
                ],
            }),
        );
    }
    headerChildren.push(
        new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [text("LAUDO TÉCNICO SIMCAR", { bold: true, size: 10, color: IMAP_COLORS.headerTitle })],
        }),
    );

    const footerChildren = [
        ...IMAP_ADDRESS_LINES.map(
            (line) =>
                new Paragraph({
                    alignment: AlignmentType.LEFT,
                    spacing: { after: 0 },
                    children: [text(line, { size: 8, color: IMAP_COLORS.inkFrom })],
                }),
        ),
        new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 40 },
            children: [
                text(`${docxSafeText(args.jobId, 44)} · ${SIMCAR_REPORT_DOCX_VERSION} · página `, {
                    size: 6.5,
                    color: IMAP_COLORS.footerMeta,
                }),
                new TextRun({ children: [PageNumber.CURRENT], size: 13, color: hex(IMAP_COLORS.footerMeta), font: "Calibri" }),
            ],
        }),
    ];

    const doc = new Document({
        creator: "GeoForest IA",
        title: "Laudo Técnico SIMCAR",
        description: "Relatório técnico de análise SIMCAR",
        sections: [
            {
                properties: {
                    page: {
                        margin: {
                            top: DOCX_MARGINS.top,
                            bottom: DOCX_MARGINS.bottom,
                            left: DOCX_MARGINS.left,
                            right: DOCX_MARGINS.right,
                            header: 15 * PT,
                            footer: 15 * PT,
                        },
                    },
                },
                headers: { default: new Header({ children: headerChildren }) },
                footers: { default: new Footer({ children: footerChildren }) },
                children: body,
            },
        ],
    });

    return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}
