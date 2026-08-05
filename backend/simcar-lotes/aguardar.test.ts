import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  leituras: [] as Array<{ ocupado: boolean; por?: string; conexoes: number; checadoEm: number }>,
  chamadasMonitor: 0,
  cancelado: false,
  progressos: [] as Array<Record<string, unknown>>,
}));

vi.mock("./monitor", async (importOriginal) => {
  const original = await importOriginal<typeof import("./monitor")>();
  return {
    ...original,
    lerOcupacaoSimcar: async () => {
      const i = Math.min(h.chamadasMonitor, h.leituras.length - 1);
      h.chamadasMonitor += 1;
      return h.leituras[i];
    },
  };
});

vi.mock("../processing-jobs", () => ({
  isCancelRequested: () => h.cancelado,
}));

vi.mock("./sse", () => ({
  progress: (_uid: string, _jobId: string, patch: Record<string, unknown>) => {
    h.progressos.push(patch);
  },
}));

const { aguardarSimcarLivre } = await import("./aguardar");

const livre = { ocupado: false, conexoes: 0, checadoEm: Date.now() };
const emUso = (por?: string) => ({ ocupado: true, por, conexoes: 1, checadoEm: Date.now() });

beforeEach(() => {
  h.leituras = [livre];
  h.chamadasMonitor = 0;
  h.cancelado = false;
  h.progressos = [];
  // Poll curtíssimo: o teste não pode esperar 15s de verdade.
  vi.stubEnv("SIMCAR_MONITOR_POLL_MS", "1000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aguardarSimcarLivre", () => {
  it("SIMCAR livre → retorna na hora, sem mexer no progresso", async () => {
    const r = await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "antes_de_logar" });

    expect(r).toEqual({ interrompido: false, esperou: false });
    expect(h.progressos).toHaveLength(0);
  });

  it("ocupado → ocupado → livre: espera e libera sozinho", async () => {
    h.leituras = [emUso("Bruno"), emUso("Bruno"), livre];

    const r = await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "antes_de_logar" });

    expect(r).toEqual({ interrompido: false, esperou: true });
    expect(h.progressos).toHaveLength(2);
    expect(h.progressos[0]).toMatchObject({ fase: "aguardando_simcar", por: "Bruno" });
    expect(String(h.progressos[0].message)).toContain("em uso por Bruno");
    expect(String(h.progressos[0].message)).toContain("segundo plano");
  });

  it("interrupção de sessão usa a fase e a mensagem próprias", async () => {
    h.leituras = [emUso("Alvaro"), livre];

    await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "sessao_interrompida", percent: 47 });

    expect(h.progressos[0]).toMatchObject({
      fase: "sessao_interrompida",
      por: "Alvaro",
      percent: 47,
    });
    expect(String(h.progressos[0].message)).toMatch(/interrompida por Alvaro/i);
  });

  it("sem `who` no monitor cai no rótulo genérico", async () => {
    h.leituras = [emUso(undefined), livre];

    await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "antes_de_logar" });

    expect(String(h.progressos[0].message)).toContain("outro usuário");
    expect(h.progressos[0].por).toBeNull();
  });

  it("cancelamento durante a espera devolve interrompido", async () => {
    h.leituras = [emUso("Bruno")];
    h.cancelado = true;

    const r = await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "antes_de_logar" });

    expect(r.interrompido).toBe(true);
    expect(h.chamadasMonitor).toBe(0); // nem consulta o monitor se já cancelou
  });

  it("SIMCAR_MONITOR_ENABLED=0 desliga o gate", async () => {
    vi.stubEnv("SIMCAR_MONITOR_ENABLED", "0");
    h.leituras = [emUso("Bruno")];

    const r = await aguardarSimcarLivre({ uid: "u", jobId: "j", motivo: "antes_de_logar" });

    expect(r).toEqual({ interrompido: false, esperou: false });
    expect(h.chamadasMonitor).toBe(0);
  });
});
