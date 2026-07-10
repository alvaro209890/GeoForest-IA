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
 * reload só acontece com a aba visível, para nunca interromper algo em foco.
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
  if (!remote || remote === currentBuildId) return;
  reloading = true;
  // reload forçado ignorando o cache do próprio HTML
  window.location.reload();
}

/**
 * Ativa a verificação de versão. Idempotente e seguro em produção; em dev
 * (sem version.json) simplesmente não encontra atualização e não faz nada.
 */
export function setupAutoUpdate(): void {
  if (typeof window === "undefined") return;
  // primeira checagem logo após o load (dá tempo do deploy propagar entre reloads)
  window.setTimeout(() => void checkForUpdate(), 30_000);
  window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  window.addEventListener("focus", () => void checkForUpdate());
}
