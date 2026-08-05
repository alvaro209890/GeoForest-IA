/**
 * Registro centralizado de todas as rotas do backend.
 * Extraído de backend/index.ts (plano 01).
 */
import { Express } from "express";
import { registerWfsIntersectionRoutes } from "../wfs-intersection";
import { registerSimcarClipRoutes } from "../simcar/routes";
import { registerSimcarReceiptRoutes } from "../simcar-receipts";
import { registerApfReceiptRoutes } from "../apf-receipts";
import { registerCbersWpmRoutes } from "../cbers-wpm";
import { registerLandsatRoutes } from "../landsat";
import { registerVerticesRoutes } from "../vertices-proximas";
import { registerContainmentRoutes } from "../containment-analysis";
import { registerOverlapRoutes } from "../overlap";
import { registerCroquiRoutes } from "../croqui";
import { registerGeometryErrorsRoutes } from "../geometry-errors";
import { registerProcessarProjetoRoutes } from "../processar-projeto";
import { registerSimcarOraculoRoutes } from "../simcar-oraculo";
import { registerSimcarLotesRoutes } from "../simcar-lotes";
import { registerAuasScconRoutes } from "../auas-sccon";
import { registerAccountRoutes } from "./account";
import { registerStoreRoutes } from "./store";
import { registerProcessRoutes } from "./process";
import { registerModelsRoutes } from "./models";
import { registerBillingRoutes } from "./billing";
import { registerMapRoutes } from "./map";
import { registerGeometryRoutes } from "./geometry";
import { registerSolicitacaoPrioridadeRoutes } from "../solicitacao-prioridade";

export function registerAllRoutes(app: Express) {
  registerAccountRoutes(app);
  registerStoreRoutes(app);
  registerProcessRoutes(app);

  registerWfsIntersectionRoutes(app);
  registerSimcarClipRoutes(app);
  registerSimcarReceiptRoutes(app);
  registerApfReceiptRoutes(app);
  registerCbersWpmRoutes(app);
  registerLandsatRoutes(app);
  registerVerticesRoutes(app);
  registerContainmentRoutes(app);
  registerOverlapRoutes(app);
  registerCroquiRoutes(app);
  registerGeometryErrorsRoutes(app);
  registerProcessarProjetoRoutes(app);
  registerSimcarOraculoRoutes(app);
  registerSimcarLotesRoutes(app);
  registerAuasScconRoutes(app);

  registerModelsRoutes(app);
  registerBillingRoutes(app);
  registerMapRoutes(app);
  registerGeometryRoutes(app);

  registerSolicitacaoPrioridadeRoutes(app);
}
