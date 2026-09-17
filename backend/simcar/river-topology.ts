import {
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  union as turfUnion,
} from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { normalizePolygonGeometry, toPolygonOrMultiFeature } from "../wfs-intersection";
import type { ClipResult } from "./types";

export class RiverTopologyError extends Error {
  readonly code = "RIVER_TOPOLOGY_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RiverTopologyError";
  }
}

/**
 * Acrescenta geometrias poligonais à máscara hidrográfica. Ao contrário da
 * união tolerante usada em relatórios, esta operação falha fechada: uma união
 * incompleta não pode liberar um ZIP com sobreposição residual.
 */
export function extendRiverMask(
  current: Feature<Polygon | MultiPolygon> | null,
  geometries: Geometry[],
): Feature<Polygon | MultiPolygon> | null {
  const additions = geometries
    .map((geometry) => toPolygonOrMultiFeature(geometry))
    .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature));
  const features = current ? [current, ...additions] : additions;
  if (features.length === 0) return current;
  if (features.length === 1) return features[0];

  try {
    const unioned = turfUnion(turfFeatureCollection(features) as any) as
      | Feature<Polygon | MultiPolygon>
      | null;
    const geometry = normalizePolygonGeometry(unioned?.geometry);
    if (!geometry) {
      throw new Error("união hidrográfica vazia ou inválida");
    }
    return { type: "Feature", properties: {}, geometry };
  } catch (error) {
    throw new RiverTopologyError(
      "Não foi possível consolidar a máscara dos rios. O recorte foi cancelado e nenhum ZIP foi gerado.",
      { cause: error },
    );
  }
}

/**
 * Remove a máscara de rios de resultados poligonais, preservando atributos e
 * pontos. Um polígono inteiramente coberto pela hidrografia deixa de existir.
 */
export function eraseRiverOverlap(
  results: ClipResult[],
  riverMask: Feature<Polygon | MultiPolygon> | null,
): ClipResult[] {
  if (!riverMask) return results;
  const cleaned: ClipResult[] = [];

  for (const result of results) {
    if (result.kind !== "polygon") {
      cleaned.push(result);
      continue;
    }

    const subject = toPolygonOrMultiFeature(result.geometry);
    if (!subject) {
      throw new RiverTopologyError(
        "Uma geometria poligonal ficou inválida durante a remoção das sobreposições com rios.",
      );
    }

    try {
      const difference = turfDifference(
        turfFeatureCollection([subject, riverMask]) as any,
      ) as Feature<Polygon | MultiPolygon> | null;
      if (!difference?.geometry) continue;
      const geometry = normalizePolygonGeometry(difference.geometry);
      if (!geometry) {
        throw new Error("diferença hidrográfica inválida");
      }
      cleaned.push({ ...result, geometry });
    } catch (error) {
      if (error instanceof RiverTopologyError) throw error;
      throw new RiverTopologyError(
        "Não foi possível remover a sobreposição com os rios. O recorte foi cancelado e nenhum ZIP foi gerado.",
        { cause: error },
      );
    }
  }

  return cleaned;
}
