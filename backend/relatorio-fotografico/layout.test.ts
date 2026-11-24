import { describe, expect, it } from "vitest";
import { planPhotoPages } from "./layout";
import type { FotoLayout } from "./types";

function foto(width: number, height: number): FotoLayout {
  return {
    width,
    height,
    orientation: height > width ? "portrait" : "landscape",
  };
}

describe("planPhotoPages", () => {
  it("coloca retratos em pares e paisagem sozinha", () => {
    const pages = planPhotoPages([
      {
        caption: "Acesso",
        photos: [foto(100, 40), foto(30, 60), foto(30, 70)],
      },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks.map((block) => block.items.length)).toEqual([1, 2]);
    expect(pages[0].blocks[0].orientation).toBe("landscape");
    expect(pages[0].blocks[1].orientation).toBe("portrait");
    expect(pages[0].blocks[1].items.map((item) => item.number)).toEqual([2, 3]);
  });

  it("abre outra página depois de duas linhas", () => {
    const pages = planPhotoPages([
      {
        caption: "Área",
        photos: [foto(20, 40), foto(20, 40), foto(20, 40), foto(20, 40), foto(20, 40)],
      },
    ]);
    expect(pages).toHaveLength(2);
    expect(pages[0].blocks).toHaveLength(2);
    expect(pages[1].blocks[0].items).toHaveLength(1);
    expect(pages[1].blocks[0].items[0].number).toBe(5);
  });
});
