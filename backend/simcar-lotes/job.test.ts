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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
      /** CAR → quantos 401 o download ainda vai devolver antes de funcionar. */
      falhas401: new Map<string, number>(),
      tokensNoResolver: [] as string[],
      /** Fila de respostas do monitor; a última se repete. */
      ocupacoes: [] as Array<{ ocupado: boolean; por?: string; conexoes: number; checadoEm: number }>,
      leiturasMonitor: 0,
      /** Ordem dos eventos, para provar que o login só veio depois da espera. */
      eventos: [] as string[],
      cancelado: false,
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
    h.estado.eventos.push("login");
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

/** Monitor SIMCAR falso (o real é read-only sobre o RTDB do monitor-car). */
vi.mock("./monitor", async (importOriginal) => {
  const original = await importOriginal<typeof import("./monitor")>();
  return {
    ...original,
    lerOcupacaoSimcar: async () => {
      const fila = h.estado.ocupacoes;
      const atual = fila[Math.min(h.estado.leiturasMonitor, fila.length - 1)];
      h.estado.leiturasMonitor += 1;
      if (atual?.ocupado) h.estado.eventos.push("monitor:ocupado");
      return atual || { ocupado: false, conexoes: 0, checadoEm: Date.now() };
    },
  };
});

vi.mock("../processing-jobs", () => ({
  isCancelRequested: () => h.estado.cancelado,
  finishJob: () => {},
}));

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
    const falhas = h.estado.falhas401.get(args.carEstadual) || 0;
    if (falhas > 0) {
      // Alguém logou no SIMCAR e a SEMA derrubou a nossa sessão no meio do lote.
      h.estado.falhas401.set(args.carEstadual, falhas - 1);
      h.estado.tokenValido = "";
      throw new h.SimcarHttpErrorFake(
        401,
        'DOWNLOAD Requerimento/DownloadArquivoEnviado 401: "sessão expirada"',
      );
    }
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

const LIVRE = { ocupado: false, conexoes: 0, checadoEm: Date.now() };
const EM_USO = (por: string) => ({ ocupado: true, por, conexoes: 1, checadoEm: Date.now() });

beforeEach(() => {
  clearSimcarTokenCache();
  h.estado.logins = 0;
  h.estado.tokenValido = "";
  h.estado.tokensNoResolver = [];
  h.estado.derrubarSessaoApos = new Set();
  h.estado.falhas401 = new Map();
  h.estado.ocupacoes = [LIVRE];
  h.estado.leiturasMonitor = 0;
  h.estado.eventos = [];
  h.estado.cancelado = false;
  // A espera real é de 15s; nos testes, 1s (mínimo aceito).
  vi.stubEnv("SIMCAR_MONITOR_POLL_MS", "1000");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("R1 — não logar enquanto o SIMCAR estiver em uso", () => {
  it("espera o monitor liberar antes do primeiro login", async () => {
    // 1ª leitura (gate fora da fila) EM USO; depois liberou.
    h.estado.ocupacoes = [EM_USO("Bruno"), LIVRE];

    const final = await rodar("job-espera");

    expect(final.status).toBe("completed");
    // O login só aconteceu DEPOIS de o monitor acusar ocupado.
    expect(h.estado.eventos[0]).toBe("monitor:ocupado");
    expect(h.estado.eventos.indexOf("login")).toBeGreaterThan(0);
  });

  it("cancelar durante a espera não loga no SIMCAR", async () => {
    h.estado.ocupacoes = [EM_USO("Bruno")];
    h.estado.cancelado = true;

    const final = await rodar("job-cancelado-na-espera");

    expect(final.status).toBe("cancelled");
    expect(h.estado.logins).toBe(0);
  });
});

describe("R3 — sessão derrubada no meio do lote", () => {
  it("espera o SIMCAR liberar e refaz o MESMO lote, preservando os anteriores", async () => {
    // Leituras do monitor, em ordem: gate fora da fila, gate na fila,
    // diagnóstico do erro, espera (ocupado) e espera (liberou).
    h.estado.ocupacoes = [LIVRE, LIVRE, EM_USO("Bruno"), EM_USO("Bruno"), LIVRE];
    // Lote 2: dois 401 (o 1º é consumido pelo retry interno do client).
    h.estado.falhas401.set("MT2/2024", 2);

    const final = await rodar("job-interrompido");

    expect(final.status).toBe("completed");
    expect(final.lotesConcluidos).toBe(3);
    expect(final.relatorio.map((l: any) => l.erro)).toEqual([null, null, null]);
    expect(final.relatorio[1]).toMatchObject({ car: "MT2/2024", baixados: ["Arquivo Enviado.zip"] });
    // O lote 1 continuou no ZIP e o 2 não foi duplicado.
    expect(final.relatorio).toHaveLength(3);
  });

  it("SIMCAR_MONITOR_MAX_RETRY limita as retomadas e o lote vira erro", async () => {
    vi.stubEnv("SIMCAR_MONITOR_MAX_RETRY", "1");
    h.estado.ocupacoes = [LIVRE, LIVRE, EM_USO("Bruno"), EM_USO("Bruno"), LIVRE];
    h.estado.falhas401.set("MT2/2024", 99); // nunca volta

    const final = await rodar("job-teto");

    expect(final.status).toBe("completed");
    expect(final.relatorio[1].erro).toMatch(/401/);
    // Lotes 1 e 3 seguiram normalmente.
    expect(final.relatorio[0].erro).toBeNull();
    expect(final.relatorio[2].erro).toBeNull();
    expect(final.lotesConcluidos).toBe(2);
  });

  it("401 com o monitor LIVRE não vira loop infinito", async () => {
    h.estado.ocupacoes = [LIVRE];
    h.estado.falhas401.set("MT2/2024", 99);

    const final = await rodar("job-401-sem-monitor");

    expect(final.status).toBe("completed");
    expect(final.relatorio[1].erro).toMatch(/401/);
    expect(final.lotesConcluidos).toBe(2);
  });
});
