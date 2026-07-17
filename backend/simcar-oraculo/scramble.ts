import { scramble as scrambleImpl } from "./scramble-impl.js";

/** Embaralha o corpo do login SIMCAR (mesmo algoritmo do tecnico.app). */
export function scramble(input: string): string {
  return scrambleImpl(String(input || ""));
}
