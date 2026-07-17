export type SimcarOraculoConfig = {
  cpf: string;
  senha: string;
  testCarId: string;
  root: string;
  pollMs: number;
  importTimeoutMs: number;
  processTimeoutMs: number;
  baseRefTimeoutMs: number;
  abrangenciaMarginM: number;
  credentialsConfigured: boolean;
  deepseekConfigured: boolean;
};

/**
 * O produto é 100% oráculo (D2 — validação local removida). Basta configurar
 * SIMCAR_CPF/SIMCAR_SENHA no backend do PC servidor; sem credencial as rotas de
 * mutação respondem erro explícito (não há mais modo LOCAL/HYBRID).
 */
export function getSimcarOraculoConfig(): SimcarOraculoConfig {
  const cpf = String(process.env.SIMCAR_CPF || "").replace(/\D/g, "");
  const senha = String(process.env.SIMCAR_SENHA || "");
  const credentialsConfigured = Boolean(cpf && senha);
  const deepseekConfigured = Boolean(
    String(process.env.DEEPSEEK_API_KEY || "").trim(),
  );
  return {
    cpf,
    senha,
    // Projeto "Teste" (Id 271442), criado 2025-04-04 — CAR operacional do oráculo no PC servidor.
    // Override via SIMCAR_TEST_CAR_ID no env. (Histórico: 270069 = Santa clara, usado nas baterias D1.)
    testCarId: String(process.env.SIMCAR_TEST_CAR_ID || "271442").trim(),
    root:
      process.env.SIMCAR_ROOT ||
      "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api",
    pollMs: Number(process.env.SIMCAR_POLL_MS || 5000) || 5000,
    importTimeoutMs: Number(process.env.SIMCAR_IMPORT_TIMEOUT_MS || 15 * 60 * 1000) || 15 * 60 * 1000,
    processTimeoutMs: Number(process.env.SIMCAR_PROCESS_TIMEOUT_MS || 30 * 60 * 1000) || 30 * 60 * 1000,
    baseRefTimeoutMs:
      Number(process.env.SIMCAR_BASEREF_TIMEOUT_MS || 20 * 60 * 1000) || 20 * 60 * 1000,
    abrangenciaMarginM: Number(process.env.SIMCAR_ABRANGENCIA_MARGIN_M || 500) || 500,
    credentialsConfigured,
    deepseekConfigured,
  };
}

export function assertSimcarCredentials(): SimcarOraculoConfig {
  const c = getSimcarOraculoConfig();
  if (!c.credentialsConfigured) {
    throw new Error("SIMCAR_CPF/SIMCAR_SENHA não configurados no backend do PC servidor.");
  }
  return c;
}

/** Só permite mutações no projeto-teste configurado. */
export function assertTestCarId(carId: string | number): string {
  const c = getSimcarOraculoConfig();
  const id = String(carId || "").trim();
  if (!id || id !== c.testCarId) {
    throw new Error(
      `Oráculo SIMCAR só opera no projeto-teste (${c.testCarId}); recebido: ${id || "(vazio)"}`,
    );
  }
  return id;
}
