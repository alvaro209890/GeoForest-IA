/**
 * Detector: vértices duplicados/muito próximos no mesmo anel (tolerância de 0,1 m do importador).
 */
import type { ParsedPolygonRecord } from "../../vertices-proximas";
import { ringGroupsForRecord } from "../../vertices-proximas";
import { SIMCAR_IMPORT_DUP_TOLERANCE_M } from "../constants";
import { GeometryErrorRow, TopologyDetectOptions } from "../types";
import { buildMetricBridge, ensureClosed, metricDistance, sameCoordinate } from "../utils";

/**
 * Encontra vértices consecutivos idênticos **ou** a menos de ~0,1 m
 * ("A geometria contém pontos repetidos" no importador SIMCAR) e anéis
 * colapsados com menos de 3 vértices distintos ("anel degenerado").
 * Trabalha sobre os anéis SEM o fechamento natural (ringGroupsForRecord
 * já o remove), então o par último→primeiro também é verificado.
 */
export function detectDuplicateVertices(
  layerName: string,
  records: ParsedPolygonRecord[],
  options: TopologyDetectOptions = {},
): GeometryErrorRow[] {
  const tolM =
    options.duplicateToleranceM === undefined
      ? SIMCAR_IMPORT_DUP_TOLERANCE_M
      : Math.max(0, Number(options.duplicateToleranceM));
  const bridge = buildMetricBridge(records);
  const rows: GeometryErrorRow[] = [];
  for (const record of records) {
    for (const group of ringGroupsForRecord(record)) {
      const coords = group.coords;
      if (!coords.length) continue;
      const distinct: number[][] = [];
      for (let i = 0; i < coords.length; i += 1) {
        const prev = i === 0 ? coords[coords.length - 1] : coords[i - 1];
        const exact = sameCoordinate(coords[i], prev);
        const near = !exact && tolM > 0 && metricDistance(coords[i], prev, bridge) <= tolM;
        if (i > 0 && (exact || near)) {
          const distM = exact ? 0 : metricDistance(coords[i], prev, bridge);
          rows.push({
            camada: layerName,
            tipo: "vertice_duplicado",
            feicao: record.feature,
            parte: group.part,
            anel: group.ring,
            x: Number(coords[i][0]),
            y: Number(coords[i][1]),
            detalhe: exact
              ? `Vértices ${i} e ${i + 1} do anel são idênticos.`
              : `Vértices ${i} e ${i + 1} do anel estão a ${distM.toFixed(3)} m (limite SIMCAR ${tolM} m — pontos repetidos).`,
          });
          continue;
        }
        if (i === coords.length - 1 && coords.length > 1) {
          const exactClose = sameCoordinate(coords[i], coords[0]);
          const nearClose =
            !exactClose && tolM > 0 && metricDistance(coords[i], coords[0], bridge) <= tolM;
          if (exactClose || nearClose) {
            rows.push({
              camada: layerName,
              tipo: "vertice_duplicado",
              feicao: record.feature,
              parte: group.part,
              anel: group.ring,
              x: Number(coords[i][0]),
              y: Number(coords[i][1]),
              detalhe: `Vértice ${i + 1} repete o primeiro vértice além do fechamento do anel.`,
            });
            continue;
          }
        }
        distinct.push(coords[i]);
      }
      if (distinct.length < 3) {
        const [x, y] = coords[0];
        rows.push({
          camada: layerName,
          tipo: "anel_degenerado",
          feicao: record.feature,
          parte: group.part,
          anel: group.ring,
          x: Number(x),
          y: Number(y),
          detalhe: `Anel com apenas ${distinct.length} vértice(s) distinto(s); polígono válido exige 3 ou mais.`,
        });
      }
    }
  }
  return rows;
}

/**
 * Limpa os anéis de um registro: remove vértices consecutivos duplicados e
 * descarta anéis degenerados (menos de 3 vértices distintos).
 */
export function cleanRecordRings(record: ParsedPolygonRecord): {
  record: ParsedPolygonRecord;
  removedVertices: number;
  droppedRings: number;
} {
  const rings: number[][][] = [];
  let removedVertices = 0;
  let droppedRings = 0;
  for (const ring of record.rings) {
    const out: number[][] = [];
    for (const point of ring) {
      const prev = out[out.length - 1];
      if (prev && sameCoordinate(prev, point)) {
        removedVertices += 1;
        continue;
      }
      out.push(point);
    }
    // Remove fechamento natural para contar vértices distintos e depois refecha.
    const open = out.length >= 2 && sameCoordinate(out[0], out[out.length - 1]) ? out.slice(0, -1) : out;
    if (open.length < 3) {
      droppedRings += 1;
      continue;
    }
    rings.push(ensureClosed(open));
  }
  return { record: { feature: record.feature, rings }, removedVertices, droppedRings };
}

/* ─────────────── check: borda de polígono se cruza ─────────────── */
