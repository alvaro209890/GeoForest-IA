/**
 * Papel timbrado da IMAP no laudo `.docx` (lib `docx`).
 *
 * Mesmo papel do PDF (`report-imap.ts`) e mesmo papel dos pareceres do sistema
 * de acompanhamento: o PNG é o mesmo arquivo e a geometria sai do `sectPr` do
 * Ofício. As constantes vêm todas de `report-imap.ts` — este módulo só traduz
 * aquela geometria para o vocabulário da lib `docx`.
 *
 * Diferença deliberada em relação ao acompanhamento: lá o timbrado entra por
 * cirurgia no zip (troca do `header1.xml` por XML verbatim do Ofício); aqui ele
 * é montado com a própria lib — imagem flutuante `behindDocument` no cabeçalho,
 * fio verde como borda de parágrafo e rodapé como tabela de 2 colunas. Sem 25 KB
 * de XML vendorizado para manter.
 */

import {
    AlignmentType,
    BorderStyle,
    Footer,
    Header,
    HorizontalPositionRelativeFrom,
    ImageRun,
    PageNumber,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalPositionRelativeFrom,
    WidthType,
    type ISectionOptions,
} from "docx";

import {
    IMAP_ADDRESS_LINES,
    IMAP_COLORS,
    IMAP_HEADER,
    IMAP_PAGE,
    loadTimbradoImapPng,
} from "./report-imap";

/** twips por ponto e EMU por ponto — o `sectPr` fala twips, a âncora fala EMU. */
const TWIP_PER_PT = 20;
const EMU_PER_PT = 12700;
/** A lib `docx` recebe tamanho de imagem em px e converte a 9525 EMU/px (96 dpi). */
const PX_PER_PT = 96 / 72;

const pt2twip = (pt: number) => Math.round(pt * TWIP_PER_PT);
const pt2emu = (pt: number) => Math.round(pt * EMU_PER_PT);
/** Borda em oitavos de ponto (`w:sz`). */
const pt2eighths = (pt: number) => Math.round(pt * 8);

/** Cor sem `#` — o OOXML não aceita o cerquilha. */
const hex = (color: string) => color.replace("#", "");

/** `properties.page` da seção, com as margens do Ofício. */
export function imapDocxPageProperties(): ISectionOptions["properties"] {
    return {
        page: {
            margin: {
                top: pt2twip(IMAP_PAGE.marginTop), // 2154
                bottom: pt2twip(IMAP_PAGE.marginBottom), // 1700
                left: pt2twip(IMAP_PAGE.marginLeft), // 1418
                right: pt2twip(IMAP_PAGE.marginRight), // 1418
                header: 283,
                footer: 0,
            },
        },
    };
}

/**
 * Cabeçalho: timbrado de página inteira atrás do texto + título com o tracking
 * do Ofício, sublinhado pelo fio verde. As 3 linhas vazias antes do título são
 * as mesmas do Ofício — é o que empurra o título para baixo da logo.
 */
export function imapDocxHeader(title: string): Header {
    const png = loadTimbradoImapPng();
    const timbradoRun = png
        ? new ImageRun({
              type: "png",
              data: png,
              transformation: {
                  width: Math.round(IMAP_PAGE.width * PX_PER_PT),
                  height: Math.round(IMAP_PAGE.height * PX_PER_PT),
              },
              floating: {
                  horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                  verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                  behindDocument: true,
                  allowOverlap: true,
              },
              altText: { name: "Papel timbrado IMAP", description: "Papel timbrado da IMAP Engenharia e Soluções", title: "Timbrado IMAP" },
          })
        : null;

    const vazia = (children: readonly (TextRun | ImageRun)[] = []) =>
        new Paragraph({ spacing: { line: 240, lineRule: "auto" }, children });

    return new Header({
        children: [
            // A imagem viaja na 1ª linha do cabeçalho; como é flutuante e
            // `behindDocument`, ela não ocupa altura nenhuma no fluxo.
            vazia(timbradoRun ? [timbradoRun] : []),
            vazia(),
            vazia(),
            new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { line: 240, lineRule: "auto" },
                // Recuo à esquerda = onde o fio verde começa no Ofício (80,5 pt
                // depois da margem), para o fio não passar por baixo da logo.
                indent: { left: pt2twip(IMAP_HEADER.ruleX0 - IMAP_PAGE.marginLeft) },
                border: {
                    bottom: {
                        style: BorderStyle.SINGLE,
                        size: pt2eighths(IMAP_HEADER.ruleWidth),
                        color: hex(IMAP_COLORS.green),
                        space: 4,
                    },
                },
                children: [
                    new TextRun({
                        text: String(title || "").toUpperCase(),
                        bold: true,
                        font: "Tahoma",
                        size: IMAP_HEADER.titleSize * 2, // meios-pontos
                        color: hex(IMAP_COLORS.headerTitle),
                        characterSpacing: pt2twip(IMAP_HEADER.titleTracking), // 100 = 5 pt
                    }),
                ],
            }),
        ],
    });
}

