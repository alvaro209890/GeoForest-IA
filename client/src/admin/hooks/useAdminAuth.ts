/**
 * Sessão do painel administrativo.
 *
 * As rotas `/api/admin/*` exigem o token JWT emitido por `POST /api/admin/login`
 * (`requireAdminAuth` no backend). O painel React não tinha login e chamava as
 * rotas sem token — o que só funcionava porque elas estavam desprotegidas.
 */
import { useCallback, useEffect, useState } from "react";
import { apiUrl, setAdminToken } from "../format";

const STORAGE_KEY = "admin_token";

export type AdminAuthState = {
  token: string;
  checking: boolean;
  error: string;
  login: (password: string) => Promise<void>;
  logout: () => void;
};

export function useAdminAuth(): AdminAuthState {
  const [token, setToken] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || "");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  // mantém o helper de fetch em sincronia com o token corrente
  useEffect(() => {
    setAdminToken(token);
  }, [token]);

  // valida o token guardado (pode ter expirado — 8 h)
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setChecking(false);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(apiUrl("/api/admin/session"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!response.ok) {
          localStorage.removeItem(STORAGE_KEY);
          setToken("");
        }
      } catch {
        /* offline: mantém o token e deixa a chamada real falhar */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (password: string) => {
    setError("");
    const response = await fetch(apiUrl("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.token) {
      const message = String(payload?.error || "Senha incorreta.");
      setError(message);
      throw new Error(message);
    }
    localStorage.setItem(STORAGE_KEY, payload.token);
    setToken(payload.token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken("");
  }, []);

  return { token, checking, error, login, logout };
}
