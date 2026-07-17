import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SimcarImportOutcome, SimcarProcessOutcome } from "./types";

let storageRoot = "";
let store: typeof import("./job-store");
let routes: typeof import("./routes");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-simcar-job-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  store = await import("./job-store");
  routes = await import("./routes");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("simcar-oraculo/job-store", () => {
  it("acumula três eventos reais na timeline persistida", () => {
    store.persistOraculoJob("uid-timeline", "job-1", { status: "running", timeline: [] });

    store.appendOraculoTimelineEvent("uid-timeline", "job-1", {
      step: "queued",
      message: "Na fila",
    });
    store.appendOraculoTimelineEvent("uid-timeline", "job-1", {
      step: "upload_zip",
      message: "Enviando ZIP",
    });
    store.appendOraculoTimelineEvent(
      "uid-timeline",
      "job-1",
      { step: "import_poll", message: "Aguardando SEMA", percent: 50 },
      { percent: 50, lastStep: "import_poll" },
    );

    const job = store.readOraculoJob("uid-timeline", "job-1");
    expect(job?.timeline).toHaveLength(3);
    expect(job?.timeline.map((event: any) => event.step)).toEqual([
      "queued",
      "upload_zip",
      "import_poll",
    ]);
    expect(job).toMatchObject({ percent: 50, lastStep: "import_poll" });
    expect(job).not.toHaveProperty("timelinePush");
  });
});

describe("simcar-oraculo/job completion contract", () => {
  const baseImport: SimcarImportOutcome = {
    ok: false,
    resultado: "[COM_PENDENCIA]",
    status: "[CONCLUIDO]",
    detalhes: "11 feições",
    raw: {},
    timeline: [],
  };
  const baseProcess: SimcarProcessOutcome = {
    ok: false,
    resultado: "[COM_PENDENCIA]",
    status: "[CONCLUIDO]",
    detalhes: "41 feições",
    raw: {},
    timeline: [],
  };

  it("trata reprovação SEMA como job concluído com importOk=false", () => {
    const patch = routes.buildImportCompletionPatch({
      outcome: baseImport,
      importPdfRelativePath: "users/u/simcar-oraculo/import-pdf/import.pdf",
      importPdfUrl: "/api/simcar-oraculo/jobs/j/pdf-import",
      finishedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(patch).toMatchObject({ status: "completed", ok: false, importOk: false });
    expect(patch).not.toHaveProperty("pdfRelativePath");
  });

  it("mantém caminhos distintos para os PDFs de importação e processamento", () => {
    const importPatch = routes.buildImportCompletionPatch({
      outcome: baseImport,
      importPdfRelativePath: "users/u/simcar-oraculo/import-pdf/import.pdf",
      importPdfUrl: "/api/simcar-oraculo/jobs/j/pdf-import",
    });
    const processPatch = routes.buildProcessCompletionPatch({
      outcome: baseProcess,
      processPdfRelativePath: "users/u/simcar-oraculo/process-pdf/process.pdf",
      processPdfUrl: "/api/simcar-oraculo/jobs/j/pdf-process",
      errosZipRelativePath: null,
      errosZipUrl: null,
    });
    const combined = { ...importPatch, ...processPatch };

    expect(combined.importPdfRelativePath).toContain("import-pdf/import.pdf");
    expect(combined.processPdfRelativePath).toContain("process-pdf/process.pdf");
    expect(combined.importPdfRelativePath).not.toBe(combined.processPdfRelativePath);
    expect(combined).toMatchObject({ importOk: false, processOk: false });
  });
});
