import "@/index.css";
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

type SourceSummary = {
  source: string;
  count: number;
  bytes: number;
};

type UserSummary = {
  uid: string;
  email?: string;
  fullName?: string;
  fileCount: number;
  bytes: number;
  userStorageBytes?: number;
  userStorageCount?: number;
  sharedRasterBytes?: number;
  sharedRasterCount?: number;
  lastModifiedAt?: string;
  byCategory?: Array<{ category: string; count: number; bytes: number }>;
  bySource?: SourceSummary[];
};

type BreakdownItem = {
  name: string;
  label: string;
  count: number;
  bytes: number;
};

type AdminStorageFile = {
  id: string;
  uid: string;
  name: string;
  relativePath: string;
  publicUrl?: string;
  category: string;
  source: "user_storage" | "raster_archive";
  extension: string;
  bytes: number;
  modifiedAt?: string;
  createdAt?: string;
  imageId?: string;
  wmsPublicUrl?: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
};

type SummaryPayload = {
  ok: boolean;
  totalBytes: number;
  totalFiles: number;
  userStorageBytes?: number;
  sharedRasterBytes?: number;
  userStorageFiles?: number;
  sharedRasterFiles?: number;
  byCategory?: Array<{ category: string; count: number; bytes: number }>;
  byExtension?: Array<{ extension: string; count: number; bytes: number }>;
  bySource?: SourceSummary[];
  users: UserSummary[];
};

type ServerStorageMetric = {
  device: string;
  kind: "ssd" | "hd";
  model?: string;
  mountpoint: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
};

type ServerProcess = {
  pid: number;
  command: string;
  cpuPercent: number;
  memPercent: number;
};

type ServerMetricsPayload = {
  ok: boolean;
  updatedAt: string;
  host: {
    hostname: string;
    platform: string;
    release: string;
    uptimeSec: number;
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg: [number, number, number];
    usagePercent: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  temperature: {
    available: boolean;
    cpuPackageC: number | null;
    hottestCoreC: number | null;
    readings: Array<{ label: string; valueC: number }>;
  };
  storage: ServerStorageMetric[];
  processes: {
    totalVisible: number;
    top: ServerProcess[];
  };
};

const CHART_COLORS = ["#22d3ee", "#34d399", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa", "#f97316"];
const RESERVED_USER_STORAGE_NAMES = new Set([
  "attachments",
  "auas",
  "auas_jobs",
  "cbers",
  "cbers_wpm_jobs",
  "conversations",
  "processing_jobs",
  "settings",
  "simcar",
  "simcar_clips",
  "trash",
]);

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

function formatPercent(value?: number | null): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)}%`;
}

function formatTemperature(value?: number | null): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${Number(value).toFixed(1)} °C`;
}

