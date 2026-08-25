/**
 * Laudo NDVI em Word (.docx).
 *
 * **Módulo próprio**, separado do laudo SIMCAR: o pedido é de laudo com identidade e
 * conteúdo próprios, e `backend/simcar/report-docx.ts` estava sendo editado em paralelo
 * por outro agente quando isto foi escrito.
 *
 * Reusa do laudo SIMCAR só o que é infraestrutura compartilhada: papel timbrado da IMAP
 * (`report-imap.ts`), paleta e fundamentação legal (`report-theme.ts`).
 *
 * ⚠️ A área útil é a do Ofício da IMAP: **453 pt (9070 twips)**, não 511. A tabela de
 * estatísticas tem 9 colunas e é o que mais aperta esse limite.
 *
 * ⚠️ A seção de Limitações é **obrigatória, inclusive quando tudo dá certo**. NDVI mede
 * vigor num instante; não classifica uso do solo, não data supressão e não conclui
 * sozinho sobre AC, AVN ou AUAS. Suprimi-la faria o laudo afirmar mais do que o dado
 * sustenta.
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
import { IMAP_ADDRESS_LINES, loadTimbradoImapPng } from "../simcar/report-imap";
import { LEGAL_BASIS_LINES, PALETTE, TONES, type Tone } from "../simcar/report-theme";
import { NDVI_CLASS_BANDS, formatNdvi } from "./ndvi-math";
import { NDVI_FAILURE_MESSAGES, type NdviResult, type NdviZonalStat } from "./types";

export const NDVI_REPORT_DOCX_VERSION = "ndvi-report-docx-v1";
export const NDVI_REPORT_HEADER_TITLE = "LAUDO TÉCNICO — ÍNDICE DE VEGETAÇÃO (NDVI)";

const PT = 20; // twips por ponto
const DOCX_MARGINS = {
  top: 2154,
  bottom: 1700,
  left: 1418,
  right: 1418,
  header: 15 * PT,
  footer: 15 * PT,
};
/** 11906 (A4 em twips) − margens = 9070 twips = 453,5 pt. O limite do Ofício. */
const CONTENT_WIDTH = 11906 - DOCX_MARGINS.left - DOCX_MARGINS.right;

function hex(color: string): string {
  return String(color || "").replace("#", "").toUpperCase();
}

function toneShading(tone: Tone) {
  return { type: ShadingType.CLEAR, color: "auto", fill: hex(TONES[tone].bg) };
}

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: hex(PALETTE.border) },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: hex(PALETTE.border) },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: hex(PALETTE.border) },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function texto(
  value: string,
  opts: { size?: number; bold?: boolean; color?: string; italics?: boolean } = {},
): TextRun {
  return new TextRun({
    text: value,
    font: "Calibri",
    size: (opts.size ?? 10) * 2, // docx conta meio-pontos
    bold: opts.bold,
    italics: opts.italics,
    color: hex(opts.color ?? PALETTE.text),
  });
}

function paragrafo(
  value: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: string;
    italics?: boolean;
    align?: Align;
    spacing?: { before?: number; after?: number };
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: opts.spacing ?? { after: 80 },
    children: [texto(value, opts)],
  });
}

function titulo(value: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [texto(value, { size: 12, bold: true, color: PALETTE.primary })],
  });
}

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

function headerCell(value: string, width: number, align: Align = AlignmentType.LEFT): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.dark) },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 0 },
        children: [texto(value, { size: 8, bold: true, color: "#FFFFFF" })],
      }),
    ],
  });
}

function bodyCell(
  value: string,
  width: number,
  opts: {
    align?: Align;
    bold?: boolean;
    color?: string;
    tone?: Tone;
  } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.tone ? toneShading(opts.tone) : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: opts.align,
        spacing: { after: 0 },
        children: [texto(value, { size: 8.5, bold: opts.bold, color: opts.color })],
      }),
    ],
  });
}

