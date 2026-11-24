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

  it("segue o padrão IMAP 2026: duas fotos por página e legenda Arial 10 pt sem espaçamento", async () => {
    const buffer = await buildRelatorioFotograficoDocx([
      {
        caption: "Vista parcial do acesso.",
        photos: [await foto(160, 90, "a1"), await foto(160, 90, "a2"), await foto(160, 90, "a3")],
      },
      { caption: "Vista parcial da sede.", photos: [await foto(90, 160, "s1")] },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    // 3 paisagens + 1 retrato no fim: a retrato abre página própria.
    expect(xml.match(/<w:br w:type="page"\/>/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(xml).toContain("Figura 3. Vista parcial do acesso.");
    expect(xml).toContain("Figura 4. Vista parcial da sede.");
    expect(xml).toContain('<w:sz w:val="20"/><w:color w:val="242424"/>');
    expect(xml).toContain('<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:keepTogether/>');
    // Paisagem 16:9 na largura de 15 cm = 5 400 000 EMU.
    expect(xml).toContain('cx="5400000"');
  });

  it("põe quatro fotos em pé na mesma página, com 6 cm de largura", async () => {
    const buffer = await buildRelatorioFotograficoDocx([
      {
        caption: "Caracterização da área após visita campo.",
        photos: [await foto(90, 150, "p1"), await foto(90, 150, "p2"), await foto(90, 150, "p3"), await foto(90, 150, "p4")],
      },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/<w:br w:type="page"\/>/g)?.length ?? 0).toBe(0);
    expect(xml.match(/<w:tbl>/g)?.length).toBe(1);
    expect(xml.match(/<w:tr>/g)?.length).toBe(2);
    expect(xml).toContain("Figura 4. Caracterização da área após visita campo.");
    // 6 cm × 10 cm, proporção 3:5 do JPEG de teste.
    expect(xml).toContain('cx="2160000"');
    expect(xml).toContain('cy="3600000"');
  });

  it("a quinta foto em pé vai para a página seguinte", async () => {
    const photos = await Promise.all([1, 2, 3, 4, 5].map((n) => foto(90, 150, `p${n}`)));
    const buffer = await buildRelatorioFotograficoDocx([{ caption: "Árvore vistoriada.", photos }]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/<w:br w:type="page"\/>/g)?.length).toBe(1);
    expect(xml.match(/<w:tbl>/g)?.length).toBe(2);
    expect(xml.match(/<w:tr>/g)?.length).toBe(3);
    expect(xml).toContain("Figura 5. Árvore vistoriada.");
  });
});
