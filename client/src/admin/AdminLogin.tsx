/**
 * Tela de login do painel administrativo (senha → JWT de 8 h).
 */
import React, { useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";

export type AdminLoginProps = {
  onLogin: (password: string) => Promise<void>;
};

export function AdminLogin({ onLogin }: AdminLoginProps): React.ReactElement {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onLogin(password);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07100d] px-5 text-slate-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-white/10 bg-[#0b1713] p-6"
      >
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Lock size={18} className="text-cyan-300" />
            GeoForest Admin
          </h1>
          <p className="text-sm text-slate-400">Informe a senha de administrador.</p>
        </div>

        <input
          type="password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Senha"
          className="w-full rounded-md border border-white/10 bg-[#07100d] px-3 py-2 text-sm outline-none focus:border-cyan-400/40"
        />

        {error && (
          <p className="flex items-center gap-2 text-sm text-red-300">
            <AlertTriangle size={16} />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-md bg-cyan-300 px-3 py-2 text-sm font-semibold text-[#03120f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
