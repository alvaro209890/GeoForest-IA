import { describe, expect, it } from "vitest";
import { buildRgbMergeArgs } from "./compositions";

describe("composição multibanda RGB/SWIR", () => {
  it("mantém cada raster de entrada em uma banda separada", () => {
    const args = buildRgbMergeArgs("merged.tif", ["red.tif", "green.tif", "blue.tif"]);
    expect(args[0]).toBe("-separate");
    expect(args.slice(-3)).toEqual(["red.tif", "green.tif", "blue.tif"]);
  });
});