/** Quadro destacado, equivalente ao `calloutBox` do laudo SIMCAR. */
function quadro(titleText: string, linhas: string[], tone: Tone): Table {
  const cores = TONES[tone];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: hex(cores.border) },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: hex(cores.border) },
      left: { style: BorderStyle.SINGLE, size: 18, color: hex(cores.fg) },
      right: { style: BorderStyle.SINGLE, size: 1, color: hex(cores.border) },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: toneShading(tone),
            margins: { top: 120, bottom: 120, left: 160, right: 140 },
            children: [
              new Paragraph({
                spacing: { after: linhas.length ? 60 : 0 },
                children: [texto(titleText, { size: 9.5, bold: true, color: cores.fg })],
              }),
              ...linhas.map(
                (linha) =>
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [texto(linha, { size: 9 })],
                  }),
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Dimensões de um PNG a partir do IHDR (bytes 16–23). */
export function pngImageSize(buffer: Buffer): { width: number; height: number } | null {
  if (!buffer || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function imageRunType(buffer: Buffer): "png" | "jpg" | null {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpg";
  return null;
}

function pctBr(fracao: number): string {
  return `${(fracao * 100).toFixed(1).replace(".", ",")}%`;
}

function haBr(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataBr(iso: string): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "—");
}

// --- Seções ---------------------------------------------------------------

function secaoOrigem(r: NdviResult): Table {
  const s = r.scene;
  const linhas = [
    `Fonte: Landsat Collection 2 Nível 2 — Reflectância de Superfície (${s.collection})`,
    `Plataforma: ${s.platformLabel}`,
    `Órbita/ponto: ${s.path}/${s.row}`,
    `Data da passagem: ${dataBr(s.acquiredAt)}`,
    `Cobertura de nuvem da cena: ${s.cloudCoverPct === null ? "não informada" : `${s.cloudCoverPct}%`}`,
    "Resolução espacial: 30 m",
    "Processamento: recorte pelo perímetro do imóvel; conversão DN → reflectância " +
      "(ρ = DN × 0,0000275 − 0,2); máscara de nuvem, sombra e preenchimento pelo QA_PIXEL.",
  ];
  return quadro("Origem do dado", linhas, "info");
}

function secaoMetodologia(): Paragraph[] {
  return [
    titulo("2. Metodologia"),
    paragrafo(
      "O Índice de Vegetação por Diferença Normalizada (NDVI) é calculado pixel a pixel pela " +
        "razão NDVI = (NIR − VERMELHO) / (NIR + VERMELHO), sobre reflectância de superfície.",
    ),
    paragrafo(
      "Os valores digitais do produto Landsat Collection 2 Nível 2 são convertidos em " +
        "reflectância antes da razão (ρ = DN × 0,0000275 − 0,2). A conversão é obrigatória: o " +
        "deslocamento aditivo do produto não se cancela na razão, e ignorá-lo produziria um " +
        "índice sistematicamente distorcido.",
    ),
    paragrafo(
      "Pixels de preenchimento, nuvem, nuvem dilatada, sombra de nuvem, cirrus e neve são " +
        "excluídos do cálculo pelo bitmask QA_PIXEL da própria cena. Pixels de água são " +
        "preservados, por serem informação (NDVI negativo). O percentual de pixels válidos é " +
        "informado por polígono.",
    ),
    paragrafo(
      "O resultado é reprodutível: mesma cena, mesma expressão e mesma máscara devolvem " +
        "sempre os mesmos valores.",
    ),
  ];
}

function tabelaEstatisticas(r: NdviResult): Table {
  const larguras = [
    Math.round(CONTENT_WIDTH * 0.17),
    Math.round(CONTENT_WIDTH * 0.07),
    Math.round(CONTENT_WIDTH * 0.11),
    Math.round(CONTENT_WIDTH * 0.09),
    Math.round(CONTENT_WIDTH * 0.11),
    Math.round(CONTENT_WIDTH * 0.09),
    Math.round(CONTENT_WIDTH * 0.09),
    Math.round(CONTENT_WIDTH * 0.1),
  ];
  const ultima = CONTENT_WIDTH - larguras.reduce((a, b) => a + b, 0); // a última leva o resto

  const cabecalho = new TableRow({
    children: [
      headerCell("Camada", larguras[0]),
      headerCell("Feição", larguras[1], AlignmentType.CENTER),
      headerCell("Área (ha)", larguras[2], AlignmentType.RIGHT),
      headerCell("Mín.", larguras[3], AlignmentType.RIGHT),
      headerCell("Média", larguras[4], AlignmentType.RIGHT),
      headerCell("Máx.", larguras[5], AlignmentType.RIGHT),
      headerCell("Desvio", larguras[6], AlignmentType.RIGHT),
      headerCell("Válidos", larguras[7], AlignmentType.RIGHT),
      headerCell("Classe", ultima),
    ],
  });

  const linha = (stat: NdviZonalStat, rotulo: string, destaque = false): TableRow => {
    const banda = NDVI_CLASS_BANDS.find((b) => b.id === stat.classe) || null;
    const tone: Tone | undefined = stat.aviso ? "warn" : undefined;
    return new TableRow({
      children: [
        bodyCell(rotulo, larguras[0], { bold: destaque, tone }),
        bodyCell(destaque ? "—" : String(stat.featureIndex + 1), larguras[1], {
          align: AlignmentType.CENTER,
          tone,
        }),
        bodyCell(haBr(stat.areaHa), larguras[2], { align: AlignmentType.RIGHT, tone }),
        bodyCell(formatNdvi(stat.min), larguras[3], { align: AlignmentType.RIGHT, tone }),
        bodyCell(formatNdvi(stat.mean), larguras[4], {
          align: AlignmentType.RIGHT,
          bold: true,
          tone,
        }),
        bodyCell(formatNdvi(stat.max), larguras[5], { align: AlignmentType.RIGHT, tone }),
        bodyCell(formatNdvi(stat.stdDev), larguras[6], { align: AlignmentType.RIGHT, tone }),
        bodyCell(pctBr(stat.validPct), larguras[7], { align: AlignmentType.RIGHT, tone }),
        bodyCell(
          stat.aviso
            ? "não classificado"
            : stat.classeLabel || "—",
          ultima,
          { tone: stat.aviso ? "warn" : banda?.tone },
        ),
      ],
    });
  };

  const linhas: TableRow[] = [cabecalho];
  if (r.propertyStat) linhas.push(linha(r.propertyStat, "IMÓVEL (total)", true));
  for (const stat of r.stats) linhas.push(linha(stat, stat.layer));

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    borders: TABLE_BORDERS,
    rows: linhas,
  });
}

