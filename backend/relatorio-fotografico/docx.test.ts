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

  it("mantém duas paisagens por página e dá espaço para a legenda Arial 10 pt", async () => {
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
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0).toBe(2);
    expect(xml).toContain("Figura 3. Vista parcial do acesso.");
    expect(xml).toContain("Figura 4. Vista parcial da sede.");
    expect(xml).toContain('<w:sz w:val="20"/><w:color w:val="242424"/>');
    expect(xml).toContain('<w:spacing w:before="130" w:after="0" w:line="240" w:lineRule="exact"/>');
    // Paisagem 16:9 na largura de 15 cm = 5 400 000 EMU.
    expect(xml).toContain('cx="5400000"');
  });

  it("põe quatro fotos maiores em pé na mesma página, com separação entre legendas", async () => {
    const buffer = await buildRelatorioFotograficoDocx([
      {
        caption: "Caracterização da área após visita campo.",
        photos: [await foto(90, 120, "p1"), await foto(90, 120, "p2"), await foto(90, 120, "p3"), await foto(90, 120, "p4")],
      },
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0).toBe(0);
    expect(xml.match(/<w:tbl>/g)?.length).toBe(1);
    expect(xml.match(/<w:tr>/g)?.length).toBe(2);
    expect(xml).toContain("Figura 4. Caracterização da área após visita campo.");
    expect(xml).toContain('<w:tblInd w:w="-283" w:type="dxa"/>');
    expect(xml).toContain('<w:ind w:left="326" w:right="326" w:firstLine="0"/>');
    const alturas = [...xml.matchAll(/<wp:extent cx="\d+" cy="(\d+)"\/><wp:effectExtent l="0" t="0" r="0" b="0"\/><wp:docPr id="10\d" name="Fotografia/g)];
    expect(alturas).toHaveLength(4);
    expect(alturas.every((match) => Number(match[1]) > 9.5 * 360000)).toBe(true);
  });

  it("a quinta foto em pé vai para a página seguinte", async () => {
    const photos = await Promise.all([1, 2, 3, 4, 5].map((n) => foto(90, 150, `p${n}`)));
    const buffer = await buildRelatorioFotograficoDocx([{ caption: "Árvore vistoriada.", photos }]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length).toBe(1);
    expect(xml.match(/<w:tbl>/g)?.length).toBe(2);
    expect(xml.match(/<w:tr>/g)?.length).toBe(3);
    expect(xml).toContain("Figura 5. Árvore vistoriada.");
  });
});
