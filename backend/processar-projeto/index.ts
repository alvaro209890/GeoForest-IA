/**
 * Compatibilidade do antigo "Processar projeto".
 *
 * A aba ativa usa somente o pipeline real em /api/simcar-oraculo. Este módulo mantém:
 * - upload + preview reutilizado pelo Oráculo;
 * - leitura/download de jobs legados;
 * - fases puras locais como biblioteca coberta por regressão (não são veredito da aba).
 *
 * Os POSTs locais /importar e /processar respondem 410 durante a janela de migração.
 *
 * NOTA (Plano 07, 03/08/2026): o monólito de 1.489 linhas foi desmembrado nesta
 * pasta. `import ... from "./processar-projeto"` resolve para este barrel, então
 * a API pública continua idêntica.
 */
export * from "./types";
export * from "./constants";
export * from "./utils";
export * from "./import-phase";
export * from "./process-phase";
export * from "./report-builder";
export * from "./sse";
export * from "./routes";
