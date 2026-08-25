/**
 * Testes do laudo NDVI. Idioma copiado de `backend/simcar/report-docx.test.ts`: lê o
 * `.docx` gerado com o `extractZipEntries` do próprio repositório (não jszip) e tira as
 * tags para conferir o texto. Sem rede, sem mock.
 */
import { describe, expect, it } from "vitest";
import { extractZipEntries } from "../geo-utils";
import { buildNdviReportDocxBuffer, NDVI_LIMITATION_LINES, pngImageSize } from "./report-ndvi-docx";
import type { NdviResult, NdviZonalStat } from "./types";

function docxEntry(buffer: Buffer, name: string): Buffer | undefined {
  return extractZipEntries(buffer).find((e) => e.name === name)?.data;
}

function docxText(buffer: Buffer): string {
  const xml = docxEntry(buffer, "word/document.xml")?.toString("utf8") || "";
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function fakePng(width = 800, height = 600): Buffer {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function stat(over: Partial<NdviZonalStat> = {}): NdviZonalStat {
  return {
    layer: "AVN",
    featureIndex: 0,
    areaHa: 123.45,
    min: 0.31,
    max: 0.88,
    mean: 0.72,
    stdDev: 0.08,
    validPixels: 900,
    totalPixels: 950,
    validPct: 0.947,
    classe: "arborea",
    classeLabel: "Vegetação arbórea",
    aviso: null,
    ...over,
  };
}

function resultado(over: Partial<NdviResult> = {}): NdviResult {
  return {
    clipJobId: "abc12345-0000",
    ndviJobId: "ndvi-1",
    generatedAt: "2026-08-25T12:00:00.000Z",
    scene: {
      itemId: "LT05_L2SP_224069_20080720_02_T1",
      collection: "landsat-c2-l2",
      platform: "LANDSAT_5",
      platformLabel: "Landsat 5 TM",
      path: "224",
      row: "069",
      acquiredAt: "2008-07-20",
      year: 2008,
      cloudCoverPct: 4,
      epsg: 32622,
      coberturaParcial: false,
      sensorDegradado: false,
    },
    propertyStat: stat({ layer: "IMOVEL", mean: 0.61, areaHa: 980.2 }),
    stats: [stat(), stat({ layer: "AREA_CONSOLIDADA", featureIndex: 0, mean: 0.28, classe: "rala", classeLabel: "Vegetação rala, pastagem degradada ou regeneração inicial" })],
    featuresOmitidas: 0,
    raster: null,
    failure: null,
    avisos: [],
    ...over,
  };
}

describe("laudo NDVI em .docx", () => {
  it("gera um OOXML válido", async () => {
    const buffer = await buildNdviReportDocxBuffer({ clipJobId: "abc12345", ndvi: resultado() });
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(docxEntry(buffer, "word/document.xml")).toBeTruthy();
    expect(docxEntry(buffer, "[Content_Types].xml")).toBeTruthy();
  });

  it("declara a origem do dado: plataforma, órbita/ponto, data e coleção", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).toContain("Landsat 5 TM");
    expect(texto).toContain("224/069");
    expect(texto).toContain("20/07/2008");
    expect(texto).toContain("landsat-c2-l2");
  });

  it("mostra a fórmula de conversão de escala — a armadilha do produto", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).toContain("0,0000275");
    expect(texto).toMatch(/QA_PIXEL/i);
  });

  it("⚠️ traz a seção de Limitações mesmo quando tudo deu certo", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).toContain("Limitações");
    expect(texto).toMatch(/pixel misto/i);
    expect(texto).toMatch(/satura em floresta densa/i);
    expect(texto).toMatch(/não conclui isoladamente/i);
    expect(NDVI_LIMITATION_LINES.length).toBeGreaterThanOrEqual(5);
  });

  it("a tabela traz média, validPct e classe por feição", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).toContain("0,72");
    expect(texto).toContain("94,7%");
    expect(texto).toContain("Vegetação arbórea");
    expect(texto).toContain("AVN");
    expect(texto).toContain("AREA_CONSOLIDADA");
  });

  it("uma linha por feição, mais a linha do imóvel — nunca a união", async () => {
    const r = resultado({
      stats: [stat({ featureIndex: 0 }), stat({ featureIndex: 1 }), stat({ featureIndex: 2 })],
    });
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: r }));
    expect(texto).toContain("IMÓVEL (total)");
    // três feições numeradas
    for (const n of ["1", "2", "3"]) expect(texto).toContain(n);
  });

  it("feição com nuvem demais é medida mas NÃO classificada", async () => {
    const r = resultado({
      stats: [stat({ validPct: 0.25, aviso: "nuvem_excessiva", classe: null, classeLabel: null })],
    });
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: r }));
    expect(texto).toContain("não classificado");
    expect(texto).toContain("25,0%");
    expect(texto).toMatch(/nuvem/i);
  });

  it("cobertura parcial e sensor degradado entram nas limitações", async () => {
    const r = resultado({
      scene: { ...resultado().scene, coberturaParcial: true, sensorDegradado: true, platformLabel: "Landsat 7 ETM+" },
    });
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: r }));
    expect(texto).toMatch(/não cobre o imóvel inteiro/i);
    expect(texto).toMatch(/SLC-off|31\/05\/2003/i);
  });

  it("sem medida nenhuma, o laudo diz isso em vez de inventar número", async () => {
    const r = resultado({ propertyStat: null, stats: [], failure: "nuvem_excessiva" });
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: r }));
    expect(texto).toMatch(/Sem medida disponível/i);
    expect(texto).toMatch(/nuvem/i);
  });

  it("embute figura em word/media e numera a legenda", async () => {
    const buffer = await buildNdviReportDocxBuffer({
      clipJobId: "abc",
      ndvi: resultado(),
      figures: [{ caption: "NDVI do imóvel — Landsat 5, 20/07/2008", buffer: fakePng(1200, 800) }],
    });
    const midias = extractZipEntries(buffer).filter((e) => e.name.startsWith("word/media/"));
    expect(midias.length).toBeGreaterThan(0);
    expect(docxText(buffer)).toContain("Figura 1 —");
  });

  it("legenda sem imagem válida não gera figura fantasma", async () => {
    const buffer = await buildNdviReportDocxBuffer({
      clipJobId: "abc",
      ndvi: resultado(),
      figures: [{ caption: "quebrada", buffer: Buffer.from("nao e imagem") }],
    });
    expect(docxText(buffer)).not.toContain("Figura 1 —");
  });

  it("traz as faixas de interpretação e a fundamentação legal", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).toMatch(/Faixas de interpretação/i);
    expect(texto).toMatch(/Solo exposto/i);
    expect(texto).toMatch(/22\/07\/2008|12\.651/);
  });

  it("usa o vocabulário da casa: 'uso consolidado', nunca 'área antropizada'", async () => {
    const texto = docxText(await buildNdviReportDocxBuffer({ clipJobId: "abc", ndvi: resultado() }));
    expect(texto).not.toMatch(/antropizada/i);
    expect(texto).toMatch(/uso consolidado/i);
  });

  it("identificação do imóvel entra na capa", async () => {
    const texto = docxText(
      await buildNdviReportDocxBuffer({
        clipJobId: "abc",
        ndvi: resultado(),
        identificacao: { carNumber: "MT-5103502-ABC", municipio: "Querência", uf: "MT", areaHa: 980.2 },
      }),
    );
    expect(texto).toContain("MT-5103502-ABC");
    expect(texto).toContain("Querência");
    expect(texto).toContain("980,20");
  });
});

describe("pngImageSize", () => {
  it("lê largura e altura do IHDR", () => {
    expect(pngImageSize(fakePng(1234, 567))).toEqual({ width: 1234, height: 567 });
  });
  it("recusa o que não é PNG", () => {
    expect(pngImageSize(Buffer.from("nao e png"))).toBeNull();
    expect(pngImageSize(Buffer.alloc(4))).toBeNull();
  });
});
