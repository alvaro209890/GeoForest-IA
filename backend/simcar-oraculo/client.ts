/**
 * Cliente HTTP da API do SIMCAR técnico (SEMA-MT).
 * Contrato: engenharia reversa do tecnico.app (2026-07-15/16).
 */
import { scramble } from "./scramble";
import { getSimcarOraculoConfig } from "./config";
import type { SimcarArquivoUpload } from "./types";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  Origin: "https://monitoramento.sema.mt.gov.br",
  Referer: "https://monitoramento.sema.mt.gov.br/simcar/tecnico.app/",
};

type TokenCache = { token: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

export class SimcarHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly pathname: string;

  constructor(args: { method: string; pathname: string; status: number; responseText: string }) {
    super(
      `${args.method} ${args.pathname} ${args.status}: ${args.responseText.slice(0, 500)}`,
    );
    this.name = "SimcarHttpError";
    this.status = args.status;
    this.method = args.method;
    this.pathname = args.pathname;
  }
}

async function req(url: string, opts: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { ...BROWSER_HEADERS, ...(opts.headers as Record<string, string> | undefined) },
    });
  } catch (error: any) {
    // Node/undici: AbortError.message === "This operation was aborted"
    const name = String(error?.name || "");
    const msg = String(error?.message || error || "");
    if (name === "AbortError" || /aborted|AbortError/i.test(msg)) {
      throw new Error(
        `Timeout SIMCAR (${timeoutMs}ms) em ${opts.method || "GET"} ${url.replace(rootUrl(), "")}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(t);
  }
}

function rootUrl(): string {
  return getSimcarOraculoConfig().root.replace(/\/$/, "");
}

function isTransientSigaLoginError(status: number, text: string): boolean {
  if (status >= 500) return true;
  // SEMA/SIGA costuma devolver 400 com "APIKEY … inválida" ou InternalServerError em instabilidade.
  return (
    status === 400 &&
    /SIGA|APIKEY|InternalServerError|indispon[ií]vel|inesperado/i.test(text)
  );
}

export async function simcarLogin(cpf: string, senha: string): Promise<string> {
  const body = JSON.stringify({
    v: scramble(
      JSON.stringify({
        Login: String(cpf).replace(/\D/g, ""),
        Senha: senha,
        NovaSenha: "",
      }),
    ),
  });
  const maxAttempts = 4;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const r = await req(
        `${rootUrl()}/Autenticacao/Autenticar`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
        60000,
      );
      const text = await r.text();
      if (!r.ok) {
        const err = new Error(`login SIMCAR ${r.status}: ${text.slice(0, 300)}`);
        if (attempt < maxAttempts && isTransientSigaLoginError(r.status, text)) {
          lastErr = err;
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          continue;
        }
        throw err;
      }
      const token = text.replace(/^"|"$/g, "");
      if (!/^TECNICO /.test(token)) {
        throw new Error(`token SIMCAR inesperado: ${token.slice(0, 80)}`);
      }
      tokenCache = { token, expiresAtMs: Date.now() + 25 * 60 * 1000 };
      return token;
    } catch (error: any) {
      const msg = String(error?.message || error || "");
      // rede / timeout transitório
      if (
        attempt < maxAttempts &&
        (/Timeout SIMCAR|fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(msg) ||
          /login SIMCAR (5\d\d|400)/.test(msg))
      ) {
        lastErr = error instanceof Error ? error : new Error(msg);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastErr || new Error("login SIMCAR falhou após retentativas.");
}

export async function getSimcarToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const c = getSimcarOraculoConfig();
  if (!c.cpf || !c.senha) throw new Error("SIMCAR_CPF/SIMCAR_SENHA não configurados.");
  return simcarLogin(c.cpf, c.senha);
}

export function clearSimcarTokenCache(): void {
  tokenCache = null;
}

function isUnauthorized(error: unknown): boolean {
  if (error instanceof SimcarHttpError) return error.status === 401;
  return error instanceof Error && /\b401\b/.test(error.message);
}

function isTransientServerError(error: unknown): error is SimcarHttpError {
  return error instanceof SimcarHttpError && error.status >= 500 && error.status <= 599;
}

/**
 * Executa uma chamada autenticada e, somente em 401, invalida a sessão, faz novo login e
 * repete a operação uma vez. A repetição é limitada para não mascarar credencial inválida.
 */
export async function withSimcarAuthRetry<T>(
  operation: (token: string) => Promise<T>,
  options: { onRetry?: () => void | Promise<void> } = {},
): Promise<T> {
  const token = await getSimcarToken();
  try {
    return await operation(token);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    clearSimcarTokenCache();
    await options.onRetry?.();
    const renewedToken = await getSimcarToken();
    return operation(renewedToken);
  }
}

/**
 * Polls são idempotentes: em 5xx transitório repetimos até três tentativas com backoff.
 * Erros 4xx, abort/timeout e a terceira falha seguem imediatamente para o chamador.
 */
export async function withSimcarPollRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (args: { attempt: number; delayMs: number; error: SimcarHttpError }) =>
      | void
      | Promise<void>;
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, Math.trunc(options.baseDelayMs ?? 500));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientServerError(error) || attempt >= maxAttempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      await options.onRetry?.({ attempt, delayMs, error });
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Retry de poll SIMCAR terminou sem resultado.");
}

export async function simcarPost(
  token: string,
  pathname: string,
  payload?: unknown,
  timeoutMs = 60000,
): Promise<unknown> {
  const r = await req(
    `${rootUrl()}/${pathname.replace(/^\//, "")}`,
    {
      method: "POST",
      headers: { authorization: token, "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
    timeoutMs,
  );
  const text = await r.text();
  if (!r.ok) {
    throw new SimcarHttpError({
      method: "POST",
      pathname,
      status: r.status,
      responseText: text,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function simcarGet(token: string, pathname: string, timeoutMs = 60000): Promise<unknown> {
  const r = await req(
    `${rootUrl()}/${pathname.replace(/^\//, "")}`,
    { method: "GET", headers: { authorization: token } },
    timeoutMs,
  );
  const text = await r.text();
  if (!r.ok) {
    throw new SimcarHttpError({
      method: "GET",
      pathname,
      status: r.status,
      responseText: text,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function simcarDownload(
  token: string,
  pathname: string,
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const path = pathname.replace(/^\//, "");
  let r = await req(
    `${rootUrl()}/${path}`,
    { method: "POST", headers: { authorization: token } },
    300000,
  );
  if (!r.ok) {
    const form = new URLSearchParams({ Authorization: token, FormParams: "" });
    r = await req(
      `${rootUrl()}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      300000,
    );
  }
  if (!r.ok) {
    throw new SimcarHttpError({
      method: "DOWNLOAD",
      pathname,
      status: r.status,
      responseText: (await r.text()).slice(0, 300),
    });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, contentType: r.headers.get("content-type") };
}

export async function simcarUploadZip(
  token: string,
  zipBuffer: Buffer,
  fileName: string,
): Promise<SimcarArquivoUpload> {
  const form = new FormData();
  const blob = new Blob([zipBuffer], { type: "application/zip" });
  form.append("file", blob, fileName.endsWith(".zip") ? fileName : `${fileName}.zip`);
  const r = await req(
    `${rootUrl()}/Arquivo/Upload/`,
    { method: "POST", headers: { authorization: token }, body: form },
    300000,
  );
  const text = await r.text();
  if (!r.ok) {
    throw new SimcarHttpError({
      method: "UPLOAD",
      pathname: "Arquivo/Upload/",
      status: r.status,
      responseText: text,
    });
  }
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed[0] : parsed) as SimcarArquivoUpload;
}

export async function simcarBuscar(token: string, carId: string | number): Promise<Record<string, unknown>> {
  return (await simcarGet(token, `Requerimento/Buscar/${carId}`)) as Record<string, unknown>;
}

export async function simcarBuscarStatusProcessamento(
  token: string,
  carId: string | number,
): Promise<Record<string, unknown>> {
  return (await simcarGet(token, `Requerimento/BuscarStatusProcessamento/${carId}`)) as Record<
    string,
    unknown
  >;
}
