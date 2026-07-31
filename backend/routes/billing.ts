import { Express, Request, Response } from "express";
import {
  BillingError,
  createManualTopup,
  getBillingLedger,
  getBillingMe,
  getBillingPricingSnapshot,
} from "../billing";
import { isFirebaseConfigError } from "../firebase-admin";

export function registerBillingRoutes(app: Express) {
  app.get("/api/billing/pricing", async (_req: Request, res: Response) => {
    try {
      const pricing = await getBillingPricingSnapshot();
      res.json(pricing);
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/pricing:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar pricing." });
    }
  });

  app.get("/api/billing/me", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const payload = await getBillingMe(uid);
      res.json(payload);
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/me:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar carteira." });
    }
  });

  app.post("/api/billing/topups/manual", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const amountBrl = Number(req.body?.amountBrl);
      const idempotencyKey = String(req.body?.idempotencyKey || "");
      const topup = await createManualTopup({ uid, amountBrl, idempotencyKey });
      let wallet: Awaited<ReturnType<typeof getBillingMe>> | null = null;
      try {
        wallet = await getBillingMe(uid);
      } catch (walletErr: any) {
        const msg = String(walletErr?.message || walletErr || "");
        if (/FAILED_PRECONDITION/i.test(msg) && /requires an index/i.test(msg)) {
          console.warn(
            "[BILLING] getBillingMe falhou por índice após top-up; retornando carteira mínima.",
            walletErr,
          );
        } else if (isFirebaseConfigError(walletErr)) {
          console.warn("[BILLING] getBillingMe falhou por config Firebase após top-up.", walletErr);
        } else {
          throw walletErr;
        }
      }
      res.json({
        ok: true,
        topup,
        wallet: wallet?.wallet || {
          balanceBrl: Number(topup.balanceAfterBrl || 0),
          totalTopupBrl: null,
          totalSpentBrl: null,
          updatedAt: null,
          version: null,
        },
      });
    } catch (error: any) {
      if (error instanceof BillingError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/topups/manual:", error);
      res.status(500).json({ error: error?.message || "Erro ao adicionar créditos." });
    }
  });

  app.get("/api/billing/ledger", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "");
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const limit = Number(req.query?.limit || 50);
      const entries = await getBillingLedger(uid, limit);
      res.json({ entries });
    } catch (error: any) {
      if (isFirebaseConfigError(error)) {
        res.status(500).json({
          error: "Firebase Admin não configurado no backend.",
          code: "FIREBASE_CONFIG_ERROR",
        });
        return;
      }
      console.error("Erro no /api/billing/ledger:", error);
      res.status(500).json({ error: error?.message || "Erro ao carregar extrato." });
    }
  });
}