function tabelaFaixas(): Table {
  const wFaixa = Math.round(CONTENT_WIDTH * 0.22);
  const wResto = CONTENT_WIDTH - wFaixa;
  const linhas: TableRow[] = [
    new TableRow({
      children: [headerCell("Faixa de NDVI", wFaixa), headerCell("Interpretação", wResto)],
    }),
  ];
  for (const banda of NDVI_CLASS_BANDS) {
    const limiteSup = banda.max > 1 ? 1 : banda.max;
    const rotulo =
      banda.id === "agua"
        ? "menor que 0,00"
        : `${formatNdvi(banda.min)} a ${formatNdvi(limiteSup)}`;
    linhas.push(
      new TableRow({
        children: [
          bodyCell(rotulo, wFaixa, { tone: banda.tone as Tone }),
          bodyCell(banda.label, wResto),
        ],
      }),
    );
  }
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, borders: TABLE_BORDERS, rows: linhas });
}

/**
 * Limitações — obrigatória. R9 e R10 da reunião de 31/07/2026 virando peça escrita.
 * Exportada para o teste conseguir afirmar que ela está sempre presente.
 */
export const NDVI_LIMITATION_LINES: readonly string[] = [
  "O NDVI é um indicador de vigor da cobertura vegetal. Não é classificação de uso do solo, " +
    "nem datação de supressão.",
  "A resolução de 30 m do Landsat produz pixel misto: num mesmo pixel podem coexistir solo " +
    "exposto, vegetação em regeneração e vegetação nativa, e o índice devolve a média deles. " +
    "Em bordas e fragmentos estreitos o valor tende ao meio da escala e não descreve nenhum " +
    "dos componentes.",
  "O NDVI satura em floresta densa: acima de aproximadamente 0,80 ele deixa de discriminar " +
    "diferenças reais de biomassa.",
  "Os valores dependem da fenologia (estação e chuva recente) e da plataforma. Comparações " +
    "entre anos com sensores diferentes exigem cautela.",
  "Este laudo é o primeiro elemento de uma cadeia de evidências. Ele não conclui isoladamente " +
    "sobre área de uso consolidado, vegetação nativa ou supressão posterior a 22/07/2008.",
];

