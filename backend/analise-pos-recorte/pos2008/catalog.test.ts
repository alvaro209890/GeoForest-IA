import { afterEach, describe, expect, it } from "vitest";

import { clearPos2008CatalogCache, resolvePos2008Catalog } from "./catalog";

const capabilities = Array.from({ length: 11 }, (_, index) => 2009 + index)
  .map((year) => `<Name>Mosaicos:LANDSAT_5_${year}</Name>`)
  .join("");

afterEach(() => clearPos2008CatalogCache());

describe("resolvePos2008Catalog", () => {
  it("não reutiliza validação GetMap de outra bbox", async () => {
    let validations = 0;
    const deps = {
      now: () => 0,
      fetchCapabilitiesXml: async () => capabilities,
      isLayerUsable: async () => {
        validations += 1;
        return true;
      },
    };

    await resolvePos2008Catalog({ ...deps, sampleBbox: [0, 0, 1, 1] });
    await resolvePos2008Catalog({ ...deps, sampleBbox: [10, 10, 11, 11] });
    expect(validations).toBe(22);
  });
});
