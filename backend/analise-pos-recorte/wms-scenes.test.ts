import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Geometry } from "geojson";

import {
  buildAuasScene,
  buildWmsGetMapUrl,
  buildWmsResolutionFallbacks,
  bboxSidesMeters,
  calculateDynamicResolution,
  expandBboxForContext,
  MIN_CONTEXT_SENSOR_PIXELS,
  MIN_POLYGON_SENSOR_PIXELS,
  polygonSensorPixels,
  sensorGroundResolutionM,
  calculateWmsTimeout,
  fetchWmsImageBuffer,
  isRetryableWmsError,
  sanitizeWmsUrl,
} from "./wms-scenes";
import type { AuasPolygonIdentity } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function pngResponse(width = 100, height = 80): Promise<Response> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 30 } } })
    .png()
    .toBuffer();
  return new Response(buf, { status: 200, headers: { "content-type": "image/png" } });
}

/**
 * Imagem em xadrez de blocos grandes (evita ser classificada como "uniforme/sem
 * dado" mesmo após o downsample usado pelas heurísticas de qualidade).
 */
async function noisyPngResponse(width: number, height: number): Promise<Response> {
  const channels = 3;
  const blockSize = Math.max(8, Math.round(Math.min(width, height) / 10));
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isDark = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
      const value = isDark ? 10 : 230;
      const offset = (y * width + x) * channels;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  const buf = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  return new Response(buf, { status: 200, headers: { "content-type": "image/png" } });
}

/** fetchImpl que respeita width/height pedidos na URL WMS, como faria o GeoServer real. */
function fetchImplRespectingRequestedSize(): typeof fetch {
  return (async (input: any) => {
    const url = new URL(String(input));
    const width = Number(url.searchParams.get("width")) || 800;
    const height = Number(url.searchParams.get("height")) || 600;
    return noisyPngResponse(width, height);
  }) as unknown as typeof fetch;
}

function polygonFixture(): AuasPolygonIdentity {
  const geometry: Geometry = {
    type: "Polygon",
    coordinates: [[[-56.1, -12.1], [-56.09, -12.1], [-56.09, -12.09], [-56.1, -12.09], [-56.1, -12.1]]],
  };
  return {
    polygonId: "AUAS-0001",
    geometryHash: "abc123",
    sourceIndex: 0,
    areaHa: 20,
    bbox: [-56.1, -12.1, -56.09, -12.09],
    centroid: [-56.095, -12.095],
    geometry,
  };
}

describe("buildWmsGetMapUrl", () => {
  it("monta WMS 1.1.1 EPSG:4326 com bbox na ordem correta", () => {
    const url = new URL(buildWmsGetMapUrl(["Mosaicos:LANDSAT_5_2003"], [-56.1, -12.1, -56.0, -12.0], 800, 600));
    expect(url.searchParams.get("service")).toBe("WMS");
    expect(url.searchParams.get("version")).toBe("1.1.1");
    expect(url.searchParams.get("srs")).toBe("EPSG:4326");
    expect(url.searchParams.get("bbox")).toBe("-56.1,-12.1,-56,-12");
    expect(url.searchParams.get("layers")).toBe("Mosaicos:LANDSAT_5_2003");
  });

  it("inclui authkey na URL bruta mas sanitizeWmsUrl remove", () => {
    const raw = buildWmsGetMapUrl(["X"], [0, 0, 1, 1]);
    expect(raw).toContain("authkey=");
    expect(sanitizeWmsUrl(raw)).not.toContain("authkey");
  });
});

describe("calculateDynamicResolution / calculateWmsTimeout", () => {
  it("preserva aspect ratio do bbox", () => {
    const { width, height } = calculateDynamicResolution(100, [0, 0, 2, 1]);
    expect(width / height).toBeCloseTo(2, 1);
  });

  it("timeout cresce com o número de pixels", () => {
    expect(calculateWmsTimeout(800, 600)).toBe(15_000);
    expect(calculateWmsTimeout(2000, 1500)).toBe(60_000);
    expect(calculateWmsTimeout(3000, 3000)).toBe(90_000);
  });
});

