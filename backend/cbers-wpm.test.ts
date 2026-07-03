import { describe, expect, it } from "vitest";
import type { CbersArchiveRecord } from "./cbers-archive";
import { assertCbersL4GenerationItem, buildReusedCbersSceneState } from "./cbers-wpm";

describe("CBERS WPM generation guard", () => {
  it("accepts L4 scenes", () => {
    expect(() => assertCbersL4GenerationItem("CBERS_4A_WPM_20260110_214_128_L4")).not.toThrow();
  });

  it("rejects L2 scenes before generation starts", () => {
    expect(() => assertCbersL4GenerationItem("CBERS_4A_WPM_20260110_214_128_L2")).toThrow(
      /restrita a cenas L4/,
    );
  });

  it("maps an existing archive record to a completed reusable WMS scene", () => {
    const record: CbersArchiveRecord = {
      imageId: "214_128_2026_cbers_4a_wpm_20260110_214_128_l4_c342_pan_jd3d1e4a6",
      uid: "original-user",
      jobId: "original-job",
      itemId: "CBERS_4A_WPM_20260110_214_128_L4",
      level: "L4",
      orbit: "214_128",
      year: "2026",
      sourceFilename: "CBERS_4A_WPM_20260110_214_128_L4_C342_PAN.TIF",
      archiveFilename: "CBERS_4A_WPM_20260110_214_128_L4_C342_PAN_JD3D1E4A6.TIF",
      hdRelativePath: "214_128/2026/CBERS_4A_WPM_20260110_214_128_L4_C342_PAN_JD3D1E4A6.TIF",
      hdPath:
        "/media/server/HD Backup/RASTER/CBERS_4A/214_128/2026/CBERS_4A_WPM_20260110_214_128_L4_C342_PAN_JD3D1E4A6.TIF",
      bytes: 123456,
      publicUrl:
        "/api/raster/214_128/2026/CBERS_4A_WPM_20260110_214_128_L4_C342_PAN_JD3D1E4A6.TIF",
      wmsLayerName: "cbers:214_128_2026_cbers_4a_wpm_20260110_214_128_l4_c342_pan_jd3d1e4a6",
      wmsStoreName: "214_128_2026_cbers_4a_wpm_20260110_214_128_l4_c342_pan_jd3d1e4a6",
      wmsPublicUrl: "https://wms.cursar.space/geoserver/cbers/wms?service=WMS&version=1.3.0&request=GetCapabilities",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const state = buildReusedCbersSceneState(record);

    expect(state.status).toBe("completed");
    expect(state.percent).toBe(100);
    expect(state.archiveImageId).toBe(record.imageId);
    expect(state.wmsLayerName).toBe(record.wmsLayerName);
    expect(state.wmsDownloadUrl).toBe(`/api/cbers-wpm/wms-download?imageId=${record.imageId}`);
    expect(state.message).toContain("reaproveitado");
  });
});
