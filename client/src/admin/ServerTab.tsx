/**
 * Aba "Servidor" do painel administrativo (CPU, memória, discos e processos).
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

export type ServerTabProps = {
  serverMetrics: ServerMetricsPayload | null;
  serverLoading: boolean;
  highlightedDisks: ServerStorageMetric[];
};

export function ServerTab({
  serverMetrics,
  serverLoading,
  highlightedDisks,
}: ServerTabProps): React.ReactElement {
  return (
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
  );
}

