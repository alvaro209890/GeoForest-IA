import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Toda coleção que o backend persiste precisa estar em `ALLOWED_COLLECTIONS`
 * (backend/local-storage.ts). Esquecer não quebra o build: o write lança
 * `INVALID_DOC_PATH` em runtime — foi assim com `solicitacao_prioridade_jobs`
 * e com `overlap_jobs` (aba Sobreposições inteira fora do ar).
 *
 * A lista é extraída do próprio código (`collection: "x"` dos hubs SSE e
 * `["users", uid, "x", ...]`), então coleção nova entra no teste sozinha.
 */
const BACKEND_DIR = __dirname;

function collectUsedCollections(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/collection:\s*"([a-z_]+)"/g)) found.add(m[1]);
        for (const m of src.matchAll(/\["users",\s*[A-Za-z_.]+,\s*"([a-z_]+)"/g)) found.add(m[1]);
      }
    }
  };
  walk(BACKEND_DIR);
  return [...found].sort();
}

let storageRoot = "";
let storage: typeof import("./local-storage");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-collections-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("./local-storage");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("ALLOWED_COLLECTIONS cobre toda coleção que o backend grava", () => {
  const used = collectUsedCollections();

  it("encontrou as coleções no código (sanidade do extrator)", () => {
    expect(used).toContain("overlap_jobs");
    expect(used.length).toBeGreaterThanOrEqual(10);
  });

  it.each(used)("%s aceita write + read", (collection) => {
    const segments = ["users", "u-colecoes", collection, "doc1"];
    expect(() => storage.writeDocBySegments(segments, { ok: true })).not.toThrow();
    expect(storage.readDocBySegments(segments)?.ok).toBe(true);
  });

  it("coleção desconhecida continua recusada", () => {
    expect(() => storage.writeDocBySegments(["users", "u", "nao_existe", "d"], {})).toThrow("INVALID_DOC_PATH");
  });
});
