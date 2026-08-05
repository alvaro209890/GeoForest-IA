/**
 * Sede da propriedade — layer de pontos dentro do ZIP da ATP.
 *
 * Alguns shapefiles de propriedade vêm com a sede (casa/escritório) como um
 * segundo layer de pontos. Quando existe e cai dentro do polígono do imóvel,
 * o croqui termina nela; senão o fim da rota vai para um ponto interior
 * (centroide, com fallback na superfície do polígono).
 */
import { booleanPointInPolygon, point } from "@turf/turf";
import type { MultiPolygon, Polygon, Position } from "geojson";
import proj4 from "proj4";
import { extractZipEntries, resolveShapefileCrs } from "../geo-utils";

export type SedePoint = { lon: number; lat: number };

/** Point, PointZ, PointM */
const POINT_TYPES = new Set([1, 11, 21]);
/** MultiPoint, MultiPointZ, MultiPointM */
const MULTIPOINT_TYPES = new Set([8, 18, 28]);

/**
 * Lê as coordenadas de um .shp de pontos. Polígonos e linhas são ignorados
 * (devolvem lista vazia) — o mesmo formato de registro do leitor de
 * polígonos em `simcar/shapefile-io.ts`, só que com geometria pontual.
 */
export function readPointShapefile(shpBuffer: Buffer): Position[] {
  const points: Position[] = [];
  if (shpBuffer.length < 100) return points;

  let offset = 100; // pula o header de 100 bytes
  while (offset + 12 <= shpBuffer.length) {
    const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
    const contentLengthBytes = contentLengthWords * 2;
    const recStart = offset + 8;
    const recEnd = recStart + contentLengthBytes;
    if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

    const shapeType = shpBuffer.readInt32LE(recStart);
    if (POINT_TYPES.has(shapeType) && contentLengthBytes >= 20) {
      const x = shpBuffer.readDoubleLE(recStart + 4);
      const y = shpBuffer.readDoubleLE(recStart + 12);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    } else if (MULTIPOINT_TYPES.has(shapeType) && contentLengthBytes >= 44) {
      // MultiPoint: shapeType + bbox (32 bytes) + numPoints + pontos.
      const numPoints = shpBuffer.readInt32LE(recStart + 36);
      const pointsOffset = recStart + 40;
      if (
        numPoints > 0 &&
        numPoints < 100000 &&
        pointsOffset + numPoints * 16 <= recEnd
      ) {
        for (let i = 0; i < numPoints; i++) {
          const pOff = pointsOffset + i * 16;
          const x = shpBuffer.readDoubleLE(pOff);
          const y = shpBuffer.readDoubleLE(pOff + 8);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
        }
      }
    }
    offset = recEnd;
  }
  return points;
}

/**
 * Procura a sede da propriedade dentro do ZIP da ATP: o primeiro ponto de um
 * layer de pontos que caia dentro do polígono do imóvel. O layer de pontos
 * está no mesmo CRS do polígono (mesmo .prj do ZIP); sem layer de pontos, ou
 * com nenhum ponto dentro, devolve null — o chamador cai no ponto interior.
 */
export function findSedePoint(
  zipBuffer: Buffer,
  atpGeometry: Polygon | MultiPolygon,
): SedePoint | null {
  const entries = extractZipEntries(zipBuffer);
  const prjEntry = entries.find((entry) => entry.name.toLowerCase().endsWith(".prj"));
  let projDef: string | null = null;
  if (prjEntry) {
    try {
      projDef = resolveShapefileCrs(prjEntry.data.toString("utf8")).projDef;
    } catch {
      projDef = null;
    }
  }

  const feature = { type: "Feature" as const, properties: {}, geometry: atpGeometry };
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".shp")) continue;
    let coords = readPointShapefile(entry.data);
    if (projDef) {
      coords = coords.map(([x, y]) => {
        const [lon, lat] = proj4(projDef, "EPSG:4326", [x, y]) as [number, number];
        return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : [x, y];
      });
    }
    for (const [lon, lat] of coords) {
      if (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        booleanPointInPolygon(point([lon, lat]), feature)
      ) {
        return { lon, lat };
      }
    }
  }
  return null;
}
