/**
 * Realce para 8 bits: estatísticas por banda e corte média ± N·σ.
 */
import { CBERS_STRETCH_APPROX, CBERS_STRETCH_MODE, CBERS_STRETCH_SIGMA } from "./constants";
import { runCommandCapture } from "./gdal";

export type BandStat = { minimum: number; maximum: number; mean: number; stdDev: number };

export function parseBandStats(info: any): BandStat[] {
  const bands = Array.isArray(info?.bands) ? info.bands : [];
  return bands.map((band: any) => ({
    minimum: Number(band?.minimum),
    maximum: Number(band?.maximum),
    mean: Number(band?.mean),
    stdDev: Number(band?.stdDev),
  }));
}

// Builds the gdal_translate `-scale` arguments for the byte conversion. Returns null when
// stats are unavailable (or mode is "minmax") so the caller falls back to the plain `-scale`
// behaviour. In every mode the output floor is 0 and the low cut is clamped to >= 0, so
// source border pixels (value 0) keep mapping to 0 and stay transparent via `-a_nodata 0`.
export async function computeByteStretchArgs(rawPath: string, jobId: string): Promise<string[] | null> {
  if (CBERS_STRETCH_MODE === "minmax") return null;
  let stats: BandStat[];
  try {
    const flag = CBERS_STRETCH_APPROX ? "-approx_stats" : "-stats";
    const output = await runCommandCapture("gdalinfo", ["-json", flag, rawPath], jobId);
    stats = parseBandStats(JSON.parse(output));
  } catch {
    return null;
  }
  if (stats.length < 3) return null;
  const bands = stats.slice(0, 3);
  if (bands.some((s) => ![s.minimum, s.maximum, s.mean, s.stdDev].every(Number.isFinite))) {
    return null;
  }

  if (CBERS_STRETCH_MODE === "perband" || CBERS_STRETCH_MODE === "sigma") {
    // Independent stretch per band: max contrast, but changes the colour balance.
    const args: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const s = bands[i];
      let lo = Math.max(s.minimum, s.mean - CBERS_STRETCH_SIGMA * s.stdDev);
      let hi = Math.min(s.maximum, s.mean + CBERS_STRETCH_SIGMA * s.stdDev);
      if (!(hi > lo)) {
        lo = s.minimum;
        hi = s.maximum;
      }
      if (!(hi > lo)) return null;
      lo = Math.max(0, lo);
      args.push(`-scale_${i + 1}`, String(lo), String(hi), "0", "255");
    }
    return args;
  }

  // Default "global" (colour-preserving): one shared [lo, hi] for all three bands, so the
  // ratio between bands (the hue) is unchanged — only brightness/contrast improve. lo is the
  // darkest real value across bands; hi is the brightest band's mean + N*stdDev, which keeps
  // the dominant band (e.g. NIR over vegetation) reaching the top of the range so the scene
  // keeps its familiar green-dominant 342 look while no longer washing out dark.
  let lo = Math.max(0, Math.min(...bands.map((s) => s.minimum)));
  let hi = Math.max(...bands.map((s) => Math.min(s.maximum, s.mean + CBERS_STRETCH_SIGMA * s.stdDev)));
  if (!(hi > lo)) {
    hi = Math.max(...bands.map((s) => s.maximum));
  }
  if (!(hi > lo)) return null;
  return ["-scale", String(lo), String(hi), "0", "255"];
}
