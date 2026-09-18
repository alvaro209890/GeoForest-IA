import { area as turfArea } from "@turf/turf";
import initGeos from "geos-wasm";
import { geojsonToGeosGeom, geosGeomToGeojson } from "geos-wasm/helpers";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { normalizePolygonGeometry, toPolygonOrMultiFeature } from "../wfs-intersection";
import type { ClipResult, ClippedPolygonResult } from "./types";

export const LAND_COVER_LAYERS = ["AREA_CONSOLIDADA", "AUAS", "AVN"] as const;
export const INUNDATED_COVERAGE_LAYERS = [
  "RIO_ATE_10",
  "RIO_10_A_50",
  "RIO_50_A_200",
  "RIO_200_A_600",
  "RIO_ACIMA_600",
  "LAGOA_NATURAL",
  "RESERVATORIO_ARTIFICIAL",
] as const;

const NUMERIC_AREA_TOLERANCE_M2 = 0.01;

type Geos = Awaited<ReturnType<typeof initGeos>>;
let geosPromise: Promise<Geos> | null = null;

async function getGeos(): Promise<Geos> {
  if (!geosPromise) geosPromise = initGeos();
  return await geosPromise;
}

function readGeometry(runtime: Geos, geometry: unknown, label: string): number {
  const pointer = geojsonToGeosGeom(geometry as any, runtime);
  if (!pointer) throw new Error(`GEOS não conseguiu ler ${label}.`);
  if (runtime.GEOSisValid(pointer) !== 1) {
    runtime.GEOSGeom_destroy(pointer);
    throw new Error(`Geometria inválida em ${label}.`);
  }
  return pointer;
}

function writePolygon(
  runtime: Geos,
  pointer: number,
  label: string,
): Feature<Polygon | MultiPolygon> | null {
  if (!pointer) throw new Error(`GEOS falhou em ${label}.`);
  try {
    if (runtime.GEOSisEmpty(pointer) === 1) return null;
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
    const geometry = normalizePolygonGeometry(
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
    );
    if (!geometry) throw new Error(`Resultado inválido em ${label}.`);
    return { type: "Feature", properties: {}, geometry };
  } finally {
    runtime.GEOSGeom_destroy(pointer);
  }
}

function polygonResults(results: ClipResult[]): ClippedPolygonResult[] {
  return results.filter(
    (result): result is ClippedPolygonResult => result.kind === "polygon",
  );
}

function polygonFeatures(results: ClipResult[]): Array<Feature<Polygon | MultiPolygon>> {
  return polygonResults(results)
    .map((result) => toPolygonOrMultiFeature(result.geometry))
    .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature));
}

function union(
  runtime: Geos,
  features: Array<Feature<Polygon | MultiPolygon>>,
  label: string,
): Feature<Polygon | MultiPolygon> | null {
  if (features.length === 0) return null;
  let input = 0;
  try {
    input = readGeometry(runtime, {
      type: "GeometryCollection",
      geometries: features.map((feature) => feature.geometry),
    }, label);
    return writePolygon(runtime, runtime.GEOSUnaryUnion(input), label);
  } finally {
    if (input) runtime.GEOSGeom_destroy(input);
  }
}

function overlay(
  runtime: Geos,
  operation: "intersection" | "difference",
  left: Feature<Polygon | MultiPolygon>,
  right: Feature<Polygon | MultiPolygon>,
  label: string,
): Feature<Polygon | MultiPolygon> | null {
  let leftPointer = 0;
  let rightPointer = 0;
  try {
    leftPointer = readGeometry(runtime, left.geometry, label);
    rightPointer = readGeometry(runtime, right.geometry, label);
    const result = operation === "intersection"
      ? runtime.GEOSIntersection(leftPointer, rightPointer)
      : runtime.GEOSDifference(leftPointer, rightPointer);
    return writePolygon(runtime, result, label);
  } finally {
    if (leftPointer) runtime.GEOSGeom_destroy(leftPointer);
    if (rightPointer) runtime.GEOSGeom_destroy(rightPointer);
  }
}

function areaM2(feature: Feature<Polygon | MultiPolygon> | null): number {
  return feature ? turfArea(feature) : 0;
}

export class CoverageTopologyError extends Error {
  readonly code = "COVERAGE_TOPOLOGY_FAILED";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoverageTopologyError";
  }
}

