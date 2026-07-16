/**
 * Processar projeto — fluxo em 2 fases no estilo Projeto Geográfico SIMCAR.
 *
 * Fase 1 (Importar): conformidade estrutural (CRS, 2D, nomenclatura, atributos, ATP)
 *   + topologia impeditiva do importador SEMA (borda se cruza / pontos repetidos).
 *   Se houver qualquer erro, a importação é **Reprovada** e o Processar não libera
 *   (igual ao PDF "Situação da importação: Reprovado").
 * Fase 2 (Processar): topologia adicional (overlaps/gaps) + Anexo 01 + AIR×ATP + APP*.
 *   Só roda após importação OK.
 *
 * Motor local reutiliza geometry-errors.ts / simcar-rules.ts.
 * Não substitui o validador oficial da SEMA; backend roda no mesmo host
 * do recorte SIMCAR (PC físico + tunnel), não em Render.
 *
 * Endpoints:
 *   POST   /api/processar-projeto/upload
 *   POST   /api/processar-projeto/importar
 *   POST   /api/processar-projeto/processar
 *   GET    /api/processar-projeto/jobs/:id/status
 *   GET    /api/processar-projeto/jobs/:id/events
 *   GET    /api/processar-projeto/download/:id
 *   DELETE /api/processar-projeto/jobs/:id
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  analyzeLayerGeometry,
  detectAirAtpAreaConsistency,
  detectAirCompositionConsistency,
  detectOverlaps,
  detectReservatorioRules,
  detectSimcarContainment,
  detectSimcarForbiddenOverlaps,
  geometryPlanarAreaM2,
  LAYER_LEVEL_TIPOS,
  metricProjDefFor,
  recordToGeoJSON,
  SIMCAR_PROCESS_PAIR_MIN_M2,
  summarizeOverlapPairs,
  type GapPolygon,
  type GeometryErrorRow,
  type GeometrySettings,
  type LayerFixResult,
  type OverlapPairSummary,
  type OverlapPolygon,
  type RuleViolationPolygon,
  type SimcarRuleLayer,
} from "./geometry-errors";
import {
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  union as turfUnion,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import {
  checkSimcarConformity,
  recognizeSimcarLayer,
  type SimcarLayerCode,
} from "./simcar-rules";
import {
  generateSimcarDerivedLayers,
  parsePointRecords,
  type ProcessarGeoInputLayer,
} from "./simcar-processar-geo";
import {
  buildDbfBuffer,
  buildPointShpAndShx,
  buildShpAndShx,
  geojsonToShpRecords,
  type DbfFieldDef,
  type PointShpRecord,
  type ShpRecord,
} from "./shapefile-writer";
import {
  detectCrs,
  getZipLayerGroups,
  listPolygonLayersFromZip,
  parsePolygonRecords,
  SIRGAS_2000_PRJ,
  WGS84_PRJ,
  visibleVerticesLayers,
} from "./vertices-proximas";
import { buildImportReportPdf } from "./import-report-pdf";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const subscribers = new Map<string, Set<Response>>();

/* ─────────────────────── pure phases ─────────────────────── */

export type ImportPhaseResult = {
  ok: boolean;
  rows: GeometryErrorRow[];
  camadasReconhecidas: Array<{ name: string; code: string | null; featureCount: number; crsLabel: string }>;
  relatorioTexto: string;
  warnings: string[];
  /** Preenchido pela rota de importação quando o PDF é gerado e gravado. */
  pdfRelativePath?: string;
  pdfUrl?: string;
};

/** Camada pronta para gravação em shapefile (processado / conferência). */
export type ProcessedLayerOut = {
  name: string;
  records: ShpRecord[];
  fixedFeatures: number;
  featureCount: number;
};

/** Cópia dos arquivos originais do ZIP de entrada (arquivo enviado). */
export type OriginalLayerOut = {
  name: string;
  shp: Buffer;
  dbf?: Buffer;
  prjText: string;
};

export type QuadroAreaRow = {
  camada: string;
  codigo: string;
  feicoes: number;
  erros: number;
  corrigidas: number;
  area_m2: number;
  area_ha: number;
};

export type ProcessPhaseResult = {
  rows: GeometryErrorRow[];
  warnings: string[];
  analyzedLayers: Array<{ name: string; featureCount: number; errors: number; crsLabel: string }>;
  fixedLayers: Array<{ name: string; fixedFeatures: number }>;
  overlapPolygons: OverlapPolygon[];
  gapPolygons: GapPolygon[];
  ruleViolations: RuleViolationPolygon[];
  /** PARES de sobreposição (semântica do relatório da SEMA: soma ≥ 0,01 ha). */
  overlapPairs: OverlapPairSummary[];
  /** Tabela "Geometrias encontradas" no formato oficial do relatório SEMA. */
  geometriasEncontradas: Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }>;
  fixes: LayerFixResult[];
  /** Sempre preenchido: camadas limpas (unkink + vértices) = base do arquivo processado. */
  processedLayers: ProcessedLayerOut[];
  /** Camadas originais do ZIP (arquivo enviado). */
  originalLayers: OriginalLayerOut[];
  quadroAreas: QuadroAreaRow[];
  prjText: string;
  relatorioTexto: string;
};

