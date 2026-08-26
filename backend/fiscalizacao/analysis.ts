/**
 * Cruzamento das feições de fiscalização com a ATP.
 *
 * Distingue três situações que o usuário precisa ver separadas:
 *   - incidente   → há sobreposição de área com a ATP
 *   - confrontante → distância ~0 mas sem área comum (divisa encostada)
 *   - próximo      → distância > 0
 */
import {
  booleanIntersects,
  explode,
  pointToLineDistance,
  polygonToLine,
} from "@turf/turf";
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { featureAreaHa, intersectionAreaHa } from "../overlap/utils";
import type { AtpFeature, FiscalizacaoRecord } from "./types";

/** Abaixo disso a feição é tratada como confrontante, não como próxima. */
export const CONFRONTANTE_TOLERANCIA_M = 1;

/** Sobreposição menor que isso é sliver de recorte, não incidência real. */
export const SLIVER_TOLERANCIA_HA = 0.0001;

type LineFeature = Feature<LineString | MultiLineString>;

function boundaryLines(geom: Polygon | MultiPolygon): LineFeature[] {
  const asFeature: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: geom,
  };
  const line = polygonToLine(asFeature as any) as any;
  if (!line) return [];
  if (line.type === "FeatureCollection") return line.features as LineFeature[];
  return [line as LineFeature];
}

function minDistanceToLines(geom: any, lines: LineFeature[]): number {
  if (!lines.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  const points = explode({ type: "Feature", properties: {}, geometry: geom } as any);
  for (const point of points.features) {
    for (const line of lines) {
      try {
        const d = pointToLineDistance(point as any, line as any, { units: "meters" });
        if (Number.isFinite(d) && d < min) min = d;
      } catch {
        // geometria degenerada — ignora esta combinação
      }
    }
  }
  return min;
}

/**
 * Menor distância entre a feição e a ATP, em metros. Mede nos dois sentidos
 * porque só medir os vértices de um lado erra quando uma geometria envolve a
 * outra sem que os vértices fiquem próximos.
 */
export function distanceToAtpMeters(geom: any, atp: AtpFeature): number {
  try {
    if (booleanIntersects(geom, atp as any)) return 0;
  } catch {
    // segue para a medição por vértices
  }
  const atpLines = boundaryLines(atp.geometry);
  let min = minDistanceToLines(geom, atpLines);

  if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") {
    const featureLines = boundaryLines(geom);
    const inverse = minDistanceToLines(atp.geometry, featureLines);
    if (inverse < min) min = inverse;
  }
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

/**
 * Preenche áreas, sobreposição e distância de cada registro e devolve a lista
 * ordenada: incidentes primeiro, depois por distância crescente.
 */
export function analyzeRecords(records: FiscalizacaoRecord[], atp: AtpFeature): FiscalizacaoRecord[] {
  const atpAreaHa = featureAreaHa(atp.geometry);

  for (const record of records) {
    const geom = record.geometry;
    const isPolygon = geom.type === "Polygon" || geom.type === "MultiPolygon";

    if (isPolygon) {
      record.areaGeomHa = featureAreaHa(geom as Polygon | MultiPolygon);
      record.sobreposicaoHa = intersectionAreaHa(geom as Polygon | MultiPolygon, atp.geometry);
    } else {
      record.areaGeomHa = 0;
      record.sobreposicaoHa = 0;
    }

    record.incidente = record.sobreposicaoHa > SLIVER_TOLERANCIA_HA;
    record.percentualAtp =
      atpAreaHa > 0 ? Math.round((record.sobreposicaoHa / atpAreaHa) * 10000) / 100 : 0;

    if (record.incidente) {
      record.distanciaM = 0;
    } else {
      const d = distanceToAtpMeters(geom, atp);
      record.distanciaM = Number.isFinite(d) ? Math.round(d * 100) / 100 : -1;
    }
  }

  return records.sort((a, b) => {
    if (a.incidente !== b.incidente) return a.incidente ? -1 : 1;
    if (a.incidente && b.incidente) return b.sobreposicaoHa - a.sobreposicaoHa;
    return a.distanciaM - b.distanciaM;
  });
}

/** Rótulo curto da relação espacial, usado no mapa e na planilha. */
export function relacaoLabel(record: FiscalizacaoRecord): string {
  if (record.incidente) return `INCIDENTE — ${record.sobreposicaoHa.toFixed(4)} ha (${record.percentualAtp.toFixed(2)}% da ATP)`;
  if (record.distanciaM < 0) return "distância indeterminada";
  if (record.distanciaM <= CONFRONTANTE_TOLERANCIA_M) return "CONFRONTANTE (divisa encostada)";
  if (record.distanciaM < 1000) return `${record.distanciaM.toFixed(0)} m da ATP`;
  return `${(record.distanciaM / 1000).toFixed(2)} km da ATP`;
}
