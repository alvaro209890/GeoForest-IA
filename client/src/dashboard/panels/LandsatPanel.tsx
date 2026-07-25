import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  CloudDownload,
  Cpu,
  Database,
  Download,
  FileArchive,
  FolderTree,
  Gauge,
  HardDrive,
  Layers,
  Loader2,
  MapPinned,
  Radio,
  RefreshCw,
  Satellite,
  Search,
  Server,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { CbersMapPreview } from '@/dashboard/components/CbersMapPreview';
import { landsatArchiveZipUrl } from '@/dashboard/landsat/filenames';
import type { UseLandsatJobsReturn } from '@/dashboard/hooks/useLandsatJobs';

export type LandsatPanelProps = {
  landsat: UseLandsatJobsReturn;
};

export default function LandsatPanel({ landsat }: LandsatPanelProps) {
  const {
    landsatFile,
    setLandsatFile,
    setLandsatPropertyZipB64,
    landsatSearching,
    setLandsatScenes,
    landsatSelectedSceneId,
    setLandsatSelectedSceneId,
    setLandsatPreviewScene,
    landsatOrbit,
    setLandsatOrbit,
    landsatPoint,
    setLandsatPoint,
    landsatCarNumber,
    setLandsatCarNumber,
    landsatDateStart,
    setLandsatDateStart,
    landsatDateEnd,
    setLandsatDateEnd,
    landsatMaxCloudCover,
    setLandsatMaxCloudCover,
    landsatComposition,
    setLandsatComposition,
    landsatAreaHa,
    setLandsatAreaHa,
    landsatPropertyGeometry,
    setLandsatPropertyGeometry,
    landsatProcessing,
    landsatProgress,
    landsatError,
    setLandsatError,
    landsatWmsDownloadingId,
    landsatFileInputRef,
    landsatVisibleScenes,
    landsatSelectedScene,
    activeLandsatHistory,
    landsatSearchStats,
    applyLandsatZipFile,
    searchLandsatScenes,
    startLandsatProcessing,
    deleteLandsatJob,
    downloadLandsatWmsZip,
    landsatScenes,
  } = landsat;

  return (
          <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-7 custom-scrollbar">
            <div className="mx-auto max-w-7xl space-y-5">
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#071318] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                        <Satellite size={13} />
                        Landsat Collection 2 SR
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                        <FolderTree size={13} />
                        RASTER / LANDSAT
                      </span>
                    </div>
                    <h2 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">Acervo Landsat operacional</h2>
                    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { icon: HardDrive, label: 'WMS local', value: String(landsatSearchStats.local), tone: 'emerald' },
                        { icon: CloudDownload, label: 'STAC externo', value: String(landsatSearchStats.external), tone: 'sky' },
                        { icon: MapPinned, label: 'Cobertura', value: landsatSearchStats.bestCoverage === null ? 'n/d' : `${landsatSearchStats.bestCoverage.toFixed(0)}%`, tone: 'amber' },
                        { icon: CalendarDays, label: 'Período', value: landsatSearchStats.periodLabel, tone: 'slate' },
                      ].map((item) => {
                        const Icon = item.icon;
                        const toneClass = item.tone === 'emerald'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                          : item.tone === 'sky'
                            ? 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                            : item.tone === 'amber'
                              ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                              : 'border-white/10 bg-white/[0.04] text-slate-200';
                        return (
                          <div key={item.label} className={`min-h-[76px] rounded-xl border p-3 ${toneClass}`}>
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                              <Icon size={13} />
                              <span>{item.label}</span>
                            </div>
                            <p className="mt-2 truncate text-lg font-bold tabular-nums">{item.value}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="border-t border-white/10 bg-black/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
                    <div className="grid gap-3">
                      {[
                        { icon: Search, label: 'Buscar', value: landsatSearching ? 'rodando' : landsatSearchStats.total ? `${landsatSearchStats.visible}/${landsatSearchStats.total}` : 'pronto' },
                        { icon: Database, label: 'Reuso', value: landsatSearchStats.visibleLocal ? `${landsatSearchStats.visibleLocal} WMS` : 'sem match' },
                        { icon: Cpu, label: 'Processar', value: landsatProcessing ? 'ativo' : activeLandsatHistory?.status === 'completed' ? 'concluído' : 'aguardando' },
                        { icon: Server, label: 'Publicar', value: activeLandsatHistory?.wmsLayerName ? 'WMS OK' : 'pendente' },
                      ].map((item, index) => {
                        const Icon = item.icon;
                        const active = index === 0 ? landsatSearching : index === 2 ? landsatProcessing : false;
                        return (
                          <div key={item.label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3">
                            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${active ? 'border-sky-400/40 bg-sky-400/15 text-sky-100' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                              {active ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                              <p className="truncate text-sm font-semibold text-slate-100">{item.value}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
                    <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-white">Entrada</h3>
                          <p className="mt-1 text-xs text-slate-500">CAR estadual, ZIP/SHP ou órbita/ponto.</p>
                        </div>
                        {landsatAreaHa !== null && (
                          <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                            {landsatAreaHa.toFixed(2)} ha
                          </span>
                        )}
                      </div>

                      <div className="mt-4 space-y-4">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nº do CAR estadual</label>
                          <input
                            type="text"
                            value={landsatCarNumber}
                            onChange={(e) => {
                              const value = e.target.value.trim();
                              setLandsatCarNumber(value);
                              if (value) {
                                setLandsatFile(null);
                                setLandsatPropertyZipB64(null);
                                setLandsatScenes([]);
                                setLandsatSelectedSceneId(null);
                                setLandsatPreviewScene(null);
                                setLandsatPropertyGeometry(null);
                                setLandsatAreaHa(null);
                                setLandsatError(null);
                                if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
                              }
                            }}
                            disabled={Boolean(landsatFile)}
                            placeholder="MT-5107768-..."
                            className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-sky-500/50 ${landsatFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                          />
                        </div>

                        <label
                          className={`group relative flex min-h-[156px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 text-center transition-all ${landsatCarNumber.trim()
                            ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                            : landsatFile
                              ? 'border-sky-500/40 bg-sky-500/5 cursor-pointer'
                              : 'border-white/10 bg-white/[0.02] hover:border-sky-500/30 hover:bg-white/[0.03] cursor-pointer'
                            }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (!landsatCarNumber.trim()) e.dataTransfer.dropEffect = 'copy';
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (landsatCarNumber.trim()) return;
                            applyLandsatZipFile(e.dataTransfer.files?.[0] || null);
                          }}
                        >
                          <input
                            ref={landsatFileInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            className="hidden"
                            disabled={Boolean(landsatCarNumber.trim())}
                            onChange={(e) => {
                              applyLandsatZipFile(e.target.files?.[0] || null);
                            }}
                          />
                          <span className={`rounded-xl p-3 ${landsatFile ? 'bg-sky-500/15 text-sky-200' : landsatCarNumber.trim() ? 'bg-white/5 text-slate-600' : 'bg-white/5 text-slate-400 group-hover:text-sky-300'}`}>
                            <FileArchive size={22} />
                          </span>
                          <span className="max-w-full">
                            <span className="block truncate text-sm font-semibold text-white">
                              {landsatCarNumber.trim() ? 'ZIP bloqueado pelo CAR' : landsatFile ? landsatFile.name : 'Selecionar ZIP/SHP'}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {landsatFile ? `${(landsatFile.size / 1024).toFixed(0)} KB` : 'ATP, imóvel ou polígono de busca'}
                            </span>
                          </span>
                          {landsatFile && !landsatCarNumber.trim() && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setLandsatFile(null);
                                setLandsatPropertyZipB64(null);
                                setLandsatScenes([]);
                                setLandsatSelectedSceneId(null);
                                setLandsatPreviewScene(null);
                                setLandsatPropertyGeometry(null);
                                setLandsatAreaHa(null);
                                setLandsatError(null);
                                if (landsatFileInputRef.current) landsatFileInputRef.current.value = '';
                              }}
                              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                              aria-label="Remover ZIP Landsat"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#071318]/85 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-white">Filtros</h3>
                          <p className="mt-1 text-xs text-slate-500">Órbita/ponto, data, nuvem e composição.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLandsatOrbit('');
                            setLandsatPoint('');
                            setLandsatDateStart('');
                            setLandsatDateEnd('');
                            setLandsatMaxCloudCover('30');
                            setLandsatComposition('false_color');
                          }}
                          className="inline-flex items-center gap-2 self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                        >
                          <RefreshCw size={12} />
                          Limpar
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Órbita</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={landsatOrbit}
                            onChange={(e) => setLandsatOrbit(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                            placeholder="224"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ponto</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={landsatPoint}
                            onChange={(e) => setLandsatPoint(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                            placeholder="069"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nuvem máx.</label>
                          <div className="relative">
                            <Gauge size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="100"
                              step="1"
                              value={landsatMaxCloudCover}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === '') {
                                  setLandsatMaxCloudCover('');
                                  return;
                                }
                                const numeric = Math.max(0, Math.min(100, Number(value)));
                                setLandsatMaxCloudCover(Number.isFinite(numeric) ? String(numeric) : '');
                              }}
                              placeholder="30"
                              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-sky-500/50"
                            />
                          </div>
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Composição</label>
                          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                            <button
                              type="button"
                              onClick={() => setLandsatComposition('false_color')}
                              className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${landsatComposition === 'false_color' ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-white'}`}
                            >
                              C654
                            </button>
                            <button
                              type="button"
                              onClick={() => setLandsatComposition('natural_color')}
                              className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${landsatComposition === 'natural_color' ? 'bg-sky-500/20 text-sky-100' : 'text-slate-400 hover:text-white'}`}
                            >
                              RGB
                            </button>
                          </div>
                        </div>
                        <div className="md:col-span-6">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Data inicial</label>
                          <input
                            type="date"
                            value={landsatDateStart}
                            onChange={(e) => setLandsatDateStart(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                        <div className="md:col-span-6">
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Data final</label>
                          <input
                            type="date"
                            value={landsatDateEnd}
                            onChange={(e) => setLandsatDateEnd(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500/50"
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => void searchLandsatScenes()}
                          disabled={(!landsatFile && !landsatCarNumber.trim() && (!landsatOrbit.trim() || !landsatPoint.trim())) || landsatSearching || landsatProcessing}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {landsatSearching ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                          Buscar
                        </button>
                        <button
                          type="button"
                          onClick={() => void startLandsatProcessing()}
                          disabled={!landsatSelectedScene || landsatProcessing || landsatSelectedScene.coversArea === false}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {landsatProcessing ? <Loader2 size={17} className="animate-spin" /> : landsatSelectedScene?.wmsAvailable ? <CheckCircle2 size={17} /> : <CloudDownload size={17} />}
                          {landsatSelectedScene?.wmsAvailable ? 'Reusar WMS' : 'Baixar e publicar'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {landsatError && (
                    <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                      <AlertTriangle size={16} />
                      <span>{landsatError}</span>
                    </div>
                  )}

                  {(landsatPropertyGeometry || landsatSelectedScene?.geometry) && (
                    <CbersMapPreview
                      propertyGeometry={landsatPropertyGeometry}
                      sceneGeometry={landsatSelectedScene?.geometry || null}
                    />
                  )}

                  <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-white">Cenas</h3>
                        <p className="mt-1 text-xs text-slate-500">{landsatSearchStats.visible}/{landsatSearchStats.total || 0} visíveis</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                          <HardDrive size={12} />
                          {landsatSearchStats.local} WMS
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                          <CloudDownload size={12} />
                          {landsatSearchStats.external} STAC
                        </span>
                      </div>
                    </div>

                    {landsatScenes.length > 0 ? (
                      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {landsatVisibleScenes.map((scene) => {
                          const selected = landsatSelectedSceneId === scene.id;
                          const date = scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : scene.date || 'Sem data';
                          const coverage = Number(scene.coveragePercent ?? 0);
                          const hasCoverage = typeof scene.coveragePercent === 'number' && Number.isFinite(scene.coveragePercent);
                          const availableOnWms = Boolean(scene.wmsAvailable && scene.wmsUrl);
                          const blocked = scene.coversArea === false;
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              onClick={() => setLandsatSelectedSceneId(scene.id)}
                              className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-sky-500/50 bg-sky-500/10 shadow-[0_0_0_1px_rgba(14,165,233,0.16)]' : availableOnWms ? 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/45' : blocked ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-sky-500/25 hover:bg-sky-500/[0.04]'}`}
                            >
                              <div className="flex gap-3">
                                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-600">
                                      <Layers size={22} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-start justify-between gap-2">
                                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{scene.id}</p>
                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${availableOnWms ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-sky-400/25 bg-sky-400/10 text-sky-200'}`}>
                                      {availableOnWms ? 'WMS' : 'STAC'}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <CalendarDays size={11} className="mr-1 inline" />
                                      {date}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <Radio size={11} className="mr-1 inline" />
                                      {scene.path}/{scene.row}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <Gauge size={11} className="mr-1 inline" />
                                      {scene.cloudCover === null ? 'Nuvem n/d' : `${scene.cloudCover.toFixed(1)}% nuvem`}
                                    </span>
                                    <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                                      <SlidersHorizontal size={11} className="mr-1 inline" />
                                      {scene.compositionLabel}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${blocked ? 'text-red-300' : hasCoverage ? 'text-emerald-300' : 'text-sky-300'}`}>
                                      {hasCoverage ? `Cobertura ${coverage.toFixed(1)}%` : 'Órbita/ponto'}
                                    </span>
                                    {availableOnWms && (
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void downloadLandsatWmsZip(scene);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter' && e.key !== ' ') return;
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void downloadLandsatWmsZip(scene);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                                      >
                                        {landsatWmsDownloadingId === scene.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        ZIP
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-sky-500/40 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-white/[0.04] text-slate-500'} ${blocked ? 'opacity-40' : 'hover:text-sky-200'}`}
                                  title={selected ? 'Cena selecionada' : 'Selecionar cena'}
                                >
                                  {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-sm text-slate-500">
                        <div className="text-center">
                          <Search size={22} className="mx-auto mb-2 text-slate-600" />
                          <p>Nenhuma busca Landsat carregada.</p>
                        </div>
                      </div>
                    )}

                    {landsatScenes.length > 0 && landsatVisibleScenes.length === 0 && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                        Nenhuma cena dentro dos filtros atuais.
                      </div>
                    )}
                  </div>
                </section>

                <aside className="space-y-5">
                  {(() => {
                    const activeLandsat = activeLandsatHistory;
                    const pct = Math.max(0, Math.min(100, Math.round(Number(landsatProgress?.percent ?? activeLandsat?.percent ?? 0))));
                    const done = activeLandsat?.status === 'completed';
                    const zipUrl = landsatArchiveZipUrl(activeLandsat || landsatSelectedScene);
                    const activeStage = String(landsatProgress?.stage || activeLandsat?.stage || '').toLowerCase();
                    const stageLabelByKey: Record<string, string> = {
                      queued: 'Na fila',
                      download: 'Baixando bandas',
                      compose: 'Compondo RGB',
                      composite: 'Compondo RGB',
                      vrt: 'Montando VRT',
                      geotiff: 'Gerando GeoTIFF',
                      archive: 'Salvando no acervo',
                      publish_wms: 'Publicando WMS',
                      verify_wms: 'Validando WMS',
                      completed: 'Concluído',
                      failed: 'Falhou',
                      cancelled: 'Cancelado',
                    };
                    const progressMessage = landsatProgress?.message || activeLandsat?.message || 'Aguardando seleção.';
                    const stageLabel = stageLabelByKey[activeStage] || landsatProgress?.stage || activeLandsat?.stage || 'Aguardando';
                    return (
                      <div className="rounded-2xl border border-white/10 bg-[#071318]/90 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-white">Status</h3>
                            <p className="mt-1 truncate text-xs text-slate-500">{activeLandsat?.scene?.id || activeLandsat?.sceneId || landsatSelectedScene?.id || 'Sem job ativo'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${done ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : landsatProcessing ? 'border-sky-500/25 bg-sky-500/10 text-sky-200' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                            {done ? 'WMS OK' : landsatProcessing ? 'Ativo' : 'Pronto'}
                          </span>
                        </div>

                        <div className="mt-5 space-y-2">
                          <div className="flex items-end justify-between text-xs">
                            <span className="font-medium text-slate-300">{stageLabel}</span>
                            <span className="font-bold tabular-nums text-sky-300">{pct}%</span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
                        </div>

                        <div className="mt-5 grid gap-2">
                          {landsatProcessing && activeLandsat && (
                            <button
                              type="button"
                              onClick={() => void deleteLandsatJob(activeLandsat)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/15"
                            >
                              <X size={16} />
                              Cancelar
                            </button>
                          )}
                          {done && activeLandsat && zipUrl && (
                            <button
                              type="button"
                              onClick={() => void downloadLandsatWmsZip(activeLandsat)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
                            >
                              {landsatWmsDownloadingId === activeLandsat.jobId ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
                              Baixar ZIP
                            </button>
                          )}
                          {landsatSelectedScene?.wmsAvailable && !activeLandsat && (
                            <button
                              type="button"
                              onClick={() => void downloadLandsatWmsZip(landsatSelectedScene)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                            >
                              <Download size={17} />
                              Baixar WMS
                            </button>
                          )}
                          {activeLandsat?.wmsLayerName && (
                            <a
                              href={activeLandsat.wmsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.07]"
                            >
                              <ArrowUpRight size={14} />
                              Abrir GetCapabilities
                            </a>
                          )}
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Arquivo</p>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                              {activeLandsat?.outputBytes ? `${(activeLandsat.outputBytes / 1024 / 1024).toFixed(1)} MB` : 'n/d'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Camada</p>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                              {activeLandsat?.wmsStoreName || landsatSelectedScene?.wmsStoreName || 'n/d'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-white/10 bg-[#0b1412]/85 p-5">
                    <h3 className="text-base font-semibold text-white">Árvore WMS</h3>
                    <div className="mt-4 space-y-2 text-sm">
                      {['RASTER', 'LANDSAT', landsatSelectedScene?.orbit ? `landsat_orbit_${landsatSelectedScene.orbit}` : 'landsat_orbit_*', landsatSelectedScene?.year ? `ano ${landsatSelectedScene.year}` : 'ano'].map((item, index) => (
                        <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-slate-300">
                          <FolderTree size={14} className={index < 2 ? 'text-emerald-300' : 'text-sky-300'} />
                          <span className="truncate">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
  );
}