function groupsFromZip(zipBuffer: Buffer) {
  return getZipLayerGroups(zipBuffer);
}

/* ────────── relatório oficial do ProcessarGeo (oráculo CAR 270069) ────────── */

/** Nomes de exibição que o relatório da SEMA usa nas frases "X está sobrepondo Y". */
const OVERLAP_DISPLAY_NAME: Partial<Record<SimcarLayerCode, string>> = {
  AREA_CONSOLIDADA: "Área Consolidada",
};

function overlapDisplayName(layerName: string): string {
  const code = recognizeSimcarLayer(layerName);
  return (code && OVERLAP_DISPLAY_NAME[code]) || code || layerName;
}

const formatHaBR = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/**
 * Linhas FIXAS da tabela "Geometrias encontradas" do relatório oficial da
 * SEMA (mesma ordem/rótulos/descrições do PDF; linhas zeradas aparecem).
 * RIO agrega todas as classes de curso d'água; NASCENTE conta pontos.
 */
const GEOMETRIAS_TABELA: Array<{
  rotulo: string;
  descricao: string;
  codes: SimcarLayerCode[];
  ponto?: boolean;
  /** ARL: a SEMA recorta UTILIDADE_PUBLICA/INTERESSE_SOCIAL antes de medir. */
  recorteUp?: boolean;
}> = [
  { rotulo: "ATP", descricao: "Área Total da Propriedade", codes: ["ATP"] },
  { rotulo: "AIR", descricao: "Área do Imóvel Rural (Matrícula/Posse)", codes: ["AIR"] },
  { rotulo: "UTILIDADE_PUBLICA", descricao: "Área de Utilidade Pública", codes: ["AREA_UTILIDADE_PUBLICA"] },
  { rotulo: "INTERESSE_SOCIAL", descricao: "Área de Interesse Social", codes: ["AREA_INTERESSE_SOCIAL"] },
  { rotulo: "NASCENTE", descricao: "Nascentes e Olhos d’água perenes", codes: ["NASCENTE"], ponto: true },
  {
    rotulo: "RIO",
    descricao: "Área de curso de água",
    codes: ["RIO_MENOR_10", "RIO_10_ATE_50", "RIO_50_ATE_200", "RIO_200_ATE_600", "RIO_MAIOR_600"],
  },
  { rotulo: "LAGOA_NATURAL", descricao: "Área de Lagoa Natural", codes: ["LAGO_LAGOA_NATURAL"] },
  { rotulo: "RESERVATORIO_ARTIFICIAL", descricao: "Área de Reservatório Artificial", codes: ["RESERVATORIO_ARTIFICIAL"] },
  { rotulo: "AREA_DECLIVIDADE", descricao: "Área de Declividade", codes: ["AREA_DECLIVIDADE"] },
  { rotulo: "BORDA_CHAPADA", descricao: "Borda de Chapada", codes: ["BORDA_CHAPADA"] },
  { rotulo: "AREA_TOPO_MORRO", descricao: "Área de Topo de Morro", codes: ["AREA_TOPO_MORRO"] },
  { rotulo: "AREA_ALTITUDE_1800", descricao: "Área com altitude acima de 1800m", codes: ["AREA_ALTITUDE_1800"] },
  { rotulo: "AREA_UMIDA", descricao: "Área Umida", codes: ["AREA_UMIDA"] },
  { rotulo: "AREA_USO_RESTRITO", descricao: "Área Uso Restrito", codes: ["AREA_USO_RESTRITO"] },
  { rotulo: "AURD", descricao: "Área Uso Restrito Degradado", codes: ["AURD"] },
  { rotulo: "AVN", descricao: "Área de Vegetação Nativa", codes: ["AVN"] },
  { rotulo: "AUAS", descricao: "Área de Uso Antropizado do Solo", codes: ["AUAS"] },
  { rotulo: "AREA_CONSOLIDADA", descricao: "Área Consolidada", codes: ["AREA_CONSOLIDADA"] },
  { rotulo: "TIPOLOGIA_VEGETAL", descricao: "Área de Tipologia Vegetal", codes: ["TIPOLOGIA_VEGETAL"] },
  {
    rotulo: "RESTINGA",
    descricao: "Área de Restinga (fixadoras de dunas ou estabilizadora de mangues)",
    codes: ["RESTINGA"],
  },
  { rotulo: "MANGUEZAL", descricao: "Área de Manguezal", codes: ["MANGUEZAL"] },
  { rotulo: "VEREDA", descricao: "Área de Vereda", codes: ["VEREDA"] },
  { rotulo: "ARCUC", descricao: "Área Reservada para Compensação em Unidade de Conservação", codes: ["ARCUC"] },
  { rotulo: "ARLREM", descricao: "Área de Reserva Legal Realocada para Exploração Mineral", codes: ["ARLREM"] },
  { rotulo: "ARL", descricao: "Área de Reserva Legal", codes: ["ARL"], recorteUp: true },
];

/**
 * Calcula a tabela "Geometrias encontradas" como a SEMA: área PLANAR em UTM
 * (validado a ≤0,0003 ha no oráculo) e, na linha ARL, recorte de
 * UTILIDADE_PUBLICA/INTERESSE_SOCIAL antes de medir (área e quantidade das
 * partes resultantes; oráculo: ARL 62.302,3082 ha = ARL − UP).
 */
