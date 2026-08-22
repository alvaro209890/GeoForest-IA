/**
 * Papel timbrado da IMAP aplicado ao laudo PDF (pdfkit).
 *
 * O sistema de acompanhamento de processos já emite os .docx de parecer no
 * papel timbrado oficial da IMAP — `frontend/utils/timbradoImap.ts` carrega o
 * PNG e `utils/parecer/parecerDocx.ts` (aplicarTimbradoOficio) troca o
 * header/footer do zip pelo XML verbatim do Ofício. Aqui é o mesmo timbrado:
 * o PNG é bit a bit o mesmo arquivo (A4, 1240×1754 px @150 dpi, logo no topo +
 * marca d'água no rodapé), desenhado como fundo de página, e o cabeçalho/
 * rodapé são redesenhados em pdfkit nas MESMAS coordenadas do Ofício.
 *
 * Toda a geometria sai do `sectPr` do Ofício, convertida de twips (1/20 pt):
 *   top 2154 · bottom 1700 · left 1418 · right 1418 · header 283 · footer 0
 *
 * Para atualizar o timbrado: copiar de novo
 * `acompanhamento-de-processos/frontend/public/assets/timbrado_imap.png` para
 * `assets/timbrado_imap.png` — os dois sistemas devem sair no MESMO papel.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TWIP = 1 / 20;
const EMU = 1 / 12700; // 1 pt = 12700 EMU

/** Cores da identidade IMAP, tiradas do XML do Ofício. */
export const IMAP_COLORS = {
    /** Fio do cabeçalho e borda superior do rodapé (`srgbClr 008A07`). */
    green: "#008A07",
    /** Gradiente vertical do texto do rodapé (`w14:gradFill`, ang 5400000 = 90°). */
    inkFrom: "#000F7F",
    inkTo: "#5C62A1",
    /**
     * Meio-termo sólido do gradiente do rodapé. O Word desenha o gradiente por
     * `w14:textFill`, que a lib `docx` não expõe — no `.docx` o endereço sai
     * nesta cor chapada, no PDF sai no gradiente de verdade.
     */
    inkSolid: "#2E3890",
    /** Título do cabeçalho — no Ofício o run não declara cor (herda preto). */
    headerTitle: "#2B2B2B",
    /** Linha discreta de rastreabilidade do laudo no rodapé. */
    footerMeta: "#94A3B8",
} as const;

/** Endereço do rodapé do Ofício (o `|` do original vem sem espaço antes). */
export const IMAP_ADDRESS_LINES: readonly string[] = [
    "Av. Norte, Nº. 888, Sala 4, Setor Nova Querência",
    "Querência – MT | CEP: 78643-000",
    "Tel.: (66) 9 8437-1837 | E-mail: florestal@imap.eng.br",
];

/** A4 e margens do Ofício, em pontos. */
export const IMAP_PAGE = {
    width: 595.28,
    height: 841.89,
    marginTop: 2154 * TWIP, // 107.7
    marginBottom: 1700 * TWIP, // 85
    marginLeft: 1418 * TWIP, // 70.9
    marginRight: 1418 * TWIP, // 70.9
} as const;

export const IMAP_CONTENT_WIDTH = IMAP_PAGE.width - IMAP_PAGE.marginLeft - IMAP_PAGE.marginRight;

/**
 * Cabeçalho. O Ofício ancora o fio verde a 892810 EMU do topo da página e a
 * 1022350 EMU da margem esquerda (relativo à coluna), com 4820400 EMU de
 * comprimento — o que passaria ~6 pt da margem direita; aqui ele para na
 * margem, que é o que o olho espera num PDF.
 */
export const IMAP_HEADER = {
    ruleY: 892810 * EMU, // 70.3
    ruleX0: IMAP_PAGE.marginLeft + 1022350 * EMU, // 151.4
    ruleX1: IMAP_PAGE.width - IMAP_PAGE.marginRight, // 524.4
    ruleWidth: 1.5,
    /** Topo do título: 4ª linha do cabeçalho (header 283 twips + 3 parágrafos). */
    titleY: 52,
    titleSize: 10,
    /** `w:spacing w:val="100"` = 100 vigésimos de ponto = 5 pt de tracking. */
    titleTracking: 5,
} as const;

/**
 * Rodapé. O Ofício usa uma tabela de 2 colunas (7511 + 1559 twips = a largura
 * útil exata) com borda superior verde: endereço à esquerda, número da página
 * à direita. O bloco fica dentro da margem inferior de 85 pt.
 */
