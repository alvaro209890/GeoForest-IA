import { describe, expect, it, vi } from "vitest";
import {
  fetchCompleteSimcarSnapshotLayer,
  loadSimcarSnapshotLayerMapping,
  type SimcarSnapshotSourceDependencies,
} from "./sema-wfs-source";

const AVN_TYPE = "cbers:car_digital_simcar_d_simcar_d_avn";
const AVN_STORE = AVN_TYPE.split(":")[1];

function dependencies(
  overrides: Partial<SimcarSnapshotSourceDependencies> = {},
): SimcarSnapshotSourceDependencies {
  return {
    readSnapshot: vi.fn(() => ({
      snapshot: "20260901T050002Z",
      generatedAt: "2026-09-01T05:35:43Z",
      ageDays: 17,
      storeNames: new Set([AVN_STORE]),
    })),
    getCapabilities: vi.fn(async () => new Set([AVN_TYPE])),
    resolveLayer: vi.fn((layerName) => layerName === "AVN" ? AVN_TYPE : null),
    fetchByBbox: vi.fn(async () => ({
      features: [],
      warnings: [],
      partial: false,
    })),
    ...overrides,
  };
}

describe("fonte mensal oficial do recorte SIMCAR", () => {
  it("mapeia somente uma camada presente no manifest e no GeoServer local", async () => {
    const result = await loadSimcarSnapshotLayerMapping(["AVN"], dependencies());
    expect(result.layers.get("AVN")).toBe(AVN_TYPE);
    expect(result.snapshot.snapshot).toBe("20260901T050002Z");
  });

  it("cancela quando o snapshot não pode ser validado", async () => {
    const deps = dependencies({
      readSnapshot: vi.fn(() => {
        throw new Error("manifest ausente");
      }),
    });
    await expect(loadSimcarSnapshotLayerMapping(["AVN"], deps)).rejects.toMatchObject({
      code: "SIMCAR_SNAPSHOT_SOURCE_UNAVAILABLE",
      failure: "unavailable",
    });
  });

  it("rejeita consulta parcial para nunca gerar ZIP truncado", async () => {
    const deps = dependencies({
      fetchByBbox: vi.fn(async () => ({
        features: [],
        warnings: ["limite atingido"],
        partial: true,
      })),
    });
    await expect(fetchCompleteSimcarSnapshotLayer({
      layerName: "AVN",
      typeName: AVN_TYPE,
      bbox: [-52.4, -12.4, -52.3, -12.3],
    }, deps)).rejects.toMatchObject({
      failure: "partial",
      layerName: "AVN",
    });
  });

  it("propaga resposta completa da cópia mensal", async () => {
    const complete = {
      features: [{ geometry: null, properties: { ID: 1 } }],
      warnings: [],
      partial: false,
    };
    const deps = dependencies({ fetchByBbox: vi.fn(async () => complete) });
    await expect(fetchCompleteSimcarSnapshotLayer({
      layerName: "AVN",
      typeName: AVN_TYPE,
      bbox: [-52.4, -12.4, -52.3, -12.3],
    }, deps)).resolves.toEqual(complete);
  });
});
