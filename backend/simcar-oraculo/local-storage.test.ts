import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let storageRoot = "";
let storage: typeof import("../local-storage");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-simcar-storage-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("../local-storage");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("simcar-oraculo/local-storage", () => {
  it("faz round-trip e listagem de jobs do oráculo", () => {
    const segments = ["users", "uid-teste", "simcar_oraculo_jobs", "job-1"];

    const written = storage.writeDocBySegments(segments, {
      status: "running",
      timeline: [{ step: "queued" }],
    });
    const read = storage.readDocBySegments(segments);
    const listed = storage.listCollectionBySegments(
      ["users", "uid-teste", "simcar_oraculo_jobs"],
      { orderBy: "createdAt", direction: "asc" },
    );

    expect(written.status).toBe("running");
    expect(read).toMatchObject({ status: "running", timeline: [{ step: "queued" }] });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "job-1", data: { id: "job-1" } });
  });

  it.each([
    "simcar-oraculo/input",
    "simcar-oraculo/output",
    "simcar-oraculo/import-pdf",
    "simcar-oraculo/process-pdf",
    "simcar-oraculo/erros-zip",
  ] as const)("salva buffer na área tipada %s", (area) => {
    const stored = storage.saveUserBuffer({
      uid: "uid-teste",
      area,
      filename: "artefato.bin",
      buffer: Buffer.from(area),
    });

    expect(fs.readFileSync(stored.absolutePath, "utf8")).toBe(area);
    expect(stored.relativePath).toContain(`/simcar-oraculo/`);
  });

  it("cria as áreas do oráculo no scaffold do usuário", () => {
    const userDir = storage.ensureUserScaffold("uid-scaffold");

    expect(fs.statSync(path.join(userDir, "simcar-oraculo", "input")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(userDir, "simcar-oraculo", "process-pdf")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(userDir, "simcar-oraculo", "erros-zip")).isDirectory()).toBe(true);
  });
});
