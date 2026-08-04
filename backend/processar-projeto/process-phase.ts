/**
 * Fase 2 — processamento: Anexo 01 e regras do ProcessarGeo.
 */
import type { GapPolygon, GeometryErrorRow, GeometrySettings, LayerFixResult, OverlapPolygon, RuleViolationPolygon, SimcarRuleLayer } from "../geometry-errors";
import { SIMCAR_PROCESS_PAIR_MIN_M2, analyzeLayerGeometry, detectAirAtpAreaConsistency, detectAirCompositionConsistency, detectOverlaps, detectReservatorioRules, detectSimcarContainment, detectSimcarForbiddenOverlaps, detectUmidaContainment, geometryPlanarAreaM2, metricProjDefFor, recordToGeoJSON, summarizeOverlapPairs } from "../geometry-errors";
import { isCancelRequested } from "../processing-jobs";
import type { SimcarLayerCode } from "../simcar-rules";
import { recognizeSimcarLayer } from "../simcar-rules";
import type { ProcessarGeoInputLayer } from "../simcar-processar-geo";
import { generateSimcarDerivedLayers, parsePointRecords } from "../simcar-processar-geo";
import type { ShpRecord } from "../shapefile-writer";
import { readDbfRows } from "../shapefile-writer";
import { SIRGAS_2000_PRJ, WGS84_PRJ, detectCrs, parsePolygonRecords } from "../vertices-proximas";
import { formatHaBR, overlapDisplayName } from "./constants";
import { OriginalLayerOut, ProcessPhaseResult, ProcessedLayerOut, QuadroAreaRow } from "./types";
import { computeGeometriasEncontradas, groupsFromZip } from "./utils";

/**
 * Fase Processar — espelha [CAR_PROCESSAR_GEOMETRIAS] / ProcessarGeo:
 * topologia + Anexo 01 + AIR×ATP + geração de APP/APPD/APPP/APPRL/AURD/ARLDR
 * e empacotamento do arquivo processado completo.
 */