/**
 * Rodapé: tabela de 2 colunas com as larguras exatas do Ofício
 * (7511 + 1559 twips), borda superior verde, endereço à esquerda e número da
 * página à direita.
 */
export function imapDocxFooter(meta?: string): Footer {
    const semBorda = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
    const linhaEndereco = (texto: string) =>
        new Paragraph({
            spacing: { line: 276, lineRule: "auto" },
            children: [
                new TextRun({
                    text: texto,
                    font: "Tahoma",
                    size: 16, // 8 pt
                    color: hex(IMAP_COLORS.inkSolid),
                    characterSpacing: 20, // 1 pt, como o Ofício
                }),
            ],
        });

    const enderecoCells = IMAP_ADDRESS_LINES.map(linhaEndereco);
    if (meta) {
        enderecoCells.push(
            new Paragraph({
                spacing: { line: 240, lineRule: "auto" },
                children: [
                    new TextRun({
                        text: meta,
                        font: "Tahoma",
                        size: 13, // 6,5 pt
                        color: hex(IMAP_COLORS.footerMeta),
                    }),
                ],
            }),
        );
    }

    const LARGURA_ENDERECO = 7511; // twips, coluna 1 do Ofício
    const LARGURA_PAGINA = 1559; // twips, coluna 2 do Ofício

    return new Footer({
        children: [
            new Table({
                // Largura e colunas em DXA (twips): com `PERCENTAGE` o Word/
                // LibreOffice redistribui as colunas e o endereço quebra linha.
                width: { size: LARGURA_ENDERECO + LARGURA_PAGINA, type: WidthType.DXA },
                columnWidths: [LARGURA_ENDERECO, LARGURA_PAGINA],
                borders: {
                    top: {
                        style: BorderStyle.SINGLE,
                        size: pt2eighths(1),
                        color: hex(IMAP_COLORS.green),
                    },
                    bottom: semBorda,
                    left: semBorda,
                    right: semBorda,
                    insideHorizontal: semBorda,
                    insideVertical: semBorda,
                },
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({
                                width: { size: LARGURA_ENDERECO, type: WidthType.DXA },
                                verticalAlign: "center",
                                // Sem recuo de célula: os 108 twips padrão de cada
                                // lado eram o que faltava para o endereço caber.
                                margins: { top: 60, bottom: 60, left: 0, right: 0 },
                                children: enderecoCells,
                            }),
                            new TableCell({
                                width: { size: LARGURA_PAGINA, type: WidthType.DXA },
                                verticalAlign: "center",
                                margins: { top: 60, bottom: 60, left: 0, right: 0 },
                                children: [
                                    new Paragraph({
                                        alignment: AlignmentType.CENTER,
                                        children: [
                                            new TextRun({
                                                children: [PageNumber.CURRENT],
                                                font: "Tahoma",
                                                size: 24, // 12 pt
                                                color: hex(IMAP_COLORS.inkSolid),
                                                characterSpacing: 20,
                                            }),
                                        ],
                                    }),
                                ],
                            }),
                        ],
                    }),
                ],
            }),
        ],
    });
}

/** Só para teste/uso externo: a âncora da imagem em EMU, como o Ofício declara. */
export const IMAP_DOCX_DEBUG = {
    pageWidthEmu: pt2emu(IMAP_PAGE.width),
    pageHeightEmu: pt2emu(IMAP_PAGE.height),
};
