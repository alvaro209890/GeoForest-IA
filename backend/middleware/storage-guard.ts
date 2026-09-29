/**
 * Guarda do static `/api/storage` (público, sem token).
 *
 * O static existe para servir ARTEFATOS (ZIP, PDF, imagem) por URL. Mas o mesmo
 * STORAGE_ROOT guarda o banco em JSON: docs de job, conversas do chat, perfil,
 * preferências e os índices dos acervos. Sem esta guarda, `GET /api/storage/users/<uid>/
 * conversations/<id>.json` devolvia a conversa inteira para qualquer um. O front lê
 * esses docs só por `/api/store/doc` (autenticado, checa dono).
 */
import type { NextFunction, Request, Response } from "express";
import { ALLOWED_COLLECTIONS } from "../local-storage";

/** Pastas na raiz do storage que não são de usuário (índices internos). */
const PRIVATE_ROOT_DIRS = new Set(["cbers_archive", "ndvi_archive", "auas_v2_checkpoints"]);

/** `users/<uid>/<isto>` é banco, não artefato. */
const PRIVATE_USER_DIRS = new Set(["profile.json", "settings", "simcar-oraculo"]);

/** `pathname` relativo ao mount (`/users/u/...`). Decodifica antes de decidir. */
export function isPrivateStoragePath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const parts = decoded.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === ".")) return true;
  if (!parts.length) return true;
  if (PRIVATE_ROOT_DIRS.has(parts[0])) return true;
  if (parts[0] !== "users") return false;
  const area = parts[2];
  if (!area) return true;
  return PRIVATE_USER_DIRS.has(area) || ALLOWED_COLLECTIONS.has(area);
}

export function storageGuard(req: Request, res: Response, next: NextFunction): void {
  if (isPrivateStoragePath(req.path)) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }
  next();
}
