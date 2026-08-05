/**
 * Aba "Lotes SIMCAR" — recibo de inscrição do CAR → ZIP com uma pasta por lote
 * contendo Arquivo Enviado, Arquivo Processado e Recibo de Inscrição.
 * Plano: docs/planos/simcar-lotes/ · Doc: docs/SIMCAR_LOTES.md
 */
export { registerSimcarLotesRoutes } from "./routes";
export type { ReciboParseado, RelatorioLote, ResolucaoCar } from "./types";
