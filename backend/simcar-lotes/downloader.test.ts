import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimcarHttpError, clearSimcarTokenCache } from "../simcar-oraculo/client";
import { NOME_RECIBO, baixarArtefatosDoLote, baixarReciboPublico } from "./downloader";

const ZIP = Buffer.from("PK\u0003\u0004conteudo-do-shapefile", "latin1");
const PDF = Buffer.from("%PDF-1.5 recibo", "latin1");

afterEach(() => {
  clearSimcarTokenCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Stub do fetch cobrindo login, downloads técnicos e a API pública.
 * `tecnicos` mapeia trecho do path → resposta.
 */
function stubSema(options: {
  tecnicos?: Record<string, { status: number; body?: Buffer }>;
  publicoLista?: unknown;
  publicoRecibo?: { status: number; body?: Buffer };
}): { chamadas: string[] } {
  const chamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      chamadas.push(url);
      if (url.includes("Autenticacao/Autenticar")) {
        return new Response(JSON.stringify("TECNICO sessao"), { status: 200 });
      }
      if (url.includes("Publico/ListarRequerimento")) {
        return new Response(JSON.stringify(options.publicoLista ?? { Itens: [{ Id: 470498, NumeroCompleto: "MT10005/2019" }] }), { status: 200 });
      }
      if (url.includes("Publico/DownloadReciboCar")) {
        const r = options.publicoRecibo ?? { status: 200, body: PDF };
        return new Response(r.body ? new Uint8Array(r.body) : "erro", { status: r.status });
      }
      for (const [trecho, resposta] of Object.entries(options.tecnicos || {})) {
        if (!url.includes(trecho)) continue;
        return new Response(resposta.body ? new Uint8Array(resposta.body) : "erro", {
          status: resposta.status,
        });
      }
      return new Response("não esperado", { status: 500 });
    }),
  );
  return { chamadas };
}

describe("simcar-lotes/downloader", () => {
  it("baixa os 3 artefatos do lote", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: ZIP },
        DownloadArquivoProcessado: { status: 200, body: ZIP },
      },
    });

    const resultado = await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
    });

    expect(resultado.arquivos.map((a) => a.nome)).toEqual([
      "Arquivo Enviado.zip",
      "Arquivo Processado.zip",
      NOME_RECIBO,
    ]);
    expect(resultado.faltantes).toEqual([]);
  });

  it("400 no Arquivo Processado vira faltante, sem falhar o lote", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: ZIP },
        DownloadArquivoProcessado: { status: 400 },
      },
    });

    const resultado = await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
    });

    expect(resultado.arquivos.map((a) => a.nome)).toEqual(["Arquivo Enviado.zip", NOME_RECIBO]);
    expect(resultado.faltantes).toEqual(["Arquivo Processado.zip"]);
  });

  it("conteúdo que não é ZIP é recusado e vira faltante", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: Buffer.from("<html>erro</html>") },
        DownloadArquivoProcessado: { status: 400 },
      },
    });

    const resultado = await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
    });

    expect(resultado.arquivos.map((a) => a.nome)).toEqual([NOME_RECIBO]);
    expect(resultado.faltantes[0]).toContain("Arquivo Enviado.zip");
  });

  it("usa o recibo enviado quando o download público falha", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: ZIP },
        DownloadArquivoProcessado: { status: 400 },
      },
      publicoRecibo: { status: 502 },
    });

    const reciboEnviado = Buffer.from("%PDF-1.4 recibo do usuario", "latin1");
    const resultado = await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
      reciboEnviado,
    });

    const recibo = resultado.arquivos.find((a) => a.nome === NOME_RECIBO);
    expect(recibo?.buffer.equals(reciboEnviado)).toBe(true);
    expect(resultado.faltantes).not.toContain(NOME_RECIBO);
  });

  it("marca o recibo como faltante quando não há público nem enviado", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: ZIP },
        DownloadArquivoProcessado: { status: 200, body: ZIP },
      },
      publicoRecibo: { status: 404 },
    });

    const resultado = await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
    });

    expect(resultado.faltantes).toEqual([NOME_RECIBO]);
  });

  it("reporta progresso por artefato", async () => {
    stubSema({
      tecnicos: {
        DownloadArquivoEnviado: { status: 200, body: ZIP },
        DownloadArquivoProcessado: { status: 200, body: ZIP },
      },
    });

    const eventos: Array<{ nome: string; indice: number; total: number }> = [];
    await baixarArtefatosDoLote({
      cpf: "11122233344",
      senha: "senha",
      requerimentoId: 470498,
      carEstadual: "MT10005/2019",
      onArtefato: (info) => eventos.push(info),
    });

    expect(eventos).toEqual([
      { nome: "Arquivo Enviado.zip", indice: 1, total: 3 },
      { nome: "Arquivo Processado.zip", indice: 2, total: 3 },
      { nome: NOME_RECIBO, indice: 3, total: 3 },
    ]);
  });

  it("propaga erro que não é 400/404 (ex.: 500 da SEMA)", async () => {
    stubSema({ tecnicos: { DownloadArquivoEnviado: { status: 500 } } });

    await expect(
      baixarArtefatosDoLote({
        cpf: "11122233344",
        senha: "senha",
        requerimentoId: 470498,
        carEstadual: "MT10005/2019",
      }),
    ).rejects.toBeInstanceOf(SimcarHttpError);
  });
});

describe("baixarReciboPublico", () => {
  beforeEach(() => {
    clearSimcarTokenCache();
  });

  it("devolve null quando o PDF vem corrompido", async () => {
    stubSema({ publicoRecibo: { status: 200, body: Buffer.from("<html>nao é pdf</html>") } });
    expect(await baixarReciboPublico("MT10005/2019")).toBeNull();
  });

  it("devolve null quando o CAR não existe na base pública", async () => {
    stubSema({ publicoLista: { Itens: [] } });
    expect(await baixarReciboPublico("MT99999/2099")).toBeNull();
  });
});
