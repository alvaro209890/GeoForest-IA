import {
  SIMCAR_IMPORT_COLLAPSE_AREA_M2,
  SIMCAR_IMPORT_COLLAPSE_WIDTH_M,
} from "../../../geometry-errors";
import type { LayerAction } from "../types";
import {
  cloneRecord,
  createMetricBridge,
  openRing,
  removeOrphanedHoleIndexes,
  ringAreaM2,
  ringMinWidthM,
} from "./helpers";

export const cleanDegenerateRings: LayerAction = context => {
  const bridge = createMetricBridge(context.records, context.crs);
  const affectedFeatures: number[] = [];
  const output = [];
  let ringsRemoved = 0;
  let recordsDropped = 0;

  for (const source of context.records) {
    const record = cloneRecord(source);
    const retainedIndexes = new Set<number>();
    record.rings.forEach((ring, index) => {
      const distinct = new Set(
        openRing(ring).map(point => `${point[0]}:${point[1]}`)
      ).size;
      const degenerate =
        distinct < 3 ||
        ringAreaM2(ring, bridge) <= SIMCAR_IMPORT_COLLAPSE_AREA_M2 ||
        ringMinWidthM(ring, bridge) <= SIMCAR_IMPORT_COLLAPSE_WIDTH_M;
      if (degenerate) ringsRemoved += 1;
      else retainedIndexes.add(index);
    });
    const safeIndexes = removeOrphanedHoleIndexes(
      record.rings,
      retainedIndexes
    );
    ringsRemoved += retainedIndexes.size - safeIndexes.size;
    const kept = [...safeIndexes]
      .sort((a, b) => a - b)
      .map(index => record.rings[index]);
    if (kept.length !== record.rings.length)
      affectedFeatures.push(source.sourceFeature);
    if (!kept.length) {
      recordsDropped += 1;
      continue;
    }
    output.push({ ...record, rings: kept });
  }

  const changed = affectedFeatures.length > 0;
  return {
    records: changed ? output : context.records.map(cloneRecord),
    changed,
    affectedFeatures,
    metrics: { ringsRemoved, recordsDropped },
  };
};
