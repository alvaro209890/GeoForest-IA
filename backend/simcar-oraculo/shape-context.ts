/**
 * Extrai contexto geométrico do ZIP (bbox/centroid) sem chamar SEMA.
 * Município IBGE / malha → P2 (prepare-project).
 */
import { getZipLayerGroups, parsePolygonRecords, detectCrs } from "../vertices-proximas";
import { recordToGeoJSON } from "../geometry-errors";
import { recognizeSimcarLayer } from "../simcar-rules";
import type { ShapeContext } from "./types";

export function extractShapeContext(zip: Buffer): ShapeContext {
  const groups = getZipLayerGroups(zip);
  const layers: string[] = [];
  let propertyLayer: string | undefined;
  let coords: number[][] = [];

  const prefer = ["ATP", "AIR"];
  const byCode = new Map<string, { name: string; records: ReturnType<typeof parsePolygonRecords> }>();

  for (const g of groups) {
    if (!g.shp) continue;
    const code = recognizeSimcarLayer(g.name);
    layers.push(g.name);
    if (!code) continue;
    try {
      const records = parsePolygonRecords(g.shp.data);
      byCode.set(code, { name: g.name, records });
    } catch {
      /* skip */
    }
  }

  for (const code of prefer) {
    const L = byCode.get(code);
    if (!L?.records.length) continue;
    propertyLayer = L.name;
    for (const rec of L.records) {
      const geom = recordToGeoJSON(rec);
      if (!geom) continue;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          for (const p of ring) coords.push([Number(p[0]), Number(p[1])]);
        }
      }
    }
    if (coords.length) break;
  }

  // fallback: qualquer camada com geometria
  if (!coords.length) {
    for (const [, L] of byCode) {
      for (const rec of L.records) {
        const geom = recordToGeoJSON(rec);
        if (!geom) continue;
        propertyLayer = L.name;
        const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            for (const p of ring) coords.push([Number(p[0]), Number(p[1])]);
          }
        }
      }
      if (coords.length) break;
    }
  }

  if (!coords.length) {
    return {
      bbox: [0, 0, 0, 0],
      centroid: [0, 0],
      layers,
      propertyLayer,
    };
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let sx = 0,
    sy = 0;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    sx += x;
    sy += y;
  }
  const n = coords.length;
  const bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
  const centroid: [number, number] = [sx / n, sy / n];

  // área aproximada em ha (se lon/lat, usa cos lat)
  const midLat = (minY + maxY) / 2;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((midLat * Math.PI) / 180);
  const w = (maxX - minX) * mPerDegLon;
  const h = (maxY - minY) * mPerDegLat;
  const areaHaApprox = Math.abs((w * h) / 10000);

  return {
    bbox,
    centroid,
    areaHaApprox: Number.isFinite(areaHaApprox) ? areaHaApprox : undefined,
    layers,
    propertyLayer,
  };
}
