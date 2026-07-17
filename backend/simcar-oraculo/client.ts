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

async function req(url: string, opts: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { ...BROWSER_HEADERS, ...(opts.headers as Record<string, string> | undefined) },
    });
  } finally {
    clearTimeout(t);
  }
}

function rootUrl(): string {
  return getSimcarOraculoConfig().root.replace(/\/$/, "");
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
  const r = await req(
    `${rootUrl()}/Autenticacao/Autenticar`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    60000,
  );
  const text = await r.text();
  if (!r.ok) throw new Error(`login SIMCAR ${r.status}: ${text.slice(0, 300)}`);
  const token = text.replace(/^"|"$/g, "");
  if (!/^TECNICO /.test(token)) throw new Error(`token SIMCAR inesperado: ${token.slice(0, 80)}`);
  tokenCache = { token, expiresAtMs: Date.now() + 25 * 60 * 1000 };
  return token;
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
  if (!r.ok) throw new Error(`POST ${pathname} ${r.status}: ${text.slice(0, 500)}`);
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
  if (!r.ok) throw new Error(`GET ${pathname} ${r.status}: ${text.slice(0, 500)}`);
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
  if (!r.ok) throw new Error(`download ${pathname} ${r.status}: ${(await r.text()).slice(0, 300)}`);
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
  if (!r.ok) throw new Error(`upload SIMCAR ${r.status}: ${text.slice(0, 500)}`);
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
