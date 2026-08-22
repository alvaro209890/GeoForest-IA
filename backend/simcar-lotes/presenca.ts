/**
 * Presença "Sistema" no Monitor SIMCAR (https://monitor-car.web.app).
 *
 * Qualquer uso autenticado da conta compartilhada grava
 * `presence/simcar/clients/sistema/<connId>` com `who: "Sistema"` e heartbeat
 * de 15 s. O painel interno passa a mostrar EM USO / Responsável Sistema.
 * Ao terminar (ou em crash, via STALE de 40 s) a entrada some.
 *
 * Leitura do monitor continua em `monitor.ts` (GET). Aqui só WRITE/DELETE.
 * Fail-open: se o RTDB não aceitar a escrita, o trabalho no SIMCAR segue.
 */
import {
  lerOcupacaoSimcar,
  monitorHabilitado,
  monitorPollMs,
} from "./monitor";

const RTDB_URL_PADRAO = "https://monitor-car-default-rtdb.firebaseio.com";
const UID = "sistema";
const WHO = "Sistema";
const HEARTBEAT_MS = 15_000;
const TIMEOUT_MS = 8_000;

export const PRESENCA_UID = UID;
export const PRESENCA_WHO = WHO;

export interface OpcoesPresenca {
  app?: string;
  href?: string;
  /** Se false, não espera o monitor ficar livre (o caller já esperou). */
  esperar?: boolean;
}

function rtdbUrl(): string {
  return String(process.env.SIMCAR_MONITOR_RTDB_URL || RTDB_URL_PADRAO).replace(/\/$/, "");
}

function presencaAtiva(): boolean {
  if (!monitorHabilitado()) return false;
  // Testes do resto da suíte não devem escrever no RTDB ao vivo.
  if (process.env.VITEST && process.env.SIMCAR_PRESENCA_TEST !== "1") return false;
  return true;
}

function novoConnId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const pid = typeof process !== "undefined" ? String(process.pid || "0") : "0";
  return `geoforest-${pid}-${rand}`;
}

/** connId estável deste processo — a espera ignora a nossa própria entrada. */
export const CONN_ID_PRESENCA = novoConnId();

function appPadrao(): string {
  return String(process.env.SIMCAR_PRESENCA_APP || "GeoForest-IA");
}

function hrefPadrao(): string {
  return String(process.env.SIMCAR_PRESENCA_HREF || "https://ia-florestal.web.app");
}

let usos = 0;
let sinceMs = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let ocupando = false;
let saidaRegistrada = false;
let appAtual = appPadrao();
let hrefAtual = hrefPadrao();

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rtdb(method: "PUT" | "DELETE", caminho: string, corpo?: unknown): Promise<void> {
  const r = await fetch(`${rtdbUrl()}/${caminho}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`presenca RTDB ${method} ${r.status}`);
}

function payload(lastSeen: number) {
  return {
    who: WHO,
    kind: "sistema",
    app: appAtual,
    since: sinceMs,
    lastSeen,
    href: hrefAtual,
    ua: `${appAtual} (sistema)`,
  };
}

async function gravar(): Promise<void> {
  const agora = Date.now();
  if (!sinceMs) sinceMs = agora;
  await rtdb("PUT", `presence/simcar/clients/${UID}/${CONN_ID_PRESENCA}.json`, payload(agora));
}

async function apagar(): Promise<void> {
  await rtdb("DELETE", `presence/simcar/clients/${UID}/${CONN_ID_PRESENCA}.json`);
}

async function esperarLivre(): Promise<void> {
  for (;;) {
    const status = await lerOcupacaoSimcar({ ignorarConnIds: [CONN_ID_PRESENCA] });
    if (!status.ocupado) return;
    await dormir(monitorPollMs());
  }
}

function iniciarHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    void gravar().catch((error) => {
      console.warn(`[simcar-presenca] heartbeat falhou: ${String(error?.message || error)}`);
    });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

function pararHeartbeat(): void {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

function registrarSaida(): void {
  if (saidaRegistrada) return;
  saidaRegistrada = true;
  const limpar = () => {
    usos = 0;
    ocupando = false;
    pararHeartbeat();
    void apagar().catch(() => undefined);
  };
  process.once("beforeExit", limpar);
  process.once("SIGINT", limpar);
  process.once("SIGTERM", limpar);
}

/**
 * Marca o SIMCAR como em uso pelo Sistema. Refcount: N operações no mesmo
 * processo compartilham uma única entrada no monitor.
 */
export async function adquirirPresenca(opts: OpcoesPresenca = {}): Promise<void> {
  if (!presencaAtiva()) return;
  usos += 1;
  if (usos > 1 && ocupando) return;
  appAtual = opts.app || appPadrao();
  hrefAtual = opts.href || hrefPadrao();
  registrarSaida();
  try {
    if (opts.esperar !== false) await esperarLivre();
    await gravar();
    ocupando = true;
    iniciarHeartbeat();
  } catch (error: any) {
    console.warn(`[simcar-presenca] não conseguiu gravar no monitor (seguindo): ${String(error?.message || error)}`);
    ocupando = true;
    iniciarHeartbeat();
  }
}

/** Decrementa o refcount; na última operação remove a entrada do monitor. */
export async function soltarPresenca(): Promise<void> {
  if (usos > 0) usos -= 1;
  if (usos > 0) return;
  await liberarPresencaForcado();
}

/** Zera o refcount e apaga a presença — usado quando a sessão foi derrubada. */
export async function liberarPresencaForcado(): Promise<void> {
  usos = 0;
  ocupando = false;
  sinceMs = 0;
  pararHeartbeat();
  if (!presencaAtiva() && process.env.SIMCAR_PRESENCA_TEST !== "1") return;
  try {
    await apagar();
  } catch (error: any) {
    console.warn(`[simcar-presenca] não conseguiu apagar do monitor: ${String(error?.message || error)}`);
  }
}

/** Testes: estado interno zerado. */
export function resetarPresencaParaTeste(): void {
  usos = 0;
  ocupando = false;
  sinceMs = 0;
  pararHeartbeat();
}

export function usosPresenca(): number {
  return usos;
}