describe("isRetryableWmsError / buildWmsResolutionFallbacks", () => {
  it("classifica erros de rede/timeout como retryable", () => {
    expect(isRetryableWmsError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableWmsError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableWmsError(new Error("HTTP 400 bad request"))).toBe(false);
  });

  it("gera fallbacks decrescentes sem duplicar dimensões", () => {
    const fallbacks = buildWmsResolutionFallbacks(100, 100);
    expect(fallbacks[0]).toEqual([100, 100]);
    expect(fallbacks.length).toBeGreaterThan(1);
    const keys = new Set(fallbacks.map(([w, h]) => `${w}x${h}`));
    expect(keys.size).toBe(fallbacks.length);
  });
});

describe("fetchWmsImageBuffer", () => {
  it("retorna buffer PNG válido na primeira tentativa", async () => {
    const fetchImpl = vi.fn(async () => pngResponse(200, 150));
    const result = await fetchWmsImageBuffer(["L"], [0, 0, 1, 1], 200, 150, { fetchImpl });
    expect(result.usedResolutionFallback).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejeita HTML/XML de erro com HTTP 200 e tenta fallback de resolução", async () => {
    const xmlResponse = () =>
      Promise.resolve(
        new Response("<ServiceExceptionReport/>", { status: 200, headers: { "content-type": "text/xml" } })
      );
    const fetchImpl = vi.fn(xmlResponse);
    await expect(fetchWmsImageBuffer(["L"], [0, 0, 1, 1], 200, 150, { fetchImpl, retryAttempts: 1 })).rejects.toThrow();
  });

  it("faz retry em erro transitório e depois sucede", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed: socket hang up");
      return pngResponse(200, 150);
    });
    const sleep = vi.fn(async () => {});
    const result = await fetchWmsImageBuffer(["L"], [0, 0, 1, 1], 200, 150, {
      fetchImpl,
      sleep,
      retryAttempts: 2,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("não repete erro 4xx não transitório", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));
    await expect(
      fetchWmsImageBuffer(["L"], [0, 0, 1, 1], 200, 150, { fetchImpl, retryAttempts: 3 })
    ).rejects.toThrow();
    // 4 resoluções de fallback x 1 tentativa cada (erro não retryable) = 4 chamadas
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("reamostra para o tamanho alvo quando um fallback de resolução é usado", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: any) => {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return pngResponse(140, 105); // 0.7 factor da resolução alvo 200x150
    });
    const sleep = vi.fn(async () => {});
    const result = await fetchWmsImageBuffer(["L"], [0, 0, 1, 1], 200, 150, { fetchImpl, sleep, retryAttempts: 1 });
    expect(result.usedResolutionFallback).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
  });
});

describe("buildAuasScene", () => {
  it("gera cena USABLE com hash de imagem e URL sem authkey", async () => {
    const fetchImpl = vi.fn(fetchImplRespectingRequestedSize());
    const polygon = polygonFixture();
    const scene = await buildAuasScene(polygon, 2003, { fetchImpl, now: () => "2026-07-30T00:00:00.000Z" });
    expect(scene.sceneId).toBe("AUAS-0001:landsat5:2003");
    expect(scene.sensor).toBe("LANDSAT_5");
    expect(scene.layer).toContain("2003");
    expect(scene.imageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scene.storedImageUrl).not.toContain("authkey");
    expect(scene.usability).toBe("USABLE");
  });

  it("usa camada SPOT para 2008", async () => {
    const fetchImpl = vi.fn(fetchImplRespectingRequestedSize());
    const polygon = polygonFixture();
    const scene = await buildAuasScene(polygon, 2008, { fetchImpl });
    expect(scene.sensor).toBe("SPOT");
    expect(scene.layer).toContain("SPOT");
  });

  it("classifica como MISSING quando o WMS falha totalmente", async () => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: 500 }));
    const polygon = polygonFixture();
    const scene = await buildAuasScene(polygon, 2005, { fetchImpl, retryAttempts: 1 });
    expect(scene.usability).toBe("MISSING");
    expect(scene.imageSha256).toBe("");
  });

  it("mantém bbox/dimensões idênticos entre cenas do mesmo polígono", async () => {
    const fetchImpl = vi.fn(fetchImplRespectingRequestedSize());
    const polygon = polygonFixture();
    const s1 = await buildAuasScene(polygon, 2003, { fetchImpl });
    const s2 = await buildAuasScene(polygon, 2007, { fetchImpl });
    expect(s1.bbox).toEqual(s2.bbox);
    expect(s1.width).toBe(s2.width);
    expect(s1.height).toBe(s2.height);
  });
});

