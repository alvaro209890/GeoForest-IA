/**
 * Regras oficiais do Projeto Geográfico do SIMCAR (SEMA-MT).
 *
 * Fonte: "Manual de Operação do SIMCAR - Projeto Geográfico" (SEMA-MT,
 * sema.mt.gov.br → SIMCAR → Manuais), em especial:
 *   • Estrutura padrão: shapefile, dimensão 2D, SIRGAS 2000 geográfico;
 *   • Feições de uso obrigatório (ATP única, AIR) e condicionado, com a
 *     primitiva geométrica exigida (polígono; NASCENTE é ponto);
 *   • Atributos obrigatórios por feição (AIR: TIPO/IDENTIFIC; ARL:
 *     IDENTIFIC/AVERBACAO/SITUACAO; TIPOLOGIA_VEGETAL: TIPO; ...);
 *   • ANEXO 01 "Validações GEO": regras de contenção e sobreposição
 *     impeditivas entre feições.
 *
 * Este módulo é puro (sem Express): recebe camadas extraídas do ZIP e
 * devolve linhas de erro no formato da aba "Erros de Geometria".
 */
import { detectCrs, layerBbox, parsePolygonRecords } from "./vertices-proximas";
import { parseDbfSchema } from "./shapefile-writer";
import type { GeometryErrorRow } from "./geometry-errors";

export type SimcarLayerCode =
  | "ATP"
  | "AIR"
  | "AVN"
  | "AUAS"
  | "AREA_CONSOLIDADA"
  | "AREA_PANTANEIRA"
  | "VEREDA"
  | "MANGUEZAL"
  | "RESTINGA"
  | "TIPOLOGIA_VEGETAL"
  | "NASCENTE"
  | "RIO_MENOR_10"
  | "RIO_10_ATE_50"
  | "RIO_50_ATE_200"
  | "RIO_200_ATE_600"
  | "RIO_MAIOR_600"
  | "LAGO_LAGOA_NATURAL"
  | "RESERVATORIO_ARTIFICIAL"
  | "AREA_DECLIVIDADE"
  | "BORDA_CHAPADA"
  | "AREA_TOPO_MORRO"
  | "AREA_ALTITUDE_1800"
  | "ARL"
  | "AREA_UTILIDADE_PUBLICA"
  | "AREA_INTERESSE_SOCIAL";

type LayerMeta = {
  code: SimcarLayerCode;
  /** Primitiva exigida pelo manual (shape types aceitos no .shp). */
  primitive: "polygon" | "point";
  /** ATP deve ser polígono único. */
  unique?: boolean;
  /** Campos obrigatórios no .dbf (nomes DBF, máx. 10 chars). */
  requiredFields?: string[];
  /** Aliases de nomenclatura aceitos (já normalizados). */
  aliases?: string[];
};

export const SIMCAR_LAYERS: LayerMeta[] = [
  { code: "ATP", primitive: "polygon", unique: true, aliases: ["AREA_TOTAL_DA_PROPRIEDADE", "AREA_TOTAL_PROPRIEDADE"] },
  { code: "AIR", primitive: "polygon", requiredFields: ["TIPO", "IDENTIFIC"], aliases: ["AREA_DO_IMOVEL_RURAL", "AREA_IMOVEL_RURAL"] },
  { code: "AVN", primitive: "polygon", aliases: ["AREA_DE_VEGETACAO_NATIVA", "AREA_VEGETACAO_NATIVA"] },
  { code: "AUAS", primitive: "polygon", aliases: ["AREA_DE_USO_ANTROPIZADO_DO_SOLO", "AREA_USO_ANTROPIZADO"] },
  { code: "AREA_CONSOLIDADA", primitive: "polygon" },
  { code: "AREA_PANTANEIRA", primitive: "polygon" },
  { code: "VEREDA", primitive: "polygon" },
  { code: "MANGUEZAL", primitive: "polygon" },
  { code: "RESTINGA", primitive: "polygon" },
  { code: "TIPOLOGIA_VEGETAL", primitive: "polygon", requiredFields: ["TIPO"], aliases: ["TIPOLOGIA", "TIPOLOGIA_RADAM"] },
  { code: "NASCENTE", primitive: "point", aliases: ["NASCENTES"] },
  { code: "RIO_MENOR_10", primitive: "polygon" },
  { code: "RIO_10_ATE_50", primitive: "polygon" },
  { code: "RIO_50_ATE_200", primitive: "polygon" },
  { code: "RIO_200_ATE_600", primitive: "polygon" },
  { code: "RIO_MAIOR_600", primitive: "polygon" },
  { code: "LAGO_LAGOA_NATURAL", primitive: "polygon", aliases: ["LAGOA_NATURAL", "LAGO_LAGOA"] },
  { code: "RESERVATORIO_ARTIFICIAL", primitive: "polygon" },
  { code: "AREA_DECLIVIDADE", primitive: "polygon", aliases: ["AREA_DE_DECLIVIDADE"] },
  { code: "BORDA_CHAPADA", primitive: "polygon", aliases: ["BORDA_DE_CHAPADA"] },
  { code: "AREA_TOPO_MORRO", primitive: "polygon", aliases: ["AREA_DE_TOPO_DE_MORRO", "TOPO_DE_MORRO", "TOPO_MORRO"] },
  { code: "AREA_ALTITUDE_1800", primitive: "polygon", aliases: ["AREA_DE_ALTITUDE_1800", "ALTITUDE_1800"] },
  { code: "ARL", primitive: "polygon", requiredFields: ["IDENTIFIC", "AVERBACAO", "SITUACAO"], aliases: ["AREA_DE_RESERVA_LEGAL", "AREA_RESERVA_LEGAL", "RESERVA_LEGAL"] },
  { code: "AREA_UTILIDADE_PUBLICA", primitive: "polygon", aliases: ["AREA_DE_UTILIDADE_PUBLICA", "UTILIDADE_PUBLICA"] },
  { code: "AREA_INTERESSE_SOCIAL", primitive: "polygon", aliases: ["AREA_DE_INTERESSE_SOCIAL", "INTERESSE_SOCIAL"] },
];

