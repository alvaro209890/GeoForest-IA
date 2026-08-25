import { describe, expect, it } from "vitest";
import {
  buildGdalCalcExpression,
  classifyNdvi,
  dnToReflectance,
  formatNdvi,
  ndviFromDn,
  ndviFromDnWrong,
  ndviFromReflectance,
  qaMaskForPlatform,
  qaPixelIsMasked,
} from "./ndvi-math";
import { NDVI_QA_CIRRUS_BIT } from "./constants";

describe("conversão DN → reflectância (Landsat C2 L2 SR)", () => {
  it("aplica escala e offset do produto", () => {
    // ρ = DN * 0.0000275 - 0.2
    expect(dnToReflectance(10000)).toBeCloseTo(0.075, 6);
    expect(dnToReflectance(7273)).toBeCloseTo(0.0000275 * 7273 - 0.2, 6);
  });

  it("DN no meio da faixa válida cai em reflectância plausível (0–1)", () => {
    for (const dn of [7273, 12000, 20000, 30000, 43636]) {
      const r = dnToReflectance(dn);
      expect(r).toBeGreaterThan(-0.2);
      expect(r).toBeLessThan(1.3);
    }
  });
});

describe("NDVI a partir de reflectância", () => {
  it("bate com o valor calculado à mão", () => {
    // vegetação típica: NIR 0.35, RED 0.04 → (0.35-0.04)/(0.35+0.04) = 0.7948...
    expect(ndviFromReflectance(0.35, 0.04)).toBeCloseTo(0.31 / 0.39, 10);
  });

  it("devolve null quando o denominador é zero", () => {
    expect(ndviFromReflectance(0.2, -0.2)).toBeNull();
  });

  it("fica sempre em [-1, 1] para reflectâncias não negativas", () => {
    for (const nir of [0.01, 0.1, 0.3, 0.6]) {
      for (const red of [0.01, 0.05, 0.2, 0.5]) {
        const v = ndviFromReflectance(nir, red)!;
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("⚠️ o offset NÃO cancela na razão", () => {
  // Este bloco é a trava da armadilha mais cara da feature.
  // Se alguém "simplificar" a expressão removendo a conversão, ele falha.
  it("NDVI no DN cru DIFERE do NDVI correto", () => {
    const dnNir = 22000;
    const dnRed = 9000;
    const certo = ndviFromDn(dnNir, dnRed)!;
    const errado = ndviFromDnWrong(dnNir, dnRed)!;
    expect(certo).not.toBeCloseTo(errado, 2);
    // e a diferença é grande, não arredondamento
    expect(Math.abs(certo - errado)).toBeGreaterThan(0.1);
  });

  it("com offset zero os dois coincidem — prova que é o offset, não a escala", () => {
    const dnNir = 22000;
    const dnRed = 9000;
    const semOffset = ndviFromDn(dnNir, dnRed, 0.0000275, 0)!;
    const errado = ndviFromDnWrong(dnNir, dnRed)!;
    expect(semOffset).toBeCloseTo(errado, 10);
  });

  it("o erro varia com o brilho da cena (não é constante)", () => {
    const dif = (n: number, r: number) =>
      Math.abs(ndviFromDn(n, r)! - ndviFromDnWrong(n, r)!);
    const escuro = dif(12000, 8000);
    const claro = dif(34000, 22000);
    expect(Math.abs(escuro - claro)).toBeGreaterThan(0.01);
  });
});

describe("NDVI a partir de DN", () => {
  it("vegetação densa dá NDVI alto e solo exposto dá NDVI baixo", () => {
    // NIR alto / RED baixo → vegetação
    const vegetacao = ndviFromDn(28000, 8500)!;
    expect(vegetacao).toBeGreaterThan(0.6);
    // NIR ≈ RED → solo exposto
    const solo = ndviFromDn(16000, 15000)!;
    expect(solo).toBeLessThan(0.2);
  });

  it("DN 0 (nodata da borda) devolve null", () => {
    expect(ndviFromDn(0, 12000)).toBeNull();
    expect(ndviFromDn(12000, 0)).toBeNull();
    expect(ndviFromDn(0, 0)).toBeNull();
  });

  it("resultado fica em [-1, 1] em toda a faixa válida do produto", () => {
    for (const nir of [7273, 15000, 25000, 43636]) {
      for (const red of [7273, 15000, 25000, 43636]) {
        const v = ndviFromDn(nir, red)!;
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("máscara de nuvem (qa_pixel)", () => {
  it("L8/L9 incluem o bit de cirrus; L5/L7 não", () => {
    const l8 = qaMaskForPlatform("landsat-8");
    const l5 = qaMaskForPlatform("landsat-5");
    expect(l8 & NDVI_QA_CIRRUS_BIT).toBe(NDVI_QA_CIRRUS_BIT);
    expect(l5 & NDVI_QA_CIRRUS_BIT).toBe(0);
    expect(qaMaskForPlatform("LC09_L2SP_224069")).toBe(l8);
  });

  it("mascara nuvem, sombra e fill", () => {
    const mask = qaMaskForPlatform("landsat-5");
    expect(qaPixelIsMasked(0b1000, mask)).toBe(true); // cloud (bit 3)
    expect(qaPixelIsMasked(0b10000, mask)).toBe(true); // shadow (bit 4)
    expect(qaPixelIsMasked(0b1, mask)).toBe(true); // fill (bit 0)
    expect(qaPixelIsMasked(0b10, mask)).toBe(true); // dilated cloud (bit 1)
  });

  it("NÃO mascara água — água é informação (NDVI < 0)", () => {
    const mask = qaMaskForPlatform("landsat-5");
    expect(qaPixelIsMasked(0b10000000, mask)).toBe(false); // water (bit 7)
  });

  it("pixel limpo não é mascarado", () => {
    const mask = qaMaskForPlatform("landsat-8");
    expect(qaPixelIsMasked(0b1000000, mask)).toBe(false); // clear (bit 6)
  });
});

describe("expressão do gdal_calc", () => {
  it("aplica escala e offset antes de dividir", () => {
    const expr = buildGdalCalcExpression({ qaMask: 27 });
    expect(expr).toContain("0.0000275");
    expect(expr).toContain("-0.2");
    // a subtração do numerador é entre termos já convertidos
    expect(expr).toMatch(/\(\(A\.astype\(float32\)\*[\d.e-]+-0\.2\)-\(B\.astype/);
  });

  it("mascara nodata e QA", () => {
    const expr = buildGdalCalcExpression({ qaMask: 31 });
    expect(expr).toContain("(A<=0)|(B<=0)");
    expect(expr).toContain("bitwise_and(C.astype(uint16),31)");
    expect(expr).toContain("-9999");
  });

  it("sem qa_pixel a expressão não referencia C", () => {
    const expr = buildGdalCalcExpression({ qaMask: 27, comQa: false });
    expect(expr).not.toContain("C.astype");
    expect(expr).toContain("(A<=0)|(B<=0)");
  });

  it("evita divisão por zero sem mascarar o pixel", () => {
    expect(buildGdalCalcExpression({ qaMask: 27 })).toContain("==0,1e-10,");
  });
});

describe("classificação", () => {
  it("classifica as faixas do plano", () => {
    expect(classifyNdvi(-0.3)?.id).toBe("agua");
    expect(classifyNdvi(0.1)?.id).toBe("solo");
    expect(classifyNdvi(0.3)?.id).toBe("rala");
    expect(classifyNdvi(0.5)?.id).toBe("intermediaria");
    expect(classifyNdvi(0.7)?.id).toBe("arborea");
    expect(classifyNdvi(0.85)?.id).toBe("densa");
  });

  it("floresta estável (0,7–0,8) cai em arbórea/densa — calibração da reunião", () => {
    expect(["arborea", "densa"]).toContain(classifyNdvi(0.72)!.id);
    expect(["arborea", "densa"]).toContain(classifyNdvi(0.78)!.id);
  });

  it("NDVI = 1 e NDVI = -1 têm classe", () => {
    expect(classifyNdvi(1)).not.toBeNull();
    expect(classifyNdvi(-1)).not.toBeNull();
  });

  it("null/NaN não recebem classe", () => {
    expect(classifyNdvi(null)).toBeNull();
    expect(classifyNdvi(Number.NaN)).toBeNull();
  });
});

describe("formatação pt-BR", () => {
  it("usa vírgula decimal e duas casas", () => {
    expect(formatNdvi(0.7213)).toBe("0,72");
    expect(formatNdvi(-0.234)).toBe("-0,23");
  });
  it("valor ausente vira travessão", () => {
    expect(formatNdvi(null)).toBe("—");
  });
});
