import { describe, expect, it } from "vitest";
import {
  buildLandsatOutputFilename,
  landsatAssetKeysForComposition,
  parseLandsatLayerName,
  parseLandsatStacId,
  planetaryComputerItemIdFromLandsatId,
} from "./landsat";

describe("Landsat helpers", () => {
  it("parses existing GeoServer Landsat layer names", () => {
    const parsed = parseLandsatLayerName("landsat_224_069_2020_lc08_224_069_20200907_comp654");

    expect(parsed).toMatchObject({
      path: "224",
      row: "069",
      orbit: "224_069",
      year: "2020",
      date: "20200907",
      platform: "landsat-8",
      composition: "false_color",
      compositionLabel: "C654",
    });
  });

  it("parses USGS STAC item ids", () => {
    const parsed = parseLandsatStacId("LC08_L2SP_225070_20200930_20201007_02_T1_SR");

    expect(parsed).toMatchObject({
      path: "225",
      row: "070",
      orbit: "225_070",
      year: "2020",
      date: "20200930",
      platform: "landsat-8",
    });
  });

  it("uses semantic STAC assets for natural and false color composites", () => {
    expect(landsatAssetKeysForComposition("false_color")).toEqual(["swir16", "nir08", "red"]);
    expect(landsatAssetKeysForComposition("natural_color")).toEqual(["red", "green", "blue"]);
  });

  it("builds a composition-specific output filename", () => {
    expect(buildLandsatOutputFilename("LC09_L2SP_224069_20230722_20230802_02_T1_SR", "false_color"))
      .toBe("LC09_L2SP_224069_20230722_20230802_02_T1_C654.TIF");
  });

  it("maps USGS Collection 2 item ids to Planetary Computer item ids", () => {
    expect(planetaryComputerItemIdFromLandsatId("LC08_L2SP_225070_20200930_20201007_02_T1_SR"))
      .toBe("LC08_L2SP_225070_20200930_02_T1");
    expect(planetaryComputerItemIdFromLandsatId("LC08_L2SP_225070_20200930_02_T1"))
      .toBe("LC08_L2SP_225070_20200930_02_T1");
  });
});
