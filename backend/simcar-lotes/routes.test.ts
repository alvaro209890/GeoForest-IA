import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { extractZipEntries } from "../geo-utils";

type RouteHandler = (req: Record<string, any>, res: Record<string, any>) => unknown;

let storageRoot = "";
let post = new Map<string, RouteHandler>();
let get = new Map<string, RouteHandler>();
let storage: typeof import("../local-storage");
let clearSimcarTokenCache: (chave?: string) => void;

const ZIP_SEMA = Buffer.from("PK\u0003\u0004arquivo-do-simcar", "latin1");
const PDF_RECIBO = Buffer.from("%PDF-1.5 recibo publico", "latin1");

/** PDF sintético com o texto do recibo — pdf-parse é substituído por mock. */
const PDF_ENVIADO = Buffer.from("%PDF-1.4 recibo enviado pelo usuario", "latin1");
const TEXTO_RECIBO = [
  "Recibo de Inscrição CAR – MT",
  "Nº CAR EstadualSituação EstadualTipo",
  "MT10005/2019AtivoDeclarado",
  "Nº Recibo Federal",
  "MT-5107065-AEC311BDEA79437099F3D97F9D599345",
  "PropriedadeUFMunicípio",
  "LOTE RURAL 81MTQuerência",
].join("\n");

vi.mock("pdf-parse", () => ({
  default: async () => ({ text: TEXTO_RECIBO }),
}));

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-lotes-routes-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  const routes = await import("./routes");
  storage = await import("../local-storage");
  ({ clearSimcarTokenCache } = await import("../simcar-oraculo/client"));
  post = new Map();
  get = new Map();
  routes.registerSimcarLotesRoutes({
    post(pathname: string, handler: RouteHandler) {
      post.set(pathname, handler);
    },
    get(pathname: string, handler: RouteHandler) {
      get.set(pathname, handler);
    },
    delete() {},
  } as any);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

afterEach(() => {
  clearSimcarTokenCache();
  vi.unstubAllGlobals();
});

function troca(body: Record<string, unknown> = {}, authUid = "uid-lotes") {
  const req: Record<string, any> = { authUid, body, params: {} };
  const res: Record<string, any> = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.payload = payload;
      return res;
    },
  };
  return { req, res };
}

