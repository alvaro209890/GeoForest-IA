import { describe, expect, it } from "vitest";
import { CONTA_EM_USO, comSessaoExclusiva, filasAtivas } from "./session-queue";

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("simcar-lotes/session-queue", () => {
  it("serializa chamadas da mesma conta", async () => {
    const eventos: string[] = [];
    const tarefa = (nome: string, ms: number) =>
      comSessaoExclusiva("11122233344", "senha", async () => {
        eventos.push(`inicio-${nome}`);
        await espera(ms);
        eventos.push(`fim-${nome}`);
      });

    await Promise.all([tarefa("a", 30), tarefa("b", 1)]);

    expect(eventos).toEqual(["inicio-a", "fim-a", "inicio-b", "fim-b"]);
  });

  it("contas diferentes rodam em paralelo", async () => {
    const eventos: string[] = [];
    await Promise.all([
      comSessaoExclusiva("11122233344", "senha-a", async () => {
        eventos.push("inicio-a");
        await espera(20);
        eventos.push("fim-a");
      }),
      comSessaoExclusiva("55566677788", "senha-b", async () => {
        eventos.push("inicio-b");
        await espera(1);
        eventos.push("fim-b");
      }),
    ]);

    // "b" termina antes de "a" porque não esperou a vez.
    expect(eventos).toEqual(["inicio-a", "inicio-b", "fim-b", "fim-a"]);
  });

  it("falha do job anterior não trava a fila", async () => {
    const anterior = comSessaoExclusiva("11122233344", "senha", async () => {
      throw new Error("falhou");
    });
    await expect(anterior).rejects.toThrow("falhou");
    await expect(
      comSessaoExclusiva("11122233344", "senha", async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("estoura o timeout com mensagem de conta em uso, sem travar quem vier depois", async () => {
    const longo = comSessaoExclusiva("11122233344", "senha", () => espera(60));

    await expect(
      comSessaoExclusiva("11122233344", "senha", async () => "nunca", 5),
    ).rejects.toThrow(CONTA_EM_USO);

    await longo;
    await expect(
      comSessaoExclusiva("11122233344", "senha", async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("limpa a fila da conta quando ninguém mais está esperando", async () => {
    await comSessaoExclusiva("99988877766", "senha", async () => "ok");
    expect(filasAtivas()).toBe(0);
  });
});
