/**
 * Raiz do painel administrativo: exige sessão de admin antes do dashboard.
 */
import React from "react";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { AdminLogin } from "./AdminLogin";
import { AdminApp } from "./AdminApp";

export function AdminRoot(): React.ReactElement {
  const { token, checking, login, logout } = useAdminAuth();

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#07100d] text-sm text-slate-400">
        Verificando sessão...
      </main>
    );
  }

  if (!token) return <AdminLogin onLogin={login} />;

  return <AdminApp onLogout={logout} />;
}
