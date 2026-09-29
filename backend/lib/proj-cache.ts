/**
 * Cache de conversores proj4 por par de CRS.
 *
 * `proj4(from, to, ponto)` com `from`/`to` em string refaz, A CADA PONTO, o
 * parse da definição e um `new Projection` para cada lado. No processar-projeto
 * isso era ~39% do tempo de `runImportPhase` no fixture real (perfil de CPU,
 * 29/09/2026). O conversor devolvido por `proj4(from, to)` guarda as duas
 * `Projection` já montadas; `forward(ponto)` chama exatamente a mesma
 * transformação que a forma de 3 argumentos — o resultado é bit a bit igual.
 *
 * A chave é o par de strings. As definições usadas aqui são constantes
 * (`proj-defs.ts` e strings `+proj=utm ...` geradas por zona), então o cache
 * não fica velho. Se algum código passar a REDEFINIR um nome com
 * `proj4.defs(nome, outraDef)` depois do primeiro uso, chame
 * `clearProjConverterCache()`.
 */
import "../proj-defs";
import proj4 from "proj4";
import type { Converter } from "proj4";

// Limite só para não crescer sem fim se alguém passar defs dinâmicas;
// na prática são poucos pares (graus → UTM de 1–2 zonas).
const MAX_ENTRIES = 256;
const cache = new Map<string, Converter>();

export function getProjConverter(from: string, to: string): Converter {
  const key = `${from}\u0000${to}`;
  let conv = cache.get(key);
  if (!conv) {
    conv = proj4(from, to);
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(key, conv);
  }
  return conv;
}

/** Equivalente a `proj4(from, to, [x, y])`, com a Projection reaproveitada. */
export function projectPoint(from: string, to: string, point: number[]): [number, number] {
  return getProjConverter(from, to).forward([point[0], point[1]]) as [number, number];
}

export function clearProjConverterCache(): void {
  cache.clear();
}
