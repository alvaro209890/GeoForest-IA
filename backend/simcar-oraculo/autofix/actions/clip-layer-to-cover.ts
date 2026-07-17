import {
  difference as turfDifference,
  featureCollection,
  intersect as turfIntersect,
  union as turfUnion,
  unkinkPolygon as turfUnkink,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import { recordToGeoJSON } from "../../../geometry-errors";
import { recognizeSimcarLayer } from "../../../simcar-rules";
import { geojsonToPolyRecords } from "../../../shapefile-writer";
import type {
  AutofixPolygonRecord,
  LayerAction,
  LayerActionMetrics,
  LayerRewriteContext,
} from "../types";
import {
  cloneRecord,
  createIdentifierAllocator,
  createMetricBridge,
  ensureClosed,
  exteriorRingIndexes,
  metricDistance,
  openRing,
  removeOrphanedHoleIndexes,
  ringAreaM2,
  type MetricBridge,
} from "./helpers";

export const CLIP_COVER_LAYER_CODES = [
  "AVN",
  "AUAS",
  "AREA_CONSOLIDADA",
] as const;
export const CLIP_MIN_FRAGMENT_M2 = 100;

/** Residual aceito na união AVN∪AUAS∪CONS (m²). */
const RESIDUAL_TOLERANCE_M2 = 0.3;
/** Residual aceito contra um único host (m²) — SEMA costuma ser rígida na borda. */
const SINGLE_HOST_TOLERANCE_M2 = 1;

type PolygonFeature = Feature<Polygon | MultiPolygon>;
type CoverGeometry = {
  layerName: string;
  sourceFeature: number;
  feature: PolygonFeature;
  bbox: [number, number, number, number];
};

function asFeature(geometry: Polygon | MultiPolygon): PolygonFeature {
  return { type: "Feature", properties: {}, geometry };
}

function geometryBbox(
  geometry: Polygon | MultiPolygon,
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        minX = Math.min(minX, Number(coordinate[0]));
        minY = Math.min(minY, Number(coordinate[1]));
        maxX = Math.max(maxX, Number(coordinate[0]));
        maxY = Math.max(maxY, Number(coordinate[1]));
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxesTouch(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function crsKey(crs: LayerRewriteContext["crs"]): string | null {
  if (crs.kind === "unknown" || crs.missing) return null;
  if (crs.projDef) return `${crs.kind}:${crs.projDef.replace(/\s+/g, " ").trim()}`;
  if (crs.prjText) return `${crs.kind}:${crs.prjText.replace(/\s+/g, "").toUpperCase()}`;
  return null;
}

function polygonAreaM2(rings: number[][][], bridge: MetricBridge): number {
  if (!rings.length) return 0;
  return Math.max(
    0,
    ringAreaM2(rings[0], bridge) -
      rings.slice(1).reduce((sum, ring) => sum + ringAreaM2(ring, bridge), 0),
  );
}

function geometryAreaM2(
  geometry: Polygon | MultiPolygon,
  bridge: MetricBridge,
): number {
  return geojsonToPolyRecords(geometry).reduce(
    (sum, record) => sum + polygonAreaM2(record.rings, bridge),
    0,
  );
}

function intersectCoverage(args: {
  input: PolygonFeature;
  cover: PolygonFeature;
  targetFeature: number;
}): PolygonFeature | null {
  try {
    return turfIntersect(
      featureCollection([args.input, args.cover]) as any,
    ) as PolygonFeature | null;
  } catch (directError: any) {
    const polygons =
      args.input.geometry.type === "Polygon"
        ? [args.input.geometry.coordinates]
        : args.input.geometry.coordinates;
    let accumulated: PolygonFeature | null = null;
    try {
      for (const coordinates of polygons) {
        const source = asFeature({ type: "Polygon", coordinates });
        for (const piece of turfUnkink(source as any).features || []) {
          if (piece.geometry?.type !== "Polygon") continue;
          const intersection = turfIntersect(
            featureCollection([piece as any, args.cover]) as any,
          ) as PolygonFeature | null;
          if (!intersection?.geometry) continue;
          accumulated = accumulated
            ? (turfUnion(
                featureCollection([accumulated, intersection]) as any,
              ) as PolygonFeature | null)
            : intersection;
          if (!accumulated?.geometry) {
            throw new Error("união das partes retornou vazia");
          }
        }
      }
      return accumulated;
    } catch (fallbackError: any) {
      throw new Error(
        `Autofix recusado: interseção falhou em AREA_UMIDA feição ${args.targetFeature} ` +
          `(direta: ${directError?.message || directError}; contingência: ${fallbackError?.message || fallbackError}).`,
      );
    }
  }
}

function partitionByCoverage(args: {
  input: PolygonFeature;
  covers: CoverGeometry[];
  targetFeature: number;
}): { pieces: PolygonFeature[]; residual: PolygonFeature | null } {
  const sourceBbox = geometryBbox(args.input.geometry);
  let remaining: PolygonFeature | null = args.input;
  const pieces: PolygonFeature[] = [];
  for (const cover of args.covers) {
    if (!remaining || !bboxesTouch(sourceBbox, cover.bbox)) continue;
    const intersection = intersectCoverage({
      input: remaining,
      cover: cover.feature,
      targetFeature: args.targetFeature,
    });
    if (intersection?.geometry) pieces.push(intersection);
    try {
      remaining = turfDifference(
        featureCollection([remaining, cover.feature]) as any,
      ) as PolygonFeature | null;
    } catch (error: any) {
      throw new Error(
        `Autofix recusado: diferença falhou em AREA_UMIDA feição ${args.targetFeature} ` +
          `contra ${cover.layerName} feição ${cover.sourceFeature}: ${error?.message || error}`,
      );
    }
  }
  return { pieces, residual: remaining };
}

function subtractCoverage(args: {
  input: PolygonFeature;
  covers: CoverGeometry[];
  targetFeature: number;
}): PolygonFeature | null {
  const sourceBbox = geometryBbox(args.input.geometry);
  let remaining: PolygonFeature | null = args.input;
  for (const cover of args.covers) {
    if (!remaining || !bboxesTouch(sourceBbox, cover.bbox)) continue;
    try {
      remaining = turfDifference(
        featureCollection([remaining, cover.feature]) as any,
      ) as PolygonFeature | null;
    } catch (error: any) {
      throw new Error(
        `Autofix recusado: verificação de cobertura falhou na feição ${args.targetFeature} ` +
          `contra ${cover.layerName} feição ${cover.sourceFeature}: ${error?.message || error}`,
      );
    }
  }
  return remaining;
}

function unionPieces(
  pieces: PolygonFeature[],
  targetFeature: number,
): PolygonFeature | null {
  let accumulated: PolygonFeature | null = null;
  for (const piece of pieces) {
    if (!accumulated) {
      accumulated = piece;
      continue;
    }
    try {
      accumulated = turfUnion(
        featureCollection([accumulated, piece]) as any,
      ) as PolygonFeature | null;
    } catch (error: any) {
      throw new Error(
        `Autofix recusado: não foi possível dissolver o recorte de AREA_UMIDA feição ` +
          `${targetFeature}: ${error?.message || error}`,
      );
    }
    if (!accumulated?.geometry) {
      throw new Error(
        `Autofix recusado: dissolução vazia em AREA_UMIDA feição ${targetFeature}.`,
      );
    }
  }
  return accumulated;
}

function skippedTriangleIsCovered(args: {
  previous: number[];
  removed: number[];
  next: number[];
  covers: CoverGeometry[];
  bridge: MetricBridge;
  targetFeature: number;
}): boolean {
  const triangle = ensureClosed([args.previous, args.removed, args.next]);
  if (ringAreaM2(triangle, args.bridge) <= 0.000001) return true;
  const residual = subtractCoverage({
    input: asFeature({ type: "Polygon", coordinates: [triangle] }),
    covers: args.covers,
    targetFeature: args.targetFeature,
  });
  return (
    !residual?.geometry ||
    geometryAreaM2(residual.geometry, args.bridge) <= RESIDUAL_TOLERANCE_M2
  );
}

function removeDuplicateVerticesWithinCoverage(args: {
  records: AutofixPolygonRecord[];
  covers: CoverGeometry[];
  bridge: MetricBridge;
}): {
  records: AutofixPolygonRecord[];
  affectedFeatures: number[];
  metrics: Pick<LayerActionMetrics, "verticesRemoved" | "ringsRemoved">;
} {
  const output: AutofixPolygonRecord[] = [];
  const affectedFeatures: number[] = [];
  let verticesRemoved = 0;
  let ringsRemoved = 0;

  for (const source of args.records) {
    const record = cloneRecord(source);
    const exteriorIndexes = new Set(exteriorRingIndexes(record.rings));
    const cleanedByIndex = new Map<number, number[][]>();
    const retainedIndexes = new Set<number>();
    let recordChanged = false;

    record.rings.forEach((ring, ringIndex) => {
      const points = openRing(ring).map((point) => [...point]);
      let guard = 0;
      while (points.length >= 3 && guard < 10_000) {
        guard += 1;
        let pairIndex = -1;
        for (let index = 0; index < points.length; index += 1) {
          if (
            metricDistance(
              points[index],
              points[(index + 1) % points.length],
              args.bridge,
            ) <= 0.1
          ) {
            pairIndex = index;
            break;
          }
        }
        if (pairIndex < 0) break;

        const nextIndex = (pairIndex + 1) % points.length;
        let removeIndex = nextIndex;
        if (exteriorIndexes.has(ringIndex)) {
          const afterNextIndex = (nextIndex + 1) % points.length;
          const removeNextIsSafe = skippedTriangleIsCovered({
            previous: points[pairIndex],
            removed: points[nextIndex],
            next: points[afterNextIndex],
            covers: args.covers,
            bridge: args.bridge,
            targetFeature: source.sourceFeature,
          });
          if (!removeNextIsSafe) {
            const previousIndex =
              (pairIndex - 1 + points.length) % points.length;
            const removeCurrentIsSafe = skippedTriangleIsCovered({
              previous: points[previousIndex],
              removed: points[pairIndex],
              next: points[nextIndex],
              covers: args.covers,
              bridge: args.bridge,
              targetFeature: source.sourceFeature,
            });
            if (!removeCurrentIsSafe) {
              throw new Error(
                `Autofix recusado: limpar vértices próximos tiraria AREA_UMIDA feição ` +
                  `${source.sourceFeature}, anel ${ringIndex + 1}, da cobertura.`,
              );
            }
            removeIndex = pairIndex;
          }
        }
        points.splice(removeIndex, 1);
        verticesRemoved += 1;
        recordChanged = true;
      }
      if (guard >= 10_000) {
        throw new Error(
          `Autofix recusado: limpeza de vértices não convergiu na feição ${source.sourceFeature}.`,
        );
      }
      if (points.length < 3) {
        ringsRemoved += 1;
        recordChanged = true;
        return;
      }
      retainedIndexes.add(ringIndex);
      cleanedByIndex.set(
        ringIndex,
        recordChanged ? ensureClosed(points) : ring.map((point) => [...point]),
      );
    });

    const safeIndexes = removeOrphanedHoleIndexes(
      record.rings,
      retainedIndexes,
    );
    ringsRemoved += retainedIndexes.size - safeIndexes.size;
    recordChanged ||= retainedIndexes.size !== safeIndexes.size;
    const rings = [...safeIndexes]
      .sort((a, b) => a - b)
      .map((index) => cleanedByIndex.get(index)!);
    if (!rings.length) {
      affectedFeatures.push(source.sourceFeature);
      continue;
    }
    if (recordChanged) affectedFeatures.push(source.sourceFeature);
    output.push({ ...record, rings });
  }

  return {
    records: output,
    affectedFeatures,
    metrics: { verticesRemoved, ringsRemoved },
  };
}

function cleanAfterClip(
  records: AutofixPolygonRecord[],
  covers: CoverGeometry[],
  bridge: MetricBridge,
): {
  records: AutofixPolygonRecord[];
  affectedFeatures: number[];
  metrics: Pick<LayerActionMetrics, "verticesRemoved" | "ringsRemoved">;
  warnings: string[];
} {
  const cleaned = removeDuplicateVerticesWithinCoverage({
    records,
    covers,
    bridge,
  });
  return {
    records: cleaned.records,
    affectedFeatures: cleaned.affectedFeatures,
    metrics: cleaned.metrics,
    warnings: [],
  };
}

/**
 * SEMA exige contenção em UM host (AVN **ou** AUAS **ou** CONS), não só na união.
 * Uma feição que cruza dois hosts e volta unida como MultiPolygon ainda reprova.
 */
function residualAgainstCover(
  input: PolygonFeature,
  cover: PolygonFeature,
): PolygonFeature | null {
  try {
    return turfDifference(
      featureCollection([input, cover]) as any,
    ) as PolygonFeature | null;
  } catch {
    return input;
  }
}

function isContainedInSingleHost(args: {
  input: PolygonFeature;
  covers: CoverGeometry[];
  bridge: MetricBridge;
}): boolean {
  const sourceBbox = geometryBbox(args.input.geometry);
  for (const cover of args.covers) {
    if (!bboxesTouch(sourceBbox, cover.bbox)) continue;
    const residual = residualAgainstCover(args.input, cover.feature);
    const residualArea = residual?.geometry
      ? geometryAreaM2(residual.geometry, args.bridge)
      : 0;
    if (residualArea <= SINGLE_HOST_TOLERANCE_M2) return true;
  }
  return false;
}

function assertCovered(args: {
  records: AutofixPolygonRecord[];
  covers: CoverGeometry[];
  bridge: MetricBridge;
}): void {
  for (const record of args.records) {
    const geometry = recordToGeoJSON({
      feature: record.sourceFeature,
      rings: record.rings,
    });
    if (!geometry) {
      throw new Error(
        `Autofix recusado: geometria vazia após o recorte da feição ${record.sourceFeature}.`,
      );
    }
    const feature = asFeature(geometry);
    if (
      isContainedInSingleHost({
        input: feature,
        covers: args.covers,
        bridge: args.bridge,
      })
    ) {
      continue;
    }
    const residual = subtractCoverage({
      input: feature,
      covers: args.covers,
      targetFeature: record.sourceFeature,
    });
    const residualArea = residual?.geometry
      ? geometryAreaM2(residual.geometry, args.bridge)
      : 0;
    if (residualArea > RESIDUAL_TOLERANCE_M2) {
      throw new Error(
        `Autofix recusado: AREA_UMIDA feição ${record.sourceFeature} não ficou contida ` +
          `em AVN/AUAS/AREA_CONSOLIDADA (residual união ${residualArea.toFixed(6)} m²).`,
      );
    }
  }
}

/**
 * Recorta AREA_UMIDA pela união lógica AVN∪AUAS∪AREA_CONSOLIDADA.
 * A união é calculada por interseção/diferença iterativas para não depender de
 * buffer nem descartar silenciosamente geometrias que falhem no overlay.
 */
export const clipLayerToCover: LayerAction = (context) => {
  if (recognizeSimcarLayer(context.layerName) !== "AREA_UMIDA") {
    throw new Error(
      `Autofix recusado: clip_layer_to_cover só pode alterar AREA_UMIDA, não ${context.layerName}.`,
    );
  }
  const targetCrs = crsKey(context.crs);
  if (!targetCrs) {
    throw new Error(
      "Autofix recusado: AREA_UMIDA está sem CRS inequívoco para o recorte.",
    );
  }
  const relatedByCode = new Map(
    context.relatedLayers.map((layer) => [
      recognizeSimcarLayer(layer.layerName),
      layer,
    ]),
  );
  const covers: CoverGeometry[] = [];
  for (const code of CLIP_COVER_LAYER_CODES) {
    const layer = relatedByCode.get(code);
    if (!layer) {
      throw new Error(`Autofix recusado: camada de apoio ${code} ausente.`);
    }
    if (crsKey(layer.crs) !== targetCrs) {
      throw new Error(
        `Autofix recusado: CRS de ${layer.layerName} difere de AREA_UMIDA.`,
      );
    }
    for (const record of layer.records) {
      const geometry = recordToGeoJSON({
        feature: record.sourceFeature,
        rings: record.rings,
      });
      if (!geometry) {
        throw new Error(
          `Autofix recusado: geometria vazia em ${layer.layerName} feição ${record.sourceFeature}.`,
        );
      }
      covers.push({
        layerName: layer.layerName,
        sourceFeature: record.sourceFeature,
        feature: asFeature(geometry),
        bbox: geometryBbox(geometry),
      });
    }
  }
  if (!covers.length) {
    throw new Error(
      "Autofix recusado: AVN, AUAS e AREA_CONSOLIDADA estão vazias.",
    );
  }

  const bridge = createMetricBridge(context.records, context.crs);
  const clippedSourceFeatures = new Set<number>();
  const affectedFeatures = new Set<number>();
  const clippedRecords: AutofixPolygonRecord[] = [];
  let fragmentsRemoved = 0;

  for (const source of context.records) {
    const geometry = recordToGeoJSON({
      feature: source.sourceFeature,
      rings: source.rings,
    });
    if (!geometry) {
      throw new Error(
        `Autofix recusado: AREA_UMIDA feição ${source.sourceFeature} não pôde ser interpretada.`,
      );
    }
    const partition = partitionByCoverage({
      input: asFeature(geometry),
      covers,
      targetFeature: source.sourceFeature,
    });
    const residualArea = partition.residual?.geometry
      ? geometryAreaM2(partition.residual.geometry, bridge)
      : 0;
    if (residualArea <= RESIDUAL_TOLERANCE_M2) {
      clippedRecords.push(cloneRecord(source));
      continue;
    }

    clippedSourceFeatures.add(source.sourceFeature);
    affectedFeatures.add(source.sourceFeature);
    // NÃO unir pedaços de hosts diferentes: cada peça vira registro próprio
    // (SEMA valida contenção em um host individual, não na união AVN∪AUAS∪CONS).
    for (const piece of partition.pieces) {
      if (!piece?.geometry) continue;
      for (const converted of geojsonToPolyRecords(piece.geometry)) {
        if (polygonAreaM2(converted.rings, bridge) < CLIP_MIN_FRAGMENT_M2) {
          fragmentsRemoved += 1;
          continue;
        }
        clippedRecords.push({
          sourceFeature: source.sourceFeature,
          rings: converted.rings,
          attributes: { ...source.attributes },
        });
      }
    }
  }

  if (!clippedRecords.length) {
    throw new Error(
      "Autofix recusado: o recorte removeria todas as feições de AREA_UMIDA.",
    );
  }

  const cleaned = cleanAfterClip(clippedRecords, covers, bridge);
  cleaned.affectedFeatures.forEach((feature) => affectedFeatures.add(feature));
  const retained = cleaned.records.filter((record) => {
    if (!clippedSourceFeatures.has(record.sourceFeature)) return true;
    const keep = polygonAreaM2(record.rings, bridge) >= CLIP_MIN_FRAGMENT_M2;
    if (!keep) {
      fragmentsRemoved += 1;
      affectedFeatures.add(record.sourceFeature);
    }
    return keep;
  });
  if (!retained.length) {
    throw new Error(
      "Autofix recusado: a limpeza pós-clip removeria toda AREA_UMIDA.",
    );
  }

  assertCovered({ records: retained, covers, bridge });

  const sourceByFeature = new Map(
    context.records.map((record) => [record.sourceFeature, record]),
  );
  const allocator = createIdentifierAllocator(context.records, context.dbfSchema);
  const occurrences = new Map<number, number>();
  const output = retained.map((record) => {
    const source = sourceByFeature.get(record.sourceFeature);
    if (!source) {
      throw new Error(
        `Autofix recusado: origem DBF ${record.sourceFeature} não foi encontrada.`,
      );
    }
    const occurrence = occurrences.get(record.sourceFeature) || 0;
    occurrences.set(record.sourceFeature, occurrence + 1);
    return {
      sourceFeature: record.sourceFeature,
      rings: record.rings.map((ring) => ring.map((point) => [...point])),
      attributes:
        occurrence === 0
          ? { ...source.attributes }
          : allocator.cloneForExtra(source.attributes),
    };
  });
  const representedSources = new Set(output.map((record) => record.sourceFeature));
  const changed =
    affectedFeatures.size > 0 || output.length !== context.records.length;
  if (!changed) {
    return {
      records: context.records.map(cloneRecord),
      changed: false,
      affectedFeatures: [],
    };
  }

  return {
    records: output,
    changed: true,
    affectedFeatures: [...affectedFeatures],
    warnings: [
      ...(fragmentsRemoved
        ? [
            `${fragmentsRemoved} fragmento(s) pós-clip abaixo de ${CLIP_MIN_FRAGMENT_M2} m² foram descartados.`,
          ]
        : []),
      ...cleaned.warnings,
    ],
    metrics: {
      verticesRemoved: cleaned.metrics.verticesRemoved,
      ringsRemoved: cleaned.metrics.ringsRemoved,
      recordsDropped: context.records.length - representedSources.size,
      recordsCreated: output.length - representedSources.size,
      identifiersCreated: allocator.generatedCount(),
    },
  };
};
