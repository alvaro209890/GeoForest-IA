/**
 * Leitura/escrita de JSON em disco — a mesma implementação que estava copiada em
 * `local-storage.ts`, `cbers/archive.ts`, `ndvi/archive.ts`, `ndvi-scene/archive.ts`,
 * `landsat/utils.ts` e `analise-pos-recorte/checkpoint-store.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** `mkdir -p`. */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Escreve JSON sem deixar arquivo pela metade: grava num `.tmp` com nome único
 * e renomeia (rename é atômico dentro do mesmo filesystem).
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

/** Lê JSON devolvendo `fallback` se o arquivo não existir ou estiver corrompido. */
export function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}
