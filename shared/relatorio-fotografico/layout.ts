/** Paginação e medidas comuns à prévia e ao Word do relatório fotográfico. */

export type Orientacao = "portrait" | "landscape";

export type FotoMedida = {
  width: number;
  height: number;
  orientation: Orientacao;
};

export const PAGINA_CM = { w: 21, h: 29.7 } as const;
export const IMAP_LAYOUT = {
  top: 3.65,
  bottom: 26.25,
  tableW: 16,
  gap: 0.62,
  landW: 15,
  landH: 8.45,
  portraitW: 7.7,
  portraitH: 11,
  singlePortraitW: 13.5,
  singlePortraitH: 19,
  pairCaptionW: 6.85,
  singleCaptionW: 14.8,
  captionGap: 0.23,
  captionLinePt: 12,
  captionFontPt: 10,
} as const;

/** Início do fluxo no Word a partir do modelo e dos parágrafos de quebra. */
export const FLUXO_WORD_CM = { topoPrimeiraPagina: 3.54, topoAposQuebra: 3.12, margemEsquerda: 3 } as const;

export type Medida = { w: number; h: number };

export type ItemFigura<T extends FotoMedida> = {
  photo: T;
  number: number;
  caption: string;
  fit: Medida;
  centerCm: number;
  columnCm: number;
};

export type BlocoFigura<T extends FotoMedida> = {
  orientation: Orientacao;
  items: ItemFigura<T>[];
  topCm: number;
  heightCm: number;
};

export type PaginaFiguras<T extends FotoMedida> = { blocks: BlocoFigura<T>[] };
export type ParcialComFotos<T extends FotoMedida> = { caption: string; photos: T[] };

export function orientacaoDe(width: number, height: number): Orientacao {
  return height > width ? "portrait" : "landscape";
}

export function textoFigura(numero: number, legenda: string): string {
  return `Figura ${numero}. ${String(legenda || "").trim().replace(/\s+/g, " ")}`;
}

export function photoFit(photo: { width: number; height: number }, maxW: number, maxH: number): Medida {
  const w = Number(photo.width) || 1200;
  const h = Number(photo.height) || 800;
  const ratio = w / h;
  return { w: Math.min(maxW, maxH * ratio), h: Math.min(maxH, maxW / ratio) };
}

