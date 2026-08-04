/**
 * Textos EXATOS do SIMCAR, nomes de exibição e tabela de geometrias esperadas.
 */
import type { SimcarLayerCode } from "../simcar-rules";
import { recognizeSimcarLayer } from "../simcar-rules";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const LOCAL_IMPORT_REJECTED_TEXT =
  "Situação da importação: Reprovado - Corrija os erros encontrados e envie novamente!";

/* ─────────────────────── pure phases ─────────────────────── */


/** Nomes de exibição que o relatório da SEMA usa nas frases "X está sobrepondo Y". */
export const OVERLAP_DISPLAY_NAME: Partial<Record<SimcarLayerCode, string>> = {
  AREA_CONSOLIDADA: "Área Consolidada",
  LAGO_LAGOA_NATURAL: "Lagoa Natural",
  RESERVATORIO_ARTIFICIAL: "Reservatório Artificial",
};

export function overlapDisplayName(layerName: string): string {
  const code = recognizeSimcarLayer(layerName);
  return (code && OVERLAP_DISPLAY_NAME[code]) || code || layerName;
}

export const formatHaBR = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/**
 * Linhas FIXAS da tabela "Geometrias encontradas" do relatório oficial da
 * SEMA (mesma ordem/rótulos/descrições do PDF; linhas zeradas aparecem).
 * RIO agrega todas as classes de curso d'água; NASCENTE conta pontos.
 */
export const GEOMETRIAS_TABELA: Array<{
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
