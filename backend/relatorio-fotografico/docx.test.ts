import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { buildRelatorioFotograficoDocx, relatorioFilename } from "./docx";
import type { FotoPronta } from "./types";

async function foto(width: number, height: number, id: string): Promise<FotoPronta> {
  const jpeg = await sharp({
    create: { width, height, channels: 3, background: "#1a4d2e" },
  })
    .jpeg()
    .toBuffer();
  return {
    id,
    nome: `${id}.jpg`,
    width,
    height,
    orientation: height > width ? "portrait" : "landscape",
    jpeg,
  };
}

describe("relatório fotográfico docx", () => {
  it("nomeia o arquivo a partir do empreendimento", () => {
    expect(relatorioFilename("Fazenda Paraíso")).toBe("Fazenda_Paraiso.docx");
  });

  it("injeta a foto na seção de páginas e mantém a capa", async () => {
    const buffer = await buildRelatorioFotograficoDocx([
      { caption: "Porteira & acesso <teste>.", photos: [await foto(40, 80, "f1")] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("word/media/report_photo_0001.jpg")).toBeTruthy();
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Figura 1. Porteira &amp; acesso &lt;teste&gt;.");
    expect(xml).toContain("Relatório");
    expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain('Id="rIdReportPhoto1"');
    expect(rels).toContain("media/report_photo_0001.jpg");
  });
});