/** Reserva espaço para a quebra natural do Arial 10 pt, com folga para o Word. */
function alturaDaLegenda(texto: string, larguraCm: number): number {
  const limite = larguraCm * 0.94 / (IMAP_LAYOUT.captionFontPt * 2.54 / 72);
  let linhas = 1;
  let ocupacao = 0;
  for (const palavra of texto.split(" ")) {
    let largura = 0;
    for (const letra of palavra.normalize("NFD").replace(/\p{M}/gu, "")) {
      if (/[ilI.,:;'!|]/.test(letra)) largura += 0.29;
      else if (/[MW@%&mw]/.test(letra)) largura += 0.94;
      else if (/[A-Z]/.test(letra)) largura += 0.74;
      else largura += 0.57;
    }
    if (ocupacao && ocupacao + largura + 0.3 > limite) {
      linhas += 1;
      ocupacao = 0;
    }
    if (largura > limite) {
      const extras = Math.ceil(largura / limite) - 1;
      linhas += extras;
      largura -= extras * limite;
    }
    ocupacao += largura + (ocupacao ? 0.3 : 0);
  }
  return IMAP_LAYOUT.captionGap + linhas * (IMAP_LAYOUT.captionLinePt * 2.54 / 72) + 0.08;
}

type Entrada<T extends FotoMedida> = { photo: T; caption: string; number: number };

function planejarPagina<T extends FotoMedida>(entries: Entrada<T>[], retratos: boolean): PaginaFiguras<T> | null {
  const rows: Entrada<T>[][] = [];
  const porLinha = retratos ? 2 : 1;
  for (let i = 0; i < entries.length; i += porLinha) rows.push(entries.slice(i, i + porLinha));

  const legendas = rows.map((row) => {
    const largura = row.length === 2 ? IMAP_LAYOUT.pairCaptionW : IMAP_LAYOUT.singleCaptionW;
    return Math.max(...row.map((entry) => alturaDaLegenda(textoFigura(entry.number, entry.caption), largura)));
  });
  const top = retratos ? IMAP_LAYOUT.top : 4.05;
  const margemEntreFileiras = IMAP_LAYOUT.gap * (rows.length - 1);
  const disponivel = IMAP_LAYOUT.bottom - top - margemEntreFileiras - legendas.reduce((a, b) => a + b, 0);
  const maxAltura = disponivel / rows.length;
  if (entries.length > 1 && maxAltura < 5) return null;

  const centralizado = (PAGINA_CM.w - IMAP_LAYOUT.tableW) / 2;
  const blocks: BlocoFigura<T>[] = rows.map((row, j) => {
    const dupla = row.length === 2;
    const retratoSolo = retratos && entries.length === 1;
    const items = row.map((entry, k) => {
      const portrait = entry.photo.orientation === "portrait";
      const maxW = retratoSolo ? IMAP_LAYOUT.singlePortraitW : portrait ? IMAP_LAYOUT.portraitW : IMAP_LAYOUT.landW;
      const maxH = retratos
        ? (rows.length === 1 ? IMAP_LAYOUT.singlePortraitH : IMAP_LAYOUT.portraitH)
        : IMAP_LAYOUT.landH;
      return {
        ...entry,
        fit: photoFit(entry.photo, maxW, Math.min(maxH, maxAltura)),
        centerCm: dupla ? centralizado + IMAP_LAYOUT.tableW * (2 * k + 1) / 4 : PAGINA_CM.w / 2,
        columnCm: dupla ? IMAP_LAYOUT.pairCaptionW : IMAP_LAYOUT.singleCaptionW,
      };
    });
    const heightCm = Math.max(...items.map((item) => item.fit.h)) + legendas[j];
    return { orientation: row[0].photo.orientation, items, topCm: 0, heightCm };
  });

  const altura = blocks.reduce((soma, block) => soma + block.heightCm, margemEntreFileiras);
  let y = retratos ? top + (IMAP_LAYOUT.bottom - top - altura) / 2 : top;
  for (const block of blocks) {
    block.topCm = y;
    y += block.heightCm + IMAP_LAYOUT.gap;
  }
  return { blocks };
}

export function planPhotoPages<T extends FotoMedida>(parciais: ParcialComFotos<T>[]): PaginaFiguras<T>[] {
  const fotos = parciais.flatMap((parcial) =>
    (parcial.photos || []).map((photo) => ({ photo, caption: String(parcial.caption || "").trim().slice(0, 1200) })),
  ).map((entry, index) => ({ ...entry, number: index + 1 }));
  const pages: PaginaFiguras<T>[] = [];

  for (let i = 0; i < fotos.length;) {
    const orientation = fotos[i].photo.orientation;
    let seguidas = 1;
    while (seguidas < 4 && fotos[i + seguidas]?.photo.orientation === orientation) seguidas += 1;

    let retratos = orientation === "portrait" && (seguidas > 1 || i + 1 === fotos.length);
    let quantidade = retratos ? seguidas : orientation === "landscape" ? Math.min(2, seguidas) : 2;
    let page = planejarPagina(fotos.slice(i, i + quantidade), retratos);
    if (!page && quantidade > 2) {
      quantidade = 2;
      page = planejarPagina(fotos.slice(i, i + quantidade), retratos);
    }
    if (!page) {
      quantidade = 1;
      retratos = orientation === "portrait";
      page = planejarPagina(fotos.slice(i, i + 1), retratos)!;
    }
    pages.push(page);
    i += quantidade;
  }
  return pages;
}
