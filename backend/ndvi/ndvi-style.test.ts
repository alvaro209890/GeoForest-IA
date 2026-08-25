/**
 * Trava a consistência entre as duas representações da rampa NDVI:
 *   - `ndvi_ramp.clr` alimenta o `gdaldem color-relief` (figura do laudo)
 *   - `ndvi_ramp.sld` alimenta o GeoServer (camada Float32 no WMS)
 * Se divergirem, o mapa do Word e a camada do WMS mostram cores diferentes para o
 * mesmo valor — constrangedor num laudo técnico, e invisível sem este teste.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { NDVI_COLOR_RAMP_PATH, NDVI_SLD_PATH } from "./constants";

type Entrada = { valor: number; hex: string; alpha: number };

function lerClr(): Entrada[] {
  const texto = fs.readFileSync(NDVI_COLOR_RAMP_PATH, "utf8");
  const saida: Entrada[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const partes = limpa.split(/\s+/);
    if (partes[0] === "nv") continue;
    const valor = Number(partes[0]);
    if (!Number.isFinite(valor)) continue;
    const [r, g, b] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
    const alpha = partes[4] === undefined ? 255 : Number(partes[4]);
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    saida.push({ valor, hex, alpha });
  }
  return saida;
}

function lerSld(): Entrada[] {
  const xml = fs.readFileSync(NDVI_SLD_PATH, "utf8");
  const saida: Entrada[] = [];
  const re = /<ColorMapEntry\s+color="([^"]+)"\s+quantity="([^"]+)"(?:\s+opacity="([^"]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    saida.push({
      valor: Number(m[2]),
      hex: m[1].toUpperCase(),
      alpha: Math.round((m[3] === undefined ? 1 : Number(m[3])) * 255),
    });
  }
  return saida;
}

describe("rampa NDVI: .clr e .sld são a mesma paleta", () => {
  const clr = lerClr();
  const sld = lerSld();

  it("os dois arquivos existem e têm entradas", () => {
    expect(clr.length).toBeGreaterThan(5);
    expect(sld.length).toBeGreaterThan(5);
  });

  it("mesma quantidade de paradas", () => {
    expect(sld.length).toBe(clr.length);
  });

  it("cada parada tem o mesmo valor e a mesma cor nos dois", () => {
    for (let i = 0; i < clr.length; i += 1) {
      expect(sld[i].valor, `parada ${i} (valor)`).toBeCloseTo(clr[i].valor, 6);
      expect(sld[i].hex, `parada ${i} (cor) em NDVI=${clr[i].valor}`).toBe(clr[i].hex);
    }
  });

  it("o nodata (-9999) é transparente nos dois", () => {
    expect(clr[0].valor).toBe(-9999);
    expect(clr[0].alpha).toBe(0);
    expect(sld[0].valor).toBe(-9999);
    expect(sld[0].alpha).toBe(0);
  });

  it("cobre a escala inteira de -1 a 1", () => {
    const valores = clr.filter((e) => e.valor > -100).map((e) => e.valor);
    expect(Math.min(...valores)).toBe(-1);
    expect(Math.max(...valores)).toBe(1);
  });

  it("valores em ordem crescente", () => {
    for (let i = 1; i < clr.length; i += 1) {
      expect(clr[i].valor).toBeGreaterThan(clr[i - 1].valor);
    }
  });

  it("vai de marrom (baixo) a verde (alto) — a rampa da reunião", () => {
    const marrom = clr.find((e) => e.valor === -1)!;
    const verde = clr.find((e) => e.valor === 1)!;
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [rM, gM, bM] = rgb(marrom.hex);
    const [rV, gV, bV] = rgb(verde.hex);
    expect(rM).toBeGreaterThan(bM); // marrom: vermelho domina o azul
    expect(gV).toBeGreaterThan(rV); // verde: verde domina o vermelho
    expect(gV).toBeGreaterThan(bV);
  });

  it("o SLD declara o nome que o backend usa", () => {
    const xml = fs.readFileSync(NDVI_SLD_PATH, "utf8");
    expect(xml).toContain("<Name>ndvi_ramp</Name>");
  });
});