/* ── enquadramento por resolução do sensor (CAR 6816, 2026-08-08) ── */

describe("enquadramento da cena pela resolução do sensor", () => {
  // AUAS-0004 do CAR 6816: 437 m × 106 m — 1,39 ha reais.
  const auas0004: [number, number, number, number] = [-52.341166, -12.568692, -52.337156, -12.56774];

  it("mede o polígono em pixels nativos do sensor", () => {
    const landsat = polygonSensorPixels(auas0004, sensorGroundResolutionM("LANDSAT_5"));
    // 106 m de lado menor em pixels de 30 m: nem 4 pixels.
    expect(landsat.shortSidePx).toBeLessThan(MIN_POLYGON_SENSOR_PIXELS);

    const spot = polygonSensorPixels(auas0004, sensorGroundResolutionM("SPOT"));
    // O mesmo polígono é resolvido pelo SPOT (5 m).
    expect(spot.shortSidePx).toBeGreaterThan(MIN_POLYGON_SENSOR_PIXELS);
  });

  it("expande o bbox para dar contexto e nunca encolhe", () => {
    const expanded = expandBboxForContext(auas0004, sensorGroundResolutionM("LANDSAT_5"));
    expect(expanded[0]).toBeLessThan(auas0004[0]);
    expect(expanded[1]).toBeLessThan(auas0004[1]);
    expect(expanded[2]).toBeGreaterThan(auas0004[2]);
    expect(expanded[3]).toBeGreaterThan(auas0004[3]);

    const before = bboxSidesMeters(auas0004);
    const after = bboxSidesMeters(expanded);
    // O lado menor sai de 106 m para pelo menos MIN_CONTEXT_SENSOR_PIXELS × 30 m.
    expect(Math.min(after.widthM, after.heightM)).toBeGreaterThanOrEqual(
      Math.min(before.widthM, before.heightM),
    );
    expect(Math.min(after.widthM, after.heightM)).toBeGreaterThanOrEqual(
      MIN_CONTEXT_SENSOR_PIXELS * sensorGroundResolutionM("LANDSAT_5") - 1,
    );
  });

  it("não pede ao WMS muito mais pixels do que o mosaico tem", () => {
    const semCap = calculateDynamicResolution(1.39, auas0004);
    const comCap = calculateDynamicResolution(1.39, auas0004, sensorGroundResolutionM("LANDSAT_5"));
    // Sem teto, 437 m de Landsat viravam ~2000 px de largura (interpolação pura).
    expect(semCap.width).toBeGreaterThan(comCap.width);
    const native = polygonSensorPixels(auas0004, sensorGroundResolutionM("LANDSAT_5"));
    expect(comCap.width).toBeLessThanOrEqual(Math.round(native.widthPx * 4) + 1);
    // Aspect ratio preservado (a diferença é só o arredondamento para pixel).
    const ratioSemCap = semCap.width / semCap.height;
    const ratioComCap = comCap.width / comCap.height;
    expect(Math.abs(ratioComCap - ratioSemCap) / ratioSemCap).toBeLessThan(0.05);
  });

  it("marca como BELOW_MIN_RESOLUTION sem chamar o WMS", async () => {
    const fetchImpl = vi.fn();
    const scene = await buildAuasScene(
      {
        polygonId: "AUAS-0004",
        geometryHash: "hash",
        areaHa: 1.39,
        bbox: auas0004,
        geometry: { type: "Polygon", coordinates: [[[-52.341166, -12.568692], [-52.337156, -12.568692], [-52.337156, -12.56774], [-52.341166, -12.56774], [-52.341166, -12.568692]]] },
      } as any,
      2007,
      { fetchImpl: fetchImpl as any },
    );
    expect(scene.usability).toBe("BELOW_MIN_RESOLUTION");
    expect(scene.qualityFlags[0]).toMatch(/below_sensor_resolution/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