/** Normaliza nome de camada: caixa alta, sem acentos, separadores → "_". */
export function normalizeLayerName(name: string): string {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const layerByExact = new Map<string, LayerMeta>();
for (const meta of SIMCAR_LAYERS) {
  layerByExact.set(meta.code, meta);
  for (const alias of meta.aliases || []) layerByExact.set(alias, meta);
}

/**
 * Reconhece a feição SIMCAR pelo nome da camada. Aceita o nome exato do
 * manual, aliases comuns e sufixos (ex.: "AVN_FAZENDA_X" → AVN); prefere
 * sempre o casamento mais longo (ex.: AREA_CONSOLIDADA antes de "AREA").
 */
export function recognizeSimcarLayer(name: string): SimcarLayerCode | null {
  const normalized = normalizeLayerName(name);
  if (!normalized) return null;
  const exact = layerByExact.get(normalized);
  if (exact) return exact.code;
  let best: { code: SimcarLayerCode; length: number } | null = null;
  for (const [key, meta] of layerByExact.entries()) {
    if (normalized.startsWith(`${key}_`) && (!best || key.length > best.length)) {
      best = { code: meta.code, length: key.length };
    }
  }
  return best ? best.code : null;
}

export function simcarLayerMeta(code: SimcarLayerCode): LayerMeta {
  return layerByExact.get(code)!;
}

/* ────────────── ANEXO 01 — regras de contenção ────────────── */

/**
 * Regras de contenção do Anexo 01 "Validações GEO": a feição `child`
 * vetorizada fora da feição `parent` gera validação IMPEDITIVA no SIMCAR.
 */
export const SIMCAR_CONTAINMENT_RULES: Array<{ child: SimcarLayerCode; parent: SimcarLayerCode }> = [
  { child: "AIR", parent: "ATP" },
  { child: "AVN", parent: "AIR" },
  { child: "AUAS", parent: "AIR" },
  { child: "AREA_CONSOLIDADA", parent: "AIR" },
  { child: "AREA_PANTANEIRA", parent: "AIR" },
  { child: "VEREDA", parent: "AIR" },
  { child: "VEREDA", parent: "AVN" },
  { child: "MANGUEZAL", parent: "AIR" },
  { child: "MANGUEZAL", parent: "AVN" },
  { child: "RESTINGA", parent: "AIR" },
  { child: "RESTINGA", parent: "AVN" },
  { child: "ARL", parent: "AIR" },
  { child: "ARL", parent: "AVN" },
  { child: "AREA_UTILIDADE_PUBLICA", parent: "AIR" },
  { child: "AREA_INTERESSE_SOCIAL", parent: "AIR" },
  { child: "AREA_DECLIVIDADE", parent: "ATP" },
  { child: "AREA_TOPO_MORRO", parent: "ATP" },
  { child: "BORDA_CHAPADA", parent: "ATP" },
  { child: "AREA_ALTITUDE_1800", parent: "ATP" },
];

/* ────────── ANEXO 01 — sobreposições proibidas entre camadas ────────── */

/** Feições de "área inundada" citadas no Anexo 01 (rio, lagoa, reservatório). */
export const SIMCAR_INUNDADA: SimcarLayerCode[] = [
  "RIO_MENOR_10",
  "RIO_10_ATE_50",
  "RIO_50_ATE_200",
  "RIO_200_ATE_600",
  "RIO_MAIOR_600",
  "LAGO_LAGOA_NATURAL",
  "RESERVATORIO_ARTIFICIAL",
];

const SIMCAR_RELEVO: SimcarLayerCode[] = [
  "AREA_DECLIVIDADE",
  "BORDA_CHAPADA",
  "AREA_TOPO_MORRO",
  "AREA_ALTITUDE_1800",
];

/**
 * Pares de feições DIFERENTES cuja sobreposição gera validação IMPEDITIVA
 * (Anexo 01 "Validações GEO"). Sobreposição dentro da MESMA feição
 * (AVN×AVN, AIR×AIR, ...) é coberta pelo check "sobreposição entre feições
 * da mesma camada".
 */
export const SIMCAR_FORBIDDEN_OVERLAP_PAIRS: Array<[SimcarLayerCode, SimcarLayerCode]> = [
  ["AVN", "AUAS"],
  ["AVN", "AREA_CONSOLIDADA"],
  ["AVN", "AREA_PANTANEIRA"],
  ...SIMCAR_INUNDADA.map((code): [SimcarLayerCode, SimcarLayerCode] => ["AVN", code]),
  ["AUAS", "AREA_CONSOLIDADA"],
  ...SIMCAR_INUNDADA.map((code): [SimcarLayerCode, SimcarLayerCode] => ["AUAS", code]),
  ["VEREDA", "MANGUEZAL"],
  ["VEREDA", "RESTINGA"],
  ["MANGUEZAL", "RESTINGA"],
  ...SIMCAR_RELEVO.map((code): [SimcarLayerCode, SimcarLayerCode] => ["AREA_PANTANEIRA", code]),
  ["AREA_DECLIVIDADE", "BORDA_CHAPADA"],
  ["AREA_DECLIVIDADE", "AREA_TOPO_MORRO"],
  ["AREA_DECLIVIDADE", "AREA_ALTITUDE_1800"],
  ["BORDA_CHAPADA", "AREA_TOPO_MORRO"],
  ["BORDA_CHAPADA", "AREA_ALTITUDE_1800"],
  ["AREA_TOPO_MORRO", "AREA_ALTITUDE_1800"],
  ["AREA_UTILIDADE_PUBLICA", "AREA_INTERESSE_SOCIAL"],
];

/* ─────────────────────── conformidade ─────────────────────── */

export type SimcarLayerInput = {
  /** Nome da camada (basename do .shp). */
  name: string;
  shp?: Buffer;
  prjText?: string;
  dbf?: Buffer;
};

const POLYGON_SHAPE_TYPES = new Set([5, 15, 25]);
const POINT_SHAPE_TYPES = new Set([1, 11, 21, 8, 18, 28]);
const SHAPE_TYPES_2D = new Set([0, 1, 3, 5, 8]);

function shapeTypeOf(shp?: Buffer): number | null {
  if (!shp || shp.length < 36) return null;
  return shp.readInt32LE(32);
}

function shapeTypeLabel(shapeType: number): string {
  const names: Record<number, string> = {
    0: "Vazio",
    1: "Point",
    3: "Polyline",
    5: "Polygon",
    8: "MultiPoint",
    11: "PointZ",
    13: "PolylineZ",
    15: "PolygonZ",
    18: "MultiPointZ",
    21: "PointM",
    23: "PolylineM",
    25: "PolygonM",
    28: "MultiPointM",
  };
  return names[shapeType] || `Tipo ${shapeType}`;
}

function layerCenter(shp?: Buffer): [number, number] {
  if (!shp) return [0, 0];
  const bbox = layerBbox(parsePolygonRecords(shp));
  if (!bbox) return [0, 0];
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function layerRow(args: {
  layerName: string;
  tipo: string;
  detalhe: string;
  center: [number, number];
}): GeometryErrorRow {
  return {
    camada: args.layerName,
    tipo: args.tipo,
    feicao: 0,
    parte: 0,
    anel: 0,
    x: args.center[0],
    y: args.center[1],
    detalhe: args.detalhe,
  };
}

/**
 * Verifica a conformidade do ZIP com a estrutura padrão do Importador GEO
 * do SIMCAR: CRS SIRGAS 2000 geográfico, dimensão 2D, primitiva geométrica
 * correta por feição, nomenclatura reconhecida, ATP única e atributos
 * obrigatórios no .dbf. Estes erros costumam REPROVAR a importação antes
 * mesmo da análise topológica.
 */
export function checkSimcarConformity(layers: SimcarLayerInput[]): GeometryErrorRow[] {
  const rows: GeometryErrorRow[] = [];
  const seenCodes = new Set<SimcarLayerCode>();

  for (const layer of layers) {
    const center = layerCenter(layer.shp);
    const code = recognizeSimcarLayer(layer.name);
    if (code) seenCodes.add(code);

    // 1. Nomenclatura
    if (!code) {
      rows.push(layerRow({
        layerName: layer.name,
        tipo: "nomenclatura_desconhecida",
        detalhe: "Nome de camada fora da nomenclatura do SIMCAR (ATP, AIR, AVN, AUAS, AREA_CONSOLIDADA, RIO_*, ...). O importador pode não mapear a feição.",
        center,
      }));
    }

    // 2. CRS: SIRGAS 2000 geográfico (EPSG:4674)
    const crs = detectCrs(layer.prjText);
    if (crs.missing) {
      rows.push(layerRow({
        layerName: layer.name,
        tipo: "crs_ausente",
        detalhe: "Camada sem .prj. O SIMCAR exige sistema de coordenadas geográfico no datum SIRGAS 2000 (EPSG:4674).",
        center,
      }));
    } else if (crs.label !== "EPSG:4674") {
      rows.push(layerRow({
        layerName: layer.name,
        tipo: "crs_nao_conforme",
        detalhe: `CRS detectado: ${crs.label}. O SIMCAR exige coordenadas geográficas no datum SIRGAS 2000 (EPSG:4674); reprojete antes de importar.`,
        center,
      }));
    }

    // 3. Dimensão 2D + primitiva geométrica
    const shapeType = shapeTypeOf(layer.shp);
    if (shapeType !== null) {
      if (!SHAPE_TYPES_2D.has(shapeType)) {
        rows.push(layerRow({
          layerName: layer.name,
          tipo: "dimensao_nao_2d",
          detalhe: `Shapefile ${shapeTypeLabel(shapeType)} (com Z/M). A estrutura padrão do SIMCAR é 2D; exporte sem valores Z/M.`,
          center,
        }));
      }
      if (code) {
        const meta = simcarLayerMeta(code);
        const okPolygon = meta.primitive === "polygon" && POLYGON_SHAPE_TYPES.has(shapeType);
        const okPoint = meta.primitive === "point" && POINT_SHAPE_TYPES.has(shapeType);
        if (!okPolygon && !okPoint) {
          rows.push(layerRow({
            layerName: layer.name,
            tipo: "primitiva_incorreta",
            detalhe: `${code} deve ser ${meta.primitive === "polygon" ? "POLÍGONO" : "PONTO"}, mas o shapefile é ${shapeTypeLabel(shapeType)}. Ex.: rios devem ser vetorizados como polígono, nunca linha.`,
            center,
          }));
        }
      }
    }

    // 4. ATP única
    if (code === "ATP" && layer.shp) {
      const featureCount = parsePolygonRecords(layer.shp).length;
      if (featureCount > 1) {
        rows.push(layerRow({
          layerName: layer.name,
          tipo: "atp_multipla",
          detalhe: `ATP deve ser um polígono único; encontradas ${featureCount} feições. Una os polígonos ou revise o limite da propriedade.`,
          center,
        }));
      }
    }

    // 5. Atributos obrigatórios no .dbf
    if (code) {
      const meta = simcarLayerMeta(code);
      if (meta.requiredFields?.length) {
        if (!layer.dbf) {
          rows.push(layerRow({
            layerName: layer.name,
            tipo: "atributo_ausente",
            detalhe: `${code} exige os atributos ${meta.requiredFields.join(", ")}, mas o .dbf não veio no ZIP.`,
            center,
          }));
        } else {
          const fields = new Set(parseDbfSchema(layer.dbf).map((field) => field.name.toUpperCase()));
          const missing = meta.requiredFields.filter((name) => !fields.has(name));
          if (missing.length) {
            rows.push(layerRow({
              layerName: layer.name,
              tipo: "atributo_ausente",
              detalhe: `${code} exige o(s) atributo(s) ${missing.join(", ")} no .dbf (manual do Projeto Geográfico).`,
              center,
            }));
          }
        }
      }
    }
  }

  // 6. Feições de uso obrigatório
  for (const required of ["ATP", "AIR"] as SimcarLayerCode[]) {
    if (!seenCodes.has(required)) {
      rows.push(layerRow({
        layerName: required,
        tipo: "feicao_obrigatoria_ausente",
        detalhe: `Feição de uso obrigatório ${required} não encontrada no ZIP (deve estar presente em todos os projetos).`,
        center: [0, 0],
      }));
    }
  }

  return rows;
}
