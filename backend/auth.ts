import type { NextFunction, Request, Response } from "express";
import { adminAuth, adminDb, isFirebaseConfigError } from "./firebase-admin";

const PROFILE_CACHE_TTL_MS = Number(process.env.AUTH_PROFILE_CACHE_TTL_MS || "60000");
const profileExistsCache = new Map<string, { exists: boolean; expiresAt: number }>();

export function extractBearerToken(req: Request): string | null {
  const header = String(req.headers.authorization || "").trim();
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim() || null;
}

async function hasFirestoreUserProfile(uid: string): Promise<boolean> {
  const now = Date.now();
  const cached = profileExistsCache.get(uid);
  if (cached && cached.expiresAt > now) return cached.exists;

  const snap = await adminDb.doc(`users/${uid}`).get();
  const exists = snap.exists;
  profileExistsCache.set(uid, {
    exists,
    expiresAt: now + Math.max(1000, PROFILE_CACHE_TTL_MS),
  });
  return exists;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Token de autenticacao obrigatorio.", code: "UNAUTHENTICATED" });
      return;
    }

    const decoded = await adminAuth.verifyIdToken(token);

    const hasProfile = await hasFirestoreUserProfile(decoded.uid);
    if (!hasProfile) {
      res.status(403).json({
        error: "Conta sem perfil cadastrado no sistema.",
        code: "ACCOUNT_NOT_PROVISIONED",
      });
      return;
    }

    req.authUid = decoded.uid;
    next();
  } catch (error) {
    if (isFirebaseConfigError(error)) {
      console.error("[AUTH] Firebase Admin sem credenciais validas no backend.", error);
      res.status(500).json({
        error: "Configuracao de autenticacao do servidor incompleta.",
        code: "AUTH_CONFIG_ERROR",
      });
      return;
    }
    console.error("[AUTH] Token invalido:", error);
    res.status(401).json({ error: "Token invalido ou expirado.", code: "UNAUTHENTICATED" });
  }
}

export function getAuthUid(req: Request): string {
  const uid = String(req.authUid || "").trim();
  if (!uid) {
    throw new Error("AUTH_UID_MISSING");
  }
  return uid;
}
