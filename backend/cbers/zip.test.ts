import { describe, expect, it } from "vitest";
import { setWmsZipHeaders, zipFilenameForWmsImage } from "./zip";

describe("cbers WMS zip", () => {
  it("names the zip from the primary GeoTIFF stem", () => {
    expect(
      zipFilenameForWmsImage(
        [{ absolutePath: "/tmp/a.TIF", name: "CBERS_4A_WPM_20260115_213_129_L4_C342_PAN.TIF" }],
        "ignored",
      ),
    ).toBe("CBERS_4A_WPM_20260115_213_129_L4_C342_PAN.zip");
  });

  it("sets attachment headers so the browser downloads instead of navigating", () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    };
    setWmsZipHeaders(res as any, "folha.zip", [{ absolutePath: "/a", name: "a.tif" }]);
    expect(headers["Content-Type"]).toBe("application/zip");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="folha.zip"');
    expect(headers["X-CBERS-WMS-File-Count"]).toBe("1");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Accel-Buffering"]).toBe("no");
  });
});
