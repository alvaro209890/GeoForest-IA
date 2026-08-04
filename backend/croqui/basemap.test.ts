import { describe, expect, it } from "vitest";
import {
  bboxOfPositions,
  buildEsriExportUrl,
  buildGoogleStaticUrl,
  latToWorldY,
  lonToWorldX,
  pickScaleBar,
  resolveMapFrame,
  worldXToLon,
  worldYToLat,
} from "./basemap";

const MAP_W = 826;
const MAP_H = 579;

describe("croqui basemap", () => {
  it("projeta ida e volta em Web Mercator", () => {
    const worldSize = 256 * 2 ** 12;
    for (const [lon, lat] of [
      [-52.2196222, -12.5900389],
      [-51.6306, -13.0894],
      [0, 0],
    ]) {
      expect(worldXToLon(lonToWorldX(lon, worldSize), worldSize)).toBeCloseTo(lon, 9);
      expect(worldYToLat(latToWorldY(lat, worldSize), worldSize)).toBeCloseTo(lat, 9);
    }
  });

  it("enquadra todo o conteúdo dentro da área de mapa", () => {
    const contentBbox: [number, number, number, number] = [-51.83, -13.19, -51.58, -12.93];
    const frame = resolveMapFrame({ contentBbox, widthPt: MAP_W, heightPt: MAP_H });
    for (const [lon, lat] of [
      [contentBbox[0], contentBbox[1]],
      [contentBbox[2], contentBbox[3]],
      [contentBbox[0], contentBbox[3]],
      [contentBbox[2], contentBbox[1]],
    ]) {
      const [x, y] = frame.project(lon, lat);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(MAP_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(MAP_H);
    }
  });

  it("centraliza o conteúdo e mantém o zoom dentro da faixa válida", () => {
    const frame = resolveMapFrame({
      contentBbox: [-51.83, -13.19, -51.58, -12.93],
      widthPt: MAP_W,
      heightPt: MAP_H,
    });
    const [cx, cy] = frame.project(frame.centerLon, frame.centerLat);
    expect(cx).toBeCloseTo(MAP_W / 2, 6);
    expect(cy).toBeCloseTo(MAP_H / 2, 6);
    expect(frame.zoom).toBeGreaterThanOrEqual(3);
    expect(frame.zoom).toBeLessThanOrEqual(19);
    expect(Number.isInteger(frame.zoom)).toBe(true);
  });

  it("devolve uma bbox com o mesmo aspect da área de mapa", () => {
    // É o que impede o provedor de reenquadrar por conta própria e desalinhar
    // a imagem dos vetores.
    const frame = resolveMapFrame({
      contentBbox: [-52.3, -12.7, -52.1, -12.5],
      widthPt: MAP_W,
      heightPt: MAP_H,
    });
    const [west, south, east, north] = frame.bboxLonLat;
    const worldSize = 256 * 2 ** frame.zoom;
    const spanX = lonToWorldX(east, worldSize) - lonToWorldX(west, worldSize);
    const spanY = latToWorldY(south, worldSize) - latToWorldY(north, worldSize);
    expect(spanX / spanY).toBeCloseTo(frame.imageWidthPx / frame.imageHeightPx, 6);
    expect(spanX).toBeCloseTo(frame.imageWidthPx, 6);
  });

  it("mantém a escala coerente com o zoom", () => {
    const frame = resolveMapFrame({
      contentBbox: [-52.25, -12.62, -52.19, -12.56],
      widthPt: MAP_W,
      heightPt: MAP_H,
    });
    const [x1] = frame.project(frame.centerLon, frame.centerLat);
    const [x2] = frame.project(frame.centerLon + 0.01, frame.centerLat);
    const metrosPorGrau = 40075016.686 * Math.cos((frame.centerLat * Math.PI) / 180) / 360;
    expect((x2 - x1) * frame.metersPerPoint).toBeCloseTo(metrosPorGrau * 0.01, 0);
  });

  it("escolhe barra de escala redonda e proporcional", () => {
    const bar = pickScaleBar(50, 150); // 50 m por ponto → até 7,5 km
    expect(bar.meters).toBe(5000);
    expect(bar.label).toBe("5 km");
    expect(bar.widthPt).toBeCloseTo(100, 6);
    expect(bar.widthPt).toBeLessThanOrEqual(150);

    const curta = pickScaleBar(1, 150);
    expect(curta.label).toBe("100 m");
    expect(curta.widthPt).toBeLessThanOrEqual(150);
  });

  it("monta as URLs dos provedores a partir do quadro", () => {
    const frame = resolveMapFrame({
      contentBbox: [-52.3, -12.7, -52.1, -12.5],
      widthPt: MAP_W,
      heightPt: MAP_H,
    });
    const google = buildGoogleStaticUrl(frame, "CHAVE");
    expect(google).toContain(`center=${frame.centerLat}%2C${frame.centerLon}`);
    expect(google).toContain(`zoom=${frame.zoom}`);
    expect(google).toContain("maptype=hybrid");
    expect(google).toContain("scale=2");
    expect(google).toContain("key=CHAVE");

    const esri = buildEsriExportUrl(frame);
    expect(esri).toContain("bboxSR=102100");
    expect(esri).toContain("imageSR=102100");
  });

  it("calcula bbox de uma lista de posições", () => {
    expect(bboxOfPositions([[-52.3, -12.7], [-52.1, -12.5], [-52.2, -12.6]])).toEqual([
      -52.3, -12.7, -52.1, -12.5,
    ]);
  });

  /**
   * Regressão: a URL do Esri chegou a pedir 4096×2871 (11,8 Mpx) e o
   * `export` público do World_Imagery devolve HTTP 500 "Error: bytes" acima de
   * ~4,7 Mpx — falha silenciosa que deixava o croqui sem imagem de satélite
   * (medido ao vivo em 2026-08-04). O orçamento tem que ficar bem abaixo disso
   * para os dois formatos usados em produção: o mapa cheio do PDF (826×579 pt)
   * e o mapinha de escolha do RoutePicker (560×420 pt).
   */
  it("mantém o pedido ao Esri dentro do orçamento de pixels que o serviço aceita", () => {
    const shapes: Array<[number, number]> = [
      [826, 579], // página do PDF
      [560, 420], // mapinha de escolha (RoutePicker)
      [420, 560], // retrato, defensivo
    ];
    for (const [widthPt, heightPt] of shapes) {
      const frame = resolveMapFrame({
        contentBbox: [-52.3, -12.7, -52.1, -12.5],
        widthPt,
        heightPt,
      });
      const esri = buildEsriExportUrl(frame);
      const size = /size=([\d,%2C]+)/.exec(esri)?.[1] || "";
      const [w, h] = decodeURIComponent(size).split(",").map(Number);
      expect(w * h).toBeLessThanOrEqual(4_000_000);
      expect(w).toBeLessThanOrEqual(4096);
      expect(h).toBeLessThanOrEqual(4096);
      // Aspect da imagem pedida casa com o aspect da área de mapa — senão o
      // provedor reenquadra por conta própria e desalinha da vetorização.
      expect(w / h).toBeCloseTo(widthPt / heightPt, 1);
    }
  });
});
