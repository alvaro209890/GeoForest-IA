/**
 * Leitura do Monitor SIMCAR (https://monitor-car.web.app) — SOMENTE LEITURA.
 *
 * O monitor é um Firebase Realtime Database alimentado por um userscript
 * Tampermonkey que roda no navegador de quem loga no SIMCAR com o login
 * compartilhado: grava `presence/simcar/clients/<uid>/<connId>` com heartbeat de
 * 20 s e `onDisconnect().remove()`.
 *
 * O GeoForest apenas LÊ esse nó para saber se pode logar. Ele NUNCA escreve,
 * atualiza ou apaga nada em `presence/*` — o bot precisa ser invisível para os
 * outros usuários do monitor (requisito R2 do plano docs/planos/simcar-monitor/).
 *
 * Fail-open: se o monitor não responde, o download segue. Perder um monitor não
 * pode travar o trabalho de ninguém (decisão G4).
 */

const RTDB_URL_PADRAO = "https://monitor-car-default-rtdb.firebaseio.com";

/** Janela de "cliente vivo" usada pelo site do monitor. */
const STALE_MS_PADRAO = 40_000;
/** `lastSeen` é relógio do RTDB; o nosso pode estar alguns segundos à frente. */
const MARGEM_SKEW_MS = 10_000;
const TIMEOUT_MS = 10_000;
const CACHE_MS = 5_000;

export interface MonitorSimcarStatus {
  ocupado: boolean;
  /** Rótulo humano do client mais recente ("Bruno"). */
  por?: string;
  /** `since` (ms) do client mais recente. */
  desde?: number;
  conexoes: number;
  checadoEm: number;
  /** Presente quando o monitor não pôde ser lido (fail-open). */
  erro?: string;
}

function rtdbUrl(): string {
  return String(process.env.SIMCAR_MONITOR_RTDB_URL || RTDB_URL_PADRAO).replace(/\/$/, "");
}

function staleMs(): number {
  const valor = Number(process.env.SIMCAR_MONITOR_STALE_MS || STALE_MS_PADRAO);
  return Number.isFinite(valor) && valor > 0 ? valor : STALE_MS_PADRAO;
}

export function monitorHabilitado(): boolean {
  return String(process.env.SIMCAR_MONITOR_ENABLED ?? "1") !== "0";
}

export function monitorPollMs(): number {
  const valor = Number(process.env.SIMCAR_MONITOR_POLL_MS || 15_000);
  return Number.isFinite(valor) && valor >= 1000 ? valor : 15_000;
}

/** 0 = ilimitado (padrão): re-tenta o lote quantas vezes for preciso. */
export function monitorMaxRetry(): number {
  const valor = Number(process.env.SIMCAR_MONITOR_MAX_RETRY || 0);
  return Number.isFinite(valor) && valor > 0 ? Math.trunc(valor) : 0;
}

async function lerJson(caminho: string): Promise<any> {
  const r = await fetch(`${rtdbUrl()}/${caminho}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`monitor RTDB ${r.status}`);
  return r.json();
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function rotulo(valor: unknown): string | undefined {
  const texto = String(valor ?? "").trim();
  return texto ? texto.slice(0, 60) : undefined;
}

/**
 * Lê `presence/simcar/clients` (+ fallback `current`) e decide se o SIMCAR está
 * em uso, com a mesma regra do site do monitor.
 */
export async function lerOcupacaoSimcar(): Promise<MonitorSimcarStatus> {
  const checadoEm = Date.now();
  try {
    const clients = await lerJson("presence/simcar/clients.json");
    const limite = staleMs() + MARGEM_SKEW_MS;
    let conexoes = 0;
    let maisRecente: { lastSeen: number; who?: string; since?: number } | null = null;

    for (const porUid of Object.values(clients || {})) {
      for (const conexao of Object.values((porUid || {}) as Record<string, any>)) {
        const lastSeen = numero((conexao as any)?.lastSeen);
        if (!lastSeen || checadoEm - lastSeen > limite) continue; // fantasma (stale)
        conexoes += 1;
        if (!maisRecente || lastSeen > maisRecente.lastSeen) {
          maisRecente = {
            lastSeen,
            who: rotulo((conexao as any)?.who),
            since: numero((conexao as any)?.since) || undefined,
          };
        }
      }
    }

    if (conexoes > 0 && maisRecente) {
      return {
        ocupado: true,
        por: maisRecente.who,
        desde: maisRecente.since,
        conexoes,
        checadoEm,
      };
    }

    // Fallback legado do site: nó `current` (hoje normalmente null).
    const current = await lerJson("presence/simcar/current.json");
    const lastSeen = numero(current?.lastSeen);
    const online =
      String(current?.status || "").toLowerCase() === "online" &&
      lastSeen > 0 &&
      checadoEm - lastSeen <= limite;
    if (online) {
      return {
        ocupado: true,
        por: rotulo(current?.who),
        desde: numero(current?.since) || undefined,
        conexoes: 1,
        checadoEm,
      };
    }

    return { ocupado: false, conexoes: 0, checadoEm };
  } catch (error: any) {
    const erro = String(error?.message || error || "monitor indisponível");
    console.warn(`[simcar-monitor] leitura falhou (seguindo sem gate): ${erro}`);
    return { ocupado: false, conexoes: 0, checadoEm, erro };
  }
}

let cache: { emMs: number; valor: MonitorSimcarStatus } | null = null;
let emVoo: Promise<MonitorSimcarStatus> | null = null;

/** Versão com cache de ~5 s — usada pelo endpoint que o painel consulta. */
export async function lerOcupacaoSimcarCached(): Promise<MonitorSimcarStatus> {
  if (cache && Date.now() - cache.emMs < CACHE_MS) return cache.valor;
  if (emVoo) return emVoo;
  emVoo = lerOcupacaoSimcar()
    .then((valor) => {
      cache = { emMs: Date.now(), valor };
      return valor;
    })
    .finally(() => {
      emVoo = null;
    });
  return emVoo;
}

/** Testes: zera o cache entre casos. */
export function limparCacheMonitor(): void {
  cache = null;
  emVoo = null;
}