export type CoverageTopologyStats = {
  gapAreaM2: number;
  landCoverOverlapAreaM2: number;
  inundatedOverlapAreaM2: number;
};

/**
 * Confere a topologia recebida sem modificar um único vértice. Se a base
 * oficial não formar a partição esperada, o job falha em vez de fabricar um
 * filete, apagar sobreposição ou atribuir prioridade entre classes.
 */
export async function validateOfficialCoverage(args: {
  layers: Map<string, ClipResult[]>;
  propertyPolygons: Array<Feature<Polygon | MultiPolygon>>;
  strict?: boolean;
}): Promise<CoverageTopologyStats> {
  try {
    const runtime = await getGeos();
    const property = union(runtime, args.propertyPolygons, "o limite da ATP");
    if (!property) throw new Error("limite da ATP vazio");

    const landMasks = new Map<string, Feature<Polygon | MultiPolygon> | null>();
    for (const layerName of LAND_COVER_LAYERS) {
      landMasks.set(
        layerName,
        union(runtime, polygonFeatures(args.layers.get(layerName) || []), layerName),
      );
    }
    const inundated = union(
      runtime,
      INUNDATED_COVERAGE_LAYERS.flatMap((layerName) =>
        polygonFeatures(args.layers.get(layerName) || [])
      ),
      "as áreas de água",
    );
    const allCoverage = union(
      runtime,
      [inundated, ...landMasks.values()].filter(
        (feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature),
      ),
      "a cobertura oficial",
    );
    if (!allCoverage) throw new Error("cobertura oficial vazia");

    const insideCoverage = overlay(runtime, "intersection", allCoverage, property, "a cobertura dentro da ATP");
    const gaps = insideCoverage
      ? overlay(runtime, "difference", property, insideCoverage, "os vazios da cobertura")
      : property;
    const gapAreaM2 = areaM2(gaps);

    let landCoverOverlapAreaM2 = 0;
    for (let i = 0; i < LAND_COVER_LAYERS.length; i += 1) {
      const left = landMasks.get(LAND_COVER_LAYERS[i]);
      if (!left) continue;
      for (let j = i + 1; j < LAND_COVER_LAYERS.length; j += 1) {
        const right = landMasks.get(LAND_COVER_LAYERS[j]);
        if (!right) continue;
        const overlap = overlay(runtime, "intersection", left, right, "a sobreposição entre classes");
        const inside = overlap
          ? overlay(runtime, "intersection", overlap, property, "a sobreposição dentro da ATP")
          : null;
        landCoverOverlapAreaM2 += areaM2(inside);
      }
    }

    const landCover = union(
      runtime,
      [...landMasks.values()].filter(
        (feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature),
      ),
      "as classes do solo",
    );
    const waterOverlap = landCover && inundated
      ? overlay(runtime, "intersection", landCover, inundated, "a sobreposição com água")
      : null;
    const waterOverlapInside = waterOverlap
      ? overlay(runtime, "intersection", waterOverlap, property, "a sobreposição com água dentro da ATP")
      : null;
    const inundatedOverlapAreaM2 = areaM2(waterOverlapInside);

    const isStrict = args.strict !== false;
    if (
      isStrict &&
      (gapAreaM2 > NUMERIC_AREA_TOLERANCE_M2 ||
        landCoverOverlapAreaM2 > NUMERIC_AREA_TOLERANCE_M2 ||
        inundatedOverlapAreaM2 > NUMERIC_AREA_TOLERANCE_M2)
    ) {
      throw new CoverageTopologyError(
        `A base oficial não passou na validação sem alterações (vazio ${gapAreaM2.toFixed(4)} m²; sobreposição entre classes ${landCoverOverlapAreaM2.toFixed(4)} m²; sobreposição com água ${inundatedOverlapAreaM2.toFixed(4)} m²). Nenhum filete foi criado e nenhum ZIP foi gerado.`,
      );
    }

    return { gapAreaM2, landCoverOverlapAreaM2, inundatedOverlapAreaM2 };
  } catch (error) {
    if (error instanceof CoverageTopologyError) throw error;
    throw new CoverageTopologyError(
      "Não foi possível validar a cobertura oficial sem alterar as geometrias. O recorte foi cancelado.",
      { cause: error },
    );
  }
}

export function layerPolygonGeometries(results: ClipResult[]): Geometry[] {
  return polygonResults(results).map((result) => result.geometry);
}
