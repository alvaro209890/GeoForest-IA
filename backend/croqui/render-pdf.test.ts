import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { ylwPushpinPng } from "./assets/ylw-pushpin-data";
import { formatDmsPair } from "./coords";
import type { CroquiRoute, RouteWaypoint } from "./routing";

vi.mock("./basemap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./basemap")>();
  return {
    ...actual,
    fetchBasemapImage: async () => null,
  };
});

const ASSET = path.resolve(import.meta.dirname, "assets", "ylw-pushpin.png");

function waypoint(lon: number, lat: number, coordIndex: number): RouteWaypoint {
  return {
    lon,
    lat,
    dms: formatDmsPair(lon, lat),
    distanceToNextM: 1000,
    maneuver: "straight",
    roadName: "MT-243",
    coordIndex,
  };
}

describe("croqui render-pdf pushpin", () => {
  it("tem o PNG oficial do Google Earth no pacote", () => {
    expect(fs.existsSync(ASSET)).toBe(true);
    const buf = fs.readFileSync(ASSET);
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      true,
    );
    expect(buf.length).toBeGreaterThan(1000);
    expect(ylwPushpinPng().equals(buf)).toBe(true);
  });

  it("PDFKit aceita o PNG com transparência", async () => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: [100, 100], margin: 0 });
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.image(fs.readFileSync(ASSET), 10, 10, { width: 24, height: 24 });
    doc.end();
    const pdf = await done;
    // PDFKit reempacota o PNG como XObject — a assinatura PNG some.
    expect(pdf.includes(Buffer.from("/XObject"))).toBe(true);
    expect(pdf.includes(Buffer.from("/Image"))).toBe(true);
  });

  it("embute o ylw-pushpin.png no croqui PDF", async () => {
    const { buildCroquiPdfBuffer } = await import("./render-pdf");
    const coordinates = [
      [-52.22, -12.59],
      [-52.2, -12.6],
    ];
    const route: CroquiRoute = {
      coordinates,
      waypoints: [waypoint(-52.22, -12.59, 0), waypoint(-52.2, -12.6, 1)],
      totalDistanceM: 2500,
      arrivalSide: "esquerda",
      geometry: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    };

    const result = await buildCroquiPdfBuffer({
      title: "Teste Pushpin",
      narrative: "Inicia-se o croqui no ponto de teste.",
      atpGeometry: {
        type: "Polygon",
        coordinates: [
          [
            [-52.205, -12.605],
            [-52.195, -12.605],
            [-52.195, -12.595],
            [-52.205, -12.595],
            [-52.205, -12.605],
          ],
        ],
      },
      route,
    });

    const pdf = result.buffer;
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.includes(Buffer.from("/XObject"))).toBe(true);
    expect(pdf.includes(Buffer.from("/Image"))).toBe(true);
    // Sem basemap, a única imagem embutida é o pushpin (aparece 1× por waypoint + legenda).
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(result.hasBasemapImage).toBe(false);
    expect(result.basemapProvider).toBeNull();
  });
});
