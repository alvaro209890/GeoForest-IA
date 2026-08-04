/**
 * Detector: anéis sobrepostos dentro do MESMO registro (borda compartilhada ≥ 1 m).
 */
import proj4 from "proj4";
import { featureCollection as turfFeatureCollection, intersect as turfIntersect } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { CodedCrs, ParsedPolygonRecord } from "../../vertices-proximas";
import { SEMA_MSG_ANEIS_SOBREPOSTOS, SIMCAR_RING_SHARED_EDGE_M, SIMCAR_RING_SHARED_EDGE_TOL_M } from "../constants";
import { GeometryErrorRow } from "../types";
import { metricProjForCrs, pointToSegmentDistanceM, polygonMetricAreaM2 } from "../utils";

/**
 * Comprimento (m) das arestas de `ringA` que estão coladas em `ringB`
 * (amostragem ao longo da aresta com tol. métrica).
 * `crs` opcional: se projetado, coords já estão em metros (não reprojeta).
 */
export function ringsSharedBoundaryLengthM(
  ringA: number[][],
  ringB: number[][],
  metricProjDef: string,
  tolM = SIMCAR_RING_SHARED_EDGE_TOL_M,
  crs?: CodedCrs,
): number {
  if (ringA.length < 2 || ringB.length < 2) return 0;
  const projected = crs?.kind === "projected";
  // SIRGAS 2000 ≈ WGS84 no domínio do MT; evita depender de defs EPSG no proj4.
  const toM = projected ? null : proj4("WGS84", metricProjDef);
  const project = (p: number[]): [number, number] => {
    if (!toM) return [Number(p[0]), Number(p[1])];
    const m = toM.forward([Number(p[0]), Number(p[1])]) as [number, number];
    return [m[0], m[1]];
  };
  const aM: [number, number][] = [];
  const bM: [number, number][] = [];
  for (const p of ringA) aM.push(project(p));
  for (const p of ringB) bM.push(project(p));
  let shared = 0;
  for (let i = 0; i < aM.length - 1; i += 1) {
    const [x1, y1] = aM[i];
    const [x2, y2] = aM[i + 1];
    const seglen = Math.hypot(x2 - x1, y2 - y1);
    if (seglen < 1e-6) continue;
    // ~0,5 m por amostra (mín. 4) — suficiente p/ capturar colagem contínua
    const steps = Math.max(4, Math.ceil(seglen / 0.5));
    let on = 0;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const px = x1 + t * (x2 - x1);
      const py = y1 + t * (y2 - y1);
      let ok = false;
      for (let k = 0; k < bM.length - 1; k += 1) {
        if (pointToSegmentDistanceM(px, py, bM[k][0], bM[k][1], bM[k + 1][0], bM[k + 1][1]) <= tolM) {
          ok = true;
          break;
        }
      }
      if (ok) on += 1;
    }
    // aresta "colada" se ≥80% das amostras caem sobre ringB
    if (on >= steps * 0.8) shared += seglen;
  }
  return shared;
}

/**
 * Importador da SEMA (oráculo upload v19/v21, 16/07/2026): dois anéis do MESMO
 * registro não podem (a) se sobrepor em ÁREA de forma parcial nem (b) compartilhar
 * borda com comprimento significativo (buraco colado na exterior).
 * Encoste pontual de vértice segue permitido (regra ESRI).
 */
export function detectOverlappingRings(
  layerName: string,
  records: ParsedPolygonRecord[],
  crs: CodedCrs,
): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  const metricProjDef = metricProjForCrs(crs, records);
  for (const record of records) {
    const rings = record.rings || [];
    if (rings.length < 2) continue;
    let overlapped = false;
    for (let i = 0; i < rings.length && !overlapped; i += 1) {
      for (let j = i + 1; j < rings.length; j += 1) {
        if (rings[i].length < 4 || rings[j].length < 4) continue;

        // (b) borda compartilhada — oráculo v21: buraco colado na exterior
        // (f22 ~140 m / f43 ~38 m). Conta nos dois sentidos p/ arestas longas.
        const sharedAB = ringsSharedBoundaryLengthM(rings[j], rings[i], metricProjDef, SIMCAR_RING_SHARED_EDGE_TOL_M, crs);
        const sharedBA =
          sharedAB >= SIMCAR_RING_SHARED_EDGE_M
            ? sharedAB
            : ringsSharedBoundaryLengthM(rings[i], rings[j], metricProjDef, SIMCAR_RING_SHARED_EDGE_TOL_M, crs);
        const sharedM = Math.max(sharedAB, sharedBA);
        if (sharedM >= SIMCAR_RING_SHARED_EDGE_M) {
          overlapped = true;
          rows.push({
            camada: layerName,
            tipo: "aneis_sobrepostos",
            feicao: record.feature,
            parte: 0,
            anel: j,
            x: Number(rings[j][0][0]),
            y: Number(rings[j][0][1]),
            detalhe: `${SEMA_MSG_ANEIS_SOBREPOSTOS} (anéis ${i} e ${j}, borda compartilhada ${sharedM.toFixed(2)} m).`,
          });
          break;
        }

        // (a) sobreposição em área (parcial / buraco×buraco)
        let inter: Feature<Polygon | MultiPolygon> | null = null;
        try {
          inter = turfIntersect(
            turfFeatureCollection([
              { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [rings[i]] } } as Feature<Polygon>,
              { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [rings[j]] } } as Feature<Polygon>,
            ]) as any,
          ) as Feature<Polygon | MultiPolygon> | null;
        } catch {
          continue;
        }
        if (!inter?.geometry) continue;
        const polys = inter.geometry.type === "Polygon" ? [inter.geometry.coordinates] : inter.geometry.coordinates;
        let areaM2 = 0;
        for (const polygon of polys) areaM2 += polygonMetricAreaM2(polygon as number[][][], crs, metricProjDef);
        // buraco DENTRO da borda é o normal — sobreposição PARCIAL (nem
        // contido, nem disjunto) ou buraco×buraco com área é o que reprova.
        const areaI = polygonMetricAreaM2([rings[i]] as number[][][], crs, metricProjDef);
        const areaJ = polygonMetricAreaM2([rings[j]] as number[][][], crs, metricProjDef);
        const inner = Math.min(areaI, areaJ);
        const contained = Math.abs(areaM2 - inner) < Math.max(0.01, inner * 1e-6);
        // i===0 e hole contido SEM borda compartilhada: ok (buraco legítimo)
        if (i === 0 && contained) continue;
        if (areaM2 <= 0.01) continue; // toque pontual/resíduo
        overlapped = true;
        rows.push({
          camada: layerName,
          tipo: "aneis_sobrepostos",
          feicao: record.feature,
          parte: 0,
          anel: j,
          x: Number(rings[j][0][0]),
          y: Number(rings[j][0][1]),
          detalhe: `${SEMA_MSG_ANEIS_SOBREPOSTOS} (anéis ${i} e ${j}, ${areaM2.toFixed(2)} m²).`,
        });
        break;
      }
    }
  }
  return rows;
}
