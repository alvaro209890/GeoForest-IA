import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { Geometry } from "geojson";

import { runPos2008Analysis } from "./orchestrator";
import type { PosCatalog } from "./catalog";
import type { YearCatalogEntry } from "./catalog-discovery";

function square(): Geometry {
  return {
    type: "Polygon",
    coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
  };
}

function yearEntry(
  year: number,
  sensor: NonNullable<YearCatalogEntry["preferred"]>["sensor"],
  alternateLayer?: string,
): YearCatalogEntry {
    return {
    year,
    preferred: { layer: `Mosaicos:${sensor}_${year}`, sensor, year, nir: false },
    alternates: alternateLayer
      ? [{ layer: alternateLayer, sensor: "SENTINEL_2", year, nir: false }]
      : [],
    missing: false,
    sensorBoundary: false,
  };
}

function catalog(): PosCatalog {
  const entries = [
    yearEntry(2009, "LANDSAT_5"),
    yearEntry(2010, "LANDSAT_5"),
    yearEntry(2011, "LANDSAT_5"),
    yearEntry(2012, "RESOURCESAT"),
    yearEntry(2013, "LANDSAT_8"),
    yearEntry(2014, "LANDSAT_8"),
    yearEntry(2015, "LANDSAT_8"),
    yearEntry(2016, "LANDSAT_8"),
    yearEntry(2017, "LANDSAT_8"),
    yearEntry(2018, "LANDSAT_8", "Mosaicos:SENTINEL_2_2018"),
    yearEntry(2019, "SENTINEL_2"),
  ];
  return {
    version: "catalog-test",
    years: entries.map((entry) => entry.year),
    layerByYear: Object.fromEntries(entries.map((entry) => [entry.year, entry.preferred!.layer])),
    sensorByYear: Object.fromEntries(entries.map((entry) => [entry.year, entry.preferred!.sensor])),
    missingYears: [],
    alternativesAvailable: { 2018: ["Mosaicos:SENTINEL_2_2018"] },
    entries,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    limitations: [],
  };
}

describe("runPos2008Analysis", () => {
  // Gera e redimensiona 12 PNGs com sharp: ~1 s sozinho, mas o default de 5 s do
  // vitest estourava quando este arquivo dividia CPU com `processar-projeto.test.ts`
  // (~108 s) na suíte completa — o `main` ficava vermelho de forma intermitente.
  it("executa a ponte com alternativa de apenas um lado sem trocar a série normal", { timeout: 60_000 }, async () => {
    const raw = Buffer.alloc(800 * 600 * 3);
    for (let i = 0; i < raw.length; i += 3) {
      const pixel = i / 3;
      const x = pixel % 800;
      const y = Math.floor(pixel / 800);
      const value = (Math.floor(x / 80) + Math.floor(y / 60)) % 2 === 0 ? 20 : 220;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
    }
    const png = await sharp(raw, { raw: { width: 800, height: 600, channels: 3 } }).png().toBuffer();
    const visionFetch = (async (_url: unknown, init: any) => {
      const body = JSON.parse(init.body);
      const text = body.messages[1].content[0].text as string;
      const matches = [...text.matchAll(/sceneId=(\S+) ano=(\d+) sensor=\S+/g)];
      const observations = matches.map(([, sceneId, year]) => ({
        sceneId,
        year: Number(year),
        state: "NATIVE_VEGETATION",
        observableFraction: 1,
        confidence: "HIGH",
        evidence: [],
        limitations: [],
      }));
      return new Response(JSON.stringify({
        id: "vision-test",
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: 1,
          polygonId: "AUAS-0001",
          windowId: /windowId=(\S+)/.exec(text)?.[1],
          inspectedSceneIds: matches.map(([, sceneId]) => sceneId),
          observations,
          transitions: [],
          conflicts: [],
        }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await runPos2008Analysis(
      { jobId: "job-bridge", clippedGeometries: new Map([["AUAS", [square()]]]) },
      {
        catalog: catalog(),
        sceneDeps: {
          fetchImpl: async (input: any) => {
            const url = new URL(String(input));
            const width = Number(url.searchParams.get("width")) || 800;
            const height = Number(url.searchParams.get("height")) || 600;
            const resized = await sharp(png).resize(width, height).png().toBuffer();
            return new Response(resized, { status: 200, headers: { "content-type": "image/png" } });
          },
        },
        visionDeps: { apiKey: "test", fetchImpl: visionFetch },
        reportDeps: { apiKey: "" },
      },
    );

    expect(result.windows.map((window) => window.windowId)).toContain("WBRIDGE");
    expect(result.windows.find((window) => window.windowId === "WBRIDGE")?.status).toBe("COMPLETED");
    expect(result.scenes.find((scene) => scene.year === 2019 && !scene.bridge)?.layer).toBe("Mosaicos:SENTINEL_2_2019");
    expect(result.scenes.find((scene) => scene.year === 2018 && scene.bridge)?.layer).toBe("Mosaicos:SENTINEL_2_2018");
  });
});
