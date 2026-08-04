/**
 * Tolerâncias calibradas contra o validador da SEMA e mensagens EXATAS do SIMCAR.
 */
import type { SimcarLayerCode } from "../simcar-rules";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Tipos de erro em nível de CAMADA (sem feição/coordenada específica).
 * Ficam fora do shapefile de pontos, mas entram no CSV/relatório/tabela.
 */
export const LAYER_LEVEL_TIPOS = new Set([
  "nomenclatura_desconhecida",
  "crs_ausente",
  "crs_nao_conforme",
  "dimensao_nao_2d",
  "primitiva_incorreta",
  "atp_multipla",
  "atributo_ausente",
  "feicao_obrigatoria_ausente",
  "air_atp_area",
]);


/**
 * Tolerâncias do importador SIMCAR/SEMA — calibradas em 2026-07-16 por
 * BISSECÇÃO EMPÍRICA contra o importador real (CAR 270069/Santa Clara, feições
 * candidatas isoladas em camadas-sonda e lidas no PDF de importação):
 *
 *  - "A geometria contém pontos repetidos": vértices consecutivos a ≤ ~0,1 m.
 *  - "Borda do polígono se cruza": anel cujas PAREDES se sobrepõem no cluster
 *    do importador — anel colapsado (largura mínima ≤ ~3 cm) ou espiga/agulha
 *    (ida-e-volta com ângulo ~0°). Descobertas do oráculo:
 *      • feição 111 (micro-triângulo, largura 0,012 m) → acusada;
 *      • feição 115 (agulha 186 m, largura 0,017 m) → acusada;
 *      • anéis finos de 0,042 m+ (AREA_CONSOLIDADA f3) → NÃO acusados;
 *      • encostes PONTUAIS de vértice em borda (0,015–0,076 m, ex. feições
 *        45/89/100/102/107/108/119) → NÃO acusados (toque pontual é válido
 *        na regra ESRI; só sobreposição de paredes reprova).
 */
export const SIMCAR_IMPORT_DUP_TOLERANCE_M = 0.1;
/**
 * Anel "colapsado" (borda se cruza): largura mínima ≤ 0,02 m OU área ≤ 0,01 m².
 * Régua empírica do oráculo (todos os anéis finos do teste_1, larguras via
 * rotating calipers):
 *   acusados:  ARL:111 (área 0,0049 m²; larg. 0,0344 m) · ARL:115 (agulha
 *              186 m; área 1,61 m²; larg. 0,0173 m) — e gêmeas 232/236;
 *   poupados:  ARL:112 (área 0,0208 m²; larg. 0,051 m) · AUAS:15 (larg.
 *              0,0231 m!) · AREA_CONSOLIDADA:3 (larg. 0,042 m) · demais.
 * Margens: área ×4 (0,0049→0,0208), largura +34% (0,0173→0,0231).
 */
export const SIMCAR_IMPORT_COLLAPSE_WIDTH_M = 0.02;
export const SIMCAR_IMPORT_COLLAPSE_AREA_M2 = 0.01;

/**
 * ProcessarGeo oficial — resolução de relatório de sobreposição: um PAR de
 * feições só é contado quando a SOMA das interseções do par ≥ 0,01 ha
 * (100 m²). Derivado dos 222 pontos do ERROS_DE_SOBREPOSICAO oficial do CAR
 * 270069: pares ≥100 m² = ARL×ARL 106 · AVN×AVN 106 · AVN×AREA_CONSOLIDADA 8
 * · AUAS×AREA_CONSOLIDADA 2 — todos EXATOS (e consistente com o limiar de
 * 100 m² da contenção). Áreas em UTM planar (SIRGAS), como a SEMA calcula.
 */
export const SIMCAR_PROCESS_PAIR_MIN_M2 = 100;


/** Limiar do TOQUE EXATO do anel (mm): 0,0000 m reprova; 4,3 mm passa (oráculo v4). */
export const SIMCAR_IMPORT_SELF_TOUCH_M = 0.001;


/** Mensagem EXATA do importador p/ anéis sobrepostos no mesmo registro (oráculo v19). */
export const SEMA_MSG_ANEIS_SOBREPOSTOS =
  "Duas ou mais bordas ou buracos da geometria de poligono complexo se sobrepõem";

/**
 * Comprimento mínimo de borda compartilhada (m) entre anéis do mesmo registro
 * que o importador SEMA trata como "bordas/buracos se sobrepõem".
 * Oráculo v21 (CAR 270069): buraco colado na borda exterior de AREA_UMIDA
 * f22 ~140 m e f43 ~38 m → reprova; buracos internos limpos (shared≈0) passam.
 * Encoste pontual (ESRI) permanece permitido — limiar em comprimento, não em 1 vértice.
 */
export const SIMCAR_RING_SHARED_EDGE_M = 1.0;
/** Distância (m) para considerar um ponto "sobre" a aresta do outro anel. */
export const SIMCAR_RING_SHARED_EDGE_TOL_M = 0.02;


/** Mensagem EXATA da regra de contenção da ÁREA ÚMIDA (oráculo v8/v22, 16/07/2026). */
export const SEMA_MSG_UMIDA_CONTIDA =
  "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA.";

/**
 * Tolerância de "fora" em área (m²) da contenção da AREA_UMIDA.
 * Oráculo v8 (ZIP com AVN ainda "furado" sob as úmidas): 41/48 com fora > ~0,3 m²
 * (0,1 → 42; 0,5 → 40) usando união real AVN∪AUAS∪CONS.
 */
export const SIMCAR_UMIDA_FORA_TOL_M2 = 0.3;

/**
 * Amostragem da borda da úmida (m) para capturar micro-lascas que a área
 * residual arredonda a ~0 mas o ProcessarGeo da SEMA ainda reprova.
 * Oráculo v22 (CAR 270069, PDF process 16/07/2026): SEMA qty=41;
 * step 20 m → 40 feições (Δ≤1 por amostragem); step 18 m → 42.
 */
export const SIMCAR_UMIDA_EDGE_SAMPLE_M = 20;


/** Mensagens EXATAS do relatório de processamento da SEMA. */
export const SEMA_MSG_RESERVATORIO_CONTIDO =
  "A feição RESERVATORIO_ARTIFICIAL (sem barramento), deve estar completamente contida em uma AUAS ou ÁREA CONSOLIDADA";
export const SEMA_MSG_RESERVATORIO_SITUACAO =
  "(Campo SITUACAO) Situação do Entorno Inválido. Em reservatórios que não fazem barramento, a Situação deve ser 'O' para Outro.";


/** Códigos que compõem a "Hidrografia" na conferência de área da AIR. */
export const AIR_COMPOSITION_HYDRO: SimcarLayerCode[] = [
  "RIO_MENOR_10",
  "RIO_10_ATE_50",
  "RIO_50_ATE_200",
  "RIO_200_ATE_600",
  "RIO_MAIOR_600",
  "LAGO_LAGOA_NATURAL",
  "RESERVATORIO_ARTIFICIAL",
];


/** Mensagem EXATA do importador da SEMA para registro multipart. */
export const SEMA_MSG_POLIGONO_COMPLEXO =
  "Era esperado um polígono simples, porém veio polígono complexo";
