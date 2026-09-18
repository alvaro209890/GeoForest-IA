import initGeos from "geos-wasm";
import { geojsonToGeosGeom, geosGeomToGeojson } from "geos-wasm/helpers";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizePolygonGeometry, toPolygonOrMultiFeature } from "../wfs-intersection";
import {
  extractPointCoords,
  isPointOrMultiPoint,
  pointInsideAnyPolygon,
} from "./polygon-ops";
import type { ClipResult, WfsFeature } from "./types";

type Geos = Awaited<ReturnType<typeof initGeos>>;

let geosPromise: Promise<Geos> | null = null;

async function getGeos(): Promise<Geos> {
  if (!geosPromise) geosPromise = initGeos();
  return await geosPromise;
}

function readValidGeometry(runtime: Geos, geometry: unknown, label: string): number {
  const pointer = geojsonToGeosGeom(geometry as any, runtime);
  if (!pointer) throw new ExactClipError(`GEOS não conseguiu ler ${label}.`);
  if (runtime.GEOSisValid(pointer) !== 1) {
    runtime.GEOSGeom_destroy(pointer);
    throw new ExactClipError(`Geometria inválida em ${label}.`);
  }
  return pointer;
}

function polygonGeometryFromGeos(
  runtime: Geos,
  pointer: number,
  label: string,
): Polygon | MultiPolygon | null {
  if (!pointer) throw new ExactClipError(`GEOS falhou durante ${label}.`);
  try {
    if (runtime.GEOSisEmpty(pointer) === 1) return null;
    if (runtime.GEOSisValid(pointer) !== 1) {
      throw new ExactClipError(`GEOS produziu geometria inválida durante ${label}.`);
    }
    const raw = geosGeomToGeojson(pointer, runtime) as any;
    const polygons: MultiPolygon["coordinates"] = [];
    const collect = (geometry: any): void => {
      if (!geometry) return;
      if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
      else if (geometry.type === "MultiPolygon") polygons.push(...geometry.coordinates);
      else if (geometry.type === "GeometryCollection") {
        for (const child of geometry.geometries || []) collect(child);
      }
    };
    collect(raw);
    if (polygons.length === 0) return null;
    const normalized = normalizePolygonGeometry(
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
    );
    if (!normalized) {
      throw new ExactClipError(`Resultado poligonal inválido durante ${label}.`);
    }
    return normalized;
  } finally {
    runtime.GEOSGeom_destroy(pointer);
  }
}

function exactIntersection(
  runtime: Geos,
  source: Polygon | MultiPolygon,
  boundary: Polygon | MultiPolygon,
  label: string,
): Polygon | MultiPolygon | null {
  let sourcePointer = 0;
  let boundaryPointer = 0;
  try {
    sourcePointer = readValidGeometry(runtime, source, `${label} (fonte oficial)`);
    boundaryPointer = readValidGeometry(runtime, boundary, `${label} (ATP)`);
    // Sem grade de precisão, buffer, snap, diferença ou preenchimento. A única
    // transformação autorizada é a interseção da feição oficial com a ATP.
    return polygonGeometryFromGeos(
      runtime,
      runtime.GEOSIntersection(sourcePointer, boundaryPointer),
      label,
    );
  } finally {
    if (sourcePointer) runtime.GEOSGeom_destroy(sourcePointer);
    if (boundaryPointer) runtime.GEOSGeom_destroy(boundaryPointer);
  }
}

function ringArea(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (!p1 || !p2) continue;
    sum += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return Math.abs(sum) / 2;
}

function cleanPolygonRings(rings: number[][][]): number[][][] | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const exterior = rings[0];
  if (!exterior || ringArea(exterior) <= 1e-14) return null;
  const validRings: number[][][] = [exterior];
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (hole && ringArea(hole) > 1e-14) {
      validRings.push(hole);
    }
  }
  return validRings;
}

export function filterDegeneratePolygonGeometry(
  geometry: Polygon | MultiPolygon,
): Polygon | MultiPolygon | null {
  if (geometry.type === "Polygon") {
    const cleaned = cleanPolygonRings(geometry.coordinates);
    return cleaned ? { type: "Polygon", coordinates: cleaned } : null;
  }
  if (geometry.type === "MultiPolygon") {
    const validPolygons: number[][][][] = [];
    for (const poly of geometry.coordinates) {
      const cleaned = cleanPolygonRings(poly);
      if (cleaned) validPolygons.push(cleaned);
    }
    if (validPolygons.length === 0) return null;
    if (validPolygons.length === 1) {
      return { type: "Polygon", coordinates: validPolygons[0] };
    }
    return { type: "MultiPolygon", coordinates: validPolygons };
  }
  return null;
}

export class ExactClipError extends Error {
  readonly code = "SIMCAR_EXACT_CLIP_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExactClipError";
  }
}

/**
 * Recorta as feições do snapshot oficial somente pela ATP. Não dissolve,
 * reclassifica, subtrai rios, preenche vazios ou move vértices.
 */
export async function clipOfficialFeaturesExactly(
  features: WfsFeature[],
  propertyPolygons:
    | Feature<Polygon | MultiPolygon>
    | Array<Feature<Polygon | MultiPolygon>>,
  options: {
    pointClipPolygons?: Array<Feature<Polygon | MultiPolygon>>;
    layerName?: string;
  } = {},
): Promise<ClipResult[]> {
  const runtime = await getGeos();
  const boundaries = Array.isArray(propertyPolygons)
    ? propertyPolygons
    : [propertyPolygons];
  const pointBoundaries = options.pointClipPolygons?.length
    ? options.pointClipPolygons
    : boundaries;
  const output: ClipResult[] = [];

  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    const sourceFeature = features[featureIndex];
    if (!sourceFeature.geometry) continue;
    const sourcePolygon = toPolygonOrMultiFeature(sourceFeature.geometry);
    if (sourcePolygon) {
      const cleanedGeometry = filterDegeneratePolygonGeometry(sourcePolygon.geometry);
      if (!cleanedGeometry) continue;
      for (const boundary of boundaries) {
        try {
          const geometry = exactIntersection(
            runtime,
            cleanedGeometry,
            boundary.geometry,
            `${options.layerName || "camada"}, feição ${featureIndex + 1}`,
          );
          if (geometry) {
            output.push({
              kind: "polygon",
              geometry,
              properties: sourceFeature.properties,
            });
          }
        } catch (error) {
          if (error instanceof ExactClipError) throw error;
          throw new ExactClipError(
            `Não foi possível recortar ${options.layerName || "a camada"} sem alterar a geometria oficial. Nenhum ZIP foi gerado.`,
            { cause: error },
          );
        }
      }
      continue;
    }

    if (!isPointOrMultiPoint(sourceFeature.geometry)) continue;
    const coordinates = extractPointCoords(sourceFeature.geometry) || [];
    const inside = coordinates.filter((coordinate) =>
      pointInsideAnyPolygon(coordinate, pointBoundaries)
    );
    if (inside.length > 0) {
      output.push({
        kind: "point",
        pointCoords: inside,
        properties: sourceFeature.properties,
      });
    }
  }

  return output;
}
