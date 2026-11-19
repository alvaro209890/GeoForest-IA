/**
 * Guarda do `/api/storage` (arquivos de usuário servidos estaticamente).
 *
 * O storage guarda, no mesmo nível, os arquivos que o app baixa (PDF, imagem,
 * ZIP, contexto do recorte) e os JSON de perfil/jobs. Servir esses JSON
 * publicava e-mail, CREA e metadados de job para quem tivesse a URL.
 *
 * Regra:
 * - dotfile/diretório com ponto → 404;
 * - `profile.json`, `settings/`, `conversations/`, `simcar_clips/`, `receipts/`
 *   e qualquer `*_jobs/` → 404 (mesmo conjunto que `local-storage.ts` grava
 *   via `writeDocBySegments`);
 * - o resto passa, inclusive `/simcar/context/*.json`, que as fases da
 *   análise pós-recorte baixam para reexecutar.
 */
export const PRIVATE_STORAGE_SEGMENTS =
  /(^|\/)(profile\.json|settings|conversations|simcar_clips|receipts)(\/|$)|_jobs(\/|$)/i;

export function isPrivateStoragePath(originalUrl: string): boolean {
  const pathname = String(originalUrl || "")
    .split("?")[0]
    .replace(/^\/api\/storage/, "");
  if (/(^|\/)\./.test(pathname)) return true;
  return PRIVATE_STORAGE_SEGMENTS.test(pathname);
}
