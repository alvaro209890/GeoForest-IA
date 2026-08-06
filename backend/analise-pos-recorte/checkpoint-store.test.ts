import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createFileCheckpointStore", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auas-checkpoint-"));
    process.env.LOCAL_DATA_ROOT = tmpRoot;
  });

  afterEach(() => {
    delete process.env.LOCAL_DATA_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("persiste e recupera um checkpoint entre instâncias (simula retomada após reinício)", async () => {
    const { createFileCheckpointStore } = await import("./checkpoint-store");
    const store1 = createFileCheckpointStore("job-abc");
    await store1.set("key-1", {
      polygonId: "AUAS-0001",
      windowId: "W2003_2005",
      status: "COMPLETED",
      model: "qwen/qwen3.6-27b",
    });

    const store2 = createFileCheckpointStore("job-abc");
    const value = await store2.get("key-1");
    expect(value?.status).toBe("COMPLETED");
  });

  it("não retorna checkpoint de outro job", async () => {
    const { createFileCheckpointStore } = await import("./checkpoint-store");
    const storeA = createFileCheckpointStore("job-a");
    await storeA.set("key-1", { polygonId: "P", windowId: "W2003_2005", status: "COMPLETED", model: "m" });
    const storeB = createFileCheckpointStore("job-b");
    expect(await storeB.get("key-1")).toBeUndefined();
  });

  it("continua lendo chaves gravadas por versões anteriores (sem prefixo de fase)", async () => {
    const { createFileCheckpointStore } = await import("./checkpoint-store");
    const legacyKey = "a".repeat(64);
    const store = createFileCheckpointStore("job-legado");
    await store.set(legacyKey, { polygonId: "AUAS-0001", windowId: "W2003_2005", status: "COMPLETED", model: "m" });
    expect((await createFileCheckpointStore("job-legado").get(legacyKey))?.status).toBe("COMPLETED");
  });
});

describe("buildPhaseCheckpointKey (U-13)", () => {
  const base = {
    jobId: "job-1",
    rulesVersion: "auas-pre2008-v1",
    geometryHash: "hash-1",
    windowId: "W2003_2005",
    imageSha256s: ["sha-a", "sha-b"],
  } as const;

  it("chaves de fases diferentes não colidem", async () => {
    const { buildPhaseCheckpointKey } = await import("./checkpoint-store");
    const pre = buildPhaseCheckpointKey({ ...base, phase: "PRE_2008" });
    const pos = buildPhaseCheckpointKey({ ...base, phase: "POS_2008" });
    const acVeg = buildPhaseCheckpointKey({ ...base, phase: "AC_VEG" });
    expect(new Set([pre, pos, acVeg]).size).toBe(3);
    expect(pre.startsWith("PRE_2008::")).toBe(true);
    expect(pos.startsWith("POS_2008::")).toBe(true);
  });

  it("catalogVersion diferente invalida a chave", async () => {
    const { buildPhaseCheckpointKey, STATIC_CATALOG_VERSION } = await import("./checkpoint-store");
    const v1 = buildPhaseCheckpointKey({ ...base, phase: "POS_2008", catalogVersion: "wms-2026-08-05" });
    const v2 = buildPhaseCheckpointKey({ ...base, phase: "POS_2008", catalogVersion: "wms-2026-09-01" });
    expect(v1).not.toBe(v2);
    expect(buildPhaseCheckpointKey({ ...base, phase: "POS_2008" })).toContain(STATIC_CATALOG_VERSION);
  });

  it("rulesVersion diferente invalida a chave", async () => {
    const { buildPhaseCheckpointKey } = await import("./checkpoint-store");
    expect(buildPhaseCheckpointKey({ ...base, phase: "PRE_2008" })).not.toBe(
      buildPhaseCheckpointKey({ ...base, phase: "PRE_2008", rulesVersion: "auas-pre2008-v2" })
    );
  });

  it("é estável e insensível à ordem dos hashes de imagem, mas sensível ao conteúdo", async () => {
    const { buildPhaseCheckpointKey } = await import("./checkpoint-store");
    const a = buildPhaseCheckpointKey({ ...base, phase: "PRE_2008" });
    const b = buildPhaseCheckpointKey({ ...base, phase: "PRE_2008", imageSha256s: ["sha-b", "sha-a"] });
    const c = buildPhaseCheckpointKey({ ...base, phase: "PRE_2008", imageSha256s: ["sha-a", "sha-c"] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("a chave da Fase 1 do orquestrador usa o namespace PRE_2008", async () => {
    const { buildCheckpointKey } = await import("./orchestrator");
    const { buildPhaseCheckpointKey } = await import("./checkpoint-store");
    const fromOrchestrator = buildCheckpointKey("job-1", "hash-1", "W2003_2005", "auas-pre2008-v1", [
      "sha-a",
      "sha-b",
    ]);
    expect(fromOrchestrator).toBe(buildPhaseCheckpointKey({ ...base, phase: "PRE_2008" }));
  });
});
