/**
 * Helpers HTTP compartilhados pelo frontend GeoForest.
 * Centraliza base da API, auth Bearer e utilitários de arquivo.
 */

import { getCurrentUserAsync } from '@/lib/auth';

export const DEFAULT_PRODUCTION_API_BASE = 'https://geoforest-api.cursar.space';

export const CONFIGURED_API_BASE = String(
  import.meta.env.VITE_API_BASE ||
    (typeof window !== 'undefined' && /\.web\.app$/i.test(window.location.hostname)
      ? DEFAULT_PRODUCTION_API_BASE
      : ''),
)
  .trim()
  .replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path) return CONFIGURED_API_BASE || '';
  if (!CONFIGURED_API_BASE) return path;
  return `${CONFIGURED_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveBackendUrl(url?: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.startsWith('/api/') ? apiUrl(raw) : raw;
}

export async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function readApiError(response: Response): Promise<any> {
  const fallback = { error: `Erro ${response.status}` };
  const text = await response.text();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    const isHtml = /^\s*</.test(text);
    return {
      error: isHtml
        ? `A API retornou HTML em vez de JSON (${response.status}). Recarregue a página e tente novamente.`
        : text.slice(0, 500),
    };
  }
}

/**
 * Mesma leitura de erro, mas devolvendo só a mensagem — é o que os painéis
 * mostram no toast. Estava duplicada em `ContainmentAnalysis` e
 * `GeometryErrorsAnalysis`.
 */
export async function readApiErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `Erro ${response.status}`;
    try {
      const json = JSON.parse(text);
      return json?.error || json?.message || text;
    } catch {
      return text;
    }
  } catch {
    return `Erro ${response.status}`;
  }
}

export type ApiFetchOptions = {
  auth?: boolean;
};

/**
 * Fetch autenticado contra a API GeoForest (Bearer Firebase ID token).
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<Response> {
  const useAuth = options?.auth !== false;
  const headers = new Headers(init?.headers || {});
  const hasBody = typeof init?.body !== 'undefined' && init?.body !== null;
  if (hasBody && !(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (useAuth) {
    const user = await getCurrentUserAsync();
    if (!user) {
      throw new Error('Usuário não autenticado.');
    }
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(apiUrl(path), {
    ...init,
    headers,
  });
}
