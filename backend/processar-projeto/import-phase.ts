/**
 * Fase 1 — importação: CRS, nomenclatura, atributos e erros de geometria.
 */
import type { GeometryErrorRow } from "../geometry-errors";
import { analyzeLayerGeometry, detectComplexPolygons, detectOverlappingRings } from "../geometry-errors";
import { checkSimcarConformity, recognizeSimcarLayer } from "../simcar-rules";
import { detectCrs, parsePolygonRecords } from "../vertices-proximas";
import { LOCAL_IMPORT_REJECTED_TEXT } from "./constants";
import { ImportPhaseResult } from "./types";
import { groupsFromZip } from "./utils";

/**
 * Fase Importar: inventário + conformidade estrutural + topologia do importador.
 * Corresponde a [CAR_IMPORTAR_SHAPEFILE] do SIMCAR / PDF "Relatório de importação".
 *
 * Erros impeditivos na importação (oráculo SEMA teste_1 / ARL):
 *  - borda_se_cruza → "Borda do polígono se cruza"
 *  - vertice_duplicado → "A geometria contém pontos repetidos"
 */
export function runImportPhase(zipBuffer: Buffer, filename = "projeto.zip"): ImportPhaseResult {
  const groups = groupsFromZip(zipBuffer);
  const warnings: string[] = [];
  const layersWithShp = groups.filter((g) => g.shp);

  const camadasReconhecidas = layersWithShp.map((g) => {
    const records = parsePolygonRecords(g.shp!.data);
    const crs = detectCrs(g.prj?.data.toString("utf8"));
    const code = recognizeSimcarLayer(g.name);
    return {
      name: g.name,
      code,
      featureCount: records.length,
      crsLabel: crs.missing ? "ausente" : crs.label,
    };
  });

  let rows: GeometryErrorRow[] = [];
  try {
    rows = checkSimcarConformity(
      layersWithShp.map((g) => ({
        name: g.name,
        shp: g.shp!.data,
        prjText: g.prj?.data.toString("utf8"),
        dbf: g.dbf?.data,
      })),
    );
  } catch (error: any) {
    warnings.push(`Importação: ${error?.message || "falha na conformidade"}`);
  }

  // Topologia na importação (SIMCAR reprova aqui — não só no ProcessarGeo).
  for (const g of layersWithShp) {
    try {
      const records = parsePolygonRecords(g.shp!.data);
      if (!records.length) continue;
      rows.push(
        ...analyzeLayerGeometry({
          layerName: g.name,
          records,
          checks: { selfIntersection: true, duplicateVertices: true },
        }),
      );
      // Oráculo 16/07/2026: registro MULTIPART reprova ("polígono complexo").
      rows.push(...detectComplexPolygons(g.name, records));
      // Oráculo v19: anéis do mesmo registro não podem se sobrepor.
      rows.push(...detectOverlappingRings(g.name, records, detectCrs(g.prj?.data.toString("utf8"))));
    } catch (error: any) {
      warnings.push(`Topologia (${g.name}): ${error?.message || "falha"}`);
    }
  }

  const ok = rows.length === 0;
  const lines: string[] = [];
  lines.push("Relatorio de importacao — Processar projeto (GeoForest / estilo SIMCAR)");
  lines.push(`Arquivo: ${filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    ok
      ? "Situação da importação: Aprovado"
      : LOCAL_IMPORT_REJECTED_TEXT,
  );
  lines.push("");
  lines.push("Camadas no ZIP:");
  for (const layer of camadasReconhecidas) {
    lines.push(
      `- ${layer.name}: codigo=${layer.code || "desconhecido"}; feicoes=${layer.featureCount}; CRS=${layer.crsLabel}`,
    );
  }
  lines.push("");
  lines.push(
    `Resultado da importacao: ${ok ? "OK (sem erros)" : `REPROVADO (${rows.length} inconsistencia(s))`}`,
  );
  lines.push("");
  if (!rows.length) {
    lines.push("Nenhum erro de importacao.");
  } else {
    lines.push("Erros encontrados (importacao SIMCAR):");
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.camada}\t${row.tipo}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      lines.push(`${row.camada}; tipo=${row.tipo}; feicao=${row.feicao}; ${row.detalhe}`);
    }
    lines.push("");
    lines.push("Resumo por feicao/tipo:");
    for (const [key, n] of counts) {
      const [camada, tipo] = key.split("\t");
      const label =
        tipo === "borda_se_cruza"
          ? "Borda do polígono se cruza"
          : tipo === "poligono_complexo"
            ? "Era esperado um polígono simples, porém veio polígono complexo"
            : tipo === "vertice_duplicado"
            ? "A geometria contém pontos repetidos"
            : tipo;
      lines.push(`- ${camada}: ${label} ${n}`);
    }
  }
  if (warnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const w of warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("Nota: pre-validacao local alinhada ao importador SEMA (borda se cruza / pontos repetidos / conformidade).");
  lines.push("");

  return {
    ok,
    rows,
    camadasReconhecidas,
    relatorioTexto: lines.join("\n"),
    warnings,
  };
}
