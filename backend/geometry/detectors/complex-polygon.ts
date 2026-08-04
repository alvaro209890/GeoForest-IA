/**
 * Detector: registro multipart ("polígono complexo") reprovado pelo importador da SEMA.
 */
import type { ParsedPolygonRecord } from "../../vertices-proximas";
import { SEMA_MSG_POLIGONO_COMPLEXO } from "../constants";
import { GeometryErrorRow } from "../types";

/**
 * Importador da SEMA (oráculo CAR 270069, upload de 16/07/2026): cada
 * registro do .shp deve ser um polígono SIMPLES — um único anel EXTERIOR
 * (buracos/anéis internos são aceitos; o dado aprovado os tem). O critério
 * é ESTRUTURAL, pela ORIENTAÇÃO dos anéis no registro (spec shapefile:
 * exterior = horário): mais de um anel horário reprova, mesmo quando o anel
 * extra caberia "dentro" do principal — comprovado no upload v2 (lascas
 * exteriores dentro do bbox do anel principal reprovaram ARL/AVN/AUAS).
 */
export function detectComplexPolygons(
  layerName: string,
  records: ParsedPolygonRecord[],
): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  for (const record of records) {
    let exteriors = 0;
    let firstPoint: number[] | null = null;
    for (const ring of record.rings || []) {
      if (!ring || ring.length < 4) continue;
      let s = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      if (s / 2 < 0) {
        exteriors += 1; // horário = anel exterior na spec shapefile
        if (!firstPoint) firstPoint = ring[0];
      }
    }
    if (exteriors <= 1) continue;
    const p = firstPoint || record.rings?.[0]?.[0] || [NaN, NaN];
    rows.push({
      camada: layerName,
      tipo: "poligono_complexo",
      feicao: record.feature,
      parte: 0,
      anel: 0,
      x: Number(p[0]),
      y: Number(p[1]),
      detalhe: `${SEMA_MSG_POLIGONO_COMPLEXO} (registro com ${exteriors} anéis exteriores).`,
    });
  }
  return rows;
}

/* ─────────────────────── exportação ─────────────────────── */
