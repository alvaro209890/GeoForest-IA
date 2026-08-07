import { afterEach, describe, expect, it } from "vitest";

import { hydrateCachedJob } from "./hydration";
import { jobCache } from "./clip-pipeline";

const cached = {
  uid: "owner-a",
  expiresAt: Date.now() + 60_000,
  filename: "recorte.zip",
  bbox: [0, 0, 1, 1] as [number, number, number, number],
  polygon: {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  },
  layerSummaries: [],
  clippedGeometries: new Map(),
};

afterEach(() => {
  jobCache.delete("hydration-security-job");
});

describe("hydrateCachedJob ownership", () => {
  it("does not reuse another user's cache or a client URL", async () => {
    jobCache.set("hydration-security-job", cached as any);

    await expect(
      hydrateCachedJob(
        "hydration-security-job",
        "http://127.0.0.1:9/private-context.json",
        undefined,
        "owner-b",
      ),
    ).resolves.toBeUndefined();
  });

  it("reuses only the cache owned by the authenticated user", async () => {
    jobCache.set("hydration-security-job", cached as any);
    await expect(hydrateCachedJob("hydration-security-job", undefined, undefined, "owner-a")).resolves.toBe(cached);
  });
});
