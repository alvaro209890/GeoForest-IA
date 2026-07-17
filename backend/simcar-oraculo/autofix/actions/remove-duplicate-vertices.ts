import { SIMCAR_IMPORT_DUP_TOLERANCE_M } from "../../../geometry-errors";
import type { LayerAction } from "../types";
import {
  cloneRecord,
  createMetricBridge,
  ensureClosed,
  metricDistance,
  openRing,
  removeOrphanedHoleIndexes,
} from "./helpers";

export const removeDuplicateVertices: LayerAction = context => {
  const bridge = createMetricBridge(context.records, context.crs);
  let verticesRemoved = 0;
  let ringsRemoved = 0;
  let recordsDropped = 0;
  const affectedFeatures: number[] = [];
  const output = [];

  for (const source of context.records) {
    const record = cloneRecord(source);
    const cleanedByIndex = new Map<number, number[][]>();
    const retainedIndexes = new Set<number>();
    let recordChanged = false;
    for (let ringIndex = 0; ringIndex < record.rings.length; ringIndex += 1) {
      const sourceRing = record.rings[ringIndex];
      const input = openRing(sourceRing);
      const cleaned: number[][] = [];
      let ringChanged = false;
      for (const point of input) {
        const previous = cleaned[cleaned.length - 1];
        if (
          previous &&
          metricDistance(previous, point, bridge) <=
            SIMCAR_IMPORT_DUP_TOLERANCE_M
        ) {
          verticesRemoved += 1;
          ringChanged = true;
          continue;
        }
        cleaned.push([...point]);
      }
      if (
        cleaned.length > 1 &&
        metricDistance(cleaned[0], cleaned[cleaned.length - 1], bridge) <=
          SIMCAR_IMPORT_DUP_TOLERANCE_M
      ) {
        cleaned.pop();
        verticesRemoved += 1;
        ringChanged = true;
      }
      if (cleaned.length < 3) {
        ringsRemoved += 1;
        recordChanged = true;
        continue;
      }
      retainedIndexes.add(ringIndex);
      cleanedByIndex.set(
        ringIndex,
        ringChanged
          ? ensureClosed(cleaned)
          : sourceRing.map(point => [...point])
      );
      recordChanged ||= ringChanged;
    }
    const safeIndexes = removeOrphanedHoleIndexes(
      record.rings,
      retainedIndexes
    );
    ringsRemoved += retainedIndexes.size - safeIndexes.size;
    recordChanged ||= retainedIndexes.size !== safeIndexes.size;
    const rings = [...safeIndexes]
      .sort((a, b) => a - b)
      .map(index => cleanedByIndex.get(index)!);
    if (!rings.length) {
      recordsDropped += 1;
      affectedFeatures.push(source.sourceFeature);
      continue;
    }
    if (recordChanged) affectedFeatures.push(source.sourceFeature);
    output.push({ ...record, rings });
  }

  const changed = affectedFeatures.length > 0;
  return {
    records: changed ? output : context.records.map(cloneRecord),
    changed,
    affectedFeatures,
    metrics: { verticesRemoved, ringsRemoved, recordsDropped },
  };
};