function computeGeometriasEncontradas(args: {
  ruleLayers: SimcarRuleLayer[];
  pointCounts: Map<SimcarLayerCode, number>;
}): Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }> {
  const byCode = new Map<SimcarLayerCode, Array<{ layer: SimcarRuleLayer; metricProjDef: string }>>();
  for (const layer of args.ruleLayers) {
    const code = recognizeSimcarLayer(layer.name);
    if (!code) continue;
    const entry = { layer, metricProjDef: metricProjDefFor(layer.crs, layer.records) };
    const list = byCode.get(code);
    if (list) list.push(entry);
    else byCode.set(code, [entry]);
  }
  const layersOf = (codes: SimcarLayerCode[]) => codes.flatMap((code) => byCode.get(code) || []);

  let eraseUnion: Feature<Polygon | MultiPolygon> | null = null;
  for (const { layer } of layersOf(["AREA_UTILIDADE_PUBLICA", "AREA_INTERESSE_SOCIAL"])) {
    for (const rec of layer.records) {
      const geometry = recordToGeoJSON(rec);
      if (!geometry) continue;
      const f = { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>;
      try {
        eraseUnion = eraseUnion ? (turfUnion(turfFeatureCollection([eraseUnion, f]) as any) as any) : f;
      } catch {
        /* união falhou nesta feição: segue com as demais */
      }
    }
  }

  const rows: Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }> = [];
  for (const def of GEOMETRIAS_TABELA) {
    if (def.ponto) {
      const quantidade = def.codes.reduce((sum, code) => sum + (args.pointCounts.get(code) || 0), 0);
      rows.push({ rotulo: def.rotulo, descricao: def.descricao, areaHa: 0, quantidade });
      continue;
    }
    let areaM2 = 0;
    let quantidade = 0;
    for (const { layer, metricProjDef } of layersOf(def.codes)) {
      for (const rec of layer.records) {
        const geometry = recordToGeoJSON(rec);
        if (!geometry) continue;
        if (def.recorteUp && eraseUnion) {
          let diff: Feature<Polygon | MultiPolygon> | null;
          try {
            diff = turfDifference(
              turfFeatureCollection([
                { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>,
                eraseUnion,
              ]) as any,
            ) as Feature<Polygon | MultiPolygon> | null;
          } catch {
            diff = { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>;
          }
          if (!diff?.geometry) continue; // feição toda dentro do recorte
          const polys =
            diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
          for (const poly of polys) {
            const partM2 = geometryPlanarAreaM2(
              { type: "Polygon", coordinates: poly as number[][][] },
              layer.crs,
              metricProjDef,
            );
            if (partM2 < 0.01) continue; // resíduo numérico do recorte
            areaM2 += partM2;
            quantidade += 1;
          }
        } else {
          areaM2 += geometryPlanarAreaM2(geometry, layer.crs, metricProjDef);
          quantidade += 1;
        }
      }
    }
    rows.push({ rotulo: def.rotulo, descricao: def.descricao, areaHa: areaM2 / 10000, quantidade });
  }
  return rows;
}

/** Mensagem espelhando o PDF SEMA quando a importação falha. */
export const IMPORT_REPROVADO_MSG =
  "Situação da importação: Reprovado - Corrija os erros encontrados e envie novamente!";

/**
 * Gate duro: Processar só libera com importação OK (como no SIMCAR).
 * Lança Error se reprovado — usado pela API e por testes unitários.
 */
export function assertImportAllowsProcess(importSnapshot: {
  ok?: boolean;
  status?: string;
  rows?: GeometryErrorRow[];
} | null | undefined): void {
  if (!importSnapshot) {
    throw new Error("Execute a importação antes de processar.");
  }
  if (importSnapshot.status === "import_ok" || importSnapshot.ok === true) return;
  if (importSnapshot.status === "import_failed" || importSnapshot.ok === false) {
    throw new Error(IMPORT_REPROVADO_MSG);
  }
  // Snapshot sem flag explícita: qualquer row impede o processar.
  if (Array.isArray(importSnapshot.rows) && importSnapshot.rows.length > 0) {
    throw new Error(IMPORT_REPROVADO_MSG);
  }
  throw new Error("Execute a importação antes de processar.");
}

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
      : IMPORT_REPROVADO_MSG,
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
    // Semântica do ProcessarGeo: o PAR de feições só conta com soma ≥ 0,01 ha.
    const crossResult = detectSimcarForbiddenOverlaps({
      layers: ruleLayers,
      minAreaM2: Math.min(minArea, 1),
      pairMinAreaM2: SIMCAR_PROCESS_PAIR_MIN_M2,
    });
    // Oráculo: o ProcessarGeo oficial não reporta sobreposição com hidrografia
    // (AVN×RIO etc.) — esses pares ficam só na aba Erros de Geometria.
    const isHydro = (layerName: string) => {
      const code = recognizeSimcarLayer(layerName);
      return (
        !!code &&
        ["RIO_MENOR_10", "RIO_10_ATE_50", "RIO_50_ATE_200", "RIO_200_ATE_600", "RIO_MAIOR_600", "LAGO_LAGOA_NATURAL", "RESERVATORIO_ARTIFICIAL"].includes(code)
      );
    };
    const keptViolations = crossResult.violations.filter(
      (v) => v.regra !== "sobreposicao" || (!isHydro(v.camadaA) && !isHydro(v.camadaB)),
    );
    const keptRows = crossResult.rows.filter((row) => {
      if (row.tipo !== "sobreposicao_proibida") return true;
      if (isHydro(row.camada)) return false;
      return !/RIO_|LAGO|RESERVATORIO/i.test(row.detalhe);
    });
    allRows.push(...keptRows);
    allRuleViolations.push(...keptViolations);
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

  const espaciais = allRows.filter((r) => r.tipo === "reservatorio_fora_uso_antropico" || r.tipo === "fora_do_continente");
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

const errorPointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "tipo", type: "C", length: 24, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "x", type: "F", length: 18, decimals: 8 },
  { name: "y", type: "F", length: 18, decimals: 8 },
  { name: "detalhe", type: "C", length: 120, decimals: 0 },
];

const overlapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "feicao_b", type: "N", length: 8, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

const ruleViolationFields: DbfFieldDef[] = [
  { name: "camada_a", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "camada_b", type: "C", length: 40, decimals: 0 },
  { name: "regra", type: "C", length: 12, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

const fixedLayerFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

const processadoFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

const conferenciaFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: GeometryErrorRow[]): Buffer {
  const headers = ["camada", "tipo", "feicao", "parte", "anel", "x", "y", "detalhe"];
  const lines = rows.map((row) => headers.map((h) => csvEscape((row as any)[h])).join(";"));
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

function buildQuadroCsv(rows: QuadroAreaRow[]): Buffer {
  const headers = ["camada", "codigo", "feicoes", "erros", "corrigidas", "area_m2", "area_ha"];
  const lines = rows.map((row) =>
    headers.map((h) => csvEscape((row as any)[h])).join(";"),
  );
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

function appendPointSet(
  archive: { append: (data: Buffer, opts: { name: string }) => void },
  folder: string,
  baseName: string,
  records: PointShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): void {
  const base = folder ? `${folder}/${baseName}` : baseName;
  const points = buildPointShpAndShx(records, 1);
  archive.append(points.shp, { name: `${base}.shp` });
  archive.append(points.shx, { name: `${base}.shx` });
  archive.append(buildDbfBuffer(records.map((p) => p.attributes), fields), { name: `${base}.dbf` });
  archive.append(Buffer.from(prj, "utf8"), { name: `${base}.prj` });
}

/** Monta um ZIP interno (ex.: arquivo_processado.zip) a partir de entradas buffer. */
function buildNestedZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.data, { name: f.name });
    archive.finalize().catch(reject);
  });
}

function layerShpFiles(
  name: string,
  records: ShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): Array<{ name: string; data: Buffer }> {
  const safe = safeSegment(name) || "camada";
  const built = buildShpAndShx(records, 5);
  return [
    { name: `${safe}.shp`, data: built.shp },
    { name: `${safe}.shx`, data: built.shx },
    { name: `${safe}.dbf`, data: buildDbfBuffer(records.map((r) => r.attributes), fields) },
    { name: `${safe}.prj`, data: Buffer.from(prj, "utf8") },
  ];
}

/**
 * ZIP completo no espírito SIMCAR:
 * - arquivo_enviado (+ .zip)
 * - arquivo_processado (+ .zip)
 * - arquivo_conferencia (+ .zip)
 * - erros / erros_processamento.zip
 * - relatórios e quadro de áreas
 */
