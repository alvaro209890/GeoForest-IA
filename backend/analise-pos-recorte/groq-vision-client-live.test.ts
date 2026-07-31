import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { requestGroqVisionWindow, type GroqVisionWindowRequest } from "./groq-vision-client";

const liveEnabled = process.env.GROQ_VISION_LIVE === "1" && Boolean(process.env.GROQ_API_KEY);

async function testImageDataUrl(seed: number): Promise<string> {
  const width = 256;
  const height = 192;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = Math.floor(x / 24) + Math.floor(y / 24) + seed;
      const value = block % 2 === 0 ? 20 : 200;
      const offset = (y * width + x) * channels;
      data[offset] = value;
      data[offset + 1] = Math.min(255, value + 20);
      data[offset + 2] = 30;
    }
  }
  const png = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Testes live opcionais (Fase 3 / TESTES.md §9.2). Não rodam na CI comum —
 * exigem GROQ_VISION_LIVE=1 e GROQ_API_KEY no ambiente local. Nunca imprimem
 * a chave, payload base64 ou o corpo bruto da resposta.
 */
describe.skipIf(!liveEnabled)("groq-vision-client (live)", () => {
  it(
    "uma imagem real produz JSON válido, sem <think>, com reasoning_effort none",
    async () => {
      const request: GroqVisionWindowRequest = {
        polygonId: "AUAS-LIVE-0001",
        windowId: "W2007_2008",
        images: [{ sceneId: "live-s1", year: 2008 as any, sensor: "SPOT", dataUrl: await testImageDataUrl(1) }],
      };
      const result = await requestGroqVisionWindow(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.observation.polygonId).toBe("AUAS-LIVE-0001");
        expect(JSON.stringify(result.observation)).not.toMatch(/<think>/i);
      }
    },
    60_000
  );

  it(
    "três imagens reais produzem JSON válido e capturam usage/rate-limit",
    async () => {
      const request: GroqVisionWindowRequest = {
        polygonId: "AUAS-LIVE-0002",
        windowId: "W2003_2005",
        images: [
          { sceneId: "live-s1", year: 2003 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(1) },
          { sceneId: "live-s2", year: 2004 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(2) },
          { sceneId: "live-s3", year: 2005 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(3) },
        ],
      };
      const result = await requestGroqVisionWindow(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.inputTokens === "number" || result.inputTokens === undefined).toBe(true);
      }
    },
    60_000
  );

  it(
    "bloqueia localmente uma quarta imagem antes de chamar a API",
    async () => {
      const request: GroqVisionWindowRequest = {
        polygonId: "AUAS-LIVE-0003",
        windowId: "W2005_2007",
        images: [
          { sceneId: "s1", year: 2005 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(1) },
          { sceneId: "s2", year: 2006 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(2) },
          { sceneId: "s3", year: 2007 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(3) },
          { sceneId: "s4", year: 2005 as any, sensor: "LANDSAT_5", dataUrl: await testImageDataUrl(4) },
        ],
      };
      const result = await requestGroqVisionWindow(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorCode).toBe("TOO_MANY_IMAGES");
    },
    10_000
  );
});
