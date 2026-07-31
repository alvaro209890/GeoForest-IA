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
});
