import { describe, expect, it, vi } from "vitest";
import {
  fetchCompleteSemaWfsLayer,
  loadSemaWfsLayerMapping,
  SemaWfsSourceError,
  type SemaWfsSourceDependencies,
} from "./sema-wfs-source";

function dependencies(
  overrides: Partial<SemaWfsSourceDependencies> = {}
): SemaWfsSourceDependencies {
  return {
    getCapabilities: vi.fn(async () => ({
      expiresAt: Date.now() + 60_000,
      layerNames: new Set(["Geoportal:SIMCAR_D_AVN"]),
      featureTypeCount: 1,
    })),
    discoverMapping: vi.fn(() => new Map([["AVN", "Geoportal:SIMCAR_D_AVN"]])),
    fetchByBbox: vi.fn(async () => ({
      features: [],
      warnings: [],
      partial: false,
    })),
    fetchByPolygon: vi.fn(async () => ({
      features: [],
      warnings: [],
      partial: false,
    })),
    ...overrides,
  };
}

describe("fonte obrigatoria WFS do recorte SIMCAR", () => {
  it("forca GetCapabilities novo para nao esconder queda atual com cache", async () => {
    const deps = dependencies();
    const mapping = await loadSemaWfsLayerMapping(["AVN"], deps);

    expect(deps.getCapabilities).toHaveBeenCalledWith(true);
    expect(mapping.get("AVN")).toBe("Geoportal:SIMCAR_D_AVN");
  });

  it("cancela quando o WFS esta fora em vez de recorrer a outra base", async () => {
    const deps = dependencies({
      getCapabilities: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });

    await expect(loadSemaWfsLayerMapping(["AVN"], deps)).rejects.toMatchObject({
      code: "SEMA_WFS_SOURCE_UNAVAILABLE",
      failure: "unavailable",
    });
  });

  it("rejeita resposta parcial para nunca gerar ZIP truncado", async () => {
    const deps = dependencies({
      fetchByBbox: vi.fn(async () => ({
        features: [],
        warnings: ["limite atingido"],
        partial: true,
      })),
    });

    await expect(
      fetchCompleteSemaWfsLayer(
        {
          layerName: "AVN",
          typeName: "Geoportal:SIMCAR_D_AVN",
          bbox: [-52.4, -12.4, -52.3, -12.3],
        },
        deps
      )
    ).rejects.toMatchObject({
      code: "SEMA_WFS_SOURCE_UNAVAILABLE",
      failure: "partial",
      layerName: "AVN",
    });
  });

  it("propaga resultado completo do WFS oficial", async () => {
    const complete = {
      features: [{ geometry: null, properties: { ID: 1 } }],
      warnings: [],
      partial: false,
    };
    const deps = dependencies({ fetchByPolygon: vi.fn(async () => complete) });

    await expect(
      fetchCompleteSemaWfsLayer(
        {
          layerName: "AVN",
          typeName: "Geoportal:SIMCAR_D_AVN",
          polygonWkt: "POLYGON((-52 -12,-52 -13,-51 -13,-52 -12))",
        },
        deps
      )
    ).resolves.toEqual(complete);
  });

  it("mantem erro de contrato distinguivel de uma resposta vazia valida", async () => {
    const deps = dependencies();
    await expect(
      fetchCompleteSemaWfsLayer(
        {
          layerName: "AVN",
          typeName: "Geoportal:SIMCAR_D_AVN",
        },
        deps
      )
    ).rejects.toBeInstanceOf(SemaWfsSourceError);
  });
});
