/**
 * Geometry Errors — "Erros de Geometria do SIMCAR"
 *
 * Detecta (e opcionalmente corrige) erros de geometria que o validador do
 * SIMCAR/SEMA-MT reprova ao processar os shapefiles do CAR, começando por:
 *
 *   • borda_se_cruza — "Borda de polígono se cruza" (auto-interseção do anel).
 *     Detecção via cruzamento de segmentos do mesmo anel (turf kinks) e
 *     correção via divisão do polígono em polígonos simples (turf unkink).
 *
 *   • vertice_duplicado — vértices consecutivos idênticos no mesmo anel
 *     ("Vértices duplicados" no validador). Correção: remoção dos repetidos.
 *
 *   • anel_degenerado — anel com menos de 3 vértices distintos (colapsado em
 *     ponto/linha). Correção: o anel é descartado da camada corrigida.
 *
 *   • sobreposicao — feições da MESMA camada se sobrepõem ("Sobreposição de
 *     polígonos" no validador). Sem correção automática (é ambíguo qual feição
 *     recortar); o ZIP traz os polígonos exatos da sobreposição.
 *
 *   • vazio — vazios/gaps entre polígonos adjacentes da mesma camada (buracos
 *     topológicos no envelope da camada). Sem correção automática; o ZIP traz
 *     poligonos_vazios.shp com a área de cada vazio.
 *
 *   • air_atp_area — soma das áreas das AIRs ≠ área da ATP (regra de feições
 *     obrigatórias do Manual/Projeto Geográfico). Nível de camada (CSV/relatório).
 *
 * A saída é um ZIP com:
 *   • pontos_erros_geometria.shp — um ponto por erro encontrado
 *   • corrigido_<camada>.shp     — camada corrigida (opcional)
 *   • resumo_erros.csv / relatorio_erros.txt
 *
 * Endpoints:
 *   POST /api/geometry-errors/upload            — importa ZIP e lista camadas poligonais
 *   POST /api/geometry-errors/process           — inicia job de análise
 *   GET  /api/geometry-errors/jobs/:id/status   — snapshot do job
 *   GET  /api/geometry-errors/jobs/:id/events   — SSE de progresso
 *   GET  /api/geometry-errors/download/:id      — baixa ZIP de resultado
 *   DELETE /api/geometry-errors/jobs/:id        — cancela / remove
 *
 * NOTA (Plano 04, 03/08/2026): o monólito foi desmembrado em `backend/geometry/`.
 * Este arquivo é apenas o barrel público — a API exportada continua idêntica.
 */
export * from "./geometry/index";
