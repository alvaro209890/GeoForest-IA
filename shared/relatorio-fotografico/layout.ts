/**
 * Paginação do relatório fotográfico no padrão IMAP 2026. O mesmo cálculo desenha
 * a prévia do painel e o Word, então o que a pessoa vê na tela é o que sai no arquivo.
 *
 * Medida das fotos em pé tirada do relatório da MT-109 (Ponte): quatro retratos por
 * página, cada um em 6 × 10 cm, duas fileiras de duas. Paisagem continua duas por
 * página, uma embaixo da outra, até 15 × 8,45 cm.
 *
 * Regras:
 * - fotos em pé seguidas entram de quatro em quatro (2×2); sobra de 1, 2 ou 3 fica
 *   na última página dessa sequência, no mesmo tamanho;
 * - fotos deitadas seguidas entram de duas em duas, uma embaixo da outra;
 * - uma foto em pé isolada antes de uma deitada divide a página com ela, empilhada;
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
  /** Retrato do relatório da MT-109: 170 × 283 pt ≈ 6 × 10 cm. */
  portraitW: 6,
  portraitH: 10,
  gap: 1.15,
} as const;

/**
 * Fluxo real do Word. A margem superior do modelo é 3 cm; a prévia das fotos em
 * pé soma a mesma folga inicial e o mesmo vão entre fileiras, para a miniatura
 * coincidir com o arquivo.
 */
export const FLUXO_WORD_CM = {
  margemTopo: 3,
  folgaInicial: 0.38,
  entreBlocos: 0.98,
  /**
   * Onde a primeira foto em pé começa, medido no Word com este modelo:
   * a seção já abre com um parágrafo vazio (~3,60 cm a partir do topo da folha).
   * As duas fileiras vão na mesma tabela, sem espaço extra entre elas.
   */
  topoRetrato: 3.6,
  /** Vão em branco entre a legenda e a foto de baixo. Sem isso a legenda monta na fileira seguinte. */
  folgaEntreFileiras: 0.75,
  /** Linha verde do rodapé no papel timbrado da MT-109. A legenda fica acima dela. */
  limiteRodape: 26.6,
} as const;

/** Centro horizontal (cm) de cada coluna na página. Retrato: 7 e 15 cm, como na MT-109. */
export const CENTRO_CM = { esquerda: 7, direita: 15, meio: 10.5, conteudo: 11 } as const;

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

/** Linhas estimadas da legenda (Arial 10 pt): ~36 caracteres na coluna de retrato (6 cm), ~87 na largura toda. */
export function linhasDaLegenda(texto: string, portrait: boolean): number {
  const porLinha = portrait ? 36 : 87;
  return String(texto || "")
    .split("\n")
    .reduce((soma, linha) => soma + Math.max(1, Math.ceil(linha.length / porLinha)), 0);
}

function alturaDaLegenda(texto: string, portrait: boolean): number {
  return Math.max(0.48, 0.41 * linhasDaLegenda(texto, portrait));
}

type Entrada<T extends FotoMedida> = { photo: T; caption: string; number: number };

function centroDaColuna(naFileira: number, indice: number): number {
  if (naFileira === 1) return CENTRO_CM.conteudo;
  return indice === 0 ? CENTRO_CM.esquerda : CENTRO_CM.direita;
}

function retratoSeguidos<T extends FotoMedida>(fotos: Array<{ photo: T }>, inicio: number): number {
  let n = 0;
  while (inicio + n < fotos.length && fotos[inicio + n].photo.orientation === "portrait") n += 1;
  return n;
}

/** Grade 2×2. Cada fileira é um bloco na prévia; no Word as fileiras vão na mesma tabela. */
function paginaRetrato<T extends FotoMedida>(entries: Entrada<T>[]): PaginaFiguras<T> {
  const rows: Entrada<T>[][] = [];
  for (let i = 0; i < entries.length; i += 2) rows.push(entries.slice(i, i + 2));

  const legendas = rows.map((row) =>
    Math.max(...row.map((entry) => alturaDaLegenda(textoFigura(entry.number, entry.caption), true))),
  );
  const topo = FLUXO_WORD_CM.topoRetrato;
  const folgas = FLUXO_WORD_CM.folgaEntreFileiras * Math.max(0, rows.length - 1);
  const disponivel = FLUXO_WORD_CM.limiteRodape - topo - folgas - legendas.reduce((a, b) => a + b, 0);
  const imgMaxH = Math.min(IMAP_LAYOUT.portraitH, Math.max(2.2, disponivel / rows.length));

  let y = topo;
  const blocks: BlocoFigura<T>[] = rows.map((row, rowIndex) => {
    const items = row.map((entry, k) => ({
      photo: entry.photo,
      number: entry.number,
      caption: entry.caption,
      fit: photoFit(entry.photo, IMAP_LAYOUT.portraitW, imgMaxH),
      centerCm: centroDaColuna(row.length, k),
      columnCm: IMAP_LAYOUT.portraitW,
    }));
    const block: BlocoFigura<T> = { orientation: "portrait", topCm: y, imgMaxH, items };
    const folga = rowIndex < rows.length - 1 ? FLUXO_WORD_CM.folgaEntreFileiras : 0;
    y += Math.max(...items.map((item) => item.fit.h)) + legendas[rowIndex] + folga;
    return block;
  });
  return { blocks };
}

/** Paisagem, ou uma foto em pé isolada junto de uma deitada: uma embaixo da outra. */
function paginaEmpilhada<T extends FotoMedida>(entries: Entrada<T>[]): PaginaFiguras<T> {
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
  return { blocks };
}

export function planPhotoPages<T extends FotoMedida>(parciais: ParcialComFotos<T>[]): PaginaFiguras<T>[] {
  const fotos = parciais.flatMap((parcial) =>
    (parcial.photos || []).map((photo) => ({ photo, caption: String(parcial.caption || "").trim() })),
  );
  const pages: PaginaFiguras<T>[] = [];
  let i = 0;
  let numero = 1;

  while (i < fotos.length) {
    const emPe = retratoSeguidos(fotos, i);
    const gradeEmPe = emPe >= 2 || (emPe === 1 && i + emPe >= fotos.length);
    let quantidade = Math.min(2, fotos.length - i);
    if (gradeEmPe) quantidade = Math.min(4, emPe);
    else if (fotos[i].photo.orientation === "landscape") quantidade = Math.min(2, contarDeitadas(fotos, i));

    const entries = fotos.slice(i, i + quantidade).map((entry, j) => ({ ...entry, number: numero + j }));
    pages.push(gradeEmPe ? paginaRetrato(entries) : paginaEmpilhada(entries));
    numero += quantidade;
    i += quantidade;
  }

  return pages;
}

function contarDeitadas<T extends FotoMedida>(fotos: Array<{ photo: T }>, inicio: number): number {
  let n = 0;
  while (inicio + n < fotos.length && fotos[inicio + n].photo.orientation === "landscape") n += 1;
  return n;
}
