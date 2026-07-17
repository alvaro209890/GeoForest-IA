import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OraculoProgress, ShapeContext } from "./types";

let storageRoot = "";
let pipeline: typeof import("./pipeline");
let store: typeof import("./job-store");
let queue: typeof import("./queue");

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/teste_1",
);

const shape: ShapeContext = {
  bbox: [-52.8, -12.8, -52.4, -12.4],
  centroid: [-52.6, -12.6],
  layers: ["ATP", "AIR", "AREA_UMIDA"],
  propertyLayer: "ATP",
  municipioDetectado: { nome: "Querência", ibge: "5107065", fonte: "malha-ibge" },
  warnings: [],
};

function progress(
  callback: ((event: OraculoProgress) => void) | undefined,
  step: OraculoProgress["step"],
  message: string,
  percent: number,
): void {
  callback?.({ step, message, percent });
}

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-simcar-pipeline-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  process.env.SIMCAR_TEST_CAR_ID = "270069";
  vi.resetModules();
  pipeline = await import("./pipeline");
  store = await import("./job-store");
  queue = await import("./queue");
});

beforeEach(() => {
  queue.__resetSimcarQueueForTests();
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  delete process.env.SIMCAR_TEST_CAR_ID;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("startOraculoPipeline", () => {
  it("encadeia prepare → import aprovado → ProcessarGeo e salva artefatos por rodada", async () => {
    const order: string[] = [];
    const importPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_importacao_v22_sema.pdf"),
    );
    const processPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_processamento_v22_sema.pdf"),
    );
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-happy",
      uploadId: "upload-happy",
      jobId: "job-happy",
      zip: Buffer.from("zip-original"),
      fileName: "santa-clara.zip",
      shape,
      dependencies: {
        prepare: async ({ onEvent }) => {
          order.push("prepare");
          progress(onEvent, "municipio_ok", "Município pronto", 12);
          progress(onEvent, "abrangencia_ok", "Abrangência pronta", 20);
          return {
            municipioAntes: "Querência",
            municipioDepois: "Querência",
            municipioChanged: false,
            abrangenciaChanged: false,
            baserefWaitedMs: 0,
            warnings: [],
          };
        },
        importZip: async ({ onProgress }) => {
          order.push("import");
          progress(onProgress, "upload_zip", "Upload", 15);
          progress(onProgress, "importar", "Importar", 25);
          progress(onProgress, "import_poll", "Concluído", 85);
          return {
            ok: true,
            resultado: "[FINALIZADO]",
            status: "[CONCLUIDO]",
            detalhes: "Importação aprovada",
            raw: {},
            pdfBuffer: importPdf,
            timeline: [],
          };
        },
        processGeo: async ({ onProgress }) => {
          order.push("process");
          progress(onProgress, "processar", "Processar", 15);
          progress(onProgress, "process_poll", "Concluído", 85);
          return {
            ok: true,
            resultado: "[FINALIZADO]",
            status: "[CONCLUIDO]",
            detalhes: "Processamento aprovado",
            raw: {},
            pdfBuffer: processPdf,
            errosZipBuffer: Buffer.from("zip-erros"),
            timeline: [],
          };
        },
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(order).toEqual(["prepare", "import", "process"]);
    expect(completed).toMatchObject({
      status: "completed",
      ok: true,
      importOk: true,
      processOk: true,
      round: 1,
    });
    expect(completed.rounds[0]).toMatchObject({
      n: 1,
      zipArtifact: "enviado-zip-r1",
      import: { ok: true, pdf: "import-pdf-r1", errosResumo: [] },
      process: {
        ok: true,
        pdf: "process-pdf-r1",
        errosZip: "erros-zip-r1",
        errosResumo: [
          {
            camada: "AREA_UMIDA",
            erro: "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA.",
            qtd: 41,
          },
        ],
      },
    });
    expect(Object.keys(completed.artifacts).sort()).toEqual([
      "enviado-zip-r1",
      "erros-zip-r1",
      "import-pdf-r1",
      "process-pdf-r1",
    ]);
    for (const artifact of Object.values(completed.artifacts) as Array<any>) {
      expect(artifact.relativePath).toContain(
        "users/uid-pipeline-happy/simcar-oraculo/job-happy/r1/",
      );
      expect(fs.existsSync(path.resolve(storageRoot, artifact.relativePath))).toBe(true);
    }
    expect(
      pipeline.resolveOraculoArtifact(
        "uid-pipeline-happy",
        "job-happy",
        "process-pdf-r1",
      )?.artifact.key,
    ).toBe("process-pdf-r1");
    expect(
      pipeline.resolveOraculoArtifact("outro-uid", "job-happy", "process-pdf-r1"),
    ).toBeNull();
    expect(
      pipeline.resolveOraculoArtifact(
        "uid-pipeline-happy",
        "job-happy",
        "../../process-pdf-r1",
      ),
    ).toBeNull();
    store.persistOraculoJob("uid-pipeline-happy", "job-happy", {
      artifacts: {
        ...completed.artifacts,
        adulterado: {
          ...completed.artifacts["process-pdf-r1"],
          key: "adulterado",
          relativePath:
            "users/uid-pipeline-happy/simcar-oraculo/job-happy/../../../../outro-uid/segredo.pdf",
        },
      },
    });
    expect(
      pipeline.resolveOraculoArtifact("uid-pipeline-happy", "job-happy", "adulterado"),
    ).toBeNull();
    expect(completed.timeline.map((event: any) => event.step)).toEqual(
      expect.arrayContaining(["queued", "import_ok", "process_ok", "done"]),
    );
    expect(completed.timeline.every((event: any) => event.ts && event.round === 1)).toBe(true);
    expect(fs.existsSync(path.resolve(storageRoot, completed.snapshotRelativePath))).toBe(true);
  });

  it("encerra como resultado concluído quando import reprova e não chama ProcessarGeo", async () => {
    const processGeo = vi.fn(async () => {
      throw new Error("não deveria processar");
    });
    const importPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_importacao_v23_sema.pdf"),
    );
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-rejected",
      uploadId: "upload-rejected",
      jobId: "job-rejected",
      zip: Buffer.from("zip-v23"),
      fileName: "v23.zip",
      shape,
      dependencies: {
        prepare: async () => ({
          municipioAntes: "Querência",
          municipioDepois: "Querência",
          municipioChanged: false,
          abrangenciaChanged: false,
          baserefWaitedMs: 0,
          warnings: [],
        }),
        importZip: async () => ({
          ok: false,
          resultado: "[COM_PENDENCIA]",
          status: "[CONCLUIDO]",
          detalhes: "11 erros",
          raw: {},
          pdfBuffer: importPdf,
          timeline: [],
        }),
        processGeo,
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(processGeo).not.toHaveBeenCalled();
    expect(completed).toMatchObject({
      status: "completed",
      ok: false,
      importOk: false,
      processOk: null,
    });
    expect(completed.rounds[0].process).toBeNull();
    expect(completed.rounds[0].import.errosResumo).toEqual([
      { camada: "AREA_UMIDA", erro: "A geometria contém pontos repetidos", qtd: 11 },
    ]);
    expect(completed.timeline.map((event: any) => event.step)).toContain("import_fail");
  });

  it("cancela durante a importação, tenta CancelarImportacaoShape e termina cancelled", async () => {
    const cancelRemote = vi.fn(async () => undefined);
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-cancel",
      uploadId: "upload-cancel",
      jobId: "job-cancel",
      zip: Buffer.from("zip-cancel"),
      fileName: "cancel.zip",
      shape,
      dependencies: {
        prepare: async () => ({
          municipioAntes: "Querência",
          municipioDepois: "Querência",
          municipioChanged: false,
          abrangenciaChanged: false,
          baserefWaitedMs: 0,
          warnings: [],
        }),
        importZip: async ({ onProgress, checkCancelled }) => {
          progress(onProgress, "importar", "Importação disparada", 25);
          const requested = pipeline.requestOraculoPipelineCancellation(
            "uid-pipeline-cancel",
            "job-cancel",
          );
          expect(requested.status).toBe("requested");
          await checkCancelled?.();
          throw new Error("inalcançável");
        },
        processGeo: vi.fn(async () => {
          throw new Error("não deveria processar");
        }),
        cancelRemote,
      },
    });

    const completed = await started.completion;

    expect(completed.status).toBe("cancelled");
    expect(completed.cancelRequested).toBe(false);
    expect(cancelRemote).toHaveBeenCalledWith("import", "270069");
    expect(completed.timeline.map((event: any) => event.step)).toEqual(
      expect.arrayContaining(["cancel_requested", "cancelled"]),
    );
    expect(store.readOraculoJob("uid-pipeline-cancel", "job-cancel")?.status).toBe(
      "cancelled",
    );
  });
});
