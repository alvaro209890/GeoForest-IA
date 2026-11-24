import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { prepareFoto } from "./photos";

describe("prepareFoto", () => {
  it("lê data URL e marca paisagem quando a largura é maior", async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 16, channels: 3, background: "#226633" },
    })
      .jpeg()
      .toBuffer();
    const foto = await prepareFoto(
      {
        id: "f1",
        nome: "campo.jpg",
        base64: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      },
      "docx",
    );
    expect(foto.orientation).toBe("landscape");
    expect(foto.width).toBeGreaterThan(foto.height);
    expect(foto.jpeg.length).toBeGreaterThan(100);
  });
});