function formatUptime(seconds?: number): string {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "-";
  const total = Math.floor(Number(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function sourceLabel(source?: string): string {
  switch (source) {
    case "raster_archive":
      return "Raster compartilhado";
    case "user_storage":
      return "Conta local";
    default:
      return "Arquivo";
  }
}

function sourceTone(source?: string): string {
  switch (source) {
    case "raster_archive":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "user_storage":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

function storageKindLabel(kind: "ssd" | "hd"): string {
  return kind === "ssd" ? "SSD" : "HD";
}

function storageKindTone(kind: "ssd" | "hd"): string {
  return kind === "ssd"
    ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
    : "border-amber-500/20 bg-amber-500/10 text-amber-200";
}

function compactBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  const units = ["B", "K", "M", "G", "T"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)}${units[unit]}`;
}

function shortLabel(value: string, size = 16): string {
  const text = String(value || "").trim();
  if (text.length <= size) return text || "-";
  return `${text.slice(0, Math.max(1, size - 1))}...`;
}

function isAdminUserSummary(item: UserSummary): boolean {
  const uid = String(item?.uid || "").trim();
  if (!uid || RESERVED_USER_STORAGE_NAMES.has(uid)) return false;
  return Boolean(item.email || item.fullName || Number(item.sharedRasterBytes || 0) > 0 || Number(item.fileCount || 0) > 0);
}

async function fetchJson(path: string): Promise<any> {
  const response = await fetch(apiUrl(path));
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Resposta do backend nao e JSON.");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "Falha na requisicao.");
  return payload;
}

function cbersImageToStorageFile(image: any): AdminStorageFile {
  const relativePath = String(image?.hdRelativePath || "");
  const publicUrl = relativePath ? `/api/raster/${relativePath}` : "";
  return {
    id: `cbers_archive:${String(image?.imageId || image?.archiveFilename || globalThis.crypto?.randomUUID?.() || Math.random())}`,
    uid: String(image?.uid || ""),
    name: String(image?.archiveFilename || image?.itemId || "CBERS"),
    relativePath,
    publicUrl,
    category: "Raster compartilhado",
    source: "raster_archive",
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

function MetricCard(props: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ReactNode;
  tone?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">{props.label}</p>
        <div className={props.tone || "text-slate-500"}>{props.icon}</div>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-100">{props.value}</p>
      {props.detail && <p className="mt-1 text-xs text-slate-500">{props.detail}</p>}
    </div>
  );
}

function ChartPanel(props: {
  title: string;
  detail?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-lg border border-white/10 bg-[#0b1713] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">{props.title}</h2>
          {props.detail && <p className="mt-1 text-xs text-slate-500">{props.detail}</p>}
        </div>
        {props.icon && <div className="text-slate-500">{props.icon}</div>}
      </div>
      {props.children}
    </section>
  );
}

function InlineChartBlock(props: {
  title: string;
  detail?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{props.title}</h3>
          {props.detail && <p className="mt-1 text-xs text-slate-500">{props.detail}</p>}
        </div>
        {props.icon && <div className="text-slate-500">{props.icon}</div>}
      </div>
      {props.children}
    </div>
  );
}

function EmptyChart(props: { message: string }): React.ReactElement {
  return (
    <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-white/10 bg-black/10 text-sm text-slate-500">
      {props.message}
    </div>
  );
}

function BytesTooltip({ active, payload, label }: any): React.ReactElement | null {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload || {};
  return (
    <div className="rounded-md border border-white/10 bg-[#08110e] px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-slate-100">{item.label || label}</p>
      <p className="mt-1 text-cyan-200">{formatBytes(Number(item.bytes || payload[0]?.value || 0))}</p>
      {Number.isFinite(Number(item.count)) && <p className="text-slate-500">{Number(item.count)} arquivo(s)</p>}
    </div>
  );
}

function StorageBarChart(props: { data: BreakdownItem[]; empty: string }): React.ReactElement {
  if (!props.data.length) return <EmptyChart message={props.empty} />;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={props.data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickFormatter={(value) => compactBytes(Number(value))}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip content={<BytesTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="bytes" radius={[4, 4, 0, 0]}>
            {props.data.map((item, index) => (
              <Cell key={item.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StoragePieChart(props: { data: BreakdownItem[]; empty: string }): React.ReactElement {
  const data = props.data.filter((item) => item.bytes > 0);
  if (!data.length) return <EmptyChart message={props.empty} />;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="bytes" nameKey="label" innerRadius={58} outerRadius={92} paddingAngle={2}>
              {data.map((item, index) => (
                <Cell key={item.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<BytesTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2 self-center">
        {data.map((item, index) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                <p className="truncate text-xs font-medium text-slate-200">{item.label}</p>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{item.count} arquivo(s)</p>
            </div>
            <p className="shrink-0 text-xs font-semibold text-slate-100">{formatBytes(item.bytes)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressLine(props: { label: string; bytes: number; total: number; tone: string }): React.ReactElement {
  const width = props.total > 0 ? Math.max(2, Math.round((props.bytes / props.total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-400">
        <span>{props.label}</span>
        <span>{formatBytes(props.bytes)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${props.tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function PercentBar(props: { label: string; value: number; detail: string; tone: string }): React.ReactElement {
  const width = Math.max(0, Math.min(100, Number(props.value || 0)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-400">
        <span>{props.label}</span>
        <span>{props.detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${props.tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ServerDiskCard(props: { item: ServerStorageMetric }): React.ReactElement {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded border px-2 py-1 text-[11px] font-medium uppercase ${storageKindTone(props.item.kind)}`}>
              {storageKindLabel(props.item.kind)}
            </span>
            <p className="truncate text-sm font-medium text-slate-100">{props.item.model || props.item.device}</p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {props.item.mountpoint} · {props.item.device}
          </p>
        </div>
        <HardDrive size={18} className={props.item.kind === "ssd" ? "text-cyan-300" : "text-amber-300"} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase text-slate-500">Total</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{formatBytes(props.item.totalBytes)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase text-slate-500">Usado</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{formatBytes(props.item.usedBytes)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase text-slate-500">Livre</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{formatBytes(props.item.freeBytes)}</p>
        </div>
      </div>
      <div className="mt-4">
        <PercentBar
          label="Ocupação"
          value={props.item.usagePercent}
          detail={formatPercent(props.item.usagePercent)}
          tone={props.item.kind === "ssd" ? "bg-cyan-400" : "bg-amber-400"}
        />
      </div>
    </div>
  );
}

function AdminApp() {
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
          <TabsList className="border border-white/10 bg-white/[0.03] p-1">
            <TabsTrigger value="storage" className="gap-2 data-[state=active]:bg-[#07100d] data-[state=active]:text-slate-100">
              <Database size={16} />
              Armazenamento
            </TabsTrigger>
            <TabsTrigger value="server" className="gap-2 data-[state=active]:bg-[#07100d] data-[state=active]:text-slate-100">
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

          <TabsContent value="storage" className="space-y-5">
            <section className="grid gap-4 lg:grid-cols-4">
              <MetricCard
                label="Armazenamento total"
                value={formatBytes(totalBytes)}
                detail={`${users.length} conta(s) com dados`}
                icon={<HardDrive size={18} />}
                tone="text-cyan-300"
              />
              <MetricCard
                label="Conta local"
                value={formatBytes(totalLocalBytes)}
                detail={`${Number(storageSources.find((item) => item.source === "user_storage")?.count || 0)} arquivo(s)`}
                icon={<User size={18} />}
                tone="text-cyan-300"
              />
              <MetricCard
                label="Raster compartilhado"
                value={formatBytes(totalRasterBytes)}
                detail={`${Number(storageSources.find((item) => item.source === "raster_archive")?.count || 0)} arquivo(s)`}
                icon={<Layers3 size={18} />}
                tone="text-emerald-300"
              />
              <MetricCard
                label="Arquivos rastreados"
                value={String(totalFiles)}
                detail={`Atualizado em ${formatDate(selectedUser?.lastModifiedAt)}`}
                icon={<Database size={18} />}
                tone="text-violet-300"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
              <ChartPanel
                title="Banco de Dados Geral"
                detail="Distribuição entre armazenamento da conta e acervo raster compartilhado."
                icon={<PieChartIcon size={18} />}
              >
                <StoragePieChart data={sourceChart} empty="Sem dados por origem." />
                <div className="space-y-3">
                  <ProgressLine label="Conta local" bytes={totalLocalBytes} total={Math.max(totalBytes, 1)} tone="bg-cyan-400" />
                  <ProgressLine label="Raster compartilhado" bytes={totalRasterBytes} total={Math.max(totalBytes, 1)} tone="bg-emerald-400" />
                </div>
              </ChartPanel>
              <ChartPanel
                title="Ranking por Usuário"
                detail="Contas ordenadas pelo volume total rastreado no banco."
                icon={<Users size={18} />}
              >
                <StorageBarChart data={topUsersChart} empty="Nenhum usuário com dados." />
              </ChartPanel>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartPanel
                title="Categorias do Banco"
                detail="Categorias mais relevantes em bytes, somando todos os usuários."
                icon={<BarChart3 size={18} />}
              >
                <StorageBarChart data={categoryChart} empty="Sem categorias rastreadas." />
              </ChartPanel>
              <ChartPanel
                title="Extensões do Banco"
                detail="Formato dos arquivos salvos e indexados pela área administrativa."
                icon={<Database size={18} />}
              >
                <StorageBarChart data={extensionChart} empty="Sem extensões rastreadas." />
              </ChartPanel>
            </section>

            <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.fullName || item.email || item.uid}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{item.email || item.uid}</p>
                        </div>
                        <span className="rounded border border-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-400">
                          {formatBytes(item.bytes)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span>{item.fileCount} arquivo(s)</span>
                        <span>{formatDate(item.lastModifiedAt)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200">
                          {formatBytes(Number(item.userStorageBytes || 0))} local
                        </span>
                        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                          {formatBytes(Number(item.sharedRasterBytes || 0))} raster
                        </span>
                      </div>
                    </button>
                  ))}
                  {!filteredUsers.length && <p className="p-4 text-sm text-slate-500">Nenhuma conta encontrada.</p>}
                </div>
              </aside>

              <section className="rounded-lg border border-white/10 bg-[#0b1713]">
                <div className="border-b border-white/10 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">
                        {selectedUser?.fullName || selectedUser?.email || selectedUid || "Conta"}
                      </h2>
                      <p className="truncate text-xs text-slate-500">{selectedUid || "Selecione uma conta"}</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
                        <p className="text-sm font-semibold text-slate-100">{formatBytes(selectedTotalBytes)}</p>
                      </div>
                      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-cyan-200/80">Conta local</p>
                        <p className="text-sm font-semibold text-cyan-100">{formatBytes(localBytes)}</p>
                      </div>
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-emerald-200/80">Raster vinculado</p>
                        <p className="text-sm font-semibold text-emerald-100">{formatBytes(rasterBytes)}</p>
                      </div>
                    </div>
                  </div>
                  {selectedUser?.byCategory?.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedUser.byCategory.slice(0, 4).map((item) => (
                        <span
                          key={item.category}
                          className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300"
                        >
                          {item.category}: {formatBytes(item.bytes)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-4 border-b border-white/10 p-4 xl:grid-cols-2">
                  <InlineChartBlock
                    title="Usuário por Origem"
                    detail="Separação dos arquivos da conta selecionada."
                    icon={<PieChartIcon size={18} />}
                  >
                    <StoragePieChart data={selectedUserSourceChart} empty="Sem origem rastreada para este usuário." />
                  </InlineChartBlock>
                  <InlineChartBlock
                    title="Usuário por Categoria"
                    detail="Distribuição do usuário selecionado por tipo de dado."
                    icon={<BarChart3 size={18} />}
                  >
                    <StorageBarChart
                      data={selectedFileCategoryChart.length ? selectedFileCategoryChart : selectedUserCategoryChart}
                      empty="Sem categorias para este usuário."
                    />
                  </InlineChartBlock>
                </div>

                <div className="overflow-auto">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead className="bg-white/[0.03] text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Arquivo</th>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3">Origem</th>
                        <th className="px-4 py-3">Tamanho</th>
                        <th className="px-4 py-3">Atualizado</th>
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
                          <td className="px-4 py-3 text-slate-300">{file.category}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded px-2 py-1 text-xs ${sourceTone(file.source)}`}>
                              {sourceLabel(file.source)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-300">{formatBytes(file.bytes)}</td>
                          <td className="px-4 py-3 text-slate-400">{formatDate(file.modifiedAt || file.createdAt)}</td>
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
                              {file.source === "raster_archive" && file.imageId && (
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
          </TabsContent>

          <TabsContent value="server" className="space-y-5">
            <section className="grid gap-4 lg:grid-cols-4">
              <MetricCard
                label="Host"
                value={serverMetrics?.host.hostname || "-"}
                detail={serverMetrics ? `${serverMetrics.host.platform} ${serverMetrics.host.release}` : "Aguardando leitura do backend"}
                icon={<Server size={18} />}
                tone="text-cyan-300"
              />
              <MetricCard
                label="Uptime"
                value={formatUptime(serverMetrics?.host.uptimeSec)}
                detail={serverMetrics ? `Atualizado em ${formatDate(serverMetrics.updatedAt)}` : "Sem amostra"}
                icon={<Activity size={18} />}
                tone="text-emerald-300"
              />
              <MetricCard
                label="CPU"
                value={formatPercent(serverMetrics?.cpu.usagePercent)}
                detail={serverMetrics ? `${serverMetrics.cpu.cores} núcleo(s) lógicos` : "Sem amostra"}
                icon={<Cpu size={18} />}
                tone="text-violet-300"
              />
              <MetricCard
                label="RAM usada"
                value={serverMetrics ? formatBytes(serverMetrics.memory.usedBytes) : "-"}
                detail={serverMetrics ? `${formatPercent(serverMetrics.memory.usagePercent)} do total` : "Sem amostra"}
                icon={<MemoryStick size={18} />}
                tone="text-amber-300"
              />
            </section>

            <ChartPanel
              title="Armazenamento do Servidor"
              detail="Discos montados no host, com destaque para o SSD do sistema e o HD de dados."
              icon={<HardDrive size={18} />}
            >
              {serverMetrics?.storage.length ? (
                <div className="space-y-4">
                  {highlightedDisks.length ? (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {highlightedDisks.map((item) => (
                        <ServerDiskCard key={`${item.device}:${item.mountpoint}`} item={item} />
                      ))}
                    </div>
                  ) : null}
                  {(serverMetrics.storage.length > highlightedDisks.length || !highlightedDisks.length) && (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {serverMetrics.storage
                        .filter((item) => !highlightedDisks.some((picked) => picked.device === item.device && picked.mountpoint === item.mountpoint))
                        .map((item) => (
                          <ServerDiskCard key={`${item.device}:${item.mountpoint}`} item={item} />
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <EmptyChart message={serverLoading ? "Carregando discos..." : "Nenhum disco montado encontrado."} />
              )}
            </ChartPanel>

            <section className="grid gap-4 xl:grid-cols-2">
              <ChartPanel
                title="Processamento"
                detail="Modelo, carga média e ocupação atual da CPU."
                icon={<Cpu size={18} />}
              >
                <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Processador</p>
                      <p className="mt-1 text-sm font-medium text-slate-100">{serverMetrics?.cpu.model || "-"}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Núcleos lógicos</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{serverMetrics?.cpu.cores || "-"}</p>
                      </div>
                      <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Uso atual</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{formatPercent(serverMetrics?.cpu.usagePercent)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <PercentBar
                      label="CPU atual"
                      value={Number(serverMetrics?.cpu.usagePercent || 0)}
                      detail={formatPercent(serverMetrics?.cpu.usagePercent)}
                      tone="bg-violet-400"
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      {serverMetrics?.cpu.loadAvg.map((value, index) => (
                        <div key={index} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Load {index === 0 ? "1m" : index === 1 ? "5m" : "15m"}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-100">{value.toFixed(2)}</p>
                        </div>
                      )) || null}
                    </div>
                  </div>
                </div>
              </ChartPanel>

              <ChartPanel
                title="Memória RAM"
                detail="Uso agregado de memória do host."
                icon={<MemoryStick size={18} />}
              >
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{serverMetrics ? formatBytes(serverMetrics.memory.totalBytes) : "-"}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Usada</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{serverMetrics ? formatBytes(serverMetrics.memory.usedBytes) : "-"}</p>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Livre</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{serverMetrics ? formatBytes(serverMetrics.memory.freeBytes) : "-"}</p>
                    </div>
                  </div>
                  <PercentBar
                    label="Uso de RAM"
                    value={Number(serverMetrics?.memory.usagePercent || 0)}
                    detail={formatPercent(serverMetrics?.memory.usagePercent)}
                    tone="bg-amber-400"
                  />
                </div>
              </ChartPanel>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <ChartPanel
                title="Temperatura"
                detail="Leituras disponíveis do backend via sensors."
                icon={<Thermometer size={18} />}
              >
                {serverMetrics?.temperature.available ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-red-200/80">CPU package</p>
                        <p className="mt-1 text-sm font-semibold text-red-100">{formatTemperature(serverMetrics.temperature.cpuPackageC)}</p>
                      </div>
                      <div className="rounded-md border border-orange-500/20 bg-orange-500/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-orange-200/80">Core mais quente</p>
                        <p className="mt-1 text-sm font-semibold text-orange-100">{formatTemperature(serverMetrics.temperature.hottestCoreC)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {serverMetrics.temperature.readings.map((reading) => (
                        <span
                          key={`${reading.label}:${reading.valueC}`}
                          className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300"
                        >
                          {reading.label}: {formatTemperature(reading.valueC)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-white/10 bg-black/10 px-4 py-10 text-sm text-slate-500">
                    Leituras de temperatura indisponíveis neste host.
                  </div>
                )}
              </ChartPanel>

              <ChartPanel
                title="Processos"
                detail={`Top processos por CPU${serverMetrics ? ` · ${serverMetrics.processes.totalVisible} visíveis no host` : ""}.`}
                icon={<Activity size={18} />}
              >
                <div className="overflow-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-white/[0.03] text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-3">PID</th>
                        <th className="px-3 py-3">Processo</th>
                        <th className="px-3 py-3">CPU</th>
                        <th className="px-3 py-3">RAM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(serverMetrics?.processes.top || []).map((process) => (
                        <tr key={`${process.pid}:${process.command}`} className="border-t border-white/5">
                          <td className="px-3 py-3 text-slate-300">{process.pid}</td>
                          <td className="px-3 py-3 font-medium text-slate-100">{process.command}</td>
                          <td className="px-3 py-3 text-slate-300">{formatPercent(process.cpuPercent)}</td>
                          <td className="px-3 py-3 text-slate-300">{formatPercent(process.memPercent)}</td>
                        </tr>
                      ))}
                      {!serverMetrics?.processes.top.length && (
                        <tr>
                          <td className="px-3 py-10 text-center text-slate-500" colSpan={4}>
                            {serverLoading ? "Carregando processos..." : "Nenhum processo disponível."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </ChartPanel>
            </section>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
