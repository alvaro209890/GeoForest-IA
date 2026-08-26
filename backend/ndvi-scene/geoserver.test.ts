import { afterEach, describe, expect, it, vi } from "vitest";
import { NDVI_SCENE_COMPOSITIONS } from "./constants";
import { rollbackCompositionLayer, styleNameForComposition } from "./geoserver";

afterEach(() => vi.unstubAllGlobals());

describe("publicação WMS da cena completa", () => {
  it("usa o estilo raster em todos os GeoTIFFs já coloridos", () => {
    for (const composition of NDVI_SCENE_COMPOSITIONS) {
      expect(composition.styleName).toBe("raster");
      expect(styleNameForComposition(composition.id)).toBe("raster");
    }
  });

  it("remove somente a árvore NDVI vazia e preserva os irmãos de RASTER", async () => {
    const groups: Record<string, string> = {
      ndvi_orbit_224_069_y2007: "cbers:store_job",
      ndvi_orbit_224_069: "cbers:ndvi_orbit_224_069_y2007",
      NDVI: "cbers:ndvi_orbit_224_069",
    };
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method || "GET");
        calls.push({ url, method, body: String(init?.body || "") });
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (method === "PUT") return new Response(null, { status: 200 });
        const name = Object.keys(groups).find(candidate =>
          url.endsWith(`/layergroups/${candidate}.json`)
        );
        if (name) {
          return Response.json({
            layerGroup: {
              name,
              publishables: { published: [{ name: groups[name] }] },
              styles: { style: [""] },
            },
          });
        }
        if (url.endsWith("/layergroups/RASTER.json")) {
          return Response.json({
            layerGroup: {
              name: "RASTER",
              publishables: {
                published: [
                  { name: "cbers:CBERS-4A-Apos_2019" },
                  { name: "cbers:NDVI" },
                ],
              },
              styles: { style: ["", ""] },
            },
          });
        }
        return new Response(null, { status: 404 });
      })
    );

    await rollbackCompositionLayer({
      storeName: "store_job",
      path: "224",
      row: "069",
      year: "2007",
    });

    const rasterPut = calls.find(
      call => call.method === "PUT" && call.url.endsWith("/layergroups/RASTER")
    );
    expect(rasterPut?.body).toContain("cbers:CBERS-4A-Apos_2019");
    expect(rasterPut?.body).not.toContain("cbers:NDVI");
    expect(
      calls.filter(call => call.method === "DELETE").map(call => call.url)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/layergroups/NDVI"),
        expect.stringContaining("/layergroups/ndvi_orbit_224_069"),
        expect.stringContaining("/layergroups/ndvi_orbit_224_069_y2007"),
        expect.stringContaining("/coveragestores/store_job?recurse=true"),
      ])
    );
  });
});