export const IMAP_FOOTER = {
    ruleY: 764,
    addressY: 770,
    lineStep: 10.4,
    addressSize: 8,
    /** Largura da 1ª coluna da tabela do rodapé (7511 twips). */
    addressWidth: 7511 * TWIP, // 375.55
    /** Largura da 2ª coluna (1559 twips) — onde vai o número da página. */
    pageCellWidth: 1559 * TWIP, // 77.95
    pageNumberY: 780.5,
    pageNumberSize: 12,
    /** Linha de rastreabilidade (job/versão), abaixo do endereço. */
    metaY: 802.5,
    metaSize: 6.5,
} as const;

const TIMBRADO_FILENAME = "timbrado_imap.png";

/**
 * Candidatos de caminho do PNG. Em dev o módulo vive em `backend/simcar/`; em
 * produção o esbuild empacota tudo em `dist/index.js`, então `__dirname` é
 * `<raiz>/dist` e o asset continua no fonte (o servidor roda de um checkout).
 */
function timbradoPathCandidates(): string[] {
    return [
        path.resolve(__dirname, "assets", TIMBRADO_FILENAME),
        path.resolve(__dirname, "..", "backend", "simcar", "assets", TIMBRADO_FILENAME),
        path.resolve(process.cwd(), "backend", "simcar", "assets", TIMBRADO_FILENAME),
    ];
}

let timbradoCache: Buffer | null | undefined;

/** Bytes do PNG do timbrado, ou `null` se o asset não estiver no disco. */
export function loadTimbradoImapPng(): Buffer | null {
    if (timbradoCache !== undefined) return timbradoCache;
    const found = timbradoPathCandidates().find((candidate) => fs.existsSync(candidate));
    if (!found) {
        console.warn("[SIMCAR PDF] timbrado_imap.png não encontrado — laudo sai sem papel timbrado.");
        timbradoCache = null;
        return null;
    }
    try {
        timbradoCache = fs.readFileSync(found);
    } catch (err) {
        console.warn("[SIMCAR PDF] falha ao ler o timbrado da IMAP", err);
        timbradoCache = null;
    }
    return timbradoCache;
}

/** Só para teste: esquece o cache do PNG. */
export function resetTimbradoCacheForTests(): void {
    timbradoCache = undefined;
}

type Doc = PDFKit.PDFDocument;

/**
 * Estado interno do pdfkit que o desenho do timbrado suja e precisa devolver.
 *
 * O cabeçalho é desenhado no evento `pageAdded`, que também dispara quando o
 * pdfkit quebra a página NO MEIO de um `text()`. Nesse caminho o LineWrapper
 * continua medindo com `_font`/`_fontSize` e reaplica a cor com `_fillColor`
 * logo depois — se o timbrado deixar esses caches trocados, o resto do
 * parágrafo sai na fonte e na cor do cabeçalho.
 */
function withPreservedTextState(doc: Doc, draw: () => void): void {
    const anyDoc = doc as any;
    const fillColor = anyDoc._fillColor;
    const font = anyDoc._font;
    const fontSize = anyDoc._fontSize;
    const lineGap = anyDoc._lineGap;
    const x = doc.x;
    const y = doc.y;
    doc.save();
    try {
        draw();
    } finally {
        doc.restore();
        anyDoc._fillColor = fillColor;
        anyDoc._font = font;
        anyDoc._fontSize = fontSize;
        anyDoc._lineGap = lineGap;
        doc.x = x;
        doc.y = y;
    }
}

export type ImapTimbrado = {
    /** Fundo timbrado + fio verde + título — chamar a cada página nova. */
    drawHeader: () => void;
    /** Endereço + número da página — chamar no passe final, por página. */
    drawFooter: (pageNumber: number) => void;
    /** `false` quando o PNG não foi encontrado (o laudo ainda sai, sem fundo). */
    hasTimbrado: boolean;
};

/**
 * Prende o timbrado a um documento pdfkit. O PNG é aberto UMA vez
 * (`openImage`) e reusado em todas as páginas — senão o laudo carregaria uma
 * cópia de 84 KB por página.
 */
