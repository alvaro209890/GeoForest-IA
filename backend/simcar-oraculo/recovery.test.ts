import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let storageRoot = "";
let storage: typeof import("../local-storage");
let processingJobs: typeof import("../processing-jobs");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-simcar-recovery-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("../local-storage");
  processingJobs = await import("../processing-jobs");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("recuperação de jobs no boot", () => {
  it("marca jobs ativos locais e do oráculo como interrupted sem alterar jobs finais", () => {
    const uid = "uid-recovery";
    storage.writeDocBySegments(["users", uid, "processing_jobs", "job-local"], {
      status: "running",
      endpoint: "/api/processar-projeto/processar",
    });
    storage.writeDocBySegments(["users", uid, "processar_projeto_jobs", "job-local"], {
      status: "processing",
    });
    storage.writeDocBySegments(["users", uid, "processar_projeto_jobs", "upload-pronto"], {
      status: "uploaded",
    });
    storage.writeDocBySegments(["users", uid, "simcar_oraculo_jobs", "job-oraculo"], {
      status: "running",
    });
    storage.writeDocBySegments(["users", uid, "simcar_oraculo_jobs", "job-final"], {
      status: "completed",
    });

    const interrupted = processingJobs.markPersistedRunningJobsInterrupted();

    expect(interrupted).toBe(2);
    expect(
      storage.readDocBySegments(["users", uid, "processing_jobs", "job-local"]),
    ).toMatchObject({ status: "failed" });
    expect(
      storage.readDocBySegments(["users", uid, "processar_projeto_jobs", "job-local"]),
    ).toMatchObject({ status: "interrupted", stage: "interrupted", ok: false });
    expect(
      storage.readDocBySegments(["users", uid, "simcar_oraculo_jobs", "job-oraculo"]),
    ).toMatchObject({ status: "interrupted", stage: "interrupted", ok: false });
    expect(
      storage.readDocBySegments(["users", uid, "processar_projeto_jobs", "upload-pronto"]),
    ).toMatchObject({ status: "uploaded" });
    expect(
      storage.readDocBySegments(["users", uid, "simcar_oraculo_jobs", "job-final"]),
    ).toMatchObject({ status: "completed" });
  });
});
