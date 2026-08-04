/**
 * Container do painel administrativo: estado, carregamento de dados e abas.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  Layers3,
  MemoryStick,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Server,
  Thermometer,
  Trash2,
  User,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AdminStorageFile,
  BreakdownItem,
  ServerMetricsPayload,
  ServerStorageMetric,
  SourceSummary,
  SummaryPayload,
  UserSummary,
} from "./types";
import { CHART_COLORS } from "./constants";
import {
  apiUrl,
  compactBytes,
  formatBytes,
  formatDate,
  formatPercent,
  formatTemperature,
  formatUptime,
  shortLabel,
  sourceLabel,
  sourceTone,
  storageKindLabel,
  storageKindTone,
} from "./format";
import {
  BytesTooltip,
  ChartPanel,
  EmptyChart,
  InlineChartBlock,
  MetricCard,
  PercentBar,
  ProgressLine,
  ServerDiskCard,
  StorageBarChart,
  StoragePieChart,
} from "./components";
import { fetchJson, cbersImageToStorageFile, isAdminUserSummary } from "./format";
import { StorageTab } from "./StorageTab";
import { ServerTab } from "./ServerTab";

export function AdminApp() {
  const [activeTab, setActiveTab] = useState("storage");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [files, setFiles] = useState<AdminStorageFile[]>([]);
  const [storageCategories, setStorageCategories] = useState<Array<{ category: string; count: number; bytes: number }>>([]);
  const [storageSources, setStorageSources] = useState<SourceSummary[]>([]);
  const [storageExtensions, setStorageExtensions] = useState<Array<{ extension: string; count: number; bytes: number }>>([]);
  const [serverMetrics, setServerMetrics] = useState<ServerMetricsPayload | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [serverError, setServerError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setStorageError("");
    try {
      let payload: SummaryPayload;
      try {
        payload = await fetchJson("/api/admin/storage/summary");
      } catch {
        const legacy = await fetchJson("/api/admin/cbers-storage/summary");
        payload = {
          ok: true,
          totalBytes: Number(legacy?.totalBytes || 0),
          totalFiles: Number(legacy?.totalImages || 0),
          userStorageBytes: 0,
          sharedRasterBytes: Number(legacy?.totalBytes || 0),
          userStorageFiles: 0,
          sharedRasterFiles: Number(legacy?.totalImages || 0),
          byCategory: [{ category: "Raster compartilhado", count: Number(legacy?.totalImages || 0), bytes: Number(legacy?.totalBytes || 0) }],
          byExtension: [],
          bySource: [{ source: "raster_archive", count: Number(legacy?.totalImages || 0), bytes: Number(legacy?.totalBytes || 0) }],
          users: Array.isArray(legacy?.users)
            ? legacy.users.map((user: any) => ({
                ...user,
                fileCount: Number(user.activeImageCount || user.imageCount || 0),
                bytes: Number(user.bytes || 0),
                userStorageBytes: 0,
                userStorageCount: 0,
                sharedRasterBytes: Number(user.bytes || 0),
                sharedRasterCount: Number(user.activeImageCount || 0),
                byCategory: [{ category: "Raster compartilhado", count: Number(user.activeImageCount || 0), bytes: Number(user.bytes || 0) }],
                bySource: [{ source: "raster_archive", count: Number(user.activeImageCount || 0), bytes: Number(user.bytes || 0) }],
              }))
            : [],
        };
      }
      const nextUsers = (Array.isArray(payload?.users) ? payload.users : []).filter(isAdminUserSummary);
      setUsers(nextUsers);
      setStorageCategories(Array.isArray(payload?.byCategory) ? payload.byCategory : []);
      setStorageSources(Array.isArray(payload?.bySource) ? payload.bySource : []);
      setStorageExtensions(Array.isArray(payload?.byExtension) ? payload.byExtension : []);
      setSelectedUid((current) => (nextUsers.some((user) => user.uid === current) ? current : nextUsers[0]?.uid || ""));
    } catch (err: any) {
      setStorageError(String(err?.message || err));
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
    setStorageError("");
    try {
      let payload: any;
      try {
        payload = await fetchJson(`/api/admin/storage/users/${encodeURIComponent(uid)}/files`);
      } catch {
        const legacy = await fetchJson(`/api/admin/cbers-storage/users/${encodeURIComponent(uid)}/images`);
        payload = { files: Array.isArray(legacy?.images) ? legacy.images.map(cbersImageToStorageFile) : [] };
      }
      setFiles(Array.isArray(payload?.files) ? payload.files : []);
    } catch (err: any) {
      setStorageError(String(err?.message || err));
    } finally {
      setFileLoading(false);
    }
  }, []);

  const loadServerMetrics = useCallback(async () => {
    setServerLoading(true);
    setServerError("");
    try {
      const payload = (await fetchJson("/api/admin/server/metrics")) as ServerMetricsPayload;
      setServerMetrics(payload);
    } catch (err: any) {
      setServerError(String(err?.message || err));
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadFiles(selectedUid);
  }, [loadFiles, selectedUid]);

  useEffect(() => {
    if (activeTab !== "server" || serverMetrics || serverLoading) return;
    void loadServerMetrics();
  }, [activeTab, loadServerMetrics, serverLoading, serverMetrics]);

  useEffect(() => {
    if (activeTab !== "server") return;
    const timer = window.setInterval(() => {
      void loadServerMetrics();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadServerMetrics]);

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
  const localBytes = Number(selectedUser?.userStorageBytes ?? 0);
  const rasterBytes = Number(selectedUser?.sharedRasterBytes ?? 0);
  const selectedTotalBytes = Number(selectedUser?.bytes ?? 0);

  const deleteCbersArchive = async (file: AdminStorageFile) => {
    if (file.adminDeletedAt || !file.imageId) return;
    const confirmed = window.confirm(`Excluir definitivamente do HD e WMS?\n\n${file.name}`);
    if (!confirmed) return;
    setStorageError("");
    try {
      const response = await fetch(apiUrl(`/api/admin/cbers-storage/images/${encodeURIComponent(file.imageId)}`), {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Falha ao excluir imagem.");
      await Promise.all([loadSummary(), loadFiles(selectedUid)]);
    } catch (err: any) {
      setStorageError(String(err?.message || err));
    }
  };

  const totalLocalBytes = Number(storageSources.find((item) => item.source === "user_storage")?.bytes || 0);
  const totalRasterBytes = Number(storageSources.find((item) => item.source === "raster_archive")?.bytes || 0);

  const topUsersChart = useMemo<BreakdownItem[]>(
    () =>
      [...users]
        .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))
        .slice(0, 8)
        .map((item) => ({
          name: shortLabel(item.fullName || item.email || item.uid, 12),
          label: item.fullName || item.email || item.uid,
          bytes: Number(item.bytes || 0),
          count: Number(item.fileCount || 0),
        })),
    [users],
  );

  const sourceChart = useMemo<BreakdownItem[]>(
    () =>
      storageSources.map((item) => ({
        name: shortLabel(sourceLabel(item.source), 14),
        label: sourceLabel(item.source),
        bytes: Number(item.bytes || 0),
        count: Number(item.count || 0),
      })),
    [storageSources],
  );

  const categoryChart = useMemo<BreakdownItem[]>(
    () =>
      [...storageCategories]
        .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))
        .slice(0, 8)
        .map((item) => ({
          name: shortLabel(item.category, 13),
          label: item.category,
          bytes: Number(item.bytes || 0),
          count: Number(item.count || 0),
        })),
    [storageCategories],
  );

  const extensionChart = useMemo<BreakdownItem[]>(
    () =>
      [...storageExtensions]
        .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))
        .slice(0, 8)
        .map((item) => ({
          name: shortLabel(item.extension || "sem ext.", 10),
          label: item.extension || "Sem extensão",
          bytes: Number(item.bytes || 0),
          count: Number(item.count || 0),
        })),
    [storageExtensions],
  );

  const selectedUserCategoryChart = useMemo<BreakdownItem[]>(
    () =>
      (selectedUser?.byCategory || [])
        .slice()
        .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))
        .map((item) => ({
          name: shortLabel(item.category, 13),
          label: item.category,
          bytes: Number(item.bytes || 0),
          count: Number(item.count || 0),
        })),
    [selectedUser],
  );

  const selectedUserSourceChart = useMemo<BreakdownItem[]>(
    () =>
      (selectedUser?.bySource || []).map((item) => ({
        name: shortLabel(sourceLabel(item.source), 14),
        label: sourceLabel(item.source),
        bytes: Number(item.bytes || 0),
        count: Number(item.count || 0),
      })),
    [selectedUser],
  );

  const selectedFileCategoryChart = useMemo<BreakdownItem[]>(() => {
    const byCategory = new Map<string, { bytes: number; count: number }>();
    for (const file of files) {
      const key = file.category || "Arquivo";
      const current = byCategory.get(key) || { bytes: 0, count: 0 };
      current.bytes += Number(file.bytes || 0);
      current.count += 1;
      byCategory.set(key, current);
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([label, item]) => ({
        name: shortLabel(label, 13),
        label,
        bytes: item.bytes,
        count: item.count,
      }));
  }, [files]);

  const storageSsd = useMemo(
    () => (serverMetrics?.storage || []).filter((item) => item.kind === "ssd"),
    [serverMetrics],
  );
  const storageHd = useMemo(
    () => (serverMetrics?.storage || []).filter((item) => item.kind === "hd"),
    [serverMetrics],
  );
  const highlightedDisks = useMemo(() => {
    const picks: ServerStorageMetric[] = [];
    const primarySsd = storageSsd.find((item) => item.mountpoint === "/") || storageSsd[0];
    const primaryHd = storageHd.find((item) => item.mountpoint === "/media/server/HD Backup") || storageHd[0];
    if (primarySsd) picks.push(primarySsd);
    if (primaryHd && primaryHd !== primarySsd) picks.push(primaryHd);
    return picks;
  }, [storageHd, storageSsd]);

  const refreshStorage = useCallback(async () => {
    await Promise.all([loadSummary(), loadFiles(selectedUid)]);
  }, [loadFiles, loadSummary, selectedUid]);

  const handleRefresh = useCallback(async () => {
    if (activeTab === "server") {
      await loadServerMetrics();
      return;
    }
    await refreshStorage();
  }, [activeTab, loadServerMetrics, refreshStorage]);

  const activeError = activeTab === "server" ? serverError : storageError;
  const activeLoading = activeTab === "server" ? serverLoading : loading || fileLoading;

  return (
    <main className="min-h-screen bg-[#07100d] text-slate-100">
      <header className="border-b border-white/10 bg-[#0b1713]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold">GeoForest Admin</h1>
            <p className="text-sm text-slate-400">
              Banco administrativo e monitoramento do PC servidor.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleRefresh()}
            disabled={activeLoading}
          >
            <RefreshCw size={16} className={activeLoading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-5">
          <TabsList className="border border-cyan-400/25 bg-[#07100d] p-1 text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <TabsTrigger value="storage" className="gap-2 text-slate-100 hover:bg-white/10 hover:text-white data-[state=active]:bg-cyan-300 data-[state=active]:text-[#03120f] data-[state=active]:shadow-sm">
              <Database size={16} />
              Armazenamento
            </TabsTrigger>
            <TabsTrigger value="server" className="gap-2 text-slate-100 hover:bg-white/10 hover:text-white data-[state=active]:bg-cyan-300 data-[state=active]:text-[#03120f] data-[state=active]:shadow-sm">
              <Server size={16} />
              Servidor
            </TabsTrigger>
          </TabsList>

          {activeError && (
            <div className="flex items-center gap-2 text-sm text-red-300">
              <AlertTriangle size={16} />
              {activeError}
            </div>
          )}

          <StorageTab
            users={users}
            filteredUsers={filteredUsers}
            query={query}
            setQuery={setQuery}
            selectedUid={selectedUid}
            setSelectedUid={setSelectedUid}
            selectedUser={selectedUser}
            files={files}
            fileLoading={fileLoading}
            storageSources={storageSources}
            topUsersChart={topUsersChart}
            sourceChart={sourceChart}
            categoryChart={categoryChart}
            extensionChart={extensionChart}
            selectedUserCategoryChart={selectedUserCategoryChart}
            selectedUserSourceChart={selectedUserSourceChart}
            selectedFileCategoryChart={selectedFileCategoryChart}
            totalBytes={totalBytes}
            totalFiles={totalFiles}
            totalLocalBytes={totalLocalBytes}
            totalRasterBytes={totalRasterBytes}
            localBytes={localBytes}
            rasterBytes={rasterBytes}
            selectedTotalBytes={selectedTotalBytes}
            deleteCbersArchive={deleteCbersArchive}
          />

          <ServerTab
            serverMetrics={serverMetrics}
            serverLoading={serverLoading}
            highlightedDisks={highlightedDisks}
          />
        </Tabs>
      </section>
    </main>
  );
}