/** SEMA falsa: login, ListarRasc, downloads técnicos e API pública. */
function stubSema(options: { processado?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      // Monitor SIMCAR livre (ninguém logado no navegador).
      if (url.includes("monitor-car-default-rtdb")) {
        return new Response("null", { status: 200 });
      }
      if (url.includes("Autenticacao/Autenticar")) {
        return new Response(JSON.stringify("TECNICO sessao"), { status: 200 });
      }
      if (url.includes("Requerimento/ListarRasc")) {
        return new Response(
          JSON.stringify({
            Itens: [
              {
                // Id TECNICO (ListarRasc) — diferente do Id publico do recibo.
                Id: 10005,
                NumeroCompleto: "MT10005/2019",
                Situacao: "[EM_ANALISE]",
                PropriedadeNome: "LOTE RURAL 81",
                MunicipioTexto: "Querência",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("DownloadArquivoEnviado")) {
        return new Response(new Uint8Array(ZIP_SEMA), { status: 200 });
      }
      if (url.includes("DownloadArquivoProcessado")) {
        const status = options.processado ?? 200;
        return new Response(status === 200 ? new Uint8Array(ZIP_SEMA) : "sem processamento", { status });
      }
      if (url.includes("Publico/ListarRequerimento")) {
        return new Response(JSON.stringify({ Itens: [{ Id: 470498, NumeroCompleto: "MT10005/2019" }] }), { status: 200 });
      }
      if (url.includes("Publico/DownloadReciboCar")) {
        return new Response(new Uint8Array(PDF_RECIBO), { status: 200 });
      }
      return new Response("não esperado", { status: 500 });
    }),
  );
}

async function aguardarJob(uid: string, jobId: string, timeoutMs = 5000): Promise<Record<string, any>> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const doc = storage.readDocBySegments(["users", uid, "simcar_lotes_jobs", jobId]);
    const status = String(doc?.status || "");
    if (["completed", "failed", "cancelled"].includes(status)) return doc as Record<string, any>;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("job não concluiu no tempo esperado");
}

describe("/api/simcar-lotes/monitor-status", () => {
  it("exige autenticação", async () => {
    const { req, res } = troca({}, "");
    await get.get("/api/simcar-lotes/monitor-status")!(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("devolve a ocupação do monitor e reaproveita o cache de 5s", async () => {
    const { limparCacheMonitor } = await import("./monitor");
    limparCacheMonitor();
    const fetchMock = vi.fn(
      async (input: any) =>
        new Response(
          String(input).includes("clients.json")
            ? JSON.stringify({ uidA: { c1: { who: "Bruno", lastSeen: Date.now() - 2000 } } })
            : "null",
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const primeira = troca();
    await get.get("/api/simcar-lotes/monitor-status")!(primeira.req, primeira.res);
    const segunda = troca();
    await get.get("/api/simcar-lotes/monitor-status")!(segunda.req, segunda.res);

    expect(primeira.res.payload).toMatchObject({
      ok: true,
      monitor: { ocupado: true, por: "Bruno", conexoes: 1 },
    });
    expect(segunda.res.payload.monitor.ocupado).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 2ª resposta veio do cache
    limparCacheMonitor();
  });
});

describe("/api/simcar-lotes/parse-recibos", () => {
  it("lê o recibo e devolve o lote detectado sem tocar na SEMA", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { req, res } = troca({
      zipBase64: PDF_ENVIADO.toString("base64"),
      filename: "CAR - Recibo de Inscricao.pdf",
    });

    await post.get("/api/simcar-lotes/parse-recibos")!(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.lotes).toHaveLength(1);
    expect(res.payload.lotes[0]).toMatchObject({
      carEstadual: "MT10005/2019",
      propriedade: "LOTE RURAL 81",
      municipio: "Querência",
      erro: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exige autenticação", async () => {
    const { req, res } = troca({ zipBase64: PDF_ENVIADO.toString("base64") }, "");
    await post.get("/api/simcar-lotes/parse-recibos")!(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("recusa envio vazio", async () => {
    const { req, res } = troca({ zipBase64: "" });
    await post.get("/api/simcar-lotes/parse-recibos")!(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("/api/simcar-lotes/process", () => {
  it("exige CPF e senha do SIMCAR", async () => {
    const { req, res } = troca({ zipBase64: PDF_ENVIADO.toString("base64"), cpf: "123", senha: "" });
    await post.get("/api/simcar-lotes/process")!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/CPF e a senha/i);
  });

  it("baixa os 3 artefatos e monta o ZIP com a pasta do lote", async () => {
    stubSema();
    const { req, res } = troca({
      zipBase64: PDF_ENVIADO.toString("base64"),
      filename: "CAR - Recibo de Inscricao.pdf",
      cpf: "111.222.333-44",
      senha: "senha-do-usuario",
    });

    await post.get("/api/simcar-lotes/process")!(req, res);
    expect(res.statusCode).toBe(202);
    const jobId = res.payload.jobId as string;

    const doc = await aguardarJob("uid-lotes", jobId);
    expect(doc.status).toBe("completed");
    expect(doc.relatorio[0]).toMatchObject({
      car: "MT10005/2019",
      propriedade: "LOTE RURAL 81",
      pasta: "MT10005-2019 - LOTE_RURAL_81",
      faltantes: [],
      erro: null,
    });

    const zip = fs.readFileSync(storage.getAbsoluteStoragePath(String(doc.outputRelativePath)));
    const nomes = extractZipEntries(zip).map((e) => e.name).sort();
    expect(nomes).toEqual([
      "MT10005-2019 - LOTE_RURAL_81/Arquivo Enviado.zip",
      "MT10005-2019 - LOTE_RURAL_81/Arquivo Processado.zip",
      "MT10005-2019 - LOTE_RURAL_81/Recibo de Inscricao.pdf",
      "RELATORIO.txt",
    ]);
  });

  it("CAR sem Arquivo Processado (400) conclui com faltante, não com erro", async () => {
    stubSema({ processado: 400 });
    const { req, res } = troca({
      zipBase64: PDF_ENVIADO.toString("base64"),
      filename: "recibo.pdf",
      cpf: "11122233344",
      senha: "senha",
    });

    await post.get("/api/simcar-lotes/process")!(req, res);
    const doc = await aguardarJob("uid-lotes", res.payload.jobId);

    expect(doc.status).toBe("completed");
    expect(doc.relatorio[0].faltantes).toEqual(["Arquivo Processado.zip"]);
    expect(doc.relatorio[0].erro).toBeNull();
  });

  it("expõe o ZIP em download/:jobId", async () => {
    stubSema();
    const { req, res } = troca({
      zipBase64: PDF_ENVIADO.toString("base64"),
      filename: "recibo.pdf",
      cpf: "11122233344",
      senha: "senha",
    });
    await post.get("/api/simcar-lotes/process")!(req, res);
    const jobId = res.payload.jobId as string;
    await aguardarJob("uid-lotes", jobId);

    const baixado: string[] = [];
    const reqDl: Record<string, any> = { authUid: "uid-lotes", params: { jobId } };
    const resDl: Record<string, any> = {
      statusCode: 200,
      status(code: number) {
        resDl.statusCode = code;
        return resDl;
      },
      json() {
        return resDl;
      },
      download(absolute: string, filename: string) {
        baixado.push(absolute, filename);
      },
    };

    await get.get("/api/simcar-lotes/download/:jobId")!(reqDl, resDl);

    expect(fs.existsSync(baixado[0])).toBe(true);
    expect(baixado[1]).toMatch(/^lotes_simcar_\d{8}-\d{6}\.zip$/);
  });

  it("404 no download de job inexistente", async () => {
    const reqDl: Record<string, any> = { authUid: "uid-lotes", params: { jobId: "nao-existe" } };
    const resDl: Record<string, any> = {
      statusCode: 200,
      payload: null,
      status(code: number) {
        resDl.statusCode = code;
        return resDl;
      },
      json(payload: unknown) {
        resDl.payload = payload;
        return resDl;
      },
      download() {},
    };
    await get.get("/api/simcar-lotes/download/:jobId")!(reqDl, resDl);
    expect(resDl.statusCode).toBe(404);
  });
});
