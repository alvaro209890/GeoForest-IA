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
  fileCount: number;
  bytes: number;
  lastModifiedAt?: string;
  byCategory?: Array<{ category: string; count: number; bytes: number }>;
  cbersArchiveBytes?: number;
  cbersArchiveCount?: number;
};

type AdminStorageFile = {
  id: string;
  uid: string;
  name: string;
  relativePath: string;
  publicUrl?: string;
  category: string;
  source: "user_storage" | "cbers_archive";
  extension: string;
  bytes: number;
  modifiedAt?: string;
  createdAt?: string;
  imageId?: string;
  wmsPublicUrl?: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
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

async function fetchJson(path: string): Promise<any> {
  const response = await fetch(apiUrl(path));
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Resposta do backend não é JSON.");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "Falha na requisição.");
  return payload;
}

function cbersImageToStorageFile(image: any): AdminStorageFile {
  return {
    id: `cbers_archive:${String(image?.imageId || image?.archiveFilename || crypto.randomUUID?.() || Math.random())}`,
    uid: String(image?.uid || ""),
    name: String(image?.archiveFilename || image?.itemId || "CBERS"),
    relativePath: String(image?.hdRelativePath || image?.hdPath || ""),
    category: "CBERS WMS permanente",
    source: "cbers_archive",
    extension: "tif",
    bytes: Number(image?.bytes || 0),
    createdAt: String(image?.createdAt || ""),
    modifiedAt: String(image?.updatedAt || image?.createdAt || ""),
    imageId: String(image?.imageId || ""),
    wmsPublicUrl: String(image?.wmsPublicUrl || ""),
    userDeletedAt: image?.userDeletedAt,
    adminDeletedAt: image?.adminDeletedAt,
  };
}

function AdminApp() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [files, setFiles] = useState<AdminStorageFile[]>([]);
  const [storageCategories, setStorageCategories] = useState<Array<{ category: string; count: number; bytes: number }>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let payload: any;
      try {
        payload = await fetchJson("/api/admin/storage/summary");
      } catch {
        const legacy = await fetchJson("/api/admin/cbers-storage/summary");
        payload = {
          ...legacy,
          users: (Array.isArray(legacy?.users) ? legacy.users : []).map((user: any) => ({
            ...user,
            fileCount: Number(user.activeImageCount || user.imageCount || 0),
            byCategory: [{ category: "CBERS WMS permanente", count: Number(user.activeImageCount || 0), bytes: Number(user.bytes || 0) }],
            cbersArchiveBytes: Number(user.bytes || 0),
            cbersArchiveCount: Number(user.activeImageCount || 0),
          })),
          totalFiles: Number(legacy?.totalImages || 0),
          byCategory: [{ category: "CBERS WMS permanente", count: Number(legacy?.totalImages || 0), bytes: Number(legacy?.totalBytes || 0) }],
        };
      }
      const nextUsers = Array.isArray(payload?.users) ? payload.users : [];
      setUsers(nextUsers);
      setStorageCategories(Array.isArray(payload?.byCategory) ? payload.byCategory : []);
      setSelectedUid((current) => current || nextUsers[0]?.uid || "");
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async (uid: string) => {
    if (!uid) {
      setFiles([]);
      return;
    }
    setFileLoading(true);
    setError("");
    try {
      let payload: any;
      try {
        payload = await fetchJson(`/api/admin/storage/users/${encodeURIComponent(uid)}/files`);
      } catch {
        const legacy = await fetchJson(`/api/admin/cbers-storage/users/${encodeURIComponent(uid)}/images`);
        payload = { files: (Array.isArray(legacy?.images) ? legacy.images : []).map(cbersImageToStorageFile) };
      }
      setFiles(Array.isArray(payload?.files) ? payload.files : []);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setFileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadFiles(selectedUid);
  }, [loadFiles, selectedUid]);

  const filteredUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return users;
    return users.filter((item) =>
      [item.uid, item.email, item.fullName].some((value) => String(value || "").toLowerCase().includes(text)),
    );
  }, [query, users]);

  const selectedUser = users.find((item) => item.uid === selectedUid) || null;
  const totalBytes = users.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  const totalFiles = users.reduce((sum, item) => sum + Number(item.fileCount || 0), 0);

  const deleteCbersArchive = async (file: AdminStorageFile) => {
    if (file.adminDeletedAt || !file.imageId) return;
    const confirmed = window.confirm(`Excluir definitivamente do HD e WMS?\n\n${file.name}`);
    if (!confirmed) return;
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/admin/cbers-storage/images/${encodeURIComponent(file.imageId)}`), {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Falha ao excluir imagem.");
      await Promise.all([loadSummary(), loadFiles(selectedUid)]);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  return (
    <main className="min-h-screen bg-[#07100d] text-slate-100">
      <header className="border-b border-white/10 bg-[#0b1713]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold">GeoForest Admin</h1>
            <p className="text-sm text-slate-400">Uso total por usuário, arquivos locais e acervo CBERS/WMS</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            onClick={() => void Promise.all([loadSummary(), loadFiles(selectedUid)])}
            disabled={loading || fileLoading}
          >
            <RefreshCw size={16} className={loading || fileLoading ? "animate-spin" : ""} />
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
            Arquivos rastreados
          </div>
          <p className="mt-3 text-2xl font-semibold">{totalFiles}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <User size={16} />
            Contas com dados
          </div>
          <p className="mt-3 text-2xl font-semibold">{users.length}</p>
        </div>
      </section>

      {storageCategories.length > 0 && (
        <section className="mx-auto grid max-w-7xl gap-3 px-5 pb-5 md:grid-cols-4">
          {storageCategories.slice(0, 8).map((item) => (
            <div key={item.category} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{item.category}</p>
              <p className="mt-2 text-sm font-semibold text-slate-100">{formatBytes(item.bytes)}</p>
              <p className="mt-1 text-xs text-slate-500">{item.count} arquivo(s)</p>
            </div>
          ))}
        </section>
      )}

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
                  <span>{item.fileCount} arquivo(s)</span>
                  <span>{formatBytes(item.bytes)}</span>
                </div>
                {Array.isArray(item.byCategory) && item.byCategory.length > 0 && (
                  <p className="mt-2 truncate text-[11px] text-slate-500">
                    {item.byCategory.slice(0, 2).map((cat) => `${cat.category}: ${formatBytes(cat.bytes)}`).join(" · ")}
                  </p>
                )}
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
                <p className="text-xs text-slate-500">{selectedUser.fileCount} arquivo(s)</p>
              </div>
            )}
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-white/[0.03] text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Arquivo</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Tamanho</th>
                  <th className="px-4 py-3">Atualizado</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-t border-white/5">
                    <td className="max-w-[320px] px-4 py-3">
                      <p className="truncate font-medium">{file.name}</p>
                      <p className="truncate text-xs text-slate-500">{file.relativePath}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {file.category}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatBytes(file.bytes)}</td>
                    <td className="px-4 py-3 text-slate-400">{formatDate(file.modifiedAt || file.createdAt)}</td>
                    <td className="px-4 py-3">
                      {file.source === "cbers_archive" ? (
                        <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">CBERS/WMS permanente</span>
                      ) : (
                        <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">Conta local</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {(file.wmsPublicUrl || file.publicUrl) && (
                          <a
                            className="inline-flex size-9 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/5"
                            href={file.wmsPublicUrl || file.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Abrir arquivo"
                          >
                            <ExternalLink size={16} />
                          </a>
                        )}
                        {file.source === "cbers_archive" && file.imageId && (
                          <button
                            className="inline-flex size-9 items-center justify-center rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => void deleteCbersArchive(file)}
                            disabled={Boolean(file.adminDeletedAt)}
                            title="Excluir definitivamente do HD e WMS"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!files.length && (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-500" colSpan={6}>
                      {fileLoading ? "Carregando arquivos..." : "Nenhum arquivo para esta conta."}
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
