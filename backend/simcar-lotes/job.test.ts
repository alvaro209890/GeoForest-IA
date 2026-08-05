/**
 * Regressão do job de lotes.
 *
 * Bug de produção (job 4e7fdb05, 2026-08-05): o job pegava UM token antes do laço
 * e passava essa string fixa para o `resolverCar`. Como os downloads renovam a
 * sessão em 401 (`withSimcarAuthRetryFor`), o token capturado envelhecia e o
 * `Requerimento/ListarRasc` dos lotes seguintes voltava
 * "Usuário não autenticado ou sessão expirada" — 1 lote no ZIP de 4 recibos.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class SimcarHttpErrorFake extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "SimcarHttpError";
      this.status = status;
    }
  }
  return {
    SimcarHttpErrorFake,
    estado: {
      logins: 0,
      /** Último token emitido — qualquer outro é sessão expirada. */
      tokenValido: "",
      /** Lotes cujo download derruba a sessão (SEMA aceita uma sessão por conta). */
      derrubarSessaoApos: new Set<string>(),
      tokensNoResolver: [] as string[],
    },
  };
});

/** Client SIMCAR falso com a MESMA semântica do real (ver client-session.test.ts). */
vi.mock("../simcar-oraculo/client", () => {
  const sessoes = new Map<string, string>();
  const simcarCredentialKey = (cpf: string, senha: string) =>
    `${String(cpf || "").replace(/\D/g, "")}:${String(senha || "")}`;

  async function getSimcarTokenFor(cpf: string, senha: string): Promise<string> {
    const chave = simcarCredentialKey(cpf, senha);
    const cached = sessoes.get(chave);
    if (cached) return cached;
    h.estado.logins += 1;
    const token = `TECNICO-${h.estado.logins}`;
    h.estado.tokenValido = token;
    sessoes.set(chave, token);
    return token;
  }

  function clearSimcarTokenCache(chave?: string): void {
    if (chave === undefined) sessoes.clear();
    else sessoes.delete(chave);
  }

  async function withSimcarAuthRetryFor<T>(
    cpf: string,
    senha: string,
    operation: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await getSimcarTokenFor(cpf, senha);
    try {
      return await operation(token);
    } catch (error) {
      if (!(error instanceof h.SimcarHttpErrorFake) || error.status !== 401) throw error;
      clearSimcarTokenCache(simcarCredentialKey(cpf, senha));
      return operation(await getSimcarTokenFor(cpf, senha));
    }
  }

  return {
    SimcarHttpError: h.SimcarHttpErrorFake,
    simcarCredentialKey,
    getSimcarTokenFor,
    clearSimcarTokenCache,
    withSimcarAuthRetryFor,
  };
});

const RECIBOS = ["lote1.pdf", "lote2.pdf", "lote3.pdf"];

vi.mock("./recibo-parse", () => ({
  extrairPdfsDoEnvio: () => RECIBOS.map((name) => ({ name, data: Buffer.from(name) })),
  parseReciboPdf: async (_buffer: Buffer, filename: string) => ({
    filename,
    carEstadual: `MT${filename.replace(/\D/g, "")}/2024`,
    reciboFederal: null,
    propriedade: `FAZENDA ${filename.replace(/\D/g, "")}`,
    municipio: "Querência",
    proprietario: null,
    erro: null,
  }),
}));

vi.mock("./resolver", () => ({
  resolverCar: async (args: { carEstadual: string | null; token: string }) => {
    h.estado.tokensNoResolver.push(args.token);
    if (args.token !== h.estado.tokenValido) {
      throw new h.SimcarHttpErrorFake(
        401,
        'POST Requerimento/ListarRasc 401: "Usuário não autenticado ou sessão expirada."',
      );
    }
    return {
      requerimentoId: 1000 + Number(String(args.carEstadual).replace(/\D/g, "").slice(0, 1) || 0),
      numeroCompleto: String(args.carEstadual),
      situacao: "[ATIVO]",
      propriedade: "FAZENDA",
      municipio: "Querência",
    };
  },
}));

vi.mock("./downloader", () => ({
  baixarArtefatosDoLote: async (args: { carEstadual: string }) => {
    if (h.estado.derrubarSessaoApos.has(args.carEstadual)) {
      // A SEMA derrubou a sessão: o token que estava valendo deixa de valer.
      h.estado.tokenValido = "";
    }
    return {
      arquivos: [{ nome: "Arquivo Enviado.zip", buffer: Buffer.from("PK") }],
      faltantes: [],
    };
  },
}));

let storageRoot = "";
let storage: typeof import("../local-storage");
let runLotesJob: typeof import("./job").runLotesJob;
let clearSimcarTokenCache: (chave?: string) => void;

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-lotes-job-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  storage = await import("../local-storage");
  ({ runLotesJob } = await import("./job"));
  ({ clearSimcarTokenCache } = await import("../simcar-oraculo/client"));
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

beforeEach(() => {
  clearSimcarTokenCache();
  h.estado.logins = 0;
  h.estado.tokenValido = "";
  h.estado.tokensNoResolver = [];
  h.estado.derrubarSessaoApos = new Set();
});

function doc(jobId: string): Record<string, any> {
  return (storage.readDocBySegments(["users", "uid-job", "simcar_lotes_jobs", jobId]) ||
    {}) as Record<string, any>;
}

async function rodar(jobId: string): Promise<Record<string, any>> {
  await runLotesJob({
    uid: "uid-job",
    jobId,
    zipBuffer: Buffer.from("PK-envio"),
    filename: "recibos.zip",
    cpf: "111.222.333-44",
    senha: "senha-do-usuario",
  });
  return doc(jobId);
}

describe("runLotesJob — sessão da SEMA entre lotes", () => {
  it("conclui os 3 lotes mesmo quando a sessão cai depois do primeiro", async () => {
    // Reproduz o job 4e7fdb05: o download do lote 1 rotaciona a sessão.
    h.estado.derrubarSessaoApos.add("MT1/2024");

    const final = await rodar("job-401");

    expect(final.status).toBe("completed");
    expect(final.lotesConcluidos).toBe(3);
    expect(final.relatorio.map((l: any) => l.erro)).toEqual([null, null, null]);
    // Houve relogin: o token do resolver do lote 2 não é o mesmo do lote 1.
    expect(h.estado.logins).toBeGreaterThan(1);
    expect(new Set(h.estado.tokensNoResolver).size).toBeGreaterThan(1);
  });

  it("caminho feliz: um login só e nenhum erro", async () => {
    const final = await rodar("job-ok");

    expect(final.status).toBe("completed");
    expect(final.lotesConcluidos).toBe(3);
    expect(h.estado.logins).toBe(1);
  });
});