export async function buildProcessarProjetoZip(args: {
  importRelatorio: string;
  process: ProcessPhaseResult;
  importRows?: GeometryErrorRow[];
}): Promise<Buffer> {
  const allRows = [...(args.importRows || []), ...args.process.rows];
  const prj = args.process.prjText || SIRGAS_2000_PRJ;
  const proc = args.process;

  const pointRecords: PointShpRecord[] = proc.rows
    .filter((row) => !LAYER_LEVEL_TIPOS.has(row.tipo))
    .map((row) => ({
      coordinates: [row.x, row.y] as [number, number],
      attributes: {
        camada: row.camada,
        tipo: row.tipo,
        feicao: row.feicao,
        parte: row.parte,
        anel: row.anel,
        x: row.x,
        y: row.y,
        detalhe: row.detalhe,
      },
    }));

  // Nested: arquivo_processado.zip
  const processadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    processadoFiles.push(...layerShpFiles(layer.name, layer.records, processadoFields, prj));
  }
  const processadoZip = await buildNestedZip(processadoFiles);

  // Nested: arquivo_conferencia.zip (mesmas geometrias + áreas em UTM planar,
  // método de área da SEMA)
  const conferenciaCrs = detectCrs(prj);
  const conferenciaFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    const layerProjDef = metricProjDefFor(
      conferenciaCrs,
      layer.records.map((rec, index) => ({ feature: index + 1, rings: rec.rings || [] })) as any,
    );
    const withArea: ShpRecord[] = layer.records.map((rec, index) => {
      const geometry = recordToGeoJSON({ feature: index + 1, rings: rec.rings || [] } as any);
      const areaM2 = geometry ? geometryPlanarAreaM2(geometry, conferenciaCrs, layerProjDef) : 0;
      return {
        ...rec,
        attributes: {
          ...rec.attributes,
          area_m2: Number(areaM2.toFixed(2)),
          area_ha: Number((areaM2 / 10000).toFixed(6)),
        },
      };
    });
    conferenciaFiles.push(...layerShpFiles(layer.name, withArea, conferenciaFields, prj));
  }
  const conferenciaZip = await buildNestedZip(conferenciaFiles);

  // Nested: arquivo_enviado.zip (originais)
  const enviadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.originalLayers) {
    const safe = safeSegment(layer.name) || "camada";
    // Reconstrói shx a partir do shp parseado
    const records = parsePolygonRecords(layer.shp);
    const shpRecords: ShpRecord[] = records.map((r) => ({
      type: "polygon" as const,
      rings: r.rings,
      attributes: { feicao: r.feature },
    }));
    if (shpRecords.length) {
      const built = buildShpAndShx(shpRecords, 5);
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
      enviadoFiles.push({ name: `${safe}.shx`, data: built.shx });
    } else {
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
    }
    if (layer.dbf) enviadoFiles.push({ name: `${safe}.dbf`, data: layer.dbf });
    else {
      enviadoFiles.push({
        name: `${safe}.dbf`,
        data: buildDbfBuffer(
          records.map((r) => ({ feicao: r.feature })),
          [{ name: "feicao", type: "N", length: 8, decimals: 0 }],
        ),
      });
    }
    enviadoFiles.push({ name: `${safe}.prj`, data: Buffer.from(layer.prjText || prj, "utf8") });
  }
  const enviadoZip = await buildNestedZip(enviadoFiles);

  // Nested: erros_processamento.zip — SÓ o artefato oficial da SEMA
  // (ERROS_DE_SOBREPOSICAO: pontos com ID + DETALHES "A com B" em nomes de
  // código, UM por PAR de feições — mesmo schema do download oficial).
  const errosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const centroidOf = (geometry: { type: string; coordinates: any }): [number, number] => {
      const ring: number[][] =
        geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0] || [];
      let sx = 0;
      let sy = 0;
      for (const p of ring) {
        sx += Number(p[0]) || 0;
        sy += Number(p[1]) || 0;
      }
      const n = Math.max(1, ring.length);
      return [sx / n, sy / n];
    };
    const codeOf = (name: string) => recognizeSimcarLayer(name) || name;
    const sobreposicaoPoints: PointShpRecord[] = proc.overlapPairs.map((pair, index) => ({
      coordinates: centroidOf(pair.geometry as any),
      attributes: { ID: index + 1, DETALHES: `${codeOf(pair.camadaA)} com ${codeOf(pair.camadaB)}` },
    }));
    if (sobreposicaoPoints.length) {
      const built = buildPointShpAndShx(sobreposicaoPoints, 1);
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.shp", data: built.shp });
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.shx", data: built.shx });
      errosFiles.push({
        name: "ERROS_DE_SOBREPOSICAO.dbf",
        data: buildDbfBuffer(sobreposicaoPoints.map((p) => p.attributes), [
          { name: "ID", type: "N", length: 18, decimals: 0 },
          { name: "DETALHES", type: "C", length: 254, decimals: 0 },
        ]),
      });
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.prj", data: Buffer.from(prj, "utf8") });
    }
  }
  const errosZip = await buildNestedZip(errosFiles);

  // Nested: erros_diagnostico.zip — diagnósticos EXTRAS do GeoForest (não
  // existem no download da SEMA; úteis no SIG).
  const diagFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const points = buildPointShpAndShx(pointRecords, 1);
    diagFiles.push({ name: "pontos_erros.shp", data: points.shp });
    diagFiles.push({ name: "pontos_erros.shx", data: points.shx });
    diagFiles.push({
      name: "pontos_erros.dbf",
      data: buildDbfBuffer(pointRecords.map((p) => p.attributes), errorPointFields),
    });
    diagFiles.push({ name: "pontos_erros.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.overlapPolygons.length) {
    const records: ShpRecord[] = proc.overlapPolygons.flatMap((o) =>
      geojsonToShpRecords(o.geometry, {
        camada: o.camada,
        feicao_a: o.feicaoA,
        feicao_b: o.feicaoB,
        area_m2: o.areaM2,
        area_ha: o.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    diagFiles.push({ name: "poligonos_sobreposicao.shp", data: built.shp });
    diagFiles.push({ name: "poligonos_sobreposicao.shx", data: built.shx });
    diagFiles.push({
      name: "poligonos_sobreposicao.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), overlapFields),
    });
    diagFiles.push({ name: "poligonos_sobreposicao.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.ruleViolations.length) {
    const records: ShpRecord[] = proc.ruleViolations.flatMap((v) =>
      geojsonToShpRecords(v.geometry, {
        camada_a: v.camadaA,
        feicao_a: v.feicaoA,
        camada_b: v.camadaB,
        regra: v.regra,
        area_m2: v.areaM2,
        area_ha: v.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    diagFiles.push({ name: "poligonos_regras_simcar.shp", data: built.shp });
    diagFiles.push({ name: "poligonos_regras_simcar.shx", data: built.shx });
    diagFiles.push({
      name: "poligonos_regras_simcar.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), ruleViolationFields),
    });
    diagFiles.push({ name: "poligonos_regras_simcar.prj", data: Buffer.from(prj, "utf8") });
  }
  const diagZip = await buildNestedZip(diagFiles);

  // erros_processamento_app.zip — pontos de erro de cálculo de APP (artefato SIMCAR)
  const appErrorPoints = pointRecords.filter((p) => String(p.attributes.tipo) === "erro_calculo_app");
  const appErrosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const pts = buildPointShpAndShx(appErrorPoints, 1);
    appErrosFiles.push({ name: "pontos_erro_app.shp", data: pts.shp });
    appErrosFiles.push({ name: "pontos_erro_app.shx", data: pts.shx });
    appErrosFiles.push({
      name: "pontos_erro_app.dbf",
      data: buildDbfBuffer(appErrorPoints.map((p) => p.attributes), errorPointFields),
    });
    appErrosFiles.push({ name: "pontos_erro_app.prj", data: Buffer.from(prj, "utf8") });
  }
  const appErrosZip = await buildNestedZip(appErrosFiles);

  const inventario = [
    "Inventario de saidas — Processar projeto (fluxo completo SIMCAR / ProcessarGeo local)",
    "",
    "arquivo_enviado.zip            — shapefiles originais enviados",
    "arquivo_processado.zip         — projeto processado: limpos + APP/APPD/APPP/APPRL/AURD/ARLDR",
    "arquivo_conferencia.zip        — camadas com area_m2/area_ha",
    "erros_processamento.zip        — ERROS_DE_SOBREPOSICAO (mesmo artefato/schema do download da SEMA)",
    "erros_diagnostico.zip          — diagnosticos extras GeoForest (pontos de erro, poligonos)",
    "erros_processamento_app.zip    — pontos de erro de calculo de APP",
    "relatorio_importacao.txt       — fase Importar",
    "relatorio_processamento.txt    — fase Processar",
    "resumo_erros.csv               — tabela unificada de erros",
    "quadro_areas.csv               — areas por camada (inclui APP*)",
    "",
    "Pastas espelhadas (mesmos arquivos, para abrir direto no SIG):",
    "  arquivo_enviado/",
    "  arquivo_processado/   ← aqui entram APP.shp, APPD.shp, APPP.shp, …",
    "  arquivo_conferencia/",
    "  erros/",
    "  erros_app/",
    "",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.append(Buffer.from(args.importRelatorio, "utf8"), { name: "relatorio_importacao.txt" });
    archive.append(Buffer.from(proc.relatorioTexto, "utf8"), { name: "relatorio_processamento.txt" });
    archive.append(buildCsv(allRows), { name: "resumo_erros.csv" });
    archive.append(buildQuadroCsv(proc.quadroAreas), { name: "quadro_areas.csv" });
    archive.append(Buffer.from(inventario, "utf8"), { name: "inventario_saidas.txt" });

    archive.append(enviadoZip, { name: "arquivo_enviado.zip" });
    archive.append(processadoZip, { name: "arquivo_processado.zip" });
    archive.append(conferenciaZip, { name: "arquivo_conferencia.zip" });
    archive.append(errosZip, { name: "erros_processamento.zip" });
    archive.append(diagZip, { name: "erros_diagnostico.zip" });
    archive.append(appErrosZip, { name: "erros_processamento_app.zip" });

    // Pastas planas (mesmos conteúdos)
    for (const f of enviadoFiles) archive.append(f.data, { name: `arquivo_enviado/${f.name}` });
    for (const f of processadoFiles) archive.append(f.data, { name: `arquivo_processado/${f.name}` });
    for (const f of conferenciaFiles) archive.append(f.data, { name: `arquivo_conferencia/${f.name}` });
    for (const f of errosFiles) archive.append(f.data, { name: `erros/${f.name}` });
    for (const f of diagFiles) archive.append(f.data, { name: `erros_diagnostico/${f.name}` });
    for (const f of appErrosFiles) archive.append(f.data, { name: `erros_app/${f.name}` });

    // Também na raiz para quem espera só pontos_erros.shp
    appendPointSet(archive, "", "pontos_erros", pointRecords, errorPointFields, prj);

    archive.finalize().catch(reject);
  });
}

/* ─────────────────────── job plumbing ─────────────────────── */

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    /* gone */
  }
}

function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) writeSse(res, data);
}

function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const res of set) {
    if (!res.writableEnded) res.end();
  }
  subscribers.delete(jobId);
}

