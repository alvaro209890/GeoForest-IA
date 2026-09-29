import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

describe("ALLOWED_COLLECTIONS cobre toda coleção que o backend persiste", () => {
  it("overlap_jobs (aba Sobreposição) grava e lê — antes todo upload caía em INVALID_DOC_PATH", () => {
    const segments = ["users", "uid-1", "overlap_jobs", "upload-1"];
    expect(() => storage.writeDocBySegments(segments, { type: "upload", status: "uploaded" })).not.toThrow();
    expect(storage.readDocBySegments(segments)).toMatchObject({ type: "upload", status: "uploaded" });
    expect(storage.listCollectionBySegments(["users", "uid-1", "overlap_jobs"])).toHaveLength(1);
  });

  it("toda coleção passada a createSseHub no backend está liberada", () => {
    // Varre o fonte: coleção nova de job sem entrada na whitelist quebra a aba em produção
    // sem quebrar teste nenhum (foi o que aconteceu com overlap_jobs).
    const backendDir = path.resolve(__dirname);
    const collections = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "fixtures") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/createSseHub\(\{\s*collection:\s*"([a-z_]+)"/g)) collections.add(m[1]);
      }
    };
    walk(backendDir);
    expect(collections.size).toBeGreaterThan(3);
    const rejected = [...collections].filter((name) => {
      try {
        storage.writeDocBySegments(["users", "uid-scan", name, "doc-1"], { ok: true });
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toEqual([]);
  });
});
