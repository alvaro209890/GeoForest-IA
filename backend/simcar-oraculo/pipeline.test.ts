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

const duplicatePlan = {
  acoes: [
    {
      type: "remove_duplicate_vertices" as const,
      layers: ["AREA_UMIDA"],
      motivo: "A SEMA encontrou pontos repetidos.",
    },
  ],
  naoCorrigivel: [],
  explicacaoUsuario:
    "Remover os vértices repetidos de AREA_UMIDA e reenviar o mesmo projeto.",
  confianca: "alta" as const,
  fonte: "fallback" as const,
  modelo: null,
  avisos: [],
};

const duplicateDiff = {
  camada: "AREA_UMIDA",
  acao: "remove_duplicate_vertices" as const,
  alterou: true,
  feicoesAfetadas: [1],
  registrosAntes: 1,
  registrosDepois: 1,
  verticesRemovidos: 11,
  aneisRemovidos: 0,
  registrosRemovidos: 0,
  registrosCriados: 0,
  identificadoresCriados: 0,
  avisos: [],
};

const clipPlan = {
  acoes: [
    {
      type: "clip_layer_to_cover" as const,
      layers: ["AREA_UMIDA"],
      motivo: "A SEMA encontrou área úmida fora da cobertura.",
    },
  ],
  naoCorrigivel: [],
  explicacaoUsuario: "Recortar AREA_UMIDA à cobertura e reenviar.",
  confianca: "alta" as const,
  fonte: "fallback" as const,
  modelo: null,
  avisos: [],
};

