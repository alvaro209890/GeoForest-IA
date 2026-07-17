import {
  metricProjDefFor,
  ringsSharedBoundaryLengthM,
  SIMCAR_RING_SHARED_EDGE_M,
  SIMCAR_RING_SHARED_EDGE_TOL_M,
} from "../../../geometry-errors";
import type { ParsedPolygonRecord } from "../../../vertices-proximas";
import type { LayerAction } from "../types";
import {
  cloneRecord,
  containingExteriorIndex,
  exteriorRingIndexes,
} from "./helpers";

export const removeGluedHoles: LayerAction = context => {
  const parsed: ParsedPolygonRecord[] = context.records.map(
    (record, index) => ({
      feature: index + 1,
      rings: record.rings,
    })
  );
  const metricProjection = metricProjDefFor(context.crs, parsed);
  const affectedFeatures: number[] = [];
  const output = [];
  let ringsRemoved = 0;

  for (const source of context.records) {
    const record = cloneRecord(source);
    const exteriors = exteriorRingIndexes(record.rings);
    if (!exteriors.length) {
      output.push(record);
      continue;
    }
    const exteriorSet = new Set(exteriors);
    const removed = new Set<number>();
    for (let index = 0; index < record.rings.length; index += 1) {
      if (exteriorSet.has(index)) continue;
      const exteriorIndex = containingExteriorIndex(
        record.rings,
        index,
        exteriors
      );
      if (exteriorIndex === null) continue;
      const hole = record.rings[index];
      const exterior = record.rings[exteriorIndex];
      const sharedForward = ringsSharedBoundaryLengthM(
        hole,
        exterior,
        metricProjection,
        SIMCAR_RING_SHARED_EDGE_TOL_M,
        context.crs
      );
      const sharedReverse =
        sharedForward >= SIMCAR_RING_SHARED_EDGE_M
          ? sharedForward
          : ringsSharedBoundaryLengthM(
              exterior,
              hole,
              metricProjection,
              SIMCAR_RING_SHARED_EDGE_TOL_M,
              context.crs
            );
      if (Math.max(sharedForward, sharedReverse) >= SIMCAR_RING_SHARED_EDGE_M)
        removed.add(index);
    }
    if (removed.size) {
      affectedFeatures.push(source.sourceFeature);
      ringsRemoved += removed.size;
      record.rings = record.rings.filter((_ring, index) => !removed.has(index));
    }
    output.push(record);
  }

  const changed = affectedFeatures.length > 0;
  return {
    records: changed ? output : context.records.map(cloneRecord),
    changed,
    affectedFeatures,
    metrics: { ringsRemoved },
  };
};
