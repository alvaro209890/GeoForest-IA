import { describe, expect, it } from "vitest";
import { PAGINA_CM, IMAP_LAYOUT, planPhotoPages, textoFigura, type FotoMedida } from "./layout";

function foto(width: number, height: number): FotoMedida {
  return { width, height, orientation: height > width ? "portrait" : "landscape" };
}

describe("planPhotoPages (padrão IMAP 2026)", () => {
  it("põe duas fotos por página e numera direto entre as parciais", () => {
    const pages = planPhotoPages([
      { caption: "Acesso", photos: [foto(400, 300), foto(400, 300), foto(400, 300)] },
      { caption: "Sede", photos: [foto(400, 300)] },
    ]);
    expect(pages).toHaveLength(2);
    const numeros = pages.map((page) => page.blocks.flatMap((block) => block.items.map((item) => item.number)));
    expect(numeros).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(pages[1].blocks[1].items[0].caption).toBe("Sede");
  });

  it("centraliza uma fileira de dois retratos na área útil", () => {
    const [page] = planPhotoPages([{ caption: "Vegetação", photos: [foto(300, 400), foto(300, 400)] }]);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0].orientation).toBe("portrait");
    const [a, b] = page.blocks[0].items;
    expect((a.centerCm + b.centerCm) / 2).toBe(PAGINA_CM.w / 2);
    expect(b.centerCm - a.centerCm - a.columnCm).toBeGreaterThan(1);
    expect(page.blocks[0].topCm).toBeCloseTo((IMAP_LAYOUT.bottom + IMAP_LAYOUT.top - page.blocks[0].heightCm) / 2);
    for (const item of page.blocks[0].items) {
      expect(item.fit.w).toBeLessThanOrEqual(IMAP_LAYOUT.portraitW + 1e-9);
      expect(item.fit.w).toBeCloseTo(7.7, 5);
      expect(item.fit.h).toBeGreaterThan(10);
    }
  });

  it("põe quatro fotos em pé na mesma página, em duas fileiras", () => {
    const pages = planPhotoPages([
      {
        caption: "Caracterização da área após visita campo.",
        photos: [foto(300, 400), foto(300, 400), foto(300, 400), foto(300, 400)],
      },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toHaveLength(2);
    expect(pages[0].blocks[0].items.map((item) => item.number)).toEqual([1, 2]);
    expect(pages[0].blocks[1].items.map((item) => item.number)).toEqual([3, 4]);
    expect(pages[0].blocks[0].items.map((item) => item.centerCm)).toEqual([6.5, 14.5]);
    const ultima = pages[0].blocks[1];
    expect(ultima.items[0].fit.h).toBeGreaterThan(9.5);
    expect(ultima.topCm + ultima.heightCm).toBeLessThanOrEqual(IMAP_LAYOUT.bottom + 1e-9);
  });

  it("a quinta foto em pé abre outra página e três em pé fecham a fileira de baixo", () => {
    const cinco = planPhotoPages([{ caption: "Árvore", photos: Array.from({ length: 5 }, () => foto(300, 500)) }]);
    expect(cinco).toHaveLength(2);
    expect(cinco[0].blocks.flatMap((block) => block.items.map((item) => item.number))).toEqual([1, 2, 3, 4]);
    expect(cinco[1].blocks.flatMap((block) => block.items.map((item) => item.number))).toEqual([5]);
    expect(cinco[1].blocks[0].items[0].centerCm).toBe(PAGINA_CM.w / 2);

    expect(cinco[1].blocks[0].items[0].fit.h).toBeGreaterThan(16);

    const tres = planPhotoPages([{ caption: "Árvore", photos: [foto(300, 500), foto(300, 500), foto(300, 500)] }]);
    expect(tres).toHaveLength(1);
    expect(tres[0].blocks.map((block) => block.items.length)).toEqual([2, 1]);
    expect(tres[0].blocks[1].items[0].centerCm).toBe(PAGINA_CM.w / 2);
  });

  it("empilha par misto e paisagem cabe em 15 × 8,45 cm", () => {
    const [page] = planPhotoPages([{ caption: "Área", photos: [foto(300, 400), foto(1600, 900)] }]);
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks.map((block) => block.orientation)).toEqual(["portrait", "landscape"]);
    const paisagem = page.blocks[1].items[0];
    expect(paisagem.fit.w).toBeLessThanOrEqual(15 + 1e-9);
    expect(paisagem.fit.h).toBeLessThanOrEqual(8.45 + 1e-9);
    expect(page.blocks[1].topCm).toBeGreaterThan(page.blocks[0].topCm);
    const fundo = page.blocks[1].topCm + paisagem.fit.h;
    expect(fundo).toBeLessThan(IMAP_LAYOUT.bottom);
  });

  it("última foto ímpar fica sozinha na página", () => {
    const pages = planPhotoPages([{ caption: "X", photos: [foto(400, 300), foto(400, 300), foto(300, 400)] }]);
    expect(pages).toHaveLength(2);
    expect(pages[1].blocks[0].items).toHaveLength(1);
    expect(pages[1].blocks[0].items[0].number).toBe(3);
  });

  it("abre mais páginas para legendas longas sem perder fotos nem mudar a ordem", () => {
    const caption = "Vista parcial da área vistoriada. ".repeat(37).slice(0, 1200);
    const pages = planPhotoPages([{ caption, photos: Array.from({ length: 4 }, () => foto(300, 400)) }]);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(({ blocks }) => blocks.flatMap(({ items }) => items.map(({ number }) => number)))).toEqual([1, 2, 3, 4]);
    for (const page of pages) {
      const ultima = page.blocks.at(-1)!;
      expect(ultima.topCm + ultima.heightCm).toBeLessThanOrEqual(IMAP_LAYOUT.bottom + 1e-9);
      expect(ultima.items[0].caption).toBe(caption.trim());
    }
  });

  it("monta o texto da figura", () => {
    expect(textoFigura(3, " Vista parcial da sede. ")).toBe("Figura 3. Vista parcial da sede.");
  });
});