export function createImapTimbrado(
    doc: Doc,
    opts: { headerTitle: string; footerMeta?: string },
): ImapTimbrado {
    const png = loadTimbradoImapPng();
    let image: any = null;
    if (png) {
        try {
            image = (doc as any).openImage(png);
        } catch (err) {
            console.warn("[SIMCAR PDF] timbrado da IMAP não decodificou", err);
        }
    }

    const title = String(opts.headerTitle || "").toUpperCase();
    const footerMeta = String(opts.footerMeta || "").trim();

    const drawHeader = () => {
        withPreservedTextState(doc, () => {
            if (image) {
                // Sangria total: o PNG já é a folha A4 inteira (logo + marca d'água).
                doc.image(image, 0, 0, { width: IMAP_PAGE.width, height: IMAP_PAGE.height });
            }
            doc.moveTo(IMAP_HEADER.ruleX0, IMAP_HEADER.ruleY)
                .lineTo(IMAP_HEADER.ruleX1, IMAP_HEADER.ruleY)
                .strokeColor(IMAP_COLORS.green)
                .lineWidth(IMAP_HEADER.ruleWidth)
                .stroke();
            if (title) {
                doc.font("Helvetica-Bold")
                    .fontSize(IMAP_HEADER.titleSize)
                    .fillColor(IMAP_COLORS.headerTitle)
                    .text(title, IMAP_PAGE.marginLeft, IMAP_HEADER.titleY, {
                        width: IMAP_CONTENT_WIDTH,
                        align: "right",
                        characterSpacing: IMAP_HEADER.titleTracking,
                        lineBreak: false,
                    });
            }
        });
        doc.x = IMAP_PAGE.marginLeft;
        doc.y = IMAP_PAGE.marginTop;
    };

    const drawFooter = (pageNumber: number) => {
        // Escrever abaixo da margem inferior faria o pdfkit abrir uma página nova
        // a cada chamada — era isso que enchia o laudo antigo de folhas em branco.
        const previousBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        withPreservedTextState(doc, () => {
            doc.moveTo(IMAP_PAGE.marginLeft, IMAP_FOOTER.ruleY)
                .lineTo(IMAP_PAGE.width - IMAP_PAGE.marginRight, IMAP_FOOTER.ruleY)
                .strokeColor(IMAP_COLORS.green)
                .lineWidth(1)
                .stroke();

            const blockBottom = IMAP_FOOTER.addressY + IMAP_FOOTER.lineStep * IMAP_ADDRESS_LINES.length;
            const ink = doc
                .linearGradient(IMAP_PAGE.marginLeft, IMAP_FOOTER.addressY, IMAP_PAGE.marginLeft, blockBottom)
                .stop(0, IMAP_COLORS.inkFrom)
                .stop(1, IMAP_COLORS.inkTo);

            doc.font("Helvetica").fontSize(IMAP_FOOTER.addressSize).fillColor(ink as any);
            IMAP_ADDRESS_LINES.forEach((line, idx) => {
                doc.text(line, IMAP_PAGE.marginLeft, IMAP_FOOTER.addressY + IMAP_FOOTER.lineStep * idx, {
                    width: IMAP_FOOTER.addressWidth,
                    characterSpacing: 1,
                    lineBreak: false,
                });
            });

            if (footerMeta) {
                doc.font("Helvetica")
                    .fontSize(IMAP_FOOTER.metaSize)
                    .fillColor(IMAP_COLORS.footerMeta)
                    .text(footerMeta, IMAP_PAGE.marginLeft, IMAP_FOOTER.metaY, {
                        width: IMAP_FOOTER.addressWidth,
                        lineBreak: false,
                    });
            }

            // Gradiente novo: um PDFGradient pertence à página em que foi criado.
            const pageInk = doc
                .linearGradient(
                    IMAP_PAGE.width - IMAP_PAGE.marginRight,
                    IMAP_FOOTER.pageNumberY,
                    IMAP_PAGE.width - IMAP_PAGE.marginRight,
                    IMAP_FOOTER.pageNumberY + IMAP_FOOTER.pageNumberSize + 2,
                )
                .stop(0, IMAP_COLORS.inkFrom)
                .stop(1, IMAP_COLORS.inkTo);
            doc.font("Helvetica")
                .fontSize(IMAP_FOOTER.pageNumberSize)
                .fillColor(pageInk as any)
                .text(
                    String(pageNumber),
                    IMAP_PAGE.width - IMAP_PAGE.marginRight - IMAP_FOOTER.pageCellWidth,
                    IMAP_FOOTER.pageNumberY,
                    { width: IMAP_FOOTER.pageCellWidth, align: "center", lineBreak: false },
                );
        });
        doc.page.margins.bottom = previousBottom;
    };

    return { drawHeader, drawFooter, hasTimbrado: image !== null };
}
