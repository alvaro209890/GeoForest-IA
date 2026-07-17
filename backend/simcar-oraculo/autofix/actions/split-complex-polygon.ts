import type { LayerAction } from "../types";
import {
  cloneRecord,
  containingExteriorIndex,
  createIdentifierAllocator,
  exteriorRingIndexes,
} from "./helpers";

export const splitComplexPolygon: LayerAction = context => {
  const allocator = createIdentifierAllocator(
    context.records,
    context.dbfSchema
  );
  const affectedFeatures: number[] = [];
  const output = [];
  let recordsCreated = 0;

  for (const source of context.records) {
    const record = cloneRecord(source);
    const exteriors = exteriorRingIndexes(record.rings);
    if (exteriors.length <= 1) {
      output.push(record);
      continue;
    }
    const exteriorSet = new Set(exteriors);
    const holesByExterior = new Map(
      exteriors.map(index => [index, [] as number[][][]])
    );
    for (let index = 0; index < record.rings.length; index += 1) {
      if (exteriorSet.has(index)) continue;
      const exterior = containingExteriorIndex(record.rings, index, exteriors);
      if (exterior === null) {
        throw new Error(
          `Autofix recusado: ${context.layerName} feição ${source.sourceFeature} tem buraco sem exterior inequívoco.`
        );
      }
      holesByExterior.get(exterior)!.push(record.rings[index]);
    }
    affectedFeatures.push(source.sourceFeature);
    exteriors.forEach((exteriorIndex, partIndex) => {
      output.push({
        sourceFeature: source.sourceFeature,
        rings: [
          record.rings[exteriorIndex],
          ...(holesByExterior.get(exteriorIndex) || []),
        ],
        attributes:
          partIndex === 0
            ? { ...record.attributes }
            : allocator.cloneForExtra(record.attributes),
      });
    });
    recordsCreated += exteriors.length - 1;
  }

  const changed = affectedFeatures.length > 0;
  return {
    records: changed ? output : context.records.map(cloneRecord),
    changed,
    affectedFeatures,
    metrics: {
      recordsCreated,
      identifiersCreated: allocator.generatedCount(),
    },
  };
};
