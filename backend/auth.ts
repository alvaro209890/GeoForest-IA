import type { NextFunction, Request, Response } from "express";
import { adminAuth } from "./firebase-admin";

export function extractBearerToken(req: Request): string | null {
  const header = String(req.headers.authorization || "").trim();
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim() || null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Token de autenticação obrigatório.", code: "UNAUTHENTICATED" });
      return;
    }
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUid = decoded.uid;
    next();
  } catch (error) {
    const message = String((error as any)?.message || error || "");
    if (/Unable to detect a Project Id/i.test(message)) {
      console.error("[AUTH] Firebase Admin sem projectId. Configure FIREBASE_PROJECT_ID no backend.", error);
      res.status(500).json({
        error: "Configuração de autenticação do servidor incompleta.",
        code: "AUTH_CONFIG_ERROR",
      });
      return;
    }
    console.error("[AUTH] Token inválido:", error);
    res.status(401).json({ error: "Token inválido ou expirado.", code: "UNAUTHENTICATED" });
  }
}

export function getAuthUid(req: Request): string {
  const uid = String(req.authUid || "").trim();
  if (!uid) {
    throw new Error("AUTH_UID_MISSING");
  }
  return uid;
}
