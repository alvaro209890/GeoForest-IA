import type { ProcessarMode } from "./types";

const MODES = new Set<ProcessarMode>(["LOCAL", "ORACULO", "HYBRID"]);

export type SimcarOraculoConfig = {
  mode: ProcessarMode;
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
};

/**
 * Default seguro: LOCAL (CI e máquinas sem credencial).
 * No PC servidor com SIMCAR_CPF/SENHA, defina PROCESSAR_MODE=ORACULO.
 */
export function getSimcarOraculoConfig(): SimcarOraculoConfig {
  const cpf = String(process.env.SIMCAR_CPF || "").replace(/\D/g, "");
  const senha = String(process.env.SIMCAR_SENHA || "");
  const credentialsConfigured = Boolean(cpf && senha);
  const raw = String(process.env.PROCESSAR_MODE || "").trim().toUpperCase();
  let mode: ProcessarMode = "LOCAL";
  if (MODES.has(raw as ProcessarMode)) {
    mode = raw as ProcessarMode;
  } else if (credentialsConfigured && process.env.PROCESSAR_MODE === undefined) {
    // sem PROCESSAR_MODE explícito: se tem credencial, ORACULO; senão LOCAL
    mode = "LOCAL";
  }
  // ORACULO/HYBRID sem credencial → força LOCAL com flag
  if ((mode === "ORACULO" || mode === "HYBRID") && !credentialsConfigured) {
    mode = "LOCAL";
  }
  return {
    mode,
    cpf,
    senha,
    testCarId: String(process.env.SIMCAR_TEST_CAR_ID || "270069").trim(),
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
