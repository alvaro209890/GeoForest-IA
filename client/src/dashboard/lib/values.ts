/**
 * Coerções de valor usadas por todos os `mapDoc.ts` e hooks de job do Dashboard.
 *
 * Estas duas funções estavam copiadas em 13 arquivos (7× `isPlainObject`,
 * 6× `toIsoDateFromUnknown`). `format.tsx` e `mappers.ts` continuam
 * reexportando-as para não mudar o contrato de quem já importava de lá.
 */

/** `true` só para objeto literal (nada de Date, Timestamp, array ou classe). */
export const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Normaliza para ISO 8601 qualquer coisa que o backend/Firestore devolva como
 * data: string, `Timestamp` (com `.toDate()`), número ou `Date`. Sem valor
 * utilizável, devolve "agora" — nunca `Invalid Date`.
 */
export const toIsoDateFromUnknown = (value: any): string => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};
