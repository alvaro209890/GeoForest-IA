/**
 * Paginação do relatório fotográfico no padrão IMAP 2026 (Painel_Gerencial_IMAP_v5,
 * bloco "Padronização IMAP 2026"). O mesmo cálculo desenha a prévia do painel e o
 * Word, então o que a pessoa vê na tela é o que sai no arquivo.
 *
 * Regras:
 * - duas fotografias por página (a última pode ficar sozinha);
 * - duas fotos em pé (retrato) ficam lado a lado;
 * - qualquer outro par fica um embaixo do outro;
 * - a numeração das figuras corre direto, de uma parcial para a outra;
 * - cada figura leva a legenda da sua parcial: "Figura N. <legenda>".
 *
 * Sem dependência de Node nem de DOM: roda no navegador e no backend.
 */

export type Orientacao = "portrait" | "landscape";

export type FotoMedida = {
  width: number;
  height: number;
  orientation: Orientacao;
};

/** Medidas da página A4 e da área das fotos, em centímetros. */
export const PAGINA_CM = { w: 21, h: 29.7 } as const;
export const IMAP_LAYOUT = {
  top: 4.55,
  bottom: 25.9,
  landW: 15,
  landH: 8.45,
  portraitW: 7.1,
  portraitH: 9.85,
  gap: 1.15,
} as const;

/** Centro horizontal (cm) de cada coluna na página. */
export const CENTRO_CM = { esquerda: 6.75, direita: 14.25, meio: 10.5 } as const;

export type Medida = { w: number; h: number };

export type ItemFigura<T extends FotoMedida> = {
  photo: T;
  number: number;
  caption: string;
  /** Tamanho da foto na página, em cm. */
  fit: Medida;
  /** Centro horizontal da foto na página, em cm. */
  centerCm: number;
  /** Largura máxima da coluna (cm), usada para quebrar a legenda. */
  columnCm: number;
};

export type BlocoFigura<T extends FotoMedida> = {
  orientation: Orientacao;
  items: ItemFigura<T>[];
  topCm: number;
  imgMaxH: number;
};

export type PaginaFiguras<T extends FotoMedida> = {
  blocks: BlocoFigura<T>[];
};

export type ParcialComFotos<T extends FotoMedida> = {
  caption: string;
  photos: T[];
};

export function orientacaoDe(width: number, height: number): Orientacao {
  return height > width ? "portrait" : "landscape";
}

export function textoFigura(numero: number, legenda: string): string {
  return `Figura ${numero}. ${String(legenda || "").trim()}`;
}

/** Cabe a foto em maxW × maxH (cm) sem distorcer. */
export function photoFit(photo: { width: number; height: number }, maxW: number, maxH: number): Medida {
  const w = Number(photo.width) || 1200;
  const h = Number(photo.height) || 800;
  const ratio = w / h;
  return { w: Math.min(maxW, maxH * ratio), h: Math.min(maxH, maxW / ratio) };
}

/** Linhas estimadas da legenda (Arial 10 pt): ~42 caracteres na coluna de retrato, ~87 na largura toda. */
export function linhasDaLegenda(texto: string, portrait: boolean): number {
  const porLinha = portrait ? 42 : 87;
  return String(texto || "")
    .split("\n")
    .reduce((soma, linha) => soma + Math.max(1, Math.ceil(linha.length / porLinha)), 0);
}

function alturaDaLegenda(texto: string, portrait: boolean): number {
  return Math.max(0.48, 0.41 * linhasDaLegenda(texto, portrait));
}

export function planPhotoPages<T extends FotoMedida>(parciais: ParcialComFotos<T>[]): PaginaFiguras<T>[] {
  const fotos = parciais.flatMap((parcial) =>
    (parcial.photos || []).map((photo) => ({ photo, caption: String(parcial.caption || "").trim() })),
  );
  const pages: PaginaFiguras<T>[] = [];

  for (let i = 0; i < fotos.length; i += 2) {
    const entries = fotos.slice(i, i + 2).map((entry, j) => ({ ...entry, number: i + j + 1 }));
    const twoPortraits = entries.length === 2 && entries.every((entry) => entry.photo.orientation === "portrait");

    if (twoPortraits) {
      const legendaH = Math.max(
        ...entries.map((entry) => alturaDaLegenda(textoFigura(entry.number, entry.caption), true)),
      );
      const disponivel = IMAP_LAYOUT.bottom - IMAP_LAYOUT.top - legendaH - 0.35;
      const imgMaxH = Math.min(IMAP_LAYOUT.portraitH, disponivel);
      pages.push({
        blocks: [
          {
            orientation: "portrait",
            topCm: IMAP_LAYOUT.top,
            imgMaxH,
            items: entries.map((entry, k) => ({
              photo: entry.photo,
              number: entry.number,
              caption: entry.caption,
              fit: photoFit(entry.photo, IMAP_LAYOUT.portraitW, imgMaxH),
              centerCm: k === 0 ? CENTRO_CM.esquerda : CENTRO_CM.direita,
              columnCm: IMAP_LAYOUT.portraitW,
            })),
          },
        ],
      });
      continue;
    }

    const legendas = entries.map((entry) =>
      alturaDaLegenda(textoFigura(entry.number, entry.caption), entry.photo.orientation === "portrait"),
    );
    const util =
      IMAP_LAYOUT.bottom - IMAP_LAYOUT.top - IMAP_LAYOUT.gap - legendas.reduce((a, b) => a + b, 0) - 0.4;
    const imgMaxH = Math.max(2.2, Math.min(IMAP_LAYOUT.landH, util / entries.length));
    let y: number = IMAP_LAYOUT.top;
    const blocks: BlocoFigura<T>[] = entries.map((entry, j) => {
      const portrait = entry.photo.orientation === "portrait";
      const maxW = portrait ? IMAP_LAYOUT.portraitW : IMAP_LAYOUT.landW;
      const fit = photoFit(entry.photo, maxW, imgMaxH);
      const block: BlocoFigura<T> = {
        orientation: portrait ? "portrait" : "landscape",
        topCm: y,
        imgMaxH,
        items: [
          {
            photo: entry.photo,
            number: entry.number,
            caption: entry.caption,
            fit,
            centerCm: CENTRO_CM.meio,
            columnCm: maxW,
          },
        ],
      };
      y += fit.h + legendas[j] + IMAP_LAYOUT.gap;
      return block;
    });
    pages.push({ blocks });
  }

  return pages;
}