const clipDiff = {
  camada: "AREA_UMIDA",
  acao: "clip_layer_to_cover" as const,
  alterou: true,
  feicoesAfetadas: [1],
  registrosAntes: 2,
  registrosDepois: 2,
  verticesRemovidos: 0,
  aneisRemovidos: 0,
  registrosRemovidos: 0,
  registrosCriados: 1,
  identificadoresCriados: 1,
  avisos: ["1 fragmento pós-clip abaixo de 100 m² foi descartado."],
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
    const officialDownloads = new Map<string, Buffer>([
      ["DownloadArquivoEnviado", Buffer.from("zip-enviado-oficial")],
      ["DownloadArquivoProcessado", Buffer.from("zip-processado")],
      ["DownloadArquivoConferencia", Buffer.from("zip-conferencia")],
      ["DownloadArquivoPendencias", Buffer.from("zip-pendencias")],
    ]);
    const downloadArtifact = vi.fn(async (pathname: string) => {
      const entry = [...officialDownloads.entries()].find(([needle]) => pathname.includes(needle));
      if (!entry) throw new Error(`download inesperado: ${pathname}`);
      return { buffer: entry[1], contentType: "application/zip" };
    });
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
        downloadArtifact,
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
      "conferencia-zip-r1",
      "enviado-zip-r1",
      "erros-zip-r1",
      "import-pdf-r1",
      "pendencias-zip-r1",
      "process-pdf-r1",
      "processado-zip-r1",
    ]);
    expect(downloadArtifact.mock.calls.map(([pathname]) => pathname)).toEqual([
      "Requerimento/DownloadArquivoEnviado/270069",
      "Requerimento/DownloadArquivoProcessado/270069",
      "Requerimento/DownloadArquivoConferencia/270069",
      "Requerimento/DownloadArquivoPendencias/270069",
    ]);
    expect(completed.artifacts["enviado-zip-r1"].source).toBe("sema");
    expect(
      fs.readFileSync(
        path.resolve(storageRoot, completed.artifacts["enviado-zip-r1"].relativePath),
        "utf8",
      ),
    ).toBe("zip-enviado-oficial");
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
    const missingOptional = vi.fn(async () => {
      throw Object.assign(new Error("HTTP 400: arquivo não existe"), { status: 400 });
    });
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
        downloadArtifact: missingOptional,
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
    expect(missingOptional).toHaveBeenCalledTimes(1);
    expect(completed.artifacts["enviado-zip-r1"].source).toBe("upload");
    expect(completed.rounds[0].artifactWarnings).toEqual([
      "ZIP enviado não disponível nesta rodada.",
    ]);
    expect(completed.timeline.map((event: any) => event.step)).toContain("import_fail");
  });

  it("corrige uma reprovação e aprova na segunda rodada sem repetir prepare nem a fila", async () => {
    const rejectedPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_importacao_v23_sema.pdf")
    );
    const approvedPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_importacao_v22_sema.pdf")
    );
    const processPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_processamento_v22_sema.pdf")
    );
    const enqueue = vi.fn(async <T>(operation: () => Promise<T>) =>
      operation()
    );
    const prepare = vi.fn(async () => ({
      municipioAntes: "Querência",
      municipioDepois: "Querência",
      municipioChanged: false,
      abrangenciaChanged: false,
      baserefWaitedMs: 0,
      warnings: [],
    }));
    const importZip = vi.fn(async () => {
      const firstRound = importZip.mock.calls.length === 1;
      return {
        ok: !firstRound,
        resultado: firstRound ? "[COM_PENDENCIA]" : "[FINALIZADO]",
        status: "[CONCLUIDO]",
        detalhes: firstRound ? "11 pontos repetidos" : "Importação aprovada",
        raw: {},
        pdfBuffer: firstRound ? rejectedPdf : approvedPdf,
        timeline: [],
      };
    });
    const processGeo = vi.fn(async () => ({
      ok: true,
      resultado: "[FINALIZADO]",
      status: "[CONCLUIDO]",
      detalhes: "Processamento aprovado",
      raw: {},
      pdfBuffer: processPdf,
      timeline: [],
    }));
    const buildPlan = vi.fn(async () => duplicatePlan);
    const applyFixes = vi.fn(async () => ({
      novoZip: Buffer.from("zip-corrigido-r2"),
      diffResumo: [duplicateDiff],
    }));
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-autofix-ok",
      uploadId: "upload-autofix-ok",
      jobId: "job-autofix-ok",
      zip: Buffer.from("zip-com-pontos-repetidos"),
      fileName: "v23.zip",
      shape,
      autofix: true,
      dependencies: {
        enqueue,
        prepare,
        importZip,
        processGeo,
        buildFixPlan: buildPlan,
        applyFixActions: applyFixes,
        downloadArtifact: vi.fn(async () => ({
          buffer: Buffer.from("artefato-sema"),
          contentType: "application/zip",
        })),
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(importZip).toHaveBeenCalledTimes(2);
    expect(importZip.mock.calls[1][0]).toMatchObject({
      fileName: "corrigido_r2.zip",
    });
    expect(importZip.mock.calls[1][0].zip.toString("utf8")).toBe(
      "zip-corrigido-r2"
    );
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(applyFixes).toHaveBeenCalledTimes(1);
    expect(processGeo).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({
      status: "completed",
      ok: true,
      importOk: true,
      processOk: true,
      round: 2,
      autofixStopReason: null,
    });
    expect(completed.rounds).toHaveLength(2);
    expect(completed.rounds[0]).toMatchObject({
      n: 1,
      fixplan: "fixplan-r1",
      fixPlan: duplicatePlan,
      diffResumo: [duplicateDiff],
    });
    expect(completed.rounds[1]).toMatchObject({
      n: 2,
      zipArtifact: "corrigido-zip-r2",
      import: { ok: true },
      process: { ok: true },
    });
    expect(completed.artifacts["corrigido-zip-r2"].source).toBe("autofix");
    expect(completed.artifacts["fixplan-r1"].contentType).toBe(
      "application/json"
    );
    const fixPlanJson = JSON.parse(
      fs.readFileSync(
        path.resolve(
          storageRoot,
          completed.artifacts["fixplan-r1"].relativePath
        ),
        "utf8"
      )
    );
    expect(fixPlanJson).toMatchObject({
      schemaVersion: 1,
      round: 1,
      phase: "import",
      input: { totalErrors: 11 },
      plan: duplicatePlan,
      diffResumo: [duplicateDiff],
      resultadoRodadaSeguinte: {
        round: 2,
        import: { ok: true },
        process: { ok: true },
      },
    });
    expect(completed.timeline.map((event: any) => event.step)).toEqual(
      expect.arrayContaining([
        "autofix_plan",
        "autofix_apply",
        "import_ok",
        "done",
      ])
    );
  });

  it("recorta a camada após reprovação do ProcessarGeo e reimporta sem repetir prepare nem a fila", async () => {
    const processRejectedPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_processamento_v22_sema.pdf")
    );
    const enqueue = vi.fn(async <T>(operation: () => Promise<T>) =>
      operation()
    );
    const prepare = vi.fn(async () => ({
      municipioAntes: "Querência",
      municipioDepois: "Querência",
      municipioChanged: false,
      abrangenciaChanged: false,
      baserefWaitedMs: 0,
      warnings: [],
    }));
    const importZip = vi.fn(async () => ({
      ok: true,
      resultado: "[FINALIZADO]",
      status: "[CONCLUIDO]",
      detalhes: "Importação aprovada",
      raw: {},
      pdfBuffer: null,
      timeline: [],
    }));
    const processGeo = vi.fn(async () => {
      const firstRound = processGeo.mock.calls.length === 1;
      return {
        ok: !firstRound,
        resultado: firstRound ? "[COM_PENDENCIA]" : "[FINALIZADO]",
        status: "[CONCLUIDO]",
        detalhes: firstRound ? "41 áreas úmidas fora" : "Aprovado",
        raw: {},
        pdfBuffer: firstRound ? processRejectedPdf : null,
        timeline: [],
      };
    });
    const buildPlan = vi.fn(async (input: any) => {
      expect(input.allowedActions).toEqual(["clip_layer_to_cover"]);
      return clipPlan;
    });
    const applyFixes = vi.fn(async () => ({
      novoZip: Buffer.from("zip-v22-recortado"),
      diffResumo: [clipDiff],
    }));
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-process-autofix",
      uploadId: "upload-process-autofix",
      jobId: "job-process-autofix",
      zip: Buffer.from("zip-v22"),
      fileName: "v22.zip",
      shape,
      autofix: true,
      dependencies: {
        enqueue,
        prepare,
        importZip,
        processGeo,
        buildFixPlan: buildPlan,
        applyFixActions: applyFixes,
        downloadArtifact: vi.fn(async () => ({
          buffer: Buffer.from("artefato-sema"),
          contentType: "application/zip",
        })),
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(importZip).toHaveBeenCalledTimes(2);
    expect(processGeo).toHaveBeenCalledTimes(2);
    expect(buildPlan).toHaveBeenCalledTimes(1);
    expect(applyFixes).toHaveBeenCalledTimes(1);
    expect(importZip.mock.calls[1][0]).toMatchObject({
      fileName: "corrigido_r2.zip",
    });
    expect(importZip.mock.calls[1][0].zip.toString("utf8")).toBe(
      "zip-v22-recortado"
    );
    expect(completed).toMatchObject({
      status: "completed",
      ok: true,
      importOk: true,
      processOk: true,
      round: 2,
    });
    expect(completed.rounds[0]).toMatchObject({
      n: 1,
      process: {
        ok: false,
        errosResumo: [
          {
            camada: "AREA_UMIDA",
            erro: "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA.",
            qtd: 41,
          },
        ],
      },
      autofixPhase: "process",
      fixPlan: clipPlan,
      diffResumo: [clipDiff],
    });
    expect(completed.rounds[1]).toMatchObject({
      n: 2,
      import: { ok: true },
      process: { ok: true },
    });
    const fixPlanJson = JSON.parse(
      fs.readFileSync(
        path.resolve(
          storageRoot,
          completed.artifacts["fixplan-r1"].relativePath
        ),
        "utf8"
      )
    );
    expect(fixPlanJson).toMatchObject({
      phase: "process",
      input: { totalErrors: 41 },
      plan: clipPlan,
      diffResumo: [clipDiff],
      resultadoRodadaSeguinte: {
        round: 2,
        import: { ok: true },
        process: { ok: true },
      },
    });
  });

  it("para em sem melhora quando a SEMA repete os erros e o mesmo plano", async () => {
    const rejectedPdf = fs.readFileSync(
      path.join(fixtureDir, "relatorio_importacao_v23_sema.pdf")
    );
    const importZip = vi.fn(async () => ({
      ok: false,
      resultado: "[COM_PENDENCIA]",
      status: "[CONCLUIDO]",
      detalhes: "11 pontos repetidos",
      raw: {},
      pdfBuffer: rejectedPdf,
      timeline: [],
    }));
    const buildPlan = vi.fn(async () => duplicatePlan);
    const applyFixes = vi.fn(async () => ({
      novoZip: Buffer.from("zip-ainda-reprovado"),
      diffResumo: [duplicateDiff],
    }));
    const processGeo = vi.fn(async () => {
      throw new Error("não deveria processar");
    });
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-no-improvement",
      uploadId: "upload-no-improvement",
      jobId: "job-no-improvement",
      zip: Buffer.from("zip-quebrado"),
      fileName: "quebrado.zip",
      shape,
      autofix: true,
      dependencies: {
        prepare: async () => ({
          municipioAntes: "Querência",
          municipioDepois: "Querência",
          municipioChanged: false,
          abrangenciaChanged: false,
          baserefWaitedMs: 0,
          warnings: [],
        }),
        importZip,
        processGeo,
        buildFixPlan: buildPlan,
        applyFixActions: applyFixes,
        downloadArtifact: vi.fn(async () => ({
          buffer: Buffer.from("enviado-sema"),
          contentType: "application/zip",
        })),
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(importZip).toHaveBeenCalledTimes(2);
    expect(buildPlan).toHaveBeenCalledTimes(2);
    expect(applyFixes).toHaveBeenCalledTimes(1);
    expect(processGeo).not.toHaveBeenCalled();
    expect(completed).toMatchObject({
      status: "completed",
      ok: false,
      importOk: false,
      processOk: null,
      round: 2,
      autofixStopReason: "no_improvement",
      manualAutofixAvailable: false,
    });
    expect(completed.rounds).toHaveLength(2);
    expect(completed.rounds[1]).toMatchObject({
      fixplan: "fixplan-r2",
      fixPlan: duplicatePlan,
      diffResumo: [],
    });
    expect(completed.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "autofix_skip",
          message: expect.stringContaining("sem melhora"),
          round: 2,
        }),
      ])
    );
  });

  it("respeita o teto de três rodadas mesmo quando a contagem ainda melhora", async () => {
    let parsedRound = 0;
    const importZip = vi.fn(async () => ({
      ok: false,
      resultado: "[COM_PENDENCIA]",
      status: "[CONCLUIDO]",
      detalhes: "pontos repetidos",
      raw: {},
      pdfBuffer: Buffer.from("pdf-sintetico"),
      timeline: [],
    }));
    const buildPlan = vi.fn(async () => duplicatePlan);
    const applyFixes = vi.fn(async () => ({
      novoZip: Buffer.from(`zip-corrigido-${applyFixes.mock.calls.length}`),
      diffResumo: [duplicateDiff],
    }));
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-max-rounds",
      uploadId: "upload-max-rounds",
      jobId: "job-max-rounds",
      zip: Buffer.from("zip-quebrado"),
      fileName: "quebrado.zip",
      shape,
      autofix: true,
      maxRounds: 3,
      dependencies: {
        prepare: async () => ({
          municipioAntes: "Querência",
          municipioDepois: "Querência",
          municipioChanged: false,
          abrangenciaChanged: false,
          baserefWaitedMs: 0,
          warnings: [],
        }),
        importZip,
        processGeo: vi.fn(async () => {
          throw new Error("não deveria processar");
        }),
        parseReportPdf: vi.fn(async () => {
          const qtd = [11, 10, 9][parsedRound] || 9;
          parsedRound += 1;
          return {
            tipo: "importacao" as const,
            situacao: "REPROVADA",
            resumo: [
              {
                camada: "AREA_UMIDA",
                erro: "A geometria contém pontos repetidos",
                qtd,
              },
            ],
            porFeicao: [],
            raw: "Relatório com pontos repetidos",
            warnings: [],
          };
        }),
        buildFixPlan: buildPlan,
        applyFixActions: applyFixes,
        downloadArtifact: vi.fn(async () => ({
          buffer: Buffer.from("enviado-sema"),
          contentType: "application/zip",
        })),
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(importZip).toHaveBeenCalledTimes(3);
    expect(buildPlan).toHaveBeenCalledTimes(2);
    expect(applyFixes).toHaveBeenCalledTimes(2);
    expect(completed.rounds).toHaveLength(3);
    expect(completed).toMatchObject({
      status: "completed",
      ok: false,
      round: 3,
      maxRounds: 3,
      autofixStopReason: "max_rounds",
    });
    expect(completed.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "autofix_skip",
          message: expect.stringContaining("Teto de rodadas"),
          round: 3,
        }),
      ]),
    );
  });

  it("para sem reescrever o ZIP quando o plano não tem ação mecânica", async () => {
    const applyFixes = vi.fn(async () => {
      throw new Error("não deveria aplicar");
    });
    const started = pipeline.startOraculoPipeline({
      uid: "uid-pipeline-no-action",
      uploadId: "upload-no-action",
      jobId: "job-no-action",
      zip: Buffer.from("zip-sem-acao"),
      fileName: "sem-acao.zip",
      shape,
      autofix: true,
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
          detalhes: "atributo exige decisão",
          raw: {},
          pdfBuffer: Buffer.from("pdf-sintetico"),
          timeline: [],
        }),
        processGeo: vi.fn(async () => {
          throw new Error("não deveria processar");
        }),
        parseReportPdf: async () => ({
          tipo: "importacao",
          situacao: "REPROVADA",
          resumo: [
            {
              camada: "RESERVATORIO_ARTIFICIAL",
              erro: "Campo barramento é obrigatório",
              qtd: 1,
            },
          ],
          porFeicao: [],
          raw: "Relatório de atributo obrigatório",
          warnings: [],
        }),
        buildFixPlan: async () => ({
          acoes: [],
          naoCorrigivel: [
            {
              erro: "RESERVATORIO_ARTIFICIAL: barramento",
              porque: "Exige decisão cadastral.",
              orientacao: "Revise o atributo no GIS.",
            },
          ],
          explicacaoUsuario: "Não há correção mecânica segura.",
          confianca: "baixa",
          fonte: "fallback",
          modelo: null,
          avisos: [],
        }),
        applyFixActions: applyFixes,
        downloadArtifact: vi.fn(async () => ({
          buffer: Buffer.from("enviado-sema"),
          contentType: "application/zip",
        })),
        cancelRemote: vi.fn(async () => undefined),
      },
    });

    const completed = await started.completion;

    expect(applyFixes).not.toHaveBeenCalled();
    expect(completed.rounds).toHaveLength(1);
    expect(completed.rounds[0]).toMatchObject({
      fixplan: "fixplan-r1",
      fixPlan: { acoes: [], fonte: "fallback" },
    });
    expect(completed).toMatchObject({
      status: "completed",
      ok: false,
      autofixStopReason: "no_mechanical_action",
      manualAutofixAvailable: false,
    });
    expect(completed.autofixStopMessage).toContain("Revise o atributo no GIS");
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
