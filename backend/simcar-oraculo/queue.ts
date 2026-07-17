/**
 * Fila serial global — o SIMCAR técnico permite 1 sessão por conta.
 */
let chain: Promise<unknown> = Promise.resolve();
let pending = 0;

export function getSimcarQueueLength(): number {
  return pending;
}

export function enqueueSimcar<T>(fn: () => Promise<T>): Promise<T> {
  pending += 1;
  const run = chain.then(
    () => fn(),
    () => fn(),
  );
  chain = run.then(
    () => {
      pending = Math.max(0, pending - 1);
    },
    () => {
      pending = Math.max(0, pending - 1);
    },
  );
  return run;
}

/** Só para testes. */
export function __resetSimcarQueueForTests(): void {
  chain = Promise.resolve();
  pending = 0;
}
