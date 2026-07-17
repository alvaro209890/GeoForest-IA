/**
 * Extrai contexto geométrico do ZIP (bbox/centroid) sem chamar SEMA.
 * Município IBGE é resolvido localmente pela malha oficial de MT.
 */
import proj4 from "proj4";
import { getZipLayerGroups, parsePolygonRecords } from "../vertices-proximas";
import { recordToGeoJSON } from "../geometry-errors";
import { recognizeSimcarLayer } from "../simcar-rules";
import { resolveShapefileCrs } from "../geo-utils";
import { detectarMunicipioMt, municipioNaoDetectado } from "./municipio-mt";
import type { ShapeContext } from "./types";

export function extractShapeContext(zip: Buffer): ShapeContext {
  const groups = getZipLayerGroups(zip);
  const layers: string[] = [];
  let propertyLayer: string | undefined;
  let coords: number[][] = [];
  let selectedCrs: string | undefined;
  const warnings: string[] = [];

  const prefer = ["ATP", "AIR"];
  const byCode = new Map<
    string,
    {
      name: string;
      records: ReturnType<typeof parsePolygonRecords>;
      prjText?: string;
    }
  >();

  for (const g of groups) {
    if (!g.shp) continue;
    const code = recognizeSimcarLayer(g.name);
    layers.push(g.name);
    if (!code) continue;
    try {
      const records = parsePolygonRecords(g.shp.data);
      byCode.set(code, {
        name: g.name,
        records,
        prjText: g.prj?.data.toString("utf8").trim() || undefined,
      });
    } catch {
      /* skip */
    }
  }

  const appendCoordinates = (layer: {
    name: string;
    records: ReturnType<typeof parsePolygonRecords>;
    prjText?: string;
  }): void => {
    const sourceCoords: number[][] = [];
    for (const rec of layer.records) {
      const geom = recordToGeoJSON(rec);
      if (!geom) continue;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          for (const p of ring) sourceCoords.push([Number(p[0]), Number(p[1])]);
        }
      }
    }
    if (!sourceCoords.length) return;

    let converter = (point: number[]): number[] => [Number(point[0]), Number(point[1])];
    if (layer.prjText) {
      try {
        const resolved = resolveShapefileCrs(layer.prjText);
        selectedCrs = resolved.projDef ? `projetado (${resolved.datum.label})` : resolved.datum.label;
        if (resolved.projDef) {
          converter = (point) => {
            const converted = proj4(resolved.projDef!, "EPSG:4326", [point[0], point[1]]) as [
              number,
              number,
            ];
            return [Number(converted[0]), Number(converted[1])];
          };
        }
      } catch (error: any) {
        warnings.push(`${layer.name}: ${error?.message || "CRS não reconhecido"}`);
      }
    } else {
      const sample = sourceCoords[0];
      const looksGeographic =
        Math.abs(Number(sample[0])) <= 180 && Math.abs(Number(sample[1])) <= 90;
      if (looksGeographic) {
        selectedCrs = "geográfico sem .prj (assumido SIRGAS 2000/WGS84)";
        warnings.push(`${layer.name}: arquivo .prj ausente; coordenadas geográficas presumidas.`);
      } else {
        selectedCrs = "desconhecido";
        warnings.push(
          `${layer.name}: arquivo .prj ausente e coordenadas projetadas; município não é confiável.`,
        );
      }
    }
    coords.push(
      ...sourceCoords
        .map(converter)
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])),
    );
  };

  for (const code of prefer) {
    const L = byCode.get(code);
    if (!L?.records.length) continue;
    propertyLayer = L.name;
    appendCoordinates(L);
    if (coords.length) break;
  }

  // fallback: qualquer camada com geometria
  if (!coords.length) {
    for (const [, L] of byCode) {
      propertyLayer = L.name;
      appendCoordinates(L);
      if (coords.length) break;
    }
  }

  if (!coords.length) {
    return {
      bbox: [0, 0, 0, 0],
      centroid: [0, 0],
      layers,
      propertyLayer,
      municipioDetectado: municipioNaoDetectado(),
      warnings,
      crs: selectedCrs,
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
  const geographicBbox =
    minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  const areaHaApprox = geographicBbox ? Math.abs((w * h) / 10000) : undefined;
  const municipioDetectado = geographicBbox
    ? detectarMunicipioMt(centroid) || municipioNaoDetectado()
    : municipioNaoDetectado();

  return {
    bbox,
    centroid,
    areaHaApprox:
      areaHaApprox !== undefined && Number.isFinite(areaHaApprox) ? areaHaApprox : undefined,
    layers,
    propertyLayer,
    municipioDetectado,
    warnings,
    crs: selectedCrs,
  };
}