function secaoLimitacoes(r: NdviResult): Table {
  const linhas = [...NDVI_LIMITATION_LINES];
  if (r.failure) linhas.push(`Ocorrência registrada nesta análise: ${NDVI_FAILURE_MESSAGES[r.failure]}`);
  if (r.scene?.coberturaParcial) linhas.push(NDVI_FAILURE_MESSAGES.cobertura_parcial);
  if (r.scene?.sensorDegradado) linhas.push(NDVI_FAILURE_MESSAGES.sensor_degradado);
  const comAviso = r.stats.filter((s) => s.aviso);
  if (comAviso.length > 0) {
    linhas.push(
      `${comAviso.length} feição(ões) não receberam classificação por cobertura de nuvem ou ` +
        "área insuficiente; os valores medidos continuam na tabela, marcados.",
    );
  }
  if (r.featuresOmitidas > 0) {
    linhas.push(
      `${r.featuresOmitidas} feição(ões) de menor área ficaram fora da medição por limite ` +
        "operacional do processamento.",
    );
  }
  return quadro("Limitações e alcance deste laudo", linhas, "warn");
}

// --- Documento ------------------------------------------------------------

export type NdviReportFigure = { caption: string; buffer: Buffer };

export async function buildNdviReportDocxBuffer(args: {
  clipJobId: string;
  ndvi: NdviResult;
  identificacao?: {
    carNumber?: string | null;
    municipio?: string | null;
    uf?: string | null;
    areaHa?: number | null;
  };
  figures?: NdviReportFigure[];
}): Promise<Buffer> {
  const r = args.ndvi;
  const corpo: Array<Paragraph | Table> = [];

  // 1. Capa
  corpo.push(
    new Paragraph({
      spacing: { after: 160 },
      children: [texto("LAUDO TÉCNICO", { size: 18, bold: true, color: PALETTE.dark })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [texto("Índice de Vegetação por Diferença Normalizada (NDVI)", { size: 13, color: PALETTE.primary })],
    }),
  );

  const id = args.identificacao || {};
  const wRot = Math.round(CONTENT_WIDTH * 0.28);
  const wVal = CONTENT_WIDTH - wRot;
  const identLinhas: Array<[string, string]> = [
    ["Imóvel (CAR)", id.carNumber || "não informado"],
    ["Município/UF", [id.municipio, id.uf].filter(Boolean).join(" / ") || "não informado"],
    ["Área do imóvel", id.areaHa ? `${haBr(id.areaHa)} ha` : "não informada"],
    ["Data de emissão", dataBr(new Date().toISOString())],
    ["Recorte de origem", args.clipJobId],
    ["Versão do laudo", NDVI_REPORT_DOCX_VERSION],
  ];
  corpo.push(
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      borders: TABLE_BORDERS,
      rows: identLinhas.map(
        ([rot, val]) =>
          new TableRow({
            children: [bodyCell(rot, wRot, { bold: true }), bodyCell(val, wVal)],
          }),
      ),
    }),
  );

  // 2. Origem do dado
  corpo.push(titulo("1. Origem do dado"), secaoOrigem(r));

  // 3. Metodologia
  corpo.push(...secaoMetodologia());

  // 4. Figuras
  const figuras = (args.figures || []).filter((f) => f.buffer && imageRunType(f.buffer));
  if (figuras.length > 0) {
    corpo.push(titulo("3. Mapa do índice"));
    figuras.forEach((figura, indice) => {
      const dims = pngImageSize(figura.buffer);
      const proporcao = dims && dims.height > 0 ? dims.width / dims.height : 4 / 3;
      const maxW = 600;
      const maxH = 560;
      let w = maxW;
      let h = Math.round(maxW / proporcao);
      if (h > maxH) {
        h = maxH;
        w = Math.round(maxH * proporcao);
      }
      corpo.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          keepNext: true,
          spacing: { before: 120, after: 60 },
          children: [
            new ImageRun({
              type: imageRunType(figura.buffer) as "png" | "jpg",
              data: figura.buffer,
              transformation: { width: w, height: h },
            }),
          ],
        }),
        paragrafo(`Figura ${indice + 1} — ${figura.caption}`, {
          size: 8.5,
          italics: true,
          color: PALETTE.lightText,
          align: AlignmentType.CENTER,
          spacing: { after: 160 },
        }),
      );
    });
  }

  // 5. Estatísticas por polígono
  corpo.push(titulo("4. Estatísticas por polígono"));
  if (r.stats.length === 0 && !r.propertyStat) {
    corpo.push(
      quadro(
        "Sem medida disponível",
        [r.failure ? NDVI_FAILURE_MESSAGES[r.failure] : "Nenhuma feição pôde ser medida nesta cena."],
        "danger",
      ),
    );
  } else {
    corpo.push(
      paragrafo(
        "Cada feição é medida individualmente. A coluna “Válidos” informa a fração de pixels " +
          "não afetados por nuvem, sombra ou ausência de dado — uma média com poucos pixels " +
          "válidos não sustenta conclusão.",
        { size: 9, color: PALETTE.lightText },
      ),
      tabelaEstatisticas(r),
    );
  }

  // 6. Faixas
  corpo.push(titulo("5. Faixas de interpretação"), tabelaFaixas());

  // 7. Limitações — SEMPRE
  corpo.push(titulo("6. Limitações e alcance"), secaoLimitacoes(r));

  // 8. Fundamentação legal
  corpo.push(titulo("7. Fundamentação"));
  for (const linha of LEGAL_BASIS_LINES) corpo.push(paragrafo(linha, { size: 9 }));

  // --- Cabeçalho e rodapé no timbrado oficial ---
  const timbrado = loadTimbradoImapPng();
  const headerChildren: Paragraph[] = [];
  if (timbrado) {
    headerChildren.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new ImageRun({
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
      spacing: { after: 0 },
      children: [texto(NDVI_REPORT_HEADER_TITLE, { size: 8, bold: true, color: PALETTE.darkText })],
    }),
  );

  const footerChildren: Paragraph[] = [
    ...IMAP_ADDRESS_LINES.map(
      (linha) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
          children: [texto(linha, { size: 7, color: PALETTE.lightText })],
        }),
    ),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 40, after: 0 },
      children: [
        texto(`GeoForest IA · ${NDVI_REPORT_DOCX_VERSION} · Job ${args.clipJobId} · pág. `, {
          size: 6.5,
          color: PALETTE.lightText,
        }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 13, color: hex(PALETTE.lightText) }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: DOCX_MARGINS } },
        headers: { default: new Header({ children: headerChildren }) },
        footers: { default: new Footer({ children: footerChildren }) },
        children: corpo,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
