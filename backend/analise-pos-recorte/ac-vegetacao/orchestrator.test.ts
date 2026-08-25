/**
 * Testes do orquestrador da Fase 3 (vegetação na AC) — F3.6.
 * Caminho feliz com fetch fakes (WMS gera PNG, Groq responde JSON) e
 * o caso "sem AC" (zero chamadas de IA).
 */
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { Geometry } from "geojson";

import { runAcVegetacaoAnalysis } from "./orchestrator";
import { buildAcVegetacaoScene } from "./scenes";
import type { AcPotentialPolygon } from "./types";

function squarePolygon(cx: number, cy: number, size = 0.01): Geometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [cx, cy],
        [cx + size, cy],
        [cx + size, cy + size],
        [cx, cy + size],
        [cx, cy],
      ],
    ],
  };
}

function acPolygon(id: string, geom: Geometry): AcPotentialPolygon {
  return {
    polygonId: id,
    geometryHash: `hash-${id}`,
    sourceIndex: 0,
    areaHa: 10,
    bbox: [0, 0, 1, 1],
    centroid: [0.5, 0.5],
    geometry: geom,
  };
}

/** WMS fake: PNG xadrez (não-uniforme) 800x600 — passa na classificação. */
function wmsFetchImpl(): typeof fetch {
  return (async (input: any) => {
    const url = new URL(String(input));
    const width = Number(url.searchParams.get("width")) || 800;
    const height = Number(url.searchParams.get("height")) || 600;
    const blockSize = Math.max(8, Math.round(Math.min(width, height) / 10));
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isDark = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0;
        const value = isDark ? 40 : 180;
        const offset = (y * width + x) * 3;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
    const buf = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
    return new Response(buf, { status: 200, headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
}

/** Groq fake: tudo NONE (sem vegetação aparente). */
function groqFetchImpl(): { fetchImpl: typeof fetch; calls: () => number } {
  let callCount = 0;
  const fetchImpl = (async (_url: any, init: any) => {
    callCount += 1;
    const body = JSON.parse(init.body);
    const userContent = body.messages[1].content;
    const promptText = userContent[0].text as string;
    const polygonId = /polygonId=(\S+)/.exec(promptText)?.[1] || "";
    const imageParts = userContent.filter((c: any) => c.type === "image_url");
    const sceneMatches = [...promptText.matchAll(/sceneId=(\S+) ano=(\d+) sensor=\S+/g)];
    const observations = sceneMatches.map(([, sceneId, year]) => ({
      sceneId,
      year: Number(year),
      vegetationInside: "NONE",
      estimatedFraction: 0,
      distribution: null,
      confidence: "HIGH",
      evidence: [],
      limitations: [],
    }));
    const payload = {
      schemaVersion: 1,
      polygonId,
      windowId: "WAVAC_ATUAL",
      inspectedSceneIds: sceneMatches.map(([, sceneId]) => sceneId),
      observations,
      conflicts: [],
    };
    expect(imageParts.length).toBeLessThanOrEqual(3);
    return new Response(
      JSON.stringify({
        id: "req_x",
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => callCount };
}

vi.setConfig({ testTimeout: 20_000 });

describe("runAcVegetacaoAnalysis", () => {
  it("analisa TODAS as ACs do recorte (sem filtro de IDs da Fase 2)", async () => {
    const groq = groqFetchImpl();
    const layers = new Map<string, Geometry[]>([["AREA_CONSOLIDADA", [squarePolygon(-56.1, -12.1), squarePolygon(-55.9, -11.9)]]]);
    const polygons = [acPolygon("AC-0001", squarePolygon(-56.1, -12.1)), acPolygon("AC-0002", squarePolygon(-55.9, -11.9))];
    const result = await runAcVegetacaoAnalysis(
      {
        jobId: "job-1",
        clippedGeometries: layers,
        pos2008CompletedAt: "2026-01-02T00:00:00.000Z",
        polygons,
      },
      {
        sceneDeps: { fetchImpl: wmsFetchImpl() },
        visionDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      }
    );
    expect(result.polygons).toHaveLength(2);
    expect(groq.calls()).toBe(2);
    expect(result.summary.polygonCount).toBe(2);
    expect(result.windows.filter((w) => w.status === "COMPLETED")).toHaveLength(2);
    expect(result.scenes.find((scene) => scene.sceneId.endsWith(":S2_2024"))?.layer).toBe("Mosaicos:SENTINEL_2_2024");
    expect(result.scenes.find((scene) => scene.sceneId.endsWith(":S2_2025_NIR"))).toMatchObject({
      layer: "Mosaicos:SENTINEL_2_2025",
      style: "Geoportal_Sentinel_2_2025_NIR",
    });
    expect(result.scenes.find((scene) => scene.sceneId.endsWith(":SPOT_2008"))?.layer).toBe("Mosaicos:MOSAICO_SPOT_SEPLAN");
  });

  it("sem AC → retorno vazio sem chamadas de IA", async () => {
    const groq = groqFetchImpl();
    const result = await runAcVegetacaoAnalysis(
      {
        jobId: "job-2",
        clippedGeometries: new Map(),
        pos2008CompletedAt: "2026-01-02T00:00:00.000Z",
        polygons: [],
      },
      {
        sceneDeps: { fetchImpl: wmsFetchImpl() },
        visionDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      }
    );
    expect(result.summary.polygonCount).toBe(0);
    expect(groq.calls()).toBe(0);
    expect(result.polygons).toHaveLength(0);
    expect(result.report.markdown).toContain("Nenhuma Área Consolidada");
  });
  it("AC menor que o mínimo analisável não gasta cena nem visão", async () => {
    // O recorte real da Santa Clara tem 5 ACs de ~0,00 ha; cada uma custava
    // 3 GetMap + 1 chamada de visão para um polígono que o sensor não resolve.
    const groq = groqFetchImpl();
    let wmsCalls = 0;
    const countingWms = (async (input: any) => {
      wmsCalls += 1;
      return wmsFetchImpl()(input);
    }) as unknown as typeof fetch;

    const tiny = { ...acPolygon("AC-0001", squarePolygon(-56.1, -12.1)), areaHa: 0.004 };
    const result = await runAcVegetacaoAnalysis(
      {
        jobId: "job-tiny",
        clippedGeometries: new Map<string, Geometry[]>([["AREA_CONSOLIDADA", [tiny.geometry]]]),
        pos2008CompletedAt: "2026-01-02T00:00:00.000Z",
        polygons: [tiny],
      },
      {
        sceneDeps: { fetchImpl: countingWms },
        visionDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      },
    );

    expect(groq.calls()).toBe(0);
    expect(wmsCalls).toBe(0);
    expect(result.windows[0]).toMatchObject({ status: "SKIPPED", errorCode: "POLYGON_TOO_SMALL" });
    expect(result.polygons[0].status).toBe("INCONCLUSIVO");
    expect(result.polygons[0].limitations.join(" ")).toContain("mínimo analisável");
  });

  it("sem Fase 2 concluída não inventa referência de datação", async () => {
    const groq = groqFetchImpl();
    const polygon = acPolygon("AC-0001", squarePolygon(-56.1, -12.1));
    const result = await runAcVegetacaoAnalysis(
      {
        jobId: "job-noref",
        clippedGeometries: new Map<string, Geometry[]>([["AREA_CONSOLIDADA", [polygon.geometry]]]),
        pos2008CompletedAt: null,
        polygons: [polygon],
      },
      {
        sceneDeps: { fetchImpl: wmsFetchImpl() },
        visionDeps: { apiKey: "k", fetchImpl: groq.fetchImpl },
      },
    );

    expect(result.pos2008JobRef).toBeNull();
  });

  it("compõe a AVN em amarelo e enquadra AC + AVN na cena atual", async () => {
    const polygon = {
      ...acPolygon("AC-0001", squarePolygon(-56.1, -12.1, 0.02)),
      bbox: [-56.1, -12.1, -56.08, -12.08] as [number, number, number, number],
    };
    const avn = squarePolygon(-56.095, -12.095, 0.035);
    const base = await buildAcVegetacaoScene(
      polygon,
      { sceneId: "AC-0001:S2_2024", year: 2024, sensor: "SENTINEL_2", layer: "Mosaicos:SENTINEL_2_2024" },
      { fetchImpl: wmsFetchImpl() },
    );
    const withAvn = await buildAcVegetacaoScene(
      polygon,
      { sceneId: "AC-0001:S2_2024", year: 2024, sensor: "SENTINEL_2", layer: "Mosaicos:SENTINEL_2_2024" },
      { fetchImpl: wmsFetchImpl() },
      {
        avnGeometries: [avn],
        focusBbox: [-56.1, -12.1, -56.06, -12.06],
      },
    );

    expect(base.usability).toBe("USABLE");
    expect(withAvn.usability).toBe("USABLE");
    expect(withAvn.imageSha256).not.toBe(base.imageSha256);
    expect(withAvn.bbox[2]).toBeGreaterThanOrEqual(-56.06);
    expect(withAvn.bbox[3]).toBeGreaterThanOrEqual(-12.06);
  });
});
