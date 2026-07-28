import { describe, expect, it } from "vitest";
import { decimalToDms, formatDistance, formatDmsPair } from "./coords";

describe("croqui coords", () => {
  it("formata DMS no padrão SEMA", () => {
    expect(decimalToDms(-12.5900389, "lat")).toBe(`12°35'24.14"S`);
    expect(decimalToDms(-52.2196222, "lon")).toBe(`52°13'10.64"O`);
  });

  it("formata par DMS com parênteses", () => {
    expect(formatDmsPair(-52.2196222, -12.5900389)).toContain("12°35'");
    expect(formatDmsPair(-52.2196222, -12.5900389)).toContain("52°13'");
  });

  it("formata distâncias em km e metros", () => {
    expect(formatDistance(10700)).toBe("10.7 km");
    expect(formatDistance(298)).toBe("298 m");
  });
});
