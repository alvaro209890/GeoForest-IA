import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chaveNineRouter, collectOpenAiSse, lerVariavelEnv, requestSelecaoFotos } from "./ninerouter";
import type { FotoPronta } from "./types";

describe("chaveNineRouter", () => {
  const anterior = process.env.NINEROUTER_API_KEY;
  afterEach(() => {
    if (anterior === undefined) delete process.env.NINEROUTER_API_KEY;
    else process.env.NINEROUTER_API_KEY = anterior;
  });

  it("lê a chave do .env do Hermes quando o ambiente está vazio", () => {
    delete process.env.NINEROUTER_API_KEY;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-9r-"));
    const arquivo = path.join(dir, ".env");
    fs.writeFileSync(arquivo, "# comentario\nOUTRA=1\nNINEROUTER_API_KEY=\"chave-do-arquivo\"\n", "utf8");
    try {
      expect(lerVariavelEnv('NINEROUTER_API_KEY="abc"', "NINEROUTER_API_KEY")).toBe("abc");
      expect(chaveNineRouter([arquivo])).toBe("chave-do-arquivo");
      expect(chaveNineRouter([path.join(dir, "ausente.env")])).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a variável de ambiente vence o arquivo", () => {
    process.env.NINEROUTER_API_KEY = "chave-do-ambiente";
    expect(chaveNineRouter(["C:\\nao-existe.env"])).toBe("chave-do-ambiente");
  });
});

describe("collectOpenAiSse", () => {
  it("junta o conteúdo e ignora o raciocínio", async () => {
    const encoder = new TextEncoder();
    const linha = (delta: Record<string, string>) =>
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(linha({ reasoning_content: "penso" }));
        controller.enqueue(linha({ content: '{"ok":' }));
        controller.enqueue(linha({ content: "true}" }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fases: string[] = [];
    const collected = await collectOpenAiSse(stream, (fase) => fases.push(fase));
    expect(collected.reasoning).toBe("penso");
    expect(collected.content).toBe('{"ok":true}');
    // Avisa cada fase uma vez só, na ordem em que acontece.
    expect(fases).toEqual(["pensando", "escrevendo"]);
  });
});

describe("requestSelecaoFotos", () => {
  it("pede ocg/deepseek-v4.1-flash com raciocínio max e a imagem", async () => {
    let body: any = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body || "{}"));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: '{"resumo":"ok"}' } }] })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const foto: FotoPronta = {
      id: "f1",
      nome: "porteira.jpg",
      width: 40,
      height: 80,
      orientation: "portrait",
      jpeg: Buffer.from([1, 2, 3]),
    };
    const result = await requestSelecaoFotos({
      projeto: "Fazenda",
      objetivo: "Mostrar o acesso.",
      fotos: [foto],
      apiKey: "chave-teste",
      baseUrl: "http://9router.local/v1",
      fetchImpl,
    });

    expect(result.model).toBe("ocg/deepseek-v4.1-flash");
    expect(result.reasoning).toBe("max");
    expect(body.model).toBe("ocg/deepseek-v4.1-flash");
    expect(body.reasoning_effort).toBe("max");
    expect(body.stream).toBe(true);
    const partes = body.messages[1].content as Array<Record<string, any>>;
    expect(partes.some((parte) => String(parte.text || "").includes("id=f1"))).toBe(true);
    expect(partes.some((parte) => parte.type === "image_url")).toBe(true);
  });
});
