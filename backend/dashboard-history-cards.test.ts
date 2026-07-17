import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression: modernização do frontend escondeu os cards de histórico
 * com `block lg:hidden xl:block` + sidebar lg:w-[72px]. Cards por aba
 * devem permanecer no Dashboard e legíveis em breakpoints desktop.
 */
describe("Dashboard history cards visibility", () => {
  const dashboardPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../client/src/pages/Dashboard.tsx",
  );
  const src = fs.readFileSync(dashboardPath, "utf8");

  it("mantém render de cards por aba com dados de histórico", () => {
    for (const needle of [
      "simcarClipHistory.map(",
      "cbersHistory.map(",
      "landsatHistory.map(",
      "verticesHistory.map(",
      "geometryHistory.map(",
      "processarHistory.map(",
      "receiptHistory.map(",
    ]) {
      expect(src.includes(needle), needle).toBe(true);
    }
  });

  it("não esconde texto dos cards no intervalo lg–xl", () => {
    expect(src.includes("lg:hidden xl:block")).toBe(false);
    expect(src.includes("lg:w-[72px]")).toBe(false);
    expect(src.includes("lg:w-80")).toBe(true);
  });
});
