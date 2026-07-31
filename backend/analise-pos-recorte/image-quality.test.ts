import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  classifySceneUsability,
  detectCloudCover,
  detectUniformImage,
  validateImageMagicBytes,
} from "./image-quality";

async function solidColorPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function noisyPng(): Promise<Buffer> {
  const width = 64;
  const height = 48;
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i++) {
    // padrão determinístico de alto contraste (xadrez), não aleatório
    data[i] = (i * 37) % 256 < 128 ? 10 : 245;
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function brightUniformPng(): Promise<Buffer> {
  return solidColorPng(245, 245, 245);
}

describe("validateImageMagicBytes", () => {
  it("aceita PNG válido", async () => {
    const buf = await solidColorPng(10, 10, 10);
    expect(validateImageMagicBytes(buf)).toEqual({ valid: true, format: "png" });
  });

  it("rejeita HTML/XML de erro com HTTP 200 (buffer não é imagem)", () => {
    const htmlBuf = Buffer.from("<?xml version=\"1.0\"?><ServiceExceptionReport/>");
    expect(validateImageMagicBytes(htmlBuf)).toEqual({ valid: false, format: null });
  });

  it("rejeita buffer vazio ou pequeno demais", () => {
    expect(validateImageMagicBytes(Buffer.alloc(0))).toEqual({ valid: false, format: null });
    expect(validateImageMagicBytes(Buffer.from([0x89, 0x50]))).toEqual({ valid: false, format: null });
  });
});

describe("detectUniformImage", () => {
  it("classifica cor sólida como uniforme/sem dado", async () => {
    const buf = await solidColorPng(120, 120, 120);
    const result = await detectUniformImage(buf);
    expect(result.isUniform).toBe(true);
  });

  it("classifica imagem com variação como não uniforme", async () => {
    const buf = await noisyPng();
    const result = await detectUniformImage(buf);
    expect(result.isUniform).toBe(false);
  });
});

describe("detectCloudCover", () => {
  it("detecta imagem clara/homogênea como possivelmente nublada", async () => {
    const buf = await brightUniformPng();
    const result = await detectCloudCover(buf);
    expect(result.cloudScore).toBeGreaterThan(0.3);
  });

  it("não classifica imagem de alto contraste como nublada", async () => {
    const buf = await noisyPng();
    const result = await detectCloudCover(buf);
    expect(result.isLikelyCloudy).toBe(false);
  });

  it("falha fechada (assume sem nuvem) em buffer inválido", async () => {
    const result = await detectCloudCover(Buffer.from("not an image"));
    expect(result).toEqual({ cloudScore: 0, isLikelyCloudy: false, brightPixelRatio: 0, contrastScore: 1 });
  });
});

describe("classifySceneUsability", () => {
  it("classifica formato inválido como INVALID", async () => {
    const result = await classifySceneUsability(Buffer.from("<html>error</html>"));
    expect(result.usability).toBe("INVALID");
    expect(result.qualityFlags).toContain("invalid_image_format");
  });

  it("classifica imagem uniforme/sem dado como INVALID", async () => {
    const buf = await solidColorPng(200, 200, 200);
    const result = await classifySceneUsability(buf);
    expect(result.usability).toBe("INVALID");
    expect(result.qualityFlags).toContain("uniform_no_data");
  });

  it("classifica imagem com variação como USABLE por padrão", async () => {
    const buf = await noisyPng();
    const result = await classifySceneUsability(buf);
    expect(result.usability).toBe("USABLE");
    expect(result.qualityFlags).toEqual([]);
  });

  it("classifica como LOW_RESOLUTION quando fallback de resolução foi usado", async () => {
    const buf = await noisyPng();
    const result = await classifySceneUsability(buf, { usedResolutionFallback: true });
    expect(result.usability).toBe("LOW_RESOLUTION");
  });
});
