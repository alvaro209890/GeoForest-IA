/**
 * Aba "Armazenamento" do painel administrativo.
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

export type StorageTabProps = {
  users: UserSummary[];
  filteredUsers: UserSummary[];
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  selectedUid: string;
  setSelectedUid: React.Dispatch<React.SetStateAction<string>>;
  selectedUser: UserSummary | null;
  files: AdminStorageFile[];
  fileLoading: boolean;
  storageSources: SourceSummary[];
  topUsersChart: BreakdownItem[];
  sourceChart: BreakdownItem[];
  categoryChart: BreakdownItem[];
  extensionChart: BreakdownItem[];
  selectedUserCategoryChart: BreakdownItem[];
  selectedUserSourceChart: BreakdownItem[];
  selectedFileCategoryChart: BreakdownItem[];
  totalBytes: number;
  totalFiles: number;
  totalLocalBytes: number;
  totalRasterBytes: number;
  localBytes: number;
  rasterBytes: number;
  selectedTotalBytes: number;
  deleteCbersArchive: (file: AdminStorageFile) => Promise<void>;
};

export function StorageTab({
  users,
  filteredUsers,
  query,
  setQuery,
  selectedUid,
  setSelectedUid,
  selectedUser,
  files,
  fileLoading,
  storageSources,
  topUsersChart,
  sourceChart,
  categoryChart,
  extensionChart,
  selectedUserCategoryChart,
  selectedUserSourceChart,
  selectedFileCategoryChart,
  totalBytes,
  totalFiles,
  totalLocalBytes,
  totalRasterBytes,
  localBytes,
  rasterBytes,
  selectedTotalBytes,
  deleteCbersArchive,
}: StorageTabProps): React.ReactElement {
  return (
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
  );
}

