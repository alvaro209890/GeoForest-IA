/**
 * Guarda a whitelist de collections do `local-storage`.
 * Esquecer de registrar `simcar_lotes_jobs` faz `writeDocBySegments` lançar
 * `INVALID_DOC_PATH` e a listagem devolver vazio — sem log nenhum. Já custou um dia
 * de debug na aba "Erros de Geometria" (2026-07-13); ver docs/ARMAZENAMENTO_LOCAL_FIRESTORE.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let storageRoot = "";
let storage: typeof import("../local-storage");

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-lotes-storage-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("../local-storage");
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("simcar-lotes — persistência no banco do servidor", () => {
  const segmentos = (jobId: string) => ["users", "uid-lotes", "simcar_lotes_jobs", jobId];

  it("grava e lê o doc do job (collection na whitelist)", () => {
    storage.writeDocBySegments(segmentos("job-1"), {
      jobId: "job-1",
      status: "completed",
      filename: "recibos.zip",
      lotesConcluidos: 2,
      downloadUrl: "/api/simcar-lotes/download/job-1",
      relatorio: [{ car: "MT10005/2019", baixados: ["Arquivo Enviado.zip"], faltantes: [], erro: null }],
    });

    const lido = storage.readDocBySegments(segmentos("job-1"));
    expect(lido).toMatchObject({
      jobId: "job-1",
      status: "completed",
      lotesConcluidos: 2,
      downloadUrl: "/api/simcar-lotes/download/job-1",
    });
    expect(lido?.relatorio?.[0]?.car).toBe("MT10005/2019");
  });

  it("merge preserva o filename gravado na criação do job", () => {
    storage.writeDocBySegments(segmentos("job-2"), { jobId: "job-2", filename: "recibos.zip", status: "processing" });
    storage.writeDocBySegments(segmentos("job-2"), { status: "completed", lotesConcluidos: 1 }, { merge: true });

    expect(storage.readDocBySegments(segmentos("job-2"))).toMatchObject({
      filename: "recibos.zip",
      status: "completed",
      lotesConcluidos: 1,
    });
  });

  it("lista a collection em ordem decrescente de updatedAtMs (histórico do painel)", () => {
    const docs = storage.listCollectionBySegments(["users", "uid-lotes", "simcar_lotes_jobs"], {
      orderBy: "updatedAtMs",
      direction: "desc",
    });
    expect(docs.map((d) => d.id).sort()).toEqual(["job-1", "job-2"]);
  });

  it("grava o ZIP na área simcar-lotes/output do usuário", () => {
    const stored = storage.saveUserBuffer({
      uid: "uid-lotes",
      area: "simcar-lotes/output",
      filename: "job-1_lotes_simcar_20260805-140233.zip",
      buffer: Buffer.from("PKzip", "latin1"),
    });
    expect(stored.relativePath).toContain("users/uid-lotes/simcar-lotes/output/");
    expect(fs.existsSync(storage.getAbsoluteStoragePath(stored.relativePath))).toBe(true);
  });

  it("apagar o doc some com o job do histórico", () => {
    storage.deleteDocBySegments(segmentos("job-2"));
    expect(storage.readDocBySegments(segmentos("job-2"))).toBeNull();
    expect(storage.listCollectionBySegments(["users", "uid-lotes", "simcar_lotes_jobs"]).map((d) => d.id)).toEqual(["job-1"]);
  });
});
