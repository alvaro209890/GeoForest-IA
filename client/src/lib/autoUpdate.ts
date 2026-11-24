/**
 * Auto-update sem Ctrl+F5.
 *
 * O index.html é servido com `no-cache` e os bundles JS/CSS têm hash no nome
 * (imutáveis). Isso já garante que QUEM ABRE a página do zero recebe sempre a
 * versão nova. O ponto cego é a aba que já ficou aberta: ela não volta a buscar
 * o index.html sozinha.
 *
 * Aqui resolvemos isso: cada build injeta um __APP_BUILD_ID__ e grava um
 * version.json. Periodicamente (e quando a aba volta a ficar visível) buscamos
 * version.json; se o buildId mudou, recarregamos a página uma única vez. O
 * reload só acontece com a aba visível.
 */

const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min

let currentBuildId = "";
try {
  currentBuildId = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
} catch {
  currentBuildId = "";
}

let reloading = false;
let started = false;

async function fetchRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string };
    return typeof data?.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

async function checkForUpdate(): Promise<void> {
  if (reloading || !currentBuildId || document.visibilityState !== "visible") return;
  const remote = await fetchRemoteBuildId();
  if (reloading || !remote || remote === currentBuildId) return;
  reloading = true;
  // O HTML volta a ser validado pelo navegador em um reload normal.
  window.location.reload();
}

/**
 * Ativa a verificação de versão. Idempotente e seguro em produção; em dev
 * (sem version.json) simplesmente não encontra atualização e não faz nada.
 */
export function setupAutoUpdate(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  // primeira checagem cedo (CDN propaga em segundos; evita Ctrl+F5 após deploy)
  window.setTimeout(() => void checkForUpdate(), 8_000);
  window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  window.addEventListener("focus", () => void checkForUpdate());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void checkForUpdate();
  });
  // Login e painel são importados sob demanda. Uma aba antiga pode pedir um
  // arquivo removido pelo deploy antes da próxima checagem periódica.
  window.addEventListener("vite:preloadError", () => void checkForUpdate());
}
