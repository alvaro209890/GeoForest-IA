/**
 * Fila serial por conta SIMCAR.
 *
 * A SEMA só permite UMA sessão por conta: se o oráculo e a aba "Lotes" usarem a
 * mesma credencial ao mesmo tempo, um login derruba o outro no meio do download.
 * Aqui as chamadas da mesma conta esperam a vez; contas diferentes correm em
 * paralelo sem se bloquear.
 */
import { simcarCredentialKey } from "../simcar-oraculo/client";

export const CONTA_EM_USO =
  "A conta SIMCAR está em uso por outro processo. Tente novamente em alguns minutos.";

const filas = new Map<string, Promise<void>>();

function esperarComTimeout(anterior: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return anterior;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(CONTA_EM_USO)), timeoutMs);
    const concluir = () => {
      clearTimeout(timer);
      resolve();
    };
    // Falha do job anterior não contamina o próximo da fila: só libera a vez.
    anterior.then(concluir, concluir);
  });
}

/**
 * Roda `fn` com acesso exclusivo à sessão da conta `cpf/senha`.
 * Se a vez não chegar em `timeoutMs`, rejeita com `CONTA_EM_USO` sem travar a fila.
 */
export async function comSessaoExclusiva<T>(
  cpf: string,
  senha: string,
  fn: () => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const chave = simcarCredentialKey(cpf, senha);
  const anterior = filas.get(chave) ?? Promise.resolve();

  let liberar!: () => void;
  const minhaVez = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const proxima = anterior.then(
    () => minhaVez,
    () => minhaVez,
  );
  filas.set(chave, proxima);

  const limpar = () => {
    liberar();
    // Só remove a entrada se ninguém entrou na fila depois de nós.
    if (filas.get(chave) === proxima) filas.delete(chave);
  };

  try {
    await esperarComTimeout(anterior, timeoutMs);
  } catch (error) {
    limpar();
    throw error;
  }

  try {
    return await fn();
  } finally {
    limpar();
  }
}

/** Quantas contas têm fila ativa (diagnóstico/testes). */
export function filasAtivas(): number {
  return filas.size;
}
