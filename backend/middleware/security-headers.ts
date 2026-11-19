/**
 * Cabeçalhos de segurança do backend GeoForest.
 *
 * O app é servido pelo Firebase Hosting; este backend só responde `/api/*`
 * (JSON, arquivos de storage e o build estático em produção). Os cabeçalhos
 * abaixo não mudam nenhuma resposta legítima:
 *
 * - `nosniff` impede o navegador de reinterpretar um arquivo enviado pelo
 *   usuário como HTML/JS (era o caminho para XSS armazenado em `/api/storage`).
 * - `frame-ancestors 'none'` / `X-Frame-Options: DENY` impedem clickjacking.
 * - `Referrer-Policy` evita vazar URL de job (com uid e jobId) para fora.
 * - HSTS só é enviado quando a requisição chegou por HTTPS (`x-forwarded-proto`).
 */
import type { NextFunction, Request, Response } from "express";

/** CSP aplicada a arquivos servidos de `/api/storage` e `/api/raster*`. */
export const STATIC_ASSET_CSP =
  "script-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function createSecurityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );

    const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (forwardedProto === "https" || req.protocol === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    next();
  };
}

/** Cabeçalhos extras para arquivos enviados por usuários (nunca executam código). */
export function setStaticAssetHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", STATIC_ASSET_CSP);
}