function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "processar_projeto_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

async function runProcessJob(args: {
  uid: string;
  jobId: string;
  upload: any;
  importSnapshot: any;
  settings: GeometrySettings;
}): Promise<void> {
  const { uid, jobId, upload, importSnapshot, settings } = args;
  try {
    const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
    const zipBuffer = fs.readFileSync(inputPath);
    const filename = String(upload.filename || "projeto.zip");

    progress(uid, jobId, {
      status: "processing",
      stage: "processing",
      percent: 3,
      message: "Iniciando processamento do projeto geográfico.",
    });

    const processResult = runProcessPhase(
      zipBuffer,
      settings,
      filename,
      (patch) => {
        progress(uid, jobId, {
          status: "processing",
          stage: patch.stage || "processing",
          layer: patch.layer,
          percent: patch.percent,
          message: patch.message,
        });
      },
      jobId,
    );

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 92,
      message: "Gerando ZIP final.",
    });

    const importRelatorio =
      String(importSnapshot?.relatorioTexto || "") ||
      runImportPhase(zipBuffer, filename).relatorioTexto;
    const importRows = Array.isArray(importSnapshot?.rows) ? (importSnapshot.rows as GeometryErrorRow[]) : [];

    const zip = await buildProcessarProjetoZip({
      importRelatorio,
      process: processResult,
      importRows,
    });

    const stored = saveUserBuffer({
      uid,
      area: "processar-projeto/output",
      filename: `processar_projeto_${jobId.slice(0, 8)}.zip`,
      buffer: zip,
    });

    const allResultRows = [...importRows, ...processResult.rows];
    progress(uid, jobId, {
      status: "completed",
      stage: "completed",
      percent: 100,
      message:
        processResult.rows.length === 0
          ? "Processamento concluído sem erros."
          : `Processamento concluído com ${processResult.rows.length} inconsistência(s).`,
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/processar-projeto/download/${jobId}`,
      outputBytes: zip.length,
      resultRows: allResultRows,
      processRows: processResult.rows,
      importRows,
      warnings: processResult.warnings,
      analyzedLayers: processResult.analyzedLayers,
      fixedLayers: processResult.fixedLayers,
      totalErrors: allResultRows.length,
      processErrors: processResult.rows.length,
      importErrors: importRows.length,
      featuresWithErrors: new Set(processResult.rows.map((r) => `${r.camada}:${r.feicao}`)).size,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const cancelled = error?.message === "cancel_requested";
    progress(uid, jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "cancelled" : "failed",
      percent: cancelled ? undefined : 100,
      message: cancelled ? "Processamento cancelado." : error?.message || "Falha ao processar projeto.",
      error: error?.message || "processar_projeto_failed",
    });
    finishJob({
      jobId,
      status: cancelled ? "cancelled" : "failed",
      error: error?.message || "processar_projeto_failed",
    });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────── routes ─────────────────────── */

export function registerProcessarProjetoRoutes(app: Express): void {
  app.post("/api/processar-projeto/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const filename = safeSegment(String((req.body as any)?.filename || "projeto.zip")) || "projeto.zip";
      const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
      const layers = listPolygonLayersFromZip(zipBuffer);
      const visibleLayers = visibleVerticesLayers(layers);
      if (!visibleLayers.length) {
        res.status(400).json({
          error: layers.length ? "ZIP sem camada poligonal com feições." : "ZIP sem shapefile.",
        });
        return;
      }
      const uploadId = crypto.randomUUID();
      const stored = saveUserBuffer({
        uid,
        area: "processar-projeto/input",
        filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
        buffer: zipBuffer,
      });
      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath: stored.relativePath,
        inputUrl: stored.publicUrl,
        layers,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      res.json({
        ok: true,
        uploadId,
        filename,
        layers: visibleLayers,
        warnings: layers
          .filter((layer) => layer.ignoredReason && layer.featureCount > 0)
          .map((layer) => `${layer.name}: ${layer.ignoredReason}`),
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar ZIP." });
    }
  });

  app.post("/api/processar-projeto/importar", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado. Envie o ZIP novamente." });
        return;
      }
      const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
      const zipBuffer = fs.readFileSync(inputPath);
      const result = runImportPhase(zipBuffer, String(upload.filename || "projeto.zip"));
      const importId = crypto.randomUUID();

      // PDF estilo SEMA com identidade GeoForest
      let pdfRelativePath: string | undefined;
      let pdfUrl: string | undefined;
      try {
        const pdfBuffer = await buildImportReportPdf({
          filename: String(upload.filename || "projeto.zip"),
          ok: result.ok,
          rows: result.rows,
          camadas: result.camadasReconhecidas,
          warnings: result.warnings,
          reportId: importId.slice(0, 8),
        });
        const storedPdf = saveUserBuffer({
          uid,
          area: "processar-projeto/import-pdf",
          filename: `relatorio_importacao_${importId.slice(0, 8)}.pdf`,
          buffer: pdfBuffer,
        });
        pdfRelativePath = storedPdf.relativePath;
        pdfUrl = `/api/processar-projeto/import/${importId}/pdf`;
      } catch (pdfErr: any) {
        // Importação continua mesmo se o PDF falhar; aviso no job
        result.warnings.push(`PDF de importação: ${pdfErr?.message || "falha ao gerar"}`);
      }

      persistJob(uid, importId, {
        type: "import",
        uploadId,
        status: result.ok ? "import_ok" : "import_failed",
        filename: upload.filename,
        rows: result.rows,
        camadasReconhecidas: result.camadasReconhecidas,
        relatorioTexto: result.relatorioTexto,
        warnings: result.warnings,
        ok: result.ok,
        pdfRelativePath: pdfRelativePath || null,
        pdfUrl: pdfUrl || null,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });
      // Keep import snapshot on upload doc for process step
      persistJob(uid, uploadId, {
        lastImportId: importId,
        lastImportOk: result.ok,
        lastImportRows: result.rows,
        lastImportRelatorio: result.relatorioTexto,
        lastImportCamadas: result.camadasReconhecidas,
        lastImportPdfUrl: pdfUrl || null,
      });
      res.json({
        ok: result.ok,
        importId,
        uploadId,
        rows: result.rows,
        camadasReconhecidas: result.camadasReconhecidas,
        relatorioTexto: result.relatorioTexto,
        warnings: result.warnings,
        totalErrors: result.rows.length,
        pdfUrl: pdfUrl || null,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha na importação." });
    }
  });

  app.get("/api/processar-projeto/import/:importId/pdf", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const importId = String(req.params.importId || "").trim();
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", importId]);
      if (!data || data.type !== "import") {
        res.status(404).json({ error: "Importação não encontrada." });
        return;
      }

      let pdfPath = String(data.pdfRelativePath || "").trim();
      if (!pdfPath || !fs.existsSync(getAbsoluteStoragePath(pdfPath))) {
        // regenera sob demanda
        const pdfBuffer = await buildImportReportPdf({
          filename: String(data.filename || "projeto.zip"),
          ok: Boolean(data.ok),
          rows: Array.isArray(data.rows) ? (data.rows as GeometryErrorRow[]) : [],
          camadas: Array.isArray(data.camadasReconhecidas) ? data.camadasReconhecidas : [],
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          reportId: importId.slice(0, 8),
        });
        const stored = saveUserBuffer({
          uid,
          area: "processar-projeto/import-pdf",
          filename: `relatorio_importacao_${importId.slice(0, 8)}.pdf`,
          buffer: pdfBuffer,
        });
        pdfPath = stored.relativePath;
        persistJob(uid, importId, {
          pdfRelativePath: pdfPath,
          pdfUrl: `/api/processar-projeto/import/${importId}/pdf`,
        });
      }

      const abs = getAbsoluteStoragePath(pdfPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="relatorio_importacao_geoforest_${importId.slice(0, 8)}.pdf"`,
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      fs.createReadStream(abs).pipe(res);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao baixar PDF de importação." });
    }
  });

  app.post("/api/processar-projeto/processar", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "processar_projeto_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const importId = String((req.body as any)?.importId || upload.lastImportId || "").trim();
      let importSnapshot: any = null;
      if (importId) {
        importSnapshot = readDocBySegments(["users", uid, "processar_projeto_jobs", importId]);
      }
      if (!importSnapshot && (upload.lastImportOk === true || upload.lastImportOk === false)) {
        importSnapshot = {
          ok: Boolean(upload.lastImportOk),
          status: upload.lastImportOk ? "import_ok" : "import_failed",
          rows: upload.lastImportRows || [],
          relatorioTexto: upload.lastImportRelatorio,
        };
      }
      if (!importSnapshot) {
        // Auto-run import if user skipped explicit call — still gates processar.
        const inputPath = getAbsoluteStoragePath(String(upload.inputRelativePath || ""));
        const zipBuffer = fs.readFileSync(inputPath);
        const autoImport = runImportPhase(zipBuffer, String(upload.filename || "projeto.zip"));
        importSnapshot = {
          ok: autoImport.ok,
          status: autoImport.ok ? "import_ok" : "import_failed",
          rows: autoImport.rows,
          relatorioTexto: autoImport.relatorioTexto,
        };
      }

      try {
        assertImportAllowsProcess(importSnapshot);
      } catch (gateError: any) {
        res.status(400).json({
          error: gateError?.message || IMPORT_REPROVADO_MSG,
          code: "IMPORT_FAILED",
          ok: false,
          rows: importSnapshot?.rows || [],
          totalErrors: Array.isArray(importSnapshot?.rows) ? importSnapshot.rows.length : 0,
        });
        return;
      }

      const settings = ((req.body as any)?.settings || {}) as GeometrySettings;
      const job = startJob({
        uid,
        endpoint: "/api/processar-projeto/processar",
        metadata: { uploadId, filename: upload.filename },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        importId: importId || null,
        filename: upload.filename,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Processamento enviado ao servidor.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runProcessJob({
        uid,
        jobId: job.jobId,
        upload,
        importSnapshot,
        settings,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar processamento." });
    }
  });

  app.get("/api/processar-projeto/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/processar-projeto/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let set = subscribers.get(jobId);
    if (!set) {
      set = new Set();
      subscribers.set(jobId, set);
    }
    set.add(res);
    writeSse(res, { type: "snapshot", jobId, job: data });

    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId, t: Date.now() }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set?.delete(res);
      if (set && set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/processar-projeto/download/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (!data?.outputRelativePath) {
        res.status(404).json({ error: "Resultado não disponível." });
        return;
      }
      const abs = getAbsoluteStoragePath(String(data.outputRelativePath));
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: "Arquivo de resultado não encontrado." });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="processar_projeto_${jobId.slice(0, 8)}.zip"`,
      );
      fs.createReadStream(abs).pipe(res);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha no download." });
    }
  });

  app.delete("/api/processar-projeto/jobs/:jobId", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      const jobId = String(req.params.jobId || "").trim();
      requestCancel(jobId, uid);
      const data = readDocBySegments(["users", uid, "processar_projeto_jobs", jobId]);
      if (data?.inputRelativePath) removeStoragePath(String(data.inputRelativePath));
      if (data?.outputRelativePath) removeStoragePath(String(data.outputRelativePath));
      persistJob(uid, jobId, { status: "deleted", message: "Removido." });
      closeSubscribers(jobId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao remover job." });
    }
  });
}
