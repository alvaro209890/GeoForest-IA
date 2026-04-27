import "@/index.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  HardDrive,
  RefreshCw,
  Search,
  Trash2,
  User,
} from "lucide-react";

type UserSummary = {
  uid: string;
  email?: string;
  fullName?: string;
  imageCount: number;
  activeImageCount: number;
  bytes: number;
  deletedBytes: number;
  lastCreatedAt?: string;
};

type ArchiveImage = {
  imageId: string;
  uid: string;
  jobId: string;
  itemId: string;
  orbit: string;
  year: string;
  archiveFilename: string;
  hdRelativePath: string;
  hdPath: string;
  bytes: number;
  wmsLayerName: string;
  wmsPublicUrl: string;
  createdAt: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
  adminDeleteError?: string;
};

function apiBase(): string {
  return String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
}

function apiUrl(path: string): string {
  const base = apiBase();
  return base ? `${base}${path}` : path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function AdminApp() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/admin/cbers-storage/summary"));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Falha ao carregar resumo.");
      const nextUsers = Array.isArray(payload?.users) ? payload.users : [];
      setUsers(nextUsers);
      setSelectedUid((current) => current || nextUsers[0]?.uid || "");
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadImages = useCallback(async (uid: string) => {
    if (!uid) {
      setImages([]);
      return;
    }
    setImageLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/admin/cbers-storage/users/${encodeURIComponent(uid)}/images`));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Falha ao carregar imagens.");
      setImages(Array.isArray(payload?.images) ? payload.images : []);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setImageLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadImages(selectedUid);
  }, [loadImages, selectedUid]);

  const filteredUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return users;
    return users.filter((item) =>
      [item.uid, item.email, item.fullName].some((value) => String(value || "").toLowerCase().includes(text)),
    );
  }, [query, users]);

  const selectedUser = users.find((item) => item.uid === selectedUid) || null;
  const totalBytes = users.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  const totalImages = users.reduce((sum, item) => sum + Number(item.activeImageCount || 0), 0);

  const deleteImage = async (image: ArchiveImage) => {
    if (image.adminDeletedAt) return;
    const confirmed = window.confirm(`Excluir definitivamente do HD e WMS?\n\n${image.archiveFilename}`);
    if (!confirmed) return;
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/admin/cbers-storage/images/${encodeURIComponent(image.imageId)}`), {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Falha ao excluir imagem.");
      await Promise.all([loadSummary(), loadImages(selectedUid)]);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  return (
    <main className="min-h-screen bg-[#07100d] text-slate-100">
      <header className="border-b border-white/10 bg-[#0b1713]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold">GeoForest Admin CBERS</h1>
            <p className="text-sm text-slate-400">Acervo permanente no HD Backup e WMS</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            onClick={() => void Promise.all([loadSummary(), loadImages(selectedUid)])}
            disabled={loading || imageLoading}
          >
            <RefreshCw size={16} className={loading || imageLoading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-5 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <HardDrive size={16} />
            Uso ativo
          </div>
          <p className="mt-3 text-2xl font-semibold">{formatBytes(totalBytes)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Database size={16} />
            Imagens ativas
          </div>
          <p className="mt-3 text-2xl font-semibold">{totalImages}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <User size={16} />
            Contas com CBERS
          </div>
          <p className="mt-3 text-2xl font-semibold">{users.length}</p>
        </div>
      </section>

      {error && (
        <div className="mx-auto mb-4 flex max-w-7xl items-center gap-2 px-5 text-sm text-red-300">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-8 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-lg border border-white/10 bg-[#0b1713]">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
              <Search size={16} className="text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar conta"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
              />
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto p-2">
            {filteredUsers.map((item) => (
              <button
                key={item.uid}
                onClick={() => setSelectedUid(item.uid)}
                className={`mb-2 w-full rounded-md border p-3 text-left transition ${
                  selectedUid === item.uid
                    ? "border-cyan-400/40 bg-cyan-400/10"
                    : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
              >
                <p className="truncate text-sm font-medium">{item.fullName || item.email || item.uid}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{item.email || item.uid}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                  <span>{item.activeImageCount} ativa(s)</span>
                  <span>{formatBytes(item.bytes)}</span>
                </div>
              </button>
            ))}
            {!filteredUsers.length && <p className="p-4 text-sm text-slate-500">Nenhuma conta encontrada.</p>}
          </div>
        </aside>

        <section className="rounded-lg border border-white/10 bg-[#0b1713]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {selectedUser?.fullName || selectedUser?.email || selectedUid || "Conta"}
              </h2>
              <p className="truncate text-xs text-slate-500">{selectedUid}</p>
            </div>
            {selectedUser && (
              <div className="text-right text-sm">
                <p className="font-medium">{formatBytes(selectedUser.bytes)}</p>
                <p className="text-xs text-slate-500">{selectedUser.activeImageCount} imagem(ns) ativa(s)</p>
              </div>
            )}
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-white/[0.03] text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Imagem</th>
                  <th className="px-4 py-3">Órbita/Ano</th>
                  <th className="px-4 py-3">Tamanho</th>
                  <th className="px-4 py-3">Criada</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr key={image.imageId} className="border-t border-white/5">
                    <td className="max-w-[320px] px-4 py-3">
                      <p className="truncate font-medium">{image.archiveFilename}</p>
                      <p className="truncate text-xs text-slate-500">{image.hdRelativePath}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {image.orbit} / {image.year}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatBytes(image.bytes)}</td>
                    <td className="px-4 py-3 text-slate-400">{formatDate(image.createdAt)}</td>
                    <td className="px-4 py-3">
                      {image.adminDeletedAt ? (
                        <span className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">Excluída do HD/WMS</span>
                      ) : image.userDeletedAt ? (
                        <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">Removida da conta</span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">Ativa</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <a
                          className="inline-flex size-9 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/5"
                          href={image.wmsPublicUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir WMS"
                        >
                          <ExternalLink size={16} />
                        </a>
                        <button
                          className="inline-flex size-9 items-center justify-center rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => void deleteImage(image)}
                          disabled={Boolean(image.adminDeletedAt)}
                          title="Excluir definitivamente do HD e WMS"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!images.length && (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-500" colSpan={6}>
                      {imageLoading ? "Carregando imagens..." : "Nenhuma imagem CBERS para esta conta."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
