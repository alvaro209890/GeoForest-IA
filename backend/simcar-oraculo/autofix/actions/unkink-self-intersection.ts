import { unkinkPolygon as turfUnkink } from "@turf/turf";
import type { Feature, Polygon } from "geojson";

import { recordToGeoJSON } from "../../../geometry-errors";
import { geojsonToPolyRecords } from "../../../shapefile-writer";
import type { LayerAction } from "../types";
import {
  cloneRecord,
  createIdentifierAllocator,
  hasProperSelfIntersection,
} from "./helpers";

export const unkinkSelfIntersection: LayerAction = context => {
  const allocator = createIdentifierAllocator(
    context.records,
    context.dbfSchema
  );
  const affectedFeatures: number[] = [];
  const output = [];
  let recordsCreated = 0;

  for (const source of context.records) {
    const record = cloneRecord(source);
    if (!record.rings.some(hasProperSelfIntersection)) {
      output.push(record);
      continue;
    }
    const geometry = recordToGeoJSON({
      feature: source.sourceFeature,
      rings: record.rings,
    });
    if (!geometry) {
      throw new Error(
        `Autofix recusado: geometria vazia em ${context.layerName} feição ${source.sourceFeature}.`
      );
    }
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates;
    const pieces: number[][][][] = [];
    for (const coordinates of polygons) {
      const feature: Feature<Polygon> = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates },
      };
      const result = turfUnkink(feature as any);
      for (const piece of result.features || []) {
        if (piece.geometry?.type !== "Polygon") continue;
        for (const converted of geojsonToPolyRecords(piece.geometry))
          pieces.push(converted.rings);
      }
    }
    if (
      !pieces.length ||
      pieces.some(rings => rings.some(hasProperSelfIntersection))
    ) {
      throw new Error(
        `Autofix recusado: unkink não produziu polígonos simples em ${context.layerName} feição ${source.sourceFeature}.`
      );
    }
    affectedFeatures.push(source.sourceFeature);
    pieces.forEach((rings, partIndex) => {
      output.push({
        sourceFeature: source.sourceFeature,
        rings,
        attributes:
          partIndex === 0
            ? { ...record.attributes }
            : allocator.cloneForExtra(record.attributes),
      });
    });
    recordsCreated += Math.max(0, pieces.length - 1);
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