export function runProcessPhase(
  zipBuffer: Buffer,
  settings: GeometrySettings = {},
  filename = "projeto.zip",
  onProgress?: (patch: { percent: number; message: string; stage?: string; layer?: string }) => void,
  jobId?: string,
): ProcessPhaseResult {
  const groups = groupsFromZip(zipBuffer).filter((g) => g.shp);
  const allRows: GeometryErrorRow[] = [];
  const allWarnings: string[] = [];
  const fixes: LayerFixResult[] = [];
  const allOverlaps: OverlapPolygon[] = [];
  const allGaps: GapPolygon[] = [];
  const allRuleViolations: RuleViolationPolygon[] = [];
  const analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }> = [];
  const processedLayers: ProcessedLayerOut[] = [];
  const originalLayers: OriginalLayerOut[] = [];
  const quadroAreas: QuadroAreaRow[] = [];
  let outputPrjText = "";
  const minArea = Number.isFinite(Number(settings.minOverlapM2)) ? Math.max(0, Number(settings.minOverlapM2)) : 1;

  onProgress?.({ percent: 5, message: "Iniciando processamento do projeto.", stage: "processing" });

  // Regras de projeto (ZIP inteiro)
  const ruleLayers: SimcarRuleLayer[] = groups.map((group) => ({
    name: group.name,
    records: parsePolygonRecords(group.shp!.data),
    crs: detectCrs(group.prj?.data.toString("utf8")),
    dbf: group.dbf?.data,
  }));

  // Camadas de PONTO (NASCENTE): contagem para a tabela "Geometrias encontradas".
  const pointCounts = new Map<SimcarLayerCode, number>();
  for (let i = 0; i < groups.length; i += 1) {
    if (ruleLayers[i].records.length) continue;
    const code = recognizeSimcarLayer(groups[i].name);
    if (!code) continue;
    try {
      const pts = parsePointRecords(groups[i].shp!.data);
      if (pts.length) pointCounts.set(code, (pointCounts.get(code) || 0) + pts.length);
    } catch {
      /* camada sem pontos */
    }
  }

  onProgress?.({ percent: 10, message: "Aplicando regras do Anexo 01 / AIR×ATP.", stage: "simcar-rules" });
  // Calibração do ProcessarGeo oficial (oráculo CAR 270069): a SEMA NÃO acusou
  // vazamentos de contenção de até 78 m² (0,0078 ha) — o processamento usa
  // limiar mínimo de 100 m² para contenção (o usuário pode subir via settings).
  const containmentMinAreaM2 = Math.max(minArea, 100);
  try {
    const containmentResult = detectSimcarContainment({ layers: ruleLayers, minAreaM2: containmentMinAreaM2 });
    allRows.push(...containmentResult.rows);
    allRuleViolations.push(...containmentResult.violations);
    allWarnings.push(...containmentResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Contenção Anexo 01: ${error?.message || "falha"}`);
  }
  try {
    // Oráculo v8 (16/07/2026): a ÚNICA isenção de sobreposição com corpo
    // d'água é o RESERVATORIO_ARTIFICIAL SEM barramento (ele deve estar
    // CONTIDO em AUAS/CONS; o par AUAS×RES 'N' de 442 m² não foi reportado,
    // e o MESMO par com 'S' foi). RIO/LAGOA/RES com barramento CONTAM
    // (ex.: "AVN está sobrepondo Lagoa Natural 1 vez").
    const barramentoByFeature = new Map<number, string>();
    for (const layer of ruleLayers) {
      if (recognizeSimcarLayer(layer.name) !== "RESERVATORIO_ARTIFICIAL" || !layer.dbf) continue;
      const dbfRows = readDbfRows(layer.dbf);
      dbfRows.forEach((row, index) => barramentoByFeature.set(index + 1, String(row.BARRAMENTO || "").trim()));
    }
    const semBarramento = (item: { code: SimcarLayerCode; feature: number }) =>
      item.code === "RESERVATORIO_ARTIFICIAL" && barramentoByFeature.get(item.feature) !== "S";
    // Semântica do ProcessarGeo: o PAR de feições só conta com soma ≥ 0,01 ha.
    const crossResult = detectSimcarForbiddenOverlaps({
      layers: ruleLayers,
      minAreaM2: Math.min(minArea, 1),
      pairMinAreaM2: SIMCAR_PROCESS_PAIR_MIN_M2,
      pairFilter: (a, b) => !semBarramento(a) && !semBarramento(b),
    });
    allRows.push(...crossResult.rows);
    allRuleViolations.push(...crossResult.violations);
    allWarnings.push(...crossResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Sobreposições proibidas: ${error?.message || "falha"}`);
  }
  try {
    const airAtpResult = detectAirAtpAreaConsistency({
      layers: ruleLayers,
      minDiffM2: minArea,
      maxDiffRatio: settings.airAtpMaxDiffRatio,
    });
    allRows.push(...airAtpResult.rows);
    allWarnings.push(...airAtpResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Soma AIR vs ATP: ${error?.message || "falha"}`);
  }
  // Regras do ProcessarGeo oficial (oráculo: relatório do CAR 270069)
  try {
    const resResult = detectReservatorioRules({ layers: ruleLayers, minAreaM2: minArea });
    allRows.push(...resResult.rows);
    allRuleViolations.push(...resResult.violations);
    allWarnings.push(...resResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Reservatório artificial: ${error?.message || "falha"}`);
  }
  try {
    const airCompResult = detectAirCompositionConsistency({ layers: ruleLayers });
    allRows.push(...airCompResult.rows);
    allWarnings.push(...airCompResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Composição da AIR: ${error?.message || "falha"}`);
  }
  try {
    // Oráculo v8: AREA_UMIDA deve caber em UMA feição de AVN/AUAS/CONS.
    const umidaResult = detectUmidaContainment({ layers: ruleLayers });
    allRows.push(...umidaResult.rows);
    allWarnings.push(...umidaResult.warnings);
  } catch (error: any) {
    allWarnings.push(`Contenção da Área Úmida: ${error?.message || "falha"}`);
  }

  // ─── ProcessarGeo: deriva APP, APPD, APPP, APPRL, AURD, ARLDR ───
  onProgress?.({ percent: 12, message: "Calculando APP / APPD / APPP / APPRL (ProcessarGeo).", stage: "app" });
  let derivedLayers: ReturnType<typeof generateSimcarDerivedLayers>["derived"] = [];
  try {
    const geoInputs: ProcessarGeoInputLayer[] = groups.map((group) => {
      const crs = detectCrs(group.prj?.data.toString("utf8"));
      const records = parsePolygonRecords(group.shp!.data);
      const points =
        records.length === 0 ? parsePointRecords(group.shp!.data) : undefined;
      return { name: group.name, records, crs, points };
    });
    // Also attach points for NASCENTE even if polygon parse found something wrong
    for (const input of geoInputs) {
      const code = recognizeSimcarLayer(input.name);
      if (code === "NASCENTE" && !input.points?.length) {
        const group = groups.find((g) => g.name === input.name);
        if (group?.shp) input.points = parsePointRecords(group.shp.data);
      }
    }
    const derivedResult = generateSimcarDerivedLayers(geoInputs);
    derivedLayers = derivedResult.derived;
    allRows.push(...derivedResult.errorRows);
    allWarnings.push(...derivedResult.warnings);
    for (const q of derivedResult.quadroApp) {
      quadroAreas.push({
        camada: q.feicao,
        codigo: q.feicao,
        feicoes: 1,
        erros: 0,
        corrigidas: 0,
        area_m2: q.area_m2,
        area_ha: q.area_ha,
      });
    }
  } catch (error: any) {
    allWarnings.push(`ProcessarGeo (APP): ${error?.message || "falha no cálculo de APP"}`);
  }

  const checks = {
    selfIntersection: true,
    duplicateVertices: true,
    overlaps: true,
    gaps: false, // ProcessarGeo oficial não valida vazios entre polígonos
  };

  for (let index = 0; index < groups.length; index += 1) {
    if (jobId && isCancelRequested(jobId)) throw new Error("cancel_requested");
    const group = groups[index];
    const percent = 15 + Math.round((index / Math.max(1, groups.length)) * 70);
    onProgress?.({
      percent,
      message: `Analisando ${group.name}.`,
      stage: "layer",
      layer: group.name,
    });

    try {
      const records = parsePolygonRecords(group.shp!.data);
      const crs = detectCrs(group.prj?.data.toString("utf8"));
      if (!outputPrjText) {
        outputPrjText = crs.prjText || (crs.label === "EPSG:4326" ? WGS84_PRJ : SIRGAS_2000_PRJ);
      }
      const rows = analyzeLayerGeometry({ layerName: group.name, records, checks });
      // Sobreposição na MESMA camada — semântica do ProcessarGeo: par ≥ 0,01 ha.
      // (O ProcessarGeo oficial NÃO verifica vazios/gaps — isso fica só na aba
      // Erros de Geometria.)
      const overlapResult = detectOverlaps({
        layerName: group.name,
        records,
        crs,
        minOverlapM2: Math.min(minArea, 1),
        pairMinAreaM2: SIMCAR_PROCESS_PAIR_MIN_M2,
      });
      rows.push(...overlapResult.rows);
      allOverlaps.push(...overlapResult.overlapPolygons);
      allWarnings.push(...overlapResult.warnings);

      allRows.push(...rows);
      analyzedLayers.push({
        name: group.name,
        featureCount: records.length,
        errors: rows.length,
        crsLabel: crs.label,
      });

      // Arquivo processado = camadas COMO ENVIADAS (o SIMCAR não corrige a
      // geometria do técnico — reprova na importação; aqui só replicamos).
      processedLayers.push({
        name: group.name,
        records: records.map(
          (rec) =>
            ({
              type: "polygon",
              rings: rec.rings,
              attributes: { camada: group.name, feicao: rec.feature, corrigido: "N" },
            }) as ShpRecord,
        ),
        fixedFeatures: 0,
        featureCount: records.length,
      });

      originalLayers.push({
        name: group.name,
        shp: group.shp!.data,
        dbf: group.dbf?.data,
        prjText: crs.prjText || outputPrjText || SIRGAS_2000_PRJ,
      });

      // Área PLANAR em UTM (método da SEMA) — ringsAreaAbs em coords geográficas
      // devolveria graus², inútil para o quadro.
      const layerProjDef = metricProjDefFor(crs, records);
      let layerArea = 0;
      for (const rec of records) {
        const geometry = recordToGeoJSON(rec);
        if (geometry) layerArea += geometryPlanarAreaM2(geometry, crs, layerProjDef);
      }
      quadroAreas.push({
        camada: group.name,
        codigo: recognizeSimcarLayer(group.name) || "",
        feicoes: records.length,
        erros: rows.length,
        corrigidas: 0,
        area_m2: layerArea,
        area_ha: layerArea / 10000,
      });
    } catch (error: any) {
      allWarnings.push(`${group.name}: ${error?.message || "erro ao processar camada"}`);
      analyzedLayers.push({ name: group.name, featureCount: 0, errors: 0, crsLabel: "erro" });
    }
  }

  // Inclui camadas derivadas (APP, APPD…) no arquivo processado
  for (const d of derivedLayers) {
    processedLayers.push({
      name: d.name,
      records: d.records,
      fixedFeatures: 0,
      featureCount: d.featureCount,
    });
    analyzedLayers.push({
      name: d.name,
      featureCount: d.featureCount,
      errors: 0,
      crsLabel: "derivada (ProcessarGeo)",
    });
  }

  // PARES de sobreposição (semântica de contagem do relatório da SEMA)
  const overlapPairs = summarizeOverlapPairs(allOverlaps, allRuleViolations);
  const geometriasEncontradas = computeGeometriasEncontradas({ ruleLayers, pointCounts });

  const lines: string[] = [];
  lines.push("Relatório de processamento");
  lines.push(
    allRows.length
      ? "Situação do processamento: Reprovado - Corrija os erros encontrados e processe novamente!"
      : "Situação do processamento: Processado com sucesso!",
  );
  lines.push(`Arquivo: ${filename}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("");

  // ── seções no formato do relatório oficial da SEMA ──
  const countByDetail = (rows: GeometryErrorRow[]) => {
    const map = new Map<string, { camada: string; detalhe: string; n: number }>();
    for (const row of rows) {
      const key = `${row.camada}\t${row.detalhe}`;
      const cur = map.get(key);
      if (cur) cur.n += 1;
      else map.set(key, { camada: row.camada, detalhe: row.detalhe, n: 1 });
    }
    return [...map.values()];
  };

  const espaciais = allRows.filter(
    (r) =>
      r.tipo === "reservatorio_fora_uso_antropico" ||
      r.tipo === "fora_do_continente" ||
      r.tipo === "umida_fora_cobertura",
  );
  lines.push("Erros espaciais");
  if (!espaciais.length) lines.push("(nenhum)");
  for (const item of countByDetail(espaciais)) {
    lines.push(`${item.camada} | ${item.detalhe} | Quantidade: ${item.n}`);
  }
  lines.push("");

  lines.push("Erros de sobreposição e obrigatoriedades");
  const composicao = allRows.filter((r) => r.tipo === "air_composicao_area" || r.tipo === "air_atp_area");
  for (const row of composicao) lines.push(row.detalhe);
  // "X está sobrepondo Y n vezes." — n = PARES de feições com soma ≥ 0,01 ha
  // (oráculo: ARL×ARL 106 · AVN×AVN 106 · AVN×Área Consolidada 8 · AUAS×Área
  // Consolidada 2, exatos). Nomes de exibição como no PDF da SEMA.
  const overlapCounts = new Map<string, number>();
  for (const pair of overlapPairs) {
    const key = `${pair.camadaA}\t${pair.camadaB}`;
    overlapCounts.set(key, (overlapCounts.get(key) || 0) + 1);
  }
  for (const [key, n] of overlapCounts) {
    const [a, b] = key.split("\t");
    lines.push(`${overlapDisplayName(a)} está sobrepondo ${overlapDisplayName(b)} ${n} ${n === 1 ? "vez" : "vezes"}.`);
  }
  if (overlapCounts.size) {
    lines.push("");
    lines.push(
      "* Os locais onde ocorrem as sobreposições podem ser encontrados no arquivo “Pontos de sobreposição” disponível no sistema.",
    );
  }
  if (!composicao.length && !overlapCounts.size) lines.push("(nenhum)");
  lines.push("");

  const atributos = allRows.filter((r) => r.tipo.startsWith("atributo_"));
  lines.push("Erros de atributos");
  if (!atributos.length) lines.push("(nenhum)");
  for (const item of countByDetail(atributos)) {
    lines.push(`${item.camada} | ${item.detalhe} | Quantidade: ${item.n}`);
  }
  lines.push("");

  lines.push("Geometrias encontradas");
  for (const g of geometriasEncontradas) {
    lines.push(`${g.rotulo} | ${g.descricao} | ${formatHaBR.format(g.areaHa)} | Quantidade: ${g.quantidade}`);
  }
  lines.push("");

  lines.push("Camadas analisadas / geradas:");
  for (const layer of analyzedLayers) {
    lines.push(`- ${layer.name}: feicoes=${layer.featureCount}; erros=${layer.errors}; CRS=${layer.crsLabel}`);
  }
  lines.push("");
  lines.push(`Total de inconsistencias: ${allRows.length}`);
  lines.push(`Camadas no arquivo processado: ${processedLayers.length}`);
  const derivedNames = derivedLayers.map((d) => d.code).join(", ") || "(nenhuma — falta hidrografia)";
  lines.push(`Camadas derivadas ProcessarGeo: ${derivedNames}`);
  lines.push("");
  if (allRows.length) {
    lines.push("Detalhe dos erros (por feição):");
    for (const row of allRows) {
      lines.push(
        `${row.camada}; tipo=${row.tipo}; feicao=${row.feicao}; xy=(${row.x}, ${row.y}); ${row.detalhe}`,
      );
    }
  }
  lines.push("");
  lines.push("Artefatos gerados (fluxo SIMCAR completo):");
  lines.push("- arquivo_enviado.zip — shapes enviados");
  lines.push("- arquivo_processado.zip — projeto processado (limpos + APP/APPD/APPP/APPRL/AURD/ARLDR)");
  lines.push("- arquivo_conferencia.zip — areas por feicao");
  lines.push("- erros_processamento.zip — ERROS_DE_SOBREPOSICAO (artefato oficial SEMA)");
  lines.push("- erros_diagnostico.zip — diagnosticos extras GeoForest");
  lines.push("- erros_processamento_app.zip — pontos de erro de calculo de APP");
  lines.push("- quadro_areas.csv — quadro de areas (inclui APP*)");
  if (allRows.some((r) => r.tipo === "air_atp_area")) {
    lines.push("");
    lines.push("Soma AIR vs ATP divergente (Manual Projeto Geografico).");
  }
  if (allWarnings.length) {
    lines.push("");
    lines.push("Avisos:");
    for (const w of allWarnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push("Motor local alinhado ao fluxo Importar→ProcessarGeo do SIMCAR/SEMA-MT.");
  lines.push("Faixas de APP: Codigo Florestal (Art. 4). Detalhes de dominio SEMA podem divergir.");
  lines.push("");

  return {
    rows: allRows,
    warnings: allWarnings,
    analyzedLayers,
    fixedLayers: fixes.map((f) => ({ name: f.layerName, fixedFeatures: f.fixedFeatures })),
    overlapPolygons: allOverlaps,
    gapPolygons: allGaps,
    ruleViolations: allRuleViolations,
    overlapPairs,
    geometriasEncontradas,
    fixes,
    processedLayers,
    originalLayers,
    quadroAreas,
    prjText: outputPrjText || SIRGAS_2000_PRJ,
    relatorioTexto: lines.join("\n"),
  };
}

/* ─────────────────────── ZIP ─────────────────────── */
