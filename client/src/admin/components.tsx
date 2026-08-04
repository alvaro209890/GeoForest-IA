/**
 * Componentes visuais reutilizados pelas abas do painel administrativo.
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
import type { BreakdownItem, ServerStorageMetric } from "./types";
import { CHART_COLORS } from "./constants";
import { compactBytes, formatBytes, formatPercent, shortLabel, storageKindLabel, storageKindTone } from "./format";

export function MetricCard(props: {
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

export function ChartPanel(props: {
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

export function InlineChartBlock(props: {
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

export function EmptyChart(props: { message: string }): React.ReactElement {
  return (
    <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-white/10 bg-black/10 text-sm text-slate-500">
      {props.message}
    </div>
  );
}

export function BytesTooltip({ active, payload, label }: any): React.ReactElement | null {
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

export function StorageBarChart(props: { data: BreakdownItem[]; empty: string }): React.ReactElement {
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

export function StoragePieChart(props: { data: BreakdownItem[]; empty: string }): React.ReactElement {
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

export function ProgressLine(props: { label: string; bytes: number; total: number; tone: string }): React.ReactElement {
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

export function PercentBar(props: { label: string; value: number; detail: string; tone: string }): React.ReactElement {
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

export function ServerDiskCard(props: { item: ServerStorageMetric }): React.ReactElement {
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


