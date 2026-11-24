/**
 * Paginação do relatório fotográfico IMAP.
 * Retrato: duas fotos por linha. Paisagem: uma por linha. No máximo duas
 * linhas por página — o mesmo critério de `planPages()` do painel IMAP.
 */
import type { BlocoFotos, PaginaFotos, ParcialLayout } from "./types";

export function planPhotoPages(partials: ParcialLayout[]): PaginaFotos[] {
  const pages: PaginaFotos[] = [];
  let page: PaginaFotos & { rows: number; height: number } = { blocks: [], rows: 0, height: 0 };
  let figure = 0;

  const flush = () => {
    if (page.blocks.length) pages.push({ blocks: page.blocks });
    page = { blocks: [], rows: 0, height: 0 };
  };

  for (const partial of partials) {
    const photos = partial.photos || [];
    for (let i = 0; i < photos.length; ) {
      const first = photos[i];
      const portrait = first.orientation === "portrait";
      const group = [first];
      i += 1;
      if (portrait && i < photos.length && photos[i].orientation === "portrait") {
        group.push(photos[i]);
        i += 1;
      }
      const items = group.map((photo) => ({
        photo,
        number: ++figure,
        caption: partial.caption,
      }));
      const captionMaxLength = items.reduce(
        (acc, item) => Math.max(acc, `Figura ${item.number}. ${item.caption}`.length),
        0,
      );
      const charsPerLine = portrait ? 45 : 92;
      const captionLines = Math.max(1, Math.ceil(captionMaxLength / charsPerLine));
      const height = (portrait ? 492 : 446) + captionLines * 23 + 24;
      if (page.blocks.length && (page.rows >= 2 || page.height + height > 1260)) flush();
      const block: BlocoFotos = {
        orientation: portrait ? "portrait" : "landscape",
        items,
        height,
      };
      page.blocks.push(block);
      page.rows += 1;
      page.height += height;
    }
  }

  flush();
  return pages;
}
