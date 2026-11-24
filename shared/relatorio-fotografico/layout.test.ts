import { describe, expect, it } from "vitest";
import { IMAP_LAYOUT, planPhotoPages, textoFigura, type FotoMedida } from "./layout";

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

  it("coloca duas fotos em pé lado a lado", () => {
    const [page] = planPhotoPages([{ caption: "Vegetação", photos: [foto(300, 400), foto(300, 400)] }]);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0].orientation).toBe("portrait");
    expect(page.blocks[0].items.map((item) => item.centerCm)).toEqual([6.75, 14.25]);
    for (const item of page.blocks[0].items) {
      expect(item.fit.w).toBeLessThanOrEqual(IMAP_LAYOUT.portraitW + 1e-9);
      expect(item.fit.h).toBeLessThanOrEqual(IMAP_LAYOUT.portraitH + 1e-9);
    }
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

  it("monta o texto da figura", () => {
    expect(textoFigura(3, " Vista parcial da sede. ")).toBe("Figura 3. Vista parcial da sede.");
  });
});
