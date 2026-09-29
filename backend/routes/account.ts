import { Express, Request, Response } from "express";
import { adminAuth } from "../firebase-admin";
import { upsertUserProfile, readDocBySegments, writeDocBySegments, stripUndefinedDeep } from "../local-storage";
import { materializeServerTimestamps } from "../lib/store-helpers";

export function registerAccountRoutes(app: Express) {
  app.post("/api/account/bootstrap", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    try {
      const token = await adminAuth.verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      const profile = upsertUserProfile({
        uid,
        email: String((req.body as any)?.email || token.email || "").trim(),
        fullName:
          String((req.body as any)?.fullName || token.name || "").trim() ||
          String(token.email || "").split("@")[0],
      });
      res.json({ ok: true, profile });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao provisionar conta." });
    }
  });

  app.get("/api/me", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    // Mesmo motivo do PATCH: rejeição em handler async no Express 4 deixa a
    // requisição pendurada (verifyIdToken ou erro de disco no upsert).
    try {
      const token = await adminAuth.verifyIdToken(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      const profile = upsertUserProfile({
        uid,
        email: String(token.email || "").trim(),
        fullName: String(token.name || "").trim() || String(token.email || "").split("@")[0],
      });
      res.json(profile);
    } catch (error: any) {
      console.error("[/api/me] falha ao ler/provisionar perfil:", error);
      res.status(500).json({
        error: `Falha ao ler o perfil: ${String(error?.code || error?.message || "erro sem mensagem")}.`,
        code: "PROFILE_READ_FAILED",
      });
    }
  });

  app.patch("/api/me", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    if (!uid) {
      res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
      return;
    }
    try {
      const current = readDocBySegments(["users", uid]) || {};
      const next = writeDocBySegments(
        ["users", uid],
        stripUndefinedDeep({
          ...current,
          ...materializeServerTimestamps((req.body as any) || {}),
          uid,
        }),
        { merge: true },
      );
      res.json(next);
    } catch (error: any) {
      console.error("[/api/me] falha ao gravar perfil:", error);
      res.status(500).json({
        error: `Falha ao gravar o perfil no banco local: ${String(error?.code || error?.message || "erro sem mensagem")}.`,
        code: "PROFILE_WRITE_FAILED",
      });
    }
  });
}
