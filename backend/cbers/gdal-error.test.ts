import { describe, expect, it } from "vitest";
import { formatCommandFailure } from "./gdal";

describe("formatCommandFailure", () => {
  it("preserva a causa no início e o contexto no fim de uma saída longa", () => {
    const output = `ERROR 1: causa real\n${"progresso".repeat(1000)}\nusage final`;
    const message = formatCommandFailure("gdal_translate", 1, output);
    expect(message).toContain("ERROR 1: causa real");
    expect(message).toContain("saída intermediária omitida");
    expect(message).toContain("usage final");
  });
});
