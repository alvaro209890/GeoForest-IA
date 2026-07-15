import { describe, expect, it } from "vitest";
import {
  appBufferMetersForLayer,
  generateSimcarDerivedLayers,
  parsePointRecords,
} from "./simcar-processar-geo";
import { detectCrs } from "./vertices-proximas";
import type { ParsedPolygonRecord } from "./vertices-proximas";
import { buildPointShpAndShx } from "./shapefile-writer";
import { recognizeSimcarLayer } from "./simcar-rules";

const geoCrs = detectCrs(undefined, "EPSG:4674");

function square(lon: number, lat: number, d = 0.001): ParsedPolygonRecord {
  return {
    feature: 1,
    rings: [
      [
        [lon, lat],
        [lon, lat + d],
        [lon + d, lat + d],
        [lon + d, lat],
        [lon, lat],
      ],
    ],
  };
}

describe("appBufferMetersForLayer", () => {
  it("maps official river classes to Código Florestal distances", () => {
    expect(appBufferMetersForLayer("RIO_MENOR_10")).toBe(30);
    expect(appBufferMetersForLayer("RIO_ATE_10")).toBe(30);
    expect(appBufferMetersForLayer("RIO_10_A_50")).toBe(50);
    expect(appBufferMetersForLayer("RIO_50_ATE_200")).toBe(100);
    expect(appBufferMetersForLayer("RIO_200_A_600")).toBe(200);
    expect(appBufferMetersForLayer("RIO_ACIMA_600")).toBe(500);
    expect(appBufferMetersForLayer("NASCENTE")).toBe(50);
    expect(appBufferMetersForLayer("VEREDA")).toBe(50);
    expect(appBufferMetersForLayer("AVN")).toBeNull();
  });
});

describe("recognize aliases for modelo clip", () => {
  it("recognizes RIO_ATE_10 as RIO_MENOR_10", () => {
    expect(recognizeSimcarLayer("RIO_ATE_10")).toBe("RIO_MENOR_10");
    expect(recognizeSimcarLayer("RIO_10_A_50")).toBe("RIO_10_ATE_50");
  });
});

describe("generateSimcarDerivedLayers", () => {
  it("builds APP from river buffer clipped to AIR and APPP/APPD vs AVN", () => {
    // Imóvel ~1.1 km square around -55,-12
    const air = square(-55.01, -12.01, 0.02);
    const atp = square(-55.012, -12.012, 0.024);
    // Rio fino no centro → buffer 30 m
    const rio: ParsedPolygonRecord = {
      feature: 1,
      rings: [
        [
          [-55.0, -12.0],
          [-55.0, -11.995],
          [-54.9995, -11.995],
          [-54.9995, -12.0],
          [-55.0, -12.0],
        ],
      ],
    };
    // AVN cobre só metade oeste do imóvel
    const avn: ParsedPolygonRecord = {
      feature: 1,
      rings: [
        [
          [-55.01, -12.01],
          [-55.01, -11.99],
          [-55.0, -11.99],
          [-55.0, -12.01],
          [-55.01, -12.01],
        ],
      ],
    };

    const result = generateSimcarDerivedLayers([
      { name: "ATP", records: [atp], crs: geoCrs },
      { name: "AIR", records: [air], crs: geoCrs },
      { name: "RIO_MENOR_10", records: [rio], crs: geoCrs },
      { name: "AVN", records: [avn], crs: geoCrs },
    ]);

    const codes = result.derived.map((d) => d.code).sort();
    expect(codes).toContain("APP");
    expect(result.derived.find((d) => d.code === "APP")!.areaM2).toBeGreaterThan(0);
    // Com AVN parcial, espera-se APPP e/ou APPD
    expect(codes.some((c) => c === "APPP" || c === "APPD")).toBe(true);
    expect(result.quadroApp.some((q) => q.feicao === "APP")).toBe(true);
  });

  it("builds nascente APP from point records", () => {
    // AIR grande o suficiente para conter o buffer de 50 m da nascente
    const air = square(-55.02, -12.02, 0.04);
    const result = generateSimcarDerivedLayers([
      { name: "AIR", records: [air], crs: geoCrs },
      {
        name: "NASCENTE",
        records: [],
        crs: geoCrs,
        points: [{ feature: 1, x: -55.0, y: -12.0 }],
      },
    ]);
    expect(result.warnings.join(" ")).not.toMatch(/nenhuma feição hidrográfica/i);
    expect(result.derived.some((d) => d.code === "APP")).toBe(true);
    expect(result.derived.find((d) => d.code === "APP")!.areaM2).toBeGreaterThan(1000); // ~π*50²
  });
});

describe("parsePointRecords", () => {
  it("reads point shapefile", () => {
    const { shp } = buildPointShpAndShx([{ coordinates: [-55.1, -12.2], attributes: { id: 1 } }], 1);
    const pts = parsePointRecords(shp);
    expect(pts.length).toBeGreaterThanOrEqual(1);
    expect(pts[0].x).toBeCloseTo(-55.1, 5);
    expect(pts[0].y).toBeCloseTo(-12.2, 5);
  });
});
