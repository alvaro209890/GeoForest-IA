/**
 * `fetch` com timeout duro — a mesma dança de `AbortController` + `setTimeout`
 * + `clearTimeout` que estava copiada em `cbers/utils.ts`,
 * `landsat/stac-search.ts`, `ndvi/scene-select.ts`, `ndvi-scene/scene-select.ts`
 * e `fiscalizacao/sources.ts`.
 *
 * Cada chamador mantém a própria mensagem de erro (`httpError`) porque elas
 * aparecem no laudo e no log — só o encanamento é compartilhado.
 */

export type FetchJsonOptions = {
  /** Aborta a requisição depois deste tempo. */
  timeoutMs: number;
  init?: RequestInit;
  /** Cabeçalhos aplicados antes dos de `init` (que vencem). */
  defaultHeaders?: Record<string, string>;
  /** Monta a mensagem quando a resposta não é 2xx. */
  httpError?: (info: { url: string; status: number; body: string }) => string;
};

export async function fetchJsonWithTimeout<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      ...options.init,
      signal: controller.signal,
      headers: { ...(options.defaultHeaders || {}), ...(options.init?.headers || {}) },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        options.httpError
          ? options.httpError({ url, status: response.status, body })
          : `HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Escapa `& < > " '` para uso em XML (payloads REST do GeoServer). */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normaliza o que o GeoServer devolve ora como objeto, ora como lista. */
export function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}
